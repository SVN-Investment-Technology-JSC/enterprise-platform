import {
  ArrowRightLeft,
  BanknoteArrowDown,
  BanknoteArrowUp,
  ChartPie,
  LayoutDashboard,
  SlidersHorizontal,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { FinanceVoucherKind } from '@enterprise-platform/contracts-finance';

export interface FinanceNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Màu biểu tượng (lớp Tailwind): thu xanh lá, chi đỏ, chuyển tiền xanh dương để nhận ra ngay không cần đọc chữ. */
  tone: string;
  href: string;
}

/** Biểu tượng và màu của từng loại phiếu, dùng chung cho menu, nút tạo nhanh và tiêu đề trang. */
export const FINANCE_KIND_ICON: Readonly<Record<FinanceVoucherKind, { icon: LucideIcon; tone: string }>> = {
  RECEIPT: { icon: BanknoteArrowDown, tone: 'text-emerald-600' },
  PAYMENT: { icon: BanknoteArrowUp, tone: 'text-rose-600' },
  TRANSFER: { icon: ArrowRightLeft, tone: 'text-sky-600' },
};

/** Menu Tài chính. Quyền hiện từng mục: `canOpenPage` (finance-permissions.tsx), dùng chung cho menu và chặn trang. */
export const financeNavigation: readonly FinanceNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, tone: 'text-violet-600', href: '/' },
  { id: 'receipts', label: 'Phiếu thu', icon: FINANCE_KIND_ICON.RECEIPT.icon, tone: FINANCE_KIND_ICON.RECEIPT.tone, href: '/receipts' },
  { id: 'payments', label: 'Phiếu chi', icon: FINANCE_KIND_ICON.PAYMENT.icon, tone: FINANCE_KIND_ICON.PAYMENT.tone, href: '/payments' },
  { id: 'transfers', label: 'Chuyển tiền', icon: FINANCE_KIND_ICON.TRANSFER.icon, tone: FINANCE_KIND_ICON.TRANSFER.tone, href: '/transfers' },
  { id: 'accounts', label: 'Tài khoản', icon: WalletCards, tone: 'text-indigo-600', href: '/accounts' },
  { id: 'reports', label: 'Báo cáo', icon: ChartPie, tone: 'text-amber-600', href: '/reports' },
  { id: 'settings', label: 'Tùy chỉnh', icon: SlidersHorizontal, tone: 'text-slate-600', href: '/settings' },
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
