import { Button, Card, CardHeader, EmptyState, KeyValueList, LoadingBlock, StatusBadge } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { UserX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { useCan, useMe } from '../../../lib/auth/me';
import { formatDate } from '../../../lib/format';
import { employeeQueries } from '../api';
import { ContactCard } from '../components/contact-card';
import { ContractsCard } from '../components/contracts-card';
import { type ChangeSection, RequestChangeDialog } from '../components/request-change-dialog';
import { GENDER_LABEL } from '../labels';

const dateOrDash = (d: string | null) => (d ? formatDate(d) : '—');

// SCREEN-INVENTORY §2.2: the caller's own record from `GET /me/profile` (EmployeeSelf); no primary action.
export function MyProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const linked = Boolean(me?.employee);
  const profile = useQuery({ ...employeeQueries.myProfile(), enabled: linked });
  const contact = useQuery({ ...employeeQueries.contact(me?.employee?.id ?? ''), enabled: linked });
  const canRequest = useCan('profile_change.request.own');
  const [section, setSection] = useState<ChangeSection | null>(null);

  if (!linked) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <PageHeader title="My profile" />
        <EmptyState
          variant="no-results"
          icon={UserX}
          title="Your account isn't linked to an employee record."
        />
      </div>
    );
  }
  const p = profile.data;
  const requestButton = (s: ChangeSection) =>
    canRequest && p ? (
      <Button variant="secondary" size="sm" onClick={() => setSection(s)}>
        Request a change
      </Button>
    ) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={p?.displayName ?? me?.employee?.name ?? 'My profile'}
        code={me?.employee?.employeeCode}
        status={p ? <StatusBadge status={p.status} label={t(`status.${p.status}`)} /> : null}
        description={p ? [p.position?.title, p.department?.name].filter(Boolean).join(' · ') || null : null}
        actions={
          canRequest ? (
            <Button variant="text" asChild>
              <Link to="/me/profile-changes">My change requests</Link>
            </Button>
          ) : null
        }
      />
      {profile.isPending ? <LoadingBlock label="profile" /> : null}
      {profile.isError ? (
        <EmptyState
          variant="no-results"
          icon={UserX}
          title="Your account isn't linked to an employee record."
        />
      ) : null}
      {p ? (
        <>
          <Card aria-labelledby="h-me-employment">
            <CardHeader id="h-me-employment" title="Employment" />
            <KeyValueList
              items={[
                { label: 'Employee code', value: <span className="font-mono">{p.employeeCode}</span> },
                { label: 'Department', value: p.department?.name ?? '—' },
                { label: 'Position', value: p.position?.title ?? '—' },
                { label: 'Manager', value: p.manager?.name ?? '—' },
                { label: 'Joined', value: dateOrDash(p.joiningDate) },
                ...(p.probationEndDate
                  ? [{ label: 'Probation ends', value: formatDate(p.probationEndDate) }]
                  : []),
                { label: 'Work email', value: p.workEmail ?? '—' },
                { label: 'Work phone', value: p.workPhone ?? '—' },
              ]}
            />
          </Card>
          <Card aria-labelledby="h-me-identity">
            <CardHeader id="h-me-identity" title="Identity" actions={requestButton('identity')} />
            <KeyValueList
              items={[
                { label: 'Legal name', value: `${p.firstName} ${p.lastName}` },
                { label: 'Preferred name', value: p.preferredName ?? '—' },
                { label: 'Date of birth', value: dateOrDash(p.dateOfBirth) },
                { label: 'Gender', value: p.gender ? GENDER_LABEL[p.gender] : '—' },
              ]}
            />
          </Card>
          <ContactCard employeeId={p.id} canEdit={false} action={requestButton('contact')} />
          <ContractsCard employeeId={p.id} canEdit={false} />
        </>
      ) : null}
      {section && p ? (
        <RequestChangeDialog
          profile={p}
          contact={contact.data}
          initialSection={section}
          onClose={() => setSection(null)}
        />
      ) : null}
    </div>
  );
}
