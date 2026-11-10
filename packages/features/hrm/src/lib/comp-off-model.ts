/**
 * Logic thuần của màn Quỹ nghỉ bù, cấu hình làm thêm và các gợi ý trên form đơn. Không phụ thuộc React.
 */
import type {
  HrmCompOffAvailability,
  HrmCompOffConversionRow,
  HrmNextDayRest,
  HrmOvertimeCompConfig,
  HrmOvertimeCompVersionSummary,
} from '@enterprise-platform/contracts-hrm';

/** Số ngày/giờ kiểu Việt Nam: dấu phẩy thập phân, tối đa 2 chữ số, bỏ số 0 thừa. */
export function formatCompNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

export const formatCompDate = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';

/** Tháng `YYYY-MM` từ ngày hôm nay (theo giờ trình duyệt). */
export const currentMonthKey = (now: Date = new Date()): string => now.toLocaleDateString('en-CA').slice(0, 7);

/**
 * Ngày hiệu lực mặc định cho phiên bản chính sách mới: mùng 1 của tháng kế tiếp chưa có phiên bản nào bắt đầu đúng ngày đó
 * (máy chủ từ chối hai phiên bản cùng ngày hiệu lực).
 */
export function nextFreeEffectiveFrom(
  versions: readonly Pick<HrmOvertimeCompVersionSummary, 'effectiveFrom'>[],
  today: string,
): string {
  const taken = new Set(versions.map((v) => v.effectiveFrom));
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 120; i++) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const candidate = `${year}-${String(month).padStart(2, '0')}-01`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Lỗi khi tạo đơn nghỉ bù: không đủ số dư hoặc số ngày không là bội số của bước tối thiểu. Rỗng nghĩa là hợp lệ. */
export function compOffUsageProblem(
  days: number,
  availability: Pick<HrmCompOffAvailability, 'enabled' | 'available' | 'usageStepDays'> | null,
): string {
  if (!availability) return '';
  if (!availability.enabled) return 'Quy tắc làm thêm và nghỉ bù chưa được bật nên chưa thể tạo đơn nghỉ bù.';
  if (!(days > 0)) return '';
  const step = availability.usageStepDays > 0 ? availability.usageStepDays : 0.5;
  const steps = days / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9)
    return `Số ngày nghỉ bù phải là bội số của ${formatCompNumber(step)} ngày.`;
  if (days > availability.available + 1e-9)
    return `Số ngày nghỉ bù (${formatCompNumber(days)}) vượt số dư khả dụng (${formatCompNumber(availability.available)} ngày).`;
  return '';
}

export const NEXT_DAY_REST_OPTIONS: readonly { value: HrmNextDayRest; label: string }[] = [
  { value: 'NONE', label: 'Không nghỉ' },
  { value: 'HALF', label: 'Nghỉ nửa ngày' },
  { value: 'FULL', label: 'Nghỉ cả ngày' },
];

// ---------------------------------------------------------------- chuyển đổi tháng

export interface ConversionEdit {
  readonly days: string;
  readonly reason: string;
}

