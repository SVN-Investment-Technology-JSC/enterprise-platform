import { hasApprovalProgressed } from './hrm-procedure-progress';

const step = (order: number, status: string) => ({ order, status });

describe('hasApprovalProgressed', () => {
  it('chưa có tiến độ hoặc hồ sơ không còn chạy thì không chặn', () => {
    expect(hasApprovalProgressed(null)).toBe(false);
    expect(hasApprovalProgressed({ status: 'completed', steps: [step(1, 'completed'), step(2, 'completed')] })).toBe(false);
  });

  it('bước khởi tạo đã tự qua nhưng chưa ai duyệt thì vẫn cho rút', () => {
    expect(hasApprovalProgressed({ status: 'running', steps: [step(1, 'completed'), step(2, 'active'), step(3, 'pending')] })).toBe(false);
  });

  it('đã duyệt xong một bước sau bước khởi tạo thì chặn rút', () => {
    expect(hasApprovalProgressed({ status: 'running', steps: [step(3, 'pending'), step(1, 'completed'), step(2, 'completed')] })).toBe(true);
  });
});
