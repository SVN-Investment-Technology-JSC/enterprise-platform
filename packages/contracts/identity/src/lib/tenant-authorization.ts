/** Supported application actions; tenant admins compose these into permissions. */
export const HRM_PERMISSION_ACTIONS = [
  {
    key: 'hrm.self.read',
    group: 'HRM · Cá nhân',
    label: 'Xem hồ sơ, công và đơn của bản thân',
  },
  {
    key: 'hrm.self.profile.write',
    group: 'HRM · Cá nhân',
    label: 'Cập nhật thông tin cá nhân cho phép',
  },
  {
    key: 'hrm.self.attendance',
    group: 'HRM · Cá nhân',
    label: 'Chấm công và đăng ký trình duyệt cá nhân',
  },
  {
    key: 'hrm.self.request',
    group: 'HRM · Cá nhân',
    label: 'Gửi, sửa và rút đơn cá nhân',
  },
  {
    key: 'hrm.self.payslip',
    group: 'HRM · Cá nhân',
    label: 'Xem phiếu lương của bản thân',
  },
  {
    key: 'hrm.employee.read',
    group: 'HRM · Nhân sự',
    label: 'Xem hồ sơ nhân viên toàn tenant',
  },
  {
    key: 'hrm.employee.manage',
    group: 'HRM · Nhân sự',
    label: 'Tạo và sửa hồ sơ, chức danh',
  },
  {
    key: 'hrm.employee.sensitive',
    group: 'HRM · Nhân sự',
    label: 'Xem CCCD, mã số thuế, BHXH, tài khoản ngân hàng của nhân viên',
  },
  {
    key: 'hrm.employee.link-account',
    group: 'HRM · Nhân sự',
    label: 'Liên kết nhân viên với tài khoản',
  },
  {
    key: 'hrm.appointment.read',
    group: 'HRM · Nhân sự',
    label: 'Xem quyết định bổ nhiệm, điều chuyển toàn tenant',
  },
  {
    key: 'hrm.appointment.manage',
    group: 'HRM · Nhân sự',
    label: 'Lập, sửa và hủy quyết định nhân sự',
  },
  {
    key: 'hrm.appointment.approve',
    group: 'HRM · Nhân sự',
    label: 'Duyệt và áp dụng quyết định nhân sự',
  },
  {
    key: 'hrm.dashboard.read',
    group: 'HRM · Báo cáo',
    label: 'Xem tổng quan nhân sự toàn tenant',
  },
  {
    key: 'hrm.shift.read',
    group: 'HRM · Ca và công',
    label: 'Xem danh mục ca làm việc',
  },
  {
    key: 'hrm.shift.manage',
    group: 'HRM · Ca và công',
    label: 'Cấu hình danh mục ca làm việc',
  },
  {
    key: 'hrm.schedule.read',
    group: 'HRM · Ca và công',
    label: 'Xem lịch phân ca làm việc',
  },
  {
    key: 'hrm.schedule.manage',
    group: 'HRM · Ca và công',
    label: 'Tạo, gán, sửa và huỷ lịch phân ca; quản lý mẫu lịch tuần',
  },
  {
    key: 'hrm.schedule.bulk',
    group: 'HRM · Ca và công',
    label: 'Phân ca hàng loạt theo nhóm, phòng ban và toàn công ty',
  },
  {
    key: 'hrm.schedule.calendar',
    group: 'HRM · Ca và công',
    label: 'Quản lý lịch lễ, Tết và lịch ngoại lệ',
  },
  {
    key: 'hrm.shift.approve',
    group: 'HRM · Ca và công',
    label: 'Duyệt đổi ca',
  },
  {
    key: 'hrm.shift.approve.all',
    group: 'HRM · Ca và công',
    label: 'Duyệt đổi ca toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.attendance.read',
    group: 'HRM · Ca và công',
    label: 'Xem công toàn tenant',
  },
  {
    key: 'hrm.attendance.import',
    group: 'HRM · Ca và công',
    label: 'Nhập sự kiện từ máy chấm công',
  },
  {
    key: 'hrm.attendance.approve',
    group: 'HRM · Ca và công',
    label: 'Duyệt và xử lý giải trình công',
  },
  {
    key: 'hrm.attendance.approve.all',
    group: 'HRM · Ca và công',
    label: 'Duyệt giải trình công toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.time.configure',
    group: 'HRM · Ca và công',
    label: 'Cấu hình công, IP, GPS, lịch nghỉ',
  },
  {
    key: 'hrm.device.manage',
    group: 'HRM · Ca và công',
    label: 'Duyệt và thu hồi trình duyệt chấm công',
  },
  {
    key: 'hrm.leave.read',
    group: 'HRM · Phép và đơn',
    label: 'Xem quỹ phép và sổ phép toàn tenant',
  },
  {
    key: 'hrm.leave.manage',
    group: 'HRM · Phép và đơn',
    label: 'Cấu hình, tích, chuyển và điều chỉnh quỹ phép',
  },
  {
    key: 'hrm.request.read',
    group: 'HRM · Phép và đơn',
    label: 'Xem đơn nghiệp vụ toàn tenant',
  },
  {
    key: 'hrm.request.manage',
    group: 'HRM · Phép và đơn',
    label: 'Tạo đơn thay nhân viên',
  },
  {
    key: 'hrm.leave.approve',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt, từ chối và đảo đơn nghỉ',
  },
  {
    key: 'hrm.leave.approve.all',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt đơn nghỉ toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.ot.approve',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt và xử lý tăng ca',
  },
  {
    key: 'hrm.ot.approve.all',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt tăng ca toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.trip.approve',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt và xử lý công tác',
  },
  {
    key: 'hrm.trip.approve.all',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt công tác toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.profile.approve',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt thay đổi hồ sơ',
  },
  {
    key: 'hrm.profile.approve.all',
    group: 'HRM · Phép và đơn',
    label: 'Duyệt thay đổi hồ sơ toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.advance.read',
    group: 'HRM · Tạm ứng',
    label: 'Xem tạm ứng toàn tenant',
  },
  {
    key: 'hrm.advance.approve',
    group: 'HRM · Tạm ứng',
    label: 'Duyệt tạm ứng',
  },
  {
    key: 'hrm.advance.approve.all',
    group: 'HRM · Tạm ứng',
    label: 'Duyệt tạm ứng toàn tenant (không giới hạn phạm vi đơn vị)',
  },
  {
    key: 'hrm.advance.disburse',
    group: 'HRM · Tạm ứng',
    label: 'Giải ngân và lập lịch thu hồi ứng',
  },
  {
    key: 'hrm.timesheet.read',
    group: 'HRM · Bảng công',
    label: 'Xem bảng công tổng hợp',
  },
  {
    key: 'hrm.timesheet.calculate',
    group: 'HRM · Bảng công',
    label: 'Tạo kỳ và tính bảng công',
  },
  {
    key: 'hrm.timesheet.adjust',
    group: 'HRM · Bảng công',
    label: 'Điều chỉnh bảng công',
  },
  {
    key: 'hrm.timesheet.lock',
    group: 'HRM · Bảng công',
    label: 'Khóa bảng công',
  },
  {
    key: 'hrm.timesheet.reopen',
    group: 'HRM · Bảng công',
    label: 'Mở lại bảng công',
  },
  {
    key: 'hrm.timesheet.export',
    group: 'HRM · Bảng công',
    label: 'Xuất bảng công',
  },
  {
    key: 'hrm.salary.read',
    group: 'HRM · Tiền lương',
    label: 'Xem ngạch bậc và mức lương nhân viên',
  },
  {
    key: 'hrm.salary.manage',
    group: 'HRM · Tiền lương',
    label: 'Quản lý mức lương và ngạch bậc',
  },
  {
    key: 'hrm.dependent.read',
    group: 'HRM · Tiền lương',
    label: 'Xem hồ sơ người phụ thuộc toàn tenant',
  },
  {
    key: 'hrm.dependent.manage',
    group: 'HRM · Tiền lương',
    label: 'Ghi nhận và kết thúc đăng ký người phụ thuộc',
  },
  {
    key: 'hrm.payroll.read',
    group: 'HRM · Tiền lương',
    label: 'Xem bảng lương toàn tenant',
  },
  {
    key: 'hrm.payroll.configure',
    group: 'HRM · Tiền lương',
    label: 'Cấu hình công thức, thuế, bảo hiểm và tham số',
  },
  {
    key: 'hrm.payroll.calculate',
    group: 'HRM · Tiền lương',
    label: 'Tạo kỳ và tính lương',
  },
  {
    key: 'hrm.payroll.adjust',
    group: 'HRM · Tiền lương',
    label: 'Điều chỉnh thu nhập và khấu trừ',
  },
  {
    key: 'hrm.payroll.finalize',
    group: 'HRM · Tiền lương',
    label: 'Chốt lương và thu hồi tạm ứng',
  },
  {
    key: 'hrm.payroll.publish',
    group: 'HRM · Tiền lương',
    label: 'Phát hành phiếu lương',
  },
  {
    key: 'hrm.payroll.pay',
    group: 'HRM · Tiền lương',
    label: 'Ghi nhận chi trả',
  },
  {
    key: 'hrm.payroll.export',
    group: 'HRM · Tiền lương',
    label: 'Xuất dữ liệu thanh toán và đối soát',
  },
  {
    key: 'hrm.automation.manage',
    group: 'HRM · Vận hành HRM',
    label: 'Cấu hình lịch chạy tích phép',
  },
  {
    key: 'hrm.integration.manage',
    group: 'HRM · Vận hành HRM',
    label: 'Cấu hình kết nối và theo dõi tích hợp',
  },
  {
    key: 'hrm.audit.read',
    group: 'HRM · Vận hành HRM',
    label: 'Xem nhật ký nghiệp vụ',
  },
  {
    key: 'hrm.read',
    group: 'HRM · Truy cập',
    label: 'Vào HRM và xem danh mục dùng chung',
  },
  {
    key: 'hrm.manage',
    group: 'HRM · Quản trị',
    label: 'Toàn quyền nghiệp vụ HRM trong tenant',
  },
] as const;
export type HrmAction = (typeof HRM_PERMISSION_ACTIONS)[number]['key'];

