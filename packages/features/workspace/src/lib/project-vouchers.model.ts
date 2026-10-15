/**
 * Thu chi của dự án trong tab "Tài chính": phiếu thu/chi do module Tài chính quản lý, hiển thị ở đây để người quản lý dự án thấy
 * tiền của dự án. Chi phí thực tế của dự án và của từng công việc là tổng phiếu CHI ĐÃ DUYỆT hạch toán cho chúng.
 *
 * Kiểu dữ liệu khai tại chỗ (cùng cách `workspace-projects.ts` bên HRM): gói `feature-workspace` không phụ thuộc hợp đồng của
 * module khác. Hình dạng khớp `FinanceProjectVoucherList` trong `contracts-finance`; Tài chính là bên sở hữu và quyết quyền xem.
 */
import type { WorkItemCost } from '@enterprise-platform/contracts-workspace';

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

export interface ProjectWorkItemTotals extends ProjectVoucherTotals {
  readonly workItemId: string;
  readonly code: string;
  readonly title: string;
}

export interface ProjectVoucherList {
  readonly items: readonly ProjectVoucher[];
  /** Mọi phiếu hạch toán cho dự án = phần chung (`projectLevel`) + các công việc (`workItems`). */
  readonly totals: ProjectVoucherTotals;
  /** Hạch toán cho cả dự án, không gắn công việc nào. */
  readonly projectLevel: ProjectVoucherTotals;
  readonly workItems: readonly ProjectWorkItemTotals[];
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

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Một dòng bảng "Thu chi theo công việc"; `workItemId` rỗng là dòng chi chung của cả dự án. */
export interface WorkItemMoneyRow {
  readonly workItemId: string | null;
  readonly code: string;
  readonly title: string;
  /** Rỗng với dòng chung và với công việc chỉ có trong Tài chính (không còn ở Workspace). */
  readonly status: WorkItemCost['status'] | null;
  readonly received: number;
  /** Chi đã duyệt = chi phí thực tế của công việc. */
  readonly paid: number;
  readonly pendingReceived: number;
  readonly pendingPaid: number;
  /** Thu - chi đã ghi sổ. */
  readonly balance: number;
}

const rowOf = (
  base: Pick<WorkItemMoneyRow, 'workItemId' | 'code' | 'title' | 'status'>,
  totals: Pick<ProjectVoucherTotals, 'received' | 'paid' | 'pendingReceived' | 'pendingPaid'> | undefined,
): WorkItemMoneyRow => ({
  ...base,
  received: totals?.received ?? 0,
  paid: totals?.paid ?? 0,
  pendingReceived: totals?.pendingReceived ?? 0,
  pendingPaid: totals?.pendingPaid ?? 0,
  balance: round2((totals?.received ?? 0) - (totals?.paid ?? 0)),
});

/**
 * Ghép công việc của Workspace với thu/chi của Tài chính theo mã công việc.
 *
 * Công việc của Workspace luôn có dòng (kể cả khi chưa phát sinh tiền) để người dùng thấy việc nào chưa có phiếu. Công việc có tiền
 * ở Tài chính mà Workspace không còn trả về (đã huỷ, bị gỡ) vẫn hiện, lấy nhãn Tài chính đã chụp, để tổng các dòng khớp tổng dự án.
 */
export function buildWorkItemMoneyRows(
  workItems: readonly Pick<WorkItemCost, 'workItemId' | 'code' | 'title' | 'status'>[],
  list: Pick<ProjectVoucherList, 'workItems'>,
): WorkItemMoneyRow[] {
  const money = new Map(list.workItems.map((entry) => [entry.workItemId, entry]));
  const known = new Set<string>();
  const rows = workItems.map((item) => {
    known.add(item.workItemId);
    return rowOf({ workItemId: item.workItemId, code: item.code, title: item.title, status: item.status }, money.get(item.workItemId));
  });
  for (const entry of list.workItems)
    if (!known.has(entry.workItemId)) rows.push(rowOf({ workItemId: entry.workItemId, code: entry.code, title: entry.title, status: null }, entry));
  return rows;
}

/** Dòng "Chung cả dự án": thu chi hạch toán cho dự án mà không gắn công việc nào. */
export function projectLevelMoneyRow(list: Pick<ProjectVoucherList, 'projectLevel'>): WorkItemMoneyRow {
  return rowOf({ workItemId: null, code: '', title: 'Chung cả dự án (không gắn công việc)', status: null }, list.projectLevel);
}

/**
 * Lợi nhuận tạm tính = giá trị hợp đồng - chi phí thực tế (chi đã duyệt). Rỗng khi chưa nhập hợp đồng. Biên lợi nhuận tính theo
 * hợp đồng, làm tròn một chữ số thập phân, rỗng khi hợp đồng bằng 0.
 */
export function provisionalProfit(
  contractValue: number | null,
  actualCost: number,
): { readonly profit: number | null; readonly margin: number | null } {
  if (contractValue == null) return { profit: null, margin: null };
  const profit = round2(contractValue - actualCost);
  return { profit, margin: contractValue ? Math.round((profit / contractValue) * 1000) / 10 : null };
}

/** Còn phải thu theo hợp đồng; không âm (thu vượt hợp đồng thì không còn phải thu). Rỗng khi chưa nhập hợp đồng. */
export function receivableLeft(contractValue: number | null, received: number): number | null {
  return contractValue == null ? null : Math.max(round2(contractValue - received), 0);
}

const ZERO_TOTALS: ProjectVoucherTotals = { received: 0, paid: 0, pendingReceived: 0, pendingPaid: 0, receiptCount: 0, paymentCount: 0 };

/** Bản Tài chính cũ chưa trả phần chung và phần theo công việc: coi như chưa có, để màn hình không vỡ. */
export function normalizeProjectVoucherList(raw: Partial<ProjectVoucherList>): ProjectVoucherList {
  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    totals: raw.totals ?? ZERO_TOTALS,
    projectLevel: raw.projectLevel ?? ZERO_TOTALS,
    workItems: Array.isArray(raw.workItems) ? raw.workItems : [],
    truncated: Boolean(raw.truncated),
  };
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
      return { state: 'ok', data: normalizeProjectVoucherList((await response.json()) as Partial<ProjectVoucherList>) };
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
