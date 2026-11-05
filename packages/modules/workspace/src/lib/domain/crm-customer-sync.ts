/**
 * Quyết định cập nhật bản sao khách hàng Bán hàng trong Workspace (D1).
 *
 * Bán hàng là nguồn gốc; Workspace giữ bản sao theo `crm_customer_id`, ghi
 * kèm `crm_version` (phiên bản của khách ở Bán hàng). Sự kiện giao ít nhất một
 * lần và có thể đến sai thứ tự, nên:
 * - bản sao đã có và phiên bản tới không lớn hơn: bỏ qua (giao lặp, đến trễ);
 * - chưa có bản sao nhưng có khách Workspace cùng mã chưa gắn: gắn khách đó
 *   (khách cũ tạo trước khi bật Bán hàng), không tạo trùng;
 * - mã đang thuộc bản sao của khách Bán hàng khác: xung đột, chờ sự kiện đổi mã
 *   của khách kia tới rồi thử lại;
 * - còn lại: tạo bản sao mới.
 */
export type CrmCustomerSyncDecision =
  | { readonly kind: 'ignore'; readonly customerId: string }
  | { readonly kind: 'update'; readonly customerId: string }
  | { readonly kind: 'link'; readonly customerId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'conflict'; readonly customerId: string };

export interface CrmCustomerSyncState {
  readonly crmCustomerId: string;
  readonly incomingVersion: number;
  /** Bản sao đang trỏ tới `crmCustomerId`, nếu có. */
  readonly linked?: { readonly id: string; readonly crmVersion: number | null };
  /**
   * Khách Workspace ứng viên để gắn: khách được chỉ định đích danh (script
   * chuyển khách cũ), hoặc — khi chưa có bản sao — khách cùng mã.
   */
  readonly candidate?: { readonly id: string; readonly crmCustomerId: string | null };
}

export function decideCrmCustomerSync(state: CrmCustomerSyncState): CrmCustomerSyncDecision {
  const { linked, candidate } = state;
  if (linked) {
    // Khách được chỉ định đích danh khác bản sao đang có: không gắn hai bản sao cho một khách.
    if (candidate && candidate.id !== linked.id) return { kind: 'conflict', customerId: candidate.id };
    if (linked.crmVersion !== null && state.incomingVersion <= linked.crmVersion) {
      return { kind: 'ignore', customerId: linked.id };
    }
    return { kind: 'update', customerId: linked.id };
  }
  if (candidate) {
    if (candidate.crmCustomerId === null) return { kind: 'link', customerId: candidate.id };
    return { kind: 'conflict', customerId: candidate.id };
  }
  return { kind: 'create' };
}

/** Phiên bản hợp lệ: số nguyên dương (Bán hàng bắt đầu từ 1). */
export function isCrmCustomerVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
