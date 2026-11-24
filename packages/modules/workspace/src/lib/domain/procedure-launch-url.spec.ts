import { PROCEDURE_LAUNCH_URL, procedureLaunchUrl, resolveLaunchUrl } from './workspace-procedure-link.js';

describe('đường mở hồ sơ quy trình', () => {
  it('chỉ tới đúng hồ sơ khi có mã hồ sơ, không thì về danh sách', () => {
    expect(procedureLaunchUrl('abc-1')).toBe('/modules/procedure#workspace/abc-1');
    expect(procedureLaunchUrl(undefined)).toBe(PROCEDURE_LAUNCH_URL);
    expect(procedureLaunchUrl('a/b')).toBe('/modules/procedure#workspace/a%2Fb');
  });

  it('đường chung đã lưu từ trước được ghép thêm mã hồ sơ khi đọc', () => {
    expect(resolveLaunchUrl('procedure-engine', 'abc-1', PROCEDURE_LAUNCH_URL)).toBe('/modules/procedure#workspace/abc-1');
  });

  it('đường đã chỉ tới hồ sơ hay của module khác giữ nguyên', () => {
    expect(resolveLaunchUrl('procedure-engine', 'abc-1', '/modules/procedure#workspace/xyz')).toBe(
      '/modules/procedure#workspace/xyz',
    );
    expect(resolveLaunchUrl('finance', 'abc-1', '/modules/finance#vouchers')).toBe('/modules/finance#vouchers');
    expect(resolveLaunchUrl('procedure-engine', undefined, PROCEDURE_LAUNCH_URL)).toBe(PROCEDURE_LAUNCH_URL);
  });
});
