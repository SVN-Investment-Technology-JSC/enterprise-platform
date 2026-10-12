import { BadRequestException } from '@nestjs/common';

/**
 * Logic thuần (không truy cập DB) của chính sách cộng phép: mốc tính phép, trễ N tháng,
 * mốc thâm niên, quỹ phép dự kiến cả năm, ứng phép và phép được hưởng đến ngày nghỉ việc.
 * Ngày luôn là chuỗi YYYY-MM-DD, tháng là YYYY-MM.
 */

export type BasisDateSource = 'JOIN_DATE' | 'CURRENT_CONTRACT_SIGN_DATE';
export type AccrualTiming = 'END_OF_MONTH' | 'START_OF_MONTH';

export interface PolicyContract {
  readonly contractType: string;
  readonly signDate?: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly status: string;
}

export interface SeniorityMilestone {
  readonly years: number;
  readonly extraDays: number;
}

export interface PolicySchedule {
  readonly accrualFrequency: string;
  readonly accrualAmount: number;
  readonly prorationRule?: string | null;
  readonly seniorityBonusYears: number;
  readonly seniorityBonusDays: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly basisDateSource: BasisDateSource;
  readonly startDelayMonths: number;
  readonly accrualTiming: AccrualTiming;
  readonly milestones: readonly SeniorityMilestone[];
}

