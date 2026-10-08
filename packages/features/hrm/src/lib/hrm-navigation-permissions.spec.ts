import {
  expandTenantActions,
  HRM_ROLE_TEMPLATES,
} from '@enterprise-platform/contracts-identity';
import { filterHrmNavigation, hrmNavigationSections } from './hrm-navigation';
import { hrmPagePermissions } from './hrm-permissions';

const actionsOf = (...keys: string[]) =>
  expandTenantActions(
    keys.flatMap((k) => HRM_ROLE_TEMPLATES.find((t) => t.key === k)?.actions ?? []),
  );

function visibleHrefs(actions: readonly string[]) {
  const any = (required: readonly string[]) =>
    required.some((p) => actions.includes(p));
  return filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, any)
    .flatMap((s) => s.items)
    .flatMap((i) => i.children ?? [i])
    .map((i) => i.href);
}
const payrollMenu = (actions: readonly string[]) =>
  filterHrmNavigation(
    hrmNavigationSections,
    hrmPagePermissions,
    (required) => required.some((p) => actions.includes(p)),
  )
    .flatMap((s) => s.items)
    .some((i) => i.id === 'payroll_payout' || i.id === 'salary_advances');

describe('HRM sidebar visibility per role', () => {
  it('hides payroll items from people without payroll/advance permissions', () => {
    for (const keys of [
      ['employee'],
      ['department-head'],
      ['hr-profile'], // hrm.employee.* but no hrm.salary.read / payroll
      ['timekeeper'],
    ])
      expect(payrollMenu(actionsOf(...keys))).toBe(false);
  });
  it('hides payroll pages when only hrm.salary.read is granted', () => {
    const hrefs = visibleHrefs(expandTenantActions(['hrm.salary.read']));
    expect(hrefs).not.toContain('/payroll');
    expect(hrefs).not.toContain('/payroll/settings');
    expect(hrefs).not.toContain('/payroll/advances');
  });
  it('shows payroll pages to roles that hold the matching permission', () => {
    expect(visibleHrefs(actionsOf('comp-ben'))).toEqual(
      expect.arrayContaining(['/payroll', '/payroll/settings']),
    );
    expect(visibleHrefs(actionsOf('payroll-accountant'))).toEqual(
      expect.arrayContaining(['/payroll', '/payroll/advances']),
    );
    expect(payrollMenu(actionsOf('hrm-admin'))).toBe(true);
  });
  it('a plain employee only sees personal pages and not management pages', () => {
    const hrefs = visibleHrefs(actionsOf('employee'));
    expect(hrefs).toEqual(
      expect.arrayContaining(['/', '/profile', '/payslips', '/requests']),
    );
    for (const hidden of ['/employees', '/payroll', '/timesheets', '/shifts', '/approvals'])
      expect(hrefs).not.toContain(hidden);
  });
});
