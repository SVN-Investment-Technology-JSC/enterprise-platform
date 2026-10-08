import type { DirectoryResponse } from '@enterprise-platform/contracts-workspace';
import { DirectoryService } from './directory.service.js';
import type { WorkspaceActor } from './workspace.application.js';

const person = (userId: string) => ({ userId, displayName: userId, unitNames: [] as string[] });

function actor(overrides: Partial<WorkspaceActor> = {}): WorkspaceActor {
  return {
    tenantId: 't1',
    userId: 'u1',
    displayName: 'U1',
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: false,
    canDeleteDocuments: false,
    ...overrides,
  };
}

function service(response: DirectoryResponse) {
  return new DirectoryService({ list: async () => response });
}

describe('DirectoryService.list', () => {
  const empty: DirectoryResponse = {
    people: [],
    degraded: false,
    tenantUsers: [person('a'), person('b')],
  };

  it('danh bạ rỗng: người quản lý thấy người dùng đang hoạt động của tenant', async () => {
    for (const privileged of [{ canManage: true }, { isTenantAdmin: true }, { canCreateProjects: true }]) {
      const result = await service(empty).list(actor(privileged));
      expect(result.people.map((p) => p.userId)).toEqual(['a', 'b']);
      expect(result.tenantUsers).toBeUndefined();
    }
  });

  it('danh bạ rỗng: người thường vẫn thấy danh bạ rỗng, không lộ tenantUsers', async () => {
    const result = await service(empty).list(actor());
    expect(result.people).toEqual([]);
    expect(result.tenantUsers).toBeUndefined();
  });

  it('có bổ nhiệm thì giữ nguyên danh bạ, kể cả với người quản lý', async () => {
    const result = await service({ ...empty, people: [person('x')] }).list(actor({ canManage: true }));
    expect(result.people.map((p) => p.userId)).toEqual(['x']);
  });

  it('unknownUserIds đối chiếu với người dùng tenant khi chưa có bổ nhiệm', async () => {
    await expect(service(empty).unknownUserIds('t1', ['a', 'z'])).resolves.toEqual(['z']);
  });
});
