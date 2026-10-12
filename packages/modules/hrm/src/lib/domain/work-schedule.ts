/**
 * Lõi nghiệp vụ phân ca làm việc (hàm thuần, không DB).
 * Lịch được sinh sẵn từng dòng nhân viên x ngày; ở đây quyết định dòng nào sẽ được tạo / thay thế / bỏ qua.
 */

export type WorkDayType = 'SHIFT' | 'OFF' | 'HOLIDAY';
export type WorkDaySource = 'TEMPLATE' | 'MANUAL' | 'EXCEPTION' | 'HOLIDAY';
export type ConflictMode =
  | 'REPORT'
  | 'SKIP_EXISTING'
  | 'OVERWRITE_KEEP_EXCEPTIONS'
  | 'OVERWRITE_ALL';

export const CONFLICT_MODES: readonly ConflictMode[] = [
  'REPORT',
  'SKIP_EXISTING',
  'OVERWRITE_KEEP_EXCEPTIONS',
  'OVERWRITE_ALL',
];

/** Một thứ trong tuần (ISO: 1 = Thứ Hai ... 7 = Chủ nhật). SKIP = không đụng tới ngày đó. */
export interface WeekdayRule {
  weekday: number;
  dayType: 'SHIFT' | 'OFF' | 'SKIP';
  shiftId?: string | null;
}

export interface IncomingDay {
  employeeId: string;
  date: string;
  dayType: WorkDayType;
  shiftId: string | null;
  source: WorkDaySource;
}

export interface ExistingDay {
  id: string;
  employeeId: string;
  date: string;
  dayType: WorkDayType;
  shiftId: string | null;
  source: WorkDaySource;
}

export type PlanAction =
  | 'INSERT'
  | 'REPLACE'
  | 'SAME'
  | 'SKIP_EXISTING'
  | 'SKIP_PROTECTED'
  | 'CONFLICT';

export interface PlannedDay {
  action: PlanAction;
  incoming: IncomingDay;
  existing?: ExistingDay;
}

export interface PlanSummary {
  insert: number;
  replace: number;
  same: number;
  skipped: number;
  conflicts: number;
  employees: number;
}

export const MAX_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string): number {
  if (!DATE_RE.test(value)) throw new RangeError(`Ngày không hợp lệ: ${value}`);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    throw new RangeError(`Ngày không hợp lệ: ${value}`);
  return ms;
}

