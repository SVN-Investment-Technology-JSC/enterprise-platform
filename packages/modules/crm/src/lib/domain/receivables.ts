import {
  AGING_BUCKETS,
  RECEIPT_ALLOCATIONS_MAX,
  type AgingBucket,
  type AgingTotals,
  type CreditLimitMode,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';
import { isUuid } from './fields.js';
import { roundVnd } from './pricing-engine.js';

/**
 * Công nợ phải thu (GĐ5): hàm thuần cho tuổi nợ, kiểm phân bổ lần thu, số tiền
 * ghi nợ khi giao hàng, kiểm hạn mức. Tiền làm tròn đến đồng kiểu xa số 0 như
 * engine giá (Q3).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cộng `days` ngày vào ngày `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Số ngày quá hạn tính tới `today` (âm: còn trong hạn); không có hạn thì `null`. */
export function daysOverdue(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

/**
 * Nhóm tuổi nợ (AR-04, TC-AR-05): chưa đến hạn (hạn sau hôm nay hoặc không có
 * hạn); 0–30 ngày (gồm đến hạn đúng hôm nay); 31–60; 61–90; trên 90.
 */
export function agingBucket(overdueDays: number | null): AgingBucket {
  if (overdueDays === null || overdueDays < 0) return 'NOT_DUE';
  if (overdueDays <= 30) return 'D0_30';
  if (overdueDays <= 60) return 'D31_60';
  if (overdueDays <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export function emptyAging(): Record<AgingBucket, number> {
  return Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, 0])) as Record<AgingBucket, number>;
}

/** Cộng số còn nợ của các khoản vào từng nhóm tuổi nợ; khoản đã thu đủ hoặc âm bỏ qua. */
export function summarizeAging(
  items: readonly { readonly dueDate: string | null; readonly openAmount: number }[],
  today: string,
): { buckets: AgingTotals; overdueAmount: number } {
  const buckets = emptyAging();
  let overdueAmount = 0;
  for (const item of items) {
    if (!(item.openAmount > 0)) continue;
    const days = daysOverdue(item.dueDate, today);
    const bucket = agingBucket(days);
    buckets[bucket] = roundVnd(buckets[bucket] + item.openAmount);
    if (days !== null && days > 0) overdueAmount = roundVnd(overdueAmount + item.openAmount);
  }
  return { buckets, overdueAmount };
}

// ---------------------------------------------------------------------------
// Phân bổ lần thu
// ---------------------------------------------------------------------------

export interface AllocationInput {
  readonly entryId: string;
  readonly amount: number;
}

/** Số tiền VND dương, làm tròn đến đồng; sai thì 400 kèm nhãn. */
export function positiveAmount(value: unknown, label: string): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number <= 0 || number >= 1e15) {
    throw new CrmValidationError('INVALID_AMOUNT', `${label} phải lớn hơn 0.`);
  }
  const rounded = roundVnd(number);
  if (rounded <= 0) throw new CrmValidationError('INVALID_AMOUNT', `${label} phải lớn hơn 0.`);
  return rounded;
}

/**
 * Kiểm danh sách phân bổ của một lần thu (TC-AR-04): mỗi dòng một khoản nợ, số
 * tiền dương, không trùng khoản; tổng phân bổ không vượt số tiền thu. Phần chưa
 * phân bổ là tiền trả trước của khách.
 */
