import { Button, LoadingBlock, notify } from '@hrm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Play, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { systemQueries, useRetryOutbox } from '../../../features/system/api';
import {
  DeliveryCard,
  HealthAlert,
  JobsTable,
  OutboxStats,
  RunJobDialog,
} from '../../../features/system/components';
import { StepUpCancelledError } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
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
  const retry = useRetryOutbox();
  const errorMessage = useErrorMessage();
  const retryFailed = async () => {
    try {
      const { reset, processing } = await retry.mutateAsync();
      if (!reset) notify.success('No failed messages to retry');
      else if (processing < reset)
        notify.success(`${reset} messages queued; ${processing} sent now, the rest with the next outbox run`);
      else notify.success(`${reset} ${reset === 1 ? 'message' : 'messages'} sent for retry`);
    } catch (err) {
      if (!(err instanceof StepUpCancelledError)) notify.error(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System health"
        description="Background jobs, the outbox and email delivery. No business data is shown here."
        actions={
          canRun ? (
            <>
              <Button icon={<Play aria-hidden="true" />} onClick={() => setRunning(true)}>
                Run job
              </Button>
              <Button
                variant="primary"
                icon={<RotateCw aria-hidden="true" />}
                loading={retry.isPending}
                onClick={() => void retryFailed()}
              >
                Retry failed messages
              </Button>
            </>
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
      {running ? <RunJobDialog onClose={() => setRunning(false)} /> : null}
    </div>
  );
}
