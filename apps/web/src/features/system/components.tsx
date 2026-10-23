import { type HealthDetails, type JobRunResult, RunJobInputSchema } from '@hrm/contracts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  KeyValueList,
  notify,
  Select,
  StatBar,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { StepUpCancelledError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDateTime, todayIso } from '../../lib/format';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../lib/forms';
import { formatAge, formatRunDuration, systemQueries, useRunJob } from './api';
import { count, healthProblems } from './health-summary';

export function HealthAlert({ health }: { health: HealthDetails }) {
  const problems = healthProblems(health);
  if (!problems.length)
    return (
      <Alert tone="ok" title="Everything is running">
        Jobs, the outbox and email delivery have no failures.
      </Alert>
    );
  return (
    <Alert tone="bad" title="Something needs attention">
      <ul className="flex flex-col gap-0.5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Alert>
  );
}

export function OutboxStats({ health }: { health: HealthDetails }) {
  const c = health.outbox.counts;
  return (
    <StatBar
      stats={[
        { label: 'Messages pending', value: count(c.pending + c.processing) },
        { label: 'Failed, retrying', value: count(c.failed) },
        { label: 'Dead letters', value: count(c.dead) },
        { label: 'Sent', value: count(c.sent) },
      ]}
    />
  );
}

export function JobsTable({ health }: { health: HealthDetails }) {
  const { t } = useTranslation();
  return (
    <TableContainer>
      {!health.jobs.length ? (
        <EmptyState
          icon={History}
          variant="no-results"
          title="No job runs yet"
          description="The daily jobs run shortly after midnight. Runs appear here."
          className="border-0"
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Job</TH>
              <TH>Last run</TH>
              <TH numeric>Duration</TH>
              <TH numeric>Items</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {health.jobs.map((j) => (
              <TR key={j.job}>
                <TD className="font-mono text-[13px]">
                  {j.job}
                  <span className="block text-text-2">{j.runKey}</span>
                </TD>
                <TD className="whitespace-nowrap">{formatDateTime(j.startedAt)}</TD>
                <TD numeric>{formatRunDuration(j.startedAt, j.finishedAt) ?? '—'}</TD>
                <TD numeric>{count(j.items)}</TD>
                <TD>
                  <StatusBadge status={j.status} label={t(`status.${j.status}`)} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </TableContainer>
  );
}

export function DeliveryCard({ health }: { health: HealthDetails }) {
  return (
    <Card aria-labelledby="delivery" className="flex flex-col">
      <CardHeader id="delivery" title="Email and database" />
      <KeyValueList
        items={[
          {
            label: 'Emails sent today',
            value: <span className="font-mono">{count(health.emailsToday.sent)}</span>,
          },
          {
            label: 'Emails failed today',
            value: (
              <span className={health.emailsToday.failed ? 'font-mono text-bad' : 'font-mono'}>
                {count(health.emailsToday.failed)}
              </span>
            ),
          },
          {
            label: 'Oldest waiting message',
            value:
              health.outbox.oldestPendingAgeSeconds === null
                ? 'None waiting'
                : `${formatAge(health.outbox.oldestPendingAgeSeconds)} old`,
          },
          {
            label: 'Database',
            value: health.database.ok ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusBadge status="succeeded" label="Responding" />
                <span className="font-mono text-sm text-text-2">{health.database.latencyMs} ms</span>
              </span>
            ) : (
              <StatusBadge status="failed" label="Not responding" />
            ),
          },
          { label: 'Checked', value: formatDateTime(health.time) },
        ]}
      />
    </Card>
  );
}

const RunJobFormSchema = RunJobInputSchema.extend({
  job: z.string().min(1, 'Choose a job'),
  date: z.iso.date('Choose a valid date'),
});

const OUTCOME: Record<JobRunResult['outcome'], string> = {
  succeeded: 'Job ran',
  skipped: 'Already ran for this date. Nothing changed.',
  failed: 'Job failed',
};

/** `POST /admin/jobs/{job}/run` (JOBS-AND-OUTBOX §4); a key that already succeeded is skipped, not repeated. */
export function RunJobDialog({ onClose }: { onClose: () => void }) {
  const run = useRunJob();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<JobRunResult | null>(null);
  // Every daily step in dispatcher order, including steps that never ran (`GET /admin/jobs`).
  const list = useQuery(systemQueries.jobs());
  const jobs = list.data?.data.map((j) => j.job) ?? [];
  const form = useZodForm(RunJobFormSchema, { job: '', date: todayIso() } as never);
  const field = (name: string) => name as never;
  const firstJob = jobs[0];
  useEffect(() => {
    if (firstJob && !form.getValues(field('job'))) form.setValue(field('job'), firstJob as never);
  }, [firstJob, form]);
  const submit = form.handleSubmit(async ({ job, date, runKey }) => {
    setFormError(null);
    setResult(null);
    try {
      const res = await run.mutateAsync({ job, input: { date, ...(runKey ? { runKey } : {}) } });
      setResult(res);
      if (res.outcome !== 'failed') notify.success(OUTCOME[res.outcome]);
    } catch (err) {
      if (!(err instanceof StepUpCancelledError)) setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Run job"
      description="Runs one daily job for a date. A run that already succeeded for that date is skipped."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={!jobs.length}
            onClick={() => void submit()}
          >
            Run job
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      {list.isError ? <Alert tone="bad">{errorMessage(list.error)}</Alert> : null}
      {result ? (
        <Alert
          tone={result.outcome === 'failed' ? 'bad' : result.outcome === 'skipped' ? 'info' : 'ok'}
          assertive
        >
          <p className="font-semibold">{OUTCOME[result.outcome]}</p>
          <p className="font-mono text-sm">
            {result.job} · {result.runKey} · {count(result.items)} items
          </p>
          {result.error ? <p className="mt-1 font-mono text-sm break-words">{result.error}</p> : null}
        </Alert>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name={field('job')}
          label="Job"
          render={(p) => (
            <Select
              {...p}
              onChange={(e) => p.onChange(e.target.value)}
              className="font-mono"
              disabled={list.isPending}
            >
              {jobs.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name={field('date')}
          label="Business date"
          hint="Asia/Dhaka date the job runs for."
          render={(p) => <Input type="date" {...p} onChange={(e) => p.onChange(e.target.value)} />}
        />
        <FormField
          control={form.control}
          name={field('runKey')}
          label="Run key"
          optional
          hint="Leave empty to use the job's key for the date. Use a new key to run it again."
          render={(p) => (
            <Input
              {...p}
              className="font-mono"
              autoComplete="off"
              onChange={(e) => p.onChange(e.target.value || undefined)}
            />
          )}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
