import { DELIVERY_PLANS_MAX, type DeliveryStatus } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Kế hoạch giao nhiều đợt (ORD-03, T4-10) và phân bổ kết quả xuất kho vào đợt
 * (T4-12): hàm thuần.
 *
 * Số lượng một đợt "chiếm" của dòng đơn: đợt chưa xuất (Kế hoạch, Đã yêu cầu
 * xuất) chiếm số dự kiến; đợt đã xuất chiếm số đã giao thật; đợt huỷ, đợt đã
 * đảo hết không chiếm gì. Tổng các đợt không vượt số lượng dòng đơn.
 */

const QUANTITY_SCALE = 1000;
export const round3 = (value: number) => Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;
export const round2 = (value: number) => Math.round(value * 100) / 100;

export const DELIVERY_EXCEEDS_ORDER_MESSAGE = 'Tổng số lượng các đợt vượt số lượng đơn.';

/** Số lượng một dòng của đợt giao đang chiếm trên dòng đơn. */
export function committedQuantity(status: DeliveryStatus, planned: number, delivered: number): number {
  if (status === 'PLANNED' || status === 'REQUESTED') return planned;
  if (status === 'ISSUED') return delivered;
  return 0;
}

export interface PlanOrderLine {
  readonly id: string;
  readonly lineNo: number;
  readonly quantity: number;
}

export interface PlanExistingLine {
  readonly deliveryId: string;
  readonly orderLineId: string;
  readonly status: DeliveryStatus;
  readonly plannedQuantity: number;
  readonly deliveredQuantity: number;
}

export interface PlanLineInput {
  readonly orderLineId: string;
  readonly quantity: number;
}

/**
 * Kiểm dòng của một đợt giao (tạo mới hoặc sửa đợt `deliveryId`): có ít nhất
 * một dòng, mỗi dòng thuộc đơn, số lượng dương, không lặp dòng; cộng với các
 * đợt khác không vượt số lượng dòng đơn (400 "Tổng số lượng các đợt vượt số
 * lượng đơn", TC-ORD-05). Trả dòng đã chuẩn hoá.
 */
