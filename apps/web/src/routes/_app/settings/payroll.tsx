import { Alert, LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/page-header';
import { settingsQueries } from '../../../features/settings/api';
import { SettingsScopeForm } from '../../../features/settings/settings-form';
import { requireAny, useCan } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/settings/payroll')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read', 'settings.payroll.manage']),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQueries.values()),
  pendingComponent: () => <LoadingBlock label="payroll settings" />,
  component: PayrollSettingsPage,
});

function PayrollSettingsPage() {
  const canEdit = useCan('settings.payroll.manage');
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Payroll settings"
        description="Rules used when payroll runs are calculated and checked."
      />
      {canEdit ? null : <Alert>You can view these settings but not change them.</Alert>}
      <SettingsScopeForm scope="payroll" sections={['Payroll', 'Claims']} />
    </div>
  );
}
