import { availableTabs, resolveTab, tabAfterKey } from './detail-tabs';

describe('detail tabs', () => {
  it('người không phải quản trị chỉ thấy Tổng quan', () => {
    expect(availableTabs({ isAdmin: false })).toEqual(['overview']);
  });

  it('quản trị thấy đủ ba tab theo thứ tự', () => {
    expect(availableTabs({ isAdmin: true })).toEqual([
      'overview',
      'access',
      'history',
    ]);
  });

  it('resolveTab về Tổng quan khi tham số lạ hoặc tab không được phép', () => {
    const tabs = availableTabs({ isAdmin: false });
    expect(resolveTab('history', tabs)).toBe('overview');
    expect(resolveTab('profile', tabs)).toBe('overview');
    expect(resolveTab('abc', tabs)).toBe('overview');
    expect(resolveTab(null, tabs)).toBe('overview');
    expect(resolveTab('access', ['overview', 'access'])).toBe('access');
  });

  it('tabAfterKey xoay vòng và hỗ trợ Home, End', () => {
    const tabs = availableTabs({ isAdmin: true });
    expect(tabAfterKey('history', tabs, 'ArrowRight')).toBe('overview');
    expect(tabAfterKey('overview', tabs, 'ArrowLeft')).toBe('history');
    expect(tabAfterKey('access', tabs, 'End')).toBe('history');
    expect(tabAfterKey('access', tabs, 'Home')).toBe('overview');
    expect(tabAfterKey('access', tabs, 'a')).toBeUndefined();
  });
});
