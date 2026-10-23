import type {
  ContractType,
  EmploymentEventType,
  ImportField,
  ProfileChangeField,
  ProfileChangeRequest,
} from '@hrm/contracts';
import { formatDate } from '../../lib/format';

// Display labels for employee enums (CONTENT-STYLE §5: "Separation", never "termination" unless that is the type).

export const EVENT_LABEL: Record<EmploymentEventType, string> = {
  hired: 'Hired',
  confirmed: 'Confirmed after probation',
  promoted: 'Promoted',
  transferred: 'Transferred',
  manager_changed: 'Manager changed',
  position_changed: 'Position changed',
  salary_changed: 'Salary changed',
  status_changed: 'Status changed',
  separated: 'Separation',
  rehired: 'Rehired',
};

export const MANUAL_EVENT_LABEL = {
  promoted: 'Promotion',
  transferred: 'Transfer to another department',
  manager_changed: 'Manager change',
  position_changed: 'Position change',
} as const;

export const SEPARATION_TYPE_LABEL = {
  resignation: 'Resignation',
  termination: 'Termination',
  contract_end: 'End of contract',
  retirement: 'Retirement',
  death: 'Death',
  other: 'Other',
} as const;

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  permanent: 'Permanent',
  probation: 'Probation',
  fixed_term: 'Fixed term',
  intern: 'Internship',
  consultant: 'Consultant',
};

export const CONTRACT_STATUS_LABEL = {
  draft: 'Draft',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Ended early',
  superseded: 'Superseded',
} as const;

export const GENDER_LABEL = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  undisclosed: 'Prefer not to say',
} as const;

export const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  joiningDate: 'Joining date',
  probationEndDate: 'Probation end',
  separationDate: 'Last working day',
  separationType: 'Exit type',
  departmentId: 'Department',
  positionId: 'Position',
  managerId: 'Manager',
};

export const PROFILE_FIELD_LABEL: Record<ProfileChangeField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  preferredName: 'Preferred name',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  personalEmail: 'Personal email',
  personalPhone: 'Personal phone',
  presentAddress: 'Present address',
  permanentAddress: 'Permanent address',
  nationalIdNumber: 'National ID number',
  emergencyContacts: 'Emergency contacts',
};

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  employeeCode: 'Employee code',
  firstName: 'First name',
  lastName: 'Last name',
  preferredName: 'Preferred name',
  workEmail: 'Work email',
  workPhone: 'Work phone',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  departmentCode: 'Department code',
  positionTitle: 'Position title',
  managerCode: 'Manager code',
  joiningDate: 'Joining date',
  probationEndDate: 'Probation end date',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A requested or recorded value as text: dates formatted, enums labelled, emergency contacts listed. */
export function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'gender' && typeof value === 'string')
    return GENDER_LABEL[value as keyof typeof GENDER_LABEL] ?? value;
  if (field === 'separationType' && typeof value === 'string')
    return SEPARATION_TYPE_LABEL[value as keyof typeof SEPARATION_TYPE_LABEL] ?? value;
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    return value
      .map((c) => {
        const e = c as { name?: string; relationship?: string; phone?: string };
        return `${e.name ?? ''} (${e.relationship ?? ''}) ${e.phone ?? ''}`.trim();
      })
      .join('; ');
  }
  if (typeof value === 'string' && ISO_DATE.test(value)) return formatDate(value);
  return String(value);
}

/** "Contact details" or "Identity" summary of a request, for lists. */
export function profileChangeSummary(r: ProfileChangeRequest) {
  return Object.keys(r.changes)
    .map((f) => PROFILE_FIELD_LABEL[f as ProfileChangeField] ?? f)
    .join(', ');
}
