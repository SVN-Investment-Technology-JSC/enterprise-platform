import type {
  HrmDayRequest,
  HrmMonitorRow,
  HrmMonitorStatus,
} from '@enterprise-platform/contracts-hrm';

/** Mô hình thuần của màn Giám sát chấm công: nhãn, lọc, thống kê và xuất file (không phụ thuộc React). */

export type MonitorTone = 'red' | 'amber' | 'orange' | 'green' | 'blue' | 'slate' | 'violet';

export const MONITOR_STATUS: Record<HrmMonitorStatus, { label: string; tone: MonitorTone }> = {
  NOT_CHECKED_IN: { label: 'Chưa vào ca', tone: 'red' },
  ABSENT: { label: 'Vắng mặt', tone: 'red' },
  LATE: { label: 'Đi trễ', tone: 'amber' },
  EARLY_LEAVE: { label: 'Về sớm', tone: 'orange' },
  LATE_EARLY: { label: 'Đi trễ, về sớm', tone: 'amber' },
  MISSING_PUNCH: { label: 'Thiếu lượt chấm', tone: 'red' },
  CHECKED_IN: { label: 'Đã vào ca', tone: 'green' },
  COMPLETED: { label: 'Đã hoàn thành ca', tone: 'green' },
  UPCOMING: { label: 'Chưa tới giờ ca', tone: 'slate' },
  ON_LEAVE: { label: 'Đang nghỉ phép', tone: 'violet' },
  ON_TRIP: { label: 'Công tác', tone: 'blue' },
  DAY_OFF: { label: 'Ngày nghỉ', tone: 'slate' },
  NO_SCHEDULE: { label: 'Chưa có lịch', tone: 'slate' },
};

/** Các trạng thái cần người quản lý để mắt tới (hiện trong "Danh sách cần theo dõi"). */
export const ATTENTION_STATUSES: readonly HrmMonitorStatus[] = [
  'NOT_CHECKED_IN',
  'ABSENT',
  'LATE',
  'EARLY_LEAVE',
  'LATE_EARLY',
  'MISSING_PUNCH',
];

export type MonitorTab = 'ALL' | 'NOT_CHECKED_IN' | 'LATE' | 'EARLY_LEAVE' | 'MISSING_PUNCH';

export const MONITOR_TABS: readonly {
  id: MonitorTab;
  label: string;
  statuses: readonly HrmMonitorStatus[];
  tone: MonitorTone;
}[] = [
  { id: 'ALL', label: 'Tất cả', statuses: ATTENTION_STATUSES, tone: 'blue' },
  { id: 'NOT_CHECKED_IN', label: 'Chưa vào ca', statuses: ['NOT_CHECKED_IN', 'ABSENT'], tone: 'red' },
  { id: 'LATE', label: 'Đi trễ', statuses: ['LATE', 'LATE_EARLY'], tone: 'amber' },
  { id: 'EARLY_LEAVE', label: 'Về sớm', statuses: ['EARLY_LEAVE', 'LATE_EARLY'], tone: 'orange' },
  { id: 'MISSING_PUNCH', label: 'Thiếu lượt chấm', statuses: ['MISSING_PUNCH'], tone: 'red' },
];

export interface MonitorFilter {
  readonly tab: MonitorTab;
  readonly department: string;
  /** Mã ca. */
  readonly shift: string;
  /** Rỗng = mọi trạng thái trong tab. */
  readonly status: HrmMonitorStatus | '';
  readonly search: string;
}

export const EMPTY_FILTER: MonitorFilter = { tab: 'ALL', department: '', shift: '', status: '', search: '' };

