/**
 * Dự toán của dự án bán hàng (P2D-09): nhập, tính lợi nhuận và đối chiếu với PAKD. Thuần hàm, không phụ thuộc React.
 */

/** Chỉ giữ chữ số (tiền đồng, không có phần lẻ). */
export function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, '');
}

export interface EstimateInput {
  readonly total: string;
  readonly cost: string;
}

export type EstimateParse =
  | { readonly ok: true; readonly total: number | null; readonly cost: number | null }
  | { readonly ok: false; readonly message: string };

function parseAmount(text: string, label: string): { value: number | null } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value >= 1e16) return { error: `${label} phải là số không âm.` };
  return { value };
}

/** Rỗng là xoá giá trị (`null`); số âm hoặc không phải số thì báo lỗi tiếng Việt. */
export function parseEstimateInput(input: EstimateInput): EstimateParse {
  const total = parseAmount(input.total, 'Tổng giá trị dự toán');
  if ('error' in total) return { ok: false, message: total.error };
  const cost = parseAmount(input.cost, 'Giá vốn dự kiến');
  if ('error' in cost) return { ok: false, message: cost.error };
  return { ok: true, total: total.value, cost: cost.value };
}

export interface EstimateSummary {
  readonly profit: number;
  /** Tỷ suất lợi nhuận trên tổng giá trị (%, 2 số lẻ); `null` khi tổng bằng 0. */
  readonly marginPercent: number | null;
}

/** Cần đủ cả hai số mới tính lợi nhuận dự toán. */
export function summarizeEstimate(total: number | null, cost: number | null): EstimateSummary | null {
  if (total === null || cost === null) return null;
  const profit = total - cost;
  return { profit, marginPercent: total > 0 ? Math.round((profit / total) * 10000) / 100 : null };
}

/** Số liệu của PAKD (khi đã có) để đối chiếu; chưa có PAKD thì truyền `null`. */
export interface BusinessPlanFigures {
  readonly totalValue: number;
  readonly totalCost: number;
}

export interface EstimateComparison {
  readonly status: 'NO_PLAN' | 'NO_ESTIMATE' | 'MATCH' | 'DIFFERENT';
  readonly message: string;
  /** Dự toán trừ PAKD, theo tổng giá trị; có khi cả hai bên đã có số. */
  readonly totalDelta: number | null;
  readonly costDelta: number | null;
}

/** Đối chiếu dự toán với PAKD; chưa có PAKD thì chỉ hiển thị dự toán. */
export function compareEstimateWithPlan(
  total: number | null,
  cost: number | null,
  plan: BusinessPlanFigures | null,
): EstimateComparison {
  if (!plan) {
    return { status: 'NO_PLAN', message: 'Chưa có phương án kinh doanh để đối chiếu.', totalDelta: null, costDelta: null };
  }
  if (total === null && cost === null) {
    return { status: 'NO_ESTIMATE', message: 'Chưa nhập dự toán để đối chiếu với phương án kinh doanh.', totalDelta: null, costDelta: null };
  }
  const totalDelta = total === null ? null : total - plan.totalValue;
  const costDelta = cost === null ? null : cost - plan.totalCost;
  const same = (totalDelta ?? 0) === 0 && (costDelta ?? 0) === 0;
  return {
    status: same ? 'MATCH' : 'DIFFERENT',
    message: same ? 'Dự toán khớp với phương án kinh doanh.' : 'Dự toán lệch so với phương án kinh doanh.',
    totalDelta,
    costDelta,
  };
}
