import type { ProjectGroup } from '@enterprise-platform/contracts-workspace';
import { ProjectGroupService } from './project-group.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

function makeStore(rows: ProjectGroup[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const store = {
    projectGroup: {
      list: async () => rows,
      create: async (...args: unknown[]) => calls.push({ op: 'create', args }),
      rename: async (...args: unknown[]) => calls.push({ op: 'rename', args }),
      remove: async (...args: unknown[]) => calls.push({ op: 'remove', args }),
    },
  } as unknown as WorkspaceStore;
  return { store, calls };
}

const groups = (): ProjectGroup[] => [
  { id: 'g1', name: 'Dịch vụ thí nghiệm', sortOrder: 100, projectCount: 4 },
  { id: 'g2', name: 'Bán hàng ngoài EVN', sortOrder: 100, projectCount: 0 },
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

describe('ProjectGroupService — danh mục nhóm dự án', () => {
  it('ai cũng đọc được; chỉ quản trị được sửa', async () => {
    const { store } = makeStore(groups());
    const service = new ProjectGroupService(store);
    expect((await service.list(plain)).canEdit).toBe(false);
    expect((await service.list(admin)).canEdit).toBe(true);
    await expect(service.create(plain, { name: 'Bảo trì' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(plain, 'g1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('tạo nhóm: gọn khoảng trắng, chặn trùng tên không phân biệt hoa thường', async () => {
    const { store, calls } = makeStore(groups());
    const service = new ProjectGroupService(store);
    await service.create(admin, { name: '  Bảo   trì ' });
    expect(calls).toEqual([{ op: 'create', args: ['t1', 'admin', 'Bảo trì', null] }]);
    await expect(service.create(admin, { name: 'dịch vụ THÍ nghiệm' })).rejects.toThrow(
      'Đã có nhóm dự án tên',
    );
    await expect(service.create(admin, { name: '  ' })).rejects.toThrow('không được để trống');
  });

  it('đổi tên được giữ nguyên tên cũ của chính nó; nhóm lạ báo 404', async () => {
    const { store, calls } = makeStore(groups());
    const service = new ProjectGroupService(store);
    await service.rename(admin, 'g1', { name: 'Dịch vụ Thí nghiệm' });
    expect(calls[0]).toEqual({ op: 'rename', args: ['t1', 'admin', 'g1', 'Dịch vụ Thí nghiệm'] });
    await expect(service.rename(admin, 'g1', { name: 'Bán hàng ngoài evn' })).rejects.toThrow(
      'Đã có nhóm dự án tên',
    );
    await expect(service.rename(admin, 'gx', { name: 'Mới' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('mã viết tắt: in hoa, chỉ chữ và số, không trùng nhóm khác; sửa không gửi mã thì giữ mã cũ', async () => {
    const list: ProjectGroup[] = [
      { id: 'g1', name: 'Dịch vụ thí nghiệm', sortOrder: 100, code: 'DVTN', projectCount: 0 },
      { id: 'g2', name: 'Kiểm định', sortOrder: 100, projectCount: 0 },
    ];
    const { store, calls } = makeStore(list);
    const service = new ProjectGroupService(store);
    await service.create(admin, { name: 'Bảo trì', code: ' bt ' });
    expect(calls[0]).toEqual({ op: 'create', args: ['t1', 'admin', 'Bảo trì', 'BT'] });
    await expect(service.create(admin, { name: 'Khác', code: 'dvtn' })).rejects.toThrow('đã dùng cho nhóm');
    await expect(service.create(admin, { name: 'Khác', code: 'KĐ-1' })).rejects.toThrow('chỉ gồm chữ in hoa');

    await service.rename(admin, 'g2', { name: 'Kiểm định' });
    expect(calls[1]?.args[4]).toBeUndefined();
    await service.rename(admin, 'g1', { name: 'Dịch vụ thí nghiệm', code: '' });
    expect(calls[2]?.args[4]).toBeNull();
  });

  it('nhóm của dự án phải có trong danh mục và lấy đúng cách viết trong danh mục', async () => {
    const { store } = makeStore(groups());
    const service = new ProjectGroupService(store);
    await expect(service.resolve('t1', 'dịch vụ thí nghiệm')).resolves.toBe('Dịch vụ thí nghiệm');
    await expect(service.resolve('t1', '')).resolves.toBeNull();
    await expect(service.resolve('t1', null)).resolves.toBeNull();
    await expect(service.resolve('t1', 'Không có')).rejects.toThrow('chưa có trong danh mục');
  });
});
