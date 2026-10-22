import { z } from 'zod';

export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('hrm-api'),
  version: z.string(),
  time: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;

const outboxStatusValues = ['pending', 'processing', 'sent', 'failed', 'dead'] as const;

/** `GET /health/details` (FR-SET-004, JOBS-AND-OUTBOX §6). */
export const HealthDetailsSchema = z.object({
  time: z.string(),
  database: z.object({ ok: z.boolean(), latencyMs: z.number().int() }),
  /** Latest run of each job for the caller's company. */
  jobs: z.array(
    z.object({
      job: z.string(),
      runKey: z.string(),
      status: z.enum(['running', 'succeeded', 'failed']),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      items: z.number().int(),
    }),
  ),
  outbox: z.object({
    counts: z.record(z.enum(outboxStatusValues), z.number().int()),
    /** Age in seconds of the oldest `pending` or `failed` message; null when there is none. */
    oldestPendingAgeSeconds: z.number().int().nullable(),
  }),
  /** Email deliveries since 00:00 Asia/Dhaka today. */
  emailsToday: z.object({ sent: z.number().int(), failed: z.number().int() }),
});
export type HealthDetails = z.infer<typeof HealthDetailsSchema>;

export const JobParamSchema = z.object({ job: z.string().regex(/^[a-z_]+\.[a-z_]+$/) });

/** `POST /admin/jobs/{job}/run`: `date` is the business date the step runs for (default today, Asia/Dhaka). */
export const RunJobInputSchema = z
  .object({
    runKey: z
      .string()
      .regex(/^[A-Za-z0-9:._-]{1,64}$/)
      .optional(),
    date: z.iso.date().optional(),
  })
  .strict();
export type RunJobInput = z.infer<typeof RunJobInputSchema>;

export const JobRunResultSchema = z.object({
  job: z.string(),
  runKey: z.string(),
  /** `skipped`: a run with this key already succeeded (JOBS-AND-OUTBOX §4). */
  outcome: z.enum(['succeeded', 'skipped', 'failed']),
  status: z.enum(['running', 'succeeded', 'failed']),
  items: z.number().int(),
  details: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});
export type JobRunResult = z.infer<typeof JobRunResultSchema>;