export const TENANT_PERMISSION_ACTIONS = [
  ...HRM_PERMISSION_ACTIONS,
  { key: 'inventory.read', group: 'Inventory', label: 'Xem kho và tài sản' },
  {
    key: 'inventory.manage',
    group: 'Inventory',
    label: 'Quản lý kho, tài sản và cấu hình (bao gồm giao dịch)',
  },
  {
    key: 'inventory.transaction.write',
    group: 'Inventory',
    label: 'Nhập, xuất, chuyển kho và giữ chỗ',
  },
  {
    key: 'inventory.stocktake.create',
    group: 'Inventory',
    label: 'Tạo đợt kiểm kê, nhập số đếm và gửi duyệt',
  },
  {
    key: 'inventory.stocktake.approve',
    group: 'Inventory',
    label: 'Duyệt và ghi sổ kiểm kê kho',
  },
  {
    key: 'maintenance.read',
    group: 'Maintenance',
    label: 'Xem lịch và hồ sơ bảo trì',
  },
  {
    key: 'maintenance.manage',
    group: 'Maintenance',
    label: 'Quản lý lịch và cấu hình bảo trì (bao gồm xử lý đợt)',
  },
  {
    key: 'maintenance.occurrence.manage',
    group: 'Maintenance',
    label: 'Xử lý đợt bảo trì',
  },
  {
    key: 'procedure.definition.manage',
    group: 'Procedure Engine',
    label: 'Thiết kế quy trình, phân vai RACI và cấu hình',
  },
  {
    key: 'procedure.definition.publish',
    group: 'Procedure Engine',
    label: 'Công bố và lưu trữ quy trình',
  },
  {
    key: 'procedure.instance.create',
    group: 'Procedure Engine',
    label: 'Khởi tạo hồ sơ (vẫn kiểm tra vai S)',
  },
  {
    key: 'procedure.instance.override',
    group: 'Procedure Engine',
    label: 'Can thiệp hồ sơ vượt phân vai RACI, xóa hồ sơ',
  },
  { key: 'core.users.read', group: 'Người dùng', label: 'Xem người dùng' },
  { key: 'core.users.create', group: 'Người dùng', label: 'Tạo người dùng' },
  { key: 'core.users.update', group: 'Người dùng', label: 'Sửa người dùng' },
  { key: 'core.users.delete', group: 'Người dùng', label: 'Xóa người dùng' },
  { key: 'core.organization.read', group: 'Tổ chức', label: 'Xem tổ chức' },
  {
    key: 'core.organization.create',
    group: 'Tổ chức',
    label: 'Tạo dữ liệu tổ chức',
  },
  {
    key: 'core.organization.update',
    group: 'Tổ chức',
    label: 'Sửa dữ liệu tổ chức',
  },
  {
    key: 'core.organization.delete',
    group: 'Tổ chức',
    label: 'Xóa dữ liệu tổ chức',
  },
  { key: 'workspace.read', group: 'Workspace', label: 'Xem dự án, công việc và tài liệu' },
  { key: 'workspace.manage', group: 'Workspace', label: 'Quản trị dự án, công việc và tài liệu' },
  { key: 'workspace.task.write', group: 'Workspace', label: 'Ghi dự án và công việc' },
  { key: 'workspace.document.write', group: 'Workspace', label: 'Ghi tài liệu' },
  { key: 'workspace.document.delete', group: 'Workspace', label: 'Xoá và lưu trữ tài liệu' },
  { key: 'workspace.project.create', group: 'Workspace', label: 'Tạo dự án mới' },
] as const;
export type TenantAction = (typeof TENANT_PERMISSION_ACTIONS)[number]['key'];
export interface TenantPermission {
  id: string;
  name: string;
  description: string;
  actionKeys: string[];
  roleIds: string[];
}
export interface TenantRole {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionIds: string[];
  moduleKeys: string[];
  userIds: string[];
}
export interface TenantAuthorization {
  roles: string[];
  permissions: string[];
  moduleKeys: string[];
  authorizationRevision: string;
}
export function hasTenantAction(
  permissions: readonly string[],
  action: TenantAction,
): boolean {
  return permissions.includes('tenant.manage') || permissions.includes(action);
}

