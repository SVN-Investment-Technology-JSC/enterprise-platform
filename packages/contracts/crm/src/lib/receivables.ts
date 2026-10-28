/**
 * Công nợ phải thu (GĐ5): sổ công nợ chỉ ghi thêm ở Bán hàng (D2), lần thu tiền
 * sinh phiếu thu nháp bên Tài chính qua phiếu có nguồn (Q10), phân bổ, điều
 * chỉnh có duyệt, tuổi nợ, hạn mức công nợ (D5).
 */

import type { CrmHistoryEntry } from './contracts.js';

// ---------------------------------------------------------------------------
// Hằng số, nhãn
// ---------------------------------------------------------------------------

/** Loại dòng sổ công nợ; `amount` của dòng là ảnh hưởng có dấu lên dư nợ. */
export const RECEIVABLE_ENTRY_KINDS = ['DEBIT', 'CREDIT', 'ADJUSTMENT', 'REVERSAL'] as const;
export type ReceivableEntryKind = (typeof RECEIVABLE_ENTRY_KINDS)[number];

export const RECEIVABLE_ENTRY_KIND_LABELS: Readonly<Record<ReceivableEntryKind, string>> = {
  DEBIT: 'Phát sinh nợ',
  CREDIT: 'Thu tiền',
  ADJUSTMENT: 'Điều chỉnh',
  REVERSAL: 'Bút đảo',
};

export const RECEIPT_STATUSES = ['PENDING_VOUCHER', 'VOUCHER_DRAFT', 'POSTED', 'RETURNED', 'REVERSED', 'CANCELLED'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Readonly<Record<ReceiptStatus, string>> = {
  PENDING_VOUCHER: 'Chờ tạo phiếu',
  VOUCHER_DRAFT: 'Chờ kế toán ghi sổ',
  POSTED: 'Đã ghi sổ',
  RETURNED: 'Bị trả lại, cần sửa',
  REVERSED: 'Phiếu đã bị đảo',
  CANCELLED: 'Đã huỷ',
};

export const RECEIPT_METHODS = ['CASH', 'BANK_TRANSFER'] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

export const RECEIPT_METHOD_LABELS: Readonly<Record<ReceiptMethod, string>> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
};