export function normalizeAllocations(raw: unknown, receiptAmount: number): AllocationInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new CrmValidationError('INVALID_ALLOCATIONS', 'Danh sách phân bổ không hợp lệ.');
  if (raw.length > RECEIPT_ALLOCATIONS_MAX) {
    throw new CrmValidationError('TOO_MANY_ALLOCATIONS', `Mỗi lần thu phân bổ tối đa ${RECEIPT_ALLOCATIONS_MAX} khoản.`);
  }
  const seen = new Set<string>();
  const allocations = (raw as Partial<AllocationInput>[]).map((line, index) => {
    if (!isUuid(line?.entryId)) {
      throw new CrmValidationError('INVALID_ALLOCATION', `Dòng phân bổ ${index + 1}: vui lòng chọn khoản nợ.`);
    }
    const entryId = line.entryId.toLowerCase();
    if (seen.has(entryId)) {
      throw new CrmValidationError('DUPLICATE_ALLOCATION', `Dòng phân bổ ${index + 1}: khoản nợ đã có ở dòng khác.`);
    }
    seen.add(entryId);
    return { entryId, amount: positiveAmount(line.amount, `Dòng phân bổ ${index + 1}: số tiền phân bổ`) };
  });
  const total = allocations.reduce((sum, line) => sum + line.amount, 0);
  if (total > receiptAmount) {
    throw new CrmValidationError('ALLOCATION_EXCEEDS_RECEIPT', 'Tổng số tiền phân bổ vượt số tiền thu.');
  }
  return allocations;
}

/** Khoản nợ đã khoá để phân bổ: thuộc khách nào, còn phân bổ được bao nhiêu. */
export interface AllocatableItem {
  readonly entryId: string;
  readonly customerId: string;
  readonly label: string;
  readonly allocatable: number;
}

/**
 * Đối chiếu phân bổ với khoản nợ (đã khoá `FOR UPDATE`): khoản phải là khoản nợ
 * của đúng khách; số phân bổ không vượt số còn phân bổ được (còn nợ trừ phần lần
 * thu khác đang giữ chỗ). Sai thì 400, không ghi gì (TC-AR-04, TC-CONC-09).
 */
export function assertAllocatable(
  allocations: readonly AllocationInput[],
  items: ReadonlyMap<string, AllocatableItem>,
  customerId: string,
): void {
  for (const allocation of allocations) {
    const item = items.get(allocation.entryId);
    if (!item || item.customerId !== customerId) {
      throw new CrmValidationError('ENTRY_NOT_OPEN', 'Khoản nợ được chọn không thuộc khách hàng này hoặc không còn mở.');
    }
    if (allocation.amount > item.allocatable) {
      throw new CrmValidationError(
        'ALLOCATION_EXCEEDS_OPEN',
        `Số phân bổ vào ${item.label} vượt số còn nợ (còn phân bổ được ${formatVnd(Math.max(item.allocatable, 0))} đ).`,
        { entryId: allocation.entryId, allocatable: Math.max(item.allocatable, 0) },
      );
    }
  }
}

/**
 * Chia `amount` vào các khoản theo thứ tự đã sắp (hạn sớm trước), mỗi khoản tối
 * đa phần còn lại của nó. Trả phần đã chia và phần thừa không chia được.
 */
export function allocateInOrder<T extends { readonly available: number }>(
  items: readonly T[],
  amount: number,
): { parts: { item: T; amount: number }[]; remainder: number } {
  let remaining = roundVnd(amount);
  const parts: { item: T; amount: number }[] = [];
  for (const item of items) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, roundVnd(item.available));
    if (take <= 0) continue;
    parts.push({ item, amount: take });
    remaining = roundVnd(remaining - take);
  }
  return { parts, remainder: remaining };
}

// ---------------------------------------------------------------------------
// Ghi nợ khi giao hàng (D3, T5-04)
// ---------------------------------------------------------------------------

export interface DeliveredLineChange {
  readonly quantity: number;
  /** Thành tiền gồm VAT của dòng (sau chiết khấu). */
  readonly lineTotal: number;
  readonly deliveredBefore: number;
  readonly deliveredAfter: number;
}

/** Giá trị gồm VAT của phần đã giao `delivered` trên dòng: tỷ lệ theo số lượng, làm tròn đến đồng. */
export function deliveredValue(line: { readonly quantity: number; readonly lineTotal: number }, delivered: number): number {
  if (!(line.quantity > 0)) return 0;
  const ratio = Math.min(Math.max(delivered, 0), line.quantity) / line.quantity;
  return ratio >= 1 ? roundVnd(line.lineTotal) : roundVnd(line.lineTotal * ratio);
}