/** Số ngày đang hiển thị của một dòng chuyển đổi: số HR chỉnh, nếu không thì số đề xuất. */
export function conversionDays(row: Pick<HrmCompOffConversionRow, 'compDays'>, edit?: ConversionEdit): number {
  if (!edit || edit.days.trim() === '') return row.compDays;
  const n = Number(edit.days.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Dòng chưa chuyển đổi và có giờ dư thì chọn được. */
export const isConvertible = (row: Pick<HrmCompOffConversionRow, 'status'>): boolean => row.status === 'READY';

/** Lỗi của một dòng đã chọn: số ngày không hợp lệ, hoặc khác đề xuất mà thiếu lý do. */
export function conversionRowProblem(row: HrmCompOffConversionRow, edit?: ConversionEdit): string {
  const days = conversionDays(row, edit);
  if (!Number.isFinite(days) || days <= 0) return 'Số ngày phải lớn hơn 0';
  if (Math.abs(days * 10 - Math.round(days * 10)) > 1e-9) return 'Số ngày chỉ có tối đa 1 chữ số thập phân';
  if (Math.abs(days - row.compDays) > 1e-9 && !(edit?.reason ?? '').trim()) return 'Cần nhập lý do khi khác số đề xuất';
  return '';
}

/** Nội dung gửi API chuyển đổi từ các dòng đã chọn; chỉ gửi `days` và `reason` khi HR có chỉnh. */
export function conversionPayload(
  rows: readonly HrmCompOffConversionRow[],
  selected: ReadonlySet<string>,
  edits: Readonly<Record<string, ConversionEdit>>,
): { employeeId: string; days?: number; reason?: string }[] {
  return rows
    .filter((r) => selected.has(r.employeeId) && isConvertible(r))
    .map((r) => {
      const edit = edits[r.employeeId];
      const days = conversionDays(r, edit);
      if (edit && Math.abs(days - r.compDays) > 1e-9) return { employeeId: r.employeeId, days, reason: edit.reason.trim() };
      return { employeeId: r.employeeId };
    });
}

// ---------------------------------------------------------------- biểu mẫu cấu hình

/** Giá trị biểu mẫu cấu hình (chuỗi, để nhập dở dang được). */
export interface OvertimeCompForm {
  enabled: boolean;
  ruleSet: HrmOvertimeCompConfig['ruleSet'];
  normalHoursPerDay: string;
  monthlyCapHours: string;
  yearlyCapHours: string;
  nightCapped: boolean;
  nightStart: string;
  nightEnd: string;
  nightRestHoursPerDay: string;
  allowHalfDay: boolean;
  compFactor: string;
  dayBasisHours: string;
  decimals: string;
  rounding: HrmOvertimeCompConfig['rounding'];
  usageStepDays: string;
  accrualMonthOffset: '0' | '1';
  expiryMonths: string;
  accumulationCapDays: string;
}

const str = (n: number | null): string => (n === null ? '' : String(n));
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function configToForm(c: HrmOvertimeCompConfig): OvertimeCompForm {
  return {
    enabled: c.enabled,
    ruleSet: c.ruleSet,
    normalHoursPerDay: str(c.normalHoursPerDay),
    monthlyCapHours: str(c.monthlyCapHours),
    yearlyCapHours: str(c.yearlyCapHours),
    nightCapped: c.nightCapped,
    nightStart: hhmm(c.nightStartMinute),
    nightEnd: hhmm(c.nightEndMinute),
    nightRestHoursPerDay: str(c.nightRestHoursPerDay),
    allowHalfDay: c.allowHalfDay,
    compFactor: str(c.compFactor),
    dayBasisHours: str(c.dayBasisHours),
    decimals: str(c.decimals),
    rounding: c.rounding,
    usageStepDays: str(c.usageStepDays),
    accrualMonthOffset: c.accrualMonthOffset === 0 ? '0' : '1',
    expiryMonths: str(c.expiryMonths),
    accumulationCapDays: str(c.accumulationCapDays),
  };
}

const minuteOf = (value: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

const num = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value.replace(',', '.')));
const numOrNull = (value: string): number | null => (value.trim() === '' ? null : num(value));

/**
 * Cấu hình gửi máy chủ từ biểu mẫu. Chỉ gửi các tham số của chế độ đang chọn; tham số của chế độ kia giữ nguyên ở máy chủ.
 * Giá trị không đọc được là NaN để máy chủ trả lỗi rõ ràng thay vì bị bỏ qua âm thầm.
 */
export function formToConfig(f: OvertimeCompForm): Partial<HrmOvertimeCompConfig> {
  const config: Record<string, unknown> = {
    enabled: f.enabled,
    ruleSet: f.ruleSet,
    normalHoursPerDay: num(f.normalHoursPerDay),
    monthlyCapHours: num(f.monthlyCapHours),
    yearlyCapHours: numOrNull(f.yearlyCapHours),
    nightCapped: f.nightCapped,
    compFactor: num(f.compFactor),
    dayBasisHours: numOrNull(f.dayBasisHours),
    decimals: num(f.decimals),
    rounding: f.rounding,
    usageStepDays: num(f.usageStepDays),
    accrualMonthOffset: f.accrualMonthOffset === '0' ? 0 : 1,
    expiryMonths: num(f.expiryMonths),
    accumulationCapDays: numOrNull(f.accumulationCapDays),
  };
  if (f.ruleSet === 'CLOCK_WINDOW') {
    config.nightStartMinute = minuteOf(f.nightStart);
    config.nightEndMinute = minuteOf(f.nightEnd);
  } else {
    config.nightRestHoursPerDay = num(f.nightRestHoursPerDay);
    config.allowHalfDay = f.allowHalfDay;
  }
  return config as Partial<HrmOvertimeCompConfig>;
}

/** Lỗi nhập liệu có thể bắt ngay ở trình duyệt; kiểm tra chi tiết vẫn do máy chủ làm. */
export function overtimeCompFormProblem(f: OvertimeCompForm, effectiveFrom: string, reason: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(effectiveFrom)) return 'Ngày hiệu lực phải là mùng 1 của một tháng';
  if (!reason.trim()) return 'Cần nhập lý do thay đổi';
  const config = formToConfig(f) as Record<string, unknown>;
  for (const key of ['normalHoursPerDay', 'monthlyCapHours', 'compFactor', 'decimals', 'usageStepDays', 'expiryMonths'])
    if (!Number.isFinite(config[key] as number)) return 'Có tham số bắt buộc chưa nhập hoặc không phải số';
  if (f.ruleSet === 'CLOCK_WINDOW') {
    if (!Number.isFinite(config.nightStartMinute as number) || !Number.isFinite(config.nightEndMinute as number))
      return 'Khung giờ đêm cần nhập dạng HH:mm';
  } else if (!Number.isFinite(config.nightRestHoursPerDay as number)) return 'Số giờ ca đêm bù mỗi ngày nghỉ chưa hợp lệ';
  return '';
}

