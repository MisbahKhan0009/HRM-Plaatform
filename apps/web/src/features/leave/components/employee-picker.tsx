import type { EmployeeBasic } from '@hrm/contracts';
import { Button, SearchInput } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/api/client';
import { useDebouncedValue } from '../use-debounced-value';

export type PickedEmployee = { id: string; name: string; code: string };
type Row = Pick<EmployeeBasic, 'id' | 'employeeCode' | 'displayName'>;

/**
 * Small employee search for HR acting on behalf (FORMS-AND-VALIDATION §4: send the id, show code and name). Searches
 * `GET /employees?q=` after two characters; a shared picker in `features/employees` can replace it later.
 */
export function EmployeePicker({
  id,
  value,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  value: PickedEmployee | null;
  onChange: (e: PickedEmployee | null) => void;
  describedBy?: string | undefined;
  invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const term = useDebouncedValue(q.trim());
  const results = useQuery({
    queryKey: ['employees', 'picker', term],
    queryFn: () =>
      api.get<{ data: Row[] }>('/employees', {
        query: { q: term, pageSize: 8, status: 'active,probation,notice_period' },
      }),
    enabled: term.length >= 2,
  });
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-3 rounded-control border border-line bg-ground-2 px-3">
        <span className="truncate">
          {value.name} <span className="font-mono text-sm text-text-2">{value.code}</span>
        </span>
        <Button variant="text" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        id={id}
        value={q}
        placeholder="Name or employee code"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onClear={() => setQ('')}
      />
      {term.length >= 2 ? (
        <div aria-live="polite">
          {results.isPending ? (
            <p className="text-sm text-text-2">Searching…</p>
          ) : results.data?.data.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
              {results.data.data.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ground-2"
                    onClick={() => onChange({ id: e.id, name: e.displayName, code: e.employeeCode })}
                  >
                    <span>{e.displayName}</span>
                    <span className="font-mono text-sm text-text-2">{e.employeeCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-2">No employees match.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
