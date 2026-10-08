import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { instanceProgressText } from './instance-flow-view';

const instance = (status: string): ProcedureInstance =>
  ({
    status,
    steps: [{ status: 'pending' }],
    progress: { completed: 0, total: 1, isEstimate: false },
  }) as unknown as ProcedureInstance;

describe('instanceProgressText', () => {
  it('hồ sơ đã huỷ hiện "Đã huỷ" thay vì 0/1', () => {
    expect(instanceProgressText(instance('cancelled'), ' bước')).toBe('Đã huỷ');
  });

  it('hồ sơ đang xử lý giữ nhãn tiến độ', () => {
    expect(instanceProgressText(instance('processing'), ' bước')).toBe('0/1 bước');
  });
});
