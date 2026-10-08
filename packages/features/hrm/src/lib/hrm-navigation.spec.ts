import {
  getActiveHrmNavId,
  hrmNavigation,
  hrmNavigationSections,
  resolveTimeSettingsTab,
  resolveLeaveSettingsTab,
  resolvePayrollSettingsTab,
} from './hrm-navigation';

describe('HRM navigation', () => {
  it('keeps unique leaf routes and selects only the most specific page', () => {
    expect(new Set(hrmNavigation.map((x) => x.id)).size).toBe(
      hrmNavigation.length,
    );
    expect(new Set(hrmNavigation.map((x) => x.href)).size).toBe(
      hrmNavigation.length,
    );
    expect(getActiveHrmNavId('/modules/hrm/payroll/settings/')).toBe(
      'payroll_settings',
    );
    expect(getActiveHrmNavId('/modules/hrm/payroll/advances')).toBe(
      'salary_advances',
    );
    expect(getActiveHrmNavId('/modules/hrm/policies?tab=devices')).toBe(
      'time_settings',
    );
    expect(
      hrmNavigation.some((item) => item.href === '/payroll/advances'),
    ).toBe(true);
    expect(getActiveHrmNavId('/modules/hrm/unknown')).toBe(null);
  });

  it('presents 1-level navigation routes without changing the leaf destinations', () => {
    const items = hrmNavigationSections.flatMap((section) => section.items);
    const itemIds = new Set(items.map((item) => item.id));
    const leafHrefs = new Set(hrmNavigation.map((item) => item.href));

    expect(itemIds.has('dashboard')).toBe(true);
    expect(itemIds.has('calendar')).toBe(true);
    expect(itemIds.has('attendance')).toBe(true);
    expect(itemIds.has('requests')).toBe(true);
    expect(itemIds.has('profile')).toBe(true);
    expect(itemIds.has('payslips')).toBe(true);
    expect(itemIds.has('employees')).toBe(true);
    expect(itemIds.has('dependents')).toBe(true);
    expect(itemIds.has('personnel_decisions')).toBe(true);
    expect(itemIds.has('shift_management')).toBe(true);
    expect(itemIds.has('request_processing')).toBe(true);
    expect(itemIds.has('timesheets')).toBe(true);
    expect(itemIds.has('payroll_payout')).toBe(true);
    expect(itemIds.has('salary_advances')).toBe(true);
    expect(itemIds.has('leave_settings')).toBe(true);
    expect(itemIds.has('time_settings')).toBe(true);
    expect(itemIds.has('payroll_settings')).toBe(true);
    expect(itemIds.has('operations')).toBe(true);
    expect(itemIds.has('permissions')).toBe(true);
    expect(leafHrefs).toEqual(
      new Set([
        '/',
        '/calendar',
        '/profile',
        '/attendance',
        '/requests',
        '/payslips',
        '/employees',
        '/dependents',
        '/personnel-decisions',
        '/shifts',
        '/approvals',
        '/timesheets',
        '/payroll',
        '/payroll/advances',
        '/leave-settings',
        '/policies',
        '/payroll/settings',
        '/operations',
        '/permissions',
      ]),
    );
  });

  it('does not show an unauthorized tab from a deep link', () => {
    expect(resolveTimeSettingsTab('unknown', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('rules', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('sites', ['rules', 'sites'])).toBe('sites');
    expect(resolveTimeSettingsTab('rules', [])).toBe('');

    expect(resolveLeaveSettingsTab('unknown', ['types', 'ledger'])).toBe('types');
    expect(resolveLeaveSettingsTab('schedules', ['types', 'ledger'])).toBe('types');
    expect(resolveLeaveSettingsTab('ledger', ['types', 'ledger'])).toBe('ledger');
    expect(resolveLeaveSettingsTab('types', [])).toBe('');

    expect(resolvePayrollSettingsTab('unknown', ['policies', 'inputs'])).toBe('policies');
    expect(resolvePayrollSettingsTab('other', ['inputs'])).toBe('inputs');
    expect(resolvePayrollSettingsTab('inputs', ['policies', 'inputs'])).toBe('inputs');
    expect(resolvePayrollSettingsTab('policies', [])).toBe('');
  });
});
