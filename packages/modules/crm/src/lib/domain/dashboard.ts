import type {
  DashboardGranularity,
  DashboardMetric,
  DashboardPeriod,
  DashboardRange,
  DashboardRate,
  DashboardTrendBucket,
} from '@enterprise-platform/contracts-crm';
import { addDays, daysOverdue } from './receivables.js';
import { resolvePeriod } from './sales-report.js';

/**
 * Tính toán thuần của dashboard Tổng quan: kỳ và kỳ so sánh, phần trăm thay
 * đổi, chia mốc biểu đồ xu hướng. Ngày là chuỗi `YYYY-MM-DD` theo giờ Việt Nam.
 */

/** Ngày đầu tháng của `date` dịch `months` tháng. */
function monthStart(date: string, months = 0): string {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Ngày cuối tháng chứa `date`. */
function monthEnd(date: string): string {
  return addDays(monthStart(date, 1), -1);
}

/** Số ngày từ `from` tới `to` (`to - from`). */
function span(from: string, to: string): number {
  return daysOverdue(from, to) ?? 0;
}

const MONTHS_PER: Readonly<Record<Exclude<DashboardPeriod, 'custom'>, number>> = { month: 1, quarter: 3, year: 12 };

/** Ngày đầu kỳ (tháng, quý, năm) chứa `today`. */
export function periodStart(period: Exclude<DashboardPeriod, 'custom'>, today: string): string {
  const month = Number(today.slice(5, 7));
  if (period === 'month') return monthStart(today);
  if (period === 'quarter') return `${today.slice(0, 5)}${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  return `${today.slice(0, 4)}-01-01`;
}

/**
 * Kỳ đang xem và kỳ so sánh.
 *
 * - Tháng, quý, năm: từ đầu kỳ tới hôm nay; kỳ trước là cùng số ngày tính từ đầu
 *   kỳ liền trước, không vượt cuối kỳ đó (ngày 31/3 so với 1/2 – 28/2).
 * - Tuỳ chọn: kiểm như báo cáo (từ trước đến, tối đa 3 năm); kỳ trước là cùng
 *   số ngày liền trước ngày bắt đầu.
 */
export function resolveDashboardRange(
  period: DashboardPeriod,
  fromRaw: unknown,
  toRaw: unknown,
  today: string,
): { range: DashboardRange; previous: DashboardRange } {
  if (period === 'custom') {
    const range = resolvePeriod(fromRaw, toRaw, today);
    const length = span(range.from, range.to);
    const previousTo = addDays(range.from, -1);
    return { range, previous: { from: addDays(previousTo, -length), to: previousTo } };
  }
  const from = periodStart(period, today);
  const previousFrom = monthStart(from, -MONTHS_PER[period]);
  const previousEnd = addDays(from, -1);
  const candidate = addDays(previousFrom, span(from, today));
  return { range: { from, to: today }, previous: { from: previousFrom, to: candidate < previousEnd ? candidate : previousEnd } };
}

/** Thay đổi (%) so với kỳ trước, 1 chữ số. Kỳ trước 0: cùng 0 thì 0, khác 0 thì `null` (không so được). */
export function changePercent(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) * 1000) / Math.abs(previous)) / 10;
}

export function metric(value: number, previous: number): DashboardMetric {
  return { value, previous, changePercent: changePercent(value, previous) };
}

/** Tỷ lệ kèm chênh lệch điểm phần trăm (2 chữ số). */
export function rate(value: number | null, previous: number | null): DashboardRate {
  return {
    value,
    previous,
    changePoints: value === null || previous === null ? null : Math.round((value - previous) * 100) / 100,
  };
}

/** Mốc biểu đồ: tới 31 ngày theo ngày, tới 92 ngày theo tuần, dài hơn theo tháng. */
export function trendGranularity(range: DashboardRange): DashboardGranularity {
  const days = span(range.from, range.to) + 1;
  if (days <= 31) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

/** Thứ Hai của tuần chứa `date`. */
function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** Ngày đầu mốc chứa `date` (chưa cắt theo kỳ). */
export function bucketStart(date: string, granularity: DashboardGranularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'week') return weekStart(date);
  return monthStart(date);
}

function bucketEnd(start: string, granularity: DashboardGranularity): string {
  if (granularity === 'day') return start;
  if (granularity === 'week') return addDays(start, 6);
  return monthEnd(start);
}

/** Một ngày có số liệu: doanh thu theo ngày giao, đơn theo ngày tạo. */
export interface DailyFigure {
  readonly date: string;
  readonly revenue: number;
  readonly orders: number;
}

/**
 * Chia kỳ thành các mốc liên tục (mốc không có số liệu vẫn có, bằng 0) rồi cộng
 * số liệu từng ngày vào mốc chứa nó. Mốc đầu, cuối cắt theo kỳ. Ngày ngoài kỳ bỏ qua.
 */
export function buildTrend(range: DashboardRange, daily: readonly DailyFigure[]): {
  granularity: DashboardGranularity;
  buckets: DashboardTrendBucket[];
} {
  const granularity = trendGranularity(range);
  const buckets: { start: string; end: string; revenue: number; orders: number }[] = [];
  const index = new Map<string, number>();
  for (let start = bucketStart(range.from, granularity); start <= range.to; start = addDays(bucketEnd(start, granularity), 1)) {
    index.set(start, buckets.length);
    const end = bucketEnd(start, granularity);
    buckets.push({
      start: start < range.from ? range.from : start,
      end: end > range.to ? range.to : end,
      revenue: 0,
      orders: 0,
    });
  }
  for (const day of daily) {
    if (day.date < range.from || day.date > range.to) continue;
    const position = index.get(bucketStart(day.date, granularity));
    if (position === undefined) continue;
    buckets[position].revenue += day.revenue;
    buckets[position].orders += day.orders;
  }
  return {
    granularity,
    buckets: buckets.map((bucket) => ({ ...bucket, revenue: Math.round(bucket.revenue) })),
  };
}
