import { z } from 'zod';
import { PageMetaSchema } from './primitives';

export const UuidSchema = z.uuid();

/** Path parameter `{id}` for by-id routes. */
export const IdParamSchema = z.object({ id: UuidSchema });

/** Paginated list envelope `{ data, page }` (API-STANDARDS §5). */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), page: PageMetaSchema });

/** Optimistic-lock version sent with every edit and transition (API-STANDARDS §8). */
export const VersionSchema = z.number().int().positive();

/** A trimmed, bounded comment; required on rejections. */
export const CommentSchema = z.string().trim().min(1).max(1000);

/** Body of an approve/withdraw action: optional comment plus the version the client read. */
export const DecisionInputSchema = z
  .object({ comment: CommentSchema.optional(), version: VersionSchema })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

/** Body of a reject action: the comment is required (FR-WF-003). */
export const RejectInputSchema = z.object({ comment: CommentSchema, version: VersionSchema }).strict();
export type RejectInput = z.infer<typeof RejectInputSchema>;

/** Comma-separated multi-value query filter (`status=active,probation`). */
export const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1).max(values.length));
