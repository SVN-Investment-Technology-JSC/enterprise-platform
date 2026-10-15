import type {
  ProcedureActivity,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { procedureCommentSignals } from './procedure-comment-signals.js';

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

const instance = (id: string, activity: ProcedureActivity[]): ProcedureInstance =>
  ({ id, code: id.toUpperCase(), activity }) as unknown as ProcedureInstance;

describe('procedureCommentSignals', () => {
  it('phát một tín hiệu cho mỗi trao đổi MỚI, chỉ mang id (không có nội dung)', () => {
    const before = [instance('i1', [entry('c1', 'comment', { comment: 'cũ' })])];
    const after = [
      instance('i1', [
        entry('c2', 'comment', { comment: 'bí mật', actorId: 'user-b' }),
        entry('c1', 'comment', { comment: 'cũ' }),
      ]),
    ];
    const events = procedureCommentSignals(before, after);
    expect(events).toEqual([
      {
        type: 'procedure.comment.posted',
        aggregateType: 'procedure-instance',
        aggregateId: 'i1',
        payload: { instanceId: 'i1', activityId: 'c2', actorUserId: 'user-b' },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('bí mật');
  });

  it('không phát gì cho thao tác khác (duyệt, trả về...) hay khi không có gì mới', () => {
    const before = [instance('i1', [entry('c1', 'comment')])];
    expect(procedureCommentSignals(before, before)).toEqual([]);
    const after = [instance('i1', [entry('a1', 'approve'), entry('c1', 'comment')])];
    expect(procedureCommentSignals(before, after)).toEqual([]);
  });

  it('nhiều trao đổi mới trong cùng một lần ghi cho nhiều tín hiệu, mỗi hồ sơ tách biệt', () => {
    const after = [
      instance('i1', [entry('c1', 'comment'), entry('c2', 'comment')]),
      instance('i2', [entry('c3', 'comment')]),
    ];
    const events = procedureCommentSignals([], after);
    expect(events.map((event) => [event.aggregateId, event.payload.activityId])).toEqual([
      ['i1', 'c1'],
      ['i1', 'c2'],
      ['i2', 'c3'],
    ]);
  });
});
