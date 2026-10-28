import type {
  AdjustmentStatus,
  AgingBucket,
  CrmCapabilities,
  ReceiptDetail,
  ReceiptStatus,
  ReceivableAdjustment,
  ReceivableEntryKind,
  ReceivableOpenItem,
} from '@enterprise-platform/contracts-crm';

/**
 * Logic thuần của màn công nợ (không React), để kiểm thử riêng. Quyền thật kiểm
 * ở API; ở đây chỉ để ẩn hiện nút.
 */

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const RECEIPT_STATUS_TONE: Readonly<Record<ReceiptStatus, Tone>> = {
  PENDING_VOUCHER: 'info',
  VOUCHER_DRAFT: 'warning',
  POSTED: 'success',
  RETURNED: 'danger',
  REVERSED: 'neutral',
  CANCELLED: 'neutral',
};

export const ADJUSTMENT_STATUS_TONE: Readonly<Record<AdjustmentStatus, Tone>> = {
  DRAFT: 'warning',
  APPROVED: 'success',
  CANCELLED: 'neutral',
};

export const AGING_BUCKET_TONE: Readonly<Record<AgingBucket, Tone>> = {
  NOT_DUE: 'success',
  D0_30: 'info',
  D31_60: 'warning',
  D61_90: 'danger',
  D90_PLUS: 'danger',
};

export const ENTRY_KIND_TONE: Readonly<Record<ReceivableEntryKind, Tone>> = {
  DEBIT: 'info',
  CREDIT: 'success',
  ADJUSTMENT: 'warning',
  REVERSAL: 'neutral',
};

/** Được thu tiền, lập điều chỉnh (`crm.receivable.write`). */
export function canWriteReceivable(capabilities: CrmCapabilities): boolean {
  return capabilities.isTenantAdmin || capabilities.canWriteReceivable;
}

/** Được duyệt điều chỉnh, duyệt vượt hạn mức: quản lý kinh doanh (thấy toàn bộ dữ liệu). */
export function canApproveReceivable(capabilities: CrmCapabilities): boolean {
  return capabilities.isTenantAdmin || capabilities.canManage || capabilities.canReadAll;
}

/** Thao tác trên lần thu theo trạng thái: lần thu bị trả lại hoặc bị Tài chính từ chối thì sửa gửi lại hoặc huỷ. */
export function receiptActions(receipt: Pick<ReceiptDetail, 'status' | 'voucherError'>, capabilities: CrmCapabilities): ('resend' | 'cancel')[] {
  if (!canWriteReceivable(capabilities)) return [];
  const fixable = receipt.status === 'RETURNED' || (receipt.status === 'PENDING_VOUCHER' && !!receipt.voucherError);
  return fixable ? ['resend', 'cancel'] : [];
}

/** Thao tác trên điều chỉnh: duyệt (người khác người lập), huỷ (người lập hoặc người duyệt). */
export function adjustmentActions(
  adjustment: Pick<ReceivableAdjustment, 'status' | 'createdBy'>,
  capabilities: CrmCapabilities,
  userId: string | undefined,
): ('approve' | 'cancel')[] {
  if (adjustment.status !== 'DRAFT') return [];
  const actions: ('approve' | 'cancel')[] = [];
  const approver = canApproveReceivable(capabilities);
  if (approver && adjustment.createdBy !== userId) actions.push('approve');
  if (approver || adjustment.createdBy === userId) actions.push('cancel');
  return actions;
}

/** Làm tròn đến đồng, kiểu xa số 0 như server. */
export function roundVnd(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Chia số tiền thu vào các khoản theo hạn thanh toán sớm trước, mỗi khoản tối
 * đa phần còn phân bổ được. Trả số phân bổ theo id khoản (bỏ khoản 0).
 */
export function autoAllocate(
  items: readonly Pick<ReceivableOpenItem, 'entryId' | 'dueDate' | 'entryDate' | 'allocatableAmount'>[],
  amount: number,
): Record<string, number> {
  const ordered = [...items].sort(
    (a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.entryDate.localeCompare(b.entryDate),
  );
  let remaining = roundVnd(Math.max(amount, 0));
  const result: Record<string, number> = {};
  for (const item of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, roundVnd(item.allocatableAmount));
    if (take <= 0) continue;
    result[item.entryId] = take;
    remaining = roundVnd(remaining - take);
  }
  return result;
}

/**
 * Kiểm phân bổ trước khi gửi (server kiểm lại): số thu dương; mỗi khoản không
 * vượt phần còn phân bổ được; tổng không vượt số thu (TC-AR-04). Trả lời nhắn lỗi
 * đầu tiên hoặc `undefined`.
 */
export function allocationError(
  amount: number,
  allocations: Readonly<Record<string, number>>,
  items: readonly Pick<ReceivableOpenItem, 'entryId' | 'allocatableAmount' | 'orderCode'>[],
): string | undefined {
  if (!(amount > 0)) return 'Số tiền thu phải lớn hơn 0.';
  let total = 0;
  for (const [entryId, value] of Object.entries(allocations)) {
    if (!value) continue;
    if (value < 0) return 'Số phân bổ không được âm.';
    const item = items.find((candidate) => candidate.entryId === entryId);
    if (!item) return 'Khoản nợ được chọn không còn mở.';
    if (value > item.allocatableAmount) {
      return `Số phân bổ vào ${item.orderCode ? `khoản nợ đơn ${item.orderCode}` : 'khoản nợ'} vượt số còn nợ.`;
    }
    total += value;
  }
  if (roundVnd(total) > roundVnd(amount)) return 'Tổng số tiền phân bổ vượt số tiền thu.';
  return undefined;
}

/** Danh sách phân bổ gửi API (bỏ dòng 0). */
export function allocationRequests(allocations: Readonly<Record<string, number>>): { entryId: string; amount: number }[] {
  return Object.entries(allocations)
    .filter(([, value]) => value > 0)
    .map(([entryId, value]) => ({ entryId, amount: roundVnd(value) }));
}
