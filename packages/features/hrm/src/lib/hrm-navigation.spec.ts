import {
  getActiveHrmNavId,
  hrmNavigation,
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

  it('does not show an unauthorized tab from a deep link', () => {
    expect(resolveTimeSettingsTab('unknown', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('rules', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('sites', ['rules', 'sites'])).toBe('sites');
    expect(resolveTimeSettingsTab('rules', [])).toBe('');
  });
});
