import { SETTINGS_GROUPS, settingsTab } from './crm-settings';

describe('Nhóm mục của trang Cấu hình', () => {
  it('chia 3 nhóm, đủ 10 mục, mỗi mục một lần', () => {
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Chung', 'Giá và khuyến mãi', 'Báo giá']);
    const ids = SETTINGS_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      ['approval', 'discount-policies', 'document-types', 'general', 'pipelines', 'price-lists', 'promotions', 'quote-forms', 'quote-preview', 'sales-organizations'].sort(),
    );
  });

  it('đường dẫn cũ vẫn mở đúng mục; lạ thì về mục chung', () => {
    expect(settingsTab('quote-forms')).toBe('quote-forms');
    expect(settingsTab('promotions')).toBe('promotions');
    expect(settingsTab('khong-co')).toBe('general');
    expect(settingsTab(undefined)).toBe('general');
  });
});
