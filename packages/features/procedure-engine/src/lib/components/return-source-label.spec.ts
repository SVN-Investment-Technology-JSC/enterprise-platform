import { returnSourceLabel } from './return-source-label';

describe('returnSourceLabel (dải quay về khi mở hồ sơ kèm returnTo)', () => {
  it('theo phân hệ của đường dẫn quay về; không nhận ra thì Trang chủ', () => {
    expect(returnSourceLabel('/modules/crm#tasks')).toBe('Bán hàng');
    expect(returnSourceLabel('/modules/hrm#requests/1')).toBe('Nhân sự');
    expect(returnSourceLabel('/modules/finance')).toBe('Tài chính');
    expect(returnSourceLabel('/')).toBe('Trang chủ');
    expect(returnSourceLabel('/modules/unknown')).toBe('Trang chủ');
  });
});
