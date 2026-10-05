import {
  Briefcase,
  Calendar,
  ClipboardList,
  Clock,
  Coins,
  FileSignature,
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
          id: 'personal_work',
          label: 'Công việc cá nhân',
          icon: Calendar,
          isInteractive: true,
          children: [
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
          ],
        },
        {
          id: 'personal_profile_income',
          label: 'Hồ sơ & Thu nhập',
          icon: UserCircle,
          isInteractive: true,
          children: [
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
      ],
    },
    {
      title: 'VẬN HÀNH',
      items: [
        {
          id: 'workforce_records',
          label: 'Nhân sự & Hồ sơ',
          icon: Users,
          isInteractive: true,
          children: [
            {
              id: 'employees',
              label: 'Nhân sự & Chức danh',
              icon: Users,
              href: '/employees',
              isInteractive: true,
            },
            {
              id: 'dependents',
              label: 'Người phụ thuộc',
              icon: Users,
              href: '/dependents',
              isInteractive: true,
            },
            {
              id: 'personnel_decisions',
              label: 'Quyết định nhân sự',
              icon: FileSignature,
              href: '/personnel-decisions',
              isInteractive: true,
            },
          ],
        },
        {
          id: 'time_and_requests',
          label: 'Ca, công & đơn từ',
          icon: Calendar,
          isInteractive: true,
          children: [
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
          ],
        },
        {
          id: 'payroll_operations',
          label: 'Tiền lương',
          icon: TrendingUp,
          isInteractive: true,
          children: [
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
      ],
    },
    {
      title: 'QUẢN TRỊ & HỆ THỐNG',
      items: [
        {
          id: 'hrm_configuration',
          label: 'Chính sách & cấu hình',
          icon: Sliders,
          isInteractive: true,
          children: [
            {
              id: 'leave_settings',
              label: 'Quỹ phép',
              icon: Calendar,
              href: '/leave-settings',
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
          ],
        },
        {
          id: 'system_integration',
          label: 'Hệ thống & tích hợp',
          icon: Sliders,
          isInteractive: true,
          children: [
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
      ],
  },
];
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


