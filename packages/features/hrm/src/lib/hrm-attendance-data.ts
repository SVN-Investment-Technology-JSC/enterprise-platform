import { buildCsv } from './hrm-csv';
import {
  formatDateVn,
  formatTimeVn,
  inclusiveDays,
} from './hrm-timesheet-format';

export const ATTENDANCE_MAX_RANGE_DAYS = 93;
export const ATTENDANCE_PAGE_SIZE = 50;
/** Trần số dòng khi xuất CSV toàn bộ kết quả đã lọc. */
export const ATTENDANCE_EXPORT_MAX_ROWS = 5000;

export type AttendanceDataStatus =
  | 'VALID'
  | 'LATE'
  | 'EARLY_LEAVE'
  | 'ABNORMAL'
  | 'MISSING_PUNCH'
  | 'APPROVED_CORRECTION';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceDataStatus, string> = {
  VALID: 'Hợp lệ',
  LATE: 'Đi muộn',
  EARLY_LEAVE: 'Về sớm',
  ABNORMAL: 'Bất thường',
  MISSING_PUNCH: 'Thiếu quẹt',
  APPROVED_CORRECTION: 'Đã giải trình',
};

export const ATTENDANCE_STATUS_OPTIONS = (
  Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceDataStatus[]
).map((value) => ({ value, label: ATTENDANCE_STATUS_LABELS[value] }));

export function attendanceStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Chưa xác định';
  return ATTENDANCE_STATUS_LABELS[status as AttendanceDataStatus] ?? 'Khác';
}

export interface AttendanceDataRow {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  departmentName: string | null;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number;
  scheduledMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  status: string;
  source: string | null;
}

export interface AttendanceFilters {
  from: string;
  to: string;
  q: string;
  status: string;
}

/** Trả thông báo lỗi tiếng Việt, hoặc chuỗi rỗng nếu khoảng ngày hợp lệ. */
export function validateAttendanceRange(from: string, to: string): string {
  if (!from || !to) return 'Chọn đầy đủ từ ngày và đến ngày.';
  const days = inclusiveDays(from, to);
  if (Number.isNaN(days)) return 'Khoảng ngày không hợp lệ.';
  if (days < 1) return 'Đến ngày phải sau hoặc bằng từ ngày.';
  if (days > ATTENDANCE_MAX_RANGE_DAYS) {
    return `Khoảng ngày tối đa ${ATTENDANCE_MAX_RANGE_DAYS} ngày (đang chọn ${days} ngày).`;
  }
  return '';
}

export function buildAttendanceQuery(
  filters: AttendanceFilters,
  page: number,
  pageSize: number = ATTENDANCE_PAGE_SIZE,
): string {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    page: String(page),
    page_size: String(pageSize),
  });
  const q = filters.q.trim();
  if (q) params.set('q', q);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}

export function buildAttendanceEventsQuery(
  employeeId: string,
  workDate: string,
): string {
  const day = workDate.slice(0, 10);
  return new URLSearchParams({
    employee_id: employeeId,
    from: day,
    to: day,
    page: '1',
    page_size: '100',
  }).toString();
}

export function buildAttendanceCsv(rows: readonly AttendanceDataRow[]): string {
  return buildCsv([
    [
      'Mã nhân viên',
      'Họ tên',
      'Phòng ban',
      'Ngày công',
      'Giờ vào',
      'Giờ ra',
      'Phút thực tế',
      'Phút theo ca',
      'Phút đi muộn',
      'Phút về sớm',
      'Trạng thái',
      'Nguồn',
    ],
    ...rows.map((r) => [
      r.employeeCode ?? '',
      r.employeeName ?? '',
      r.departmentName ?? '',
      formatDateVn(r.workDate),
      r.checkInAt ? formatTimeVn(r.checkInAt) : '',
      r.checkOutAt ? formatTimeVn(r.checkOutAt) : '',
      r.workedMinutes ?? 0,
      r.scheduledMinutes ?? 0,
      r.lateMinutes ?? 0,
      r.earlyMinutes ?? 0,
      attendanceStatusLabel(r.status),
      r.source ?? '',
    ]),
  ]);
}

export interface AttendanceRawEvent {
  id: string;
  employee_code?: string | null;
  full_name?: string | null;
  work_date: string;
  occurred_at: string;
  event_kind: string;
  source: string | null;
  device_id: string | null;
  evidence: {
    ip?: string;
    siteSnapshot?: { name?: string };
    latitude?: number;
    longitude?: number;
  } | null;
  voided_by_correction_id: string | null;
}

export function eventKindLabel(kind: string): string {
  if (kind === 'IN') return 'Vào';
  if (kind === 'OUT') return 'Ra';
  return 'Khác';
}

/** IP, địa điểm và GPS lấy từ evidence (thiếu thì null). */
export function extractEventEvidence(event: Pick<AttendanceRawEvent, 'evidence'>): {
  ip: string | null;
  site: string | null;
  gps: string | null;
} {
  const evidence = event.evidence ?? {};
  const hasGps =
    typeof evidence.latitude === 'number' &&
    typeof evidence.longitude === 'number';
  return {
    ip: evidence.ip || null,
    site: evidence.siteSnapshot?.name || null,
    gps: hasGps ? `${evidence.latitude}, ${evidence.longitude}` : null,
  };
}
