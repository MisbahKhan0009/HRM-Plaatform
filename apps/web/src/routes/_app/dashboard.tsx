import { Eyebrow } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DASHBOARD_WIDGETS } from '../../features/dashboard/widgets';
import { canAny, useMe } from '../../lib/auth/me';
import { formatDate, todayIso } from '../../lib/format';

export const Route = createFileRoute('/_app/dashboard')({ component: Dashboard });

const SPAN = { 4: 'lg:col-span-4', 6: 'lg:col-span-6', 8: 'lg:col-span-8', 12: 'lg:col-span-12' } as const;

function Dashboard() {
  const { t } = useTranslation();
  const me = useMe();
  useEffect(() => {
    document.title = `${t('nav.dashboard')} · Big-Matrix HRM`;
  }, [t]);
  if (!me) return null;
  const widgets = DASHBOARD_WIDGETS.filter((w) => w.any.length === 0 || canAny(me, w.any));
  // Only the first visible widget with a primary action keeps the primary style (INFORMATION-ARCHITECTURE §5).
  const primaryKey = widgets.find((w) => w.hasPrimaryAction)?.key;
  const firstName = (me.employee?.name ?? me.user.name).split(' ')[0];
  return (
    <div className="flex flex-col gap-6">
      <section className="bm-stage rounded-card border border-line bg-surface">
        <div className="bm-glow" aria-hidden="true" />
        <div className="bm-dotgrid" aria-hidden="true" />
        <div className="bm-stage-content flex flex-col gap-2 px-6 py-8 sm:px-8">
          <Eyebrow>{t('app.company')}</Eyebrow>
          <h1 tabIndex={-1} className="font-display text-[32px] leading-tight font-semibold tracking-tight">
            {t('dashboard.greeting', { name: firstName })}
          </h1>
          <p className="text-text-2">{t('dashboard.today', { date: formatDate(todayIso()) })}</p>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {widgets.map((w) => (
          <div key={w.key} className={SPAN[w.span]}>
            <w.Component me={me} primary={w.key === primaryKey} />
          </div>
        ))}
      </div>
    </div>
  );
}
