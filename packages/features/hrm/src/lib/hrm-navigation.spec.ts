import {
  PAYROLL_SETTINGS_TABS,
  filterHrmNavigation,
  getActiveHrmNavId,
  hrmNavigation,
  hrmNavigationSections,
  hrmPageTitle,
  resolvePayrollSettingsTab,
  resolveTimeSettingsTab,
  sectionContainsNav,
} from './hrm-navigation';
import { hrmPagePermissions } from './hrm-permissions';
import { resolveHubTab } from './hrm-hub-tabs';

describe('HRM navigation', () => {
  it('keeps unique leaf routes and selects only the most specific page', () => {
    expect(new Set(hrmNavigation.map((x) => x.id)).size).toBe(hrmNavigation.length);
    expect(new Set(hrmNavigation.map((x) => x.href)).size).toBe(hrmNavigation.length);
    expect(getActiveHrmNavId('/modules/hrm/payroll?view=advances')).toBe('payroll');
    expect(getActiveHrmNavId('/modules/hrm/settings/')).toBe('settings');
    expect(getActiveHrmNavId('/modules/hrm/my-work')).toBe('my_work');
    expect(getActiveHrmNavId('/modules/hrm/timekeeping')).toBe('timekeeping');
    expect(getActiveHrmNavId('/modules/hrm/employees')).toBe('people');
    expect(getActiveHrmNavId('/modules/hrm/approvals')).toBe('request_processing');
    expect(getActiveHrmNavId('/modules/hrm/unknown')).toBe(null);
  });

  it('uses the agreed groups and short labels', () => {
    const view = hrmNavigationSections.map((s) => [s.title, s.items.map((i) => `${i.label} ${i.href}`)]);
    expect(view).toEqual([
      ['TỔNG QUAN', ['Bàn làm việc /', 'Đơn từ cần xử lý /approvals']],
      ['CÁ NHÂN', ['Công của tôi /my-work', 'Đơn từ của tôi /requests', 'Hồ sơ và lương /profile']],
      ['QUẢN LÝ', ['Nhân sự /employees', 'Chấm công và ca /timekeeping', 'Lương và chi trả /payroll']],
      ['HỆ THỐNG', ['Cấu hình /settings']],
    ]);
  });

  it('has a permission rule for every menu route and never uses hrm.read', () => {
    for (const item of hrmNavigation) {
      expect(hrmPagePermissions[item.href as string]).toBeDefined();
      expect(hrmPagePermissions[item.href as string].length).toBeGreaterThan(0);
    }
    for (const list of Object.values(hrmPagePermissions)) expect(list).not.toContain('hrm.read');
    expect(Object.keys(hrmPagePermissions).sort()).toEqual(
      hrmNavigation.map((i) => i.href as string).sort(),
    );
  });

  it('titles pages from the menu labels and hides empty groups', () => {
    expect(hrmPageTitle('/modules/hrm/my-work')).toBe('Công của tôi');
    expect(hrmPageTitle('/profile')).toBe('Hồ sơ và lương');
    expect(hrmPageTitle('/nowhere')).toBeUndefined();
    const onlySelf = filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, (p) =>
      p.includes('hrm.self.read'),
    );
    expect(onlySelf.map((s) => s.title)).toEqual(['TỔNG QUAN', 'CÁ NHÂN']);
    expect(filterHrmNavigation(hrmNavigationSections, hrmPagePermissions, () => false)).toEqual([]);
  });

  it('marks the group of the current page as always open', () => {
    const section = (title: string) => {
      const found = hrmNavigationSections.find((s) => s.title === title);
      if (!found) throw new Error(title);
      return found;
    };
    expect(sectionContainsNav(section('CÁ NHÂN'), 'requests')).toBe(true);
    expect(sectionContainsNav(section('HỆ THỐNG'), 'requests')).toBe(false);
    expect(sectionContainsNav(section('HỆ THỐNG'), null)).toBe(false);
  });

  it('opens the requested hub tab only when allowed, else the first allowed one', () => {
    const tabs = [{ id: 'a' }, { id: 'b' }];
    expect(resolveHubTab(tabs, 'b')?.id).toBe('b');
    expect(resolveHubTab(tabs, 'zzz')?.id).toBe('a');
    expect(resolveHubTab(tabs, null)?.id).toBe('a');
    expect(resolveHubTab([], 'a')).toBeUndefined();
  });

  it('does not show an unauthorized tab from a deep link', () => {
    expect(resolveTimeSettingsTab('unknown', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('rules', ['devices'])).toBe('devices');
    expect(resolveTimeSettingsTab('sites', ['rules', 'sites'])).toBe('sites');
    expect(resolveTimeSettingsTab('rules', [])).toBe('');

    expect(resolvePayrollSettingsTab('unknown', ['formula', 'sod'])).toBe('formula');
    expect(resolvePayrollSettingsTab('formula', ['grades', 'profiles'])).toBe('grades');
    expect(resolvePayrollSettingsTab('profiles', ['grades', 'profiles'])).toBe('profiles');
    expect(resolvePayrollSettingsTab('sod', [])).toBe('');
    expect(PAYROLL_SETTINGS_TABS.map((t) => t.id)).toEqual([
      'formula',
      'employee-params',
      'grades',
      'profiles',
      'sod',
    ]);
  });
});
