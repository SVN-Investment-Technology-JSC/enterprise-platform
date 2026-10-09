import {
  Briefcase,
  Calendar,
  ClipboardList,
  Clock,
  Coins,
  FileSpreadsheet,
  FileText,
  Home,
  Sliders,
  TrendingUp,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  isInteractive: boolean;
  badge?: string;
  children?: NavItem[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const hrmNavigationSections: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      {
        id: 'dashboard',
        label: 'Bàn làm việc (Dashboard)',
        icon: Home,
        href: '/',
        isInteractive: true,
      },
    ],
  },
  {
    title: 'CÁ NHÂN',
    items: [
      {
        id: 'calendar',
        label: 'Lịch & Thông báo',
        icon: Calendar,
        href: '/calendar',
        isInteractive: true,
      },
      {
        id: 'attendance',
        label: 'Chấm công',
        icon: Clock,
        href: '/attendance',
        isInteractive: true,
      },
      {
        id: 'requests',
        label: 'Đơn từ & Yêu cầu',
        icon: FileText,
        href: '/requests',
        isInteractive: true,
      },
      {
        id: 'profile',
        label: 'Hồ sơ của tôi',
        icon: UserCircle,
        href: '/profile',
        isInteractive: true,
      },
      {
        id: 'payslips',
        label: 'Phiếu lương',
        icon: Coins,
        href: '/payslips',
        isInteractive: true,
      },
    ],
  },
  {
    title: 'VẬN HÀNH',
    items: [
      {
        id: 'employees',
        label: 'Nhân sự & Chức danh',
        icon: Users,
        href: '/employees',
        isInteractive: true,
      },
      {
        id: 'shift_management',
        label: 'Quản lý Ca & Chấm công',
        icon: Calendar,
        href: '/shifts',
        isInteractive: true,
      },
      {
        id: 'request_processing',
        label: 'Xử lý Đơn từ',
        icon: ClipboardList,
        href: '/approvals',
        isInteractive: true,
      },
      {
        id: 'timesheets',
        label: 'Bảng công tổng hợp',
        icon: FileSpreadsheet,
        href: '/timesheets',
        isInteractive: true,
      },
      {
        id: 'payroll_payout',
        label: 'Tiền lương & Chi trả',
        icon: TrendingUp,
        href: '/payroll',
        isInteractive: true,
      },
      {
        id: 'salary_advances',
        label: 'Ứng và thu hồi lương',
        icon: Coins,
        href: '/payroll/advances',
        isInteractive: true,
      },
    ],
  },
  {
    title: 'QUẢN TRỊ & HỆ THỐNG',
    items: [
      {
        id: 'leave_settings',
        label: 'Quỹ phép',
        icon: Calendar,
        href: '/leave-settings',
        isInteractive: true,
      },
      {
        id: 'request_catalog',
        label: 'Danh mục đơn từ',
        icon: ClipboardList,
        href: '/request-catalog',
        isInteractive: true,
      },
      {
        id: 'time_settings',
        label: 'Cấu hình công & thiết bị',
        icon: Briefcase,
        href: '/policies',
        isInteractive: true,
      },
      {
        id: 'payroll_settings',
        label: 'Cấu hình lương',
        icon: Coins,
        href: '/payroll/settings',
        isInteractive: true,
      },
      {
        id: 'operations',
        label: 'Vận hành & Tích hợp',
        icon: Sliders,
        href: '/operations',
        isInteractive: true,
      },
      {
        id: 'permissions',
        label: 'Danh mục quyền HRM',
        icon: Users,
        href: '/permissions',
        isInteractive: true,
      },
    ],
  },
];
/** Ẩn mục menu mà người dùng không có quyền (cùng nguồn quyền với kiểm tra route trong shell). */
export function filterHrmNavigation<A extends string>(
  sections: readonly NavSection[],
  pagePermissions: Record<string, readonly A[]>,
  any: (permissions: readonly A[]) => boolean,
): NavSection[] {
  const allowed = (item: NavItem) =>
    !item.href || !pagePermissions[item.href] || any(pagePermissions[item.href]);
  return sections
    .map((sec) => ({
      ...sec,
      items: sec.items
        .map((item) => {
          if (item.children?.length) {
            const children = item.children.filter(allowed);
            return children.length ? { ...item, children } : null;
          }
          return allowed(item) ? item : null;
        })
        .filter((item): item is NavItem => Boolean(item)),
    }))
    .filter((sec) => sec.items.length);
}
export const hrmNavigation = hrmNavigationSections.flatMap(
  (section) =>
    section.items.flatMap((item) => item.children ?? [item]),
);

export function normalizeHrmPath(pathname: string) {
  return (
    pathname
      .split(/[?#]/)[0]
      .replace(/^\/modules\/hrm(?=\/|$)/, '')
      .replace(/\/+$/, '') || '/'
  );
}

export function getActiveHrmNavId(pathname: string): string | null {
  const path = normalizeHrmPath(pathname);
  return (
    hrmNavigation
      .filter(
        (item) =>
          item.href &&
          (path === item.href ||
            (item.href !== '/' && path.startsWith(item.href + '/'))),
      )
      .sort((a, b) => (b.href?.length || 0) - (a.href?.length || 0))[0]
      ?.id || null
  );
}

export function resolveTimeSettingsTab(
  tab: string | null,
  allowed: readonly string[],
) {
  return tab && allowed.includes(tab) ? tab : allowed[0] || '';
}

export const LEAVE_SETTINGS_TABS = [
  { id: 'types', label: 'Danh mục loại nghỉ', permission: 'hrm.leave.read' },
  { id: 'ledger', label: 'Quỹ và sổ giao dịch', permission: 'hrm.leave.read' },
  { id: 'schedules', label: 'Lịch cộng phép & Thâm niên', permission: 'hrm.leave.read' },
] as const;

export type LeaveSettingsTabId = (typeof LEAVE_SETTINGS_TABS)[number]['id'];

export function resolveLeaveSettingsTab(
  tab: string | null,
  allowed: readonly string[],
) {
  return tab && allowed.includes(tab) ? tab : allowed[0] || '';
}

export const PAYROLL_SETTINGS_TABS = [
  { id: 'policies', label: 'Danh sách chính sách', permission: 'hrm.payroll.configure' },
  { id: 'inputs', label: 'Tham số lương theo nhân viên', permission: 'hrm.payroll.configure' },
] as const;

export type PayrollSettingsTabId = (typeof PAYROLL_SETTINGS_TABS)[number]['id'];

export function resolvePayrollSettingsTab(
  tab: string | null,
  allowed: readonly string[],
) {
  return tab && allowed.includes(tab) ? tab : allowed[0] || '';
}


