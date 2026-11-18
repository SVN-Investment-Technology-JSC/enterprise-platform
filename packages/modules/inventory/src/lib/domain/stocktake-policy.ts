import type {
  StocktakeLine,
  StocktakeLotAllocation,
  StocktakeSerialAllocation,
  StocktakeSession,
  StocktakeStatus,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from './inventory.error.js';

/**
 * Quy tắc thuần của kiểm kê kho: máy trạng thái, tính chênh lệch và dựng các
 * dòng chứng từ điều chỉnh khi ghi sổ. Không gọi DB, không đụng Nest.
 */

/** Trạng thái theo từng hành động; chỉ các cặp này hợp lệ. */
const TRANSITIONS: Readonly<Record<StocktakeAction, readonly StocktakeStatus[]>> = {
  start: ['DRAFT'],
  count: ['COUNTING'],
  submit: ['COUNTING'],
  reject: ['PENDING_APPROVAL'],
  approve: ['PENDING_APPROVAL'],
  post: ['APPROVED'],
  cancel: ['DRAFT', 'COUNTING', 'PENDING_APPROVAL', 'APPROVED'],
};

export type StocktakeAction = 'start' | 'count' | 'submit' | 'reject' | 'approve' | 'post' | 'cancel';

const STATUS_LABEL: Readonly<Record<StocktakeStatus, string>> = {
  DRAFT: 'Bản nháp',
  COUNTING: 'Đang kiểm đếm',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã huỷ',
};

const ACTION_LABEL: Readonly<Record<StocktakeAction, string>> = {
  start: 'bắt đầu kiểm đếm',
  count: 'ghi số đếm',
  submit: 'gửi duyệt',
  reject: 'trả về đếm lại',
  approve: 'duyệt',
  post: 'ghi sổ',
  cancel: 'huỷ',
};

export function stocktakeStatusLabel(status: StocktakeStatus): string {
  return STATUS_LABEL[status];
}

export class InvalidStocktakeTransitionError extends InventoryError {
  constructor(code: string, status: StocktakeStatus, action: StocktakeAction) {
    super(
      'INVALID_STOCKTAKE_TRANSITION',
      `Đợt kiểm kê ${code} đang ở trạng thái "${STATUS_LABEL[status]}", không thể ${ACTION_LABEL[action]}.`,
      409,
    );
  }
}

export function assertStocktakeTransition(
  session: Pick<StocktakeSession, 'code' | 'status'>,
  action: StocktakeAction,
): void {
  if (!TRANSITIONS[action].includes(session.status)) {
    throw new InvalidStocktakeTransitionError(session.code, session.status, action);
  }
}

/** Người đếm và gửi duyệt không tự duyệt đợt của mình, trừ khi cấu hình tenant cho phép. */
export function assertStocktakeNotSelfApproved(
  session: { readonly code: string; readonly createdBy?: string; readonly submittedBy?: string },
  actorId: string,
  allowSelfApproval: boolean,
): void {
  if (allowSelfApproval) return;
  if (session.createdBy === actorId || session.submittedBy === actorId) {
    throw new InventoryError(
      'SELF_APPROVAL_FORBIDDEN',
      `Bạn đã lập hoặc gửi duyệt đợt ${session.code}, cần người khác duyệt.`,
      403,
    );
  }
}

/** Làm tròn 3 chữ số như cột NUMERIC(12,3) của tồn kho, tránh lệch do số thực. */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export type StocktakeLineStatus = StocktakeLine['status'];

export interface LineFigures {
  readonly difference: number;
  readonly differenceValue: number;
  readonly status: StocktakeLineStatus;
}

/** Chưa nhập số đếm thì chưa tính chênh lệch; có số đếm thì suy trạng thái dòng. */
export function lineFigures(
  systemQuantity: number,
  actualQuantity: number | undefined,
  unitCost: number,
): LineFigures {
  if (actualQuantity === undefined || actualQuantity === null) {
    return { difference: 0, differenceValue: 0, status: 'UNCOUNTED' };
  }
  const difference = round3(actualQuantity - systemQuantity);
  const differenceValue = Math.round(difference * unitCost * 100) / 100;
  const status: StocktakeLineStatus = difference === 0 ? 'MATCHED' : difference > 0 ? 'SURPLUS' : 'DEFICIT';
  return { difference, differenceValue, status };
}

export interface SessionTotals {
  readonly totalItems: number;
  readonly countedItems: number;
  readonly differenceItems: number;
  readonly totalVarianceValue: number;
}

export function sessionTotals(
  lines: readonly Pick<StocktakeLine, 'status' | 'differenceValue'>[],
): SessionTotals {
  let countedItems = 0;
  let differenceItems = 0;
  let totalVarianceValue = 0;
  for (const line of lines) {
    if (line.status === 'UNCOUNTED') continue;
    countedItems += 1;
    if (line.status !== 'MATCHED') {
      differenceItems += 1;
      totalVarianceValue += line.differenceValue ?? 0;
    }
  }
  return {
    totalItems: lines.length,
    countedItems,
    differenceItems,
    totalVarianceValue: Math.round(totalVarianceValue * 100) / 100,
  };
}

/** Số đếm hợp lệ: số hữu hạn, không âm, tối đa 3 chữ số thập phân. */
export function requireCountedQuantity(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InventoryError('VALIDATION', `${label}: số lượng đếm phải là số không âm.`);
  }
  if (round3(value) !== value) {
    throw new InventoryError('VALIDATION', `${label}: số lượng đếm tối đa 3 chữ số thập phân.`);
  }
  return value;
}

