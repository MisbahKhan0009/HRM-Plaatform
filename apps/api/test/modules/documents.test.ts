import { env, exports } from 'cloudflare:workers';
import { schema } from '@hrm/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFor, call, type Fixture, json, ORIGIN, setupCompany, type TestUser } from '../harness';

const encoder = new TextEncoder();
const PDF = encoder.encode('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
const SVG = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = encoder.encode('<!doctype html><html><body>hi</body></html>');

interface FilePart {
  bytes: Uint8Array;
  name: string;
  type: string;
}

const pdf = (name = 'contract.pdf'): FilePart => ({ bytes: PDF, name, type: 'application/pdf' });

/** Multipart POST as the browser sends it (the harness `call` only sends JSON). */
function upload(path: string, cookie: string, fields: Record<string, string>, file?: FilePart) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('file', new File([file.bytes as BlobPart], file.name, { type: file.type }));
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: cookie },
      body: form,
    }),
  );
}

async function sha256(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Doc {
  id: string;
  employeeId: string | null;
  category: string;
  title: string;
  isRestricted: boolean;
  currentVersion: number;
  status: string;
  version: number;
  expiryDate: string | null;
  current: { fileName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedByName: string };
  versions: { version: number }[];
}

let f: Fixture;
let hr: TestUser;
let payroll: TestUser;
let emp: TestUser;
let colleague: TestUser;
let nobody: TestUser;
let other: Fixture;

beforeAll(async () => {
  f = await setupCompany('Docs Co');
  hr = await f.signIn({ roles: ['hr_admin'], name: 'Hana HR' });
  payroll = await f.signIn({ roles: ['payroll_officer'] });
  emp = await f.signIn({ employee: true, strong: false });
  colleague = await f.signIn({ employee: true, strong: false });
  nobody = await f.signIn({ strong: false });
  other = await setupCompany('Other Docs Co');
}, 60_000);

/** Uploads are limited to 20 per 10 minutes per user, so HR uploads rotate through fresh HR users. */
let uploads = 0;
let uploader: TestUser;
async function hrCookie() {
  if (uploads++ % 15 === 0) uploader = await f.signIn({ roles: ['hr_admin'], name: 'Hana HR' });
  return uploader.cookie;
}

async function hrUpload(employeeId: string, fields: Record<string, string>, file: FilePart = pdf()) {
  const res = await upload(`/api/v1/employees/${employeeId}/documents`, await hrCookie(), fields, file);
  expect(res.status).toBe(201);
  return json<Doc>(res);
}

describe('upload', () => {
  it('stores the file privately in R2 with a checksum, uploader and audit row', async () => {
    const empId = emp.employeeId as string;
    const res = await upload(
      `/api/v1/employees/${empId}/documents`,
      await hrCookie(),
      {
        category: 'contract',
        title: 'Employment contract',
        issueDate: '2026-01-01',
        expiryDate: '2027-01-01',
      },
      pdf('../../etc/con\u0007tract.pdf'),
    );
    expect(res.status).toBe(201);
    const doc = await json<Doc>(res);
    expect(res.headers.get('Location')).toBe(`/api/v1/documents/${doc.id}`);
    expect(doc).toMatchObject({
      employeeId: empId,
      category: 'contract',
      currentVersion: 1,
      status: 'active',
      expiryDate: '2027-01-01',
    });
    expect(doc.current).toMatchObject({
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.byteLength,
      sha256: await sha256(PDF),
      uploadedByName: 'Hana HR',
    });
    expect(JSON.stringify(doc)).not.toContain('documents/');

    const [version] = await f.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, doc.id));
    expect(version?.storageKey).toBe(`documents/${empId}/${doc.id}/v1`);
    const object = await env.FILES.get(version?.storageKey as string);
    expect(new Uint8Array(await (object as R2ObjectBody).arrayBuffer())).toEqual(PDF);
    expect((await auditFor(f.db, doc.id)).map((a) => a.action)).toEqual(['document.uploaded']);
  });

  it('returns 400 for missing fields, a missing file and dates out of order', async () => {
    const empId = emp.employeeId as string;
    const noTitle = await upload(
      `/api/v1/employees/${empId}/documents`,
      await hrCookie(),
      { category: 'other' },
      pdf(),
    );
    expect(noTitle.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(noTitle)).errors.map((e) => e.path)).toContain(
      '/title',
    );
    const badCategory = await upload(
      `/api/v1/employees/${empId}/documents`,
      await hrCookie(),
      { category: 'secret', title: 'X' },
      pdf(),
    );
    expect(badCategory.status).toBe(400);
    const noFile = await upload(`/api/v1/employees/${empId}/documents`, await hrCookie(), {
      category: 'other',
      title: 'No file',
    });
    expect(noFile.status).toBe(400);
    const dates = await upload(
      `/api/v1/employees/${empId}/documents`,
      await hrCookie(),
      { category: 'identity', title: 'Passport', issueDate: '2026-05-01', expiryDate: '2026-01-01' },
      pdf(),
    );
    expect(dates.status).toBe(400);
    expect((await json<{ errors: { path: string }[] }>(dates)).errors[0]?.path).toBe('/expiryDate');
  });

  it.each([
    ['an .exe renamed to .pdf', { bytes: EXE, name: 'cv.pdf', type: 'application/pdf' }],
    ['an SVG with a script', { bytes: SVG, name: 'logo.svg', type: 'image/svg+xml' }],
    ['HTML declared as image/png', { bytes: HTML, name: 'photo.png', type: 'image/png' }],
    ['a PNG named .pdf', { bytes: PNG, name: 'scan.pdf', type: 'application/pdf' }],
    ['a PDF declared as image/jpeg', { bytes: PDF, name: 'scan.pdf', type: 'image/jpeg' }],
  ])('rejects %s with 415 UNSUPPORTED_FILE_TYPE', async (_label, file) => {
    const res = await upload(
      `/api/v1/employees/${emp.employeeId}/documents`,
      await hrCookie(),
      { category: 'other', title: 'Bad' },
      file,
    );
    expect(res.status).toBe(415);
    expect((await json(res)).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('accepts PNG and JPEG content that matches its name', async () => {
    const png = await hrUpload(
      emp.employeeId as string,
      { category: 'certificate', title: 'Certificate' },
      { bytes: PNG, name: 'cert.png', type: 'image/png' },
    );
    expect(png.current.mimeType).toBe('image/png');
    const jpeg = await hrUpload(
      emp.employeeId as string,
      { category: 'certificate', title: 'Photo' },
      { bytes: JPEG, name: 'photo.JPG', type: 'image/jpg' },
    );
    expect(jpeg.current.mimeType).toBe('image/jpeg');
  });

  it('returns 413 FILE_TOO_LARGE for 10 MB + 1 byte', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    const res = await upload(
      `/api/v1/employees/${emp.employeeId}/documents`,
      await hrCookie(),
      { category: 'other', title: 'Big' },
      { bytes: big, name: 'big.pdf', type: 'application/pdf' },
    );
    expect(res.status).toBe(413);
    expect((await json(res)).code).toBe('FILE_TOO_LARGE');
  });

  it('applies the documents.max_upload_mb setting', async () => {
    const co = await setupCompany('Small Uploads Co');
    await co.db
      .insert(schema.settings)
      .values({ companyId: co.companyId, key: 'documents.max_upload_mb', scope: 'technical', value: 1 })
      .onConflictDoUpdate({ target: [schema.settings.companyId, schema.settings.key], set: { value: 1 } });
    const coHr = await co.signIn({ roles: ['hr_admin'] });
    const target = await co.employee();
    const twoMb = new Uint8Array(2 * 1024 * 1024);
    twoMb.set(PDF);
    const res = await upload(
      `/api/v1/employees/${target}/documents`,
      coHr.cookie,
      { category: 'other', title: 'Two MB' },
      { bytes: twoMb, name: 'two.pdf', type: 'application/pdf' },
    );
    expect(res.status).toBe(413);
  });

  it('rejects a JSON body with 415', async () => {
    const res = await call('POST', `/api/v1/employees/${emp.employeeId}/documents`, {
      cookie: hr.cookie,
      body: { category: 'other', title: 'JSON' },
    });
    expect(res.status).toBe(415);
  });

  it('returns 403 to a user without document.manage or reimbursement.request.own', async () => {
    const res = await upload(
      `/api/v1/employees/${emp.employeeId}/documents`,
      payroll.cookie,
      { category: 'payslip', title: 'Payslip' },
      pdf(),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 for an employee of another company', async () => {
    const theirs = await other.employee();
    const res = await upload(
      `/api/v1/employees/${theirs}/documents`,
      await hrCookie(),
      { category: 'other', title: 'Cross-company' },
      pdf(),
    );
    expect(res.status).toBe(404);
  });

  it('rate-limits uploads to 20 per 10 minutes per user', async () => {
    const co = await setupCompany('Busy Uploads Co');
    const coHr = await co.signIn({ roles: ['hr_admin'] });
    const target = await co.employee();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await upload(
        `/api/v1/employees/${target}/documents`,
        coHr.cookie,
        { category: 'other', title: `Doc ${i}` },
        pdf(),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('employee receipts', () => {
  it('lets an employee upload a receipt for themselves and read it back', async () => {
    const res = await upload(
      `/api/v1/employees/${emp.employeeId}/documents`,
      emp.cookie,
      { category: 'receipt', title: 'Taxi receipt' },
      { bytes: JPEG, name: 'receipt.jpg', type: 'image/jpeg' },
    );
    expect(res.status).toBe(201);
    const doc = await json<Doc>(res);
    expect(doc.isRestricted).toBe(false);
    const read = await call('GET', `/api/v1/documents/${doc.id}`, { cookie: emp.cookie });
    expect(read.status).toBe(200);
  });

  it('returns 403 when an employee uploads another category for themselves', async () => {
    const res = await upload(
      `/api/v1/employees/${emp.employeeId}/documents`,
      emp.cookie,
      { category: 'identity', title: 'My NID' },
      pdf(),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when an employee uploads to a colleague (the URL id is not theirs)', async () => {
    const res = await upload(
      `/api/v1/employees/${colleague.employeeId}/documents`,
      emp.cookie,
      { category: 'receipt', title: 'Not mine' },
      pdf(),
    );
    expect(res.status).toBe(404);
  });
});

describe('read rules', () => {
  let own: Doc;
  let hidden: Doc;
  let payslip: Doc;
  let colleagueDoc: Doc;

  beforeAll(async () => {
    const empId = emp.employeeId as string;
    own = await hrUpload(empId, { category: 'certificate', title: 'Degree' });
    hidden = await hrUpload(empId, { category: 'other', title: 'Investigation note', isRestricted: 'true' });
    payslip = await hrUpload(empId, { category: 'payslip', title: 'Payslip Jan' });
    colleagueDoc = await hrUpload(colleague.employeeId as string, {
      category: 'certificate',
      title: 'Theirs',
    });
  });

  it('shows an employee their own non-restricted documents only', async () => {
    const res = await call('GET', `/api/v1/employees/${emp.employeeId}/documents?pageSize=100`, {
      cookie: emp.cookie,
    });
    expect(res.status).toBe(200);
    const body = await json<{ data: Doc[]; page: { totalItems: number } }>(res);
    const ids = body.data.map((d) => d.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(payslip.id);
    expect(ids).not.toContain(hidden.id);
    expect(body.page.totalItems).toBe(body.data.length);
    expect((await call('GET', `/api/v1/documents/${hidden.id}`, { cookie: emp.cookie })).status).toBe(404);
  });

  it('returns 404 for a colleague’s documents (IDOR)', async () => {
    expect(
      (await call('GET', `/api/v1/employees/${colleague.employeeId}/documents`, { cookie: emp.cookie }))
        .status,
    ).toBe(404);
    expect((await call('GET', `/api/v1/documents/${colleagueDoc.id}`, { cookie: emp.cookie })).status).toBe(
      404,
    );
    expect(
      (await call('GET', `/api/v1/documents/${colleagueDoc.id}/download`, { cookie: emp.cookie })).status,
    ).toBe(404);
    expect(await auditFor(f.db, colleagueDoc.id)).toHaveLength(1);
  });

  it('gives document.payroll.read the payslip category only', async () => {
    const res = await call('GET', `/api/v1/employees/${emp.employeeId}/documents?pageSize=100`, {
      cookie: payroll.cookie,
    });
    const body = await json<{ data: Doc[] }>(res);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((d) => d.category === 'payslip')).toBe(true);
    expect((await call('GET', `/api/v1/documents/${own.id}`, { cookie: payroll.cookie })).status).toBe(404);
    expect((await call('GET', `/api/v1/documents/${payslip.id}`, { cookie: payroll.cookie })).status).toBe(
      200,
    );
  });

  it('shows HR restricted documents and filters by category', async () => {
    const res = await call(
      'GET',
      `/api/v1/employees/${emp.employeeId}/documents?category=other&pageSize=100`,
      {
        cookie: hr.cookie,
      },
    );
    const body = await json<{ data: Doc[] }>(res);
    expect(body.data.map((d) => d.id)).toContain(hidden.id);
    expect(body.data.every((d) => d.category === 'other')).toBe(true);
  });

  it('returns 403 to a user without any document permission and 400 for a bad filter', async () => {
    expect(
      (await call('GET', `/api/v1/employees/${emp.employeeId}/documents`, { cookie: nobody.cookie })).status,
    ).toBe(403);
    expect(
      (
        await call('GET', `/api/v1/employees/${emp.employeeId}/documents?category=nope`, {
          cookie: hr.cookie,
        })
      ).status,
    ).toBe(400);
  });

  it('returns 401 for a signed-out download (no public URL)', async () => {
    expect((await call('GET', `/api/v1/documents/${own.id}/download`)).status).toBe(401);
  });
});

describe('download', () => {
  it('streams the file as an attachment and does not audit the subject reading a normal category', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'certificate', title: 'Course' });
    const res = await call('GET', `/api/v1/documents/${doc.id}/download`, { cookie: emp.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="contract\.pdf"/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect((await auditFor(f.db, doc.id)).map((a) => a.action)).toEqual(['document.uploaded']);
  });

  it('audits the subject downloading a restricted category', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'identity', title: 'NID copy' });
    const res = await call('GET', `/api/v1/documents/${doc.id}/download`, { cookie: emp.cookie });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const rows = await auditFor(f.db, doc.id);
    expect(rows.map((a) => a.action)).toEqual(['document.uploaded', 'document.downloaded']);
    expect(rows[1]?.metadata).toMatchObject({ category: 'identity', version: 1, bySubject: true });
  });

  it('audits any download by someone other than the subject', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'certificate', title: 'Training' });
    const res = await call('GET', `/api/v1/documents/${doc.id}/download`, { cookie: hr.cookie });
    await res.arrayBuffer();
    const rows = await auditFor(f.db, doc.id);
    expect(rows.map((a) => a.action)).toEqual(['document.uploaded', 'document.downloaded']);
    expect(rows[1]?.actorUserId).toBe(hr.userId);
  });
});

