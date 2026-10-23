import type { Permission } from '@hrm/contracts';
import {
  Activity,
  Banknote,
  BarChart3,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock,
  FileText,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  key: string;
  to: string;
  icon: LucideIcon;
  /** Any one permission shows the item; empty means every signed-in user. */
  any: Permission[];
  badge?: 'approvals';
}

export interface NavGroup {
  key: 'none' | 'me' | 'team' | 'people' | 'payroll' | 'insights' | 'admin';
  items: NavItem[];
}

// INFORMATION-ARCHITECTURE §3.1: groups in this order; a group with no visible item is hidden.
export const NAV: NavGroup[] = [
  { key: 'none', items: [{ key: 'dashboard', to: '/dashboard', icon: LayoutDashboard, any: [] }] },
  {
    key: 'me',
    items: [
      { key: 'myAttendance', to: '/attendance', icon: Clock, any: ['attendance.read.own'] },
      { key: 'myLeave', to: '/leave', icon: CalendarDays, any: ['leave.request.own'] },
      { key: 'myClaims', to: '/reimbursements', icon: Receipt, any: ['reimbursement.request.own'] },
      { key: 'myPayslips', to: '/payslips', icon: Wallet, any: ['payslip.read.own'] },
      { key: 'myDocuments', to: '/documents', icon: FileText, any: ['document.read.own'] },
    ],
  },
  {
    key: 'team',
    items: [
      { key: 'approvals', to: '/approvals', icon: Inbox, any: ['approval.inbox'], badge: 'approvals' },
      { key: 'teamAttendance', to: '/attendance/team', icon: ClipboardCheck, any: ['attendance.read.team'] },
      {
        key: 'leaveCalendar',
        to: '/leave/calendar',
        icon: CalendarRange,
        any: ['leave.read.team', 'leave.read.all'],
      },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'employees', to: '/employees', icon: Users, any: ['employee.read.all', 'employee.read.team'] },
      { key: 'attendanceRecords', to: '/attendance/records', icon: Clock, any: ['attendance.read.all'] },
      { key: 'leaveManagement', to: '/leave/manage', icon: CalendarDays, any: ['leave.read.all'] },
      { key: 'claims', to: '/reimbursements/manage', icon: Receipt, any: ['reimbursement.read.all'] },
    ],
  },
  {
    key: 'payroll',
    items: [
      { key: 'payrollRuns', to: '/payroll', icon: Banknote, any: ['payroll.read.all'] },
      {
        key: 'salaryStructures',
        to: '/payroll/salary-structures',
        icon: Wallet,
        any: ['compensation.read.all'],
      },
      { key: 'adjustments', to: '/payroll/adjustments', icon: SlidersHorizontal, any: ['payroll.read.all'] },
    ],
  },
  {
    key: 'insights',
    items: [
      {
        key: 'reports',
        to: '/reports',
        icon: BarChart3,
        any: ['report.hr', 'report.payroll', 'report.team'],
      },
      {
        key: 'audit',
        to: '/audit',
        icon: ScrollText,
        any: ['audit.read.all', 'audit.read.payroll', 'audit.read.technical'],
      },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'settings', to: '/settings/company', icon: Settings, any: ['settings.read'] },
      { key: 'users', to: '/settings/users', icon: UserCog, any: ['user.manage'] },
      { key: 'roles', to: '/settings/roles', icon: Shield, any: ['role.manage'] },
      { key: 'system', to: '/settings/system', icon: Activity, any: ['system.health.read'] },
    ],
  },
];

export function visibleNav(permissions: readonly string[]) {
  const has = (any: Permission[]) => any.length === 0 || any.some((p) => permissions.includes(p));
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => has(i.any)) })).filter(
    (g) => g.items.length > 0,
  );
}
