import { Alert, LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/page-header';
import { settingsQueries } from '../../../features/settings/api';
import { SettingsScopeForm } from '../../../features/settings/settings-form';
import { requireAny, useCan } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/settings/hr')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read', 'settings.hr.manage']),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQueries.values()),
  pendingComponent: () => <LoadingBlock label="HR settings" />,
  component: HrSettingsPage,
});

function HrSettingsPage() {
  const canEdit = useCan('settings.hr.manage');
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="HR settings"
        description="Employee codes, attendance and leave rules, and how long documents are kept."
      />
      {canEdit ? null : <Alert>You can view these settings but not change them.</Alert>}
      <SettingsScopeForm scope="hr" sections={['People', 'Attendance and leave', 'Document retention']} />
    </div>
  );
}
