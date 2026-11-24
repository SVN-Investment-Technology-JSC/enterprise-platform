import type { ProcedureInstanceView } from './procedure-api';
import { procedureChangeBlockReason } from './procedure-change';

const fresh: ProcedureInstanceView = {
  id: 'i1',
  code: 'HS-1',
  status: 'running',
  doneSteps: 0,
  totalSteps: 3,
  progressPercent: 0,
  stepStatuses: ['pending', 'pending', 'pending'],
  currentStepIndex: 0,
  activityCount: 1,
};

describe('procedureChangeBlockReason', () => {
  it('cho đổi khi hồ sơ còn nguyên', () => {
    expect(procedureChangeBlockReason(fresh)).toBeUndefined();
  });
  it('chưa tải được hồ sơ thì không chặn, server quyết định', () => {
    expect(procedureChangeBlockReason(undefined)).toBeUndefined();
  });
  it('chặn khi có bước đã xử lý, đã sang bước khác hoặc có hoạt động', () => {
    expect(procedureChangeBlockReason({ ...fresh, stepStatuses: ['completed', 'pending'], doneSteps: 1 })).toMatch(/đã được xử lý/);
    expect(procedureChangeBlockReason({ ...fresh, stepStatuses: ['returned'] })).toMatch(/đã được xử lý/);
    expect(procedureChangeBlockReason({ ...fresh, currentStepIndex: 1 })).toMatch(/đã được xử lý/);
    expect(procedureChangeBlockReason({ ...fresh, activityCount: 2 })).toMatch(/đã được xử lý/);
  });
  it('chặn khi hồ sơ không còn chạy', () => {
    expect(procedureChangeBlockReason({ ...fresh, status: 'completed' })).toMatch(/kết thúc/);
  });
});
