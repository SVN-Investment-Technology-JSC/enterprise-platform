import { expandTenantActions, HRM_ROLE_TEMPLATES } from '@enterprise-platform/contracts-identity';
import { filterHrmNavigation, hrmNavigation, hrmNavigationSections } from './hrm-navigation';
import { HRM_HUBS, type HrmHubPath } from './hrm-hub-tabs';
import { hrmPagePermissions } from './hrm-permissions';

const actionsOf = (...keys: string[]) =>
  expandTenantActions(keys.flatMap((k) => HRM_ROLE_TEMPLATES.find((t) => t.key === k)?.actions ?? []));

function visibleSections(actions: readonly string[]) {
  const any = (required: readonly string[]) => required.some((p) => actions.includes(p));
  return filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, any);
}
const visibleLabels = (actions: readonly string[]) =>
  visibleSections(actions).flatMap((s) => s.items).map((i) => i.label);
const visibleHrefs = (actions: readonly string[]) =>
  visibleSections(actions).flatMap((s) => s.items).map((i) => i.href);
const groupTitles = (actions: readonly string[]) => visibleSections(actions).map((s) => s.title);
/** Tab của một trang gộp mà người dùng thấy (trang không hiện trên menu thì không có tab nào). */
const visibleTabs = (actions: readonly string[], path: HrmHubPath) =>
  visibleHrefs(actions).includes(path)
    ? HRM_HUBS[path].filter((tab) => tab.permissions.some((p) => actions.includes(p))).map((tab) => tab.id as string)
    : [];