/** Dòng chênh lệch bắt buộc có lý do trước khi gửi duyệt. */
export function linesMissingReason(lines: readonly StocktakeLine[]): readonly StocktakeLine[] {
  return lines.filter(
    (line) => line.status !== 'UNCOUNTED' && line.status !== 'MATCHED' && !line.reason?.trim(),
  );
}

export interface AdjustmentLine {
  readonly materialCode: string;
  readonly quantity: number;
  readonly direction: 'IN' | 'OUT';
  readonly unitCost: number;
  readonly lotNo?: string;
  readonly serials?: readonly string[];
  readonly note: string;
}

/**
 * Dựng dòng chứng từ điều chỉnh từ các dòng đã đếm, mỗi dòng chênh lệch ra một
 * hoặc nhiều dòng chứng từ:
 *  - vật tư thường: một dòng, chiều theo dấu của chênh lệch;
 *  - vật tư theo lô: một dòng cho mỗi lô lệch, nhóm theo số lô; tổng chênh lệch
 *    các lô phải bằng chênh lệch của dòng;
 *  - vật tư theo serial: serial MISSING thành dòng giảm, EXTRA thành dòng tăng;
 *    số serial phải khớp chênh lệch của dòng.
 * Dòng chưa đếm bị bỏ qua. Dòng lô, serial chưa khai chi tiết mà có chênh lệch thì báo lỗi, không đoán.
 */
export function buildAdjustmentLines(
  sessionCode: string,
  lines: readonly StocktakeLine[],
): readonly AdjustmentLine[] {
  const result: AdjustmentLine[] = [];
  for (const line of lines) {
    // Dòng chưa đếm giữ nguyên số sổ sách: không điều chỉnh gì.
    if (line.status === 'UNCOUNTED' || line.difference === 0) continue;
    const unitCost = line.unitCost ?? 0;
    const label = `[Cân kho ${sessionCode}] ${line.materialCode}: ${
      line.difference > 0 ? 'thừa' : 'thiếu'
    } ${Math.abs(line.difference)} ${line.unit}${line.reason ? `. Lý do: ${line.reason.trim()}` : ''}`;

    if (line.isSerialized) {
      result.push(...serialAdjustment(line, unitCost, label));
    } else if (line.isLotTracked && line.lotAllocations?.length) {
      result.push(...lotAdjustment(line, unitCost, label));
    } else if (line.isLotTracked) {
      throw new InventoryError(
        'STOCKTAKE_LOT_DETAIL_REQUIRED',
        `${line.materialCode} quản lý theo lô và có chênh lệch ${line.difference}: hãy khai số đếm theo từng lô.`,
        409,
      );
    } else {
      result.push({
        materialCode: line.materialCode,
        quantity: Math.abs(line.difference),
        direction: line.difference > 0 ? 'IN' : 'OUT',
        unitCost,
        note: label,
      });
    }
  }
  return result;
}

function lotAdjustment(line: StocktakeLine, unitCost: number, note: string): AdjustmentLine[] {
  const byLot = new Map<string, number>();
  for (const allocation of line.lotAllocations ?? ([] as readonly StocktakeLotAllocation[])) {
    const lotNo = allocation.lotNumber.trim().toUpperCase();
    byLot.set(lotNo, round3((byLot.get(lotNo) ?? 0) + (allocation.actualQty - allocation.systemQty)));
  }
  const total = round3([...byLot.values()].reduce((sum, value) => sum + value, 0));
  if (total !== line.difference) {
    throw new InventoryError(
      'STOCKTAKE_LOT_MISMATCH',
      `${line.materialCode}: tổng chênh lệch theo lô (${total}) khác chênh lệch của dòng (${line.difference}).`,
      409,
    );
  }
  return [...byLot.entries()]
    .filter(([, difference]) => difference !== 0)
    .map(([lotNo, difference]) => ({
      materialCode: line.materialCode,
      quantity: Math.abs(difference),
      direction: difference > 0 ? ('IN' as const) : ('OUT' as const),
      unitCost,
      lotNo,
      note,
    }));
}

function serialAdjustment(line: StocktakeLine, unitCost: number, note: string): AdjustmentLine[] {
  const allocations = line.serialAllocations ?? ([] as readonly StocktakeSerialAllocation[]);
  const missing = allocations.filter((item) => item.status === 'MISSING').map((item) => item.serialNumber.trim());
  const extra = allocations.filter((item) => item.status === 'EXTRA').map((item) => item.serialNumber.trim());
  if (extra.length - missing.length !== line.difference) {
    throw new InventoryError(
      'STOCKTAKE_SERIAL_MISMATCH',
      `${line.materialCode} theo serial: số serial thừa trừ thiếu (${extra.length - missing.length}) khác chênh lệch của dòng (${line.difference}). Hãy khai đủ serial thiếu hoặc thừa.`,
      409,
    );
  }
  const out: AdjustmentLine[] = [];
  if (missing.length) {
    out.push({ materialCode: line.materialCode, quantity: missing.length, direction: 'OUT', unitCost, serials: missing, note });
  }
  if (extra.length) {
    out.push({ materialCode: line.materialCode, quantity: extra.length, direction: 'IN', unitCost, serials: extra, note });
  }
  return out;
}

/** Mã đợt kế tiếp theo mẫu KK-YYYY-xxxxx từ mã lớn nhất trong năm. */
export function nextStocktakeCode(year: number, latestCode: string | undefined): string {
  const prefix = `KK-${year}-`;
  const latest = latestCode?.startsWith(prefix) ? Number(latestCode.slice(prefix.length)) : 0;
  const next = Number.isFinite(latest) ? latest + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}
