import type { WorkItemCompletionPolicy } from '@enterprise-platform/contracts-workspace';
import { autoCompleteParents } from './progress.rules.js';
import { evaluateCompletion, parseCompletionInput } from './completion.rules.js';

const policy = (
  rule: WorkItemCompletionPolicy['rule'],
  count: number,
  minRequired?: number,
): WorkItemCompletionPolicy => ({
  rule,
  minRequired,
  conditions: Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    label: `Điều kiện ${index + 1}`,
  })),
});

describe('parseCompletionInput', () => {
  it('không đặt điều kiện thì không có chính sách', () => {
    expect(parseCompletionInput(undefined, 'task')).toBeUndefined();
    expect(parseCompletionInput(null, 'task')).toBeUndefined();
    expect(parseCompletionInput({ rule: 'all', conditions: [] }, 'task')).toBeUndefined();
  });

  it('bỏ dòng trống và cắt khoảng trắng', () => {
    const parsed = parseCompletionInput(
      { rule: 'all', conditions: [{ label: '  Biên bản nghiệm thu  ' }, { label: '   ' }] },
      'task',
    );
    expect(parsed?.conditions).toEqual([{ id: undefined, label: 'Biên bản nghiệm thu' }]);
  });

  it('nhóm công việc không đặt được điều kiện', () => {
    expect(() =>
      parseCompletionInput({ rule: 'all', conditions: [{ label: 'A' }] }, 'phase'),
    ).toThrow(/Nhóm công việc/);
  });

  it('từ chối điều kiện trùng, quá dài và quá nhiều', () => {
    expect(() =>
      parseCompletionInput({ rule: 'all', conditions: [{ label: 'A' }, { label: 'a' }] }, 'task'),
    ).toThrow(/trùng/);
    expect(() =>
      parseCompletionInput({ rule: 'all', conditions: [{ label: 'x'.repeat(301) }] }, 'task'),
    ).toThrow(/tối đa 300/);
    expect(() =>
      parseCompletionInput(
        { rule: 'all', conditions: Array.from({ length: 21 }, (_, i) => ({ label: `Đk ${i}` })) },
        'task',
      ),
    ).toThrow(/tối đa 20/);
  });

  it('at_least cần số tối thiểu từ 1 đến số điều kiện', () => {
    const conditions = [{ label: 'A' }, { label: 'B' }];
    expect(parseCompletionInput({ rule: 'at_least', minRequired: 1, conditions }, 'task')).toMatchObject({
      rule: 'at_least',
      minRequired: 1,
    });
    for (const minRequired of [0, 3, 1.5, undefined]) {
      expect(() => parseCompletionInput({ rule: 'at_least', minRequired, conditions }, 'task')).toThrow(
        /tối thiểu/,
      );
    }
  });

  it('all và none bỏ qua số tối thiểu', () => {
    const conditions = [{ label: 'A' }];
    expect(parseCompletionInput({ rule: 'all', minRequired: 5, conditions }, 'task')).toEqual({
      rule: 'all',
      conditions: [{ id: undefined, label: 'A' }],
    });
    expect(parseCompletionInput({ rule: 'none', minRequired: 5, conditions }, 'task')?.minRequired).toBeUndefined();
  });
});

describe('evaluateCompletion', () => {
  it('việc không có điều kiện thì hoàn thành luôn, không có bằng chứng', () => {
    expect(evaluateCompletion(undefined, undefined)).toBeUndefined();
    expect(evaluateCompletion({ rule: 'all', conditions: [] }, [])).toBeUndefined();
  });

  it('all: phải xác nhận đủ mọi điều kiện', () => {
    expect(() => evaluateCompletion(policy('all', 2), ['c1'])).toThrow(/đủ 2 điều kiện/);
    expect(() => evaluateCompletion(policy('all', 2), undefined)).toThrow(/đủ 2 điều kiện/);
    const evidence = evaluateCompletion(policy('all', 2), ['c1', 'c2']);
    expect(evidence?.conditions.every((condition) => condition.confirmed)).toBe(true);
  });

  it('at_least 1 trên 2: một điều kiện là đủ', () => {
    expect(() => evaluateCompletion(policy('at_least', 2, 1), [])).toThrow(/ít nhất 1\/2/);
    const evidence = evaluateCompletion(policy('at_least', 2, 1), ['c2']);
    expect(evidence?.conditions.map((condition) => condition.confirmed)).toEqual([false, true]);
  });

  it('at_least N: đủ N mới qua', () => {
    expect(() => evaluateCompletion(policy('at_least', 3, 2), ['c1'])).toThrow(/ít nhất 2\/3/);
    expect(evaluateCompletion(policy('at_least', 3, 2), ['c1', 'c3'])).toBeDefined();
  });

  it('none: không tích điều kiện nào vẫn hoàn thành, và vẫn ghi lại điều kiện đã tích', () => {
    const none = evaluateCompletion(policy('none', 3), []);
    expect(none?.conditions.map((condition) => condition.confirmed)).toEqual([false, false, false]);
    const some = evaluateCompletion(policy('none', 3), ['c2']);
    expect(some?.conditions.map((condition) => condition.confirmed)).toEqual([false, true, false]);
  });

  it('tích trùng một điều kiện nhiều lần chỉ tính một', () => {
    expect(() => evaluateCompletion(policy('at_least', 3, 2), ['c1', 'c1', 'c1'])).toThrow(/ít nhất 2\/3/);
  });

  it('id lạ bị từ chối thay vì bỏ qua lặng lẽ', () => {
    expect(() => evaluateCompletion(policy('all', 1), ['c1', 'khong-co'])).toThrow(/tải lại/);
  });

  it('ghi lại ảnh chụp chữ của điều kiện lúc hoàn thành', () => {
    const evidence = evaluateCompletion(policy('at_least', 2, 1), ['c1']);
    expect(evidence).toEqual({
      rule: 'at_least',
      minRequired: 1,
      conditions: [
        { id: 'c1', label: 'Điều kiện 1', confirmed: true },
        { id: 'c2', label: 'Điều kiện 2', confirmed: false },
      ],
    });
  });
});

describe('autoCompleteParents với điều kiện hoàn thành', () => {
  const node = (id: string, parentId: string | null, status: 'done' | 'todo', gated = false) => ({
    id,
    parentId,
    status,
    progressPercent: status === 'done' ? 100 : 0,
    requiresConfirmation: gated,
  });

  it('cha có điều kiện bắt buộc không tự hoàn thành khi con xong', () => {
    expect([...autoCompleteParents([node('p', null, 'todo', true), node('c', 'p', 'done')])]).toEqual([]);
  });

  it('cha không có điều kiện vẫn tự hoàn thành', () => {
    expect([...autoCompleteParents([node('p', null, 'todo'), node('c', 'p', 'done')])]).toEqual(['p']);
  });

  it('ông của cha chưa xác nhận điều kiện cũng chưa tự hoàn thành', () => {
    const nodes = [
      node('g', null, 'todo'),
      node('p', 'g', 'todo', true),
      node('c', 'p', 'done'),
    ];
    expect([...autoCompleteParents(nodes)]).toEqual([]);
  });

  it('cha đã được xác nhận hoàn thành thì ông của nó tự hoàn thành tiếp', () => {
    const nodes = [node('g', null, 'todo'), node('p', 'g', 'done', true), node('c', 'p', 'done')];
    expect([...autoCompleteParents(nodes)]).toEqual(['g']);
  });
});
