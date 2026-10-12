/** Hàm thuần cho lưới Bảng công theo tháng (nhãn, ký hiệu, màu, định dạng, CSV). */
import type {
  HrmBoardDay,
  HrmBoardDayKind,
  HrmBoardDayStatus,
  HrmBoardEmployee,
  HrmBoardTotals,
  HrmTimesheetBoard,
  HrmTimesheetMonthState,
  HrmDaySource,
  HrmDayRequest,
} from '@enterprise-platform/contracts-hrm';
import { buildCsv } from '../hrm-csv';
import { formatMinutes } from '../hrm-timesheet-format';

export interface BoardStatusMeta {
  readonly label: string;
  /** Ký hiệu hiển thị trong ô khi không dùng số công; rỗng = dùng số công. */
  readonly symbol: string;
  readonly cell: string;
  readonly legend: string;
}

export const BOARD_STATUS_META: Record<HrmBoardDayStatus, BoardStatusMeta> = {
  PRESENT: { label: 'Đi làm', symbol: '', cell: 'bg-emerald-50 text-emerald-800', legend: 'bg-emerald-200' },
  LATE: { label: 'Đi trễ', symbol: '', cell: 'bg-amber-100 text-amber-900', legend: 'bg-amber-300' },
  EARLY_LEAVE: { label: 'Về sớm', symbol: '', cell: 'bg-yellow-100 text-yellow-900', legend: 'bg-yellow-300' },
  LATE_EARLY: { label: 'Trễ và sớm', symbol: '', cell: 'bg-orange-100 text-orange-900', legend: 'bg-orange-300' },
  ABNORMAL: { label: 'Bất thường (quên chấm công)', symbol: '!', cell: 'bg-fuchsia-100 text-fuchsia-800 font-bold', legend: 'bg-fuchsia-300' },
  ABSENT: { label: 'Nghỉ không phép', symbol: 'KP', cell: 'bg-red-100 text-red-700 font-semibold', legend: 'bg-red-300' },
  ANNUAL_LEAVE: { label: 'Phép năm', symbol: 'PN', cell: 'bg-sky-100 text-sky-800 font-semibold', legend: 'bg-sky-300' },
  PAID_LEAVE: { label: 'Nghỉ có phép', symbol: 'CP', cell: 'bg-cyan-100 text-cyan-800 font-semibold', legend: 'bg-cyan-300' },
  UNPAID_LEAVE: { label: 'Nghỉ không lương', symbol: 'KL', cell: 'bg-stone-200 text-stone-700 font-semibold', legend: 'bg-stone-300' },
  TRIP: { label: 'Công tác', symbol: 'CT', cell: 'bg-indigo-100 text-indigo-800 font-semibold', legend: 'bg-indigo-300' },
  OFF: { label: 'Ngày nghỉ', symbol: 'OFF', cell: 'bg-slate-100 text-slate-500', legend: 'bg-slate-300' },
  HOLIDAY: { label: 'Lễ', symbol: 'L', cell: 'bg-rose-100 text-rose-700 font-semibold', legend: 'bg-rose-300' },
  NO_SCHEDULE: { label: 'Chưa có lịch', symbol: '-', cell: 'bg-white text-slate-300', legend: 'bg-white border border-dashed border-slate-300' },
  FUTURE: { label: 'Chưa tới ngày', symbol: '', cell: 'bg-white text-slate-400', legend: 'bg-white border border-slate-300' },
};

/** Thứ tự hiển thị chú thích. */
export const BOARD_LEGEND_ORDER: readonly HrmBoardDayStatus[] = [
  'PRESENT',
  'LATE',
  'EARLY_LEAVE',
  'LATE_EARLY',
  'ABNORMAL',
  'ABSENT',
  'ANNUAL_LEAVE',
  'PAID_LEAVE',
  'UNPAID_LEAVE',
  'TRIP',
  'OFF',
  'HOLIDAY',
  'NO_SCHEDULE',
  'FUTURE',
];

export function boardStatusLabel(status: string | null | undefined): string {
  return (status && BOARD_STATUS_META[status as HrmBoardDayStatus]?.label) || 'Chưa xác định';
}

export function boardStatusCellClass(status: string | null | undefined): string {
  return (status && BOARD_STATUS_META[status as HrmBoardDayStatus]?.cell) || 'bg-white text-slate-500';
}

