/** Hàm thuần cho màn Công của tôi: ô lịch tháng, ký tự đơn từ, thống kê tháng, chi tiết đơn. */
import type {
  HrmBoardCalendarDay,
  HrmBoardDay,
  HrmBoardEmployee,
  HrmDayRequest,
} from '@enterprise-platform/contracts-hrm';
import { formatMinutes } from '../hrm-timesheet-format';
import {
  dayRequestKindLabel,
  formatDateTimeVn,
  formatUnits,
} from './timesheet-board-format';

type RequestKind = HrmDayRequest['kind'];
type RequestStatus = HrmDayRequest['status'];

/** Quy ước một ký tự cho từng loại đơn, hiện ở góc ô ngày và trong chú thích. */
export const REQUEST_LETTERS: Record<RequestKind, { letter: string; label: string }> = {
  LEAVE: { letter: 'P', label: 'Phép (gồm phép năm)' },
  OT: { letter: 'TC', label: 'Tăng ca' },
  TRIP: { letter: 'CT', label: 'Công tác' },
  CORRECTION: { letter: 'GT', label: 'Giải trình công' },
  SHIFT_CHANGE: { letter: 'ĐC', label: 'Đổi ca' },
  CUSTOM: { letter: 'KH', label: 'Đơn khác' },
};

/** Nghỉ không phép không phải đơn từ: ký hiệu KP hiện ở ô ngày vắng không có đơn nghỉ. */
export const ABSENT_LETTER = { letter: 'KP', label: 'Nghỉ không phép' } as const;

const LETTER_ORDER: readonly RequestKind[] = ['LEAVE', 'TRIP', 'OT', 'CORRECTION', 'SHIFT_CHANGE', 'CUSTOM'];

export interface DayLetter {
  readonly kind: RequestKind | 'ABSENT';
  readonly letter: string;
  readonly label: string;
  /** Trạng thái tốt nhất trong các đơn cùng loại của ngày: đã duyệt > chờ duyệt > từ chối; KP là ngày vắng không phép. */
  readonly status: RequestStatus | 'ABSENT';
}

const STATUS_RANK: Record<RequestStatus, number> = { APPROVED: 0, PENDING: 1, REJECTED: 2 };

/** Mỗi loại đơn một ký tự cho một ngày, theo thứ tự cố định. */
export function dayLetters(day: HrmBoardDay | undefined): DayLetter[] {
  const best = new Map<RequestKind, RequestStatus>();
  for (const r of day?.requests ?? []) {
    const current = best.get(r.kind);
    if (!current || STATUS_RANK[r.status] < STATUS_RANK[current]) best.set(r.kind, r.status);
  }
  const letters: DayLetter[] = LETTER_ORDER.filter((kind) => best.has(kind)).map((kind) => ({
    kind,
    letter: REQUEST_LETTERS[kind].letter,
    label: REQUEST_LETTERS[kind].label,
    status: best.get(kind) as RequestStatus,
  }));
  if (day?.status === 'ABSENT') letters.unshift({ kind: 'ABSENT', ...ABSENT_LETTER, status: 'ABSENT' });
  return letters;
}

/** Ngày chưa tới ngày chấm công: còn hiển thị mã ca; đã qua thì hiển thị số công. */
export function isFutureDay(day: HrmBoardDay, today: string): boolean {
  return day.status === 'FUTURE' || day.date > today;
}

export interface DayCoefficient {
  readonly text: string;
  /** ok: xanh (đủ công hoặc nửa công có đơn); bad: đỏ (trễ, sớm, thiếu công, quên chấm công). */
  readonly tone: 'ok' | 'bad';
}

const MISSING_PUNCH = ['MISSING_CHECK_IN', 'MISSING_CHECK_OUT'];

/** Sức chứa công của ngày theo ca: ca đủ ngày (từ 7 giờ) là 1, ca ngắn tính theo ngày công 480 phút (ca sáng T7 là 0.5). Khớp với máy chủ. */
export function dayCapacity(day: Pick<HrmBoardDay, 'scheduledMinutes'>): number {
  const m = Number(day.scheduledMinutes ?? 0);
  if (!(m > 0)) return 1;
  return m >= 420 ? 1 : Math.round((m / 480) * 100) / 100;
}

