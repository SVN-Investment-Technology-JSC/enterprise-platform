import { TENANT_PERMISSION_ACTIONS } from './tenant-authorization.js';

/**
 * Bộ vai trò mẫu HRM (một nguồn dữ liệu duy nhất).
 * Bám bảng gợi ý ở docs/HRM-ERP114-chuc-nang-va-huong-dan.md mục 2.
 * Chỉ là dữ liệu: việc tạo vào tenant do TenantAuthorizationService.seedHrmRoleTemplates làm.
 */
/** Quyền cá nhân: mọi người làm việc trong công ty đều cần để dùng không gian cá nhân của chính mình. */
const SELF_ACTIONS = [
  'hrm.self.read',
  'hrm.self.profile.write',
  'hrm.self.attendance',
  'hrm.self.request',
  'hrm.self.payslip',
] as const;

export interface HrmRoleTemplate {
  /** Khóa ổn định, dùng sinh ID xác định để chạy lại không tạo trùng. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly actions: readonly string[];
}

export const HRM_ROLE_TEMPLATES: readonly HrmRoleTemplate[] = [
  {
    key: 'employee',
    name: 'HRM - Nhân viên',
    description: 'Xem và gửi đơn của bản thân, xem phiếu lương cá nhân.',
    actions: [...SELF_ACTIONS],
  },
  {
    key: 'department-head',
    name: 'HRM - Trưởng bộ phận',
    description:
      'Duyệt đơn phép, tăng ca, công tác, đổi ca và tạm ứng của cấp dưới (theo sơ đồ tổ chức). Không xem dữ liệu toàn công ty.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.leave.approve',
      'hrm.ot.approve',
      'hrm.trip.approve',
      'hrm.shift.approve',
      'hrm.advance.approve',
    ],
  },
  {
    key: 'hr-profile',
    name: 'HRM - Nhân sự (hồ sơ)',
    description: 'Quản lý hồ sơ nhân viên, liên kết tài khoản, người phụ thuộc.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.employee.read',
      'hrm.employee.manage',
      'hrm.employee.link-account',
      'hrm.appointment.read',
      'hrm.appointment.manage',
      'hrm.profile.approve',
      'hrm.profile.approve.all',
      'hrm.dependent.read',
      'hrm.dependent.manage',
    ],
  },
  {
    key: 'hr-head',
    name: 'HRM - Trưởng phòng nhân sự',
    description: 'Duyệt và áp dụng quyết định bổ nhiệm, điều chuyển; xem hồ sơ và lương.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.dashboard.read',
      'hrm.employee.read',
      'hrm.appointment.read',
      'hrm.appointment.approve',
      'hrm.salary.read',
    ],
  },
  {
    key: 'timekeeper',
    name: 'HRM - Chấm công viên',
    description: 'Điều phối ca, thiết bị, chấm công, phép và bảng công.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.shift.read',
      'hrm.shift.manage',
      'hrm.schedule.read',
      'hrm.schedule.manage',
      'hrm.schedule.bulk',
      'hrm.schedule.calendar',
      'hrm.time.configure',
      'hrm.device.manage',
      'hrm.attendance.read',
      'hrm.attendance.import',
      'hrm.attendance.approve',
      'hrm.attendance.approve.all',
      'hrm.leave.read',
      'hrm.leave.manage',
      'hrm.timesheet.read',
      'hrm.timesheet.calculate',
      'hrm.timesheet.adjust',
      'hrm.timesheet.export',
    ],
  },
  {
    key: 'comp-ben',
    name: 'HRM - C&B',
    description: 'Cấu hình lương, hồ sơ lương, tính lương và điều chỉnh.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.payroll.configure',
      'hrm.salary.read',
      'hrm.salary.manage',
      'hrm.employee.read',
      'hrm.dependent.read',
      'hrm.payroll.read',
      'hrm.payroll.calculate',
      'hrm.payroll.adjust',
    ],
  },
  {
    key: 'payroll-approver',
    name: 'HRM - Người chốt lương',
    description: 'Chốt và phát hành bảng lương; khóa công.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.timesheet.read',
      'hrm.timesheet.lock',
      'hrm.payroll.read',
      'hrm.payroll.finalize',
      'hrm.payroll.publish',
    ],
  },
  {
    key: 'payroll-accountant',
    name: 'HRM - Kế toán chi trả',
    description: 'Xuất bảng lương, chi trả lương và giải ngân ứng lương.',
    actions: [
      ...SELF_ACTIONS,
      'hrm.payroll.read',
      'hrm.payroll.export',
      'hrm.payroll.pay',
      'hrm.advance.read',
      'hrm.advance.disburse',
    ],
  },
  {
    key: 'hrm-admin',
    name: 'HRM - Quản trị HRM',
    description: 'Toàn quyền nghiệp vụ HRM trong tenant.',
    actions: ['hrm.manage', 'hrm.audit.read'],
  },
];

/** Trả danh sách tên vai trò mẫu chứa một hành động (theo khóa hành động). */
export function hrmTemplatesForAction(action: string): readonly string[] {
  return HRM_ROLE_TEMPLATES.filter((t) => t.actions.includes(action)).map(
    (t) => t.name,
  );
}

export function invalidHrmTemplateActions(): string[] {
  const valid = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));
  return HRM_ROLE_TEMPLATES.flatMap((t) =>
    t.actions.filter((a) => !valid.has(a)),
  );
}
