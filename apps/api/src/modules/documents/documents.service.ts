import {
  type AddDocumentVersionFields,
  type DeleteDocumentInput,
  type Document,
  type DocumentDetail,
  type DocumentListQuery,
  type DocumentMimeType,
  type DocumentVersion,
  RESTRICTED_DOCUMENT_CATEGORIES,
  type UploadDocumentFields,
} from '@hrm/contracts';
import { type schema, uuidv7 } from '@hrm/db';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { stamp } from '../../lib/dto';
import { pageMeta, pageOffset } from '../../lib/pagination';
import { AppError, invalidTransition, notFound, validationFailed, versionConflict } from '../../lib/problem';
import { getSetting } from '../../lib/settings';
import {
  contentDisposition,
  matchesDeclared,
  safeFileName,
  sha256OfBytes,
  sniffMimeType,
  storageKey,
} from './documents.files';
import { documentsPolicy as policy } from './documents.policy';
import * as repo from './documents.repository';

type DocumentRow = typeof schema.documents.$inferSelect;
type VersionRow = {
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
  uploadedByName: string | null;
};

const MB = 1024 * 1024;

const toVersion = (v: VersionRow): DocumentVersion => ({
  version: v.version,
  fileName: v.fileName,
  mimeType: v.mimeType as DocumentMimeType,
  sizeBytes: v.sizeBytes,
  sha256: v.sha256,
  uploadedAt: v.uploadedAt.toISOString(),
  uploadedByName: v.uploadedByName,
});

const toDocument = (d: DocumentRow, current: VersionRow): Document => ({
  id: d.id,
  employeeId: d.employeeId,
  category: d.category,
  title: d.title,
  isRestricted: d.isRestricted,
  issueDate: d.issueDate,
  expiryDate: d.expiryDate,
  currentVersion: d.currentVersion,
  status: d.status as Document['status'],
  current: toVersion(current),
  ...stamp(d),
});

const fileTooLarge = (maxMb: number) =>
  new AppError('FILE_TOO_LARGE', 'File too large', `Files may be at most ${maxMb} MB.`);
const unsupportedType = () =>
  new AppError(
    'UNSUPPORTED_FILE_TYPE',
    'Unsupported file type',
    'Upload a PDF, PNG, JPEG or WebP file whose content matches its name.',
  );

