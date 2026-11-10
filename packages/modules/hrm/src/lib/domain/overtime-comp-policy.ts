/**
 * Cấu hình làm thêm và nghỉ bù của một tenant, lưu trong `config_json.overtimeComp` của phiên bản chính sách OT
 * (`hrm_schema.policy_versions`, policy_type = 'OT'), cùng chỗ với khung giờ đêm sẵn có (`nightStartMinute`,
 * `nightEndMinute`). Không có bảng cấu hình thứ hai. Hàm thuần: đọc có mặc định, kiểm tra chặt dữ liệu người dùng gửi.
 */
import type { ClockWindowConfig, NightRestConfig, OvertimeRuleSet } from './overtime-classification.js';
import { OVERTIME_RULE_SETS } from './overtime-classification.js';
import type { MonthlyCapConfig, RoundingMethod } from './overtime-monthly-cap.js';

export interface OvertimeCompPolicy {
  /** Ô tích "Áp dụng quy tắc trần làm thêm và nghỉ bù". Tắt: không cắt trần, không quy đổi. */
  readonly enabled: boolean;
  readonly ruleSet: OvertimeRuleSet;
  readonly normalHoursPerDay: number;
  readonly monthlyCapHours: number;
  readonly yearlyCapHours: number | null;
  readonly nightCapped: boolean;
  readonly nightStartMinute: number;
  readonly nightEndMinute: number;
  readonly nightRestHoursPerDay: number;
  readonly allowHalfDay: boolean;
  readonly compFactor: number;
  /** Số giờ quy đổi một ngày nghỉ; null là bằng giờ chuẩn một ngày. */
  readonly dayBasisHours: number | null;
  readonly decimals: number;
  readonly rounding: RoundingMethod;
  readonly usageStepDays: number;
  /** 0: cộng quỹ vào chính tháng phát sinh; 1: vào tháng kế tiếp. */
  readonly accrualMonthOffset: 0 | 1;
  /** Hạn dùng theo số tháng từ tháng cộng quỹ; 0 là không hạn. */
  readonly expiryMonths: number;
  /** Trần số ngày nghỉ bù tích lũy; null là không giới hạn. */
  readonly accumulationCapDays: number | null;
}

export const DEFAULT_OVERTIME_COMP_POLICY: OvertimeCompPolicy = {
  enabled: false,
  ruleSet: 'CLOCK_WINDOW',
  normalHoursPerDay: 8,
  monthlyCapHours: 40,
  yearlyCapHours: 200,
  nightCapped: false,
  nightStartMinute: 1320,
  nightEndMinute: 360,
  nightRestHoursPerDay: 8,
  allowHalfDay: true,
  compFactor: 1.5,
  dayBasisHours: null,
  decimals: 1,
  rounding: 'HALF_UP',
  usageStepDays: 0.5,
  accrualMonthOffset: 1,
  expiryMonths: 0,
  accumulationCapDays: null,
};