/** Management includes operational rights, never module admission. */
export function expandTenantActions(actions: readonly string[]): string[] {
  const effective = new Set(actions);
  if (effective.has('inventory.manage')) {
    effective.add('inventory.read');
    effective.add('inventory.transaction.write');
    effective.add('inventory.stocktake.create');
    effective.add('inventory.stocktake.approve');
  }
  if (effective.has('maintenance.manage')) {
    effective.add('maintenance.read');
    effective.add('maintenance.occurrence.manage');
  }
  if (effective.has('hrm.manage'))
    for (const item of HRM_PERMISSION_ACTIONS) effective.add(item.key);
  for (const action of [...effective]) {
    if (!action.startsWith('hrm.')) continue;
    effective.add('hrm.read');
    if (action.startsWith('hrm.self.')) effective.add('hrm.self.read');
    const reads: Record<string, string[]> = {
      'hrm.employee.manage': ['hrm.employee.read', 'hrm.employee.sensitive'],
      'hrm.employee.sensitive': ['hrm.employee.read'],
      'hrm.employee.link-account': ['hrm.employee.read'],
      'hrm.appointment.manage': ['hrm.appointment.read', 'hrm.employee.read'],
      'hrm.appointment.approve': ['hrm.appointment.read', 'hrm.employee.read'],
      'hrm.shift.manage': ['hrm.shift.read'],
      'hrm.schedule.manage': ['hrm.schedule.read'],
      'hrm.schedule.bulk': ['hrm.schedule.manage', 'hrm.schedule.read'],
      'hrm.schedule.calendar': ['hrm.schedule.read'],
      // Quyền duyệt chỉ cho xử lý đơn thuộc phạm vi của người duyệt; KHÔNG kéo theo quyền đọc toàn tenant
      // (hrm.request.read, hrm.attendance.read, hrm.leave.read): những quyền đó phải được cấp riêng.
      'hrm.shift.approve.all': ['hrm.shift.approve'],
      'hrm.attendance.approve.all': ['hrm.attendance.approve'],
      'hrm.attendance.import': ['hrm.attendance.read'],
      'hrm.leave.manage': ['hrm.leave.read'],
      'hrm.leave.approve.all': ['hrm.leave.approve'],
      'hrm.ot.approve.all': ['hrm.ot.approve'],
      'hrm.trip.approve.all': ['hrm.trip.approve'],
      'hrm.profile.approve.all': ['hrm.profile.approve'],
      'hrm.advance.approve.all': ['hrm.advance.approve'],
      'hrm.advance.disburse': ['hrm.advance.read'],
      'hrm.salary.manage': ['hrm.salary.read'],
      'hrm.dependent.manage': ['hrm.dependent.read'],
    };
    for (const read of reads[action] || []) effective.add(read);
    if (action.startsWith('hrm.timesheet.'))
      effective.add('hrm.timesheet.read');
    if (action === 'hrm.payroll.calculate') effective.add('hrm.timesheet.read');
    if (action.startsWith('hrm.payroll.') && action !== 'hrm.payroll.configure')
      effective.add('hrm.payroll.read');
  }
  return [...effective];
}
