import type { HealthDetails, JobRunResult, RunJobInput } from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export const systemQueries = {
  all: () => ['system'] as const,
  health: () =>
    queryOptions({
      queryKey: [...systemQueries.all(), 'health'],
      queryFn: () => api.get<HealthDetails>('/health/details'),
      refetchInterval: 60_000,
    }),
};

export function useRunJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { job: string; input: RunJobInput }) =>
      api.post<JobRunResult>(`/admin/jobs/${v.job}/run`, v.input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: systemQueries.all() }),
  });
}

/**
 * Daily steps the dispatcher runs (JOBS-AND-OUTBOX §3). The API lists only jobs that have run, so steps that never
 * ran are added from this list to keep them runnable by hand.
 */
export const DAILY_JOBS = ['attendance.close_day', 'maintenance.prune'] as const;

/** Seconds → `45 s`, `12 min`, `3 h`, `2 days`. */
export function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** Duration between two instants, `0.4 s` or `2 min 5 s`. */
export function formatRunDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return null;
  const ms = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}