describe('HRM sidebar visibility per sample role', () => {
  it('a plain employee only sees OVERVIEW and PERSONAL groups', () => {
    const actions = actionsOf('employee');
    expect(groupTitles(actions)).toEqual(['TỔNG QUAN', 'CÁ NHÂN']);
    expect(visibleHrefs(actions)).toEqual(['/', '/my-work', '/requests', '/profile']);
    expect(visibleLabels(actions)).not.toContain('Giám sát chấm công');
    expect(visibleTabs(actions, '/my-work' as HrmHubPath)).toEqual(['timesheet']);
    expect(visibleTabs(actions, '/profile')).toEqual(['profile', 'payslips']);
  });

  it('a department head adds only the approval inbox', () => {
    const actions = actionsOf('department-head');
    const labels = visibleLabels(actions);
    expect(labels).toContain('Đơn từ cần xử lý');
    // Trưởng bộ phận theo dõi chấm công của cấp dưới (phạm vi do server giới hạn theo sơ đồ tổ chức).
    expect(labels).toContain('Giám sát chấm công');
    for (const hidden of ['Nhân sự', 'Bảng công', 'Phép năm', 'Lương và chi trả', 'Cấu hình']) expect(labels).not.toContain(hidden);
    // Quyền duyệt không kéo theo quyền đọc nào: trưởng bộ phận chỉ có không gian cá nhân và hộp đơn cần xử lý.
    expect(groupTitles(actions)).toEqual(['TỔNG QUAN', 'CÁ NHÂN']);
  });

  it('a timekeeper sees timesheets and attendance data, with schedules and shifts under settings, but no payroll', () => {
    const actions = actionsOf('timekeeper');
    expect(visibleTabs(actions, '/timekeeping')).toEqual(['timesheets', 'data']);
    expect(visibleLabels(actions)).toContain('Giám sát chấm công');
    expect(visibleTabs(actions, '/settings')).toEqual(expect.arrayContaining(['time', 'schedules', 'shifts']));
    expect(visibleTabs(actions, '/leave')).toContain('balances');
    expect(visibleTabs(actions, '/settings')).toContain('time');
    expect(visibleTabs(actions, '/settings')).not.toContain('payroll');
    expect(visibleTabs(actions, '/settings')).not.toContain('permissions');
    expect(visibleLabels(actions)).not.toContain('Lương và chi trả');
    expect(visibleTabs(actions, '/employees')).not.toContain('employees');
  });

  it('C&B sees payroll and salary configuration but not scheduling', () => {
    const actions = actionsOf('comp-ben');
    expect(visibleLabels(actions)).toContain('Lương và chi trả');
    expect(visibleTabs(actions, '/employees')).toContain('employees');
    expect(visibleTabs(actions, '/settings')).toContain('payroll');
    expect(visibleTabs(actions, '/settings')).not.toContain('permissions');
    expect(visibleTabs(actions, '/timekeeping')).not.toContain('data');
    expect(visibleTabs(actions, '/settings')).not.toContain('schedules');
  });

  it('HR profile staff see the HR tabs and the profile approval inbox but not payroll', () => {
    const actions = actionsOf('hr-profile');
    expect(visibleTabs(actions, '/employees')).toEqual(expect.arrayContaining(['employees', 'decisions']));
    expect(visibleLabels(actions)).toContain('Đơn từ cần xử lý');
    expect(visibleLabels(actions)).not.toContain('Lương và chi trả');
    expect(visibleTabs(actions, '/settings')).not.toContain('schedules');
    expect(visibleTabs(actions, '/settings')).not.toContain('permissions');
  });

  it('payroll roles see payroll tabs according to their permissions', () => {
    expect(visibleTabs(actionsOf('payroll-accountant'), '/payroll')).toEqual(['runs', 'advances']);
    const approver = actionsOf('payroll-approver');
    expect(visibleTabs(approver, '/payroll')).toContain('runs');
    expect(visibleTabs(approver, '/timekeeping')).toContain('timesheets');
    expect(visibleTabs(approver, '/settings')).not.toContain('payroll');
    const salaryOnly = expandTenantActions(['hrm.salary.read']);
    expect(visibleTabs(salaryOnly, '/settings')).toEqual(['payroll']);
    expect(visibleHrefs(salaryOnly)).not.toContain('/payroll');
  });

  it('the HRM administrator sees every menu item and every tab', () => {
    const admin = actionsOf('hrm-admin');
    expect(visibleHrefs(admin)).toEqual(hrmNavigation.map((i) => i.href));
    expect(groupTitles(admin)).toEqual(hrmNavigationSections.map((s) => s.title));
    for (const path of Object.keys(HRM_HUBS) as HrmHubPath[])
      expect(visibleTabs(admin, path)).toEqual(HRM_HUBS[path].map((t) => t.id));
  });

  it('permission and role administration is hidden from everyone except hrm.manage', () => {
    for (const key of ['employee', 'department-head', 'hr-profile', 'hr-head', 'timekeeper', 'comp-ben', 'payroll-approver', 'payroll-accountant'])
      expect(visibleTabs(actionsOf(key), '/settings')).not.toContain('permissions');
    expect(visibleTabs(expandTenantActions(['hrm.read']), '/settings')).not.toContain('permissions');
    expect(visibleTabs(expandTenantActions(['hrm.manage']), '/settings')).toContain('permissions');
  });

  it('the approval inbox opens for any approve or request-processing permission', () => {
    for (const key of [
      'hrm.leave.approve',
      'hrm.ot.approve.all',
      'hrm.trip.approve',
      'hrm.shift.approve',
      'hrm.attendance.approve',
      'hrm.profile.approve',
      'hrm.advance.approve',
      'hrm.request.read',
      'hrm.request.manage',
      'hrm.advance.read',
    ])
      expect(visibleHrefs(expandTenantActions([key]))).toContain('/approvals');
    expect(visibleHrefs(expandTenantActions(['hrm.self.read']))).not.toContain('/approvals');
  });

  it('the annual leave menu: balances need leave.read, settings leave needs leave.manage', () => {
    expect(visibleHrefs(expandTenantActions(['hrm.leave.approve']))).not.toContain('/leave');
    expect(visibleTabs(expandTenantActions(['hrm.leave.read']), '/leave')).toEqual(['balances']);
    const manage = expandTenantActions(['hrm.leave.manage']);
    expect(visibleTabs(manage, '/leave')).toEqual(['balances']);
    expect(visibleHrefs(manage)).toContain('/leave');
    for (const path of ['/employees'] as HrmHubPath[])
      for (const tab of HRM_HUBS[path]) expect(tab.id).not.toBe('leave');
  });
});

