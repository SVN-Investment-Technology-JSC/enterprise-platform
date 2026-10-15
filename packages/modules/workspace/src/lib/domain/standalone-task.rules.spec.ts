import {
  allowedStandaloneTaskTransitions,
  type StandaloneTask,
} from '@enterprise-platform/contracts-workspace';
import {
  assertStandaloneTaskTransition,
  canDeleteStandaloneTask,
  standaloneTaskRoleOf,
} from './standalone-task.rules.js';

const BOSS = 'u-boss';
const DOER = 'u-doer';

function task(overrides: Partial<StandaloneTask> = {}): StandaloneTask {
  return {
    id: 't1',
    code: 'GV001',
    title: 'Soạn báo giá',
    status: 'todo',
    priority: 'normal',
    rootId: 't1',
    depth: 0,
    childCount: 0,
    openChildCount: 0,
    executionType: 'manual',
    assigneeUserId: DOER,
    participantUserIds: ['u-helper'],
    followerUserIds: ['u-watch'],
    progressPercent: 0,
    createdBy: BOSS,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    statusChangedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('standaloneTaskRoleOf', () => {
  it('xếp vai theo thứ tự người giao > phụ trách > cùng làm > theo dõi', () => {
    const value = task();
    expect(standaloneTaskRoleOf(value, BOSS)).toBe('assigner');
    expect(standaloneTaskRoleOf(value, DOER)).toBe('assignee');
    expect(standaloneTaskRoleOf(value, 'u-helper')).toBe('participant');
    expect(standaloneTaskRoleOf(value, 'u-watch')).toBe('follower');
    expect(standaloneTaskRoleOf(value, 'u-stranger')).toBeUndefined();
  });

  it('tự giao cho mình vẫn là người giao', () => {
    expect(standaloneTaskRoleOf(task({ assigneeUserId: BOSS }), BOSS)).toBe('assigner');
  });
});

describe('allowedStandaloneTaskTransitions', () => {
  it('người thực hiện chỉ đi tới Chờ duyệt, không hoàn thành hay huỷ được', () => {
    expect(allowedStandaloneTaskTransitions(task({ status: 'in_progress' }), 'assignee')).toEqual([
      'todo',
      'blocked',
      'review',
    ]);
    expect(allowedStandaloneTaskTransitions(task({ status: 'review' }), 'participant')).toEqual([
      'in_progress',
    ]);
    expect(allowedStandaloneTaskTransitions(task({ status: 'done' }), 'assignee')).toEqual([]);
  });

  it('người giao duyệt hoặc trả lại từ Chờ duyệt', () => {
    expect(allowedStandaloneTaskTransitions(task({ status: 'review' }), 'assigner')).toEqual([
      'in_progress',
      'done',
      'cancelled',
    ]);
  });

  it('Đang làm không đi thẳng sang Hoàn thành, trừ khi tự giao cho mình', () => {
    expect(
      allowedStandaloneTaskTransitions(task({ status: 'in_progress' }), 'assigner'),
    ).not.toContain('done');
    expect(
      allowedStandaloneTaskTransitions(
        task({ status: 'in_progress', assigneeUserId: BOSS }),
        'assigner',
      ),
    ).toContain('done');
  });

  it('người theo dõi không có bước nào', () => {
    expect(allowedStandaloneTaskTransitions(task({ status: 'todo' }), 'follower')).toEqual([]);
  });
});

describe('assertStandaloneTaskTransition', () => {
  it('chặn người thực hiện tự xác nhận hoàn thành', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'review' }), 'assignee', 'done', undefined),
    ).toThrow(/Chỉ người giao việc được xác nhận hoàn thành/);
  });

  it('chặn người thực hiện huỷ việc', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'todo' }), 'assignee', 'cancelled', 'x'),
    ).toThrow(/Chỉ người giao việc được huỷ/);
  });

  it('trả lại bắt buộc có lý do', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'review' }), 'assigner', 'in_progress', ' '),
    ).toThrow(/lý do trả lại/);
    expect(() =>
      assertStandaloneTaskTransition(
        task({ status: 'review' }),
        'assigner',
        'in_progress',
        'Thiếu bảng giá',
      ),
    ).not.toThrow();
  });

  it('người thực hiện rút lại từ Chờ duyệt không cần lý do', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'review' }), 'assignee', 'in_progress', undefined),
    ).not.toThrow();
  });

  it('huỷ bắt buộc có lý do', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'todo' }), 'assigner', 'cancelled', undefined),
    ).toThrow(/lý do huỷ/);
  });

  it('báo lỗi khi đổi sang đúng trạng thái hiện tại', () => {
    expect(() =>
      assertStandaloneTaskTransition(task({ status: 'todo' }), 'assigner', 'todo', undefined),
    ).toThrow(/đã ở trạng thái/);
  });
});