/** Thứ trong tuần theo ISO, 1 = Thứ Hai ... 7 = Chủ nhật. */
export function isoWeekday(date: string): number {
  const day = new Date(parseDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Danh sách ngày liên tiếp [from, to] (bao gồm hai đầu). */
export function listDates(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (end < start) throw new RangeError('Ngày kết thúc phải từ ngày bắt đầu');
  const count = Math.round((end - start) / 86_400_000) + 1;
  if (count > MAX_RANGE_DAYS)
    throw new RangeError(`Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày mỗi lần`);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Kiểm tra mẫu tuần; trả về bảng thứ -> quy tắc (thứ thiếu coi như SKIP). */
export function normalizePattern(
  pattern: readonly WeekdayRule[],
): Map<number, WeekdayRule> {
  const byDay = new Map<number, WeekdayRule>();
  for (const rule of pattern ?? []) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7)
      throw new RangeError('Thứ trong tuần phải từ 1 (Thứ Hai) đến 7 (Chủ nhật)');
    if (byDay.has(rule.weekday))
      throw new RangeError(`Thứ ${rule.weekday} bị khai báo hai lần`);
    if (rule.dayType !== 'SHIFT' && rule.dayType !== 'OFF' && rule.dayType !== 'SKIP')
      throw new RangeError('Loại ngày phải là SHIFT, OFF hoặc SKIP');
    if (rule.dayType === 'SHIFT' && !rule.shiftId)
      throw new RangeError(`Thứ ${rule.weekday} làm việc nhưng chưa chọn ca`);
    if (rule.dayType !== 'SHIFT' && rule.shiftId)
      throw new RangeError(`Thứ ${rule.weekday} không làm việc nên không được chọn ca`);
    byDay.set(rule.weekday, rule);
  }
  if (![...byDay.values()].some((r) => r.dayType !== 'SKIP'))
    throw new RangeError('Mẫu lịch phải có ít nhất một ngày làm việc hoặc ngày nghỉ');
  return byDay;
}

/** Ca mà mẫu tuần tham chiếu (để kiểm tra tồn tại / còn hoạt động). */
export function patternShiftIds(pattern: readonly WeekdayRule[]): string[] {
  return [
    ...new Set(
      pattern.filter((r) => r.dayType === 'SHIFT' && r.shiftId).map((r) => r.shiftId!),
    ),
  ];
}

/** Mở rộng mẫu tuần thành từng ngày cho một nhân viên, chỉ trong các ngày nhân viên đủ điều kiện làm việc. */
export function expandPattern(
  pattern: readonly WeekdayRule[],
  employeeId: string,
  from: string,
  to: string,
  source: WorkDaySource,
  eligible?: { joinDate?: string | null; inactiveFrom?: string | null },
): IncomingDay[] {
  const rules = normalizePattern(pattern);
  const out: IncomingDay[] = [];
  for (const date of listDates(from, to)) {
    if (eligible?.joinDate && date < eligible.joinDate) continue;
    if (eligible?.inactiveFrom && date >= eligible.inactiveFrom) continue;
    const rule = rules.get(isoWeekday(date));
    if (!rule || rule.dayType === 'SKIP') continue;
    out.push({
      employeeId,
      date,
      dayType: rule.dayType,
      shiftId: rule.dayType === 'SHIFT' ? (rule.shiftId ?? null) : null,
      source,
    });
  }
  return out;
}

const PROTECTED_SOURCES: readonly WorkDaySource[] = ['EXCEPTION', 'HOLIDAY'];

export function sameDay(a: Pick<IncomingDay, 'dayType' | 'shiftId'>, b: Pick<ExistingDay, 'dayType' | 'shiftId'>) {
  return a.dayType === b.dayType && (a.shiftId ?? null) === (b.shiftId ?? null);
}

/**
 * Quyết định xử lý từng ngày. Thứ tự ưu tiên: ngoại lệ > lịch gán (mẫu/tay) > mặc định.
 *  - Ngày giống hệt: không đổi.
 *  - Ngày chưa có lịch: tạo mới.
 *  - Ngày đã có lịch khác: tuỳ nguồn của lịch mới và chế độ xử lý xung đột (không bao giờ ghi đè âm thầm).
 */
export function planDay(
  incoming: IncomingDay,
  existing: ExistingDay | undefined,
  mode: ConflictMode,
): PlannedDay {
  if (!existing) return { action: 'INSERT', incoming };
  if (sameDay(incoming, existing)) return { action: 'SAME', incoming, existing };
  const existingProtected = PROTECTED_SOURCES.includes(existing.source);

  if (incoming.source === 'HOLIDAY') {
    // Ngày lễ thay lịch thường nhưng không đè ngoại lệ; hai ngày lễ khác nhau thì giữ ngày lễ hiện có.
    if (existing.source === 'EXCEPTION') return { action: 'SKIP_PROTECTED', incoming, existing };
    if (existing.source === 'HOLIDAY') return { action: 'SKIP_PROTECTED', incoming, existing };
    return { action: 'REPLACE', incoming, existing };
  }

  if (incoming.source === 'EXCEPTION') {
    // Ngoại lệ đè được lịch thường (đó là mục đích của nó); chỉ xung đột với ngoại lệ/ngày lễ khác.
    if (!existingProtected) return { action: 'REPLACE', incoming, existing };
    if (mode === 'OVERWRITE_ALL') return { action: 'REPLACE', incoming, existing };
    if (mode === 'REPORT') return { action: 'CONFLICT', incoming, existing };
    return { action: 'SKIP_PROTECTED', incoming, existing };
  }

  // Lịch gán (mẫu / thủ công).
  switch (mode) {
    case 'REPORT':
      return { action: 'CONFLICT', incoming, existing };
    case 'SKIP_EXISTING':
      return { action: 'SKIP_EXISTING', incoming, existing };
    case 'OVERWRITE_KEEP_EXCEPTIONS':
      return existingProtected
        ? { action: 'SKIP_PROTECTED', incoming, existing }
        : { action: 'REPLACE', incoming, existing };
    case 'OVERWRITE_ALL':
      return { action: 'REPLACE', incoming, existing };
  }
}

export function planSchedule(
  incoming: readonly IncomingDay[],
  existing: readonly ExistingDay[],
  mode: ConflictMode,
): { days: PlannedDay[]; summary: PlanSummary } {
  const byKey = new Map<string, ExistingDay>();
  for (const row of existing) byKey.set(`${row.employeeId}|${row.date}`, row);
  const days = incoming.map((day) => planDay(day, byKey.get(`${day.employeeId}|${day.date}`), mode));
  const summary: PlanSummary = {
    insert: 0,
    replace: 0,
    same: 0,
    skipped: 0,
    conflicts: 0,
    employees: new Set(incoming.map((d) => d.employeeId)).size,
  };
  for (const d of days) {
    if (d.action === 'INSERT') summary.insert++;
    else if (d.action === 'REPLACE') summary.replace++;
    else if (d.action === 'SAME') summary.same++;
    else if (d.action === 'CONFLICT') summary.conflicts++;
    else summary.skipped++;
  }
  return { days, summary };
}

export interface DayRun {
  from: string;
  to: string;
  dayType: WorkDayType;
  shiftId: string | null;
  source: WorkDaySource;
}

/** Gộp các ngày liên tiếp giống nhau thành đoạn (để lưu nhật ký gọn). */
export function compactRuns(
  days: readonly Pick<ExistingDay, 'date' | 'dayType' | 'shiftId' | 'source'>[],
): DayRun[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const runs: DayRun[] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    const next = last ? new Date(parseDate(last.to) + 86_400_000).toISOString().slice(0, 10) : null;
    if (
      last &&
      next === d.date &&
      last.dayType === d.dayType &&
      last.shiftId === (d.shiftId ?? null) &&
      last.source === d.source
    ) {
      last.to = d.date;
    } else {
      runs.push({ from: d.date, to: d.date, dayType: d.dayType, shiftId: d.shiftId ?? null, source: d.source });
    }
  }
  return runs;
}

