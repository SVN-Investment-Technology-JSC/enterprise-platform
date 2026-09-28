import {
  getActiveHrmNavId,
  hrmNavigation,
  hrmNavigationSections,
  resolveTimeSettingsTab,
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

  it('groups related routes without changing the existing leaf destinations', () => {
    const groups = hrmNavigationSections.flatMap((section) => section.items);
    const groupedIds = new Set(groups.map((item) => item.id));
    const leafHrefs = new Set(hrmNavigation.map((item) => item.href));

    expect(groupedIds.has('personal_work')).toBe(true);
    expect(groupedIds.has('personal_profile_income')).toBe(true);
    expect(groupedIds.has('workforce_records')).toBe(true);
    expect(groupedIds.has('time_and_requests')).toBe(true);
    expect(groupedIds.has('payroll_operations')).toBe(true);
    expect(groupedIds.has('hrm_configuration')).toBe(true);
    expect(groupedIds.has('system_integration')).toBe(true);
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
  });
});