describe('request reasons and approval configuration tabs', () => {
  const settingsTabs = (actions: readonly string[]) => visibleTabs(actions, '/settings');

  it('keeps the settings tabs in the agreed order with the new labels', () => {
    expect(HRM_HUBS['/settings'].map((t) => [t.id, t.label])).toEqual([
      ['leave', 'Chính sách phép năm'],
      ['time', 'Công và thiết bị'],
      ['schedules', 'Phân ca'],
      ['shifts', 'Danh mục ca'],
      ['standard-work', 'Công chuẩn'],
      ['auto-attendance', 'Chấm công tự động'],
      ['payroll', 'Lương'],
      ['request-reasons', 'Loại đơn và lý do'],
      ['approval', 'Duyệt đơn'],
      ['operations', 'Vận hành và tích hợp'],
      ['permissions', 'Quyền và vai trò'],
    ]);
  });

  it('has no leftover request catalog tab from the previous design', () => {
    const ids = HRM_HUBS['/settings'].map((t) => t.id as string);
    expect(ids).not.toContain('request-catalog');
  });

  it('shows Loại đơn và lý do to hrm.leave.manage and hrm.manage only', () => {
    const tab = HRM_HUBS['/settings'].find((t) => t.id === 'request-reasons');
    expect(tab?.permissions).toEqual(['hrm.leave.manage']);
    expect(settingsTabs(expandTenantActions(['hrm.leave.manage']))).toContain('request-reasons');
    expect(settingsTabs(expandTenantActions(['hrm.manage']))).toContain('request-reasons');
    expect(settingsTabs(actionsOf('timekeeper'))).toContain('request-reasons');
    for (const key of ['hrm.leave.read', 'hrm.leave.approve', 'hrm.automation.manage', 'hrm.salary.manage'])
      expect(settingsTabs(expandTenantActions([key]))).not.toContain('request-reasons');
    expect(settingsTabs(actionsOf('employee'))).not.toContain('request-reasons');
  });

  it('shows Duyệt đơn to hrm.automation.manage and hrm.manage only', () => {
    const tab = HRM_HUBS['/settings'].find((t) => t.id === 'approval');
    expect(tab?.permissions).toEqual(['hrm.automation.manage']);
    expect(settingsTabs(expandTenantActions(['hrm.automation.manage']))).toContain('approval');
    expect(settingsTabs(expandTenantActions(['hrm.manage']))).toContain('approval');
    expect(settingsTabs(actionsOf('hrm-admin'))).toContain('approval');
    for (const key of ['hrm.leave.manage', 'hrm.integration.manage', 'hrm.audit.read', 'hrm.request.manage'])
      expect(settingsTabs(expandTenantActions([key]))).not.toContain('approval');
    for (const key of ['employee', 'department-head', 'hr-profile', 'hr-head', 'timekeeper', 'comp-ben'])
      expect(settingsTabs(actionsOf(key))).not.toContain('approval');
  });

  it('automation.manage alone opens the settings page with the approval tab and operations tab', () => {
    const actions = expandTenantActions(['hrm.automation.manage']);
    expect(visibleHrefs(actions)).toContain('/settings');
    expect(settingsTabs(actions)).toEqual(['approval', 'operations']);
  });
});

describe('hub pages', () => {
  it('page permission is exactly the union of its tab permissions', () => {
    for (const path of Object.keys(HRM_HUBS) as HrmHubPath[]) {
      const union = new Set<string>(HRM_HUBS[path].flatMap((t) => [...t.permissions]));
      expect(new Set(hrmPagePermissions[path])).toEqual(union);
    }
  });

  it('uses unique tab ids within a page', () => {
    for (const tabs of Object.values(HRM_HUBS)) {
      const ids: string[] = tabs.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('work schedule tab', () => {
  it('requires hrm.schedule.read and is implied by manage and bulk', () => {
    const tab = HRM_HUBS['/settings'].find((t) => t.id === 'schedules');
    expect(tab?.permissions).toEqual(['hrm.schedule.read']);
    for (const key of ['hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk'])
      expect(visibleTabs(expandTenantActions([key]), '/settings')).toContain('schedules');
    expect(visibleTabs(actionsOf('employee'), '/settings')).toEqual([]);
    expect(visibleTabs(expandTenantActions(['hrm.shift.read']), '/settings')).toEqual(['shifts']);
  });
});
