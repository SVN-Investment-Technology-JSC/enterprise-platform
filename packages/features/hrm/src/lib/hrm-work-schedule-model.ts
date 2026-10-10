/**
 * Logic thuần cho màn "Phân ca làm việc": xử lý ngày/tuần, dựng lịch tuần 7 dòng,
 * phân loại lỗi 409 của API phân ca, dựng CSV xuất lịch. Không phụ thuộc React.
 */
import type {
  HrmApplyScheduleRequest,
  HrmApplyScheduleResult,
  HrmHoliday,
  HrmScheduleConflict,
  HrmScheduleConflictMode,
  HrmScheduleDay,
  HrmScheduleRule,
  HrmScheduleRuleApplyResult,
  HrmScheduleRulePreview,
  HrmScheduleRulePreviewItem,
  HrmSchedulePreview,
  HrmScheduleScope,
  HrmShiftDefinition,
  HrmWeekdayRule,
  HrmWorkDaySource,
  HrmWorkDayType,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError } from './hrm-api';

// ---------------------------------------------------------------------------
// Ngày và tuần (chuỗi YYYY-MM-DD, tính theo UTC để không lệch múi giờ)
// ---------------------------------------------------------------------------

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
  7: 'CN',
};
export const WEEKDAY_FULL_LABELS: Record<number, string> = {
  1: 'Thứ hai',
  2: 'Thứ ba',
  3: 'Thứ tư',
  4: 'Thứ năm',
  5: 'Thứ sáu',
  6: 'Thứ bảy',
  7: 'Chủ nhật',
};
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

