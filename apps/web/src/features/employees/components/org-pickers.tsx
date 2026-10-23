import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { orgQueries } from '../../organization';
import { Combobox, type ComboboxOption } from './combobox';

type PickerProps = {
  id?: string | undefined;
  name?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  onBlur?: (() => void) | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
};

const matches = (q: string, o: ComboboxOption) =>
  `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());

function LocalPicker({
  options,
  loading,
  emptyText,
  value,
  onChange,
  placeholder = 'Type to search',
  ...rest
}: PickerProps & { options: ComboboxOption[]; loading: boolean; emptyText: string }) {
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  return (
    <Combobox
      {...rest}
      placeholder={placeholder}
      hasValue={Boolean(value)}
      selectedLabel={selected?.label ?? (loading ? 'Loading…' : '')}
      options={query ? options.filter((o) => matches(query, o)) : options}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      emptyText={emptyText}
      onSelect={(o) => onChange(o?.value ?? null)}
    />
  );
}

/** Active departments, searchable by name or code. */
export function DepartmentPicker(props: PickerProps) {
  const list = useQuery(orgQueries.departments());
  const options = (list.data ?? []).map((d) => ({ value: d.id, label: d.name, hint: d.code }));
  return (
    <LocalPicker {...props} options={options} loading={list.isPending} emptyText="No departments match." />
  );
}

/** Active positions, searchable by title or grade. */
export function PositionPicker(props: PickerProps) {
  const list = useQuery(orgQueries.positions());
  const options = (list.data ?? []).map((p) => ({
    value: p.id,
    label: p.title,
    hint: p.grade ? `Grade ${p.grade}` : undefined,
  }));
  return (
    <LocalPicker {...props} options={options} loading={list.isPending} emptyText="No positions match." />
  );
}