describe('versions', () => {
  it('adds version 2, keeps version 1 downloadable to HR, and updates the expiry date', async () => {
    const doc = await hrUpload(emp.employeeId as string, {
      category: 'identity',
      title: 'Passport',
      expiryDate: '2026-12-31',
    });
    const res = await upload(
      `/api/v1/documents/${doc.id}/versions`,
      await hrCookie(),
      { expiryDate: '2036-12-31' },
      { bytes: PNG, name: 'passport.png', type: 'image/png' },
    );
    expect(res.status).toBe(201);
    const updated = await json<Doc>(res);
    expect(updated).toMatchObject({ currentVersion: 2, expiryDate: '2036-12-31', version: 2 });
    expect(updated.versions.map((v) => v.version)).toEqual([2, 1]);

    const v1 = await call('GET', `/api/v1/documents/${doc.id}/download?version=1`, { cookie: hr.cookie });
    expect(v1.status).toBe(200);
    expect(new Uint8Array(await v1.arrayBuffer())).toEqual(PDF);
    const v2 = await call('GET', `/api/v1/documents/${doc.id}/download`, { cookie: hr.cookie });
    expect(v2.headers.get('Content-Type')).toBe('image/png');
    await v2.arrayBuffer();
    const missing = await call('GET', `/api/v1/documents/${doc.id}/download?version=9`, {
      cookie: hr.cookie,
    });
    expect(missing.status).toBe(404);
    expect((await auditFor(f.db, doc.id)).map((a) => a.action)).toEqual([
      'document.uploaded',
      'document.version_added',
      'document.downloaded',
      'document.downloaded',
    ]);
  });

  it('returns 403 to an employee and 404 for another company’s document', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'other', title: 'Policy ack' });
    expect((await upload(`/api/v1/documents/${doc.id}/versions`, emp.cookie, {}, pdf())).status).toBe(403);
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    expect((await upload(`/api/v1/documents/${doc.id}/versions`, otherHr.cookie, {}, pdf())).status).toBe(
      404,
    );
  });
});

