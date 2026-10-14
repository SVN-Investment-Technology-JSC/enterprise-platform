/**
 * Tab "Thu chi" của dự án: phiếu thu/chi do module Tài chính quản lý, hiển thị ở đây để người quản lý dự án thấy tiền của dự án.
 *
 * Kiểu dữ liệu khai tại chỗ (cùng cách `workspace-projects.ts` bên HRM): gói `feature-workspace` không phụ thuộc hợp đồng của
 * module khác. Hình dạng khớp `FinanceProjectVoucherList` trong `contracts-finance`; Tài chính là bên sở hữu và quyết quyền xem.
 */

export type ProjectVoucherKind = 'RECEIPT' | 'PAYMENT';
export type ProjectVoucherStatus = 'PENDING' | 'APPROVED';
export type ProjectVoucherLink = 'ALLOCATION' | 'RELATED';

export interface ProjectVoucher {
  readonly id: string;
  readonly kind: ProjectVoucherKind;
  readonly code: string;
  readonly voucherDate: string;
  readonly content: string;
  readonly reasonName: string | null;
  readonly status: ProjectVoucherStatus;
  readonly totalAmount: number;
  /** ALLOCATION: hạch toán cho dự án hoặc công việc của dự án (được cộng vào tổng); RELATED: chỉ liên quan (không cộng). */
  readonly link: ProjectVoucherLink;
  readonly workItem: { readonly id: string; readonly code: string; readonly title: string } | null;
  readonly createdByName: string | null;
}

export interface ProjectVoucherTotals {
  readonly received: number;
  readonly paid: number;
  readonly pendingReceived: number;
  readonly pendingPaid: number;
  readonly receiptCount: number;
  readonly paymentCount: number;
}

export interface ProjectVoucherList {
  readonly items: readonly ProjectVoucher[];
  readonly totals: ProjectVoucherTotals;
  readonly truncated: boolean;
}

export const PROJECT_VOUCHER_KIND_LABELS: Readonly<Record<ProjectVoucherKind, string>> = {
  RECEIPT: 'Phiếu thu',
  PAYMENT: 'Phiếu chi',
};

export const PROJECT_VOUCHER_STATUS_LABELS: Readonly<Record<ProjectVoucherStatus, string>> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
};

export const PROJECT_VOUCHER_STATUS_TONE: Readonly<Record<ProjectVoucherStatus, { bg: string; fg: string }>> = {
  PENDING: { bg: 'rgb(245 158 11 / 18%)', fg: '#92400e' },
  APPROVED: { bg: 'rgb(16 185 129 / 15%)', fg: '#047857' },
};

export const PROJECT_VOUCHER_LINK_LABELS: Readonly<Record<ProjectVoucherLink, string>> = {
  ALLOCATION: 'Hạch toán',
  RELATED: 'Liên quan',
};

/** Đường mở phiếu ở module Tài chính (cùng cấu trúc đường dẫn màn Tài chính: /receipts/:id, /payments/:id). */
export function projectVoucherHref(voucher: Pick<ProjectVoucher, 'kind' | 'id'>): string {
  return `/modules/finance/${voucher.kind === 'RECEIPT' ? 'receipts' : 'payments'}/${encodeURIComponent(voucher.id)}`;
}

export interface ProjectVoucherFilter {
  readonly kind: 'all' | ProjectVoucherKind;
  readonly link: 'all' | ProjectVoucherLink;
  readonly status: 'all' | ProjectVoucherStatus;
}

export const NO_VOUCHER_FILTER: ProjectVoucherFilter = { kind: 'all', link: 'all', status: 'all' };

export function filterProjectVouchers(items: readonly ProjectVoucher[], filter: ProjectVoucherFilter): ProjectVoucher[] {
  return items.filter(
    (item) =>
      (filter.kind === 'all' || item.kind === filter.kind) &&
      (filter.link === 'all' || item.link === filter.link) &&
      (filter.status === 'all' || item.status === filter.status),
  );
}

/** Chênh lệch thu - chi của phần đã ghi sổ; âm nghĩa là dự án đang chi nhiều hơn thu. */
export function projectVoucherNet(totals: Pick<ProjectVoucherTotals, 'received' | 'paid'>): number {
  return Math.round((totals.received - totals.paid) * 100) / 100;
}

/** Kết quả đọc từ Tài chính: dữ liệu, hoặc lý do không có (để tab nói rõ thay vì để trống). */
export type ProjectVoucherResult =
  | { readonly state: 'ok'; readonly data: ProjectVoucherList }
  | { readonly state: 'forbidden'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string };

/** Phân loại phản hồi của Tài chính. 403: không có quyền (Workspace hoặc Tài chính từ chối); 404 không kèm thân JSON: module chưa bật. */
export async function classifyProjectVoucherResponse(response: Response): Promise<ProjectVoucherResult> {
  if (response.ok) {
    try {
      return { state: 'ok', data: (await response.json()) as ProjectVoucherList };
    } catch {
      return { state: 'unavailable', message: 'Tài chính trả về dữ liệu không đọc được.' };
    }
  }
  let body: { code?: string; message?: string } = {};
  try {
    body = (await response.json()) as { code?: string; message?: string };
  } catch {
    /* thân không phải JSON: gateway báo module chưa chạy */
  }
  if (response.status === 403)
    return {
      state: 'forbidden',
      message: body.message ?? 'Bạn không có quyền xem thu chi của dự án này.',
    };
  if (response.status === 404 && body.code === 'FINANCE_NOT_FOUND')
    return { state: 'unavailable', message: 'Không tìm thấy dự án ở module Tài chính.' };
  return {
    state: 'unavailable',
    message:
      body.code === 'FINANCE_WORKSPACE_UNAVAILABLE'
        ? (body.message ?? 'Tài chính chưa kết nối được Workspace.')
        : 'Module Tài chính chưa sẵn sàng cho tổ chức này.',
  };
}
