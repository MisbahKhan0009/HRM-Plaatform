import { Input, Select } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { todayIso } from '../../lib/format';
import { orgQueries } from '../organization/api';
import { FilterField } from './ReportView';

export { currentMonth } from './search';

export function DepartmentFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const departments = useQuery(orgQueries.departments());
  return (
    <FilterField label="Department">
      {(id) => (
        <Select
          id={id}
          className="w-52"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">All departments</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
    </FilterField>
  );
}

export function DateFilter({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  min?: string | undefined;
  max?: string | undefined;
}) {
  return (
    <FilterField label={label}>
      {(id) => (
        <Input
          id={id}
          type="date"
          className="w-44"
          value={value ?? ''}
          {...(min ? { min } : {})}
          {...(max ? { max } : {})}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      )}
    </FilterField>
  );
}

export function YearFilter({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const thisYear = Number(todayIso().slice(0, 4));
  return (
    <FilterField label="Year">
      {(id) => (
        <Select id={id} className="w-28" value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      )}
    </FilterField>
  );
}
