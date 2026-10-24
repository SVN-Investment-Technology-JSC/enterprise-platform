import type { StandaloneTask, WorkItem } from '@enterprise-platform/contracts-workspace';
import { standaloneTaskChanges, workItemChanges } from './work-item-changes.js';

const item = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'w1',
    projectId: 'p1',
    code: 'CV001',
    title: 'Lập hồ sơ',
    priority: 'normal',
    status: 'todo',
    progressPercent: 0,
    autoProgressPercent: 0,
    progressManual: false,
    participantUserIds: ['u1', 'u2'],
    tagIds: [],
    ...overrides,
  }) as WorkItem;

describe('workItemChanges', () => {
  it('không đổi gì thì rỗng; đổi thứ tự người cùng làm không tính là sửa', () => {
    expect(workItemChanges(item(), item({ participantUserIds: ['u2', 'u1'] }))).toEqual([]);
  });

  it('ghi trường bị sửa kèm giá trị trước và sau', () => {
    const changes = workItemChanges(
      item(),
      item({ title: 'Lập hồ sơ mới', priority: 'high', plannedEnd: '2026-10-30' }),
    );
    expect(changes).toEqual([
      { field: 'title', from: 'Lập hồ sơ', to: 'Lập hồ sơ mới' },
      { field: 'priority', from: 'normal', to: 'high' },
      { field: 'plannedEnd', from: null, to: '2026-10-30' },
    ]);
  });

  it('nhập tay tiến độ ghi thành trường riêng, không lẫn với tiến độ tự tính', () => {
    const changes = workItemChanges(
      item(),
      item({ progressPercent: 40, autoProgressPercent: 0, progressManual: true }),
    );
    expect(changes).toEqual([{ field: 'manualProgressPercent', from: null, to: 40 }]);
  });
});

describe('standaloneTaskChanges', () => {
  const task = (overrides: Partial<StandaloneTask> = {}): StandaloneTask =>
    ({
      id: 't1',
      code: 'GV001',
      title: 'Soạn hồ sơ',
      priority: 'normal',
      status: 'todo',
      assigneeUserId: 'u1',
      participantUserIds: [],
      followerUserIds: ['u3'],
      progressPercent: 0,
      autoProgressPercent: 0,
      progressManual: false,
      ...overrides,
    }) as StandaloneTask;

  it('ghi hạn, người theo dõi và tiến độ nhập tay', () => {
    const changes = standaloneTaskChanges(
      task(),
      task({
        dueDate: '2026-11-01',
        followerUserIds: ['u3', 'u4'],
        progressPercent: 30,
        progressManual: true,
      }),
    );
    expect(changes).toEqual([
      { field: 'followerUserIds', from: ['u3'], to: ['u3', 'u4'] },
      { field: 'dueDate', from: null, to: '2026-11-01' },
      { field: 'manualProgressPercent', from: null, to: 30 },
    ]);
  });
});