/** Số công: 1, 0.5, 0.25 (làm tròn 2 số lẻ). */
export function formatUnits(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

/** Nội dung ô ngày: ký hiệu trạng thái hoặc số công. */
export function boardCellText(day: HrmBoardDay | undefined): string {
  if (!day) return '';
  const meta = BOARD_STATUS_META[day.status];
  if (!meta) return '';
  if (meta.symbol) return meta.symbol;
  if (day.status === 'FUTURE') return '';
  return formatUnits(day.workdayUnits);
}

/** Dấu nhỏ cạnh ô khi có trễ/sớm/bất thường. */
export function boardCellMarkers(day: HrmBoardDay | undefined): string {
  if (!day) return '';
  let marker = '';
  if (day.lateMinutes > 0) marker += 'T';
  if (day.earlyLeaveMinutes > 0) marker += 'S';
  if (day.anomalies.length > 0 || day.status === 'ABNORMAL') marker += '!';
  return marker;
}

const ANOMALY_LABELS: Record<string, string> = {
  MISSING_CHECK_IN: 'Thiếu chấm vào',
  MISSING_CHECK_OUT: 'Thiếu chấm ra',
  NO_SHIFT: 'Chưa có ca',
  NO_SCHEDULE: 'Chưa có lịch làm việc',
  NO_ATTENDANCE: 'Không có dữ liệu chấm công',
  INVALID_PUNCH_ORDER: 'Thứ tự chấm công không hợp lệ',
  OUTSIDE_SHIFT: 'Chấm công ngoài ca',
  OT_OUTSIDE_SHIFT: 'Tăng ca ngoài ca',
  OVERLAPPING_REQUESTS: 'Đơn từ trùng ngày',
  LEAVE_TRIP_OVERLAP: 'Nghỉ phép trùng công tác',
  LEGACY_LEAVE_REQUIRES_REVIEW: 'Đơn nghỉ cũ cần rà soát',
  PENDING_REQUEST: 'Còn đơn chờ duyệt',
  INVALID_SHIFT: 'Ca làm việc cấu hình lỗi (cửa sổ giờ không hợp lệ)',
  MISSING_OUT: 'Thiếu chấm ra',
  OUT_WITHOUT_IN: 'Thiếu chấm vào',
};

const SOURCE_KIND_LABEL: Record<HrmDaySource['kind'], string> = {
  LEAVE: 'Đơn nghỉ',
  OT: 'Đơn làm thêm giờ',
  TRIP: 'Đơn công tác',
  CORRECTION: 'Đơn giải trình công',
  SHIFT_CHANGE: 'Đơn đổi ca',
};
const SOURCE_APPROVAL_TYPE: Record<HrmDaySource['kind'], string> = {
  LEAVE: 'leave',
  OT: 'ot',
  TRIP: 'business_trip',
  CORRECTION: 'correction',
  SHIFT_CHANGE: 'shift_change',
};

/** Tên loại đơn của một nguồn tác động tới ngày công. */
export function sourceKindLabel(kind: HrmDaySource['kind']): string {
  return SOURCE_KIND_LABEL[kind] ?? 'Đơn';
}

/** Mô tả ngắn một nguồn: "Đơn nghỉ: Phép năm (4 giờ hưởng lương)". */
export function sourceSummary(source: HrmDaySource): string {
  const parts: string[] = [];
  if (source.label) parts.push(source.label);
  if (source.minutes != null && source.minutes > 0) {
    const hours = Math.round((source.minutes / 60) * 100) / 100;
    parts.push(
      source.kind === 'OT'
        ? `${String(hours).replace('.', ',')} giờ đã duyệt`
        : source.kind === 'LEAVE'
          ? `${String(hours).replace('.', ',')} giờ hưởng lương`
          : `${String(hours).replace('.', ',')} giờ`,
    );
  }
  return parts.length ? `${sourceKindLabel(source.kind)}: ${parts.join(' - ')}` : sourceKindLabel(source.kind);
}

/** Đường dẫn mở đơn gốc: người quản lý xem ở màn Duyệt đơn, nhân viên tự xem ở Đơn từ của tôi. */
export function sourceHref(source: HrmDaySource, canViewAll: boolean): string {
  const id = encodeURIComponent(source.id);
  return canViewAll
    ? `/approvals?type=${SOURCE_APPROVAL_TYPE[source.kind]}&request=${id}`
    : `/requests?request=${id}`;
}

export function anomalyLabel(code: string): string {
  return ANOMALY_LABELS[code] ?? `Bất thường (${code})`;
}

export function dayKindLabel(kind: HrmBoardDayKind | string): string {
  switch (kind) {
    case 'WORK':
      return 'Ngày làm việc';
    case 'OFF':
      return 'Ngày nghỉ (OFF)';
    case 'HOLIDAY':
      return 'Ngày lễ';
    case 'NO_SCHEDULE':
      return 'Chưa có lịch làm việc';
    default:
      return 'Chưa xác định';
  }
}

export function monthStateLabel(state: HrmTimesheetMonthState | string): string {
  switch (state) {
    case 'OPEN':
      return 'Đang mở';
    case 'REQUESTS_CLOSED':
      return 'Đã chốt đơn từ';
    case 'LOCKED':
      return 'Đã chốt công';
    default:
      return 'Chưa xác định';
  }
}

/** Thời điểm ISO -> dd/MM/yyyy HH:mm theo giờ Việt Nam. */
export function formatDateTimeVn(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Thời điểm gắn với trạng thái tháng (chốt đơn từ / chốt công), rỗng nếu đang mở. */
export function monthStateTimestamp(info: {
  state: HrmTimesheetMonthState;
  requestsClosedAt: string | null;
  lockedAt: string | null;
}): string {
  if (info.state === 'LOCKED') return formatDateTimeVn(info.lockedAt);
  if (info.state === 'REQUESTS_CLOSED') return formatDateTimeVn(info.requestsClosedAt);
  return '';
}

export function formatDayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/** Văn bản tooltip của một ô ngày. */
export function boardDayTooltip(day: HrmBoardDay | undefined): string {
  if (!day) return '';
  const lines: string[] = [`${day.date.split('-').reverse().join('/')}: ${boardStatusLabel(day.status)}`];
  if (day.kind === 'HOLIDAY' && day.holidayName) lines.push(`Lễ: ${day.holidayName}`);
  if (day.shiftCode || day.shiftName) {
    const hours = day.shiftStart && day.shiftEnd ? ` (${day.shiftStart}-${day.shiftEnd})` : '';
    lines.push(`Ca: ${day.shiftCode ?? ''}${day.shiftName ? ` ${day.shiftName}` : ''}${hours}`.replace(/\s+/g, ' ').trim());
  }
  if (day.checkIn || day.checkOut) lines.push(`Chấm: ${day.checkIn ?? '--:--'} - ${day.checkOut ?? '--:--'}`);
  lines.push(`Công: ${formatUnits(day.workdayUnits)}`);
  if (day.lateMinutes > 0) lines.push(`Đi trễ: ${day.lateMinutes} phút`);
  if (day.earlyLeaveMinutes > 0) lines.push(`Về sớm: ${day.earlyLeaveMinutes} phút`);
  if (day.otMinutes > 0) lines.push(`OT: ${formatMinutes(day.otMinutes)}`);
  if (day.anomalies.length > 0) lines.push(day.anomalies.map(anomalyLabel).join('; '));
  return lines.join('\n');
}

/** Mô tả lý do nghỉ của ngày: "Phép năm (Có lương)". */
export function leaveDescription(day: HrmBoardDay): string {
  if (!day.leave) return '';
  const name = day.leave.reasonName || 'Nghỉ';
  const pay = day.leave.paid ? 'Có lương' : 'Không lương';
  const annual = day.leave.annual ? ', trừ phép năm' : '';
  return `${name} (${pay}${annual})`;
}

export interface BoardTotalColumn {
  readonly key: string;
  readonly label: string;
  readonly value: (t: HrmBoardTotals) => string;
}

export const BOARD_TOTAL_COLUMNS: readonly BoardTotalColumn[] = [
  { key: 'units', label: 'Công', value: (t) => formatUnits(t.workdayUnits) },
  { key: 'late', label: 'Đi trễ', value: (t) => `${t.lateDays} ngày / ${t.lateMinutes} phút` },
  { key: 'early', label: 'Về sớm', value: (t) => `${t.earlyLeaveDays} ngày / ${t.earlyLeaveMinutes} phút` },
  { key: 'abnormal', label: 'Bất thường', value: (t) => formatUnits(t.abnormalDays) },
  { key: 'absent', label: 'Nghỉ không phép', value: (t) => formatUnits(t.absentDays) },
  { key: 'annual', label: 'Phép năm', value: (t) => formatUnits(t.annualLeaveDays) },
  { key: 'paid', label: 'Nghỉ có phép', value: (t) => formatUnits(t.paidLeaveDays) },
  { key: 'unpaid', label: 'Không lương', value: (t) => formatUnits(t.unpaidLeaveDays) },
  { key: 'trip', label: 'Công tác', value: (t) => formatUnits(t.tripDays) },
  { key: 'ot', label: 'OT', value: (t) => formatMinutes(t.otMinutes) },
];

/** Cột đồ thị gọn trong lưới (giá trị ngắn). */
export const BOARD_GRID_TOTALS: readonly BoardTotalColumn[] = [
  { key: 'units', label: 'Công', value: (t) => formatUnits(t.workdayUnits) },
  { key: 'late', label: 'Đi trễ', value: (t) => (t.lateDays ? `${t.lateDays}/${t.lateMinutes}p` : '0') },
  { key: 'early', label: 'Về sớm', value: (t) => (t.earlyLeaveDays ? `${t.earlyLeaveDays}/${t.earlyLeaveMinutes}p` : '0') },
  { key: 'abnormal', label: 'Bất thường', value: (t) => formatUnits(t.abnormalDays) },
  { key: 'absent', label: 'Không phép', value: (t) => formatUnits(t.absentDays) },
  { key: 'annual', label: 'Phép năm', value: (t) => formatUnits(t.annualLeaveDays) },
  { key: 'paid', label: 'Có phép', value: (t) => formatUnits(t.paidLeaveDays) },
  { key: 'unpaid', label: 'Không lương', value: (t) => formatUnits(t.unpaidLeaveDays) },
  { key: 'trip', label: 'Công tác', value: (t) => formatUnits(t.tripDays) },
  { key: 'ot', label: 'OT', value: (t) => formatMinutes(t.otMinutes) },
];

/** Dựng CSV: mỗi nhân viên một dòng, mỗi ngày một cột (số công hoặc ký hiệu), rồi các cột tổng. */
export function buildBoardCsv(
  board: Pick<HrmTimesheetBoard, 'calendar'>,
  employees: readonly HrmBoardEmployee[],
): string {
  const dates = board.calendar.map((d) => d.date);
  const header: unknown[] = [
    'Mã NV',
    'Họ tên',
    'Đơn vị',
    ...dates.map((d) => d.split('-').reverse().join('/')),
    ...BOARD_TOTAL_COLUMNS.map((c) => c.label),
  ];
  const rows = employees.map((emp) => [
    emp.employeeCode,
    emp.employeeName,
    emp.departmentName ?? '',
    ...dates.map((date) => boardCellText(emp.days[date])),
    ...BOARD_TOTAL_COLUMNS.map((c) => c.value(emp.totals)),
  ]);
  return buildCsv([header, ...rows]);
}

const REQUEST_STATUS_LABEL: Record<HrmDayRequest['status'], string> = {
  APPROVED: 'Đã duyệt',
  PENDING: 'Chờ duyệt',
  REJECTED: 'Từ chối',
};
export function requestStatusLabel(status: HrmDayRequest['status']): string {
  return REQUEST_STATUS_LABEL[status] ?? status;
}

/** Tên loại đơn của một đơn dính tới ngày công (kể cả đơn tuỳ chỉnh). */
export function dayRequestKindLabel(request: HrmDayRequest): string {
  return request.kind === 'CUSTOM' ? (request.label ?? 'Đơn tuỳ chỉnh') : sourceKindLabel(request.kind);
}

/** Mô tả ngắn một đơn: "Đơn nghỉ: Phép năm (4 giờ hưởng lương)". */
export function dayRequestSummary(request: HrmDayRequest): string {
  if (request.kind === 'CUSTOM') return dayRequestKindLabel(request);
  return sourceSummary({ kind: request.kind, id: request.id, minutes: request.minutes, label: request.label });
}

/** Đường dẫn mở đơn gốc (như sourceHref, thêm đơn tuỳ chỉnh). */
export function dayRequestHref(request: HrmDayRequest, canViewAll: boolean): string {
  if (request.kind === 'CUSTOM')
    return canViewAll ? `/approvals?type=custom&request=${encodeURIComponent(request.id)}` : `/requests?request=${encodeURIComponent(request.id)}`;
  return sourceHref({ kind: request.kind, id: request.id, minutes: request.minutes, label: request.label }, canViewAll);
}
