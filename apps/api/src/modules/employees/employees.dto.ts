import type {
  EmployeeBasic,
  EmployeeContact,
  EmployeeDetail,
  EmployeeFull,
  EmployeeSelf,
  EmploymentContract,
  EmploymentEvent,
  ProfileChangeRequest,
} from '@hrm/contracts';
import { isoOrNull, stamp } from '../../lib/dto';
import type { EmployeeView } from './employees.policy';
import type {
  ContactRow,
  ContractRow,
  EmployeeDetailRow,
  EmployeeListRow,
  EventRow,
  ProfileChangeListRow,
} from './employees.repository';

// Explicit mappers per permission (SECURITY-MODEL §5): a database row is never serialized, salary never appears.

type Basic = Omit<EmployeeBasic, 'view'>;

const displayName = (r: { preferredName: string | null; firstName: string; lastName: string }) =>
  `${r.preferredName ?? r.firstName} ${r.lastName}`;

function basicFields(r: {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  status: EmployeeBasic['status'];
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionTitle: string | null;
  managerId: string | null;
  managerName: string | null;
  joiningDate: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): Basic {
  return {
    id: r.id,
    employeeCode: r.employeeCode,
    firstName: r.firstName,
    lastName: r.lastName,
    preferredName: r.preferredName,
    displayName: displayName(r),
    workEmail: r.workEmail,
    workPhone: r.workPhone,
    status: r.status,
    department: r.departmentId ? { id: r.departmentId, name: r.departmentName ?? '' } : null,
    position: r.positionId ? { id: r.positionId, title: r.positionTitle ?? '' } : null,
    manager: r.managerId ? { id: r.managerId, name: r.managerName ?? '' } : null,
    joiningDate: r.joiningDate,
    ...stamp(r),
  };
}

export const toEmployeeBasicFromList = (r: EmployeeListRow): EmployeeBasic => ({
  view: 'basic',
  ...basicFields(r),
});

export function toEmployeeDetail(row: EmployeeDetailRow, view: EmployeeView): EmployeeDetail {
  const e = row.employee;
  const basic = basicFields({
    ...e,
    departmentName: row.departmentName,
    positionTitle: row.positionTitle,
    managerName: row.managerName,
  });
  if (view === 'basic') return { view: 'basic', ...basic };
  const personal = {
    dateOfBirth: e.dateOfBirth,
    gender: e.gender as EmployeeSelf['gender'],
    probationEndDate: e.probationEndDate,
    separationDate: e.separationDate,
  };
  if (view === 'self') return { view: 'self', ...basic, ...personal } satisfies EmployeeSelf;
  return {
    view: 'full',
    ...basic,
    ...personal,
    separationType: e.separationType as EmployeeFull['separationType'],
    archivedAt: isoOrNull(e.archivedAt),
    account: e.userId && row.userStatus ? { userId: e.userId, status: row.userStatus } : null,
  } satisfies EmployeeFull;
}

export function toContact(employeeId: string, r: ContactRow | null): EmployeeContact {
  return {
    employeeId,
    personalEmail: r?.personalEmail ?? null,
    personalPhone: r?.personalPhone ?? null,
    presentAddress: r?.presentAddress ?? null,
    permanentAddress: r?.permanentAddress ?? null,
    nationalIdNumber: r?.nationalIdNumber ?? null,
    emergencyContacts: (r?.emergencyContacts as EmployeeContact['emergencyContacts'] | undefined) ?? [],
    version: r?.version ?? 0,
    updatedAt: r ? r.updatedAt.toISOString() : null,
  };
}

export const toEvent = (r: EventRow, creatorName: string | null): EmploymentEvent => ({
  id: r.id,
  employeeId: r.employeeId,
  type: r.type,
  effectiveDate: r.effectiveDate,
  status: r.status as EmploymentEvent['status'],
  changes: r.changes as EmploymentEvent['changes'],
  reason: r.reason,
  appliedAt: isoOrNull(r.appliedAt),
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy ? { id: r.createdBy, name: creatorName ?? '' } : null,
});

export const toContract = (r: ContractRow): EmploymentContract => ({
  id: r.id,
  employeeId: r.employeeId,
  type: r.type,
  startDate: r.startDate,
  endDate: r.endDate,
  status: r.status as EmploymentContract['status'],
  documentId: r.documentId,
  notes: r.notes,
  ...stamp(r),
});

export const toProfileChange = (r: ProfileChangeListRow): ProfileChangeRequest => ({
  id: r.request.id,
  employee: { id: r.request.employeeId, name: r.employeeName, employeeCode: r.employeeCode },
  status: r.request.status as ProfileChangeRequest['status'],
  changes: r.request.changes as ProfileChangeRequest['changes'],
  reason: r.request.reason,
  decidedAt: isoOrNull(r.request.decidedAt),
  decisionComment: r.request.decisionComment,
  ...stamp(r.request),
});
