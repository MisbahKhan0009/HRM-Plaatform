import type { Permission } from '@hrm/contracts';
import { cn, Select } from '@hrm/ui';
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { canAny, useMe } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/settings')({ component: SettingsLayout });

const ITEMS: { to: string; label: string; any: Permission[] }[] = [
  { to: '/settings/company', label: 'Company', any: ['settings.read'] },
  { to: '/settings/hr', label: 'HR settings', any: ['settings.read', 'settings.hr.manage'] },
  { to: '/settings/departments', label: 'Departments', any: ['settings.read', 'org.manage'] },
  { to: '/settings/positions', label: 'Positions', any: ['settings.read', 'org.manage'] },
  {
    to: '/settings/work-schedules',
    label: 'Work schedules',
    any: ['attendance.manage', 'attendance.read.all'],
  },
  { to: '/settings/holidays', label: 'Holidays', any: ['settings.read'] },
  { to: '/settings/leave-types', label: 'Leave types', any: ['settings.read', 'leave.policy.manage'] },
  { to: '/settings/payroll', label: 'Payroll', any: ['settings.read', 'settings.payroll.manage'] },
  { to: '/settings/users', label: 'Users', any: ['user.manage'] },
  { to: '/settings/roles', label: 'Roles', any: ['role.manage', 'settings.read'] },
  { to: '/settings/system', label: 'System health', any: ['system.health.read'] },
];

// SCREEN-INVENTORY "Settings": sub-navigation on the left, a select on mobile.
function SettingsLayout() {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const items = ITEMS.filter((i) => canAny(me, i.any));
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
      <nav aria-label="Settings" className="lg:w-52 lg:shrink-0">
        <Select
          aria-label="Settings section"
          className="lg:hidden"
          value={path}
          onChange={(e) => void navigate({ to: e.target.value })}
        >
          {items.map((i) => (
            <option key={i.to} value={i.to}>
              {i.label}
            </option>
          ))}
        </Select>
        <ul className="hidden flex-col gap-0.5 lg:flex">
          {items.map((i) => (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={path === i.to ? 'page' : undefined}
                className={cn(
                  'block rounded-control px-3 py-2 text-[15px] hover:bg-ground-2',
                  path === i.to && 'bg-accent-tint',
                )}
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