describe('canDeleteStandaloneTask', () => {
  it('chỉ xoá khi cả cây chưa làm hoặc đã huỷ', () => {
    expect(canDeleteStandaloneTask([{ status: 'todo' }])).toBe(true);
    expect(canDeleteStandaloneTask([{ status: 'cancelled' }, { status: 'todo' }])).toBe(true);
    expect(canDeleteStandaloneTask([{ status: 'in_progress' }])).toBe(false);
    expect(canDeleteStandaloneTask([{ status: 'todo' }, { status: 'done' }])).toBe(false);
  });
});

describe('việc con', () => {
  const child = (overrides: Partial<StandaloneTask> = {}) =>
    task({ parentId: 'p1', depth: 1, rootId: 'p1', ...overrides });

  it('người thực hiện tự hoàn thành, không qua Chờ duyệt', () => {
    expect(allowedStandaloneTaskTransitions(child({ status: 'in_progress' }), 'assignee')).toEqual([
      'todo',
      'blocked',
      'done',
    ]);
    expect(() =>
      assertStandaloneTaskTransition(child({ status: 'in_progress' }), 'participant', 'done', undefined),
    ).not.toThrow();
  });

  it('người thực hiện việc con vẫn không huỷ được', () => {
    expect(() =>
      assertStandaloneTaskTransition(child({ status: 'todo' }), 'assignee', 'cancelled', 'x'),
    ).toThrow(/Chỉ người giao việc được huỷ/);
  });

  it('người giao việc con đi thẳng Đang làm → Hoàn thành', () => {
    expect(allowedStandaloneTaskTransitions(child({ status: 'in_progress' }), 'assigner')).toContain(
      'done',
    );
  });

  it('người xem qua cây không có bước nào', () => {
    expect(allowedStandaloneTaskTransitions(child({ status: 'todo' }), 'viewer')).toEqual([]);
    expect(() =>
      assertStandaloneTaskTransition(child({ status: 'todo' }), 'viewer', 'in_progress', undefined),
    ).toThrow(/chỉ được xem/);
  });
});

describe('còn việc con đang mở', () => {
  it('không gửi duyệt, hoàn thành hay huỷ được', () => {
    const parent = task({ status: 'in_progress', childCount: 2, openChildCount: 1 });
    expect(allowedStandaloneTaskTransitions(parent, 'assignee')).toEqual(['todo', 'blocked']);
    expect(allowedStandaloneTaskTransitions(parent, 'assigner')).toEqual(['todo', 'blocked']);
    expect(() => assertStandaloneTaskTransition(parent, 'assignee', 'review', undefined)).toThrow(
      /Còn 1 việc con chưa xong/,
    );
  });
});

describe('theo quy trình', () => {
  const procedureTask = (status: 'pending' | 'started' | 'completed' | 'rejected') =>
    task({
      status: 'in_progress',
      executionType: 'procedure',
      procedure: { definitionId: 'd1', status },
    });

  it('hồ sơ còn chạy: không ai gửi duyệt hay hoàn thành bằng tay', () => {
    expect(allowedStandaloneTaskTransitions(procedureTask('started'), 'assignee')).not.toContain(
      'review',
    );
    expect(() =>
      assertStandaloneTaskTransition(procedureTask('pending'), 'assignee', 'review', undefined),
    ).toThrow(/chờ hồ sơ quy trình hoàn tất/);
  });

  it('người giao vẫn huỷ được khi hồ sơ còn chạy', () => {
    expect(allowedStandaloneTaskTransitions(procedureTask('started'), 'assigner')).toContain(
      'cancelled',
    );
  });

  it('hồ sơ bị từ chối: người thực hiện xử lý tay như việc thường', () => {
    expect(allowedStandaloneTaskTransitions(procedureTask('rejected'), 'assignee')).toContain(
      'review',
    );
  });
});

describe('đã huỷ hiệu lực', () => {
  it('là trạng thái cuối: không ai chuyển tiếp được', () => {
    const reversed = task({
      status: 'cancelled',
      reversal: { reversedAt: '2026-10-14T00:00:00.000Z', reversedBy: BOSS, reason: 'x', adjustmentRequested: false },
    });
    expect(allowedStandaloneTaskTransitions(reversed, 'assigner')).toEqual([]);
    expect(allowedStandaloneTaskTransitions(reversed, 'assignee')).toEqual([]);
    expect(() => assertStandaloneTaskTransition(reversed, 'assigner', 'todo', undefined)).toThrow(
      /đã huỷ hiệu lực/,
    );
  });
});
