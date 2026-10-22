import { z } from 'zod';

export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('hrm-api'),
  version: z.string(),
  time: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;
