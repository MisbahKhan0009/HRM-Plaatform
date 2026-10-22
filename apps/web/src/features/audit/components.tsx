import { type AuditCategory, type AuditLogEntry, auditCategoryValues } from '@hrm/contracts';
import { Badge, Button, Field, Input, KeyValueList, Select, Table, TBody, TD, TH, THead, TR } from '@hrm/ui';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { ACTION_GROUPS, type AuditSearch, CATEGORY_LABEL, metadataText } from './api';

type Patch = Partial<Omit<AuditSearch, 'page' | 'pageSize'>>;

/** Filters (SCREEN-INVENTORY §10.3, COMPONENT-SPECS §8): every value lives in the URL. */
export function AuditFilters({
  search,
  onChange,
}: {
  search: AuditSearch;
  onChange: (patch: Patch) => void;
}) {
  const [entityType, setEntityType] = useState(search.entityType ?? '');
  useEffect(() => setEntityType(search.entityType ?? ''), [search.entityType]);
  const entityValid = entityType === '' || /^[a-z_]{1,60}$/.test(entityType);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="From">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={search.from}
            required
            onChange={(e) => e.target.value && onChange({ from: e.target.value })}
          />
        )}
      </Field>
      <Field label="To">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={search.to}
            required
            onChange={(e) => e.target.value && onChange({ to: e.target.value })}
          />
        )}
      </Field>
      <Field label="Action">
        {({ id }) => (
          <Select
            id={id}
            value={search.action ?? ''}
            onChange={(e) => onChange({ action: e.target.value || undefined })}
          >
            <option value="">All actions</option>
            {ACTION_GROUPS.map((g) => (
              <optgroup key={g.prefix} label={g.prefix.slice(0, -1)}>
                <option value={g.prefix}>All {g.prefix.slice(0, -1)} actions</option>
                {g.actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Category">
        {({ id }) => (
          <Select
            id={id}
            value={search.category ?? ''}
            onChange={(e) =>
              onChange({ category: (e.target.value || undefined) as AuditCategory | undefined })
            }
          >
            <option value="">All categories</option>
            {auditCategoryValues.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Entity type"
        hint="For example payroll_run"
        error={entityValid ? undefined : 'Use lowercase letters and underscores.'}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            className="font-mono"
            value={entityType}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoComplete="off"
            onChange={(e) => setEntityType(e.target.value)}
            onBlur={() => entityValid && onChange({ entityType: entityType || undefined })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && entityValid) onChange({ entityType: entityType || undefined });
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** Chips for filters set from a row (actor, employee, record), each with a clear button (COMPONENT-SPECS §8). */
export function FilterChips({
  search,
  names,
  onChange,
}: {
  search: AuditSearch;
  names: Record<string, string>;
  onChange: (patch: Patch) => void;
}) {
  const chips: { label: string; clear: Patch }[] = [];
  if (search.actorUserId)
    chips.push({
      label: `Actor: ${names[search.actorUserId] ?? short(search.actorUserId)}`,
      clear: { actorUserId: undefined },
    });
  if (search.employeeId)
    chips.push({ label: `Employee: ${short(search.employeeId)}`, clear: { employeeId: undefined } });
  if (search.entityId)
    chips.push({ label: `Record: ${short(search.entityId)}`, clear: { entityId: undefined } });
  if (!chips.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.label}>
          <span className="inline-flex h-8 items-center gap-1 rounded-pill border border-line-strong pr-1 pl-3 text-sm">
            {c.label}
            <button
              type="button"
              className="grid size-6 cursor-pointer place-items-center rounded-pill text-text-2 hover:bg-ground-2"
              aria-label={`Remove filter ${c.label}`}
              onClick={() => onChange(c.clear)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

// UUIDv7 ids share their leading time bits, so the tail tells records apart.
const short = (id: string) => `…${id.slice(-8)}`;

/** Audit table (COMPONENT-SPECS §7): rows expand to show metadata as key/value pairs. */
export function AuditTable({
  entries,
  onFilter,
}: {
  entries: AuditLogEntry[];
  onFilter: (patch: Patch, actorName?: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Table>
      <THead>
        <tr>
          <TH className="w-10">
            <span className="sr-only">Details</span>
          </TH>
          <TH>Time</TH>
          <TH>Actor</TH>
          <TH>Action</TH>
          <TH>Entity</TH>
          <TH>Category</TH>
        </tr>
      </THead>
      <TBody>
        {entries.map((e) => {
          const expanded = open === e.id;
          const Icon = expanded ? ChevronDown : ChevronRight;
          return (
            <Fragment key={e.id}>
              <TR className={expanded ? 'bg-accent-tint hover:bg-accent-tint' : undefined}>
                <TD className="px-2">
                  <Button
                    variant="icon"
                    size="icon-sm"
                    aria-expanded={expanded}
                    aria-controls={`audit-${e.id}`}
                    aria-label={`Details of ${e.action} at ${formatDateTime(e.occurredAt)}`}
                    onClick={() => setOpen(expanded ? null : e.id)}
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                </TD>
                <TD className="font-mono text-[13px] whitespace-nowrap">
                  <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
                </TD>
                <TD>
                  {e.actorType === 'system' ? (
                    <span className="text-text-2">System</span>
                  ) : (
                    (e.actorName ?? '—')
                  )}
                </TD>
                <TD className="font-mono text-[13px]">{e.action}</TD>
                <TD className="font-mono text-[13px] whitespace-nowrap">
                  {e.entityType}
                  {e.entityId ? <span className="text-text-2"> · {short(e.entityId)}</span> : null}
                </TD>
                <TD>
                  <Badge>{CATEGORY_LABEL[e.category]}</Badge>
                </TD>
              </TR>
              {expanded ? (
                <tr id={`audit-${e.id}`} className="border-b border-line bg-ground">
                  <td colSpan={6} className="px-4 py-4 sm:pl-14">
                    <EntryDetails entry={e} onFilter={onFilter} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}

function EntryDetails({
  entry: e,
  onFilter,
}: {
  entry: AuditLogEntry;
  onFilter: (patch: Patch, actorName?: string) => void;
}) {
  const mono = (v: ReactNode) => <span className="font-mono text-[13px] break-all">{v}</span>;
  const metadata = e.metadata ? Object.entries(e.metadata) : null;
  return (
    <div className="flex flex-col gap-4">
      <KeyValueList
        items={[
          { label: 'Entity ID', value: e.entityId ? mono(e.entityId) : '—' },
          ...(e.employeeId ? [{ label: 'Employee ID', value: mono(e.employeeId) }] : []),
          { label: 'Request', value: e.requestId ? mono(e.requestId) : '—' },
          { label: 'IP address', value: e.ipAddress ? mono(e.ipAddress) : '—' },
        ]}
      />
      {metadata === null ? (
        <p className="text-sm text-text-2">
          Details of this event are only shown to people with full audit access.
        </p>
      ) : metadata.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">Details</h3>
          <KeyValueList
            items={metadata.map(([k, v]) => ({
              label: k,
              value: (
                <pre className="font-mono text-[13px] whitespace-pre-wrap break-words">{metadataText(v)}</pre>
              ),
            }))}
          />
        </div>
      ) : (
        <p className="text-sm text-text-2">No further details were recorded.</p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {e.actorUserId ? (
          <Button
            variant="text"
            onClick={() => onFilter({ actorUserId: e.actorUserId ?? undefined }, e.actorName ?? undefined)}
          >
            Show events by this actor
          </Button>
        ) : null}
        {e.entityId ? (
          <Button
            variant="text"
            onClick={() => onFilter({ entityType: e.entityType, entityId: e.entityId ?? undefined })}
          >
            Show this record's history
          </Button>
        ) : null}
        {e.employeeId ? (
          <Button variant="text" onClick={() => onFilter({ employeeId: e.employeeId ?? undefined })}>
            Show events for this employee
          </Button>
        ) : null}
      </div>
    </div>
  );
}
