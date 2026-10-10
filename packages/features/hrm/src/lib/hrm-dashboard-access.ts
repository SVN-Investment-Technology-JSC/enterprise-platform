import {
  approvalListPath,
  approvalSourcesFor,
  type ApprovalSource,
} from './hrm-approval-kinds';

/**
 * Bàn làm việc chỉ được gọi API mà người dùng có quyền. Hàm thuần này quyết định
 * vùng nào hiển thị và endpoint nào được tải theo tập quyền hiện có.
 */
export type DashboardPlan = {
  /** Vùng cá nhân (ngữ cảnh chấm công, lối tắt "của tôi"): cần hrm.self.read. */
  personal: boolean;
  /** Được bấm vào/ra ca: cần hrm.self.attendance (và hrm.self.read để tải ngữ cảnh). */
  canPunch: boolean;
  canSeePayslip: boolean;
  /** Các loại đơn cần đếm ở thẻ "Cần xử lý". */
  approvals: ApprovalSource[];
  /** Tổng quan chấm công hôm nay: cần hrm.dashboard.read. */
  overview: boolean;
  /** Thẻ kỳ công: cần hrm.timesheet.read. */
  timesheetPeriods: boolean;
  /** Thẻ kỳ lương: cần hrm.payroll.read. */
  payrollPeriods: boolean;
  /** Danh sách đường dẫn API (không kèm /api/hrm/v1) sẽ được gọi khi tải trang. */
  endpoints: string[];
};

export function dashboardPlan(actions: readonly string[]): DashboardPlan {
  const has = new Set(actions);
  const personal = has.has('hrm.self.read');
  const approvals = approvalSourcesFor(actions);
  const overview = has.has('hrm.dashboard.read');
  const timesheetPeriods = has.has('hrm.timesheet.read');
  const payrollPeriods = has.has('hrm.payroll.read');
  const endpoints = [
    ...(personal ? ['/my-attendance-context'] : []),
    ...approvals.map((s) => approvalListPath(s)),
    ...(overview ? ['/dashboard/overview'] : []),
    ...(timesheetPeriods ? ['/timesheet-periods'] : []),
    ...(payrollPeriods ? ['/payroll-periods'] : []),
  ];
  return {
    personal,
    canPunch: personal && has.has('hrm.self.attendance'),
    canSeePayslip: has.has('hrm.self.payslip'),
    approvals,
    overview,
    timesheetPeriods,
    payrollPeriods,
    endpoints,
  };
}

export type ShiftWindow = { start: string; end: string } | null | undefined;

/** "08:00 - 17:00" theo múi giờ của ngữ cảnh chấm công; null nếu hôm nay chưa phân ca. */
export function formatShiftWindow(
  window: ShiftWindow,
  timezone = 'Asia/Ho_Chi_Minh',
): string | null {
  if (!window) return null;
  const time = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
  };
  return `${time(window.start)} - ${time(window.end)}`;
}
