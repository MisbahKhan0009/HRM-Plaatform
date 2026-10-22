import { z } from 'zod';
import { VersionSchema } from './common';
import { IsoDateSchema, PageQuerySchema } from './primitives';

// Documents (API-CATALOGUE §9, FR-DOC-001…010, DATA-MODEL §9).

export const documentCategoryValues = [
  'identity',
  'contract',
  'certificate',
  'payslip',
  'receipt',
  'policy',
  'other',
] as const;
export const DocumentCategorySchema = z.enum(documentCategoryValues);
export type DocumentCategory = z.infer<typeof DocumentCategorySchema>;

/** Categories whose every download is audited, also by the subject employee (AUDIT.md §3, FR-DOC-007). */
export const RESTRICTED_DOCUMENT_CATEGORIES = [
  'identity',
  'contract',
  'payslip',
] as const satisfies readonly DocumentCategory[];

/** Upload allow-list (FR-DOC-004, ARCHITECTURE §5); checked against magic bytes, not only the declared type. */
export const documentMimeTypeValues = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type DocumentMimeType = (typeof documentMimeTypeValues)[number];

export const documentStatusValues = ['active', 'deleted'] as const;

const auditFields = { version: z.number().int(), createdAt: z.string(), updatedAt: z.string() };

export const DocumentVersionSchema = z.object({
  version: z.number().int(),
  fileName: z.string(),
  mimeType: z.enum(documentMimeTypeValues),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedAt: z.string(),
  uploadedByName: z.string().nullable(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

/** A document as listed: metadata plus the current version's file facts. No storage key is ever returned. */
export const DocumentSchema = z.object({
  id: z.uuid(),
  /** `null` for a company document. */
  employeeId: z.uuid().nullable(),
  category: DocumentCategorySchema,
  title: z.string(),
  isRestricted: z.boolean(),
  issueDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  currentVersion: z.number().int(),
  status: z.enum(documentStatusValues),
  current: DocumentVersionSchema,
  ...auditFields,
});
export type Document = z.infer<typeof DocumentSchema>;

/** `GET /documents/{id}`: metadata and every version, newest first (FR-DOC-005). */
export const DocumentDetailSchema = DocumentSchema.extend({
  versions: z.array(DocumentVersionSchema),
  deletedAt: z.string().nullable(),
  deletedReason: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const DocumentListQuerySchema = PageQuerySchema.extend({
  category: DocumentCategorySchema.optional(),
}).strict();
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

/** Optional multipart text field: an empty string means "not given". */
const optionalField = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const formBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * Text fields of the multipart upload (`POST /employees/{id}/documents`, `POST /company/documents`). The `file`
 * part is declared by the route, because a file is not a JSON type. Date order is checked by the service, so the
 * route can extend this schema with the file part.
 */
export const UploadDocumentFieldsSchema = z
  .object({
    category: DocumentCategorySchema,
    title: z.string().trim().min(1).max(200),
    issueDate: optionalField(IsoDateSchema),
    expiryDate: optionalField(IsoDateSchema),
    isRestricted: optionalField(formBoolean),
  })
  .strict();
export type UploadDocumentFields = z.infer<typeof UploadDocumentFieldsSchema>;

/** Text fields of `POST /documents/{id}/versions`: a renewed document may carry new dates. */
export const AddDocumentVersionFieldsSchema = z
  .object({
    issueDate: optionalField(IsoDateSchema),
    expiryDate: optionalField(IsoDateSchema),
  })
  .strict();
export type AddDocumentVersionFields = z.infer<typeof AddDocumentVersionFieldsSchema>;

export const DocumentDownloadQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(10_000).optional() })
  .strict();

/** Retention deletion (FR-DOC-010): a reason is required and kept on the document. */
export const DeleteDocumentInputSchema = z
  .object({ reason: z.string().trim().min(5).max(500), version: VersionSchema })
  .strict();
export type DeleteDocumentInput = z.infer<typeof DeleteDocumentInputSchema>;

export const DocumentIdParamSchema = z.object({ id: z.uuid() });
