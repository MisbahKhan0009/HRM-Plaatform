import { createRoute, z } from '@hono/zod-openapi';
import {
  AddDocumentVersionFieldsSchema,
  DeleteDocumentInputSchema,
  DocumentDetailSchema,
  DocumentDownloadQuerySchema,
  DocumentListQuerySchema,
  DocumentSchema,
  IdParamSchema,
  paginated,
  UploadDocumentFieldsSchema,
} from '@hrm/contracts';
import { createMiddleware } from 'hono/factory';
import { jsonBody, jsonContent, problemResponses, SESSION_SECURITY } from '../../lib/openapi';
import { AppError } from '../../lib/problem';
import { rateLimit } from '../../lib/rate-limit';
import { createRouter } from '../../lib/router';
import type { AppEnv } from '../../types';
import * as service from './documents.service';

export const documentRoutes = createRouter();
const tags = ['documents'];
const security = SESSION_SECURITY;

/** Upper bound on the whole multipart body: the 10 MB file limit (ADR-0009) plus room for the text fields. */
const MAX_BODY_BYTES = 10 * 1024 * 1024 + 64 * 1024;
const UPLOADS_PER_WINDOW = 20;
const UPLOAD_WINDOW_SECONDS = 600;

/**
 * Runs before the body is parsed: rejects non-multipart bodies and oversized requests from their headers, and
 * applies the upload rate limit of 20 per 10 minutes per user (API-STANDARDS §10). The service re-checks the file
 * against `documents.max_upload_mb`.
 */
const uploadGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!/^multipart\/form-data\s*;/i.test(c.req.header('content-type') ?? ''))
    throw new AppError('UNSUPPORTED_FILE_TYPE', 'Expected multipart/form-data');
  const length = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES)
    throw new AppError('FILE_TOO_LARGE', 'File too large', 'Files may be at most 10 MB.');
  const { deps, auth } = c.var;
  await rateLimit(
    deps.db,
    `upload:${auth.userId}`,
    UPLOADS_PER_WINDOW,
    UPLOAD_WINDOW_SECONDS,
    deps.clock.now(),
  );
  await next();
});

const FileSchema = z
  .custom<File>((v) => v instanceof File, { message: 'A file is required.' })
  .openapi({ type: 'string', format: 'binary' });

const multipart = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'multipart/form-data': { schema } },
});

const UploadFormSchema = UploadDocumentFieldsSchema.extend({ file: FileSchema });
const VersionFormSchema = AddDocumentVersionFieldsSchema.extend({ file: FileSchema });
const uploadErrors = problemResponses(400, 401, 403, 404, 413, 415, 429);

documentRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/employees/{id}/documents',
    operationId: 'employeeDocuments.list',
    tags,
    security,
    'x-permission': 'document.read.all | document.read.own | document.payroll.read',
    request: { params: IdParamSchema, query: DocumentListQuerySchema },
    responses: {
      200: jsonContent(paginated(DocumentSchema), 'Documents of the employee the caller may see'),
      ...problemResponses(400, 401, 403, 404),
    },
  }),
  async (c) =>
    c.json(
      await service.listEmployeeDocuments(
        c.var.deps,
        c.var.auth,
        c.req.valid('param').id,
        c.req.valid('query'),
      ),
      200,
    ),
);

documentRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/employees/{id}/documents',
    operationId: 'employeeDocuments.upload',
    tags,
    security,
    'x-permission': 'document.manage | reimbursement.request.own (own receipts)',
    middleware: [uploadGuard] as const,
    request: { params: IdParamSchema, body: multipart(UploadFormSchema) },
    responses: { 201: jsonContent(DocumentDetailSchema, 'Uploaded'), ...uploadErrors },
  }),
  async (c) => {
    const { file, ...fields } = c.req.valid('form');
    const dto = await service.uploadEmployeeDocument(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      fields,
      file,
    );
    c.header('Location', `/api/v1/documents/${dto.id}`);
    return c.json(dto, 201);
  },
);

documentRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/company/documents',
    operationId: 'companyDocuments.list',
    tags,
    security,
    request: { query: DocumentListQuerySchema },
    responses: {
      200: jsonContent(paginated(DocumentSchema), 'Company documents; any session sees the policy category'),
      ...problemResponses(400, 401),
    },
  }),
  async (c) => c.json(await service.listCompanyDocuments(c.var.deps, c.var.auth, c.req.valid('query')), 200),
);

documentRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/company/documents',
    operationId: 'companyDocuments.upload',
    tags,
    security,
    'x-permission': 'document.manage',
    middleware: [uploadGuard] as const,
    request: { body: multipart(UploadFormSchema) },
    responses: { 201: jsonContent(DocumentDetailSchema, 'Uploaded'), ...uploadErrors },
  }),
  async (c) => {
    const { file, ...fields } = c.req.valid('form');
    const dto = await service.uploadCompanyDocument(c.var.deps, c.var.auth, fields, file);
    c.header('Location', `/api/v1/documents/${dto.id}`);
    return c.json(dto, 201);
  },
);

documentRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/documents/{id}/versions',
    operationId: 'documents.addVersion',
    tags,
    security,
    'x-permission': 'document.manage',
    middleware: [uploadGuard] as const,
    request: { params: IdParamSchema, body: multipart(VersionFormSchema) },
    responses: {
      201: jsonContent(DocumentDetailSchema, 'New version; earlier versions are kept'),
      ...problemResponses(400, 401, 403, 404, 409, 413, 415, 429),
    },
  }),
  async (c) => {
    const { file, ...fields } = c.req.valid('form');
    return c.json(
      await service.addVersion(c.var.deps, c.var.auth, c.req.valid('param').id, fields, file),
      201,
    );
  },
);

documentRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/documents/{id}',
    operationId: 'documents.get',
    tags,
    security,
    'x-permission': 'document.read.all | document.read.own | document.payroll.read',
    request: { params: IdParamSchema },
    responses: {
      200: jsonContent(DocumentDetailSchema, 'Metadata and versions'),
      ...problemResponses(401, 404),
    },
  }),
  async (c) => c.json(await service.getDocument(c.var.deps, c.var.auth, c.req.valid('param').id), 200),
);

documentRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/documents/{id}/download',
    operationId: 'documents.download',
    tags,
    security,
    'x-permission': 'document.read.all | document.read.own | document.payroll.read',
    request: { params: IdParamSchema, query: DocumentDownloadQuerySchema },
    responses: {
      200: {
        description: 'The file, as an attachment',
        content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      ...problemResponses(400, 401, 404),
    },
  }),
  async (c) => {
    const file = await service.downloadDocument(
      c.var.deps,
      c.var.auth,
      c.req.valid('param').id,
      c.req.valid('query').version,
    );
    return c.body(file.body, 200, file.headers);
  },
);

documentRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/documents/{id}/delete',
    operationId: 'documents.delete',
    tags,
    security,
    'x-permission': 'document.manage (fresh)',
    request: { params: IdParamSchema, body: jsonBody(DeleteDocumentInputSchema) },
    responses: {
      200: jsonContent(DocumentDetailSchema, 'Deleted; metadata kept, stored files removed'),
      ...problemResponses(400, 401, 403, 404, 409),
    },
  }),
  async (c) =>
    c.json(
      await service.deleteDocument(c.var.deps, c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      200,
    ),
);
