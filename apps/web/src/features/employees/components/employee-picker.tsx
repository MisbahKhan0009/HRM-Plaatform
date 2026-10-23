import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { employeeQueries } from '../api';
import { Combobox } from './combobox';

export type EmployeeOption = { id: string; name: string; employeeCode?: string | undefined };

export const employeeLabel = (e: EmployeeOption) =>
  e.employeeCode ? `${e.employeeCode} · ${e.name}` : e.name;

export type EmployeePickerProps = {
  id?: string | undefined;
  name?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  /** Selected employee id, or null / empty for none. */
  value: string | null | undefined;
  onChange: (id: string | null, employee: EmployeeOption | null) => void;
  onBlur?: (() => void) | undefined;
  /** The selected employee when the caller already knows it (saves a lookup). */
  selected?: EmployeeOption | null | undefined;
  /** Ids that may not be picked (for example the employee themself as their own manager). */
  exclude?: string[] | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
};

/**
 * Employee combobox (COMPONENT-SPECS §4): searches `GET /employees?q=` in the caller's scope and shows
 * `EMP-0001 · Name`. Needs `employee.read.all` or `employee.read.team`.
 */
export function EmployeePicker({
  value,
  onChange,
  selected,
  exclude,
  placeholder = 'Search name, code or email',
  ...rest
}: EmployeePickerProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<EmployeeOption | null>(null);
  const deferred = useDeferredValue(query.trim());
  const search = useQuery(employeeQueries.search(deferred));
  const known =
    (picked && picked.id === value ? picked : null) ?? (selected && selected.id === value ? selected : null);
  const lookup = useQuery({
    ...employeeQueries.detail(value ?? ''),
    enabled: Boolean(value) && !known?.employeeCode,
  });
  const current: EmployeeOption | null = value
    ? lookup.data
      ? { id: value, name: lookup.data.displayName, employeeCode: lookup.data.employeeCode }
      : (known ?? { id: value, name: 'Selected employee' })
    : null;

  const results = (search.data ?? []).filter((e) => !exclude?.includes(e.id));
  const options =
    deferred.length >= 2
      ? results.map((e) => ({
          value: e.id,
          label: `${e.employeeCode} · ${e.displayName}`,
          hint: [e.position?.title, e.department?.name].filter(Boolean).join(' · ') || undefined,
        }))
      : [];

  return (
    <Combobox
      {...rest}
      placeholder={placeholder}
      hasValue={Boolean(current)}
      selectedLabel={current ? employeeLabel(current) : ''}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={search.isFetching}
      emptyText={
        deferred.length < 2
          ? 'Type at least 2 characters to search.'
          : search.isFetching
            ? 'Searching…'
            : 'No employees match.'
      }
      onSelect={(o) => {
        if (!o) {
          setPicked(null);
          onChange(null, null);
          return;
        }
        const e = results.find((r) => r.id === o.value);
        const option = e ? { id: e.id, name: e.displayName, employeeCode: e.employeeCode } : null;
        setPicked(option);
        onChange(o.value, option);
      }}
    />
  );
}
