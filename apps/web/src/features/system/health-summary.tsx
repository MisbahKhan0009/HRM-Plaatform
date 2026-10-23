import type { HealthDetails } from '@hrm/contracts';
import { StatBar, StatusBadge } from '@hrm/ui';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';

// Kept apart from components.tsx (forms and dialogs) so the dashboard widget stays light.

export const count = (n: number) => n.toLocaleString('en-US');

/** Problems worth an alert, worst first. Values come from the API; nothing is computed beyond counting. */
export function healthProblems(h: HealthDetails): string[] {
  const problems: string[] = [];
  if (!h.database.ok) problems.push("The database didn't respond.");
  const failedJobs = h.jobs.filter((j) => j.status === 'failed').map((j) => j.job);
  if (failedJobs.length) problems.push(`Last run failed: ${failedJobs.join(', ')}.`);
  if (h.outbox.counts.dead) problems.push(`${count(h.outbox.counts.dead)} messages stopped retrying.`);
  if (h.emailsToday.failed) problems.push(`${count(h.emailsToday.failed)} emails failed today.`);
  return problems;
}

/** Dashboard widget 12 (INFORMATION-ARCHITECTURE §5): last job runs and failed outbox messages. */
export function SystemHealthSummary({ health }: { health: HealthDetails }) {
  const { t } = useTranslation();
  const problems = healthProblems(health);
  return (
    <div className="flex flex-col gap-4">
      {problems.length ? <p className="text-bad">{problems.join(' ')}</p> : null}
      {health.jobs.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {health.jobs.map((j) => (
            <li key={j.job} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{j.job}</p>
                <p className="text-sm text-text-2">{formatDateTime(j.startedAt)}</p>
              </div>
              <StatusBadge status={j.status} label={t(`status.${j.status}`)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">No job runs yet.</p>
      )}
      <StatBar
        stats={[
          { label: 'Failed, retrying', value: count(health.outbox.counts.failed) },
          { label: 'Dead letters', value: count(health.outbox.counts.dead) },
        ]}
      />
    </div>
  );
}