/**
 * Hệ số công hiển thị của một ngày đã qua: đủ công là 1 (xanh); đi trễ, về sớm hoặc thiếu công là 0.xx (đỏ, làm tròn
 * 2 số lẻ); nửa ngày có đơn nghỉ là 0.5 (xanh); ca nửa ngày (sáng T7) làm đủ cũng là 0.5 (xanh); quên chấm công là 0 (đỏ).
 */
export function dayCoefficient(day: HrmBoardDay): DayCoefficient {
  if (day.leave && day.leave.days > 0 && day.leave.days < 1) return { text: formatUnits(day.leave.days), tone: 'ok' };
  if (day.anomalies.some((a) => MISSING_PUNCH.includes(a))) return { text: '0', tone: 'bad' };
  const units = Math.round(Number(day.workdayUnits ?? 0) * 100) / 100;
  if (isLateOrEarly(day) || units < dayCapacity(day) - 0.005) return { text: formatUnits(units), tone: 'bad' };
  return { text: formatUnits(units), tone: 'ok' };
}

/** Đi trễ hoặc về sớm: ô được tô đỏ. */
export function isLateOrEarly(day: HrmBoardDay | undefined): boolean {
  return Boolean(day && (day.lateMinutes > 0 || day.earlyLeaveMinutes > 0));
}

/**
 * Nội dung chính của ô ngày: ngày chưa tới thì mã ca (hoặc OFF / L / dấu gạch), ngày đã qua thì số công
 * (không hiện mã ca). Ngày nghỉ hằng tuần và ngày lễ không có công thì hiện OFF và L.
 */
export function myCellText(day: HrmBoardDay | undefined, today: string): string {
  if (!day) return '';
  if (isFutureDay(day, today)) {
    if (day.shiftCode) return day.shiftCode;
    if (day.kind === 'HOLIDAY') return 'L';
    if (day.kind === 'OFF') return 'OFF';
    return '-';
  }
  if (day.status === 'NO_SCHEDULE') return '-';
  if (day.workdayUnits > 0) return dayCoefficient(day).text;
  if (day.kind === 'HOLIDAY') return 'L';
  if (day.kind === 'OFF') return 'OFF';
  return '0';
}

/**
 * Số công do công tác đóng góp trong ngày: nửa ngày công tác là 0.5, cả ngày là 1 (theo số phút ca mà đơn bao phủ).
 * Chưa có số phút (máy chủ cũ) thì lấy số công của ngày; không có gì thì tính cả ngày.
 */
function tripUnits(day: HrmBoardDay): number {
  const covered = (day.sources ?? []).filter((s) => s.kind === 'TRIP' && s.minutes != null).map((s) => Number(s.minutes));
  if (covered.length > 0 && day.scheduledMinutes > 0) {
    const share = Math.min(1, Math.max(...covered) / day.scheduledMinutes);
    return share >= 0.99 ? 1 : Math.round(share * 100) / 100;
  }
  const units = Math.round(Number(day.workdayUnits ?? 0) * 100) / 100;
  return units > 0 ? units : 1;
}

export interface MonthCellNumber {
  readonly text: string;
  /** ok: xanh; bad: đỏ; none: ngày chưa tới hoặc không có công (màu mặc định). */
  readonly tone: 'ok' | 'bad' | 'none';
}

/**
 * Ô lịch tháng thuần số (ngăn kéo bảng công): 1 xanh là công chuẩn; 1p là ngày có đơn phép tính lương; 0 xanh là phép
 * không lương; 0 đỏ là thiếu dữ liệu chấm công (kể cả vắng không phép); đi trễ, về sớm hoặc thiếu công là 0.xx đỏ.
 * Ngày chưa tới hiện mã ca, ngày nghỉ hằng tuần và ngày lễ hiện OFF / L.
 */
