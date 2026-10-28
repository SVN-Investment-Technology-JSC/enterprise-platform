import {
  CONVERSION_STAGES,
  SALES_REPORT_MAX_DAYS,
  type ConversionStage,
  type ConversionStep,
  type SalesFigures,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';
import { optionalDate } from './fields.js';
import { computeMargin, roundVnd } from './pricing-engine.js';
import { daysOverdue, deliveredValue } from './receivables.js';

/**
 * Tính toán thuần của báo cáo Bán hàng (GĐ7): phần doanh thu của một dòng giao,
 * số liệu tổng hợp, tỷ lệ chuyển đổi, kỳ báo cáo. Không đọc DB.
 */

/** Dòng đơn: số lượng đặt, thành tiền sau chiết khấu chưa VAT, VAT của cả dòng. */
export interface FactLine {
  readonly quantity: number;
  readonly lineAmount: number;
  readonly vatAmount: number;
}

/**
 * Doanh thu và VAT của phần số đã giao đổi từ `before` sang `after` (âm khi
 * chứng từ đảo). Lấy giá trị luỹ kế sau trừ luỹ kế trước như ghi nợ (D3), nên
 * giao nhiều lần cộng lại đúng bằng thành tiền của dòng, không lệch đồng lẻ.
 */
export function factAmounts(line: FactLine, before: number, after: number): { revenue: number; vatAmount: number } {
  const value = (total: number, delivered: number) => deliveredValue({ quantity: line.quantity, lineTotal: total }, delivered);
  return {
    revenue: roundVnd(value(line.lineAmount, after) - value(line.lineAmount, before)),
    vatAmount: roundVnd(value(line.vatAmount, after) - value(line.vatAmount, before)),
  };
}

/** Tổng cộng thô đọc từ `sales_facts`. */
export interface RawFigures {
  readonly quantity: number;
  readonly revenue: number;
  readonly vatAmount: number;
  readonly costAmount: number;
  readonly orderCount: number;
}

/** Lợi nhuận gộp = doanh thu − giá vốn thực tế; biên theo engine giá (2 chữ số). */
export function salesFigures(raw: RawFigures): SalesFigures {
  const revenue = roundVnd(raw.revenue);
  const costAmount = roundVnd(raw.costAmount);
  return {
    quantity: Math.round(raw.quantity * 1000) / 1000,
    revenue,
    vatAmount: roundVnd(raw.vatAmount),
    costAmount,
    profit: roundVnd(revenue - costAmount),
    marginPercent: computeMargin(revenue, costAmount),
    orderCount: raw.orderCount,
  };
}

/** `part / whole` theo %, 2 chữ số; `whole` bằng 0 thì `null`. */
export function percentOf(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part * 10_000) / whole) / 100;
}

/** Các bước phễu cơ hội → báo giá → hợp đồng → đơn: tỷ lệ so với bước trước và với số cơ hội. */
export function conversionSteps(counts: Readonly<Record<ConversionStage, number>>): ConversionStep[] {
  const opportunities = counts.OPPORTUNITY;
  return CONVERSION_STAGES.map((stage, index) => ({
    stage,
    count: counts[stage],
    stepPercent: index === 0 ? null : percentOf(counts[stage], counts[CONVERSION_STAGES[index - 1]]),
    overallPercent: percentOf(counts[stage], opportunities),
  }));
}

/**
 * Kỳ báo cáo `[from, to]` (gồm hai mốc): mặc định từ đầu tháng của `today` tới
 * `today`. Từ sau đến, hoặc dài quá `SALES_REPORT_MAX_DAYS`, là lỗi nhập.
 */
export function resolvePeriod(fromRaw: unknown, toRaw: unknown, today: string): { from: string; to: string } {
  const to = optionalDate(toRaw, 'đến ngày') ?? today;
  const from = optionalDate(fromRaw, 'từ ngày') ?? `${to.slice(0, 8)}01`;
  if (from > to) throw new CrmValidationError('INVALID_PERIOD', 'Từ ngày phải trước hoặc bằng đến ngày.');
  if ((daysOverdue(from, to) ?? 0) > SALES_REPORT_MAX_DAYS) {
    throw new CrmValidationError('PERIOD_TOO_LONG', 'Kỳ báo cáo dài tối đa 3 năm. Vui lòng thu hẹp kỳ.');
  }
  return { from, to };
}
