import {
  PROCEDURE_LAUNCH_URL,
  procedureLaunchUrl,
  resolveLaunchUrl,
} from './workspace-procedure-link.js';

describe('link sang module Quy trình', () => {
  it('mở thẳng hồ sơ thay vì trang danh sách', () => {
    expect(procedureLaunchUrl('3f2a')).toBe('/modules/procedure#workspace/3f2a');
  });

  it('liên kết cũ lưu link chung được sửa lúc đọc ra', () => {
    expect(resolveLaunchUrl('procedure-engine', '3f2a', PROCEDURE_LAUNCH_URL)).toBe(
      '/modules/procedure#workspace/3f2a',
    );
  });

  it('link đã trỏ đúng hồ sơ hoặc của module khác thì giữ nguyên', () => {
    expect(resolveLaunchUrl('procedure-engine', '3f2a', '/modules/procedure#workspace/3f2a')).toBe(
      '/modules/procedure#workspace/3f2a',
    );
    expect(resolveLaunchUrl('maintenance', 'm1', '/modules/maintenance#history')).toBe(
      '/modules/maintenance#history',
    );
  });
});