export function validateDeliveryLines(input: {
  readonly orderLines: readonly PlanOrderLine[];
  readonly existing: readonly PlanExistingLine[];
  readonly deliveryId: string | null;
  readonly lines: readonly PlanLineInput[] | unknown;
  readonly deliveryCount: number;
}): PlanLineInput[] {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new CrmValidationError('DELIVERY_LINES_REQUIRED', 'Đợt giao phải có ít nhất một dòng.');
  }
  if (!input.deliveryId && input.deliveryCount >= DELIVERY_PLANS_MAX) {
    throw new CrmValidationError('TOO_MANY_DELIVERIES', `Mỗi đơn tối đa ${DELIVERY_PLANS_MAX} đợt giao.`);
  }
  const byId = new Map(input.orderLines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const normalized: PlanLineInput[] = [];
  for (const [index, raw] of (input.lines as PlanLineInput[]).entries()) {
    const line = byId.get(String(raw?.orderLineId ?? '').toLowerCase());
    if (!line) throw new CrmValidationError('INVALID_DELIVERY_LINE', `Dòng ${index + 1} của đợt giao không thuộc đơn.`);
    if (seen.has(line.id)) {
      throw new CrmValidationError('DUPLICATE_DELIVERY_LINE', `Dòng đơn ${line.lineNo} xuất hiện hai lần trong đợt giao.`);
    }
    seen.add(line.id);
    const quantity = Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new CrmValidationError('INVALID_QUANTITY', `Dòng đơn ${line.lineNo}: số lượng giao phải lớn hơn 0.`, { lineNo: line.lineNo });
    }
    normalized.push({ orderLineId: line.id, quantity: round3(quantity) });
  }
  for (const line of normalized) {
    const order = byId.get(line.orderLineId) as PlanOrderLine;
    const others = input.existing
      .filter((entry) => entry.orderLineId === line.orderLineId && entry.deliveryId !== input.deliveryId)
      .reduce((sum, entry) => sum + committedQuantity(entry.status, entry.plannedQuantity, entry.deliveredQuantity), 0);
    if (round3(others + line.quantity) > order.quantity) {
      throw new CrmValidationError('DELIVERY_EXCEEDS_ORDER', DELIVERY_EXCEEDS_ORDER_MESSAGE, {
        lineNo: order.lineNo,
        orderQuantity: order.quantity,
        plannedElsewhere: round3(others),
      });
    }
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Phân bổ kết quả xuất kho
// ---------------------------------------------------------------------------

export interface IssueTargetLine {
  readonly id: string;
  readonly materialId: string;
  readonly plannedQuantity: number;
  readonly deliveredQuantity: number;
  readonly serials: readonly string[];
}

export interface IssuedEventLine {
  readonly materialId: string;
  readonly quantity: number;
  readonly costAmount: number;
  readonly serials: readonly string[];
}

export interface IssueAllocation {
  readonly lineId: string;
  /** Dương khi xuất, âm khi đảo. */
  readonly quantity: number;
  readonly cost: number;
  /** Serial thêm (xuất) hoặc bỏ (đảo). */
  readonly serials: readonly string[];
}

/**
 * Chia một dòng chứng từ xuất vào các dòng đợt giao cùng mặt hàng.
 *
 * Xuất (`reverse = false`): lấp dần phần còn thiếu của từng dòng theo thứ tự;
 * xuất dư thì phần dư vào dòng cuối. Đảo: trừ dần từ dòng cuối có số đã giao.
 * Giá vốn chia theo tỷ lệ số lượng, dòng cuối nhận phần lẻ; serial chia theo
 * số lượng nguyên của từng phần (đảo thì bỏ serial ở dòng đang giữ nó).
 * Không có dòng cùng mặt hàng thì trả rỗng (bên gọi ghi nhật ký).
 */
export function allocateIssuedLine(targets: readonly IssueTargetLine[], line: IssuedEventLine, reverse: boolean): IssueAllocation[] {
  const matching = targets.filter((target) => target.materialId === line.materialId);
  if (!matching.length || line.quantity <= 0) return [];
  const parts: { target: IssueTargetLine; quantity: number }[] = [];
  let remaining = round3(line.quantity);
  if (!reverse) {
    for (const target of matching) {
      if (remaining <= 0) break;
      const room = round3(Math.max(0, target.plannedQuantity - target.deliveredQuantity));
      const take = Math.min(room, remaining);
      if (take > 0) {
        parts.push({ target, quantity: take });
        remaining = round3(remaining - take);
      }
    }
    if (remaining > 0) {
      const last = matching[matching.length - 1];
      const existing = parts.find((part) => part.target.id === last.id);
      if (existing) existing.quantity = round3(existing.quantity + remaining);
      else parts.push({ target: last, quantity: remaining });
    }
  } else {
    for (const target of [...matching].reverse()) {
      if (remaining <= 0) break;
      const take = Math.min(round3(target.deliveredQuantity), remaining);
      if (take > 0) {
        parts.push({ target, quantity: take });
        remaining = round3(remaining - take);
      }
    }
    if (!parts.length) return [];
  }

  const total = parts.reduce((sum, part) => sum + part.quantity, 0);
  let costLeft = round2(line.costAmount);
  let serialIndex = 0;
  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    const cost = isLast ? costLeft : round2((line.costAmount * part.quantity) / total);
    costLeft = round2(costLeft - cost);
    let serials: string[];
    if (reverse) {
      serials = line.serials.filter((serial) => part.target.serials.includes(serial));
    } else {
      const count = isLast ? line.serials.length - serialIndex : Math.min(Math.floor(part.quantity), line.serials.length - serialIndex);
      serials = line.serials.slice(serialIndex, serialIndex + count);
      serialIndex += count;
    }
    const sign = reverse ? -1 : 1;
    return { lineId: part.target.id, quantity: sign * part.quantity, cost: sign * cost, serials };
  });
}
