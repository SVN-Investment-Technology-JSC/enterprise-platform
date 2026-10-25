/** Hàm thuần cho Bàn làm việc cá nhân: tuần, trạng thái hôm nay, tổng hợp tháng, nhãn. */
import type {
  HrmBoardDay,
  HrmBoardEmployee,
  HrmDayRequest,
  HrmPayslip,
} from '@enterprise-platform/contracts-hrm';
import { monthRequests, type MonthRequest } from '../my-timesheet-format';
import { dayRequestKindLabel } from '../timesheet-board-format';

/** Lời chào theo giờ Việt Nam. */
export function greetingOf(hour: number): string {
  if (hour < 11) return 'Chào buổi sáng';
  if (hour < 13) return 'Chào buổi trưa';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/** Tên gọi thân mật: từ cuối của họ tên ("Hà Nguyên Hoàng" -> "Hoàng"). */
export function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

const WEEKDAY_NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function formatDmy(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Giờ và phút theo giờ Việt Nam từ một thời điểm. */
export function clockVn(now: Date): { time: string; hour: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { time: `${get('hour')}:${get('minute')}`, hour: Number(get('hour')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Bảy ngày của tuần (thứ Hai đến Chủ nhật) chứa `date`. */
export function weekOf(date: string): string[] {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(date, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export type TodayState =
  | { key: 'NO_SHIFT'; label: string }
  | { key: 'OFF'; label: string }
  | { key: 'HOLIDAY'; label: string }
  | { key: 'LEAVE'; label: string }
  | { key: 'TRIP'; label: string }
  | { key: 'NOT_IN'; label: string }
  | { key: 'WORKING'; label: string }
  | { key: 'DONE'; label: string };

/** Trạng thái hôm nay của nhân viên từ ngày công và lượt chấm đã có. */
export function todayState(day: HrmBoardDay | undefined, hasShift: boolean): TodayState {
  if (day?.kind === 'HOLIDAY') return { key: 'HOLIDAY', label: 'Ngày lễ' };
  if (day?.kind === 'OFF') return { key: 'OFF', label: 'Ngày nghỉ' };
  if (day?.tripId) return { key: 'TRIP', label: 'Đang công tác' };
  if (day?.leave) return { key: 'LEAVE', label: 'Nghỉ phép' };
  if (!hasShift && !day?.shiftCode) return { key: 'NO_SHIFT', label: 'Chưa có ca' };
  if (day?.checkIn && day.checkOut) return { key: 'DONE', label: 'Đã ra ca' };
  if (day?.checkIn) return { key: 'WORKING', label: 'Đang làm việc' };
  return { key: 'NOT_IN', label: 'Chưa vào ca' };
}

export interface MonthSummary {
  /** Công thực tế đã ghi nhận. */
  readonly units: number;
  /** Công chuẩn của tháng (số ngày công theo lịch hoặc cấu hình). */
  readonly standard: number;
  readonly lateDays: number;
  /** Ngày vắng không phép (thiếu công). */
  readonly absentDays: number;
  readonly leaveDays: number;
}

export function monthSummary(employee: HrmBoardEmployee | undefined): MonthSummary {
  if (!employee) return { units: 0, standard: 0, lateDays: 0, absentDays: 0, leaveDays: 0 };
  const t = employee.totals;
  const planned = Object.values(employee.days).filter((d) => d.kind === 'WORK' && d.scheduledMinutes > 0).length;
  return {
    units: t.workdayUnits,
    standard: employee.standard?.workdays ?? planned,
    lateDays: t.lateDays,
    absentDays: t.absentDays,
    leaveDays: t.annualLeaveDays + t.paidLeaveDays + t.unpaidLeaveDays,
  };
}

/** Màu chấm của một ngày trên dải tháng. */
export type DotTone = 'present' | 'late' | 'absent' | 'leave' | 'future' | 'off';

export function dayDotTone(day: HrmBoardDay | undefined, today: string): DotTone {
  if (!day) return 'off';
  if (day.kind === 'OFF' || day.kind === 'HOLIDAY' || day.kind === 'NO_SCHEDULE') return 'off';
  if (day.date > today || day.status === 'FUTURE') return 'future';
  if (day.status === 'ABSENT' || day.status === 'ABNORMAL') return 'absent';
  if (day.lateMinutes > 0 || day.earlyLeaveMinutes > 0) return 'late';
  if (day.leave || day.status === 'ANNUAL_LEAVE' || day.status === 'PAID_LEAVE' || day.status === 'UNPAID_LEAVE') return 'leave';
  return 'present';
}

export const DOT_CLASS: Record<DotTone, string> = {
  present: 'bg-emerald-500',
  late: 'bg-orange-400',
  absent: 'bg-rose-500',
  leave: 'bg-blue-500',
  future: 'bg-slate-200',
  off: 'bg-slate-100',
};

export type RequestStatusTone = { label: string; className: string };

export function requestStatusTone(status: HrmDayRequest['status']): RequestStatusTone {
  if (status === 'APPROVED') return { label: 'Đã duyệt', className: 'bg-emerald-50 text-emerald-700' };
  if (status === 'REJECTED') return { label: 'Từ chối', className: 'bg-rose-50 text-rose-700' };
  return { label: 'Chờ duyệt', className: 'bg-orange-50 text-orange-600' };
}

/** Các đơn mới nhất trong tháng (theo ngày tạo, rồi ngày đầu của đơn), tối đa `limit`. */
export function recentRequests(employee: HrmBoardEmployee | undefined, limit = 3): MonthRequest[] {
  if (!employee) return [];
  return monthRequests(employee)
    .slice()
    .sort((a, b) => {
      const timeB = Date.parse(b.request.createdAt ?? b.firstDate) || 0;
      const timeA = Date.parse(a.request.createdAt ?? a.firstDate) || 0;
      return timeB - timeA;
    })
    .slice(0, limit);
}

export function pendingRequestCount(employee: HrmBoardEmployee | undefined): number {
  return employee ? monthRequests(employee).filter((m) => m.request.status === 'PENDING').length : 0;
}

/** Dòng mô tả một đơn: loại đơn, ngày. */
export function requestHeadline(request: HrmDayRequest): string {
  const kind = dayRequestKindLabel(request);
  return request.kind !== 'CUSTOM' && request.label ? `${kind}: ${request.label}` : kind;
}

/** "5 phút trước", "2 giờ trước", "3 ngày trước". */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'vừa xong';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

/** Phiếu lương đã phát hành mới nhất và các kỳ khác. Kỳ lấy từ snapshot nếu có, không thì từ ngày phát hành. */
export function payslipPeriod(slip: HrmPayslip): string {
  const snap = slip.snapshotJson as { periodCode?: unknown; period?: unknown; month?: unknown } | undefined;
  const code = [snap?.periodCode, snap?.period, snap?.month].find((v) => typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) as string | undefined;
  const ym = code ? code.slice(0, 7) : (slip.issuedAt ?? slip.createdAt).slice(0, 7);
  return `Tháng ${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
}

export function sortedPayslips(rows: readonly HrmPayslip[]): HrmPayslip[] {
  return rows
    .filter((r) => r.status !== ('DRAFT' as string))
    .slice()
    .sort((a, b) => (b.issuedAt ?? b.createdAt).localeCompare(a.issuedAt ?? a.createdAt));
}
