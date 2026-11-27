import type {
  ProcedureActivity,
  ProcedureInstance,
  ProcedureInstanceStep,
} from '@enterprise-platform/contracts-procedure-engine';
import { procedureInstanceSignals } from './procedure-instance-signals.js';

const entry = (
  id: string,
  action: ProcedureActivity['action'],
  extra: Partial<ProcedureActivity> = {},
): ProcedureActivity =>
  ({
    id,
    action,
    actorId: 'user-a',
    actorName: 'A',
    summary: '',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  }) as ProcedureActivity;

const step = (id: string, extra: Partial<ProcedureInstanceStep> = {}): ProcedureInstanceStep =>
  ({ id, status: 'pending', currentRoleStage: null, ...extra }) as ProcedureInstanceStep;

const instance = (
  id: string,
  extra: Partial<ProcedureInstance> = {},
): ProcedureInstance =>
  ({
    id,
    code: id.toUpperCase(),
    title: 'Bí mật',
    status: 'running',
    currentStepId: 's1',
    steps: [step('s1', { status: 'active', currentRoleStage: 'A' }), step('s2')],
    activity: [entry('a0', 'start')],
    ...extra,
  }) as unknown as ProcedureInstance;

describe('procedureInstanceSignals', () => {
  it('duyệt sang bước sau: một tín hiệu chỉ mang id hồ sơ và người duyệt', () => {
    const before = [instance('i1')];
    const after = [
      instance('i1', {
        currentStepId: 's2',
        steps: [step('s1', { status: 'completed' }), step('s2', { status: 'active', currentRoleStage: 'R' })],
        activity: [entry('a1', 'approve', { actorId: 'user-b', comment: 'nội dung' }), entry('a0', 'start')],
      }),
    ];
    const events = procedureInstanceSignals(before, after);
    expect(events).toEqual([
      {
        type: 'procedure.instance.changed',
        aggregateType: 'procedure-instance',
        aggregateId: 'i1',
        payload: { instanceId: 'i1', actorUserId: 'user-b' },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('nội dung');
    expect(JSON.stringify(events)).not.toContain('Bí mật');
  });

  it('đổi pha RACI trong cùng bước, đổi trạng thái hồ sơ hay phiếu Tài chính cũng là đổi', () => {
    const before = [instance('i1')];
    const stage = [instance('i1', { steps: [step('s1', { status: 'active', currentRoleStage: 'R' }), step('s2')] })];
    const cancelled = [instance('i1', { status: 'cancelled' })];
    const voucher = [
      instance('i1', {
        steps: [
          step('s1', {
            status: 'active',
            currentRoleStage: 'A',
            financeVoucher: { status: 'posted' } as unknown as ProcedureInstanceStep['financeVoucher'],
          }),
          step('s2'),
        ],
      }),
    ];
    for (const after of [stage, cancelled, voucher]) {
      expect(procedureInstanceSignals(before, after).map((event) => event.payload)).toEqual([
        // Không có mục lịch sử mới nào: người thực hiện là hệ thống.
        { instanceId: 'i1', actorUserId: 'system' },
      ]);
    }
  });

  it('hoàn duyệt (withdraw) có mục lịch sử mới thì phát, kể cả khi bước giữ nguyên', () => {
    const before = [instance('i1')];
    const after = [instance('i1', { activity: [entry('a1', 'withdraw', { actorId: 'user-c' }), entry('a0', 'start')] })];
    expect(procedureInstanceSignals(before, after).map((event) => event.payload.actorUserId)).toEqual(['user-c']);
  });

  it('chỉ thêm trao đổi, không đổi gì, hay hồ sơ vừa tạo: không phát', () => {
    const before = [instance('i1')];
    expect(procedureInstanceSignals(before, [instance('i1')])).toEqual([]);
    const commented = [instance('i1', { activity: [entry('c1', 'comment'), entry('a0', 'start')] })];
    expect(procedureInstanceSignals(before, commented)).toEqual([]);
    expect(procedureInstanceSignals([], [instance('i2')])).toEqual([]);
  });

  it('mỗi hồ sơ đổi một tín hiệu, hồ sơ không đổi thì không', () => {
    const before = [instance('i1'), instance('i2'), instance('i3')];
    const after = [instance('i1', { status: 'completed' }), instance('i2'), instance('i3', { status: 'rejected' })];
    expect(procedureInstanceSignals(before, after).map((event) => event.aggregateId)).toEqual(['i1', 'i3']);
  });
});
