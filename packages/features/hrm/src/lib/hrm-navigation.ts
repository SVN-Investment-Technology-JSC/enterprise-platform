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
          id: 'profile',
          label: 'Hồ sơ của tôi',
          icon: UserCircle,
          href: '/profile',
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
          id: 'dependents',
          label: 'Người phụ thuộc',
          icon: Users,
          href: '/dependents',
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
        {
          id: 'payroll_settings',
          label: 'Cấu hình lương',
          icon: Coins,
          href: '/payroll/settings',
          isInteractive: true,
        },
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
      ],
  },
];
export const hrmNavigation = hrmNavigationSections.flatMap(
  (section) => section.items,
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