function parseIso(iso: string): Date {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`Ngày không hợp lệ: ${iso}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** 1 = Thứ hai ... 7 = Chủ nhật (ISO). */
export function isoWeekday(iso: string): number {
  const day = parseIso(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function endOfMonth(iso: string): string {
  const d = parseIso(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toIso(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseIso(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d);
}

export function startOfWeek(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export type ScheduleGridView = 'month' | 'week';

export function rangeFor(
  view: ScheduleGridView,
  anchor: string,
): { from: string; to: string } {
  if (view === 'month') return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  const from = startOfWeek(anchor);
  return { from, to: addDays(from, 6) };
}

/** Điều hướng kỳ xem: trả về ngày neo mới sau khi lùi/tiến một tháng hoặc một tuần. */
export function shiftAnchor(
  view: ScheduleGridView,
  anchor: string,
  direction: -1 | 1,
): string {
  return view === 'month'
    ? addMonths(anchor, direction)
    : addDays(startOfWeek(anchor), direction * 7);
}

export function listDates(from: string, to: string, limit = 400): string[] {
  const out: string[] = [];
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return out;
  let cursor = from;
  while (cursor <= to && out.length < limit) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function daysInclusive(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return 0;
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86400000) + 1;
}

/** dd/MM/yyyy */
export function formatVnDate(iso: string | null | undefined): string {
  if (!iso || !ISO_DATE.test(iso)) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** dd/MM */
export function formatVnShortDate(iso: string): string {
  return ISO_DATE.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
}

export function formatRangeLabel(view: ScheduleGridView, anchor: string): string {
  const { from, to } = rangeFor(view, anchor);
  return view === 'month'
    ? `Tháng ${anchor.slice(5, 7)}/${anchor.slice(0, 4)}`
    : `${formatVnDate(from)} - ${formatVnDate(to)}`;
}

// ---------------------------------------------------------------------------
// Lịch tuần 7 dòng (T2..CN)
// ---------------------------------------------------------------------------

export type PatternDayType = 'SHIFT' | 'OFF' | 'SKIP';
export interface PatternRow {
  weekday: number;
  dayType: PatternDayType;
  shiftId: string | null;
}

/** 7 dòng, mặc định SKIP (không đụng tới ngày đó). */
export function emptyPattern(): PatternRow[] {
  return WEEKDAYS.map((weekday) => ({ weekday, dayType: 'SKIP', shiftId: null }));
}

/** Chuẩn hoá danh sách luật (từ mẫu lịch trên API) thành đủ 7 dòng. */
export function patternFromRules(
  rules: readonly HrmWeekdayRule[] | undefined,
): PatternRow[] {
  const base = emptyPattern();
  for (const rule of rules ?? []) {
    const row = base.find((r) => r.weekday === rule.weekday);
    if (row) {
      row.dayType = rule.dayType;
      row.shiftId = rule.dayType === 'SHIFT' ? (rule.shiftId ?? null) : null;
    }
  }
  return base;
}

export function setPatternDay(
  pattern: readonly PatternRow[],
  weekday: number,
  value: { dayType: PatternDayType; shiftId?: string | null },
): PatternRow[] {
  return pattern.map((row) =>
    row.weekday === weekday
      ? {
          weekday,
          dayType: value.dayType,
          shiftId: value.dayType === 'SHIFT' ? (value.shiftId ?? null) : null,
        }
      : row,
  );
}

/** Lối tắt: đặt cùng một ca (hoặc nghỉ) cho nhiều thứ, ví dụ T2-T6. Không gắn cứng mã ca nào. */
export function applyShortcut(
  pattern: readonly PatternRow[],
  weekdays: readonly number[],
  choice: { kind: 'OFF' } | { kind: 'SHIFT'; shiftId: string } | { kind: 'SKIP' },
): PatternRow[] {
  return pattern.map((row) => {
    if (!weekdays.includes(row.weekday)) return row;
    if (choice.kind === 'SHIFT')
      return { weekday: row.weekday, dayType: 'SHIFT', shiftId: choice.shiftId };
    return { weekday: row.weekday, dayType: choice.kind, shiftId: null };
  });
}

/** Lối tắt cho Thứ bảy: nghỉ, cả ngày hoặc nửa ngày (cả hai đều là ca chọn từ danh mục). */
export function applySaturdayShortcut(
  pattern: readonly PatternRow[],
  choice: { kind: 'OFF' } | { kind: 'FULL' | 'HALF'; shiftId: string },
): PatternRow[] {
  return choice.kind === 'OFF'
    ? applyShortcut(pattern, [6], { kind: 'OFF' })
    : applyShortcut(pattern, [6], { kind: 'SHIFT', shiftId: choice.shiftId });
}

/** Lối tắt cho Chủ nhật: nghỉ hoặc làm việc với ca được chọn. */
export function applySundayShortcut(
  pattern: readonly PatternRow[],
  choice: { kind: 'OFF' } | { kind: 'WORK'; shiftId: string },
): PatternRow[] {
  return choice.kind === 'OFF'
    ? applyShortcut(pattern, [7], { kind: 'OFF' })
    : applyShortcut(pattern, [7], { kind: 'SHIFT', shiftId: choice.shiftId });
}

/** Ngoại lệ: 7 luật giống hệt nhau (một ca hoặc nghỉ cho mọi thứ trong khoảng ngày). */
export function buildExceptionPattern(
  choice: { dayType: 'OFF' } | { dayType: 'SHIFT'; shiftId: string },
): HrmWeekdayRule[] {
  return WEEKDAYS.map((weekday) =>
    choice.dayType === 'OFF'
      ? { weekday, dayType: 'OFF' as const, shiftId: null }
      : { weekday, dayType: 'SHIFT' as const, shiftId: choice.shiftId },
  );
}

export function patternToRules(pattern: readonly PatternRow[]): HrmWeekdayRule[] {
  return pattern.map((row) => ({
    weekday: row.weekday,
    dayType: row.dayType,
    shiftId: row.dayType === 'SHIFT' ? row.shiftId : null,
  }));
}

/** Trả về thông báo lỗi tiếng Việt nếu lịch tuần chưa hợp lệ, ngược lại null. */
export function validatePattern(pattern: readonly PatternRow[]): string | null {
  if (pattern.every((row) => row.dayType === 'SKIP'))
    return 'Cần cấu hình ít nhất một ngày trong tuần (ca hoặc nghỉ).';
  const missing = pattern.find((row) => row.dayType === 'SHIFT' && !row.shiftId);
  if (missing)
    return `Chọn ca cho ${WEEKDAY_FULL_LABELS[missing.weekday]}.`;
  return null;
}

/** Tóm tắt lịch tuần, ví dụ "T2-T6: HC; T7: HC4; CN: Nghỉ". */
export function summarizePattern(
  rules: readonly HrmWeekdayRule[] | readonly PatternRow[],
  shifts: readonly Pick<HrmShiftDefinition, 'id' | 'code'>[],
): string {
  const labelOf = (rule: { dayType: string; shiftId?: string | null }) => {
    if (rule.dayType === 'OFF') return 'Nghỉ';
    if (rule.dayType !== 'SHIFT') return '';
    return shifts.find((s) => s.id === rule.shiftId)?.code ?? 'Ca?';
  };
  return summarizeWeekdayLabels(
    rules
      .filter((r) => r.dayType !== 'SKIP')
      .map((r) => ({ weekday: r.weekday, label: labelOf(r) })),
  );
}

/** Gộp các thứ liên tiếp cùng nhãn: "T2-T6: HC; T7: S; CN: OFF". */
function summarizeWeekdayLabels(items: { weekday: number; label: string }[]): string {
  const sorted = [...items].sort((a, b) => a.weekday - b.weekday);
  const groups: { from: number; to: number; label: string }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.label && last.to === item.weekday - 1) last.to = item.weekday;
    else groups.push({ from: item.weekday, to: item.weekday, label: item.label });
  }
  if (!groups.length) return 'Chưa cấu hình';
  return groups
    .map((g) =>
      `${g.from === g.to ? WEEKDAY_LABELS[g.from] : `${WEEKDAY_LABELS[g.from]}-${WEEKDAY_LABELS[g.to]}`}: ${g.label}`,
    )
    .join('; ');
}

/** Tóm tắt các ngày của lịch định kỳ (có sẵn mã ca): "T2-T6: HC; T7: S; CN: OFF". */
export function summarizeRuleDays(days: HrmScheduleRule['days']): string {
  return summarizeWeekdayLabels(
    days.map((d) => ({
      weekday: d.weekday,
      label: d.dayType === 'OFF' ? 'OFF' : (d.shiftCode ?? 'Ca?'),
    })),
  );
}

// ---------------------------------------------------------------------------
// Phạm vi áp dụng
// ---------------------------------------------------------------------------

export interface ScopeDraft {
  type: HrmScheduleScope['type'];
  employeeIds: string[];
  unitIds: string[];
  includeChildUnits: boolean;
  excludeEmployeeIds: string[];
}

export function emptyScopeDraft(type: ScopeDraft['type'] = 'EMPLOYEE'): ScopeDraft {
  return {
    type,
    employeeIds: [],
    unitIds: [],
    includeChildUnits: true,
    excludeEmployeeIds: [],
  };
}

export function buildScope(draft: ScopeDraft, openEnded = false): HrmScheduleScope {
  switch (draft.type) {
    case 'EMPLOYEE':
      return { type: 'EMPLOYEE', employeeIds: draft.employeeIds.slice(0, 1) };
    case 'EMPLOYEES':
      return { type: 'EMPLOYEES', employeeIds: draft.employeeIds };
    case 'UNIT':
      // Lịch không kết thúc: đơn vị con tự kế thừa, không hỗ trợ loại trừ nhân viên.
      if (openEnded) return { type: 'UNIT', unitIds: draft.unitIds };
      return {
        type: 'UNIT',
        unitIds: draft.unitIds,
        includeChildUnits: draft.includeChildUnits,
        excludeEmployeeIds: draft.excludeEmployeeIds,
      };
    default:
      return openEnded
        ? { type: 'COMPANY' }
        : { type: 'COMPANY', excludeEmployeeIds: draft.excludeEmployeeIds };
  }
}

/** Thông báo lỗi nếu phạm vi chưa đủ thông tin, ngược lại null. */
export function validateScopeDraft(draft: ScopeDraft): string | null {
  if (draft.type === 'EMPLOYEE' && draft.employeeIds.length !== 1)
    return 'Chọn một nhân viên.';
  if (draft.type === 'EMPLOYEES' && draft.employeeIds.length === 0)
    return 'Chọn ít nhất một nhân viên.';
  if (draft.type === 'UNIT' && draft.unitIds.length === 0)
    return 'Chọn ít nhất một đơn vị.';
  return null;
}

/** Giới hạn phạm vi theo quyền: không bulk thì chỉ được chọn một nhân viên. */
export function allowedScopeTypes(canBulk: boolean): ScopeDraft['type'][] {
  return canBulk ? ['EMPLOYEE', 'EMPLOYEES', 'UNIT', 'COMPANY'] : ['EMPLOYEE'];
}

export const SCOPE_TYPE_LABELS: Record<ScopeDraft['type'], string> = {
  EMPLOYEE: 'Một nhân viên',
  EMPLOYEES: 'Nhiều nhân viên',
  UNIT: 'Theo đơn vị',
  COMPANY: 'Toàn công ty',
};

export const CONFLICT_MODE_LABELS: Record<HrmScheduleConflictMode, string> = {
  REPORT: 'Chỉ báo xung đột, không ghi',
  SKIP_EXISTING: 'Bỏ qua ngày đã có lịch',
  OVERWRITE_KEEP_EXCEPTIONS: 'Ghi đè lịch thường, giữ ngoại lệ và ngày lễ',
  OVERWRITE_ALL: 'Ghi đè tất cả (kể cả ngoại lệ)',
};

export function availableConflictModes(canCalendar: boolean): HrmScheduleConflictMode[] {
  const modes: HrmScheduleConflictMode[] = [
    'REPORT',
    'SKIP_EXISTING',
    'OVERWRITE_KEEP_EXCEPTIONS',
  ];
  if (canCalendar) modes.push('OVERWRITE_ALL');
  return modes;
}

// ---------------------------------------------------------------------------
// Lỗi API phân ca
// ---------------------------------------------------------------------------

export type ScheduleErrorInfo =
  | {
      kind: 'CONFLICT';
      message: string;
      conflicts: HrmScheduleConflict[];
      conflictCount: number;
    }
  | {
      kind: 'RULE_CONFLICT';
      message: string;
      rules: HrmScheduleRulePreviewItem[];
      conflictTotal: number;
    }
  | { kind: 'CONFIRM_REQUIRED'; message: string; reasons: string[] }
  | { kind: 'LOCKED'; message: string }
  | { kind: 'NOT_MIGRATED'; message: string }
  /** Thiếu bảng lịch định kỳ (migration 0036): chỉ là lỗi cục bộ của thao tác lịch định kỳ, không thay cả màn hình. */
  | { kind: 'RULES_NOT_MIGRATED'; message: string }
  | { kind: 'OTHER'; message: string };

interface ScheduleErrorBody {
  code?: string;
  message?: string;
  conflicts?: HrmScheduleConflict[];
  confirmReasons?: string[];
  summary?: { conflicts?: number };
  rules?: HrmScheduleRulePreviewItem[];
  conflictTotal?: number;
}

export const NOT_MIGRATED_NOTICE =
  'Chưa khởi tạo dữ liệu phân ca cho doanh nghiệp này. Liên hệ quản trị hệ thống để chạy khởi tạo dữ liệu HRM trước khi sử dụng.';
export const RULES_NOT_MIGRATED_NOTICE =
  'Chưa khởi tạo dữ liệu lịch định kỳ cho doanh nghiệp này. Liên hệ quản trị hệ thống để chạy khởi tạo dữ liệu HRM.';
export const LOCKED_PERIOD_NOTICE =
  'Kỳ công trong khoảng ngày này đã khoá. Cần mở lại kỳ công trước khi thay đổi lịch.';

/** Phân loại lỗi trả về từ các API phân ca để UI hiển thị đúng bước xử lý. */
export function classifyScheduleError(error: unknown): ScheduleErrorInfo {
  const message = error instanceof Error ? error.message : 'Không thực hiện được thao tác.';
  if (!(error instanceof HrmApiError)) return { kind: 'OTHER', message };
  const body = (error.body ?? {}) as ScheduleErrorBody;
  const code = error.code ?? body.code;
  if (error.status === 409 && code === 'HRM_SCHEDULE_NOT_MIGRATED')
    return { kind: 'NOT_MIGRATED', message: NOT_MIGRATED_NOTICE };
  if (error.status === 409 && code === 'HRM_SCHEDULE_RULES_NOT_MIGRATED')
    return { kind: 'RULES_NOT_MIGRATED', message: error.message || RULES_NOT_MIGRATED_NOTICE };
  if (error.status === 409 && code === 'HRM_SCHEDULE_CONFLICT') {
    const conflicts = Array.isArray(body.conflicts) ? body.conflicts : [];
    return {
      kind: 'CONFLICT',
      message,
      conflicts,
      conflictCount: body.summary?.conflicts ?? conflicts.length,
    };
  }
  if (error.status === 409 && code === 'HRM_SCHEDULE_RULE_CONFLICT') {
    const rules = Array.isArray(body.rules) ? body.rules : [];
    return {
      kind: 'RULE_CONFLICT',
      message,
      rules,
      conflictTotal:
        body.conflictTotal ?? rules.filter((r) => r.changes.length > 0).length,
    };
  }
  if (error.status === 409 && code === 'HRM_SCHEDULE_CONFIRM_REQUIRED')
    return {
      kind: 'CONFIRM_REQUIRED',
      message,
      reasons: Array.isArray(body.confirmReasons) ? body.confirmReasons : [],
    };
  if (error.status === 409 && /kỳ công đã kh[oó]a/i.test(error.message))
    return { kind: 'LOCKED', message: LOCKED_PERIOD_NOTICE };
  return { kind: 'OTHER', message };
}

export function isNotMigratedError(error: unknown): boolean {
  return classifyScheduleError(error).kind === 'NOT_MIGRATED';
}

// ---------------------------------------------------------------------------
// Nhãn hiển thị
// ---------------------------------------------------------------------------

export const SOURCE_LABELS: Record<HrmWorkDaySource, string> = {
  TEMPLATE: 'Mẫu',
  MANUAL: 'Thủ công',
  EXCEPTION: 'Ngoại lệ',
  HOLIDAY: 'Ngày lễ',
  RULE: 'Lịch định kỳ',
};

export const DAY_TYPE_LABELS: Record<HrmWorkDayType, string> = {
  SHIFT: 'Ca làm việc',
  OFF: 'Nghỉ',
  HOLIDAY: 'Nghỉ lễ',
};

export const HOLIDAY_KIND_LABELS: Record<HrmHoliday['kind'], string> = {
  HOLIDAY: 'Ngày lễ',
  TET: 'Tết',
  COMPENSATORY: 'Nghỉ bù',
  SPECIAL: 'Ngày đặc biệt',
};

export function shiftLabel(
  shift: Pick<HrmShiftDefinition, 'code' | 'name' | 'startTime' | 'endTime'>,
): string {
  return `${shift.code} - ${shift.name} (${shift.startTime}-${shift.endTime})`;
}

// ---------------------------------------------------------------------------
// Ô lịch trong lưới
// ---------------------------------------------------------------------------

export type CellKind = 'SHIFT' | 'OFF' | 'HOLIDAY' | 'HOLIDAY_SHIFT' | 'EMPTY';
export interface CellVisual {
  kind: CellKind;
  label: string;
  exception: boolean;
  title: string;
}

/** Lễ toàn công ty phủ ngày đó (dùng khi nhân viên chưa có dòng lịch cho ngày lễ). */
export function companyHolidayOn(
  date: string,
  holidays: readonly HrmHoliday[],
): HrmHoliday | undefined {
  return holidays.find(
    (h) =>
      h.status !== 'CANCELLED' &&
      h.scopeType === 'COMPANY' &&
      h.fromDate <= date &&
      h.toDate >= date,
  );
}

export function cellVisual(
  day: HrmScheduleDay | undefined,
  date: string,
  holidays: readonly HrmHoliday[],
): CellVisual {
  const holiday =
    (day?.holidayId ? holidays.find((h) => h.id === day.holidayId) : undefined) ??
    companyHolidayOn(date, holidays);
  if (!day) {
    return holiday
      ? { kind: 'HOLIDAY', label: 'Lễ', exception: false, title: `${holiday.name} (chưa có lịch cá nhân)` }
      : { kind: 'EMPTY', label: '', exception: false, title: 'Chưa có lịch' };
  }
  const exception = day.source === 'EXCEPTION';
  const sourceText = SOURCE_LABELS[day.source];
  if (day.dayType === 'HOLIDAY')
    return {
      kind: 'HOLIDAY',
      label: 'Lễ',
      exception,
      title: `${holiday?.name ?? 'Ngày lễ'} - nghỉ lễ`,
    };
  if (day.dayType === 'OFF')
    return { kind: 'OFF', label: 'OFF', exception, title: `Ngày nghỉ (${sourceText})` };
  const time = day.startTime && day.endTime ? ` ${day.startTime}-${day.endTime}` : '';
  const name = `${day.shiftName ?? day.shiftCode ?? 'Ca'}${time}`;
  if (day.source === 'HOLIDAY')
    return {
      kind: 'HOLIDAY_SHIFT',
      label: day.shiftCode ?? 'Ca',
      exception,
      title: `${name} - ${holiday?.name ?? 'ngày lễ'} vẫn bố trí ca`,
    };
  return {
    kind: 'SHIFT',
    label: day.shiftCode ?? 'Ca',
    exception,
    title: `${name} (${sourceText})`,
  };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

// ---------------------------------------------------------------------------
// Xuất CSV
// ---------------------------------------------------------------------------

export interface ScheduleExportRow {
  employeeCode: string;
  employeeName: string;
  unitName: string;
  date: string;
  weekday: number;
  dayType: string;
  shiftCode: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  source: string;
}

export const SCHEDULE_CSV_HEADER = [
  'Mã nhân viên',
  'Họ tên',
  'Đơn vị',
  'Ngày',
  'Thứ',
  'Loại ngày',
  'Mã ca',
  'Tên ca',
  'Giờ bắt đầu',
  'Giờ kết thúc',
  'Nguồn',
];

/** Escape ô CSV, đồng thời chặn công thức Excel (ô bắt đầu bằng = + - @). */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildScheduleCsvRows(rows: readonly ScheduleExportRow[]): string[][] {
  return [
    SCHEDULE_CSV_HEADER,
    ...rows.map((r) => [
      r.employeeCode,
      r.employeeName,
      r.unitName,
      formatVnDate(r.date),
      WEEKDAY_LABELS[r.weekday] ?? '',
      DAY_TYPE_LABELS[r.dayType as HrmWorkDayType] ?? r.dayType,
      r.shiftCode,
      r.shiftName,
      r.startTime,
      r.endTime,
      SOURCE_LABELS[r.source as HrmWorkDaySource] ?? r.source,
    ]),
  ];
}

/** Nội dung CSV (chưa gồm BOM; BOM thêm khi tải xuống để Excel đọc đúng tiếng Việt). */
export function buildScheduleCsv(rows: readonly ScheduleExportRow[]): string {
  return buildScheduleCsvRows(rows)
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
}

export function downloadCsvText(filename: string, csv: string): void {
  const url = URL.createObjectURL(
    new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Bản nháp phân ca (dialog Phân ca mới / hàng loạt / ngoại lệ)
// ---------------------------------------------------------------------------

export const MAX_APPLY_DAYS = 366;

export interface AssignDraft {
  kind: 'ASSIGN' | 'EXCEPTION';
  scope: ScopeDraft;
  /** ASSIGN: dùng mẫu đã lưu hoặc cấu hình tay lịch tuần. */
  source: 'TEMPLATE' | 'PATTERN';
  templateId: string;
  pattern: PatternRow[];
  /** EXCEPTION: một ca hoặc nghỉ cho mọi ngày trong khoảng. */
  exception: { dayType: 'OFF' | 'SHIFT'; shiftId: string };
  fromDate: string;
  toDate: string;
  /** ASSIGN: không có ngày kết thúc (lịch định kỳ, bỏ toDate khi gửi). Ngoại lệ luôn cần ngày kết thúc. */
  openEnded: boolean;
  reason: string;
  conflictMode: HrmScheduleConflictMode;
}

export function emptyAssignDraft(
  kind: AssignDraft['kind'],
  init: { employeeId?: string; date?: string } = {},
): AssignDraft {
  const today = todayIso();
  const scope = emptyScopeDraft('EMPLOYEE');
  if (init.employeeId) scope.employeeIds = [init.employeeId];
  return {
    kind,
    scope,
    source: 'PATTERN',
    templateId: '',
    pattern: emptyPattern(),
    exception: { dayType: 'OFF', shiftId: '' },
    fromDate: init.date ?? today,
    toDate: init.date ?? addDays(today, 29),
    openEnded: kind === 'ASSIGN',
    reason: '',
    // Ngoại lệ ghi đè lịch thường nhưng giữ các ngoại lệ khác và ngày lễ; phân ca thường chỉ báo xung đột.
    conflictMode: kind === 'EXCEPTION' ? 'OVERWRITE_KEEP_EXCEPTIONS' : 'REPORT',
  };
}

export function validateDateRange(fromDate: string, toDate: string): string | null {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) return 'Nhập đầy đủ từ ngày và đến ngày.';
  if (fromDate > toDate) return 'Từ ngày phải trước hoặc bằng đến ngày.';
  if (daysInclusive(fromDate, toDate) > MAX_APPLY_DAYS)
    return `Khoảng ngày tối đa ${MAX_APPLY_DAYS} ngày.`;
  return null;
}

/** Bước 1 (phạm vi), 2 (lịch), 3 (thời gian). Trả về thông báo lỗi hoặc null. */
export function validateDraftStep(draft: AssignDraft, step: 1 | 2 | 3): string | null {
  if (step === 1) return validateScopeDraft(draft.scope);
  if (step === 2) {
    if (draft.kind === 'EXCEPTION')
      return draft.exception.dayType === 'SHIFT' && !draft.exception.shiftId
        ? 'Chọn ca cho ngoại lệ.'
        : null;
    if (draft.source === 'TEMPLATE') return draft.templateId ? null : 'Chọn một mẫu lịch tuần.';
    return validatePattern(draft.pattern);
  }
  if (isOpenEnded(draft)) {
    if (!isIsoDate(draft.fromDate)) return 'Nhập từ ngày.';
    if (draft.scope.excludeEmployeeIds.length && (draft.scope.type === 'UNIT' || draft.scope.type === 'COMPANY'))
      return 'Lịch không có ngày kết thúc không hỗ trợ loại trừ nhân viên. Bỏ danh sách loại trừ ở bước 1, nhập ngày kết thúc, hoặc dùng ngoại lệ/lịch riêng của nhân viên.';
    return null;
  }
  return validateDateRange(draft.fromDate, draft.toDate);
}

export function isOpenEnded(draft: Pick<AssignDraft, 'kind' | 'openEnded'>): boolean {
  return draft.kind === 'ASSIGN' && draft.openEnded;
}

export function buildApplyRequest(
  draft: AssignDraft,
  confirm = false,
): HrmApplyScheduleRequest {
  const openEnded = isOpenEnded(draft);
  const base = {
    kind: draft.kind,
    scope: buildScope(draft.scope, openEnded),
    fromDate: draft.fromDate,
    // Không có ngày kết thúc: bỏ hẳn toDate.
    ...(openEnded ? {} : { toDate: draft.toDate }),
    conflictMode: draft.conflictMode,
    reason: draft.reason.trim() || null,
    ...(confirm ? { confirm: true } : {}),
  };
  if (draft.kind === 'EXCEPTION')
    return {
      ...base,
      pattern: buildExceptionPattern(
        draft.exception.dayType === 'OFF'
          ? { dayType: 'OFF' }
          : { dayType: 'SHIFT', shiftId: draft.exception.shiftId },
      ),
    };
  return draft.source === 'TEMPLATE'
    ? { ...base, templateId: draft.templateId }
    : { ...base, pattern: patternToRules(draft.pattern) };
}

/** Chuẩn hoá để lọc tiếng Việt không dấu. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function filterOptionsByText<T extends { label: string }>(
  options: readonly T[],
  text: string,
): T[] {
  const needle = normalizeSearchText(text);
  if (!needle) return [...options];
  return options.filter((o) => normalizeSearchText(o.label).includes(needle));
}

// ---------------------------------------------------------------------------
// Nhật ký thay đổi
// ---------------------------------------------------------------------------

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  WORK_SCHEDULE_APPLIED: 'Phân ca',
  WORK_SCHEDULE_CANCELLED: 'Hủy lịch',
  WORK_SCHEDULE_COPIED: 'Sao chép lịch',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

interface AuditRun {
  from?: string;
  to?: string;
  dayType?: string;
  shiftCode?: string | null;
  source?: string;
}

/** Chuyển trường before/after (mảng các đoạn liên tiếp) thành các dòng dễ đọc. */
export function formatAuditRuns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as AuditRun[])
    .filter((run) => run && typeof run === 'object')
    .map((run) => {
      const range =
        run.from && run.to && run.from !== run.to
          ? `${formatVnDate(run.from)} - ${formatVnDate(run.to)}`
          : formatVnDate(run.from ?? run.to);
      const what =
        run.dayType === 'SHIFT'
          ? (run.shiftCode ?? 'Ca')
          : (DAY_TYPE_LABELS[run.dayType as HrmWorkDayType] ?? run.dayType ?? '');
      const source = run.source ? ` (${SOURCE_LABELS[run.source as HrmWorkDaySource] ?? run.source})` : '';
      return `${range}: ${what}${source}`;
    });
}

export interface DayRun {
  from: string;
  to: string;
  dayType: HrmWorkDayType;
  shiftCode: string | null;
  source: HrmWorkDaySource;
}

/** Gộp các ngày liên tiếp cùng loại/ca/nguồn của một nhân viên thành từng đoạn. */
export function groupEmployeeRuns(days: readonly HrmScheduleDay[]): DayRun[] {
  const runs: DayRun[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.dayType === day.dayType &&
      last.shiftCode === day.shiftCode &&
      last.source === day.source &&
      addDays(last.to, 1) === day.date
    )
      last.to = day.date;
    else
      runs.push({
        from: day.date,
        to: day.date,
        dayType: day.dayType,
        shiftCode: day.shiftCode,
        source: day.source,
      });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Lịch định kỳ (không có ngày kết thúc)
// ---------------------------------------------------------------------------

export type AnySchedulePreview = HrmSchedulePreview | HrmScheduleRulePreview;
export type AnyApplyResult = HrmApplyScheduleResult | HrmScheduleRuleApplyResult;

/** Phân biệt kết quả xem trước của lịch định kỳ với lịch cố định trong khoảng ngày. */
export function isRulePreview(value: AnySchedulePreview): value is HrmScheduleRulePreview {
  return 'ruleCount' in value;
}

export function isRuleApplyResult(value: AnyApplyResult): value is HrmScheduleRuleApplyResult {
  return 'ruleCount' in value;
}

/** Số mục chặn: lịch cố định có xung đột ngày; lịch định kỳ chỉ chặn khi chế độ REPORT. */
export function blockingConflicts(
  preview: AnySchedulePreview,
  conflictMode: HrmScheduleConflictMode,
): number {
  if (isRulePreview(preview)) return conflictMode === 'REPORT' ? preview.conflictTotal : 0;
  return preview.summary.conflicts;
}

/** Số bản ghi sẽ được ghi nếu lưu. */
export function writableCount(preview: AnySchedulePreview): number {
  return isRulePreview(preview)
    ? preview.ruleCount
    : preview.summary.insert + preview.summary.replace;
}

export const RULE_ACTION_LABELS: Record<'TRUNCATE' | 'CANCEL', string> = {
  TRUNCATE: 'Kết thúc sớm',
  CANCEL: 'Hủy',
};

export const RULE_SCOPE_LABELS: Record<'EMPLOYEE' | 'UNIT' | 'COMPANY', string> = {
  EMPLOYEE: 'Nhân viên',
  UNIT: 'Đơn vị',
  COMPANY: 'Toàn công ty',
};

export function ruleRangeText(from: string, to: string | null): string {
  return `${formatVnDate(from)} - ${to ? formatVnDate(to) : 'Không kết thúc'}`;
}

/** Quyền cần để kết thúc/hủy một lịch định kỳ: của nhân viên cần manage; của đơn vị hoặc công ty cần bulk. */
export function canChangeRule(
  scopeType: HrmScheduleRule['scopeType'],
  can: { manage: boolean; bulk: boolean },
): boolean {
  return scopeType === 'EMPLOYEE' ? can.manage : can.bulk;
}

export const OPEN_ENDED_HINT =
  'Lịch áp dụng từ ngày bắt đầu và tự chạy đến khi bạn kết thúc; không cần gán lại theo tháng.';