const ROUNDINGS: readonly RoundingMethod[] = ['HALF_UP', 'DOWN', 'UP'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  if (v === undefined) return fallback;
  const n = num(v, Number.NaN);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Đọc cấu hình từ `config_json` của chính sách OT; thiếu hay sai kiểu thì dùng mặc định.
 * Khung giờ đêm lấy từ khóa phẳng sẵn có `nightStartMinute`/`nightEndMinute` nếu nhóm `overtimeComp` không đặt riêng.
 */
export function parseOvertimeCompPolicy(config: Record<string, unknown> | null | undefined): OvertimeCompPolicy {
  const d = DEFAULT_OVERTIME_COMP_POLICY;
  const raw = isObject(config?.overtimeComp) ? config.overtimeComp : {};
  const ruleSet = OVERTIME_RULE_SETS.find((r) => r === raw.ruleSet) ?? d.ruleSet;
  const rounding = ROUNDINGS.find((r) => r === raw.rounding) ?? d.rounding;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    ruleSet,
    normalHoursPerDay: num(raw.normalHoursPerDay, d.normalHoursPerDay),
    monthlyCapHours: num(raw.monthlyCapHours, d.monthlyCapHours),
    yearlyCapHours: numOrNull(raw.yearlyCapHours, d.yearlyCapHours),
    nightCapped: typeof raw.nightCapped === 'boolean' ? raw.nightCapped : d.nightCapped,
    nightStartMinute: num(raw.nightStartMinute ?? config?.nightStartMinute, d.nightStartMinute),
    nightEndMinute: num(raw.nightEndMinute ?? config?.nightEndMinute, d.nightEndMinute),
    nightRestHoursPerDay: num(raw.nightRestHoursPerDay, d.nightRestHoursPerDay),
    allowHalfDay: typeof raw.allowHalfDay === 'boolean' ? raw.allowHalfDay : d.allowHalfDay,
    compFactor: num(raw.compFactor, d.compFactor),
    dayBasisHours: numOrNull(raw.dayBasisHours, d.dayBasisHours),
    decimals: num(raw.decimals, d.decimals),
    rounding,
    usageStepDays: num(raw.usageStepDays, d.usageStepDays),
    accrualMonthOffset: raw.accrualMonthOffset === 0 ? 0 : 1,
    expiryMonths: num(raw.expiryMonths, d.expiryMonths),
    accumulationCapDays: numOrNull(raw.accumulationCapDays, d.accumulationCapDays),
  };
}

/** Cấu hình cho `classifyBlock`. */
export function classificationConfigOf(policy: OvertimeCompPolicy): {
  nightRest: NightRestConfig;
  clockWindow: ClockWindowConfig;
} {
  return {
    nightRest: { nightRestHoursPerDay: policy.nightRestHoursPerDay, allowHalfDay: policy.allowHalfDay },
    clockWindow: { nightStartMinute: policy.nightStartMinute, nightEndMinute: policy.nightEndMinute },
  };
}

/** Cấu hình cho `summarizeOvertimeMonth`. */
export function monthlyCapConfigOf(policy: OvertimeCompPolicy): MonthlyCapConfig {
  return {
    capApplies: policy.enabled,
    monthlyCapHours: policy.monthlyCapHours,
    yearlyCapHours: policy.yearlyCapHours,
    nightCapped: policy.nightCapped,
    compFactor: policy.compFactor,
    dayBasisHours: policy.dayBasisHours ?? policy.normalHoursPerDay,
    decimals: policy.decimals,
    rounding: policy.rounding,
  };
}