describe('retention deletion', () => {
  it('requires a fresh session, a reason and the current version; removes the stored files', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'other', title: 'Old letter' });
    await upload(`/api/v1/documents/${doc.id}/versions`, await hrCookie(), {}, pdf('letter-v2.pdf'));
    const keys = (
      await f.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, doc.id))
    ).map((v) => v.storageKey);
    expect(keys).toHaveLength(2);

    const noReason = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: hr.cookie,
      body: { version: 2 },
    });
    expect(noReason.status).toBe(400);

    const stale = new Date(Date.now() + 30 * 60_000).toISOString();
    const notFresh = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: hr.cookie,
      now: stale,
      body: { reason: 'Retention period ended', version: 2 },
    });
    expect(notFresh.status).toBe(403);
    expect((await json(notFresh)).code).toBe('REAUTH_REQUIRED');

    const conflict = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: hr.cookie,
      body: { reason: 'Retention period ended', version: 1 },
    });
    expect(conflict.status).toBe(409);

    const res = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: hr.cookie,
      body: { reason: 'Retention period ended', version: 2 },
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'deleted', deletedReason: 'Retention period ended' });
    for (const key of keys) expect(await env.FILES.head(key)).toBeNull();
    const audit = (await auditFor(f.db, doc.id)).find((a) => a.action === 'document.deleted');
    expect(audit?.metadata).toMatchObject({ category: 'other', versions: 2 });

    expect((await call('GET', `/api/v1/documents/${doc.id}/download`, { cookie: hr.cookie })).status).toBe(
      404,
    );
    const again = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: hr.cookie,
      body: { reason: 'Retention period ended', version: 3 },
    });
    expect(again.status).toBe(409);
    const listed = await json<{ data: Doc[] }>(
      await call('GET', `/api/v1/employees/${emp.employeeId}/documents?pageSize=100`, { cookie: hr.cookie }),
    );
    expect(listed.data.map((d) => d.id)).not.toContain(doc.id);
  });

  it('returns 403 to a user without document.manage and 404 across companies', async () => {
    const doc = await hrUpload(emp.employeeId as string, { category: 'other', title: 'Keep' });
    const res = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: payroll.cookie,
      body: { reason: 'Not mine to delete', version: 1 },
    });
    expect(res.status).toBe(403);
    const otherHr = await other.signIn({ roles: ['hr_admin'] });
    const cross = await call('POST', `/api/v1/documents/${doc.id}/delete`, {
      cookie: otherHr.cookie,
      body: { reason: 'Cross-company attempt', version: 1 },
    });
    expect(cross.status).toBe(404);
    const [row] = await f.db
      .select({ status: schema.documents.status })
      .from(schema.documents)
      .where(and(eq(schema.documents.id, doc.id)));
    expect(row?.status).toBe('active');
  });
});

