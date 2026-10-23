import type { leaveRequestStatusValues } from '@hrm/contracts';
import { todayIso } from '../../lib/format';
import { yearRange } from './format';

// Route search helpers live outside the page modules so route configs don't pull pages into the main chunk.

type RequestStatus = (typeof leaveRequestStatusValues)[number];

export const thisLeaveYear = () => Number(todayIso().slice(0, 4));

export function myRequestParams(
  employeeId: string,
  s: { year: number; status?: RequestStatus | undefined; page: number; pageSize: number },
) {
  return { employeeId, status: s.status, page: s.page, pageSize: s.pageSize, ...yearRange(s.year) };
}

interface ManageSearch {
  year: number;
  status?: RequestStatus | undefined;
  leaveTypeId?: string | undefined;
  employeeId?: string | undefined;
  page: number;
  pageSize: number;
}

export const manageRequestParams = (s: ManageSearch) => ({
  status: s.status,
  leaveTypeId: s.leaveTypeId,
  employeeId: s.employeeId,
  page: s.page,
  pageSize: s.pageSize,
  ...yearRange(s.year),
});

export const manageBalanceParams = (s: ManageSearch) => ({
  year: s.year,
  leaveTypeId: s.leaveTypeId,
  employeeId: s.employeeId,
  page: s.page,
  pageSize: s.pageSize,
});
