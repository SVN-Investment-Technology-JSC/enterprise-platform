/**
 * Phép năm tính theo ngày ký HĐLĐ chính thức đầu tiên.
 *
 * - Một tháng được tính khi nhân viên thuộc diện hưởng phép ít nhất
 *   `MIN_DAYS_PER_MONTH` ngày lịch trong tháng đó (áp dụng cho tháng bắt đầu,
 *   tháng nghỉ việc và tháng đạt mốc thâm niên). Hiện là 1 ngày: có hiệu lực
 *   bất kỳ ngày nào trong tháng thì tháng đó được +1 phép (không còn ngưỡng 15 ngày).
 * - Định mức năm chia đều 12 tháng; phần lẻ làm tròn luỹ kế để tổng các tháng
 *   đúng bằng định mức.
 * - Thâm niên lấy mốc cao nhất đã đạt và cộng nguyên ngày (không chia 1/12): tháng
 *   đầu tiên được tính trong năm cộng tổng mốc đã đạt, mốc mới đạt giữa năm cộng
 *   thêm phần chênh vào tháng đạt mốc.
 *
 * Mọi ngày là chuỗi `YYYY-MM-DD`, tính theo UTC để không lệch múi giờ.
 */
// Quy tắc cũ: phải đủ 15 ngày lịch trong tháng mới được tính (bỏ comment để dùng lại).
// export const MIN_DAYS_PER_MONTH = 15;
export const MIN_DAYS_PER_MONTH = 1;

export interface SeniorityTier {
  readonly minYears: number;
  readonly bonusDays: number;
}

