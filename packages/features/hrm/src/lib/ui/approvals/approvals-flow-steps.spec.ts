import { flowSteps } from './approvals-model';

const row = { id: 'r1', employeeName: 'Nguyễn A', approvedByName: 'Trần Duyệt', status: 'APPROVED' } as never;

describe('flowSteps: người duyệt ở từng bước', () => {
  it('người duyệt của đơn chỉ thay nhãn trống ở bước cuối đã xử lý', () => {
    const steps = flowSteps(row, {
      status: 'completed',
      steps: [
        { id: 's1', name: 'Gửi đơn', status: 'completed', order: 1 },
        { id: 's2', name: 'Thông báo', status: 'completed', order: 2 },
        { id: 's3', name: 'Quản lý duyệt', status: 'completed', order: 3 },
      ],
    });
    expect(steps.map((s) => s.person)).toEqual(['Nguyễn A', '', '', 'Trần Duyệt']);
  });

  it('nhãn của bước luôn được ưu tiên', () => {
    const steps = flowSteps(row, {
      status: 'completed',
      steps: [{ id: 's2', name: 'Quản lý duyệt', status: 'completed', order: 2, roleTitle: 'Lê Phó' }],
    });
    expect(steps[1].person).toBe('Lê Phó');
  });
});