describe('company documents', () => {
  it('lets HR upload company documents and shows only the policy category to employees', async () => {
    const policy = await upload(
      '/api/v1/company/documents',
      await hrCookie(),
      { category: 'policy', title: 'Leave policy' },
      pdf('leave-policy.pdf'),
    );
    expect(policy.status).toBe(201);
    const policyDoc = await json<Doc>(policy);
    expect(policyDoc.employeeId).toBeNull();
    const internal = await json<Doc>(
      await upload(
        '/api/v1/company/documents',
        await hrCookie(),
        { category: 'other', title: 'Trade licence' },
        pdf(),
      ),
    );

    const forEmployee = await json<{ data: Doc[] }>(
      await call('GET', '/api/v1/company/documents', { cookie: nobody.cookie }),
    );
    expect(forEmployee.data.map((d) => d.id)).toEqual([policyDoc.id]);
    const forHr = await json<{ data: Doc[] }>(
      await call('GET', '/api/v1/company/documents', { cookie: hr.cookie }),
    );
    expect(forHr.data.map((d) => d.id)).toEqual(expect.arrayContaining([policyDoc.id, internal.id]));

    const dl = await call('GET', `/api/v1/documents/${policyDoc.id}/download`, { cookie: nobody.cookie });
    expect(dl.status).toBe(200);
    await dl.arrayBuffer();
    expect((await call('GET', `/api/v1/documents/${internal.id}`, { cookie: nobody.cookie })).status).toBe(
      404,
    );
  });

  it('returns 403 when a user without document.manage uploads a company document', async () => {
    const res = await upload(
      '/api/v1/company/documents',
      emp.cookie,
      { category: 'policy', title: 'Mine' },
      pdf(),
    );
    expect(res.status).toBe(403);
  });
});