export function monthCellNumber(day: HrmBoardDay, today: string): MonthCellNumber {
  if (isFutureDay(day, today) || day.status === 'NO_SCHEDULE') return { text: myCellText(day, today), tone: 'none' };
  if (day.status === 'ABSENT') return { text: '0', tone: 'bad' };
  if (day.status === 'OFF') return { text: 'OFF', tone: 'none' };
  if (day.status === 'HOLIDAY') {
    const units = Math.round(Number(day.workdayUnits ?? 0) * 100) / 100;
    return { text: `${formatUnits(units > 0 ? units : 1)}L`, tone: 'ok' };
  }
  if (day.status === 'TRIP') return { text: `${formatUnits(tripUnits(day))}CT`, tone: 'ok' };
  const leave = day.leave;
  if (leave && leave.days > 0) {
    if (leave.paid) {
      const units = Math.round(Number(day.workdayUnits ?? 0) * 100) / 100;
      return { text: `${formatUnits(units > 0 ? units : leave.days)}P`, tone: 'ok' };
    }
    return { text: day.workdayUnits > 0 ? dayCoefficient(day).text : '0', tone: 'ok' };
  }
  if (day.workdayUnits > 0 || day.anomalies.some((a) => MISSING_PUNCH.includes(a))) {
    const coefficient = dayCoefficient(day);
    return { text: coefficient.text, tone: coefficient.tone };
  }
  if (day.kind === 'HOLIDAY') return { text: 'L', tone: 'none' };
  if (day.kind === 'OFF') return { text: 'OFF', tone: 'none' };
  return { text: '0', tone: 'bad' };
}

/** Các tuần (thứ Hai đến Chủ nhật) của tháng; ô ngoài tháng là null. */
export function calendarWeeks(calendar: readonly Pick<HrmBoardCalendarDay, 'date' | 'weekday'>[]): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  let current: (string | null)[] = [];
  calendar.forEach((c, index) => {
    const column = (c.weekday + 6) % 7; // 0 = thứ Hai
    if (index === 0) for (let i = 0; i < column; i++) current.push(null);
    current.push(c.date);
    if (column === 6) {
      weeks.push(current);
      current = [];
    }
  });
  if (current.length) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return weeks;
}

export interface MyStat {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  /** Giá trị đáng chú ý (đi trễ, về sớm, bất thường...): hiện màu đỏ khi khác 0. */
  readonly alert?: boolean;
  /** Chỉ số phụ: ẩn khi bằng 0 để thanh thống kê không bị rối. */
  readonly optional?: boolean;
  /** Giá trị bằng 0 (dùng cùng `optional`). */
  readonly zero?: boolean;
}

/** Mọi đơn của nhân viên trong tháng, mỗi đơn một dòng, kèm ngày đầu tiên đơn rơi vào tháng. */
export interface MonthRequest {
  readonly request: HrmDayRequest;
  readonly firstDate: string;
}

