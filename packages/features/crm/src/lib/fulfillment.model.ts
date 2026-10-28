import {
  CONTRACT_STATUS_TRANSITIONS,
  SALES_ORDER_STATUS_TRANSITIONS,
  type ContractDetail,
  type ContractStatus,
  type CrmCapabilities,
  type CrmWarehouseOption,
  type DeliveryPlan,
  type DeliveryStatus,
  type PaymentTerm,
  type SalesOrderDetail,
  type SalesOrderStatus,
} from '@enterprise-platform/contracts-crm';

/**
 * Logic thuần của màn hợp đồng, đơn bán (không React): nút nào hiện theo trạng
 * thái và quyền, số còn có thể lập đợt giao. Server kiểm lại mọi thao tác.
 */

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const CONTRACT_STATUS_TONE: Readonly<Record<ContractStatus, Tone>> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  COMPLETED: 'info',
  EXPIRED: 'warning',
  LIQUIDATED: 'neutral',
  CANCELLED: 'danger',
};

export const ORDER_STATUS_TONE: Readonly<Record<SalesOrderStatus, Tone>> = {
  DRAFT: 'neutral',
  CREDIT_PENDING: 'warning',
  CONFIRMED: 'info',
  DELIVERING: 'info',
  PARTIAL: 'warning',
  DELIVERED: 'success',
  DONE: 'success',
  CANCELLED: 'danger',
};

export const DELIVERY_STATUS_TONE: Readonly<Record<DeliveryStatus, Tone>> = {
  PLANNED: 'neutral',
  REQUESTED: 'info',
  ISSUED: 'success',
  CANCELLED: 'danger',
  REVERSED: 'warning',
};

/** Nhãn thao tác trên hợp đồng, đơn (nhật ký, dòng thời gian). */
export const FULFILLMENT_ACTION_LABELS: Readonly<Record<string, string>> = {
  create: 'Lập',
  confirm: 'Xác nhận',
  cancel: 'Huỷ',
  complete: 'Hoàn thành',
  liquidate: 'Thanh lý',
  expire: 'Hết hạn',
  close: 'Đóng đơn',
  'auto-complete': 'Tự hoàn tất',
  'credit-check': 'Chờ duyệt hạn mức',
  'credit-approve': 'Duyệt vượt hạn mức',
  'credit-reject': 'Từ chối vượt hạn mức',
  'credit-unreserved': 'Đã duyệt hạn mức nhưng chưa giữ được hàng',
  'credit-redirect': 'Chuyển sang duyệt hạn mức trực tiếp',
  'release-reservation': 'Nhả phần giữ hàng còn lại',
  'payment-term-due': 'Đợt thanh toán đến hạn',
  'request-issue': 'Yêu cầu xuất kho',
  deliver: 'Kho đã xuất',
  'deliver-service': 'Ghi nhận giao dịch vụ',
  'reverse-delivery': 'Đảo chứng từ xuất',
  'reservation-expired': 'Phần giữ hàng hết hạn',
};

export type ContractUiAction = 'edit' | 'confirm' | 'cancel' | 'complete' | 'liquidate';

export function contractActions(detail: Pick<ContractDetail, 'status'>, capabilities: CrmCapabilities): ContractUiAction[] {
  if (!(capabilities.isTenantAdmin || capabilities.canWriteContract)) return [];
  const next = CONTRACT_STATUS_TRANSITIONS[detail.status];
  const actions: ContractUiAction[] = [];
  if (detail.status === 'DRAFT') actions.push('edit');
  if (next.includes('ACTIVE')) actions.push('confirm');
  if (next.includes('COMPLETED')) actions.push('complete');
  if (next.includes('LIQUIDATED')) actions.push('liquidate');
  if (next.includes('CANCELLED')) actions.push('cancel');
  return actions;
}

/**
 * Nút "Ghi nhận nghiệm thu" của đợt thanh toán điều kiện nghiệm thu (T5-18):
 * hợp đồng Hiệu lực hoặc Hoàn thành, đợt chưa đến hạn, người có quyền hợp đồng.
 */
