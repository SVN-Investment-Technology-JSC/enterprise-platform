import type { ProjectGroup } from '@enterprise-platform/contracts-workspace';
import { ProjectCodeService } from './project-code.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

function makeStore(options: { template?: string; codes?: string[]; groups?: ProjectGroup[] } = {}) {
  const saved: { key: string; value: unknown }[] = [];
  const store = {
    settings: {
      get: async () => (options.template ? { template: options.template } : undefined),
      set: async (_tenant: string, key: string, value: unknown) => {
        saved.push({ key, value });
      },
    },
    project: { codesMatching: async () => options.codes ?? [] },
    projectGroup: { list: async () => options.groups ?? [] },
  } as unknown as WorkspaceStore;
  return { store, saved };
}

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
const year = new Date().getFullYear();

describe('ProjectCodeService — quy tắc mã dự án', () => {
  it('chưa đặt thì dùng quy tắc mặc định; ai cũng đọc, chỉ quản trị sửa', async () => {
    const { store } = makeStore();
    const service = new ProjectCodeService(store);
    expect(await service.settings(plain)).toMatchObject({ template: 'DA-{NAM}-{SO:3}', isDefault: true, canEdit: false });
    await expect(service.saveRule(plain, { template: 'DA_{SO:4}' })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lưu quy tắc đã chuẩn hoá; quy tắc sai bị từ chối kèm lý do', async () => {
    const { store, saved } = makeStore();
    const service = new ProjectCodeService(store);
    await service.saveRule(admin, { template: ' da_{nhom}_{so:4} ' });
    expect(saved).toEqual([{ key: 'project_code_rule', value: { template: 'DA_{NHOM}_{SO:4}' } }]);
    await expect(service.saveRule(admin, { template: 'DA_{NAM}' })).rejects.toThrow('đúng một token số thứ tự');
  });

  it('xem trước theo nhóm: lấy mã viết tắt của nhóm, số kế tiếp sau mã đã có', async () => {
    const { store } = makeStore({
      template: 'DA_{NHOM}_{SO:4}',
      codes: ['DA_DVTN_0001', 'DA_DVTN_0002'],
      groups: [{ id: 'g1', name: 'Dịch vụ thí nghiệm', sortOrder: 1, code: 'DVTN', projectCount: 2 }],
    });
    const service = new ProjectCodeService(store);
    expect(await service.preview(admin, 'dịch vụ thí nghiệm')).toEqual({ code: 'DA_DVTN_0003' });
  });

  it('nhóm chưa có mã viết tắt hay chưa chọn nhóm: xem trước trả lý do, tạo dự án thì báo lỗi kiểm tra', async () => {
    const { store } = makeStore({
      template: 'DA_{NHOM}_{SO:4}',
      groups: [{ id: 'g2', name: 'Kiểm định', sortOrder: 1, projectCount: 0 }],
    });
    const service = new ProjectCodeService(store);
    expect((await service.preview(admin, 'Kiểm định')).error).toContain('"Kiểm định" chưa có mã viết tắt');
    expect((await service.preview(admin)).error).toContain('chọn nhóm dự án');
    await expect(service.partsFor('t1', 'Kiểm định')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('quy tắc theo năm', async () => {
    const { store } = makeStore({ template: 'DA_{NAM}_{SO:3}', codes: [`DA_${year}_041`] });
    expect(await new ProjectCodeService(store).preview(admin)).toEqual({ code: `DA_${year}_042` });
  });
});
