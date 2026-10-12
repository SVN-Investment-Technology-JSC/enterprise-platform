import { HRM_HUBS } from './hrm-hub-tabs';
import {
  ALL_SETTINGS_ENTRIES,
  SETTINGS_GROUPS,
  filterSettingsEntries,
  resolveSettingsEntry,
  settingsEntryQuery,
} from './hrm-settings-nav';

describe('hrm-settings-nav', () => {
  it('mọi mục trỏ tới một tab có thật của trang gộp /settings và id mục là duy nhất', () => {
    const views = new Set<string>(HRM_HUBS['/settings'].map((t) => t.id));
    for (const entry of ALL_SETTINGS_ENTRIES) expect(views.has(entry.view)).toBe(true);
    expect(new Set(ALL_SETTINGS_ENTRIES.map((e) => e.id)).size).toBe(ALL_SETTINGS_ENTRIES.length);
  });

  it('mọi tab của trang gộp /settings đều có ít nhất một mục trong nhóm chức năng', () => {
    const covered = new Set(ALL_SETTINGS_ENTRIES.map((e) => e.view));
    for (const tab of HRM_HUBS['/settings']) expect(covered.has(tab.id)).toBe(true);
  });

  it('Lý do nghỉ là lý do của loại đơn Đơn xin nghỉ (trong Loại đơn & lý do), không còn nằm trong nhóm nghỉ phép', () => {
    const leave = SETTINGS_GROUPS.find((g) => g.id === 'leave');
    const request = SETTINGS_GROUPS.find((g) => g.id === 'request');
    expect(leave?.entries.map((e) => e.id)).toEqual(['leave-policy']);
    expect(request?.entries.map((e) => e.id)).toEqual(['request-reasons', 'approval']);
  });

  it('gom theo chức năng: nghỉ phép, chấm công, lịch làm việc, đơn từ, lương, hệ thống', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['leave', 'time', 'schedule', 'request', 'payroll', 'system']);
  });

  it('đường dẫn mục có view và tab con nếu có', () => {
    const policy = ALL_SETTINGS_ENTRIES.find((e) => e.id === 'leave-policy');
    const shifts = ALL_SETTINGS_ENTRIES.find((e) => e.id === 'shifts');
    expect(policy && settingsEntryQuery(policy)).toBe('?view=leave');
    const sites = ALL_SETTINGS_ENTRIES.find((e) => e.id === 'time-sites');
    expect(sites && settingsEntryQuery(sites)).toBe('?view=time&tab=sites');
    expect(shifts && settingsEntryQuery(shifts)).toBe('?view=shifts');
  });

  it('lọc không dấu theo tên, mô tả và tên nhóm', () => {
    expect(filterSettingsEntries(ALL_SETTINGS_ENTRIES, 'phan ca').map((e) => e.id)).toContain('schedules');
    expect(filterSettingsEntries(ALL_SETTINGS_ENTRIES, 'LUONG').map((e) => e.id)).toContain('payroll');
    expect(filterSettingsEntries(ALL_SETTINGS_ENTRIES, 'cham cong').map((e) => e.id)).toEqual(
      expect.arrayContaining(['time-rules', 'time-devices']),
    );
    expect(filterSettingsEntries(ALL_SETTINGS_ENTRIES, '  ')).toHaveLength(ALL_SETTINGS_ENTRIES.length);
    expect(filterSettingsEntries(ALL_SETTINGS_ENTRIES, 'khong co gi nhu the')).toEqual([]);
  });

  it('mục đang mở: đúng view và tab; tab lạ hoặc thiếu lấy mục đầu của view; không có view là tổng quan', () => {
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'time', 'sites')?.id).toBe('time-sites');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'time', 'xyz')?.id).toBe('time-rules');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'leave', null)?.id).toBe('leave-policy');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'leave', 'periodic')?.id).toBe('leave-policy');
    // Liên kết cũ: lý do nghỉ từng là tab của màn phép năm rồi một màn riêng; nay nằm trong Loại đơn & lý do.
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'leave-reasons', null)?.id).toBe('request-reasons');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'leave', 'reasons')?.id).toBe('request-reasons');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'payroll', null)?.id).toBe('payroll');
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, null, null)).toBeUndefined();
    expect(resolveSettingsEntry(ALL_SETTINGS_ENTRIES, 'unknown', null)).toBeUndefined();
  });
});