/** Checks size, type (magic bytes) and computes the checksum before anything is stored (FR-DOC-004, FR-DOC-005). */
async function prepareFile(deps: Deps, companyId: string, file: File) {
  const maxMb = await getSetting(deps.db, companyId, 'documents.max_upload_mb');
  if (file.size > maxMb * MB) throw fileTooLarge(maxMb);
  if (file.size === 0)
    throw validationFailed([{ path: '/file', code: 'too_small', message: 'The file is empty.' }]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMimeType(bytes.subarray(0, 16));
  if (!mime || !matchesDeclared(mime, file.type, file.name)) throw unsupportedType();
  return {
    bytes,
    mime,
    sizeBytes: bytes.byteLength,
    sha256: await sha256OfBytes(bytes),
    fileName: safeFileName(file.name, mime),
  };
}

function assertDates(issueDate: string | null | undefined, expiryDate: string | null | undefined) {
  if (issueDate && expiryDate && expiryDate < issueDate)
    throw validationFailed([
      { path: '/expiryDate', code: 'date_before_start', message: 'Expiry date is before the issue date.' },
    ]);
}

type Prepared = Awaited<ReturnType<typeof prepareFile>>;

/** Stores the object; private, with a server-generated key and the checksum R2 verifies on write. */
function putObject(deps: Deps, key: string, file: Prepared, documentId: string, version: number) {
  return deps.env.FILES.put(key, file.bytes, {
    httpMetadata: { contentType: file.mime },
    sha256: file.sha256,
    customMetadata: { documentId, version: String(version) },
  });
}

/** Removes an object written by a transaction that did not commit; the transaction's error is what matters. */
async function discardObject(deps: Deps, key: string) {
  try {
    await deps.env.FILES.delete(key);
  } catch {
    console.error(
      JSON.stringify({ level: 'error', requestId: deps.meta.requestId, msg: 'R2 cleanup failed' }),
    );
  }
}

async function createDocument(
  deps: Deps,
  auth: AuthContext,
  employeeId: string | null,
  fields: UploadDocumentFields,
  file: File,
) {
  assertDates(fields.issueDate, fields.expiryDate);
  const prepared = await prepareFile(deps, auth.companyId, file);
  const id = uuidv7();
  const key = storageKey(employeeId, id, 1);
  try {
    await deps.db.transaction(async (tx) => {
      await repo.insertDocument(tx, {
        id,
        companyId: auth.companyId,
        employeeId,
        category: fields.category,
        title: fields.title,
        isRestricted: fields.isRestricted ?? false,
        issueDate: fields.issueDate ?? null,
        expiryDate: fields.expiryDate ?? null,
        currentVersion: 1,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
      await repo.insertVersion(tx, {
        id: uuidv7(),
        documentId: id,
        version: 1,
        storageKey: key,
        fileName: prepared.fileName,
        mimeType: prepared.mime,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        uploadedAt: deps.clock.now(),
        uploadedBy: auth.userId,
      });
      await recordAudit(tx, auth.actor, {
        action: 'document.uploaded',
        category: 'business',
        entityType: 'document',
        entityId: id,
        employeeId,
        metadata: {
          category: fields.category,
          isRestricted: fields.isRestricted ?? false,
          version: 1,
          mimeType: prepared.mime,
          sizeBytes: prepared.sizeBytes,
          sha256: prepared.sha256,
        },
      });
      // Last step inside the transaction: a failed write rolls the rows back.
      await putObject(deps, key, prepared, id, 1);
    });
  } catch (err) {
    await discardObject(deps, key);
    throw err;
  }
  return getDocument(deps, auth, id);
}

// Commands ----------------------------------------------------------------------------------------------------------

export async function uploadEmployeeDocument(
  deps: Deps,
  auth: AuthContext,
  employeeId: string,
  fields: UploadDocumentFields,
  file: File,
) {
  policy.upload(auth, employeeId, fields.category, fields.isRestricted ?? false);
  if (!(await repo.employeeExists(deps.db, auth.companyId, employeeId))) throw notFound();
  return createDocument(deps, auth, employeeId, fields, file);
}

export async function uploadCompanyDocument(
  deps: Deps,
  auth: AuthContext,
  fields: UploadDocumentFields,
  file: File,
) {
  policy.manage(auth);
  return createDocument(deps, auth, null, fields, file);
}

/** A new version; earlier versions stay stored and downloadable (FR-DOC-005, US-DOC-003). */
export async function addVersion(
  deps: Deps,
  auth: AuthContext,
  id: string,
  fields: AddDocumentVersionFields,
  file: File,
) {
  policy.manage(auth);
  const existing = await repo.findById(deps.db, auth.companyId, id);
  if (!existing) throw notFound();
  if (existing.status !== 'active') throw invalidTransition(existing.status, 'add a version');
  assertDates(fields.issueDate ?? existing.issueDate, fields.expiryDate ?? existing.expiryDate);
  const prepared = await prepareFile(deps, auth.companyId, file);
  let key = '';
  try {
    await deps.db.transaction(async (tx) => {
      const doc = await repo.findForUpdate(tx, auth.companyId, id);
      if (!doc) throw notFound();
      if (doc.status !== 'active') throw invalidTransition(doc.status, 'add a version');
      const next = doc.currentVersion + 1;
      key = storageKey(doc.employeeId, doc.id, next);
      await repo.insertVersion(tx, {
        id: uuidv7(),
        documentId: id,
        version: next,
        storageKey: key,
        fileName: prepared.fileName,
        mimeType: prepared.mime,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        uploadedAt: deps.clock.now(),
        uploadedBy: auth.userId,
      });
      await repo.updateDocument(tx, id, {
        currentVersion: next,
        ...(fields.issueDate ? { issueDate: fields.issueDate } : {}),
        ...(fields.expiryDate ? { expiryDate: fields.expiryDate } : {}),
        updatedBy: auth.userId,
        updatedAt: deps.clock.now(),
      });
      await recordAudit(tx, auth.actor, {
        action: 'document.version_added',
        category: 'business',
        entityType: 'document',
        entityId: id,
        employeeId: doc.employeeId,
        metadata: {
          version: next,
          mimeType: prepared.mime,
          sizeBytes: prepared.sizeBytes,
          sha256: prepared.sha256,
          ...(fields.expiryDate ? { expiryDate: { from: doc.expiryDate, to: fields.expiryDate } } : {}),
        },
      });
      await putObject(deps, key, prepared, id, next);
    });
  } catch (err) {
    if (key) await discardObject(deps, key);
    throw err;
  }
  return getDocument(deps, auth, id);
}

/**
 * Retention deletion (FR-DOC-010): the metadata rows stay, marked `deleted` with the reason; every stored version is
 * removed from R2 after the change commits (DATA-MODEL §9).
 */
export async function deleteDocument(deps: Deps, auth: AuthContext, id: string, input: DeleteDocumentInput) {
  const now = deps.clock.now();
  policy.delete(auth, now);
  const keys = await deps.db.transaction(async (tx) => {
    const doc = await repo.findForUpdate(tx, auth.companyId, id);
    if (!doc) throw notFound();
    if (doc.status !== 'active') throw invalidTransition(doc.status, 'delete');
    if (doc.version !== input.version) throw versionConflict();
    const versions = await repo.listVersions(tx, id);
    await repo.updateDocument(tx, id, {
      status: 'deleted',
      deletedAt: now,
      deletedReason: input.reason,
      updatedBy: auth.userId,
      updatedAt: now,
    });
    await recordAudit(tx, auth.actor, {
      action: 'document.deleted',
      category: 'business',
      entityType: 'document',
      entityId: id,
      employeeId: doc.employeeId,
      metadata: { category: doc.category, versions: versions.length, reason: input.reason },
    });
    return versions.map((v) => v.storageKey);
  });
  if (keys.length) await deps.env.FILES.delete(keys);
  return getDocument(deps, auth, id);
}

// Reads -------------------------------------------------------------------------------------------------------------

function toPage(rows: Awaited<ReturnType<typeof repo.listEmployeeDocuments>>, q: DocumentListQuery) {
  return {
    data: rows.map((r) => toDocument(r.document, r.current)),
    page: pageMeta(q, Number(rows[0]?.total ?? 0)),
  };
}

export async function listEmployeeDocuments(
  deps: Deps,
  auth: AuthContext,
  employeeId: string,
  q: DocumentListQuery,
) {
  const access = policy.listEmployeeDocuments(auth, employeeId);
  if (!(await repo.employeeExists(deps.db, auth.companyId, employeeId))) throw notFound();
  const rows = await repo.listEmployeeDocuments(deps.db, employeeId, {
    companyId: auth.companyId,
    access,
    category: q.category,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  return toPage(rows, q);
}

/** Company-wide documents (`employee_id` NULL): any session sees the `policy` category (API-CATALOGUE §9). */
export async function listCompanyDocuments(deps: Deps, auth: AuthContext, q: DocumentListQuery) {
  const rows = await repo.listCompanyDocuments(deps.db, {
    companyId: auth.companyId,
    access: policy.readAccess(auth),
    category: q.category,
    limit: q.pageSize,
    offset: pageOffset(q),
  });
  return toPage(rows, q);
}

export async function getDocument(deps: Deps, auth: AuthContext, id: string): Promise<DocumentDetail> {
  const doc = await repo.findVisible(deps.db, auth.companyId, id, policy.readAccess(auth));
  if (!doc) throw notFound();
  const versions = await repo.listVersions(deps.db, id);
  const current = versions.find((v) => v.version === doc.currentVersion);
  if (!current) throw notFound();
  return {
    ...toDocument(doc, current),
    versions: versions.map(toVersion),
    deletedAt: doc.deletedAt?.toISOString() ?? null,
    deletedReason: doc.deletedReason,
  };
}

/**
 * Streams one version as an attachment (FR-DOC-003, FR-DOC-008). Access is audited for restricted categories, for
 * documents flagged restricted, and whenever the reader is not the subject employee (AUDIT.md §3, FR-DOC-007).
 */
export async function downloadDocument(deps: Deps, auth: AuthContext, id: string, version?: number) {
  const doc = await repo.findVisible(deps.db, auth.companyId, id, policy.readAccess(auth));
  if (!doc || doc.status !== 'active') throw notFound();
  const wanted = version ?? doc.currentVersion;
  const row = await repo.findVersion(deps.db, id, wanted);
  if (!row) throw notFound();
  const object = await deps.env.FILES.get(row.storageKey);
  if (!object) {
    console.error(
      JSON.stringify({ level: 'error', requestId: deps.meta.requestId, msg: 'R2 object missing' }),
    );
    throw notFound();
  }
  const restricted = (RESTRICTED_DOCUMENT_CATEGORIES as readonly string[]).includes(doc.category);
  const isSubject = doc.employeeId !== null && doc.employeeId === auth.employeeId;
  if (restricted || doc.isRestricted || !isSubject) {
    await recordAudit(deps.db, auth.actor, {
      action: 'document.downloaded',
      category: 'business',
      entityType: 'document',
      entityId: id,
      employeeId: doc.employeeId,
      metadata: { category: doc.category, version: wanted, bySubject: isSubject },
    });
  }
  return {
    body: object.body,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(row.sizeBytes),
      'Content-Disposition': contentDisposition(row.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  };
}
