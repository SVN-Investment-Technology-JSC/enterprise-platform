import type { FinanceVoucherKind, FinanceVoucherStatus } from '@enterprise-platform/contracts-finance';

/** Nhãn riêng của từng loại phiếu: một nơi duy nhất cho danh sách, form và chi tiết. */
export interface FinanceKindConfig {
  kind: FinanceVoucherKind;
  path: '/receipts' | '/payments' | '/transfers';
  listTitle: string;
  createTitle: string;
  singular: string;
  codeLabel: string;
  dateLabel: string;
  contentLabel: string;
  contentPlaceholder: string;
  reasonLabel: string;
  accountLabel: string;
  counterpartyLabel: string;
  detailTitle: string;
  lineDescriptionPlaceholder: string;
  /** Phiếu có chi tiết dòng, lý do, đối tượng (thu/chi) hay chỉ có hai tài khoản (chuyển tiền). */
  hasLines: boolean;
}

export const FINANCE_KIND_CONFIG: Readonly<Record<FinanceVoucherKind, FinanceKindConfig>> = {
  RECEIPT: {
    kind: 'RECEIPT',
    path: '/receipts',
    listTitle: 'Danh sách phiếu thu',
    createTitle: 'Tạo mới phiếu thu',
    singular: 'phiếu thu',
    codeLabel: 'Mã phiếu thu',
    dateLabel: 'Ngày thu',
    contentLabel: 'Nội dung thu',
    contentPlaceholder: 'Nội dung thu',
    reasonLabel: 'Lý do thu',
    accountLabel: 'Tài khoản thu',
    counterpartyLabel: 'Đối tượng thu',
    detailTitle: 'Chi tiết thu',
    lineDescriptionPlaceholder: 'Diễn giải chi tiết cho lý do thu',
    hasLines: true,
  },
  PAYMENT: {
    kind: 'PAYMENT',
    path: '/payments',
    listTitle: 'Danh sách phiếu chi',
    createTitle: 'Tạo mới phiếu chi',
    singular: 'phiếu chi',
    codeLabel: 'Mã phiếu chi',
    dateLabel: 'Ngày chi',
    contentLabel: 'Nội dung chi',
    contentPlaceholder: 'Nội dung chi',
    reasonLabel: 'Lý do chi',
    accountLabel: 'Tài khoản chi',
    counterpartyLabel: 'Đối tượng chi',
    detailTitle: 'Chi tiết chi',
    lineDescriptionPlaceholder: 'Diễn giải chi tiết cho lý do chi',
    hasLines: true,
  },
  TRANSFER: {
    kind: 'TRANSFER',
    path: '/transfers',
    listTitle: 'Danh sách lệnh chuyển tiền',
    createTitle: 'Tạo mới phiếu chuyển tiền',
    singular: 'lệnh chuyển tiền',
    codeLabel: 'Mã phiếu chuyển tiền',
    dateLabel: 'Ngày chuyển',
    contentLabel: 'Lý do',
    contentPlaceholder: 'Lý do chuyển tiền',
    reasonLabel: 'Lý do',
    accountLabel: 'Tài khoản nguồn',
    counterpartyLabel: '',
    detailTitle: 'Thông tin chuyển tiền',
    lineDescriptionPlaceholder: '',
    hasLines: false,
  },
};

export const kindOfPath = (path: string): FinanceVoucherKind | null =>
  (Object.values(FINANCE_KIND_CONFIG).find((config) => path === config.path)?.kind) ?? null;

/** Màu nhãn trạng thái (Tailwind), tương phản đủ trên nền trắng. */
export const FINANCE_STATUS_STYLE: Readonly<Record<FinanceVoucherStatus, string>> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
