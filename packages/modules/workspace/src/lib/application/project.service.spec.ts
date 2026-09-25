import type { ProjectMember, ProjectRole } from '@enterprise-platform/contracts-workspace';
import { DirectoryService } from './directory.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Store giả cho nhánh đặt lại danh sách thành viên. Dự án `p1` có chủ nhiệm
 * `owner` và một thành viên cũ `old` — người này đã rời tổ chức.
 */
function makeStore() {
  const saved: { userId: string; role: ProjectRole }[][] = [];
  const current: ProjectMember[] = [
    { id: 'm1', projectId: 'p1', userId: 'owner', role: 'owner', joinedAt: '' },
    { id: 'm2', projectId: 'p1', userId: 'old', role: 'member', joinedAt: '' },
  ];
  const store = {
    project: { findById: async () => ({ id: 'p1' }) as never },
    member: {
      roleOf: async (_tenant: string, _project: string, userId: string) =>
        current.find((member) => member.userId === userId)?.role,
      list: async () => current,
      openItemCounts: async () => new Map<string, number>(),
      replaceAll: async (
        _tenant: string,
        _project: string,
        _actor: string,
        members: { userId: string; role: ProjectRole }[],
      ) => {
        saved.push(members);
        return [];
      },
    },
  } as unknown as WorkspaceStore;
  return { store, saved };
}

const directory = (known: readonly string[], degraded = false) =>
  new DirectoryService({
    list: async () => ({
      people: known.map((userId) => ({ userId, displayName: userId, unitNames: [] })),
      degraded,
    }),
  });

const owner: WorkspaceActor = {
  tenantId: 't1',
  userId: 'owner',
  displayName: 'owner',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

describe('ProjectService.setMembers — đối chiếu danh bạ tổ chức', () => {
  it('thêm người có trong tổ chức: được', async () => {
    const { store, saved } = makeStore();
    const service = new ProjectService(store, directory(['owner', 'ke-toan']));
    await service.setMembers(owner, 'p1', {
      members: [
        { userId: 'owner', role: 'owner' },
        { userId: 'old', role: 'member' },
        { userId: 'ke-toan', role: 'member' },
      ],
    });
    expect(saved).toHaveLength(1);
  });

  it('thêm id không có trong tổ chức: từ chối', async () => {
    const { store, saved } = makeStore();
    const service = new ProjectService(store, directory(['owner']));
    await expect(
      service.setMembers(owner, 'p1', {
        members: [
          { userId: 'owner', role: 'owner' },
          { userId: 'nguoi-la', role: 'member' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(saved).toHaveLength(0);
  });

  it('thành viên cũ đã rời tổ chức vẫn giữ được — chỉ kiểm người MỚI', async () => {
    const { store, saved } = makeStore();
    // `old` không còn trong danh bạ.
    const service = new ProjectService(store, directory(['owner']));
    await service.setMembers(owner, 'p1', {
      members: [
        { userId: 'owner', role: 'owner' },
        { userId: 'old', role: 'manager' },
      ],
    });
    expect(saved).toHaveLength(1);
  });

  it('danh bạ không đọc được: không chặn', async () => {
    const { store, saved } = makeStore();
    const service = new ProjectService(store, directory([], true));
    await service.setMembers(owner, 'p1', {
      members: [
        { userId: 'owner', role: 'owner' },
        { userId: 'nguoi-la', role: 'member' },
      ],
    });
    expect(saved).toHaveLength(1);
  });
});
