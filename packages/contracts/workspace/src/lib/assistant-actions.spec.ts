import { assistantActionProblems } from '@enterprise-platform/contracts-assistant';
import { WORKSPACE_ASSISTANT_ACTIONS } from './assistant-actions.js';

describe('WORKSPACE_ASSISTANT_ACTIONS', () => {
  it('đúng chuẩn khai báo thao tác Trợ lý', () => {
    expect(assistantActionProblems(WORKSPACE_ASSISTANT_ACTIONS)).toEqual([]);
  });

  it('mọi thao tác tạo đòi quyền ghi dự án và công việc', () => {
    expect(Object.values(WORKSPACE_ASSISTANT_ACTIONS).map((action) => [action.key, action.permission])).toEqual([
      ['workspace.event.create', 'workspace.task.write'],
      ['workspace.work-item.create', 'workspace.task.write'],
      ['workspace.standalone-task.create', 'workspace.task.write'],
    ]);
  });
});
