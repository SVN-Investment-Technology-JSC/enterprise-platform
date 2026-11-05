import type {
  ProjectMember,
  ProjectRole,
  ProjectStatus,
  UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import { DirectoryService } from './directory.service.js';
import { PROJECT_PERMISSIONS } from '@enterprise-platform/contracts-workspace';
import {
  ProjectService,
  effectivePermissions,
  hasProjectPermission,
  hasProjectRole,
  seesAllProjects,
} from './project.service.js';
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

/**
 * Store giả cho nhánh cập nhật dự án. Người gọi là chủ nhiệm (`owner`), nên qua
 * được mọi kiểm quyền; ta chỉ quan tâm quy tắc nghiệp vụ của `update`.
 */
function makeUpdateStore(options: { openItems?: number; status?: ProjectStatus } = {}) {
  const updated: UpdateProjectRequest[] = [];
  const store = {
    project: {
      findById: async () =>
        ({ id: 'p1', status: options.status ?? 'active' }) as never,
      update: async (
        _tenant: string,
        _project: string,
        patch: UpdateProjectRequest,
      ) => {
        updated.push(patch);
        return { id: 'p1', ...patch } as never;
      },
    },
    member: {
      roleOf: async () => 'owner' as ProjectRole,
    },
    workItem: {
      openItemCount: async () => options.openItems ?? 0,
    },
  } as unknown as WorkspaceStore;
  return { store, updated };
}

describe('ProjectService.update — đổi loại/khách hàng/trạng thái', () => {
  it('đổi loại dự án: gửi xuống store (đã chuẩn hoá)', async () => {
    const { store, updated } = makeUpdateStore();
    const service = new ProjectService(store);
    await service.update(owner, 'p1', { projectType: '  Bảo trì  ' });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ projectType: 'Bảo trì' });
  });

  it('gắn khách hàng: gửi customerId xuống store', async () => {
    const { store, updated } = makeUpdateStore();
    const service = new ProjectService(store);
    await service.update(owner, 'p1', { customerId: 'kh-1' });
    expect(updated[0]).toMatchObject({ customerId: 'kh-1' });
  });

  it('đổi trạng thái sang Đang chạy: cho qua', async () => {
    const { store, updated } = makeUpdateStore();
    const service = new ProjectService(store);
    await service.update(owner, 'p1', { status: 'active' });
    expect(updated[0]).toMatchObject({ status: 'active' });
  });
});

describe('ProjectService.update — ràng buộc đóng hồ sơ', () => {
  it('còn công việc chưa đóng: chặn, không ghi', async () => {
    const { store, updated } = makeUpdateStore({ openItems: 2 });
    const service = new ProjectService(store);
    await expect(service.update(owner, 'p1', { status: 'completed' })).rejects.toMatchObject({
      code: 'PROJECT_HAS_OPEN_WORK_ITEMS',
    });
    expect(updated).toHaveLength(0);
  });

  it('mọi việc đã đóng: cho đóng hồ sơ', async () => {
    const { store, updated } = makeUpdateStore({ openItems: 0 });
    const service = new ProjectService(store);
    await service.update(owner, 'p1', { status: 'completed' });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: 'completed' });
  });

  it('dự án đã hoàn thành rồi: sửa trường khác không bị chặn', async () => {
    const { store, updated } = makeUpdateStore({ openItems: 5, status: 'completed' });
    const service = new ProjectService(store);
    await service.update(owner, 'p1', { status: 'completed', description: 'Chốt sổ' });
    expect(updated).toHaveLength(1);
  });
});