/** Kiểm tra nhóm `overtimeComp` do người dùng gửi; trả thông báo lỗi tiếng Việt hoặc null nếu hợp lệ. */
export function validateOvertimeCompPolicy(input: unknown): string | null {
  if (!isObject(input)) return 'Cấu hình làm thêm và nghỉ bù không hợp lệ';
  const has = (k: string) => input[k] !== undefined;
  const check = (k: string, ok: (n: number) => boolean, message: string): string | null => {
    if (!has(k) || input[k] === null) return null;
    const n = typeof input[k] === 'number' ? (input[k] as number) : Number.NaN;
    return Number.isFinite(n) && ok(n) ? null : message;
  };
  if (has('enabled') && typeof input.enabled !== 'boolean') return 'Ô áp dụng quy tắc phải là đúng hoặc sai';
  if (has('ruleSet') && !OVERTIME_RULE_SETS.includes(input.ruleSet as OvertimeRuleSet))
    return 'Chế độ phân loại phải là NIGHT_REST hoặc CLOCK_WINDOW';
  if (has('rounding') && !ROUNDINGS.includes(input.rounding as RoundingMethod))
    return 'Phương pháp làm tròn phải là HALF_UP, DOWN hoặc UP';
  for (const k of ['allowHalfDay', 'nightCapped'])
    if (has(k) && typeof input[k] !== 'boolean') return `Giá trị ${k} phải là đúng hoặc sai`;
  const errors = [
    check('normalHoursPerDay', (n) => n > 0 && n <= 24, 'Số giờ chuẩn một ngày phải lớn hơn 0 và không quá 24'),
    check('monthlyCapHours', (n) => n > 0 && n <= 744, 'Trần làm thêm theo tháng phải lớn hơn 0 và không quá 744 giờ'),
    check('yearlyCapHours', (n) => n > 0 && n <= 8784, 'Trần làm thêm theo năm phải lớn hơn 0'),
    check('nightStartMinute', (n) => Number.isInteger(n) && n >= 720 && n <= 1439, 'Giờ bắt đầu khung đêm phải sau 12:00'),
    check('nightEndMinute', (n) => Number.isInteger(n) && n >= 0 && n <= 719, 'Giờ kết thúc khung đêm phải trước 12:00'),
    check('nightRestHoursPerDay', (n) => n > 0 && n <= 24, 'Số giờ ca đêm bù mỗi ngày nghỉ phải lớn hơn 0 và không quá 24'),
    check('compFactor', (n) => n > 0 && n <= 10, 'Hệ số quy đổi nghỉ bù phải lớn hơn 0 và không quá 10'),
    check('dayBasisHours', (n) => n > 0 && n <= 24, 'Số giờ quy đổi một ngày nghỉ phải lớn hơn 0 và không quá 24'),
    check('decimals', (n) => Number.isInteger(n) && n >= 0 && n <= 3, 'Số chữ số thập phân phải từ 0 đến 3'),
    check('usageStepDays', (n) => n > 0 && n <= 1 && Math.round((1 / n) * 1e6) % 1e6 === 0, 'Bước dùng nghỉ bù phải là ước của 1 ngày (ví dụ 0,5)'),
    check('accrualMonthOffset', (n) => n === 0 || n === 1, 'Tháng cộng quỹ phải là cùng tháng (0) hoặc tháng kế tiếp (1)'),
    check('expiryMonths', (n) => Number.isInteger(n) && n >= 0 && n <= 120, 'Hạn dùng phải từ 0 đến 120 tháng'),
    check('accumulationCapDays', (n) => n > 0 && n <= 1000, 'Trần tích lũy nghỉ bù phải lớn hơn 0'),
  ];
  const first = errors.find((e): e is string => e !== null);
  if (first) return first;
  const start = input.nightStartMinute;
  const end = input.nightEndMinute;
  if (typeof start === 'number' && typeof end === 'number' && !(start > end))
    return 'Khung giờ đêm phải bắt đầu sau 12:00 và kết thúc trước 12:00';
  return null;
}

/**
 * Cảnh báo khi cấu hình vượt giới hạn theo luật mà hệ thống đang biết. Chỉ cảnh báo, không chặn: căn cứ pháp lý
 * (Bộ luật Lao động 2019 điều 107, Nghị định 145/2020) cần được pháp chế xác nhận cho từng trường hợp.
 */
export function overtimeCompLegalWarnings(policy: OvertimeCompPolicy): string[] {
  const warnings: string[] = [];
  if (policy.monthlyCapHours > 40)
    warnings.push('Trần làm thêm theo tháng lớn hơn 40 giờ, vượt mức theo luật; cần căn cứ pháp lý');
  if (policy.yearlyCapHours !== null && policy.yearlyCapHours > 300)
    warnings.push('Trần làm thêm theo năm lớn hơn 300 giờ, vượt mức cao nhất theo luật');
  else if (policy.yearlyCapHours !== null && policy.yearlyCapHours > 200)
    warnings.push('Trần làm thêm theo năm lớn hơn 200 giờ chỉ áp dụng cho một số ngành, cần căn cứ pháp lý');
  if (policy.yearlyCapHours === null) warnings.push('Chưa đặt trần làm thêm theo năm');
  if (!policy.enabled) warnings.push('Quy tắc trần làm thêm đang tắt: giờ làm thêm không bị cắt trần');
  return warnings;
}
