import { genderValues } from '@hrm/contracts';
import { Input, Select } from '@hrm/ui';
import type { Control } from 'react-hook-form';
import { FormField } from '../../../lib/forms';
import type { EmployeeFormInput } from '../forms';
import { GENDER_LABEL } from '../labels';
import { type EmployeeOption, EmployeePicker } from './employee-picker';
import { DepartmentPicker, PositionPicker } from './org-pickers';

type Section = 'identity' | 'employment' | 'work-contact';

type Props = {
  control: Control<EmployeeFormInput>;
  section: Section;
  /** Fields required by `employees.required_fields`; the rest are marked optional. */
  required: readonly string[];
  /** The employee being edited, so they can't be picked as their own manager. */
  selfId?: string | undefined;
  manager?: EmployeeOption | null | undefined;
};

const grid = 'grid gap-4 sm:grid-cols-2';

/** One section of the employee form (create page and edit dialog share it). */
export function EmployeeFormFields({ control: c, section, required, selfId, manager }: Props) {
  const optional = (f: string) => !required.includes(f);
  if (section === 'identity') {
    return (
      <div className={grid}>
        <FormField control={c} name="firstName" label="First name" render={(p) => <Input {...p} />} />
        <FormField control={c} name="lastName" label="Last name" render={(p) => <Input {...p} />} />
        <FormField
          control={c}
          name="preferredName"
          label="Preferred name"
          optional
          hint="Shown instead of the full name where space is short."
          render={(p) => <Input {...p} />}
        />
        <FormField
          control={c}
          name="dateOfBirth"
          label="Date of birth"
          optional
          render={(p) => <Input type="date" {...p} />}
        />
        <FormField
          control={c}
          name="gender"
          label="Gender"
          optional
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
              <option value="">Not recorded</option>
              {genderValues.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </Select>
          )}
        />
      </div>
    );
  }
  if (section === 'work-contact') {
    return (
      <div className={grid}>
        <FormField
          control={c}
          name="workEmail"
          label="Work email"
          optional={optional('workEmail')}
          hint="Used for the sign-in invitation."
          render={(p) => <Input type="email" autoComplete="off" {...p} />}
        />
        <FormField
          control={c}
          name="workPhone"
          label="Work phone"
          optional
          render={(p) => <Input type="tel" autoComplete="off" {...p} />}
        />
      </div>
    );
  }
  return (
    <div className={grid}>
      <FormField
        control={c}
        name="departmentId"
        label="Department"
        optional={optional('departmentId')}
        render={(p) => <DepartmentPicker {...p} value={p.value} onChange={(id) => p.onChange(id ?? '')} />}
      />
      <FormField
        control={c}
        name="positionId"
        label="Position"
        optional={optional('positionId')}
        render={(p) => <PositionPicker {...p} value={p.value} onChange={(id) => p.onChange(id ?? '')} />}
      />
      <FormField
        control={c}
        name="managerId"
        label="Manager"
        optional={optional('managerId')}
        render={(p) => (
          <EmployeePicker
            {...p}
            value={p.value}
            selected={manager}
            exclude={selfId ? [selfId] : undefined}
            onChange={(id) => p.onChange(id ?? '')}
          />
        )}
      />
      <FormField
        control={c}
        name="joiningDate"
        label="Joining date"
        optional={optional('joiningDate')}
        render={(p) => <Input type="date" {...p} />}
      />
      <FormField
        control={c}
        name="probationEndDate"
        label="Probation end date"
        optional
        hint="Leave empty when there is no probation."
        render={(p) => <Input type="date" {...p} />}
      />
    </div>
  );
}
