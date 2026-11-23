import type { StandaloneTask, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  canEditChecklist,
  canEditStandaloneChecklist,
  canShowChecklist,
  canShowStandaloneChecklist,
  checklistPanelState,
  checklistPercent,
  splitChecklistLines,
} from './checklist-access';

const make = (patch: Partial<WorkItem>): WorkItem =>
  ({
    id: 'a',
    itemType: 'task',
    status: 'todo',
    createdBy: 'creator',
    assigneeUserId: 'owner',
    participantUserIds: ['helper'],
    ...patch,
  }) as WorkItem;

describe('canShowChecklist', () => {
  it('chỉ cho task lá, bỏ qua con đã huỷ', () => {
    const item = make({});
    expect(canShowChecklist(item, [item])).toBe(true);
    expect(canShowChecklist(item, [item, make({ id: 'b', parentId: 'a' })])).toBe(false);
    expect(canShowChecklist(item, [item, make({ id: 'b', parentId: 'a', status: 'cancelled' })])).toBe(true);
    expect(canShowChecklist(make({ itemType: 'phase' }), [])).toBe(false);
  });
  it('việc đã xong / huỷ chưa có đầu việc thì ẩn; có đầu việc hoặc chưa biết thì hiện', () => {
    const done = make({ status: 'done' });
    expect(canShowChecklist(done, [done], 0)).toBe(false);
    expect(canShowChecklist(done, [done], 2)).toBe(true);
    expect(canShowChecklist(done, [done])).toBe(true);
    expect(canShowChecklist(make({ status: 'cancelled' }), [], 0)).toBe(false);
  });
});

describe('canEditChecklist', () => {
  const base = { canWrite: true, canManage: false };
  it('cho phụ trách, cùng làm, người tạo và quản lý', () => {
    const item = make({});
    expect(canEditChecklist({ item, userId: 'owner', ...base })).toBe(true);
    expect(canEditChecklist({ item, userId: 'helper', ...base })).toBe(true);
    expect(canEditChecklist({ item, userId: 'creator', ...base })).toBe(true);
    expect(canEditChecklist({ item, userId: 'x', ...base, canManage: true })).toBe(true);
  });
  it('chặn người khác, khi không có quyền ghi hoặc chưa biết người dùng', () => {
    const item = make({});
    expect(canEditChecklist({ item, userId: 'x', ...base })).toBe(false);
    expect(canEditChecklist({ item, userId: '', ...base })).toBe(false);
    expect(canEditChecklist({ item, userId: 'owner', canWrite: false, canManage: true })).toBe(false);
  });
});

describe('checklistPercent', () => {
  it('làm tròn và an toàn khi rỗng', () => {
    expect(checklistPercent(0, 0)).toBe(0);
    expect(checklistPercent(1, 3)).toBe(33);
    expect(checklistPercent(2, 3)).toBe(67);
  });
});

describe('splitChecklistLines', () => {
  it('tách dòng, bỏ ký hiệu đầu dòng và dòng trống', () => {
    expect(splitChecklistLines('- Một\n\n[ ] Hai\r\n3. Ba\n  Bốn  ')).toEqual(['Một', 'Hai', 'Ba', 'Bốn']);
  });
});

describe('checklistPanelState', () => {
  const base = { closed: false, canEdit: true, total: 2, max: 50 };
  it('checklist: sửa và thêm được', () => {
    expect(checklistPanelState({ ...base, method: 'checklist' })).toMatchObject({ editable: true, canAdd: true, reason: '' });
  });
  it('manual chưa có đầu việc: chỉ ô thêm (đường tự chuyển); đã có đầu việc: chỉ xem kèm lý do', () => {
    expect(checklistPanelState({ ...base, method: 'manual', total: 0 })).toMatchObject({ editable: false, canAdd: true });
    const viewOnly = checklistPanelState({ ...base, method: 'manual' });
    expect(viewOnly).toMatchObject({ editable: false, canAdd: false });
    expect(viewOnly.reason).toContain('đổi cách tính sang theo đầu việc');
  });
  it('child_weight và quantity: không có ô thêm, có lý do; quantity rỗng thì ẩn', () => {
    expect(checklistPanelState({ ...base, method: 'child_weight', total: 0 })).toMatchObject({ canAdd: false });
    expect(checklistPanelState({ ...base, method: 'child_weight', total: 0 }).reason).not.toBe('');
    expect(checklistPanelState({ ...base, method: 'quantity', total: 0 }).visible).toBe(false);
    expect(checklistPanelState({ ...base, method: 'quantity' })).toMatchObject({ visible: true, editable: false, canAdd: false });
  });
  it('đã đóng hoặc không có quyền: chỉ xem; đóng và rỗng thì ẩn; đủ 50 thì hết ô thêm', () => {
    expect(checklistPanelState({ ...base, method: 'checklist', closed: true })).toMatchObject({ editable: false, canAdd: false });
    expect(checklistPanelState({ ...base, method: 'checklist', closed: true, total: 0 }).visible).toBe(false);
    expect(checklistPanelState({ ...base, method: 'checklist', canEdit: false })).toMatchObject({ editable: false, canAdd: false });
    expect(checklistPanelState({ ...base, method: 'checklist', total: 50 })).toMatchObject({ editable: true, canAdd: false });
  });
});

describe('checklist của Công việc khác', () => {
  const task = (patch: Partial<StandaloneTask> = {}) =>
    ({ childCount: 0, executionType: 'direct', status: 'todo', ...patch }) as StandaloneTask;

  it('chỉ hiện cho việc lá, không chạy quy trình, chưa huỷ hiệu lực', () => {
    expect(canShowStandaloneChecklist(task())).toBe(true);
    expect(canShowStandaloneChecklist(task({ childCount: 2 }))).toBe(false);
    expect(canShowStandaloneChecklist(task({ executionType: 'procedure' }))).toBe(false);
    expect(
      canShowStandaloneChecklist(task({ reversal: { reversedBy: 'u', reversedAt: 'x', reason: 'r' } as StandaloneTask['reversal'] })),
    ).toBe(false);
  });

  it('việc đã đóng chưa có đầu việc thì ẩn; có đầu việc hoặc chưa biết thì hiện', () => {
    expect(canShowStandaloneChecklist(task({ status: 'done' }), 0)).toBe(false);
    expect(canShowStandaloneChecklist(task({ status: 'cancelled' }), 0)).toBe(false);
    expect(canShowStandaloneChecklist(task({ status: 'done' }), 3)).toBe(true);
    expect(canShowStandaloneChecklist(task({ status: 'done' }))).toBe(true);
  });

  it('người giao, người phụ trách, người cùng làm được sửa; người theo dõi và người xem thì chỉ đọc', () => {
    expect(canEditStandaloneChecklist('assigner')).toBe(true);
    expect(canEditStandaloneChecklist('assignee')).toBe(true);
    expect(canEditStandaloneChecklist('participant')).toBe(true);
    expect(canEditStandaloneChecklist('follower')).toBe(false);
    expect(canEditStandaloneChecklist('viewer')).toBe(false);
    expect(canEditStandaloneChecklist(undefined)).toBe(false);
  });

  it('lời giải thích khi chỉ xem lấy theo câu truyền vào', () => {
    const state = checklistPanelState({
      method: 'checklist',
      closed: false,
      canEdit: false,
      total: 1,
      max: 50,
      cannotEditReason: 'Chỉ người giao được sửa.',
    });
    expect(state.reason).toBe('Chỉ người giao được sửa.');
    expect(state.editable).toBe(false);
  });
});
