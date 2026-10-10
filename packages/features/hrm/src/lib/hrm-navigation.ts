import {
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileText,
  Home,
  Sliders,
  TrendingUp,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  badge?: string;
  children?: NavItem[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Menu HRM (9 mục, các chức năng liên quan gộp thành tab của một trang `?view=`). Quyền hiện từng mục nằm ở một nơi duy nhất: `hrmPagePermissions` (hrm-permissions.tsx),
 * dùng chung cho ẩn menu và chặn trang. Nhóm không còn mục nào sau khi lọc quyền sẽ bị ẩn.
 */
export const hrmNavigationSections: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      { id: 'dashboard', label: 'Bàn làm việc', icon: Home, href: '/' },
      { id: 'request_processing', label: 'Đơn từ cần xử lý', icon: ClipboardCheck, href: '/approvals' },
    ],
  },
  {
    title: 'CÁ NHÂN',
    items: [
      { id: 'my_work', label: 'Công của tôi', icon: Clock, href: '/my-work' },
      { id: 'requests', label: 'Đơn từ của tôi', icon: FileText, href: '/requests' },
      { id: 'profile', label: 'Hồ sơ và lương', icon: UserCircle, href: '/profile' },
    ],
  },
  {
    title: 'QUẢN LÝ',
    items: [
      { id: 'people', label: 'Nhân sự', icon: Users, href: '/employees' },
      { id: 'timekeeping', label: 'Chấm công và ca', icon: CalendarClock, href: '/timekeeping' },
      { id: 'payroll', label: 'Lương và chi trả', icon: TrendingUp, href: '/payroll' },
    ],
  },
  {
    title: 'HỆ THỐNG',
    items: [{ id: 'settings', label: 'Cấu hình', icon: Sliders, href: '/settings' }],
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
export const hrmNavigation = hrmNavigationSections.flatMap((section) =>
  section.items.flatMap((item) => item.children ?? [item]),
);

/** Tiêu đề trang theo đường dẫn (lấy từ nhãn menu, một nguồn duy nhất). */
export function hrmPageTitle(pathname: string): string | undefined {
  const path = normalizeHrmPath(pathname);
  return hrmNavigation.find((item) => item.href === path)?.label;
}

/** Nhóm có chứa trang đang mở (nhóm này luôn được mở). */
export function sectionContainsNav(
  section: NavSection,
  activeNavId: string | null,
): boolean {
  return (
    !!activeNavId &&
    section.items.some(
      (item) =>
        item.id === activeNavId ||
        item.children?.some((c) => c.id === activeNavId),
    )
  );
}

/** Khóa lưu trạng thái thu gọn các nhóm menu. */
export const NAV_COLLAPSED_STORAGE_KEY = 'hrm_nav_collapsed_groups';

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

/**
 * Tab của trang Lương (/payroll/settings). Tab hiển thị khi người dùng có BẤT KỲ quyền nào trong
 * `permissions`; tab mặc định là tab đầu tiên được phép.
 */
export const PAYROLL_SETTINGS_TABS = [
  { id: 'formula', label: 'Công thức', permissions: ['hrm.payroll.configure'] },
  { id: 'employee-params', label: 'Tham số nhân viên', permissions: ['hrm.payroll.configure'] },
  { id: 'grades', label: 'Ngạch và bậc', permissions: ['hrm.salary.read', 'hrm.salary.manage'] },
  { id: 'profiles', label: 'Hồ sơ lương', permissions: ['hrm.salary.read', 'hrm.salary.manage'] },
  { id: 'sod', label: 'Tách nhiệm vụ', permissions: ['hrm.payroll.configure'] },
] as const;

export type PayrollSettingsTabId = (typeof PAYROLL_SETTINGS_TABS)[number]['id'];

export function resolvePayrollSettingsTab(
  tab: string | null,
  allowed: readonly string[],
) {
  return tab && allowed.includes(tab) ? tab : allowed[0] || '';
}