export const RULE_SET_OPTIONS = [
  { value: 'NIGHT_REST', label: 'Theo ngày nghỉ sau ca đêm (NIGHT_REST)' },
  { value: 'CLOCK_WINDOW', label: 'Theo khung giờ đêm (CLOCK_WINDOW)' },
];

export const ROUNDING_OPTIONS = [
  { value: 'HALF_UP', label: 'Làm tròn gần nhất' },
  { value: 'DOWN', label: 'Làm tròn xuống' },
  { value: 'UP', label: 'Làm tròn lên' },
];

export const ACCRUAL_OFFSET_OPTIONS = [
  { value: '1', label: 'Tháng kế tiếp' },
  { value: '0', label: 'Cùng tháng' },
];

export const BLOCK_SOURCE_LABEL: Record<string, string> = {
  RULE: 'Theo quy tắc',
  MANUAL: 'HR sửa tay',
  IMPORT_1OFFICE: 'Nhập từ 1Office',
};

export const CONVERSION_STATUS_LABEL: Record<string, string> = {
  READY: 'Chờ chuyển đổi',
  CONVERTED: 'Đã chuyển đổi',
  NOTHING: 'Không có giờ dư',
  CAP_REACHED: 'Đạt trần tích lũy',
};

export const LEDGER_KIND_LABEL: Record<string, string> = {
  ACCRUAL: 'Cộng quỹ',
  RESERVE: 'Giữ chỗ',
  USAGE: 'Đã dùng',
  RELEASE: 'Hoàn giữ chỗ',
  ADJUST: 'Điều chỉnh',
  EXPIRE: 'Hết hạn',
};

/** "dd/MM HH:mm" từ mốc địa phương `YYYY-MM-DDTHH:mm`. */
export const shortLocal = (local: string): string => `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
