import type { EmployeeDetail } from '@hrm/contracts';
import { Button, Card, StatusBadge, TabPanel, Tabs } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { canAny, useMe } from '../../../lib/auth/me';
import { employeeQueries } from '../api';
import { ContactCard } from '../components/contact-card';
import { ContractsCard } from '../components/contracts-card';
import { EmploymentEventDialog, EmploymentTab } from '../components/employment-tab';
import {
  ACTIONS_FOR_STATUS,
  ArchiveDialog,
  EffectiveActionDialog,
  EmployeeActionsMenu,
  type EmployeeDialog,
  HireDialog,
  SeparateDialog,
  StartPreboardingDialog,
} from '../components/lifecycle';
import { EditEmployeeDialog, InviteDialog, OverviewTab } from '../components/overview-tab';

const route = getRouteApi('/_app/employees/$employeeId');

export const recordTabValues = [
  'overview',
  'employment',
  'contact',
  'contracts',
  'documents',
  'attendance',
  'leave',
  'compensation',
] as const;
export type RecordTab = (typeof recordTabValues)[number];

const TAB_LABEL: Record<RecordTab, string> = {
  overview: 'Overview',
  employment: 'Employment',
  contact: 'Contact',
  contracts: 'Contracts',
  documents: 'Documents',
  attendance: 'Attendance',
  leave: 'Leave',
  compensation: 'Compensation',
};

/** Other modules own these tabs; until their pages exist the tab links to the module (SCREEN-INVENTORY §8.4). */
const MODULE_TAB: Partial<Record<RecordTab, { text: string; href: (id: string) => string; link: string }>> = {
  documents: {
    text: 'Documents for this employee are listed in the Documents module.',
    href: (id) => `/documents?employeeId=${id}`,
    link: 'Open documents',
  },
  attendance: {
    text: 'Attendance for this employee is shown in the Attendance module.',
    href: (id) => `/attendance/team?employeeId=${id}`,
    link: 'Open attendance',
  },
  leave: {
    text: 'Leave balances and requests for this employee are in the Leave module.',
    href: (id) => `/leave/requests?employeeId=${id}`,
    link: 'Open leave',
  },
  compensation: {
    text: 'Salary structures are kept in Payroll, visible to payroll roles only.',
    href: (id) => `/payroll/salary-structures?employeeId=${id}`,
    link: 'Open salary structures',
  },
};

// SCREEN-INVENTORY §8.4, canvas EmployeeProfile: header, tabs filtered by permission, lifecycle in "More actions".
export function EmployeeRecordPage() {
  const { t } = useTranslation();
  const { employeeId } = route.useParams();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();
  const me = useMe();
  const { data: employee } = useSuspenseQuery(employeeQueries.detail(employeeId));
  const [dialog, setDialog] = useState<EmployeeDialog | 'edit' | null>(null);

  const own = me?.employee?.id === employee.id;
  const full = employee.view === 'full' ? employee : null;
  const canManage = canAny(me, ['employee.manage']) && Boolean(full);
  const visible: Record<RecordTab, boolean> = {
    overview: true,
    employment: true,
    contact: own || canAny(me, ['employee.contact.read.all']),
    contracts: own || canAny(me, ['employee.read.all']),
    documents: canAny(me, ['document.read.all']),
    attendance: canAny(me, ['attendance.read.all', 'attendance.read.team']),
    leave: canAny(me, ['leave.read.all', 'leave.read.team']),
    compensation: canAny(me, ['compensation.read.all']),
  };
  const tabs = recordTabValues.filter((v) => visible[v]);
  const current: RecordTab = visible[tab] ? tab : 'overview';

  const actions: EmployeeDialog[] = [];
  if (full && canManage) {
    actions.push(...ACTIONS_FOR_STATUS[full.status]);
    if (full.status !== 'archived') actions.unshift('event');
    if (
      canAny(me, ['user.manage']) &&
      !full.account &&
      full.status !== 'archived' &&
      full.status !== 'separated'
    )
      actions.push('invite');
  }
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={employee.displayName}
        code={employee.employeeCode}
        breadcrumb={{ label: 'Employees', to: '/employees' }}
        status={<StatusBadge status={employee.status} label={t(`status.${employee.status}`)} />}
        description={
          [employee.position?.title, employee.department?.name].filter(Boolean).join(' · ') || null
        }
        actions={
          <>
            <EmployeeActionsMenu actions={actions} onSelect={setDialog} />
            {canManage && current === 'overview' && employee.status !== 'archived' ? (
              <Button
                variant="primary"
                icon={<Pencil aria-hidden="true" />}
                onClick={() => setDialog('edit')}
              >
                Edit
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        value={current}
        onValueChange={(v) => void navigate({ search: { tab: v as RecordTab }, replace: true })}
        tabs={tabs.map((v) => ({ value: v, label: TAB_LABEL[v] }))}
      >
        <TabPanel value="overview">
          <OverviewTab employee={employee} onInvite={() => setDialog('invite')} />
        </TabPanel>
        <TabPanel value="employment">
          <EmploymentTab employee={employee} />
        </TabPanel>
        {visible.contact ? (
          <TabPanel value="contact">
            <ContactCard employeeId={employee.id} canEdit={canManage && employee.status !== 'archived'} />
          </TabPanel>
        ) : null}
        {visible.contracts ? (
          <TabPanel value="contracts">
            <ContractsCard employeeId={employee.id} canEdit={canManage && employee.status !== 'archived'} />
          </TabPanel>
        ) : null}
        {(['documents', 'attendance', 'leave', 'compensation'] as const).map((v) =>
          visible[v] ? (
            <TabPanel key={v} value={v}>
              <ModuleLink employee={employee} tab={v} />
            </TabPanel>
          ) : null,
        )}
      </Tabs>
      {full && dialog === 'edit' ? <EditEmployeeDialog employee={full} onClose={close} /> : null}
      {full && dialog === 'invite' ? <InviteDialog employee={full} onClose={close} /> : null}
      {dialog === 'event' ? <EmploymentEventDialog employee={employee} onClose={close} /> : null}
      {full && dialog === 'start-preboarding' ? (
        <StartPreboardingDialog employee={full} onClose={close} />
      ) : null}
      {full && dialog === 'hire' ? <HireDialog employee={full} onClose={close} /> : null}
      {full && (dialog === 'confirm' || dialog === 'start-notice' || dialog === 'rehire') ? (
        <EffectiveActionDialog employee={full} action={dialog} onClose={close} />
      ) : null}
      {full && dialog === 'separate' ? <SeparateDialog employee={full} onClose={close} /> : null}
      {full && dialog === 'archive' ? <ArchiveDialog employee={full} onClose={close} /> : null}
    </div>
  );
}

function ModuleLink({ employee, tab }: { employee: EmployeeDetail; tab: RecordTab }) {
  const info = MODULE_TAB[tab];
  if (!info) return null;
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="text-text-2">{info.text}</p>
      <Button variant="secondary" size="sm" asChild>
        <a href={info.href(employee.id)}>{info.link} →</a>
      </Button>
    </Card>
  );
}