export interface AnnualLeavePolicy {
  readonly annualDays: number;
  readonly startOffsetMonths: number;
  readonly tiers: readonly SeniorityTier[];
  /** Hiệu lực của lịch cộng phép (kể cả hai đầu). */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface MonthEntitlement {
  readonly month: number;
  readonly counted: boolean;
  readonly base: number;
  readonly seniority: number;
  /** Mốc thâm niên (số năm) áp dụng cho tháng, 0 nếu chưa đạt mốc nào. */
  readonly tierYears: number;
}

const DAY = 86_400_000;

function parse(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`Ngày không hợp lệ: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}
function format(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
function round2(value: number): number {
  return Math.round(value * 100 + Number.EPSILON) / 100;
}

/** Cộng `months` tháng; ngày cuối tháng được kẹp (31/01 + 1 tháng = 28/02). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return format(target.getTime());
}

export function monthStart(year: number, month: number): string {
  return format(Date.UTC(year, month - 1, 1));
}
export function monthEnd(year: number, month: number): string {
  return format(Date.UTC(year, month, 0));
}

/** Số ngày lịch của [from, to] nằm trong tháng; 0 nếu không giao nhau. */
export function daysInMonthWithin(
  year: number,
  month: number,
  from: string,
  to: string | null,
): number {
  const start = Math.max(parse(monthStart(year, month)), parse(from));
  const end = Math.min(
    parse(monthEnd(year, month)),
    to ? parse(to) : Number.POSITIVE_INFINITY,
  );
  return end < start ? 0 : Math.round((end - start) / DAY) + 1;
}

export function countsMonth(
  year: number,
  month: number,
  from: string,
  to: string | null,
): boolean {
  return daysInMonthWithin(year, month, from, to) >= MIN_DAYS_PER_MONTH;
}

/** Ngày bắt đầu hưởng phép = ngày ký HĐ + N tháng. */
export function eligibilityStart(signDate: string, offsetMonths: number) {
  return addMonths(signDate, offsetMonths);
}

/**
 * Mốc thâm niên áp dụng cho một tháng: mốc cao nhất có ngày kỷ niệm sớm đủ để
 * còn ít nhất MIN_DAYS_PER_MONTH ngày trong tháng (hoặc đã đạt trước tháng).
 */
export function seniorityTierForMonth(
  signDate: string,
  year: number,
  month: number,
  tiers: readonly SeniorityTier[],
): SeniorityTier | null {
  let best: SeniorityTier | null = null;
  for (const tier of tiers) {
    const anniversary = addMonths(signDate, tier.minYears * 12);
    if (!countsMonth(year, month, anniversary, null)) continue;
    if (!best || tier.minYears > best.minYears) best = tier;
  }
  return best;
}

export function validateSeniorityTiers(tiers: readonly SeniorityTier[]) {
  const seen = new Set<number>();
  for (const tier of tiers) {
    if (
      !Number.isInteger(tier.minYears) ||
      tier.minYears < 1 ||
      tier.minYears > 60
    )
      throw new Error('Mốc thâm niên phải là số năm nguyên từ 1 đến 60');
    if (
      !Number.isFinite(tier.bonusDays) ||
      tier.bonusDays < 0 ||
      tier.bonusDays > 100
    )
      throw new Error('Số ngày thâm niên phải từ 0 đến 100');
    if (seen.has(tier.minYears))
      throw new Error(`Mốc thâm niên ${tier.minYears} năm bị trùng`);
    seen.add(tier.minYears);
  }
}

/**
 * Phép từng tháng của `year`.
 * @param lastWorkingDay ngày làm việc cuối cùng (nghỉ việc), null nếu còn làm.
 */
export function monthlyEntitlement(
  policy: AnnualLeavePolicy,
  signDate: string,
  year: number,
  lastWorkingDay: string | null = null,
): MonthEntitlement[] {
  const eligible = eligibilityStart(signDate, policy.startOffsetMonths);
  const start =
    eligible > policy.effectiveFrom ? eligible : policy.effectiveFrom;
  const ends = [lastWorkingDay, policy.effectiveTo ?? null].filter(
    (d): d is string => Boolean(d),
  );
  const end = ends.length ? ends.sort()[0] : null;
  const months: MonthEntitlement[] = [];
  let baseExact = 0,
    baseCredited = 0,
    // seniorityExact = 0, // cách cũ: chia đều 1/12 theo tháng (xem khối comment bên dưới)
    seniorityCredited = 0;
  for (let month = 1; month <= 12; month++) {
    const counted = countsMonth(year, month, start, end);
    const tier = counted
      ? seniorityTierForMonth(signDate, year, month, policy.tiers)
      : null;
    let base = 0,
      seniority = 0;
    if (counted) {
      baseExact += policy.annualDays / 12;
      base = round2(round2(baseExact) - baseCredited);
      baseCredited = round2(baseCredited + base);
      // Cách cũ (chia 1/12 mỗi tháng), bỏ comment để dùng lại:
      // if (tier && tier.bonusDays > 0) {
      //   seniorityExact += tier.bonusDays / 12;
      //   seniority = round2(round2(seniorityExact) - seniorityCredited);
      //   seniorityCredited = round2(seniorityCredited + seniority);
      // }
      // Cách mới: cộng nguyên ngày theo mốc (5 năm +1, 10 năm +2...), phần chênh khi đạt mốc mới.
      if (tier && tier.bonusDays > seniorityCredited) {
        seniority = round2(tier.bonusDays - seniorityCredited);
        seniorityCredited = round2(seniorityCredited + seniority);
      }
    }
    months.push({
      month,
      counted,
      base,
      seniority,
      tierYears: tier?.minYears ?? 0,
    });
  }
  return months;
}

export function sumEntitlement(
  months: readonly MonthEntitlement[],
  throughMonth = 12,
): { base: number; seniority: number; total: number } {
  let base = 0,
    seniority = 0;
  for (const m of months)
    if (m.month <= throughMonth) {
      base += m.base;
      seniority += m.seniority;
    }
  base = round2(base);
  seniority = round2(seniority);
  return { base, seniority, total: round2(base + seniority) };
}

/** Ngày trước một ngày (YYYY-MM-DD). */
export function previousDate(date: string): string {
  return format(parse(date) - DAY);
}

/** Ngày làm việc cuối cùng từ `inactive_from` (ngày đầu tiên không còn làm). */
export function lastWorkingDayFromInactive(
  inactiveFrom: string | null | undefined,
): string | null {
  return inactiveFrom ? format(parse(inactiveFrom) - DAY) : null;
}
