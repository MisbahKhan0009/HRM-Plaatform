import { Button, LoadingBlock } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { systemQueries } from '../../../features/system/api';
import {
  DeliveryCard,
  HealthAlert,
  JobsTable,
  OutboxStats,
  RunJobDialog,
} from '../../../features/system/components';
import { requireAny, useCan } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/settings/system')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['system.health.read']),
  loader: ({ context }) => context.queryClient.ensureQueryData(systemQueries.health()),
  pendingComponent: () => <LoadingBlock label="system health" />,
  component: SystemHealthPage,
});

// SCREEN-INVENTORY §11 `/settings/system`, design canvas SystemHealth.
function SystemHealthPage() {
  const { data: health } = useSuspenseQuery(systemQueries.health());
  const canRun = useCan('settings.technical.manage');
  const [running, setRunning] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System health"
        description="Background jobs, the outbox and email delivery. No business data is shown here."
        actions={
          canRun ? (
            <Button variant="primary" icon={<Play aria-hidden="true" />} onClick={() => setRunning(true)}>
              Run job
            </Button>
          ) : null
        }
      />
      <HealthAlert health={health} />
      <section aria-labelledby="outbox" className="flex flex-col gap-3">
        <h2 id="outbox" className="font-display text-[17px] font-semibold">
          Outbox
        </h2>
        <OutboxStats health={health} />
      </section>
      <section aria-labelledby="jobs" className="flex flex-col gap-3">
        <h2 id="jobs" className="font-display text-[17px] font-semibold">
          Background jobs
        </h2>
        <JobsTable health={health} />
      </section>
      <DeliveryCard health={health} />
      {running ? <RunJobDialog health={health} onClose={() => setRunning(false)} /> : null}
    </div>
  );
}
