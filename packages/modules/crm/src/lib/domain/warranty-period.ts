import type { WarrantyCoverage, WarrantySource } from '@enterprise-platform/contracts-crm';

/**
 * Hạn bảo hành của một serial (mục 5 BRD, T6-02, Q9):
 *
 * - bắt đầu từ ngày giao thực tế của serial (ngày Kho ghi sổ xuất cho đợt giao
 *   chứa serial), không phải ngày đơn (TC-WAR-04);
 * - đơn đi từ hợp đồng có thời hạn bảo hành (lớn hơn 0) thì dùng thời hạn hợp
 *   đồng, kể cả khi ngắn hơn thời hạn mặt hàng (TC-WAR-02, TC-WAR-03); không
 *   thì dùng số tháng bảo hành của mặt hàng trong danh mục Kho;
 * - serial thay thế kế thừa đúng ngày hết hạn của serial được thay, không tính
 *   lại từ đầu (Q9);
 * - không có ngày giao hoặc không có thời hạn: coi như hết hạn (tiếp nhận loại
 *   có phí).
 *
 * `warrantyUntil` là ngày cuối còn bảo hành, tính cả ngày đó: giao 15/03, 12
 * tháng thì còn bảo hành đến hết 15/03 năm sau.
 */
export interface WarrantyPeriodInput {
  /** Ngày giao thực tế (YYYY-MM-DD). */
  readonly deliveredOn: string | null;
  /** Thời hạn bảo hành của hợp đồng (null: đơn không từ hợp đồng, hoặc hợp đồng không ghi). */
  readonly contractMonths: number | null;
  /** Số tháng bảo hành của mặt hàng trong danh mục Kho. */
  readonly materialMonths: number | null;
  /** Hạn kế thừa của serial được thay (Q9); có thì bỏ qua hai thời hạn trên. */
  readonly inheritedUntil?: string | null;
  /** Hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
  readonly today: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Cộng tháng theo lịch; ngày không có ở tháng đích thì lấy ngày cuối tháng
 * (31/01 + 1 tháng = 28/02 hoặc 29/02).
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const value = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return value.toISOString().slice(0, 10);
}

/** Số ngày từ `from` đến `to` (âm khi `to` trước `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Số tháng bảo hành hợp lệ (nguyên, lớn hơn 0); khác đi là "không có". */
function months(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function computeWarranty(input: WarrantyPeriodInput): WarrantyCoverage {
  const deliveredOn = isDate(input.deliveredOn) ? input.deliveredOn : null;
  if (isDate(input.inheritedUntil)) {
    return coverage(deliveredOn, null, 'INHERITED', input.inheritedUntil, input.today);
  }
  const contract = months(input.contractMonths);
  const material = months(input.materialMonths);
  const source: WarrantySource = contract !== null ? 'CONTRACT' : material !== null ? 'MATERIAL' : 'NONE';
  const term = contract ?? material;
  if (term === null || !deliveredOn) return coverage(deliveredOn, term, source, null, input.today);
  return coverage(deliveredOn, term, source, addMonths(deliveredOn, term), input.today);
}

function coverage(
  deliveredOn: string | null,
  term: number | null,
  source: WarrantySource,
  until: string | null,
  today: string,
): WarrantyCoverage {
  if (!until) return { deliveredOn, months: term, source, warrantyUntil: null, remainingDays: 0, expired: true };
  const remaining = daysBetween(today, until);
  return {
    deliveredOn,
    months: term,
    source,
    warrantyUntil: until,
    remainingDays: Math.max(0, remaining),
    expired: remaining < 0,
  };
}

/** Ngày theo giờ Việt Nam của một thời điểm (ngày giao lấy từ thời điểm Kho ghi sổ). */
export function vietnamDate(instant: Date | string | null | undefined): string | null {
  if (instant === null || instant === undefined) return null;
  const time = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (Number.isNaN(time)) return null;
  return new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
