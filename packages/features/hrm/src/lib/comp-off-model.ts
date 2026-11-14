/**
 * Logic thuần của màn Quỹ nghỉ bù, cấu hình làm thêm và các gợi ý trên form đơn. Không phụ thuộc React.
 */
import type {
  HrmCompOffAvailability,
  HrmCompOffConversionRow,
  HrmNextDayRest,
  HrmOvertimeCompConfig,
  HrmOvertimeCompVersionSummary,
  HrmTripDayLine,
  HrmTripDayLineStatus,
  HrmTripDayWindow,
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
 * Ngày hiệu lực mặc định cho phiên bản chính sách mới: mùng 1 của tháng hiện tại (máy chủ chỉ nhận mùng 1 của tháng chưa
 * chốt công, nên không dùng được ngày giữa tháng). Nếu tháng đó đã có phiên bản bắt đầu đúng ngày đó (máy chủ từ chối hai
 * phiên bản cùng ngày hiệu lực) thì lấy mùng 1 của tháng kế tiếp còn trống.
 */
export function nextFreeEffectiveFrom(
  versions: readonly Pick<HrmOvertimeCompVersionSummary, 'effectiveFrom'>[],
  today: string,
): string {
  const taken = new Set(versions.map((v) => v.effectiveFrom));
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 120; i++) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-01`;
    if (!taken.has(candidate)) return candidate;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export type CompVersionPhase = 'UPCOMING' | 'CURRENT' | 'EXPIRED';

export const COMP_VERSION_PHASE_LABELS: Record<CompVersionPhase, string> = {
  UPCOMING: 'Sắp có hiệu lực',
  CURRENT: 'Đang áp dụng',
  EXPIRED: 'Đã hết hiệu lực',
};

/** Giai đoạn của phiên bản theo ngày hôm nay (cùng cách tính với máy chủ). */
export function compVersionPhase(v: Pick<HrmOvertimeCompVersionSummary, 'effectiveFrom' | 'effectiveTo'>, today: string): CompVersionPhase {
  if (v.effectiveFrom > today) return 'UPCOMING';
  if (v.effectiveTo && v.effectiveTo < today) return 'EXPIRED';
  return 'CURRENT';
}

/** Chỉ xóa được phiên bản mới nhất mà chưa có hiệu lực; máy chủ còn kiểm tra dữ liệu đã tham chiếu. */
export function removableCompVersionId(
  versions: readonly Pick<HrmOvertimeCompVersionSummary, 'id' | 'effectiveFrom' | 'effectiveTo'>[],
  today: string,
): string | null {
  const newest = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return newest && compVersionPhase(newest, today) === 'UPCOMING' ? newest.id : null;
}

export interface VersionOverlapEffect {
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  /** TRUNCATE: cắt đuôi về ngày liền trước ngày mới; REPLACE: bị thay thế hoàn toàn. */
  readonly effect: 'TRUNCATE' | 'REPLACE';
  /** Ngày kết thúc mới khi bị cắt đuôi. */
  readonly newEffectiveTo: string | null;
}

function dayBeforeIso(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Các phiên bản đang giao với khoảng hiệu lực mới (kéo dài mãi từ `effectiveFrom`) và việc ghi đè sẽ làm gì với chúng.
 * Rỗng nghĩa là không giao với phiên bản nào ngoài việc kết thúc phiên bản đang chạy.
 */
export function overlapEffects(
  versions: readonly Pick<HrmOvertimeCompVersionSummary, 'versionNo' | 'effectiveFrom' | 'effectiveTo'>[],
  effectiveFrom: string,
): VersionOverlapEffect[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return [];
  const out: VersionOverlapEffect[] = [];
  for (const v of versions) {
    if (v.effectiveTo && v.effectiveTo < effectiveFrom) continue;
    if (v.effectiveFrom >= effectiveFrom)
      out.push({ ...v, effect: 'REPLACE', newEffectiveTo: null });
    else out.push({ ...v, effect: 'TRUNCATE', newEffectiveTo: dayBeforeIso(effectiveFrom) });
  }
  return out.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Lỗi khi tạo đơn nghỉ bù: không đủ số dư hoặc số ngày không là bội số của bước tối thiểu. Rỗng nghĩa là hợp lệ. */
export function compOffUsageProblem(
  days: number,
  availability: Pick<HrmCompOffAvailability, 'enabled' | 'available' | 'usageStepDays'> | null,
): string {
  if (!availability) return '';
  // Quy tắc tắt: quỹ do doanh nghiệp tự quản lý ngoài hệ thống nên không chặn; người duyệt quyết định.
  if (!availability.enabled) return '';
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
  fundEnabled: boolean;
  ruleSet: HrmOvertimeCompConfig['ruleSet'];
  normalHoursPerDay: string;
  monthlyCapHours: string;
  yearlyCapHours: string;
  nightCapped: boolean;
  nightStart: string;
  nightEnd: string;
  nightRestHoursPerDay: string;
  allowHalfDay: boolean;
  declaredNightWindow: boolean;
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
    fundEnabled: c.fundEnabled ?? c.enabled,
    ruleSet: c.ruleSet,
    normalHoursPerDay: str(c.normalHoursPerDay),
    monthlyCapHours: str(c.monthlyCapHours),
    yearlyCapHours: str(c.yearlyCapHours),
    nightCapped: c.nightCapped,
    nightStart: hhmm(c.nightStartMinute),
    nightEnd: hhmm(c.nightEndMinute),
    nightRestHoursPerDay: str(c.nightRestHoursPerDay),
    allowHalfDay: c.allowHalfDay,
    declaredNightWindow: c.declaredNightWindow ?? false,
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
    fundEnabled: f.enabled ? true : f.fundEnabled,
    ruleSet: f.ruleSet,
    normalHoursPerDay: num(f.normalHoursPerDay),
    monthlyCapHours: num(f.monthlyCapHours),
    yearlyCapHours: numOrNull(f.yearlyCapHours),
    nightCapped: f.nightCapped,
    declaredNightWindow: f.declaredNightWindow,
    compFactor: num(f.compFactor),
    dayBasisHours: numOrNull(f.dayBasisHours),
    decimals: num(f.decimals),
    rounding: f.rounding,
    usageStepDays: num(f.usageStepDays),
    accrualMonthOffset: f.accrualMonthOffset === '0' ? 0 : 1,
    expiryMonths: num(f.expiryMonths),
    accumulationCapDays: numOrNull(f.accumulationCapDays),
  };
  if (f.ruleSet === 'CLOCK_WINDOW' || f.declaredNightWindow) {
    config.nightStartMinute = minuteOf(f.nightStart);
    config.nightEndMinute = minuteOf(f.nightEnd);
  }
  if (f.ruleSet !== 'CLOCK_WINDOW') {
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
  if (f.ruleSet === 'CLOCK_WINDOW' || f.declaredNightWindow) {
    if (!Number.isFinite(config.nightStartMinute as number) || !Number.isFinite(config.nightEndMinute as number))
      return 'Khung giờ đêm cần nhập dạng HH:mm';
  }
  if (f.ruleSet !== 'CLOCK_WINDOW' && !Number.isFinite(config.nightRestHoursPerDay as number))
    return 'Số giờ ca đêm bù mỗi ngày nghỉ chưa hợp lệ';
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

export interface CompOffFundSummary {
  readonly enabled: boolean;
  readonly classify: string;
  readonly cap: string;
  readonly conversion: string;
  readonly accrual: string;
  readonly expiry: string;
  readonly accumulation: string;
  readonly usage: string;
  /** Ví dụ tính từ chính sách: một tháng làm thêm vượt trần một số giờ. */
  readonly example: string;
}

/**
 * Tóm tắt cách tính quỹ nghỉ bù từ cấu hình đang áp dụng, cho thẻ "Quỹ nghỉ bù" ở Chính sách phép.
 * Công thức giống máy chủ: phần vượt trần tháng quy ra ngày = giờ dư / số giờ một ngày x hệ số, làm tròn theo cấu hình.
 */
export function buildCompOffFundSummary(config: HrmOvertimeCompConfig): CompOffFundSummary {
  const basis = config.dayBasisHours ?? config.normalHoursPerDay;
  const yearly = config.yearlyCapHours != null ? `, tối đa ${formatCompNumber(config.yearlyCapHours)} giờ/năm` : '';
  const extra = 10;
  const scale = 10 ** config.decimals;
  const days = Math.round((extra / basis) * config.compFactor * scale) / scale;
  return {
    enabled: config.enabled,
    classify: config.ruleSet === 'NIGHT_REST' ? 'Theo ngày nghỉ sau ca đêm' : 'Theo khung giờ đêm',
    cap: `${formatCompNumber(config.monthlyCapHours)} giờ/tháng trả lương làm thêm${yearly}`,
    conversion: `Giờ dư × hệ số ${formatCompNumber(config.compFactor)} ÷ ${formatCompNumber(basis)} giờ/ngày`,
    accrual: config.accrualMonthOffset === 1 ? 'Cộng vào tháng kế tiếp' : 'Cộng cùng tháng',
    expiry: config.expiryMonths > 0 ? `${config.expiryMonths} tháng kể từ tháng cộng quỹ` : 'Không hết hạn',
    accumulation: config.accumulationCapDays != null ? `Tối đa ${formatCompNumber(config.accumulationCapDays)} ngày` : 'Không giới hạn',
    usage: `Dùng theo bước ${formatCompNumber(config.usageStepDays)} ngày${config.allowHalfDay ? ', cho nghỉ nửa ngày' : ''}`,
    example: `Nếu một tháng làm thêm vượt trần ${formatCompNumber(extra)} giờ thì được ${formatCompNumber(days)} ngày nghỉ bù (${formatCompNumber(extra)} ÷ ${formatCompNumber(basis)} × ${formatCompNumber(config.compFactor)}).`,
  };
}

// ---------------------------------------------------------------- giờ làm theo ngày của đơn công tác

export const TRIP_DAY_STATUS_LABELS: Record<HrmTripDayLineStatus, string> = {
  PLANNED: 'Dự kiến',
  ACTUAL_PENDING: 'Chờ xác nhận',
  ACTUAL_APPROVED: 'Đã xác nhận',
  ACTUAL_REJECTED: 'Bị từ chối',
};

/** Số phút thành chữ: 90 là "1 giờ 30", 480 là "8 giờ", 0 là "0". */
export function formatTripMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} giờ${m > 0 ? ` ${m}` : ''}` : `${m} phút`;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** "Thứ 2, 12/10" của một ngày YYYY-MM-DD. */
export function tripDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export interface TripDayDraft {
  readonly date: string;
  readonly windows: readonly HrmTripDayWindow[];
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lỗi nhập liệu của một khung giờ có thể bắt ngay ở trình duyệt; máy chủ vẫn kiểm tra lại. Rỗng là hợp lệ. */
export function tripWindowProblem(windows: readonly HrmTripDayWindow[]): string {
  for (const w of windows) if (!CLOCK.test(w.from) || !CLOCK.test(w.to)) return 'Khung giờ cần nhập đủ giờ bắt đầu và kết thúc';
  const spans = windows
    .map((w) => {
      const start = Number(w.from.slice(0, 2)) * 60 + Number(w.from.slice(3));
      const to = Number(w.to.slice(0, 2)) * 60 + Number(w.to.slice(3));
      return { start, end: to > start ? to : to + 1440 };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) if (spans[i].start < spans[i - 1].end) return 'Các khung giờ trong một ngày không được chồng nhau';
  return '';
}

/** Các ngày người dùng đã sửa so với dữ liệu đang lưu, dạng gửi máy chủ (ngày để trống là bỏ khai). */
export function tripDayChanges(
  lines: readonly HrmTripDayLine[],
  drafts: Readonly<Record<string, readonly HrmTripDayWindow[]>>,
  mode: 'PLANNED' | 'ACTUAL',
): TripDayDraft[] {
  const same = (a: readonly HrmTripDayWindow[], b: readonly HrmTripDayWindow[]) =>
    a.length === b.length && a.every((w, i) => w.from === b[i].from && w.to === b[i].to);
  return lines
    .filter((l) => drafts[l.date] !== undefined)
    .filter((l) => !same(drafts[l.date], mode === 'ACTUAL' ? l.actualWindows : l.plannedWindows))
    .map((l) => ({ date: l.date, windows: drafts[l.date] }));
}
