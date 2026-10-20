import { availableTabs, resolveTab, tabAfterKey } from './detail-tabs';

describe('detail tabs', () => {
  it('người không phải quản trị chỉ thấy Tổng quan (và Hồ sơ nếu có quyền xem tổ chức)', () => {
    expect(
      availableTabs({ isAdmin: false, canReadOrganization: false }),
    ).toEqual(['overview']);
    expect(
      availableTabs({ isAdmin: false, canReadOrganization: true }),
    ).toEqual(['overview', 'profile']);
  });

  it('quản trị thấy đủ bốn tab theo thứ tự', () => {
    expect(availableTabs({ isAdmin: true, canReadOrganization: true })).toEqual(
      ['overview', 'access', 'profile', 'history'],
    );
  });

  it('resolveTab về Tổng quan khi tham số lạ hoặc tab không được phép', () => {
    const tabs = availableTabs({ isAdmin: false, canReadOrganization: false });
    expect(resolveTab('history', tabs)).toBe('overview');
    expect(resolveTab('abc', tabs)).toBe('overview');
    expect(resolveTab(null, tabs)).toBe('overview');
    expect(resolveTab('access', ['overview', 'access'])).toBe('access');
  });

  it('tabAfterKey xoay vòng và hỗ trợ Home, End', () => {
    const tabs = availableTabs({ isAdmin: true, canReadOrganization: true });
    expect(tabAfterKey('history', tabs, 'ArrowRight')).toBe('overview');
    expect(tabAfterKey('overview', tabs, 'ArrowLeft')).toBe('history');
    expect(tabAfterKey('access', tabs, 'End')).toBe('history');
    expect(tabAfterKey('access', tabs, 'Home')).toBe('overview');
    expect(tabAfterKey('access', tabs, 'a')).toBeUndefined();
  });
});
