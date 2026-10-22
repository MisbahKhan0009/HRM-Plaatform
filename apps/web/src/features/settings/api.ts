import type { SettingsGroups, UpdateSettingsInput } from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

export const settingsQueries = {
  all: () => ['settings'] as const,
  values: () =>
    queryOptions({
      queryKey: [...settingsQueries.all(), 'values'],
      queryFn: () => api.get<SettingsGroups>('/settings'),
    }),
};

/** `PATCH /settings` with per-key versions; the response is the full set, so it replaces the cache. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: UpdateSettingsInput) => api.patch<SettingsGroups>('/settings', v),
    onSuccess: (data) => queryClient.setQueryData(settingsQueries.values().queryKey, data),
    onError: () => queryClient.invalidateQueries({ queryKey: settingsQueries.all() }),
  });
}
