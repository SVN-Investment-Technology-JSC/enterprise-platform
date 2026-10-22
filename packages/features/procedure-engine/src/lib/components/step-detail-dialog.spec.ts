import type { ProcedureInstance, ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import { formatDuration, stepDetail } from './step-detail-dialog';

function step(overrides: Partial<ProcedureInstanceStep>): ProcedureInstanceStep {
  return {
    id: 'step-1',
    definitionStepId: 'def-1',
    key: 'submit',
    order: 1,
    name: 'Lập đề nghị',
    status: 'completed',
    currentRoleStage: null,
    assignments: [],
    ...overrides,
  };
}

function instance(steps: ProcedureInstanceStep[], overrides: Partial<ProcedureInstance> = {}): ProcedureInstance {
  return {
    id: 'inst-1',
    code: 'PR-1',
    title: 'A',
    definitionId: 'def',
    definitionCode: 'PR',
    definitionName: 'Đề nghị thanh toán',
    definitionVersion: 1,
    status: 'running',
    initiatedBy: 'u-1',
    startedAt: '2026-10-22T01:15:00.000Z',
    steps,
    activity: [],
    ...overrides,
  } as ProcedureInstance;
}

describe('formatDuration', () => {
  it('reads minutes, hours and days', () => {
    expect(formatDuration('2026-10-22T01:00:00Z', '2026-10-22T01:00:20Z')).toBe('dưới 1 phút');
    expect(formatDuration('2026-10-22T01:00:00Z', '2026-10-22T03:15:00Z')).toBe('2 giờ 15 phút');
    expect(formatDuration('2026-10-20T01:00:00Z', '2026-10-22T04:30:00Z')).toBe('2 ngày 3 giờ');
    expect(formatDuration('2026-10-22T02:00:00Z', '2026-10-22T01:00:00Z')).toBeUndefined();
  });
});

describe('stepDetail', () => {
  const approve = step({
    id: 'step-2',
    definitionStepId: 'def-2',
    order: 2,
    name: 'Quản lý duyệt',
    startedAt: '2026-10-22T01:16:20.000Z',
    slaDueAt: '2026-10-22T09:00:00.000Z',
    attributes: [{ code: 'note', name: 'Ghi chú duyệt', type: 'text' } as never],
  });

  it('uses the closing action as performer and collects the step values', () => {
    const detail = stepDetail(
      instance([step({}), approve], {
        activity: [
          { id: 'a1', action: 'start', actorId: 'u-1', actorName: 'admin', summary: 'Lập hồ sơ', createdAt: '2026-10-22T01:15:00.000Z' },
          { id: 'a2', action: 'comment', actorId: 'u-2', actorName: 'Quản lý', summary: 'Trao đổi', createdAt: '2026-10-22T01:17:00.000Z', stepInstanceId: 'step-2' },
          { id: 'a3', action: 'approve', actorId: 'u-2', actorName: 'Quản lý', summary: 'Phê duyệt', comment: 'OK', createdAt: '2026-10-22T01:46:20.000Z', stepInstanceId: 'step-2' },
        ],
        attributeValues: {
          'step:def-2:note': { value: { type: 'text', value: 'Đồng ý' }, enteredBy: 'u-2', enteredAt: '2026-10-22T01:46:00.000Z' },
        },
      }),
      approve,
    );

    expect(detail.performerName).toBe('Quản lý');
    expect(detail.performedAt).toBe('2026-10-22T01:46:20.000Z');
    expect(detail.duration).toBe('30 phút');
    expect(detail.sla).toEqual({ onTime: true, dueAt: '2026-10-22T09:00:00.000Z' });
    expect(detail.activity.map((entry) => entry.id)).toEqual(['a2', 'a3']);
    expect(detail.values.map((item) => item.key)).toEqual(['step:def-2:note']);
  });

  it('keeps values entered when the previous step closed out of the next step', () => {
    const first = step({ startedAt: '2026-10-22T01:15:00.000Z', completedAt: '2026-10-22T01:16:20.000Z' });
    const second = step({ ...approve, startedAt: '2026-10-22T01:16:20.000Z' });
    const amount = { code: 'amount', name: 'Số tiền', type: 'money' } as never;
    const data = instance([first, second], {
      flow: { attributes: [amount] } as never,
      activity: [
        { id: 'a1', action: 'complete', actorId: 'u-1', actorName: 'admin', summary: 'Hoàn tất', createdAt: '2026-10-22T01:16:20.000Z', stepInstanceId: 'step-1' },
        { id: 'a2', action: 'approve', actorId: 'u-2', actorName: 'Quản lý', summary: 'Phê duyệt', createdAt: '2026-10-22T01:16:40.000Z', stepInstanceId: 'step-2' },
      ],
      attributeValues: {
        'process:amount': { value: { type: 'money', value: 1000000 }, enteredBy: 'u-1', enteredAt: '2026-10-22T01:16:20.000Z' },
      },
    });

    expect(stepDetail(data, first).values.map((item) => item.key)).toEqual(['process:amount']);
    expect(stepDetail(data, second).values).toEqual([]);
  });

  it('falls back to the submitter on the first step', () => {
    const first = step({});
    const detail = stepDetail(
      instance([first], {
        activity: [
          { id: 'a1', action: 'start', actorId: 'u-1', actorName: 'admin', summary: 'Lập hồ sơ', createdAt: '2026-10-22T01:15:00.000Z' },
        ],
      }),
      first,
    );
    expect(detail.performerName).toBe('admin');
    expect(detail.startedAt).toBe('2026-10-22T01:15:00.000Z');
  });
});
