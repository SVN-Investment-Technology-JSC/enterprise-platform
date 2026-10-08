import type { StocktakeLine } from '@enterprise-platform/contracts-inventory';

export type StocktakeLineStatus = StocktakeLine['status'];

/** Số lượng kiểm kê lưu tới 3 chữ số thập phân (NUMERIC(12,3)). */
export const STOCKTAKE_MAX_QUANTITY = 999_999_999;

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Chênh lệch = thực đếm - sổ sách; chưa đếm thì không có chênh lệch. */
export function stocktakeDifference(
  systemQuantity: number,
  actualQuantity: number | null | undefined,
): number {
  if (actualQuantity === null || actualQuantity === undefined) return 0;
  return roundQuantity(actualQuantity - systemQuantity);
}

export function stocktakeLineStatus(
  systemQuantity: number,
  actualQuantity: number | null | undefined,
): StocktakeLineStatus {
  if (actualQuantity === null || actualQuantity === undefined) return 'UNCOUNTED';
  const diff = stocktakeDifference(systemQuantity, actualQuantity);
  if (diff === 0) return 'MATCHED';
  return diff > 0 ? 'SURPLUS' : 'DEFICIT';
}

export interface StocktakeAdjustmentPlan {
  readonly lineId: string;
  readonly materialCode: string;
  readonly systemQuantity: number;
  readonly actualQuantity: number;
  /** Có dấu: dương = thừa (nhập vào sổ), âm = thiếu (xuất khỏi sổ). */
  readonly delta: number;
  readonly reason: string;
}

/**
 * Chỉ các dòng đã đếm và có chênh lệch khác 0 mới sinh bút toán điều chỉnh;
 * dòng khớp hoặc chưa đếm không để lại dấu vết trong sổ cái.
 */
export function planStocktakeAdjustments(
  lines: readonly Pick<
    StocktakeLine,
    'id' | 'materialCode' | 'systemQuantity' | 'actualQuantity' | 'reason'
  >[],
): StocktakeAdjustmentPlan[] {
  const plans: StocktakeAdjustmentPlan[] = [];
  for (const line of lines) {
    if (line.actualQuantity === null || line.actualQuantity === undefined) continue;
    const delta = stocktakeDifference(line.systemQuantity, line.actualQuantity);
    if (delta === 0) continue;
    plans.push({
      lineId: line.id,
      materialCode: line.materialCode,
      systemQuantity: line.systemQuantity,
      actualQuantity: line.actualQuantity,
      delta,
      reason: line.reason?.trim() || 'Đối soát kiểm kê',
    });
  }
  return plans;
}
