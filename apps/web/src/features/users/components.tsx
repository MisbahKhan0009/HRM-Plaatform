import {
  ASSIGNABLE_ROLES,
  type AssignableRoleCode,
  InviteUserInputSchema,
  type UserDetail,
  type UserSummary,
} from '@hrm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Input,
  KeyValueList,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  notify,
  StatusBadge,
} from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  KeyRound,
  MailPlus,
  MoreHorizontal,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StepUpCancelledError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import {
  ROLE_LABEL,
  useInviteUser,
  useReplaceRoles,
  useResendInvitation,
  userQueries,
  useUserAction,
} from './api';

const roleList = (codes: readonly string[]) =>
  codes.length ? codes.map((c) => ROLE_LABEL[c as AssignableRoleCode] ?? c).join(', ') : 'None';

/** USER-FLOWS §2 step 1: email, name and, with `role.manage`, roles (default none). */
export function InviteUserDialog({
  canAssignRoles,
  onClose,
}: {
  canAssignRoles: boolean;
  onClose: () => void;
}) {
  const invite = useInviteUser();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(InviteUserInputSchema, { email: '', name: '', roleCodes: [] });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const body = { ...values, roleCodes: values.roleCodes?.length ? values.roleCodes : undefined };
      if (!canAssignRoles) delete body.roleCodes;
      await invite.mutateAsync(body);
      notify.success(`Invitation created. We'll email ${values.email}.`);
      onClose();
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite user"
      description="They get an email with a link to sign in. The link works for 7 days."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={invite.isPending} onClick={() => void submit()}>
            Send invitation
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name="email"
          label="Email"
          render={(p) => <Input type="email" autoComplete="off" {...p} />}
        />
        <FormField
          control={form.control}
          name="name"
          label="Full name"
          render={(p) => <Input autoComplete="off" {...p} />}
        />
        {canAssignRoles ? (
          <Controller
            control={form.control}
            name="roleCodes"
            render={({ field }) => (
              <RolePicker
                value={(field.value ?? []) as AssignableRoleCode[]}
                onChange={field.onChange}
                hint="Leave empty for people who only use self-service. Employee access comes from the linked employee record."
              />
            )}
          />
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function RolePicker({
  value,
  onChange,
  hint,
}: {
  value: AssignableRoleCode[];
  onChange: (v: AssignableRoleCode[]) => void;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2 text-sm font-medium text-text">
        Roles <span className="font-normal text-text-2">(optional)</span>
      </legend>
      {ASSIGNABLE_ROLES.map((code) => (
        <Checkbox
          key={code}
          label={ROLE_LABEL[code]}
          checked={value.includes(code)}
          onChange={(e) => onChange(e.target.checked ? [...value, code] : value.filter((c) => c !== code))}
        />
      ))}
      {hint ? <p className="text-sm text-text-2">{hint}</p> : null}
    </fieldset>
  );
}

type Pending = {
  kind: 'details' | 'suspend' | 'reactivate' | 'deactivate' | 'reset-auth' | 'roles';
  user: UserDetail;
} | null;

/** Row actions per account status (DOMAIN-MODEL §5.1); confirmation levels from COMPONENT-SPECS §12. */
export function UserRowActions({
  user,
  isSelf,
  canAssignRoles,
}: {
  user: UserSummary;
  isSelf: boolean;
  canAssignRoles: boolean;
}) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const resend = useResendInvitation();
  const [pending, setPending] = useState<Pending>(null);

  // Commands need the current version, which only the detail carries.
  const open = async (kind: NonNullable<Pending>['kind']) => {
    try {
      const detail = await queryClient.fetchQuery({ ...userQueries.detail(user.id), staleTime: 0 });
      setPending({ kind, user: detail });
    } catch (err) {
      notify.error(errorMessage(err));
    }
  };

  const resendInvitation = async () => {
    try {
      await resend.mutateAsync(user.id);
      notify.success(`Invitation sent again to ${user.email}`);
    } catch (err) {
      if (!(err instanceof StepUpCancelledError)) notify.error(errorMessage(err));
    }
  };

  const s = user.status;
  const canChange = !isSelf && s !== 'deactivated';
  return (
    <>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button variant="icon" size="icon-sm" aria-label={`Actions for ${user.name}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => void open('details')}>
            <ShieldCheck aria-hidden="true" />
            View details
          </MenuItem>
          {canChange ? (
            <>
              {s === 'invited' ? (
                <MenuItem onSelect={() => void resendInvitation()}>
                  <MailPlus aria-hidden="true" />
                  Resend invitation
                </MenuItem>
              ) : null}
              {canAssignRoles ? (
                <MenuItem onSelect={() => void open('roles')}>
                  <UserCheck aria-hidden="true" />
                  Change roles
                </MenuItem>
              ) : null}
              {s === 'suspended' ? (
                <MenuItem onSelect={() => void open('reactivate')}>
                  <RotateCcw aria-hidden="true" />
                  Reactivate
                </MenuItem>
              ) : null}
              {s === 'active' || s === 'suspended' ? (
                <MenuItem onSelect={() => void open('reset-auth')}>
                  <KeyRound aria-hidden="true" />
                  Reset sign-in methods
                </MenuItem>
              ) : null}
              <MenuSeparator />
              {s === 'active' ? (
                <MenuItem destructive onSelect={() => void open('suspend')}>
                  <Ban aria-hidden="true" />
                  Suspend
                </MenuItem>
              ) : null}
              <MenuItem destructive onSelect={() => void open('deactivate')}>
                <UserX aria-hidden="true" />
                {s === 'invited' ? 'Revoke invitation' : 'Deactivate'}
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </MenuRoot>
      {pending?.kind === 'details' ? (
        <UserDetailsDialog user={pending.user} onClose={() => setPending(null)} />
      ) : null}
      {pending?.kind === 'roles' ? (
        <ChangeRolesDialog user={pending.user} onClose={() => setPending(null)} />
      ) : null}
      {pending && pending.kind !== 'details' && pending.kind !== 'roles' ? (
        <StatusActionDialog kind={pending.kind} user={pending.user} onClose={() => setPending(null)} />
      ) : null}
    </>
  );
}

// CONTENT-STYLE §7.2 and USER-FLOWS §2.
const ACTION_COPY = {
  suspend: {
    title: (u: UserDetail) => `Suspend ${u.name}?`,
    body: "They'll be signed out on all devices and can't sign in until reactivated.",
    confirm: 'Suspend user',
    done: 'User suspended',
    level: 2,
  },
  reactivate: {
    title: (u: UserDetail) => `Reactivate ${u.name}?`,
    body: 'They can sign in again with their existing sign-in methods.',
    confirm: 'Reactivate user',
    done: 'User reactivated',
    level: 2,
  },
  deactivate: {
    title: (u: UserDetail) =>
      u.status === 'invited' ? `Revoke the invitation for ${u.name}?` : `Deactivate ${u.name}?`,
    body: "They'll be signed out on all devices. Their records stay in the system. This can't be undone.",
    confirm: 'Deactivate user',
    done: 'User deactivated',
    level: 4,
  },
  'reset-auth': {
    title: (u: UserDetail) => `Reset sign-in methods for ${u.name}?`,
    body: "Their passkeys and authenticator app are removed and they're signed out on all devices. We'll email them a link to sign in and set up again.",
    confirm: 'Reset sign-in methods',
    done: 'Sign-in methods reset',
    level: 4,
  },
} as const;

function StatusActionDialog({
  kind,
  user,
  onClose,
}: {
  kind: keyof typeof ACTION_COPY;
  user: UserDetail;
  onClose: () => void;
}) {
  const action = useUserAction();
  const errorMessage = useErrorMessage();
  const copy = ACTION_COPY[kind];
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={copy.title(user)}
      description={copy.body}
      confirmLabel={kind === 'deactivate' && user.status === 'invited' ? 'Revoke invitation' : copy.confirm}
      tone={kind === 'reactivate' ? 'primary' : 'destructive'}
      loading={action.isPending}
      {...(copy.level === 4 ? { typeToConfirm: user.email } : {})}
      onConfirm={async () => {
        setError(null);
        try {
          await action.mutateAsync({ id: user.id, action: kind, input: { version: user.version } });
          notify.success(copy.done);
          onClose();
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

/** Change roles: level 4, the admin types the user's email (CONTENT-STYLE §7.2). */
function ChangeRolesDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const replace = useReplaceRoles();
  const errorMessage = useErrorMessage();
  const assignable = (ASSIGNABLE_ROLES as readonly string[]).filter((r) => user.roles.includes(r as never));
  const [roles, setRoles] = useState<AssignableRoleCode[]>(assignable as AssignableRoleCode[]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = roles.length !== assignable.length || roles.some((r) => !assignable.includes(r));
  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(o) => !o && onClose()}
        title={`Roles for ${user.name}`}
        description="Every role here needs a passkey or authenticator app. Saving asks you to confirm it's you."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!changed} onClick={() => setConfirming(true)}>
              Save roles
            </Button>
          </>
        }
      >
        <RolePicker
          value={roles}
          onChange={setRoles}
          hint={
            user.derivedRoles.length
              ? `Also ${roleList(user.derivedRoles)}, from the employee record.`
              : 'Manager and Employee come from the employee record.'
          }
        />
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title={`Change roles for ${user.name}?`}
        description="They'll get or lose access immediately. This is recorded in the audit log."
        summary={
          <KeyValueList
            items={[
              { label: 'Before', value: roleList(assignable) },
              { label: 'After', value: roleList(roles) },
            ]}
          />
        }
        confirmLabel="Change roles"
        typeToConfirm={user.email}
        loading={replace.isPending}
        onConfirm={async () => {
          setError(null);
          try {
            await replace.mutateAsync({ id: user.id, roleCodes: roles, version: user.version });
            notify.success('Roles changed');
            onClose();
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
    </>
  );
}

function UserDetailsDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const methods = [
    user.enrolment.hasPasskey ? 'Passkey' : null,
    user.enrolment.hasTotp ? 'Authenticator app' : null,
  ].filter(Boolean);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={user.name}
      description={user.email}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <KeyValueList
        items={[
          { label: 'Status', value: <StatusBadge status={user.status} label={t(`status.${user.status}`)} /> },
          { label: 'Roles', value: roleList(user.roles) },
          { label: 'From employee record', value: roleList(user.derivedRoles) },
          { label: 'Strong sign-in', value: methods.length ? methods.join(' + ') : 'Not set up' },
          {
            label: 'Employee',
            value: user.employee ? (
              <>
                {user.employee.name}{' '}
                <span className="font-mono text-sm text-text-2">{user.employee.employeeCode}</span>
              </>
            ) : (
              'Not linked'
            ),
          },
          { label: 'Last sign-in', value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never' },
          ...(user.invitation
            ? [
                {
                  label: 'Invitation',
                  value: user.invitation.expired
                    ? 'Expired. Resend it to send a new link.'
                    : `Expires ${formatDateTime(user.invitation.expiresAt)}`,
                },
              ]
            : []),
        ]}
      />
    </Dialog>
  );
}
