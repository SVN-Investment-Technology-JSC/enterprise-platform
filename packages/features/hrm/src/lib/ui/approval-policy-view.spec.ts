import { policyToggleCopy, validatePolicyReason } from './approval-policy-view';

describe('approval-policy-view', () => {
  it('lý do cần 10 đến 500 ký tự sau khi cắt khoảng trắng', () => {
    expect(validatePolicyReason('   ngắn  ')).not.toBe('');
    expect(validatePolicyReason('a'.repeat(10))).toBe('');
    expect(validatePolicyReason('a'.repeat(501))).not.toBe('');
  });
  it('bật ngoại lệ cảnh báo rủi ro và dùng nút nguy hiểm', () => {
    const on = policyToggleCopy(false);
    expect(on.target).toBe(true);
    expect(on.okType).toBe('danger');
    expect(on.confirmDescription).toContain('kiểm soát nội bộ');
  });
  it('tắt ngoại lệ đưa về trạng thái chặn', () => {
    const off = policyToggleCopy(true);
    expect(off.target).toBe(false);
    expect(off.okType).toBe('primary');
  });
});
