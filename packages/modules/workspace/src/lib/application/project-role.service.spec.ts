import {
  PROJECT_PERMISSIONS,
  type ProjectPermission,
  type WorkItem,
} from '@enterprise-platform/contracts-workspace';
import { ProjectRoleService } from './project-role.service.js';
import { hasProjectPermission, hasProjectRole, type ProjectAccess } from './project.service.js';
import { relatedItems } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

interface RoleRow {
  key: string;
  name: string;
  permissions: ProjectPermission[];
  isSystem: boolean;
  sortOrder: number;
  memberCount: number;
}

function makeStore(rows: RoleRow[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const store = {
    roleDefinition: {
      list: async () => rows,
      create: async (...args: unknown[]) => calls.push({ op: 'create', args }),
      update: async (...args: unknown[]) => calls.push({ op: 'update', args }),
      remove: async (...args: unknown[]) => calls.push({ op: 'remove', args }),
    },
  } as unknown as WorkspaceStore;
  return { store, calls };
}

const systemRows = (): RoleRow[] => [
  { key: 'owner', name: 'Chủ nhiệm', permissions: [], isSystem: true, sortOrder: 0, memberCount: 3 },
  {
    key: 'member',
    name: 'Thành viên',
    permissions: ['project.view_all', 'project.update_related'],
    isSystem: true,
    sortOrder: 2,
    memberCount: 5,
  },
  {
    key: 'custom_qa',
    name: 'Kiểm soát',
    permissions: ['project.view_related'],
    isSystem: false,
    sortOrder: 9,
    memberCount: 0,
  },
];

const admin: WorkspaceActor = {
  tenantId: 't1',
  userId: 'admin',
  displayName: 'Admin',
  isTenantAdmin: true,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};
const plain: WorkspaceActor = { ...admin, userId: 'u1', isTenantAdmin: false, canManage: false };

const access = (role: string, permissions: ProjectPermission[]): ProjectAccess => ({
  project: {} as never,
  role,
  isTenantAdmin: false,
  permissions,
});

describe('hasProjectRole — suy mức thẩm quyền từ quyền của vai', () => {
  it('vai tự định nghĩa chỉ "cập nhật dự án liên quan" đạt mức member, không đạt manager', () => {
    const grant = access('custom_x', ['project.view_related', 'project.update_related']);
    expect(hasProjectRole(grant, 'viewer')).toBe(true);
    expect(hasProjectRole(grant, 'member')).toBe(true);
    expect(hasProjectRole(grant, 'manager')).toBe(false);
    expect(hasProjectRole(grant, 'owner')).toBe(false);
  });

  it('vai có "cập nhật toàn bộ dự án" đạt mức manager nhưng không phải chủ nhiệm', () => {
    const grant = access('custom_y', ['project.update_all']);
    expect(hasProjectRole(grant, 'manager')).toBe(true);
    expect(hasProjectRole(grant, 'owner')).toBe(false);
  });

  it('chủ nhiệm luôn đủ quyền dù cấu hình trả rỗng', () => {
    const grant = access('owner', []);
    expect(hasProjectPermission(grant, 'work_item.delete')).toBe(true);
    expect(hasProjectRole(grant, 'owner')).toBe(true);
  });

  it('vai hệ thống chưa có cấu hình thì dùng quyền mặc định', () => {
    const grant: ProjectAccess = { project: {} as never, role: 'viewer', isTenantAdmin: false };
    expect(hasProjectPermission(grant, 'project.view_all')).toBe(true);
    expect(hasProjectRole(grant, 'member')).toBe(false);
  });
});

describe('ProjectRoleService', () => {
  it('quyền của vai lạ (đã xoá) chỉ còn xem phần liên quan', async () => {
    const { store } = makeStore(systemRows());
    expect(await new ProjectRoleService(store).permissionsOf('t1', 'custom_gone')).toEqual([
      'project.view_related',
    ]);
  });

  it('người không phải quản trị không thêm được vai', async () => {
    const { store, calls } = makeStore(systemRows());
    await expect(
      new ProjectRoleService(store).create(plain, { name: 'Mới', permissions: [] }),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
    expect(calls).toHaveLength(0);
  });

  it('thêm vai: bỏ quyền lạ, chặn tên trùng', async () => {
    const { store, calls } = makeStore(systemRows());
    const service = new ProjectRoleService(store);
    await service.create(admin, {
      name: '  Giám sát   kỹ thuật ',
      permissions: ['work_item.cancel', 'hack' as ProjectPermission, 'project.view_all'],
    });
    expect(calls[0].args[2]).toMatchObject({
      name: 'Giám sát kỹ thuật',
      permissions: ['project.view_all', 'work_item.cancel'],
    });
    await expect(
      service.create(admin, { name: 'thành viên', permissions: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('sửa chủ nhiệm chỉ đổi được tên, quyền luôn đủ', async () => {
    const { store, calls } = makeStore(systemRows());
    await new ProjectRoleService(store).update(admin, 'owner', {
      name: 'Chủ trì',
      permissions: [],
    });
    expect(calls[0].args[3]).toEqual({ name: 'Chủ trì', permissions: PROJECT_PERMISSIONS });
  });

  it('không xoá được vai mặc định hay vai đang có người giữ', async () => {
    const rows = systemRows();
    rows[2].memberCount = 2;
    const { store, calls } = makeStore(rows);
    const service = new ProjectRoleService(store);
    await expect(service.remove(admin, 'member')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.remove(admin, 'custom_qa')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('relatedItems — phạm vi "Xem dự án liên quan"', () => {
  const node = (id: string, parentId?: string, assigneeUserId?: string): WorkItem => ({
    id,
    parentId,
    assigneeUserId,
    projectId: 'p1',
    code: id,
    title: id,
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'someone',
    createdAt: '',
    updatedAt: '',
  });

  it('giữ việc của mình, nhánh cha và nhánh con; bỏ việc không liên quan', () => {
    const items = [
      node('root'),
      node('phase', 'root'),
      node('mine', 'phase', 'u1'),
      node('child', 'mine'),
      node('other', 'phase', 'u2'),
      node('elsewhere'),
    ];
    expect(relatedItems(items, 'u1').map((item) => item.id)).toEqual([
      'root',
      'phase',
      'mine',
      'child',
    ]);
  });
});