/** Bỏ dấu, chữ thường: gõ tiếng Việt không dấu vẫn tìm được. */
export function foldVi(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

const tabStatuses = (tab: MonitorTab): readonly HrmMonitorStatus[] =>
  MONITOR_TABS.find((t) => t.id === tab)?.statuses ?? ATTENTION_STATUSES;

/** Lọc nhân viên theo bộ lọc chung (phòng ban, ca, từ khoá); chưa áp tab và trạng thái. */
function matchesCommon(row: HrmMonitorRow, filter: MonitorFilter): boolean {
  if (filter.department && (row.departmentName ?? '') !== filter.department) return false;
  if (filter.shift && (row.shiftCode ?? '') !== filter.shift) return false;
  const q = foldVi(filter.search);
  if (q && !foldVi(`${row.employeeCode} ${row.employeeName}`).includes(q)) return false;
  return true;
}

/** Danh sách cần theo dõi: chỉ các trạng thái cần chú ý, theo tab, bộ lọc và trạng thái chọn. */
export function filterAttention(rows: readonly HrmMonitorRow[], filter: MonitorFilter): HrmMonitorRow[] {
  const allowed = tabStatuses(filter.tab);
  return rows.filter(
    (row) =>
      allowed.includes(row.status) &&
      (!filter.status || row.status === filter.status) &&
      matchesCommon(row, filter),
  );
}

/** Số nhân viên của từng tab (theo phòng ban/ca/từ khoá đang chọn). */
export function tabCounts(rows: readonly HrmMonitorRow[], filter: MonitorFilter): Record<MonitorTab, number> {
  const base = rows.filter((row) => matchesCommon(row, filter));
  const counts = {} as Record<MonitorTab, number>;
  for (const tab of MONITOR_TABS) counts[tab.id] = base.filter((row) => tab.statuses.includes(row.status)).length;
  return counts;
}

export const percent = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

export const percentText = (part: number, total: number): string =>
  `${percent(part, total).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export interface DepartmentStat {
  readonly name: string;
  readonly checkedIn: number;
  readonly total: number;
  readonly rate: number;
}

/** Tình hình theo phòng ban: đã vào ca trên số người có ca (không tính ngày nghỉ/chưa có lịch). */
export function departmentStats(rows: readonly HrmMonitorRow[]): DepartmentStat[] {
  const map = new Map<string, { checkedIn: number; total: number }>();
  for (const row of rows) {
    if (row.status === 'DAY_OFF' || row.status === 'NO_SCHEDULE') continue;
    const name = row.departmentName ?? 'Chưa có phòng ban';
    const stat = map.get(name) ?? { checkedIn: 0, total: 0 };
    stat.total += 1;
    if (row.checkIn) stat.checkedIn += 1;
    map.set(name, stat);
  }
  return [...map.entries()]
    .map(([name, s]) => ({ name, ...s, rate: percent(s.checkedIn, s.total) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'vi'));
}

export const REQUEST_KIND_LABEL: Record<HrmDayRequest['kind'], string> = {
  LEAVE: 'Nghỉ phép',
  OT: 'Làm thêm giờ',
  TRIP: 'Công tác',
  CORRECTION: 'Giải trình công',
  SHIFT_CHANGE: 'Đổi ca',
  CUSTOM: 'Đơn khác',
};

export const REQUEST_STATUS: Record<HrmDayRequest['status'], { label: string; tone: MonitorTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt', tone: 'green' },
  REJECTED: { label: 'Từ chối', tone: 'red' },
};

export interface RelatedRequest {
  readonly key: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentName: string | null;
  readonly kind: HrmDayRequest['kind'];
  readonly label: string;
  readonly status: HrmDayRequest['status'];
}

/** Đơn từ liên quan tới ngày đang xem (bỏ đơn đã từ chối), đơn chờ duyệt lên trước. */
export function relatedRequests(rows: readonly HrmMonitorRow[]): RelatedRequest[] {
  const out: RelatedRequest[] = [];
  for (const row of rows)
    for (const request of row.requests) {
      if (request.status === 'REJECTED') continue;
      out.push({
        key: `${row.employeeId}:${request.kind}:${request.id}`,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        departmentName: row.departmentName,
        kind: request.kind,
        label: REQUEST_KIND_LABEL[request.kind],
        status: request.status,
      });
    }
  return out.sort(
    (a, b) =>
      Number(b.status === 'PENDING') - Number(a.status === 'PENDING') ||
      a.employeeName.localeCompare(b.employeeName, 'vi'),
  );
}

/** Ca làm việc có trong dữ liệu (để lọc theo ca). */
export function shiftOptions(rows: readonly HrmMonitorRow[]): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const row of rows)
    if (row.shiftCode) map.set(row.shiftCode, row.shiftName ?? row.shiftCode);
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

export function departmentOptions(rows: readonly HrmMonitorRow[]): { value: string; label: string }[] {
  return [...new Set(rows.map((r) => r.departmentName).filter((d): d is string => Boolean(d)))]
    .sort((a, b) => a.localeCompare(b, 'vi'))
    .map((value) => ({ value, label: value }));
}

/** Giờ dự kiến của ca: "07:30 – 17:00" hoặc "----". */
export function shiftTimeText(row: Pick<HrmMonitorRow, 'shiftStart' | 'shiftEnd'>): string {
  if (!row.shiftStart) return '----';
  return row.shiftEnd ? `${row.shiftStart} – ${row.shiftEnd}` : row.shiftStart;
}

/** Ghi nhận thực tế: giờ vào/ra đã chấm, hoặc "Chưa chấm" / "Chưa có lượt ra". */
export function actualText(row: Pick<HrmMonitorRow, 'checkIn' | 'checkOut' | 'status'>): string {
  if (!row.checkIn && !row.checkOut) return 'Chưa chấm';
  if (row.checkIn && row.checkOut) return `${row.checkIn} – ${row.checkOut}`;
  if (row.checkIn) return row.status === 'MISSING_PUNCH' ? `${row.checkIn} (chưa có lượt ra)` : row.checkIn;
  return `Ra lúc ${row.checkOut}`;
}

/** Nhãn trạng thái kèm số phút khi có (ví dụ "Đi trễ 18 phút"). */
export function statusText(row: Pick<HrmMonitorRow, 'status' | 'lateMinutes' | 'earlyLeaveMinutes' | 'leaveName'>): string {
  const base = MONITOR_STATUS[row.status].label;
  if (row.status === 'LATE' && row.lateMinutes > 0) return `${base} ${row.lateMinutes} phút`;
  if (row.status === 'EARLY_LEAVE' && row.earlyLeaveMinutes > 0) return `${base} ${row.earlyLeaveMinutes} phút`;
  if (row.status === 'LATE_EARLY')
    return `${base} (${row.lateMinutes} phút / ${row.earlyLeaveMinutes} phút)`;
  return base;
}

/** Bảng xuất Excel (CSV) của danh sách cần theo dõi. */
export function monitorCsvRows(rows: readonly HrmMonitorRow[]): string[][] {
  return [
    ['Mã nhân viên', 'Nhân viên', 'Phòng ban', 'Chức danh', 'Ca làm', 'Giờ dự kiến', 'Giờ vào', 'Giờ ra', 'Trạng thái'],
    ...rows.map((row) => [
      row.employeeCode,
      row.employeeName,
      row.departmentName ?? '',
      row.positionName ?? '',
      row.shiftName ?? '',
      shiftTimeText(row),
      row.checkIn ?? '',
      row.checkOut ?? '',
      statusText(row),
    ]),
  ];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(-2).map((p) => p[0]).join('') || '?').toUpperCase();
}

/** Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD). */
export function todayVn(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** "Thứ Ba, 13/10/2026". */
export function longDateVn(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const names = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const weekday = names[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Giờ cập nhật HH:mm theo giờ Việt Nam. */
export function updatedTimeVn(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
}

export type MonitorKpi = 'SCHEDULED' | 'CHECKED_IN' | 'NOT_CHECKED_IN' | 'LATE' | 'EARLY_LEAVE' | 'ON_LEAVE';

export const KPI_TITLE: Record<MonitorKpi, string> = {
  SCHEDULED: 'Nhân sự đi ca',
  CHECKED_IN: 'Đã vào ca',
  NOT_CHECKED_IN: 'Chưa chấm công',
  LATE: 'Đi trễ',
  EARLY_LEAVE: 'Về sớm',
  ON_LEAVE: 'Đang nghỉ phép',
};

/** Các dòng mà một thẻ tổng quan đang đếm (khớp cách tính ở máy chủ). */
export function kpiRows(rows: readonly HrmMonitorRow[], kpi: MonitorKpi): HrmMonitorRow[] {
  switch (kpi) {
    case 'SCHEDULED':
      return rows.filter((r) => r.status !== 'DAY_OFF' && r.status !== 'NO_SCHEDULE');
    case 'CHECKED_IN':
      return rows.filter((r) => Boolean(r.checkIn));
    case 'NOT_CHECKED_IN':
      return rows.filter((r) => r.status === 'NOT_CHECKED_IN' || r.status === 'ABSENT');
    case 'LATE':
      return rows.filter((r) => r.status === 'LATE' || r.status === 'LATE_EARLY');
    case 'EARLY_LEAVE':
      return rows.filter((r) => r.status === 'EARLY_LEAVE' || r.status === 'LATE_EARLY');
    case 'ON_LEAVE':
      return rows.filter((r) => r.status === 'ON_LEAVE');
  }
}