export interface PolicyEmployee {
  readonly joinDate: string;
  readonly contracts: readonly PolicyContract[];
  /** Ngày nghỉ việc (inactive_from); null = đang làm việc hoặc chưa biết. */
  readonly terminationDate?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

/** Bỏ dấu, hạ chữ thường để nhận diện loại hợp đồng thử việc ("PROBATION", "Thử việc", "thu viec"). */
export function normalizeContractType(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isProbationContract(contractType: string): boolean {
  const t = normalizeContractType(contractType);
  return t.includes('probation') || t.includes('thu viec');
}

export function lastDayOfMonth(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function addMonths(month: string, count: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 7);
}

/**
 * Hợp đồng hiện hành không tính thử việc tại `asOf`: trạng thái ACTIVE/EXPIRED (loại nháp và đã chấm dứt),
 * effective_from <= asOf <= effective_to (hoặc không có effective_to). Nhiều hợp đồng: lấy hợp đồng bắt đầu muộn nhất.
 */
export function currentOfficialContract(
  contracts: readonly PolicyContract[],
  asOf: string,
): PolicyContract | null {
  const candidates = contracts.filter(
    (c) =>
      ['ACTIVE', 'EXPIRED'].includes(c.status) &&
      !isProbationContract(c.contractType) &&
      c.effectiveFrom <= asOf &&
      (!c.effectiveTo || c.effectiveTo >= asOf),
  );
  candidates.sort(
    (a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) ||
      (b.signDate ?? b.effectiveFrom).localeCompare(a.signDate ?? a.effectiveFrom),
  );
  return candidates[0] ?? null;
}

export interface BasisResolution {
  readonly date: string | null;
  readonly reason?: string;
}

export function resolveBasisDate(
  source: BasisDateSource,
  joinDate: string,
  contracts: readonly PolicyContract[],
  asOf: string,
): BasisResolution {
  if (source === 'JOIN_DATE') return { date: joinDate };
  const contract = currentOfficialContract(contracts, asOf);
  if (!contract)
    return {
      date: null,
      reason: 'Chưa có hợp đồng chính thức hiện hành (không tính thử việc)',
    };
  return { date: contract.signDate || contract.effectiveFrom };
}

/** Ngày đầu tiên được tính phép: N=0 thì chính ngày mốc; N>0 thì ngày 1 của tháng (tháng mốc + N). */
export function eligibleFrom(basisDate: string, startDelayMonths: number): string {
  if (!startDelayMonths) return basisDate;
  return `${addMonths(basisDate.slice(0, 7), startDelayMonths)}-01`;
}

/** Ngày kỷ niệm trong năm `year` (29/02 lùi về ngày cuối tháng 2 của năm không nhuận). */
export function anniversaryDate(basisDate: string, year: number): string {
  const month = basisDate.slice(5, 7);
  const last = lastDayOfMonth(`${year}-${month}`);
  const day = basisDate.slice(8, 10);
  return `${year}-${month}-${day > last.slice(8, 10) ? last.slice(8, 10) : day}`;
}

/** Thâm niên theo năm tròn tại `onDate` (chưa đến ngày/tháng kỷ niệm thì chưa đủ năm). */
export function seniorityYears(basisDate: string, onDate: string): number {
  let years = Number(onDate.slice(0, 4)) - Number(basisDate.slice(0, 4));
  if (onDate.slice(5) < basisDate.slice(5)) years -= 1;
  return Math.max(0, years);
}

/**
 * Phần thưởng thâm niên: nếu lịch có mốc thì lấy mốc CAO NHẤT đã đạt (không cộng dồn);
 * chưa có mốc nào thì dùng cặp cũ floor(thâm niên / N) * M.
 */
export function seniorityBonus(
  milestones: readonly SeniorityMilestone[],
  legacy: { years: number; days: number },
  years: number,
): number {
  if (milestones.length) {
    const reached = milestones
      .filter((m) => m.years > 0 && m.years <= years)
      .sort((a, b) => b.years - a.years)[0];
    return reached ? reached.extraDays : 0;
  }
  return legacy.years > 0 ? Math.floor(years / legacy.years) * legacy.days : 0;
}

export interface MonthlyAccrual {
  readonly amount: number;
  /** true khi tháng này chưa đến mốc được tính phép (trễ N tháng / chưa có mốc). */
  readonly notEligible: boolean;
}

function minDate(...dates: (string | null | undefined)[]): string {
  return dates.filter((d): d is string => !!d).sort()[0];
}
function maxDate(...dates: string[]): string {
  return [...dates].sort().pop()!;
}

/**
 * Định mức cộng của MỘT lịch cho MỘT tháng (chưa làm tròn tới sổ cái ngoài 2 chữ số).
 * `cutoff` (ngày nghỉ việc) cắt khoảng hưởng; kỳ bị cắt giữa chừng luôn phân bổ theo ngày.
 */
export function monthlyAccrual(
  schedule: PolicySchedule,
  basisDate: string,
  month: string,
  cutoff?: string | null,
): MonthlyAccrual {
  const start = `${month}-01`,
    end = lastDayOfMonth(month),
    monthNo = Number(month.slice(5, 7)),
    year = Number(month.slice(0, 4));
  const eligible = eligibleFrom(basisDate, schedule.startDelayMonths);
  if (eligible > end) return { amount: 0, notEligible: true };
  if (schedule.accrualFrequency === 'MILESTONE')
    throw new BadRequestException(
      'Lịch mốc cần quy định mốc cụ thể; chưa thể tự động cộng',
    );
  const f = schedule.accrualFrequency;
  const due =
    f === 'MONTHLY' ||
    (f === 'QUARTERLY' && monthNo % 3 === 0) ||
    (f === 'YEARLY' && monthNo === 12);
  const periodStart =
    f === 'YEARLY'
      ? `${year}-01-01`
      : f === 'QUARTERLY'
        ? `${year}-${String(Math.floor((monthNo - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
        : start;
  const effectiveStart = maxDate(periodStart, eligible, schedule.effectiveFrom);
  const effectiveEnd = minDate(end, schedule.effectiveTo, cutoff);
  let amount =
    due && effectiveStart <= effectiveEnd ? Number(schedule.accrualAmount) : 0;
  const cutMidPeriod = !!cutoff && cutoff < end;
  if (schedule.prorationRule && !['BY_JOIN_DATE', 'NONE'].includes(schedule.prorationRule))
    throw new BadRequestException('Quy tắc phân bổ phép chưa được hỗ trợ');
  if (schedule.prorationRule === 'BY_JOIN_DATE' || (amount && cutMidPeriod)) {
    amount *=
      Math.max(
        0,
        Date.parse(effectiveEnd) - Date.parse(effectiveStart) + DAY,
      ) /
      (Date.parse(end) - Date.parse(periodStart) + DAY);
  }
  const anniversary = anniversaryDate(basisDate, year);
  if (
    monthNo === Number(basisDate.slice(5, 7)) &&
    anniversary >= schedule.effectiveFrom &&
    (!schedule.effectiveTo || anniversary <= schedule.effectiveTo) &&
    (!cutoff || anniversary <= cutoff)
  )
    amount += seniorityBonus(
      schedule.milestones,
      {
        years: Number(schedule.seniorityBonusYears),
        days: Number(schedule.seniorityBonusDays),
      },
      year - Number(basisDate.slice(0, 4)),
    );
  return { amount: round2(amount), notEligible: false };
}

/** Lịch có hiệu lực (giao nhau) với tháng không. */
export function scheduleCoversMonth(
  schedule: Pick<PolicySchedule, 'effectiveFrom' | 'effectiveTo'>,
  month: string,
): boolean {
  return (
    schedule.effectiveFrom <= lastDayOfMonth(month) &&
    (!schedule.effectiveTo || schedule.effectiveTo >= `${month}-01`)
  );
}

/**
 * Tổng định mức cả năm của một nhân viên: các tháng đến `asOf` dùng hợp đồng hiện hành của tháng đó,
 * các tháng sau `asOf` giả định mốc tính phép không đổi (mốc tại asOf).
 * `upTo` (ngày nghỉ việc) cắt các tháng sau ngày đó.
 */
export function yearEntitlement(
  schedules: readonly PolicySchedule[],
  employee: PolicyEmployee,
  year: number,
  asOf: string,
  upTo?: string | null,
): number {
  const cutoff = upTo ?? employee.terminationDate ?? null;
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    const end = lastDayOfMonth(month);
    if (cutoff && cutoff < `${month}-01`) break;
    const basisAt = end <= asOf ? (cutoff && cutoff < end ? cutoff : end) : asOf;
    for (const schedule of schedules) {
      if (!scheduleCoversMonth(schedule, month)) continue;
      const basis = resolveBasisDate(
        schedule.basisDateSource,
        employee.joinDate,
        employee.contracts,
        basisAt,
      );
      if (!basis.date) continue;
      total += monthlyAccrual(schedule, basis.date, month, cutoff).amount;
    }
  }
  return round2(total);
}

/** Tổng định mức đã cộng + còn sẽ cộng đến hết tháng 12 (quỹ cả năm dự kiến). */
export function projectedYearEntitlement(
  schedules: readonly PolicySchedule[],
  employee: PolicyEmployee,
  year: number,
  asOf: string,
): number {
  return yearEntitlement(schedules, employee, year, asOf);
}

/** Phép được hưởng tính theo tỷ lệ ngày đến ngày nghỉ việc (kỳ cuối bị cắt theo ngày). */
export function entitledToDate(
  schedules: readonly PolicySchedule[],
  employee: PolicyEmployee,
  year: number,
  terminationDate: string,
): number {
  return yearEntitlement(schedules, employee, year, terminationDate, terminationDate);
}

/** Phần có thể ứng thêm trên phần đã tích luỹ: cả quỹ năm trừ phần đã cộng; 0 khi tắt ứng phép. */
export function advanceHeadroom(
  allowAdvance: boolean,
  projected: number,
  accruedSoFar: number,
): number {
  return allowAdvance ? Math.max(0, round2(projected - accruedSoFar)) : 0;
}
