import {
  Button,
  cn,
  Logo,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  Sheet,
  Tooltip,
} from '@hrm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  CalendarDays,
  Clock,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Shield,
  SlidersHorizontal,
  Sun,
  User,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api/client';
import { authClient } from '../lib/auth/auth-client';
import { can, useMe } from '../lib/auth/me';
import { useTheme } from '../lib/theme';
import { visibleNav } from './nav';

const PRIVILEGED = ['system_admin', 'hr_admin', 'payroll_officer', 'director', 'auditor'];

function useInboxCount(enabled: boolean) {
  return useQuery({
    queryKey: ['approvals', 'inbox', 'count'],
    queryFn: () =>
      api
        .get<{ page: { totalItems: number } }>('/approvals/inbox', { query: { pageSize: 1 } })
        .then((r) => r.page.totalItems),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function SidebarNav({ onNavigate, enrolOnly }: { onNavigate?: () => void; enrolOnly?: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const inbox = useInboxCount(can(me, 'approval.inbox'));
  const path = useRouterState({ select: (s) => s.location.pathname });
  const groups = visibleNav(me?.permissions ?? []);
  return (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-5 px-3 py-4">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {group.key !== 'none' ? (
            <p className="px-3 pb-1 font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">
              {t(`nav.groups.${group.key}`)}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                path === item.to ||
                (item.to !== '/dashboard' &&
                  path.startsWith(`${item.to}/`) &&
                  !groups.some((g) =>
                    g.items.some(
                      (o) => o.to !== item.to && o.to.startsWith(item.to) && path.startsWith(o.to),
                    ),
                  ));
              const count = item.badge === 'approvals' ? inbox.data : undefined;
              return (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    disabled={enrolOnly}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-9 items-center gap-3 rounded-control px-3 text-[15px] text-text hover:bg-ground-2',
                      active &&
                        'bg-accent-tint before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent',
                      enrolOnly && 'pointer-events-none opacity-50',
                    )}
                  >
                    <item.icon
                      className={cn('size-5 shrink-0', active ? 'text-accent' : 'text-text-2')}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{t(`nav.${item.key}`)}</span>
                    {count ? (
                      <span className="rounded-pill bg-ground-2 px-2 font-mono text-xs tabular-nums">
                        <span aria-hidden="true">{count}</span>
                        <span className="sr-only">{t('nav.approvalsWaiting', { count })}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;
  const signOut = async () => {
    await authClient.signOut().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${initials(me.user.name)}, ${t('nav.userMenu')}`}
          className="grid size-9 cursor-pointer place-items-center rounded-full border border-line-strong bg-ground-2 font-mono text-sm font-medium"
        >
          {initials(me.user.name)}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block font-medium text-text">{me.user.name}</span>
          <span className="block">{me.user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        {me.employee ? (
          <MenuItem onSelect={() => navigate({ to: '/me' })}>
            <User aria-hidden="true" />
            {t('nav.profile')}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={() => navigate({ to: '/me/security' })}>
          <Shield aria-hidden="true" />
          {t('nav.security')}
        </MenuItem>
        <MenuItem onSelect={() => navigate({ to: '/me/preferences' })}>
          <SlidersHorizontal aria-hidden="true" />
          {t('nav.preferences')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t('nav.signOut')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const label = theme === 'ink' ? t('theme.toLight') : t('theme.toDark');
  return (
    <Tooltip content={label}>
      <Button variant="icon" size="icon" aria-label={label} onClick={() => void toggle()}>
        {theme === 'ink' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </Tooltip>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const fourth = can(me, 'approval.inbox')
    ? { to: '/approvals', label: t('nav.approvals'), icon: Inbox }
    : { to: '/payslips', label: t('nav.payslips'), icon: Wallet };
  const items = [
    { to: '/dashboard', label: t('nav.home'), icon: LayoutDashboard },
    { to: '/attendance', label: t('nav.attendance'), icon: Clock },
    { to: '/leave', label: t('nav.leave'), icon: CalendarDays },
    fourth,
  ];
  return (
    <>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ground pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {items.map((i) => (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={path.startsWith(i.to) ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-xs text-text-2',
                  path.startsWith(i.to) && 'text-text',
                )}
              >
                <i.icon
                  className={cn('size-5', path.startsWith(i.to) && 'text-accent')}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                {i.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-14 w-full cursor-pointer flex-col items-center justify-center gap-0.5 text-xs text-text-2"
            >
              <MoreHorizontal className="size-5" strokeWidth={1.5} aria-hidden="true" />
              {t('common.more')}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={setOpen} title={t('nav.main')}>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

/** Authenticated layout (INFORMATION-ARCHITECTURE §3–§4, COMPONENT-SPECS §18–§19). */
export function AppShell({ children, enrolOnly = false }: { children: ReactNode; enrolOnly?: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const { theme } = useTheme();
  const [drawer, setDrawer] = useState(false);
  const inbox = useInboxCount(can(me, 'approval.inbox'));
  const employeeOnly = Boolean(me && !me.roles.some((r) => PRIVILEGED.includes(r)));

  return (
    <div className="min-h-screen bg-ground text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 overflow-y-auto border-r border-line lg:block">
          <div className="flex h-14 items-center border-b border-line px-5">
            <Link to="/dashboard" aria-label="Dashboard">
              <Logo theme={theme} />
            </Link>
          </div>
          <SidebarNav enrolOnly={enrolOnly} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-ground px-3 sm:px-6">
            <Button
              variant="icon"
              size="icon"
              className="lg:hidden"
              aria-label={t('nav.menu')}
              onClick={() => setDrawer(true)}
            >
              <Menu aria-hidden="true" />
            </Button>
            <Link to="/dashboard" className="lg:hidden" aria-label="Dashboard">
              <Logo theme={theme} className="h-7 min-w-0" />
            </Link>
            <div className="flex-1" />
            {can(me, 'approval.inbox') ? (
              <Tooltip content={t('nav.approvals')}>
                <Button variant="icon" size="icon" asChild>
                  <Link
                    to="/approvals"
                    aria-label={
                      inbox.data ? t('nav.approvalsWaiting', { count: inbox.data }) : t('nav.approvals')
                    }
                    className="relative"
                  >
                    <Inbox aria-hidden="true" />
                    {inbox.data ? (
                      <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-pill bg-action px-1 font-mono text-[10px] text-on-action">
                        {inbox.data}
                      </span>
                    ) : null}
                  </Link>
                </Button>
              </Tooltip>
            ) : null}
            <ThemeToggle />
            <UserMenu />
          </header>
          <main
            id="main"
            className={cn(
              'mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:py-8',
              employeeOnly && 'pb-24 md:pb-8',
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <Sheet open={drawer} onOpenChange={setDrawer} title={t('nav.main')}>
        <div className="flex h-14 items-center border-b border-line px-5">
          <Logo theme={theme} />
        </div>
        <SidebarNav onNavigate={() => setDrawer(false)} enrolOnly={enrolOnly} />
      </Sheet>
      {employeeOnly && !enrolOnly ? <BottomNav /> : null}
    </div>
  );
}
