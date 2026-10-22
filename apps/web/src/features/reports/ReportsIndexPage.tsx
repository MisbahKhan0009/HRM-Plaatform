import type { Permission } from '@hrm/contracts';
import { Card } from '@hrm/ui';
import { Link } from '@tanstack/react-router';
import { Banknote, CalendarDays, Clock, type LucideIcon, Receipt, Users } from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { canAny, useMe } from '../../lib/auth/me';

type ReportCard = {
  to:
    | '/reports/headcount'
    | '/reports/attendance'
    | '/reports/leave'
    | '/reports/payroll'
    | '/reports/reimbursements';
  title: string;
  description: string;
  icon: LucideIcon;
  any: Permission[];
};

// INFORMATION-ARCHITECTURE §2: the same permissions as each report's route guard.
export const REPORT_CARDS: ReportCard[] = [
  {
    to: '/reports/headcount',
    title: 'Headcount',
    description: 'Employees by department, position or status on any date.',
    icon: Users,
    any: ['report.hr'],
  },
  {
    to: '/reports/attendance',
    title: 'Attendance',
    description: 'Present, absent, short-hours and missing-punch days with worked time.',
    icon: Clock,
    any: ['report.hr', 'report.team'],
  },
  {
    to: '/reports/leave',
    title: 'Leave',
    description: 'Entitlement, use and balance per employee and leave type.',
    icon: CalendarDays,
    any: ['report.hr', 'report.team'],
  },
  {
    to: '/reports/payroll',
    title: 'Payroll',
    description: 'Register, deductions and payment reconciliation for a run.',
    icon: Banknote,
    any: ['report.payroll'],
  },
  {
    to: '/reports/reimbursements',
    title: 'Claims',
    description: 'Submitted transport claims, their decisions and payroll runs.',
    icon: Receipt,
    any: ['report.payroll', 'report.hr'],
  },
];

// SCREEN-INVENTORY 10.1: a card for each report the user may open.
export function ReportsIndexPage() {
  const me = useMe();
  const cards = REPORT_CARDS.filter((c) => canAny(me, c.any));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Each report shows only the records you may see. Exports are built in your browser."
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.to}>
            <Card className="relative flex h-full flex-col gap-2 transition-colors focus-within:border-accent hover:border-line-strong">
              <c.icon className="size-6 text-text-2" aria-hidden="true" strokeWidth={1.5} />
              <h2 className="font-display text-[17px] font-semibold">
                <Link to={c.to} className="after:absolute after:inset-0 hover:underline">
                  {c.title}
                </Link>
              </h2>
              <p className="text-text-2">{c.description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