/**
 * Ảnh hưởng của lịch ngày đối với "loại ngày" dùng khi tính công, giữ nguyên công thức hiện có:
 *  - OFF / HOLIDAY tường minh thắng ngày nghỉ hằng tuần của chính sách, nhưng OFF không hạ ngày lễ của
 *    lịch công ty xuống ngày nghỉ không lương;
 *  - có ca thì thắng ngày nghỉ hằng tuần / OFF của lịch công ty (làm bù), nhưng không đổi ngày lễ của lịch công ty.
 */
export function applyScheduleDayKind(
  kind: string | null,
  scheduleDayType: WorkDayType | null | undefined,
): string | null {
  if (!scheduleDayType) return kind;
  if (scheduleDayType === 'OFF') return kind === 'HOLIDAY' ? 'HOLIDAY' : 'OFF';
  if (scheduleDayType === 'HOLIDAY') return 'HOLIDAY';
  return kind === 'OFF' ? null : kind;
}

// ---------------------------------------------------------------------------
// Lịch định kỳ không có ngày kết thúc
// ---------------------------------------------------------------------------

export type RuleScopeType = 'EMPLOYEE' | 'UNIT' | 'COMPANY';

export interface RuleRow {
  id: string;
  from: string;
  /** null = không có ngày kết thúc. */
  to: string | null;
}

export interface RuleReplacement {
  /** Lịch cũ bắt đầu trước ngày mới: giữ lại nhưng kết thúc vào ngày liền trước. */
  truncate: { id: string; newTo: string }[];
  /** Lịch cũ bắt đầu từ ngày mới trở đi: bị thay hoàn toàn nên huỷ (giữ làm lịch sử). */
  cancel: string[];
}

export function dayBefore(date: string): string {
  return new Date(parseDate(date) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Lịch định kỳ mới bắt đầu từ `from` và không kết thúc. Trong cùng một phạm vi (một nhân viên / một phòng ban /
 * toàn công ty) chỉ có một lịch có hiệu lực mỗi ngày, nên các lịch cũ còn hiệu lực từ `from` trở đi phải
 * cắt ngắn hoặc huỷ. Lịch đã kết thúc trước `from` không bị đụng tới.
 */
export function planRuleReplacement(existing: readonly RuleRow[], from: string): RuleReplacement {
  parseDate(from);
  const plan: RuleReplacement = { truncate: [], cancel: [] };
  for (const rule of existing) {
    if (rule.to !== null && rule.to < from) continue;
    if (rule.from < from) plan.truncate.push({ id: rule.id, newTo: dayBefore(from) });
    else plan.cancel.push(rule.id);
  }
  return plan;
}

/** Lịch định kỳ chỉ phủ thứ nào có dòng; dùng cho hiển thị và kiểm tra (thứ thiếu rơi xuống lớp thấp hơn). */
export function ruleDayFor(
  days: readonly { weekday: number; dayType: 'SHIFT' | 'OFF'; shiftId: string | null }[],
  date: string,
) {
  const weekday = isoWeekday(date);
  return days.find((d) => d.weekday === weekday) ?? null;
}