export const ADJUSTMENT_DIRECTIONS = ['DECREASE', 'INCREASE'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const ADJUSTMENT_DIRECTION_LABELS: Readonly<Record<AdjustmentDirection, string>> = {
  DECREASE: 'Giảm trừ công nợ',
  INCREASE: 'Tăng công nợ',
};

export const ADJUSTMENT_STATUSES = ['DRAFT', 'APPROVED', 'CANCELLED'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const ADJUSTMENT_STATUS_LABELS: Readonly<Record<AdjustmentStatus, string>> = {
  DRAFT: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  CANCELLED: 'Đã huỷ',
};

/**
 * Nhóm tuổi nợ theo số ngày quá hạn (TC-AR-05): chưa đến hạn; 0–30 (gồm đến hạn
 * hôm nay); 31–60; 61–90; trên 90.
 */
export const AGING_BUCKETS = ['NOT_DUE', 'D0_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Readonly<Record<AgingBucket, string>> = {
  NOT_DUE: 'Chưa đến hạn',
  D0_30: '0–30 ngày',
  D31_60: '31–60 ngày',
  D61_90: '61–90 ngày',
  D90_PLUS: 'Trên 90 ngày',
};

/** Điểm ghi nhận nợ (D3). Hiện chỉ có "khi chứng từ xuất giao hàng được ghi sổ". */
export const RECEIVABLE_RECOGNITION_MODES = ['ON_DELIVERY'] as const;
export type ReceivableRecognitionMode = (typeof RECEIVABLE_RECOGNITION_MODES)[number];

/** Vượt hạn mức công nợ khi xác nhận đơn (D5): đưa đi duyệt (mặc định) hoặc chặn. */
export const CREDIT_LIMIT_MODES = ['APPROVAL', 'BLOCK'] as const;
export type CreditLimitMode = (typeof CREDIT_LIMIT_MODES)[number];

export const CREDIT_LIMIT_MODE_LABELS: Readonly<Record<CreditLimitMode, string>> = {
  APPROVAL: 'Đưa đi duyệt',
  BLOCK: 'Chặn xác nhận đơn',
};

export const CREDIT_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type CreditRequestStatus = (typeof CREDIT_REQUEST_STATUSES)[number];

export const CREDIT_REQUEST_STATUS_LABELS: Readonly<Record<CreditRequestStatus, string>> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

/** Số dòng phân bổ tối đa của một lần thu. */
export const RECEIPT_ALLOCATIONS_MAX = 100;

/** Sự kiện outbox (skill `erp-events`): nhắc khoản nợ quá hạn, khách vượt hạn mức. */
export const CRM_RECEIVABLE_OVERDUE = 'crm.receivable.overdue';
export const CRM_CUSTOMER_CREDIT_EXCEEDED = 'crm.customer.credit-exceeded';

export interface CrmReceivableOverduePayload {
  readonly customerId: string;
  readonly customerCode: string;
  readonly entryId: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly dueDate: string;
  readonly openAmount: number;
  readonly daysOverdue: number;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

export interface CrmCustomerCreditExceededPayload {
  readonly customerId: string;
  readonly customerCode: string;
  readonly balance: number;
  readonly creditLimit: number;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/**
 * Phiên Quy trình duyệt vượt hạn mức lỗi vĩnh viễn (T5-17): yêu cầu chuyển sang
 * duyệt trực tiếp trong Bán hàng, báo người lập đơn.
 */
export const CRM_ORDER_CREDIT_APPROVAL_REDIRECTED = 'crm.order.credit-approval-redirected';

export interface CrmOrderCreditApprovalRedirectedPayload {
  readonly orderId: string;
  readonly orderCode: string;
  readonly creditRequestId: string;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/** Đường dẫn mở sổ công nợ của khách (thông báo, dòng thời gian). */
export function receivableDeepLink(customerId: string): string {
  return `/modules/crm#receivables/${encodeURIComponent(customerId)}`;
}

// ---------------------------------------------------------------------------
// Dữ liệu
// ---------------------------------------------------------------------------

/** Một dòng sổ công nợ. */
export interface ReceivableEntry {
  readonly id: string;
  readonly kind: ReceivableEntryKind;
  readonly customerId: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly receiptId: string | null;
  readonly receiptCode: string | null;
  readonly adjustmentId: string | null;
  readonly adjustmentCode: string | null;
  /** Có dấu: dương tăng nợ, âm giảm nợ. */
  readonly amount: number;
  readonly entryDate: string;
  readonly dueDate: string | null;
  readonly refEntryId: string | null;
  readonly reversesEntryId: string | null;
  readonly sourceType: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** Khoản nợ còn mở (hoặc đã thu đủ) với số còn nợ và tuổi nợ. */
export interface ReceivableOpenItem {
  readonly entryId: string;
  readonly kind: ReceivableEntryKind;
  readonly customerId: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly description: string | null;
  readonly entryDate: string;
  readonly dueDate: string | null;
  readonly amount: number;
  /** Số còn nợ theo sổ (đã trừ lần thu đã ghi sổ, điều chỉnh, bút đảo). */
  readonly openAmount: number;
  /** Phần đang được lần thu chưa ghi sổ giữ chỗ. */
  readonly pendingAmount: number;
  /** Số còn phân bổ được = còn nợ − đang giữ chỗ. */
  readonly allocatableAmount: number;
  readonly daysOverdue: number | null;
  readonly bucket: AgingBucket;
}

export type AgingTotals = Readonly<Record<AgingBucket, number>>;

/** Một dòng báo cáo tuổi nợ theo khách. */
export interface CustomerAgingRow {
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  readonly creditLimit: number | null;
  readonly paymentTermDays: number | null;
  /** Dư nợ theo sổ (có thể âm khi khách trả trước). */
  readonly balance: number;
  readonly overdueAmount: number;
  readonly buckets: AgingTotals;
  readonly creditExceeded: boolean;
}

export interface ReceivableAgingQuery {
  readonly q?: string;
  readonly ownerUserId?: string;
  /** `true`: chỉ khách có khoản quá hạn. */
  readonly overdue?: boolean | string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Sổ công nợ của một khách. */
export interface CustomerLedger {
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  readonly creditLimit: number | null;
  readonly paymentTermDays: number | null;
  readonly balance: number;
  readonly overdueAmount: number;
  readonly buckets: AgingTotals;
  readonly creditExceeded: boolean;
  /** Tiền thu đã ghi sổ chưa phân bổ vào khoản nào (trả trước). */
  readonly unappliedAmount: number;
  readonly openItems: readonly ReceivableOpenItem[];
  /** Dòng sổ mới nhất trước (tối đa 500). */
  readonly entries: readonly ReceivableEntry[];
}

export interface ReceiptAllocation {
  readonly id: string;
  readonly entryId: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly entryDescription: string | null;
  readonly dueDate: string | null;
  readonly amount: number;
  /** Đã có hiệu lực (phiếu đã ghi sổ). */
  readonly effective: boolean;
}

export interface ReceiptSummary {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly amount: number;
  readonly allocatedAmount: number;
  readonly method: ReceiptMethod;
  readonly receiptDate: string;
  readonly status: ReceiptStatus;
  readonly financeVoucherId: string | null;
  readonly financeVoucherCode: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReceiptDetail extends ReceiptSummary {
  readonly note: string | null;
  readonly voucherError: string | null;
  readonly returnReason: string | null;
  readonly postedAt: string | null;
  readonly reversedAt: string | null;
  readonly revision: number;
  readonly allocations: readonly ReceiptAllocation[];
  readonly history: readonly CrmHistoryEntry[];
}

export interface ReceiptListQuery {
  readonly customerId?: string;
  readonly status?: ReceiptStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ReceiptAllocationRequest {
  readonly entryId: string;
  readonly amount: number;
}

export interface CreateReceiptRequest {
  readonly customerId: string;
  readonly amount: number;
  readonly method: ReceiptMethod;
  /** YYYY-MM-DD; mặc định hôm nay. */
  readonly receiptDate?: string | null;
  readonly note?: string | null;
  readonly allocations: readonly ReceiptAllocationRequest[];
}

/**
 * Phân bổ tiền thu chưa phân bổ (trả trước, dòng CREDIT chưa gắn khoản nợ) vào
 * khoản nợ phát sinh sau (T5-16). Tổng không vượt số trả trước còn lại.
 */
export interface ApplyCreditRequest {
  readonly allocations: readonly ReceiptAllocationRequest[];
}

/** Sửa lần thu bị trả lại rồi gửi lại Tài chính (cùng phiếu, mở lại). */
export interface ResendReceiptRequest {
  readonly revision: number;
  readonly amount?: number;
  readonly method?: ReceiptMethod;
  readonly receiptDate?: string | null;
  readonly note?: string | null;
  readonly allocations?: readonly ReceiptAllocationRequest[];
}

export interface ReceiptActionRequest {
  readonly revision: number;
  readonly reason?: string | null;
}

export interface ReceivableAdjustment {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly entryId: string | null;
  readonly direction: AdjustmentDirection;
  readonly amount: number;
  readonly reason: string;
  readonly status: AdjustmentStatus;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly cancelReason: string | null;
  readonly revision: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface AdjustmentListQuery {
  readonly customerId?: string;
  readonly status?: AdjustmentStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CreateAdjustmentRequest {
  readonly customerId: string;
  /** Giảm trừ vào khoản nợ của đơn này (theo hạn thanh toán sớm nhất trước). */
  readonly orderId?: string | null;
  /** Giảm trừ đúng vào khoản nợ này. */
  readonly entryId?: string | null;
  readonly direction: AdjustmentDirection;
  readonly amount: number;
  readonly reason: string;
}

export interface AdjustmentActionRequest {
  readonly revision: number;
  readonly reason?: string | null;
}

/** Số liệu công nợ của một đơn, tính từ sổ (T5-11). */
export interface OrderReceivableBalance {
  readonly debited: number;
  readonly collected: number;
  readonly adjusted: number;
  readonly outstanding: number;
}

/** Yêu cầu duyệt vượt hạn mức gần nhất của đơn (D5). */
export interface OrderCreditRequest {
  readonly id: string;
  readonly status: CreditRequestStatus;
  readonly mode: 'DIRECT' | 'PROCEDURE';
  readonly orderAmount: number;
  readonly balance: number;
  readonly creditLimit: number;
  readonly message: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly procedureInstanceCode: string | null;
  readonly createdAt: string;
}

export interface CreditDecisionRequest {
  readonly reason?: string | null;
}

/** Cấu hình công nợ. */
export interface ReceivableSettings {
  readonly recognitionMode: ReceivableRecognitionMode;
  readonly creditLimitMode: CreditLimitMode;
  /** Người nhận thêm cảnh báo quá hạn, vượt hạn mức (ngoài người phụ trách khách). */
  readonly alertUserIds: readonly string[];
}
