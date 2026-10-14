import {
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowDownToLine,
  Landmark,
  LayoutDashboard,
  PieChart,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

export interface FinanceNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
}

/** Menu Tài chính. Quyền hiện từng mục: `canOpenPage` (finance-permissions.tsx), dùng chung cho menu và chặn trang. */
export const financeNavigation: readonly FinanceNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'receipts', label: 'Phiếu thu', icon: ArrowDownToLine, href: '/receipts' },
  { id: 'payments', label: 'Phiếu chi', icon: ArrowUpFromLine, href: '/payments' },
  { id: 'transfers', label: 'Chuyển tiền', icon: ArrowLeftRight, href: '/transfers' },
  { id: 'accounts', label: 'Tài khoản', icon: Landmark, href: '/accounts' },
  { id: 'reports', label: 'Báo cáo', icon: PieChart, href: '/reports' },
  { id: 'settings', label: 'Tùy chỉnh', icon: Settings2, href: '/settings' },
];

export function normalizeFinancePath(pathname: string): string {
  return (
    pathname
      .split(/[?#]/)[0]
      .replace(/^\/modules\/finance(?=\/|$)/, '')
      .replace(/\/+$/, '') || '/'
  );
}

/** Mục menu đang mở: khớp tiền tố dài nhất, để `/receipts/new` và `/receipts/<id>` vẫn sáng mục Phiếu thu. */
export function getActiveFinanceNavId(pathname: string): string | null {
  const path = normalizeFinancePath(pathname);
  return (
    [...financeNavigation]
      .filter((item) => path === item.href || (item.href !== '/' && path.startsWith(`${item.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.id ?? null
  );
}

/** Đường dẫn trang danh sách của từng loại phiếu. */
export const FINANCE_KIND_PATH = { RECEIPT: '/receipts', PAYMENT: '/payments', TRANSFER: '/transfers' } as const;