export function canTriggerPaymentTerm(
  contract: Pick<ContractDetail, 'status'>,
  term: Pick<PaymentTerm, 'condition' | 'status'>,
  capabilities: CrmCapabilities,
): boolean {
  if (!(capabilities.isTenantAdmin || capabilities.canWriteContract)) return false;
  if (contract.status !== 'ACTIVE' && contract.status !== 'COMPLETED') return false;
  return term.condition === 'ACCEPTANCE' && term.status === 'PENDING';
}

/** Tuỳ chọn ô chọn kho (T4-19): kho đang hoạt động; kho đang chọn luôn có mặt (kể cả đã ngừng hay Kho không trả). */
export function warehouseOptions(
  warehouses: readonly CrmWarehouseOption[],
  current: string | null | undefined,
): { value: string; label: string; badge?: string }[] {
  const options = warehouses
    .filter((warehouse) => warehouse.isActive || warehouse.code === current)
    .map((warehouse) => ({ value: warehouse.code, label: warehouse.name, badge: warehouse.isActive ? warehouse.code : `${warehouse.code} · ngừng` }));
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current, badge: current });
  return options;
}

export type OrderUiAction = 'edit' | 'confirm' | 'plan' | 'cancel' | 'close';

export function orderActions(detail: Pick<SalesOrderDetail, 'status' | 'lines'>, capabilities: CrmCapabilities): OrderUiAction[] {
  if (!(capabilities.isTenantAdmin || capabilities.canWriteOrder)) return [];
  const next = SALES_ORDER_STATUS_TRANSITIONS[detail.status];
  const actions: OrderUiAction[] = [];
  if (detail.status === 'DRAFT') actions.push('edit');
  // Chờ duyệt hạn mức chỉ sang Đã xác nhận qua quyết định duyệt (D5), không xác nhận tay.
  if (next.includes('CONFIRMED') && detail.lines.length && detail.status !== 'CREDIT_PENDING') actions.push('confirm');
  if (['DRAFT', 'CREDIT_PENDING', 'CONFIRMED', 'DELIVERING', 'PARTIAL'].includes(detail.status)) actions.push('plan');
  if (next.includes('CANCELLED')) actions.push('cancel');
  if (next.includes('DONE') && (capabilities.isTenantAdmin || capabilities.canReadAll || capabilities.canManage)) actions.push('close');
  return actions;
}

/** Đợt yêu cầu xuất được: đợt Kế hoạch của đơn đã xác nhận, chưa giao đủ. */
export function canRequestDelivery(order: Pick<SalesOrderDetail, 'status'>, delivery: Pick<DeliveryPlan, 'status'>): boolean {
  return ['CONFIRMED', 'DELIVERING', 'PARTIAL'].includes(order.status) && delivery.status === 'PLANNED';
}

/**
 * Số còn lập đợt được của từng dòng đơn (để điền sẵn khi thêm đợt). Sửa một
 * đợt thì cộng lại phần của chính đợt đó.
 */
export function remainingToPlan(order: Pick<SalesOrderDetail, 'lines' | 'deliveries'>, editing?: DeliveryPlan): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const line of order.lines) {
    const own = editing?.lines.find((entry) => entry.orderLineId === line.id)?.plannedQuantity ?? 0;
    remaining.set(line.id, Math.max(0, Math.round((line.quantity - line.plannedQuantity + own) * 1000) / 1000));
  }
  return remaining;
}

/** Tổng phần trăm và số tiền của lưới đợt thanh toán đang nhập (đợt phần trăm quy ra tiền). */
export function paymentTermTotals(
  terms: readonly { percent?: number | null; amount?: number | null }[],
  value: number,
): { percent: number; amount: number; balanced: boolean } {
  let percent = 0;
  let amount = 0;
  for (const term of terms) {
    if (term.percent !== undefined && term.percent !== null) {
      percent += term.percent;
      amount += Math.round((value * term.percent) / 100);
    } else if (term.amount !== undefined && term.amount !== null) {
      amount += term.amount;
      percent += value > 0 ? (term.amount / value) * 100 : 0;
    }
  }
  const roundedPercent = Math.round(percent * 10_000) / 10_000;
  return { percent: roundedPercent, amount, balanced: terms.length === 0 || Math.abs(amount - value) <= terms.length };
}

/** `YYYY-MM-DD` thành `DD/MM/YYYY`. */
export function formatDay(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('/') : '';
}

/** Số lượng kiểu Việt Nam, tối đa 3 chữ số thập phân. */
export function formatQuantity(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}