export function monthRequests(employee: HrmBoardEmployee): MonthRequest[] {
  const seen = new Map<string, MonthRequest>();
  for (const date of Object.keys(employee.days).sort()) {
    for (const request of employee.days[date].requests ?? []) {
      const key = `${request.kind}:${request.id}`;
      if (!seen.has(key)) seen.set(key, { request, firstDate: date });
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.firstDate.localeCompare(b.firstDate) || a.request.kind.localeCompare(b.request.kind),
  );
}

/** Thống kê mọi thông số chấm công của tháng cho một nhân viên. */
export function myMonthStats(employee: HrmBoardEmployee): MyStat[] {
  const t = employee.totals;
  const allDays = Object.values(employee.days);
  const plannedDays = allDays.filter((d) => d.kind === 'WORK' && d.scheduledMinutes > 0).length;
  const pending = monthRequests(employee).filter((m) => m.request.status === 'PENDING').length;
  const standard = employee.standard;
  const days = (n: number) => `${formatUnits(n)} ngày`;
  return [
    {
      key: 'units',
      label: 'Công thực tế',
      value: formatUnits(t.workdayUnits),
      hint: `Trên ${plannedDays} ngày có ca`,
    },
    {
      key: 'standard',
      label: 'Công chuẩn',
      value: standard ? formatUnits(standard.workdays) : formatUnits(plannedDays),
      hint: standard?.mode === 'FIXED' || standard?.mode === 'MINUTES' ? 'Cố định theo cấu hình' : 'Động theo ngày công của tháng',
    },
    { key: 'late', label: 'Đi trễ', value: `${t.lateDays} ngày`, hint: `${t.lateMinutes} phút`, alert: t.lateDays > 0 },
    { key: 'early', label: 'Về sớm', value: `${t.earlyLeaveDays} ngày`, hint: `${t.earlyLeaveMinutes} phút`, alert: t.earlyLeaveDays > 0 },
    { key: 'absent', label: 'Nghỉ không phép (KP)', value: days(t.absentDays), alert: t.absentDays > 0 },
    { key: 'ot', label: 'Tăng ca (TC)', value: formatMinutes(t.otMinutes), hint: 'Đã duyệt' },
    { key: 'abnormal', label: 'Bất thường', value: days(t.abnormalDays), hint: 'Quên chấm vào hoặc ra', alert: t.abnormalDays > 0, optional: true, zero: t.abnormalDays === 0 },
    { key: 'annual', label: 'Phép năm (P)', value: days(t.annualLeaveDays), optional: true, zero: t.annualLeaveDays === 0 },
    { key: 'paid', label: 'Nghỉ có lương (P)', value: days(t.paidLeaveDays), optional: true, zero: t.paidLeaveDays === 0 },
    { key: 'unpaid', label: 'Nghỉ không lương (P)', value: days(t.unpaidLeaveDays), optional: true, zero: t.unpaidLeaveDays === 0 },
    { key: 'trip', label: 'Công tác (CT)', value: days(t.tripDays), optional: true, zero: t.tripDays === 0 },
    { key: 'unscheduled', label: 'Chưa có ca', value: `${t.unscheduledDays ?? 0} ngày`, alert: (t.unscheduledDays ?? 0) > 0, optional: true, zero: (t.unscheduledDays ?? 0) === 0 },
    { key: 'pending', label: 'Đơn chờ duyệt', value: String(pending), alert: pending > 0, optional: true, zero: pending === 0 },
  ];
}

export type MyKpiKey = 'units' | 'late' | 'early' | 'leave' | 'absent' | 'ot';

export const MY_KPI_TITLE: Record<MyKpiKey, string> = {
  units: 'Ngày có công thực tế',
  late: 'Ngày đi trễ',
  early: 'Ngày về sớm',
  leave: 'Ngày nghỉ phép',
  absent: 'Ngày nghỉ không phép',
  ot: 'Ngày có tăng ca',
};

export interface MyKpiDay {
  readonly date: string;
  /** Giá trị mà ngày này đóng góp vào thẻ, ví dụ "1", "Trễ 15 phút", "0.5 ngày". */
  readonly value: string;
}

/** Các ngày trong tháng mà một thẻ chỉ số đang tổng hợp, theo thứ tự ngày. */
export function myKpiDays(employee: HrmBoardEmployee, key: MyKpiKey): MyKpiDay[] {
  const out: MyKpiDay[] = [];
  for (const date of Object.keys(employee.days).sort()) {
    const d = employee.days[date];
    switch (key) {
      case 'units':
        if (d.workdayUnits > 0) out.push({ date, value: formatUnits(d.workdayUnits) });
        break;
      case 'late':
        if (d.lateMinutes > 0) out.push({ date, value: `Trễ ${d.lateMinutes} phút` });
        break;
      case 'early':
        if (d.earlyLeaveMinutes > 0) out.push({ date, value: `Sớm ${d.earlyLeaveMinutes} phút` });
        break;
      case 'leave':
        if (d.leave && d.leave.days > 0)
          out.push({ date, value: `${d.leave.reasonName ?? 'Nghỉ'}: ${formatUnits(d.leave.days)} ngày` });
        break;
      case 'absent':
        if (d.status === 'ABSENT') out.push({ date, value: '1 ngày' });
        break;
      case 'ot':
        if (d.otMinutes > 0) out.push({ date, value: formatMinutes(d.otMinutes) });
        break;
    }
  }
  return out;
}

const TRIP_TYPE_LABEL: Record<string, string> = {
  DOMESTIC: 'Trong nước',
  OVERSEAS: 'Nước ngoài',
  INTERSITE: 'Giữa các đơn vị',
};

export function tripTypeLabel(type: string | null | undefined): string {
  return (type && TRIP_TYPE_LABEL[type]) || type || '';
}

/** "01/09/2026 08:00 - 17:00" nếu cùng ngày, "01/09/2026 22:00 - 02/09/2026 02:00" nếu khác ngày. */
export function requestTimeRange(request: Pick<HrmDayRequest, 'fromAt' | 'toAt'>): string {
  const from = formatDateTimeVn(request.fromAt);
  const to = formatDateTimeVn(request.toAt);
  if (!from || !to) return from || to;
  return from.slice(0, 10) === to.slice(0, 10) ? `${from} - ${to.slice(11)}` : `${from} - ${to}`;
}

function hoursText(minutes: number): string {
  return `${formatMinutes(minutes)}`;
}

/** Các dòng chi tiết của một đơn (nhãn, giá trị), bỏ dòng không có dữ liệu. */
export function requestDetailRows(request: HrmDayRequest): [string, string][] {
  const rows: [string, string][] = [];
  const range = requestTimeRange(request);
  if (range) rows.push(['Thời gian', range]);
  if (request.kind === 'LEAVE' && request.label) rows.push(['Loại nghỉ', request.label]);
  if (request.kind === 'TRIP') {
    if (request.label) rows.push(['Nơi công tác', request.label]);
    const type = tripTypeLabel(request.tripType);
    if (type) rows.push(['Hình thức', type]);
  }
  if (request.reasonName) rows.push(['Lý do', request.reasonName]);
  if (request.description && request.description !== request.reasonName && request.description !== request.label)
    rows.push(['Ghi chú', request.description]);
  if (request.kind === 'OT') {
    if (request.minutes != null && request.minutes > 0) rows.push(['Số giờ tăng ca', hoursText(request.minutes)]);
    if (request.otRate != null) rows.push(['Hệ số tăng ca', `x${String(request.otRate).replace('.', ',')}`]);
  }
  if (request.kind === 'LEAVE' && request.minutes != null && request.minutes > 0)
    rows.push(['Giờ hưởng lương trong ngày', hoursText(request.minutes)]);
  if (request.kind === 'CORRECTION') {
    const punchIn = formatDateTimeVn(request.punchIn);
    const punchOut = formatDateTimeVn(request.punchOut);
    if (punchIn) rows.push(['Giờ vào theo đơn', punchIn]);
    if (punchOut) rows.push(['Giờ ra theo đơn', punchOut]);
  }
  const created = formatDateTimeVn(request.createdAt);
  if (created) rows.push(['Ngày tạo đơn', created]);
  return rows;
}

/** Tiêu đề một đơn: tên loại đơn. */
export function requestTitle(request: HrmDayRequest): string {
  return dayRequestKindLabel(request);
}

// ---------------------------------------------------------------------------
// Bảng công tháng của nhiều nhân viên (lưới gọn) và bộ lọc nhanh
// ---------------------------------------------------------------------------

/** Màu chấm nhỏ cho từng loại đơn ở dưới ô ngày của lưới gọn. */
export const REQUEST_DOT_CLASS: Record<RequestKind, string> = {
  LEAVE: 'bg-sky-500',
  TRIP: 'bg-indigo-500',
  OT: 'bg-violet-500',
  CORRECTION: 'bg-amber-500',
  SHIFT_CHANGE: 'bg-teal-500',
  CUSTOM: 'bg-slate-400',
};

export interface CompactTotals {
  /** Số công thực tế trong tháng. */
  readonly units: number;
  /** Số ngày đi trễ hoặc về sớm (một ngày vừa trễ vừa sớm chỉ tính một lần). */
  readonly lateEarlyDays: number;
  readonly lateMinutes: number;
  readonly earlyMinutes: number;
  /** Số ngày nghỉ có đơn: phép năm, nghỉ có lương và không lương. */
  readonly leaveDays: number;
  readonly absentDays: number;
  readonly abnormalDays: number;
  readonly otMinutes: number;
}

/** Tổng hợp gọn cho một dòng của lưới: chỉ những chỉ số cần nhìn ngay. */
export function compactTotals(employee: HrmBoardEmployee): CompactTotals {
  const t = employee.totals;
  const lateEarlyDays = Object.values(employee.days).filter((d) => d.lateMinutes > 0 || d.earlyLeaveMinutes > 0).length;
  return {
    units: t.workdayUnits,
    lateEarlyDays,
    lateMinutes: t.lateMinutes,
    earlyMinutes: t.earlyLeaveMinutes,
    leaveDays: t.annualLeaveDays + t.paidLeaveDays + t.unpaidLeaveDays,
    absentDays: t.absentDays,
    abnormalDays: t.abnormalDays,
    otMinutes: t.otMinutes,
  };
}

export type BoardFilter = 'ALL' | 'LATE_EARLY' | 'ABNORMAL' | 'ABSENT' | 'PENDING';

export const BOARD_FILTERS: readonly { id: BoardFilter; label: string }[] = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'LATE_EARLY', label: 'Đi trễ, về sớm' },
  { id: 'ABNORMAL', label: 'Bất thường' },
  { id: 'ABSENT', label: 'Vắng không phép' },
  { id: 'PENDING', label: 'Có đơn chờ duyệt' },
];

