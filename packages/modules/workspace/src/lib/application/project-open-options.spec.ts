import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';
import { ProjectService } from './project.service.js';

const actor = (over: Partial<WorkspaceActor> = {}): WorkspaceActor =>
  ({ tenantId: 't-1', userId: 'u-1', isTenantAdmin: false, canAdminProjects: false, permissions: [], ...over }) as WorkspaceActor;

describe('dự án còn mở để chọn (GET v1/project-options)', () => {
  const openOptions = jest.fn();
  const store = { project: { openOptions } } as unknown as WorkspaceStore;

  beforeEach(() => {
    openOptions.mockReset();
    openOptions.mockResolvedValue([
      { id: 'p1', code: 'DA-001', name: 'A', role: 'owner' },
      { id: 'p2', code: 'DA-002', name: 'B', role: 'member' },
      { id: 'p3', code: 'DA-003', name: 'C', role: 'member' },
    ]);
  });

  it('người thường chỉ lấy dự án mình là thành viên; mỗi dự án có vai và quyền', async () => {
    const items = await new ProjectService(store).openOptions(actor());
    expect(openOptions).toHaveBeenCalledWith('t-1', 'u-1', true);
    expect(items.map((item) => [item.id, item.myRole])).toEqual([
      ['p1', 'owner'],
      ['p2', 'member'],
      ['p3', 'member'],
    ]);
    expect(items[0]?.myPermissions).toContain('project.update_all');
    expect(items[1]?.myPermissions).toContain('project.update_related');
  });

  it('quản trị tenant thấy mọi dự án như danh sách dự án', async () => {
    await new ProjectService(store).openOptions(actor({ isTenantAdmin: true }));
    expect(openOptions).toHaveBeenCalledWith('t-1', 'u-1', false);
  });
});
