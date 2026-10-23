import { PERMISSIONS, type Permission, ROLE_CODES, type Role } from '@hrm/contracts';
import { Alert, Button, ConfirmDialog, KeyValueList, notify, Table, TBody, TD, TH, THead, TR } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { StepUpCancelledError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { useMe } from '../../lib/auth/me';
import { roleQueries, useUpdateRole } from './api';

/** Permissions grouped by resource, the first segment of the code (SECURITY-MODEL §4), in catalogue order. */
const GROUPS = PERMISSIONS.reduce<{ resource: string; permissions: Permission[] }[]>((acc, p) => {
  const resource = p.split('.')[0] ?? p;
  const last = acc.at(-1);
  if (last?.resource === resource) last.permissions.push(p);
  else acc.push({ resource, permissions: [p] });
  return acc;
}, []);

const RESOURCE_LABEL: Record<string, string> = {
  user: 'Users',
  role: 'Roles',
  settings: 'Settings',
  org: 'Organization',
  employee: 'Employees',
  profile_change: 'Profile changes',
  compensation: 'Compensation',
  payroll: 'Payroll',
  payslip: 'Payslips',
  attendance: 'Attendance',
  leave: 'Leave',
  reimbursement: 'Claims',
  document: 'Documents',
  approval: 'Approvals',
  report: 'Reports',
  audit: 'Audit log',
  system: 'System',
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Roles × permissions matrix (SCREEN-INVENTORY §11 `/settings/roles`). Each role column saves on its own with the
 * role's version; read-only without `role.manage`.
 */
export function RoleMatrix({ roles: unordered, canEdit }: { roles: Role[]; canEdit: boolean }) {
  const me = useMe();
  // Catalogue order: explicit roles first, derived roles last.
  const roles = [...unordered].sort((a, b) => ROLE_CODES.indexOf(a.code) - ROLE_CODES.indexOf(b.code));
  const descriptions = useQuery({ ...roleQueries.permissions(), enabled: canEdit });
  const describe = useMemo(
    () => new Map((descriptions.data ?? []).map((d) => [d.code, d.description])),
    [descriptions.data],
  );
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<Role | null>(null);
  const grantsOf = (r: Role): string[] => draft[r.id] ?? r.permissions;

  const toggle = (r: Role, p: Permission, on: boolean) => {
    const current = grantsOf(r);
    const next = on ? [...current, p] : current.filter((x) => x !== p);
    setDraft((d) => {
      const copy = { ...d };
      if (sameSet(next, r.permissions)) delete copy[r.id];
      else copy[r.id] = next;
      return copy;
    });
  };

  return (
    <>
      <Table className="min-w-[760px]">
        <caption className="sr-only">Permissions granted to each role</caption>
        <THead>
          <tr>
            <TH className="sticky left-0 z-10 bg-ground-2">Permission</TH>
            {roles.map((r) => (
              <TH key={r.id} className="text-center">
                {r.name}
                {r.isDerived ? <span className="block normal-case tracking-normal">derived</span> : null}
              </TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {GROUPS.map((g) => (
            <Fragment key={g.resource}>
              <tr className="border-b border-line bg-ground">
                <th
                  scope="colgroup"
                  colSpan={roles.length + 1}
                  className="sticky left-0 h-9 px-4 text-left text-sm font-semibold text-text"
                >
                  {RESOURCE_LABEL[g.resource] ?? g.resource}
                </th>
              </tr>
              {g.permissions.map((p) => (
                <TR key={p}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal">
                    <span className="block font-mono text-[13px]">{p}</span>
                    {describe.get(p) && describe.get(p) !== p ? (
                      <span className="block text-sm text-text-2">{describe.get(p)}</span>
                    ) : null}
                  </th>
                  {roles.map((r) => {
                    const checked = grantsOf(r).includes(p);
                    // The API refuses to remove role management from a role the caller holds (self-lockout).
                    const locked = p === 'role.manage' && checked && Boolean(me?.roles.includes(r.code));
                    return (
                      <TD key={r.id} className="text-center">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-[var(--action)] disabled:cursor-default"
                          aria-label={`${r.name}: ${p}`}
                          checked={checked}
                          disabled={!canEdit || locked}
                          onChange={(e) => toggle(r, p, e.target.checked)}
                        />
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </Fragment>
          ))}
          {canEdit ? (
            <tr className="border-t border-line-strong bg-ground-2">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-ground-2 px-4 py-2 text-left text-sm font-normal text-text-2"
              >
                Save each role on its own
              </th>
              {roles.map((r) => (
                <TD key={r.id} className="py-2 text-center">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!draft[r.id]}
                    aria-label={`Save ${r.name}`}
                    onClick={() => setSaving(r)}
                  >
                    Save
                  </Button>
                </TD>
              ))}
            </tr>
          ) : null}
        </TBody>
      </Table>
      {saving ? (
        <SaveRoleDialog
          role={saving}
          next={grantsOf(saving)}
          onClose={(saved) => {
            if (saved)
              setDraft((d) => {
                const copy = { ...d };
                delete copy[saving.id];
                return copy;
              });
            setSaving(null);
          }}
        />
      ) : null}
    </>
  );
}

function SaveRoleDialog({
  role,
  next,
  onClose,
}: {
  role: Role;
  next: string[];
  onClose: (saved: boolean) => void;
}) {
  const update = useUpdateRole();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const added = next.filter((p) => !role.permissions.includes(p as never));
  const removed = role.permissions.filter((p) => !next.includes(p));
  const who = role.isDerived
    ? `everyone who is ${role.code === 'manager' ? 'a manager' : 'an employee'}`
    : `${role.userCount} ${role.userCount === 1 ? 'person' : 'people'}`;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose(false)}
      title={`Change permissions for ${role.name}?`}
      description={`This applies immediately to ${who} with this role and is recorded in the audit log.`}
      tone="primary"
      confirmLabel="Save changes"
      summary={
        <KeyValueList
          items={[
            { label: 'Added', value: <PermissionList codes={added} /> },
            { label: 'Removed', value: <PermissionList codes={removed} /> },
          ]}
        />
      }
      loading={update.isPending}
      onConfirm={async () => {
        setError(null);
        try {
          await update.mutateAsync({
            id: role.id,
            input: { permissions: next as Permission[], version: role.version },
          });
          notify.success(`${role.name} permissions saved`);
          onClose(true);
        } catch (err) {
          if (!(err instanceof StepUpCancelledError)) setError(errorMessage(err));
        }
      }}
    >
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

function PermissionList({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="text-text-2">None</span>;
  return (
    <ul className="flex flex-col gap-0.5 font-mono text-[13px]">
      {codes.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}