describe('ProjectService.unarchive — mở lưu trữ dự án đã hoàn thành', () => {
  function archiveStore(archivedAt?: string, reopenPolicy?: string) {
    const updates: UpdateProjectRequest[] = [];
    const archivedCalls: boolean[] = [];
    const store = {
      settings: {
        get: async (_t: string, key: string) =>
          key === 'project_reopen_policy' && reopenPolicy ? { policy: reopenPolicy } : undefined,
      },
      project: {
        findById: async () => ({ id: 'p1', status: 'completed', archivedAt }) as never,
        setArchived: async (_t: string, _id: string, archived: boolean) => {
          archivedCalls.push(archived);
          return { id: 'p1' } as never;
        },
        update: async (_t: string, _id: string, input: UpdateProjectRequest) => {
          updates.push(input);
          return { id: 'p1', status: input.status } as never;
        },
      },
      member: {
        roleOf: async (_t: string, _p: string, userId: string) =>
          userId === 'owner' ? 'owner' : userId === 'viewer' ? 'viewer' : undefined,
      },
    } as unknown as WorkspaceStore;
    return { store, updates, archivedCalls };
  }

  it('cài đặt "giữ nguyên": chỉ bỏ dấu lưu trữ, dự án vẫn Hoàn thành', async () => {
    const { store, updates, archivedCalls } = archiveStore('2026-10-20T00:00:00.000Z', 'keep');
    await new ProjectService(store).unarchive(owner, 'p1');
    expect(updates).toEqual([]);
    expect(archivedCalls).toEqual([false]);
  });

  it('chủ nhiệm mở lưu trữ: dự án về đang chạy', async () => {
    const { store, updates } = archiveStore('2026-10-20T00:00:00.000Z');
    await new ProjectService(store).unarchive(owner, 'p1');
    expect(updates).toEqual([{ status: 'active' }]);
  });

  it('người xem không mở được; dự án chưa lưu trữ thì báo lỗi', async () => {
    const archived = archiveStore('2026-10-20T00:00:00.000Z');
    await expect(
      new ProjectService(archived.store).unarchive({ ...owner, userId: 'viewer' }, 'p1'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(archived.updates).toEqual([]);

    const live = archiveStore(undefined);
    await expect(new ProjectService(live.store).unarchive(owner, 'p1')).rejects.toThrow(
      'không nằm trong lưu trữ',
    );
  });
});

describe('ProjectService.archive — đóng hồ sơ thủ công', () => {
  function closeStore(options: { status?: string; archivedAt?: string; openItems?: number } = {}) {
    const archivedCalls: boolean[] = [];
    const updates: UpdateProjectRequest[] = [];
    const store = {
      project: {
        findById: async () =>
          ({ id: 'p1', status: options.status ?? 'planning', archivedAt: options.archivedAt }) as never,
        setArchived: async (_t: string, _id: string, archived: boolean) => {
          archivedCalls.push(archived);
          return { id: 'p1' } as never;
        },
        update: async (_t: string, _id: string, input: UpdateProjectRequest) => {
          updates.push(input);
          return { id: 'p1' } as never;
        },
      },
      workItem: { openItemCount: async () => options.openItems ?? 0 },
      member: {
        roleOf: async (_t: string, _p: string, userId: string) => (userId === 'owner' ? 'owner' : undefined),
      },
    } as unknown as WorkspaceStore;
    return { store, archivedCalls, updates };
  }

  it('đưa vào lưu trữ mà không đổi trạng thái', async () => {
    const { store, archivedCalls, updates } = closeStore();
    await new ProjectService(store).archive(owner, 'p1');
    expect(archivedCalls).toEqual([true]);
    expect(updates).toEqual([]);
  });

  it('còn công việc chưa xong vẫn đóng thủ công được; đã lưu trữ thì báo lỗi', async () => {
    const open = closeStore({ openItems: 2 });
    await new ProjectService(open.store).archive(owner, 'p1');
    expect(open.archivedCalls).toEqual([true]);
    await expect(
      new ProjectService(closeStore({ archivedAt: '2026-10-20T00:00:00.000Z' }).store).archive(owner, 'p1'),
    ).rejects.toThrow('đã nằm trong lưu trữ');
  });

  it('mở lưu trữ dự án đóng thủ công: giữ nguyên trạng thái', async () => {
    const { store, archivedCalls, updates } = closeStore({ archivedAt: '2026-10-20T00:00:00.000Z' });
    await new ProjectService(store).unarchive(owner, 'p1');
    expect(archivedCalls).toEqual([false]);
    expect(updates).toEqual([]);
  });
});

describe('ProjectService.autoArchiveIfDone — tự đóng hồ sơ khi mọi việc đã xong', () => {
  function autoStore(options: { enabled?: boolean; archivedAt?: string; status?: string } = {}) {
    const archivedCalls: boolean[] = [];
    const saved: unknown[] = [];
    const store = {
      settings: {
        get: async () => (options.enabled === undefined ? undefined : { enabled: options.enabled }),
        set: async (_t: string, _k: string, value: unknown) => {
          saved.push(value);
        },
      },
      project: {
        findById: async () =>
          ({ id: 'p1', status: options.status ?? 'active', archivedAt: options.archivedAt }) as never,
        setArchived: async (_t: string, _id: string, archived: boolean) => {
          archivedCalls.push(archived);
          return { id: 'p1' } as never;
        },
      },
    } as unknown as WorkspaceStore;
    return { store, archivedCalls, saved };
  }

  it('bật tuỳ chọn và mọi việc đã xong hoặc huỷ thì tự vào lưu trữ', async () => {
    const { store, archivedCalls } = autoStore({ enabled: true });
    await new ProjectService(store).autoArchiveIfDone('t1', 'p1', ['done', 'cancelled']);
    expect(archivedCalls).toEqual([true]);
  });

  it('mặc định tắt; còn việc mở, chưa có việc, đã lưu trữ hay đã huỷ thì không đụng tới', async () => {
    const off = autoStore();
    await new ProjectService(off.store).autoArchiveIfDone('t1', 'p1', ['done']);
    const open = autoStore({ enabled: true });
    await new ProjectService(open.store).autoArchiveIfDone('t1', 'p1', ['done', 'in_progress']);
    await new ProjectService(open.store).autoArchiveIfDone('t1', 'p1', []);
    const archived = autoStore({ enabled: true, archivedAt: '2026-10-20T00:00:00.000Z' });
    await new ProjectService(archived.store).autoArchiveIfDone('t1', 'p1', ['done']);
    const cancelled = autoStore({ enabled: true, status: 'cancelled' });
    await new ProjectService(cancelled.store).autoArchiveIfDone('t1', 'p1', ['done']);
    expect([off, open, archived, cancelled].flatMap((entry) => entry.archivedCalls)).toEqual([]);
  });

  it('chỉ quản trị đổi được cài đặt; giá trị phải là Có / Không', async () => {
    const { store, saved } = autoStore();
    const service = new ProjectService(store);
    await expect(service.saveArchiveSettings(owner, { autoArchive: true })).rejects.toMatchObject({ statusCode: 403 });
    const admin = { ...owner, isTenantAdmin: true };
    await service.saveArchiveSettings(admin, { autoArchive: true });
    expect(saved).toEqual([{ enabled: true }]);
    await expect(
      service.saveArchiveSettings(admin, { autoArchive: 'co' as unknown as boolean }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('workspace.project.admin — xem và thao tác mọi dự án', () => {
  const outsider: WorkspaceActor = { ...owner, userId: 'outsider', canAdminProjects: false };
  const projectAdmin: WorkspaceActor = { ...outsider, canAdminProjects: true };

  it('người ngoài dự án không có cờ này bị chặn', async () => {
    const service = new ProjectService(makeStore().store);
    await expect(service.access(outsider, 'p1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('người có cờ vào được dự án không phải thành viên và có đủ quyền cấp dự án', async () => {
    const service = new ProjectService(makeStore().store);
    const access = await service.access(projectAdmin, 'p1');
    expect(access.role).toBeUndefined();
    expect(effectivePermissions(access)).toEqual([...PROJECT_PERMISSIONS]);
    expect(hasProjectPermission(access, 'work_item.delete')).toBe(true);
    expect(hasProjectPermission(access, 'project.manage_members')).toBe(true);
    expect(hasProjectRole(access, 'manager')).toBe(true);
    expect(hasProjectRole(access, 'owner')).toBe(true);
  });

  it('cờ này không biến người dùng thành quản trị tenant', () => {
    expect(seesAllProjects(projectAdmin)).toBe(true);
    expect(projectAdmin.isTenantAdmin).toBe(false);
    expect(projectAdmin.canManage).toBe(false);
  });

  it('người có cờ đặt lại được thành viên dự án mình không tham gia', async () => {
    const { store, saved } = makeStore();
    await new ProjectService(store, directory(['owner', 'ke-toan'])).setMembers(projectAdmin, 'p1', {
      members: [
        { userId: 'owner', role: 'owner' },
        { userId: 'ke-toan', role: 'member' },
      ],
    });
    expect(saved).toHaveLength(1);
  });
});
