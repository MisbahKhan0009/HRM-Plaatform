import type {
  Company,
  CreateDepartmentInput,
  CreateHolidayInput,
  CreatePositionInput,
  CreateWorkScheduleInput,
  Department,
  Holiday,
  Position,
  UpdateCompanyInput,
  UpdateDepartmentInput,
  UpdateHolidayInput,
  UpdatePositionInput,
  UpdateWorkScheduleInput,
  WorkSchedule,
} from '@hrm/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

type List<T> = { data: T[] };

export const orgQueries = {
  all: () => ['organization'] as const,
  company: () =>
    queryOptions({ queryKey: ['organization', 'company'], queryFn: () => api.get<Company>('/company') }),
  departments: (includeInactive = false) =>
    queryOptions({
      queryKey: ['organization', 'departments', { includeInactive }],
      queryFn: () =>
        api.get<List<Department>>('/departments', { query: { includeInactive } }).then((r) => r.data),
    }),
  positions: (includeInactive = false) =>
    queryOptions({
      queryKey: ['organization', 'positions', { includeInactive }],
      queryFn: () =>
        api.get<List<Position>>('/positions', { query: { includeInactive } }).then((r) => r.data),
    }),
  schedules: () =>
    queryOptions({
      queryKey: ['organization', 'work-schedules'],
      queryFn: () => api.get<List<WorkSchedule>>('/work-schedules').then((r) => r.data),
    }),
  holidays: (year: number) =>
    queryOptions({
      queryKey: ['organization', 'holidays', year],
      queryFn: () => api.get<List<Holiday>>('/holidays', { query: { year } }).then((r) => r.data),
    }),
};

function useOrgMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgQueries.all() }),
  });
}

export const useUpdateCompany = () =>
  useOrgMutation((v: UpdateCompanyInput) => api.patch<Company>('/company', v));
export const useSaveDepartment = () =>
  useOrgMutation((v: { id?: string; create?: CreateDepartmentInput; update?: UpdateDepartmentInput }) =>
    v.id
      ? api.patch<Department>(`/departments/${v.id}`, v.update)
      : api.post<Department>('/departments', v.create),
  );
export const useSavePosition = () =>
  useOrgMutation((v: { id?: string; create?: CreatePositionInput; update?: UpdatePositionInput }) =>
    v.id ? api.patch<Position>(`/positions/${v.id}`, v.update) : api.post<Position>('/positions', v.create),
  );
export const useSaveSchedule = () =>
  useOrgMutation((v: { id?: string; create?: CreateWorkScheduleInput; update?: UpdateWorkScheduleInput }) =>
    v.id
      ? api.patch<WorkSchedule>(`/work-schedules/${v.id}`, v.update)
      : api.post<WorkSchedule>('/work-schedules', v.create),
  );
export const useSaveHoliday = () =>
  useOrgMutation((v: { id?: string; create?: CreateHolidayInput; update?: UpdateHolidayInput }) =>
    v.id ? api.patch<Holiday>(`/holidays/${v.id}`, v.update) : api.post<Holiday>('/holidays', v.create),
  );
export const useDeleteHoliday = () => useOrgMutation((id: string) => api.del(`/holidays/${id}`));

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