/** Nhân viên có khớp bộ lọc nhanh không (lọc trên những nhân viên đã tải của trang hiện tại). */
export function matchesBoardFilter(employee: HrmBoardEmployee, filter: BoardFilter): boolean {
  if (filter === 'ALL') return true;
  const totals = compactTotals(employee);
  if (filter === 'LATE_EARLY') return totals.lateEarlyDays > 0;
  if (filter === 'ABNORMAL') return totals.abnormalDays > 0;
  if (filter === 'ABSENT') return totals.absentDays > 0;
  return Object.values(employee.days).some((d) => d.requests?.some((r) => r.status === 'PENDING'));
}

/** Mã ca ngắn cho ô hẹp: giữ tối đa 3 ký tự cuối có nghĩa (HC-T7 -> T7, CA-NEW-1 -> W-1); đầy đủ có ở tooltip. */
export function shortShiftCode(code: string | null | undefined): string {
  const value = (code ?? '').trim();
  if (value.length <= 3) return value;
  const parts = value.split(/[-_\s]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last.length <= 3 ? last : value.slice(0, 3);
}

/** Lớp màu của ô ngày trong lưới gọn. Đi trễ hoặc về sớm tô đỏ nhạt; vắng không phép đỏ đậm; bất thường tím. */
export function gridCellClass(day: HrmBoardDay, future: boolean): string {
  if (day.status === 'ABSENT') return 'bg-red-600 text-white font-bold';
  if (day.status === 'ABNORMAL') return 'bg-fuchsia-100 text-fuchsia-800 font-bold';
  if (isLateOrEarly(day)) return 'bg-red-100 text-red-700 font-semibold';
  if (future) return 'bg-white text-slate-400';
  switch (day.status) {
    case 'ANNUAL_LEAVE':
      return 'bg-sky-100 text-sky-800 font-semibold';
    case 'PAID_LEAVE':
      return 'bg-cyan-100 text-cyan-800 font-semibold';
    case 'UNPAID_LEAVE':
      return 'bg-stone-200 text-stone-700 font-semibold';
    case 'TRIP':
      return 'bg-indigo-100 text-indigo-800 font-semibold';
    case 'OFF':
      return 'bg-slate-100 text-slate-300';
    case 'HOLIDAY':
      return 'bg-rose-50 text-rose-500 font-semibold';
    case 'NO_SCHEDULE':
      return 'bg-white text-slate-300';
    default:
      return 'bg-emerald-50 text-emerald-800';
  }
}

/** Nội dung ô trong lưới gọn: ngày chưa tới hiện mã ca ngắn; ngày đã qua hiện số công; ngày vắng hiện KP; nghỉ hằng tuần hiện chấm. */
export function gridCellText(day: HrmBoardDay | undefined, today: string): string {
  if (!day) return '';
  if (isFutureDay(day, today)) return day.shiftCode ? shortShiftCode(day.shiftCode) : day.kind === 'OFF' ? '' : day.kind === 'HOLIDAY' ? 'L' : '-';
  if (day.status === 'ABSENT') return 'KP';
  if (day.status === 'ABNORMAL') return '!';
  if (day.kind === 'OFF') return '';
  if (day.status === 'NO_SCHEDULE') return '-';
  if (day.workdayUnits > 0) return formatUnits(day.workdayUnits);
  return day.kind === 'HOLIDAY' ? 'L' : '0';
}

// ---------------------------------------------------------------------------
// Lịch công của tôi: chấm màu theo trạng thái, giờ làm trong ô, nhãn trạng thái ngày
// ---------------------------------------------------------------------------

export type DayTone = 'full' | 'late' | 'early' | 'leave' | 'absent' | 'trip' | 'abnormal' | 'off' | 'none';

/** Màu chấm của ngày theo chú thích: đủ công, đi trễ, về sớm, nghỉ phép, nghỉ không phép, ngày nghỉ. */
export function dayTone(day: HrmBoardDay, today: string): DayTone {
  if (isFutureDay(day, today)) return 'none';
  switch (day.status) {
    case 'ABSENT':
      return 'absent';
    case 'ANNUAL_LEAVE':
    case 'PAID_LEAVE':
    case 'UNPAID_LEAVE':
      return 'leave';
    case 'TRIP':
      return 'trip';
    case 'ABNORMAL':
      return 'abnormal';
    case 'OFF':
    case 'HOLIDAY':
    case 'NO_SCHEDULE':
      return 'off';
    default:
      if (day.lateMinutes > 0) return 'late';
      if (day.earlyLeaveMinutes > 0) return 'early';
      return day.workedMinutes > 0 || day.workdayUnits > 0 ? 'full' : 'none';
  }
}

export const DAY_TONE_DOT: Record<DayTone, string> = {
  full: 'bg-emerald-500',
  late: 'bg-orange-500',
  early: 'bg-violet-500',
  leave: 'bg-blue-500',
  absent: 'bg-red-500',
  trip: 'bg-indigo-500',
  abnormal: 'bg-fuchsia-500',
  off: 'bg-slate-300',
  none: 'bg-slate-300',
};

/** Giờ làm dạng một số lẻ: 480 phút -> "8.0", 450 phút -> "7.5". */
export function hoursDecimal(minutes: number | null | undefined): string {
  const value = Number(minutes ?? 0);
  return (Math.round((Number.isFinite(value) ? value : 0) / 6) / 10).toFixed(1);
}

/**
 * Nội dung ô trong lịch của tôi (kiểu mới): ngày chưa tới hiện mã ca (OFF, L, Chưa có ca); ngày đã qua hiện
 * số công (hệ số công của ngày, ví dụ 1 hoặc 0.5; không hiện mã ca); ngày nghỉ phép, công tác, vắng và thiếu dữ liệu chấm công hiện 0 (đỏ).
 * `units` rỗng khi ngày không có giờ làm.
 */
export function myCellContent(
  day: HrmBoardDay,
  today: string,
): { text: string; units: string } {
  if (isFutureDay(day, today)) {
    if (day.shiftCode) return { text: day.shiftCode, units: '' };
    if (day.kind === 'HOLIDAY') return { text: 'L', units: '' };
    if (day.kind === 'OFF') return { text: 'OFF', units: '' };
    return { text: '-', units: '' };
  }
  if (day.status === 'HOLIDAY') return { text: 'L', units: '' };
  if (day.status === 'OFF') return { text: 'OFF', units: '' };
  if (day.status === 'NO_SCHEDULE') return { text: '-', units: '' };
  // Vắng không phép hoặc thiếu dữ liệu chấm công: số công 0 (hiện đỏ).
  if (day.status === 'ABSENT') return { text: '', units: '0' };
  if (day.workedMinutes > 0 || day.leave) return { text: '', units: dayCoefficient(day).text };
  if (day.status === 'ABNORMAL' || day.anomalies.some((a) => MISSING_PUNCH.includes(a))) return { text: '', units: '0' };
  return { text: '—', units: '' };
}

export interface DayStatusPill {
  readonly label: string;
  readonly className: string;
}

/** Nhãn trạng thái ở đầu chi tiết ngày: Đủ công, Đi trễ, Về sớm, Nghỉ phép, Nghỉ không phép... */
export function dayStatusPill(day: HrmBoardDay, today: string): DayStatusPill {
  const tone = dayTone(day, today);
  const base = 'border-slate-200 bg-slate-100 text-slate-600';
  if (isFutureDay(day, today)) return { label: 'Chưa tới ngày', className: base };
  switch (tone) {
    case 'full':
      return {
        label: day.workdayUnits >= 1 ? 'Đủ công' : 'Chưa đủ công',
        className: day.workdayUnits >= 1 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
      };
    case 'late':
      return {
        label: day.earlyLeaveMinutes > 0 ? 'Đi trễ, về sớm' : 'Đi trễ',
        className: 'border-orange-200 bg-orange-50 text-orange-700',
      };
    case 'early':
      return { label: 'Về sớm', className: 'border-violet-200 bg-violet-50 text-violet-700' };
    case 'leave':
      return { label: 'Nghỉ phép', className: 'border-blue-200 bg-blue-50 text-blue-700' };
    case 'absent':
      return { label: 'Nghỉ không phép', className: 'border-red-200 bg-red-50 text-red-700' };
    case 'trip':
      return { label: 'Công tác', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' };
    case 'abnormal':
      return { label: 'Bất thường', className: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' };
    case 'off':
      return {
        label: day.status === 'HOLIDAY' ? 'Ngày lễ' : day.status === 'OFF' ? 'Ngày nghỉ' : 'Chưa có lịch',
        className: base,
      };
    default:
      return { label: 'Chưa có công', className: base };
  }
}

// ---------------------------------------------------------------------------
// Ô ngày của bảng công nhiều nhân viên: chấm màu (ngày đã có công), ô ký hiệu (P, KP, CT, !) hoặc chữ (OFF, L, mã ca)
// ---------------------------------------------------------------------------

export type GridCellView =
  /** Ngày đã qua có công: hệ số công, xanh (1, 0.5 có đơn) hoặc đỏ (0.xx trễ, sớm; 0 quên chấm). */
  | { readonly type: 'units'; readonly text: string; readonly tone: 'ok' | 'bad' }
  /** Chữ thường: OFF, L (lễ), "-" (chưa có lịch), mã ca của ngày chưa tới, "0". */
  | { readonly type: 'text'; readonly text: string; readonly muted: boolean };

/**
 * Cách vẽ một ô ngày. Ngày chưa tới chỉ hiện mã ca (hoặc OFF, L, "-"); ngày đã qua hiện chấm công hoặc ký hiệu,
 * không hiện mã ca. Đã có công thì hiện hệ số công (1 xanh, 0.xx đỏ khi trễ hoặc sớm, 0.5 xanh khi nửa ngày có đơn, 0 đỏ khi quên chấm công).
 */
export function gridCellView(day: HrmBoardDay | undefined, today: string): GridCellView {
  if (!day) return { type: 'text', text: '', muted: true };
  if (isFutureDay(day, today)) {
    if (day.shiftCode) return { type: 'text', text: shortShiftCode(day.shiftCode), muted: true };
    if (day.kind === 'HOLIDAY') return { type: 'text', text: 'L', muted: true };
    if (day.kind === 'OFF') return { type: 'text', text: 'OFF', muted: true };
    return { type: 'text', text: '-', muted: true };
  }
  const cell = monthCellNumber(day, today);
  if (cell.tone === 'none') return { type: 'text', text: cell.text, muted: cell.text !== 'L' };
  return { type: 'units', text: cell.text, tone: cell.tone };
}

/** Bỏ các lớp màu nền (bg-*) khỏi chuỗi class, giữ màu chữ và kiểu chữ. */
export function textOnlyClass(classes: string): string {
  return classes
    .split(/s+/)
    .filter((c) => c && !/^bg-/.test(c))
    .join(' ');
}

/** Màu ô ký hiệu theo loại, dùng chung cho lưới, chú thích và chi tiết đơn từ. */
export const BOX_TONE_CLASS: Record<'leave' | 'trip' | 'absent' | 'abnormal', string> = {
  leave: 'bg-blue-100 text-blue-700',
  trip: 'bg-indigo-100 text-indigo-700',
  absent: 'bg-red-100 text-red-600',
  abnormal: 'bg-fuchsia-100 text-fuchsia-700',
};

/** Ô màu nhỏ ghi ký tự loại đơn (P, TC, CT, GT, ĐC, KH) ở chi tiết ngày và danh sách đơn. */
export const REQUEST_BOX_CLASS: Record<RequestKind, string> = {
  LEAVE: 'bg-blue-100 text-blue-700',
  TRIP: 'bg-indigo-100 text-indigo-700',
  OT: 'bg-violet-100 text-violet-700',
  CORRECTION: 'bg-amber-100 text-amber-800',
  SHIFT_CHANGE: 'bg-teal-100 text-teal-700',
  CUSTOM: 'bg-slate-200 text-slate-700',
};
