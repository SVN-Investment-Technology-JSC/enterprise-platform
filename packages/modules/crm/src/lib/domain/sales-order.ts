import {
  RESERVATION_AFTER_DELIVERY_DAYS,
  SALES_ORDER_STATUS_LABELS,
  SALES_ORDER_STATUS_TRANSITIONS,
  SALES_ORDER_STATUSES,
  type SalesOrderStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError } from './crm.error.js';

/**
 * Máy trạng thái đơn bán (mục 5.4 kế hoạch):
 *
 * - Nháp → Đã xác nhận (trong hạn mức, giữ đủ hàng), Chờ duyệt hạn mức (vượt
 *   hạn mức, cấu hình duyệt — T5-10), Huỷ;
 * - Chờ duyệt hạn mức → Đã xác nhận (duyệt), Nháp (từ chối), Huỷ;
 * - Đã xác nhận → Đang giao (tạo yêu cầu xuất);
 * - Đang giao ↔ Đã giao một phần; cả hai → Đã giao đủ (Kho ghi sổ xuất);
 * - Đã giao đủ → Hoàn tất (còn phải thu bằng 0, hoặc đóng tay có lý do);
 * - các trạng thái chưa giao đủ → Huỷ (có lý do; nhả phần giữ còn lại).
 *
 * Ngoài bảng trên, chứng từ đảo của Kho (huỷ tác dụng một chứng từ xuất) cho
 * hệ thống lùi Đã giao đủ về Đã giao một phần hoặc Đang giao
 * (`orderStatusAfterDelivery`); người dùng không chuyển được như vậy.
 */
export function isSalesOrderStatus(value: unknown): value is SalesOrderStatus {
  return typeof value === 'string' && (SALES_ORDER_STATUSES as readonly string[]).includes(value);
}

export function canOrderTransition(from: SalesOrderStatus, to: SalesOrderStatus): boolean {
  return SALES_ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOrderTransition(from: SalesOrderStatus, to: SalesOrderStatus): void {
  if (canOrderTransition(from, to)) return;
  if (to === 'CANCELLED' && (from === 'DELIVERED' || from === 'DONE')) {
    throw new CrmConflictError(
      'ORDER_NOT_CANCELLABLE',
      `Đơn đã ở trạng thái "${SALES_ORDER_STATUS_LABELS[from]}", không huỷ được.`,
    );
  }
  throw new CrmConflictError(
    'INVALID_ORDER_TRANSITION',
    `Không thể chuyển đơn bán từ "${SALES_ORDER_STATUS_LABELS[from]}" sang "${SALES_ORDER_STATUS_LABELS[to]}".`,
  );
}

/** Đơn còn sửa dòng, sửa đầu đơn được: chỉ Nháp. */
export function isOrderEditable(status: SalesOrderStatus): boolean {
  return status === 'DRAFT';
}

/** Đơn còn lập, sửa kế hoạch giao được. */
export function canPlanDeliveries(status: SalesOrderStatus): boolean {
  return ['DRAFT', 'CREDIT_PENDING', 'CONFIRMED', 'DELIVERING', 'PARTIAL'].includes(status);
}

/** Đơn tạo yêu cầu xuất được: đã xác nhận và chưa giao đủ. */
export function canRequestIssue(status: SalesOrderStatus): boolean {
  return status === 'CONFIRMED' || status === 'DELIVERING' || status === 'PARTIAL';
}

/** Mã đơn dạng `DH<yy><5 chữ số>`. */
export function formatOrderCode(year: number, sequence: number): string {
  return `DH${String(year % 100).padStart(2, '0')}${String(sequence).padStart(5, '0')}`;
}

/** Mã đợt giao: mã đơn kèm số thứ tự hai chữ số, ví dụ `DH2600001-01`. */
export function formatDeliveryCode(orderCode: string, seq: number): string {
  return `${orderCode}-${String(seq).padStart(2, '0')}`;
}

/**
 * Khoá chống lặp khi giữ hàng ở Kho: `crm-order:<id>` (hay `crm-contract:<id>`)
 * cho lần đầu; lần giữ trước đã phải nhả lại (ghi đơn lỗi sau khi Kho đã giữ)
 * thì thêm số lần để không nhận lại phần giữ đã nhả.
 */
export function reservationIdempotencyKey(kind: 'crm-order' | 'crm-contract', id: string, attempt: number): string {
  return attempt <= 1 ? `${kind}:${id}` : `${kind}:${id}:${attempt}`;
}

/** Khoá chống lặp của yêu cầu xuất kho cho một đợt giao. */
export function issueRequestIdempotencyKey(deliveryId: string): string {
  return `crm-delivery:${deliveryId}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Cuối ngày `date` (giờ Việt Nam) dạng ISO UTC. */
function endOfVietnamDay(date: string): string {
  return new Date(Date.parse(`${addDays(date, 1)}T00:00:00+07:00`) - 1000).toISOString();
}

/**
 * Hạn giữ hàng (Q12): có ngày giao dự kiến thì hết ngày giao dự kiến + 2 ngày;
 * không có (hoặc ngày đó đã qua) thì hết ngày `today + holdDays`. Tính theo cuối
 * ngày để gọi lại trong cùng ngày gửi đúng một hạn (Kho so nội dung theo khoá
 * chống lặp).
 */
export function reservationExpiry(input: {
  readonly today: string;
  readonly now: Date;
  readonly holdDays: number;
  readonly plannedDate: string | null;
}): string {
  if (input.plannedDate) {
    const planned = endOfVietnamDay(addDays(input.plannedDate, RESERVATION_AFTER_DELIVERY_DAYS));
    if (Date.parse(planned) > input.now.getTime()) return planned;
  }
  return endOfVietnamDay(addDays(input.today, Math.max(1, input.holdDays)));
}

/** Tiến độ giao của đơn sau khi áp một chứng từ xuất (hoặc chứng từ đảo). */
export interface DeliveryProgress {
  /** Mọi dòng đã giao đủ số lượng. */
  readonly allDelivered: boolean;
  /** Có dòng đã giao một phần trở lên. */
  readonly anyDelivered: boolean;
  /** Còn đợt đang chờ Kho xuất. */
  readonly openRequests: boolean;
}

/**
 * Trạng thái đơn sau khi Kho ghi sổ xuất (T4-12): giao đủ thì Đã giao đủ, có
 * phần đã giao thì Đã giao một phần; chứng từ đảo làm số đã giao giảm thì lùi
 * về Đã giao một phần, hoặc Đang giao (còn yêu cầu xuất) hay Đã xác nhận. Đơn
 * đã huỷ, đã hoàn tất, còn Nháp giữ nguyên trạng thái (chỉ cập nhật số liệu).
 */
export function orderStatusAfterDelivery(current: SalesOrderStatus, progress: DeliveryProgress): SalesOrderStatus {
  if (!['CONFIRMED', 'DELIVERING', 'PARTIAL', 'DELIVERED'].includes(current)) return current;
  if (progress.allDelivered) return 'DELIVERED';
  if (progress.anyDelivered) return 'PARTIAL';
  return progress.openRequests ? 'DELIVERING' : 'CONFIRMED';
}

/** Đợt giao trễ: chưa xuất kho mà đã quá ngày dự kiến (ORD-06). */
export function isDeliveryLate(delivery: { status: string; plannedDate: string }, today: string): boolean {
  return (delivery.status === 'PLANNED' || delivery.status === 'REQUESTED') && delivery.plannedDate < today;
}
