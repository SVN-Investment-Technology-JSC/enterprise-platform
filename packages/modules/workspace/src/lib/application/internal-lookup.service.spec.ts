import { InternalLookupService } from './internal-lookup.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Bên gọi nội bộ: đúng danh tính mà guard gắn cho lời gọi service-to-service. */
const service: WorkspaceActor = {
  tenantId: 't1',
  userId: '00000000-0000-4000-8000-000000000004',
  displayName: 'Hệ thống',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: false,
  canDeleteDocuments: false,
};

function makeStore() {
  const project = {
    id: 'p1',
    code: 'DA-1',
    name: 'Dự án một',
    description: 'Mô tả nội bộ',
    status: 'active',
    ownerUserId: 'u-owner',
    progressPercent: 40,
    metadata: { secret: true },
    createdBy: 'u-owner',
    createdAt: '',
    updatedAt: '',
  };
  const item = {
    id: 'w1',
    projectId: 'p1',
    code: 'CV-1',
    title: 'Lắp đặt',
    description: 'Không được lộ',
    itemType: 'task',
    executionType: 'procedure',
    status: 'in_progress',
    priority: 'high',
    assigneeUserId: 'u1',
    progressPercent: 50,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    createdAt: '',
    updatedAt: '',
  };
  // Không có `finance`, `member` trong store giả: service lỡ gọi tới là test vỡ.
  return {
    project: {
      findById: async (_tenant: string, id: string) => (id === 'p1' ? project : undefined),
      rollup: async () => [{ projectId: 'p1', totalItems: 10, closedItems: 4, overdueItems: 1 }],
    },
    workItem: {
      findById: async (_tenant: string, id: string) => (id === 'w1' ? item : undefined),
    },
  } as unknown as WorkspaceStore;
}

describe('InternalLookupService', () => {
  it('trả nhãn công việc kèm dự án, không kèm mô tả', async () => {
    const result = await new InternalLookupService(makeStore()).workItem(service, 'w1');
    expect(result).toMatchObject({
      code: 'CV-1',
      status: 'in_progress',
      project: { id: 'p1', code: 'DA-1', name: 'Dự án một', status: 'active' },
      launchUrl: '/modules/workspace',
    });
    expect(result).not.toHaveProperty('description');
  });

  it('dự án: có số liệu tiến độ, không có tài chính, mô tả hay metadata', async () => {
    const result = await new InternalLookupService(makeStore()).project(service, 'p1');
    expect(result).toMatchObject({ totalItems: 10, closedItems: 4, overdueItems: 1 });
    expect(result).not.toHaveProperty('finance');
    expect(result).not.toHaveProperty('description');
    expect(result).not.toHaveProperty('metadata');
  });

  it('id không tồn tại thì 404 đúng mã', async () => {
    const lookup = new InternalLookupService(makeStore());
    await expect(lookup.workItem(service, 'khong-co')).rejects.toMatchObject({
      code: 'WORK_ITEM_NOT_FOUND',
    });
    await expect(lookup.project(service, 'khong-co')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });
});
