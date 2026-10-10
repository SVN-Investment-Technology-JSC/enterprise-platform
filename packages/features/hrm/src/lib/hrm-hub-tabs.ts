import type { HrmAction } from '@enterprise-platform/contracts-identity';

export interface HrmHubTabMeta {
  /** Giá trị của `?view=` trên URL. Tab đầu tiên được phép là tab mặc định. */
  id: string;
  label: string;
  /** Có BẤT KỲ quyền nào trong danh sách thì thấy tab. */
  permissions: readonly HrmAction[];
}

/**
 * Các trang gộp nhiều chức năng thành tab. Đây là nguồn duy nhất cho nhãn và quyền của từng tab:
 * `hrmPagePermissions` lấy hợp quyền của các tab, `hrm-hubs.tsx` gắn màn hình vào đúng `id`.
 */
export const HRM_HUBS = {
  '/my-work': [
    { id: 'calendar', label: 'Lịch', permissions: ['hrm.self.read'] },
    { id: 'attendance', label: 'Chấm công', permissions: ['hrm.self.read'] },
    { id: 'timesheet', label: 'Bảng công', permissions: ['hrm.self.read'] },
  ],
  '/profile': [
    { id: 'profile', label: 'Hồ sơ', permissions: ['hrm.self.read'] },
    { id: 'payslips', label: 'Phiếu lương', permissions: ['hrm.self.payslip'] },
  ],
  '/employees': [
    { id: 'employees', label: 'Nhân viên', permissions: ['hrm.employee.read'] },
    { id: 'dependents', label: 'Người phụ thuộc', permissions: ['hrm.dependent.read'] },
    { id: 'decisions', label: 'Quyết định nhân sự', permissions: ['hrm.appointment.read'] },
    { id: 'leave', label: 'Quỹ phép', permissions: ['hrm.leave.read'] },
  ],
  '/timekeeping': [
    { id: 'schedules', label: 'Phân ca', permissions: ['hrm.schedule.read'] },
    { id: 'timesheets', label: 'Bảng công', permissions: ['hrm.timesheet.read'] },
    { id: 'data', label: 'Dữ liệu chấm công', permissions: ['hrm.attendance.read'] },
    { id: 'shifts', label: 'Danh mục ca', permissions: ['hrm.shift.read', 'hrm.shift.manage'] },
  ],
  '/payroll': [
    { id: 'runs', label: 'Bảng lương', permissions: ['hrm.payroll.read'] },
    { id: 'advances', label: 'Ứng và thu hồi', permissions: ['hrm.advance.read'] },
  ],
  '/settings': [
    { id: 'time', label: 'Công và thiết bị', permissions: ['hrm.time.configure', 'hrm.device.manage'] },
    { id: 'payroll', label: 'Lương', permissions: ['hrm.payroll.configure', 'hrm.salary.read', 'hrm.salary.manage'] },
    { id: 'leave', label: 'Phép năm và loại nghỉ', permissions: ['hrm.leave.manage'] },
    {
      id: 'operations',
      label: 'Vận hành và tích hợp',
      permissions: ['hrm.automation.manage', 'hrm.integration.manage', 'hrm.audit.read'],
    },
    { id: 'permissions', label: 'Quyền và vai trò', permissions: ['hrm.manage'] },
  ],
} as const satisfies Record<string, readonly HrmHubTabMeta[]>;

export type HrmHubPath = keyof typeof HRM_HUBS;

/** Quyền hiện trang chứa các tab = hợp quyền của các tab. */
export function hubPagePermissions(path: HrmHubPath): HrmAction[] {
  const tabs: readonly HrmHubTabMeta[] = HRM_HUBS[path];
  return [...new Set(tabs.flatMap((tab) => tab.permissions))];
}

/** Tab đang mở: `view` hợp lệ và được phép, nếu không thì tab đầu tiên được phép. */
export function resolveHubTab<T extends { id: string }>(
  tabs: readonly T[],
  view: string | null,
): T | undefined {
  return tabs.find((tab) => tab.id === view) ?? tabs[0];
}