/**
 * Số tiền ghi nợ (dương) hoặc đảo (âm) khi số đã giao của đơn đổi do một chứng
 * từ xuất (hoặc chứng từ đảo): mỗi dòng lấy giá trị luỹ kế sau trừ giá trị luỹ
 * kế trước, nên giao nhiều đợt cộng lại đúng bằng thành tiền của dòng, không lệch
 * đồng lẻ. Phí vận chuyển (gồm VAT) ghi nợ cùng lần giao đầu tiên của đơn, và
 * đảo khi chứng từ đảo đưa đơn về chưa giao gì.
 */
export function deliveryReceivableAmount(lines: readonly DeliveredLineChange[], shippingTotal: number): number {
  let amount = 0;
  for (const line of lines) {
    amount += deliveredValue(line, line.deliveredAfter) - deliveredValue(line, line.deliveredBefore);
  }
  const before = lines.some((line) => line.deliveredBefore > 0);
  const after = lines.some((line) => line.deliveredAfter > 0);
  const shipping = roundVnd(shippingTotal);
  if (!before && after) amount += shipping;
  if (before && !after) amount -= shipping;
  return roundVnd(amount);
}

// ---------------------------------------------------------------------------
// Hạn mức công nợ (D5, T5-10)
// ---------------------------------------------------------------------------

export type CreditEvaluation =
  | { readonly outcome: 'ALLOW' }
  | { readonly outcome: 'BLOCK' | 'APPROVAL'; readonly message: string };

/**
 * Dư nợ + giá trị đơn mới vượt hạn mức thì chặn hoặc đưa đi duyệt theo cấu hình;
 * bằng đúng hạn mức vẫn cho qua (TC-AR-09). Khách không đặt hạn mức: không giới
 * hạn. Đơn đã được duyệt vượt hạn mức với giá trị không nhỏ hơn giá trị hiện tại
 * thì cho qua (duyệt rồi nhưng chưa giữ được hàng, xác nhận lại).
 */
export function evaluateCreditLimit(input: {
  readonly creditLimit: number | null;
  readonly balance: number;
  readonly orderAmount: number;
  readonly mode: CreditLimitMode;
  readonly approvedAmount: number | null;
}): CreditEvaluation {
  if (input.creditLimit === null) return { outcome: 'ALLOW' };
  const exposure = roundVnd(input.balance + input.orderAmount);
  if (exposure <= input.creditLimit) return { outcome: 'ALLOW' };
  if (input.approvedAmount !== null && input.approvedAmount >= input.orderAmount) return { outcome: 'ALLOW' };
  const message =
    `Vượt hạn mức công nợ: dư nợ ${formatVnd(input.balance)} đ cộng giá trị đơn ${formatVnd(input.orderAmount)} đ ` +
    `là ${formatVnd(exposure)} đ, lớn hơn hạn mức ${formatVnd(input.creditLimit)} đ.`;
  return { outcome: input.mode === 'BLOCK' ? 'BLOCK' : 'APPROVAL', message };
}

/** Số tiền kiểu Việt Nam, ví dụ `4.400.000`. */
export function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(roundVnd(value));
}

/** Mã lần thu `TT<yy><5 chữ số>` và mã điều chỉnh `DC<yy><5 chữ số>`. */
export function formatReceiptCode(year: number, sequence: number): string {
  return `TT${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

export function formatAdjustmentCode(year: number, sequence: number): string {
  return `DC${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

/** Khoá chống lặp gửi Tài chính của lần thu: lần đầu `crm-receipt:<id>`, gửi lại thêm số lần. */
export function receiptIdempotencyKey(receiptId: string, attempt: number): string {
  return attempt <= 1 ? `crm-receipt:${receiptId}` : `crm-receipt:${receiptId}:${attempt}`;
}
