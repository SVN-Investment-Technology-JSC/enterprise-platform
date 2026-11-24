import { changeProcedureGateReason, startProcedureGateReason } from './procedure-link-gate';

const open = { startProcedureStatusGate: 'any', changeProcedureStatusGate: 'any' } as const;
const strict = { startProcedureStatusGate: 'open_only', changeProcedureStatusGate: 'open_only' } as const;

describe('procedure-link-gate', () => {
  it('mặc định (any) không chặn trạng thái nào', () => {
    expect(startProcedureGateReason(open, 'done')).toBeUndefined();
    expect(changeProcedureGateReason(open, 'cancelled')).toBeUndefined();
  });

  it('open_only chặn việc đã xong hoặc đã huỷ, không chặn việc còn mở hay chờ duyệt', () => {
    for (const status of ['done', 'cancelled']) {
      expect(startProcedureGateReason(strict, status)).toMatch(/đã đóng/);
      expect(changeProcedureGateReason(strict, status)).toMatch(/đã đóng/);
    }
    for (const status of ['todo', 'in_progress', 'review', 'blocked']) {
      expect(startProcedureGateReason(strict, status)).toBeUndefined();
      expect(changeProcedureGateReason(strict, status)).toBeUndefined();
    }
  });

  it('engineChangeEligibility = never chặn đổi ở mọi trạng thái nhưng không chặn tạo', () => {
    const never = { ...open, engineChangeEligibility: 'never' } as const;
    expect(changeProcedureGateReason(never, 'in_progress')).toMatch(/không cho đổi/);
    expect(startProcedureGateReason(never, 'in_progress')).toBeUndefined();
  });
});
