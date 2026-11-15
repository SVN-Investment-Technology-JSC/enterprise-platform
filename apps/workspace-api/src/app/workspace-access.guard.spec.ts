import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { WorkspaceAccessGuard } from './workspace-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({
    payload: {
      principal: {
        kind: 'tenant-user',
        userId: 'user',
        sessionId: 'session',
        tenantId: 'tenant',
        permissions: ['workspace.manage', 'workspace.document.delete'],
      },
    },
  })),
}));

describe('workspace module capabilities', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  function setup(
    permissions: string[],
    path: string,
    method = 'POST',
    roles: string[] = ['tenant-user'],
  ) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        allowed: true,
        database: { tenantId: 'tenant' },
        principal: { tenantId: 'tenant', userId: 'user', displayName: 'User', roles, permissions },
      }),
    });
    const guard = new WorkspaceAccessGuard({ register: jest.fn() } as unknown as TenantDatabaseRegistry);
    const request = {
      path: '/api/workspace/v1' + path,
      method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      workspaceActor: undefined as undefined | Record<string, boolean | string>,
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context };
  }

  it('workspace.manage bao hàm ghi công việc và tài liệu nhưng không bao hàm xóa tài liệu', async () => {
    const write = setup(['workspace.read', 'workspace.manage'], '/work-items');
    await expect(write.guard.canActivate(write.context)).resolves.toBe(true);
    expect(write.request.workspaceActor).toMatchObject({
      canManage: true,
      canWriteTasks: true,
      canWriteDocuments: true,
      canDeleteDocuments: false,
    });
    const del = setup(['workspace.read', 'workspace.manage'], '/documents/1', 'DELETE');
    await expect(del.guard.canActivate(del.context)).rejects.toMatchObject({ status: 403 });
  });

  it('workspace.project.admin ghi được công việc nhưng không thành quản trị danh mục hay xóa tài liệu', async () => {
    const write = setup(['workspace.project.admin'], '/work-items');
    await expect(write.guard.canActivate(write.context)).resolves.toBe(true);
    expect(write.request.workspaceActor).toMatchObject({
      canAdminProjects: true,
      canManage: false,
      isTenantAdmin: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    });
    const del = setup(['workspace.project.admin'], '/documents/1', 'DELETE');
    await expect(del.guard.canActivate(del.context)).rejects.toMatchObject({ status: 403 });
    const plain = setup(['workspace.read'], '/projects', 'GET');
    await plain.guard.canActivate(plain.context);
    expect(plain.request.workspaceActor).toMatchObject({ canAdminProjects: false });
  });

  it('xóa tài liệu được phép khi cấp đích danh hoặc là quản trị tenant', async () => {
    const granted = setup(['workspace.read', 'workspace.document.delete'], '/documents/1', 'DELETE');
    await expect(granted.guard.canActivate(granted.context)).resolves.toBe(true);
    const admin = setup(['workspace.read'], '/documents/1', 'DELETE', ['tenant-admin']);
    await expect(admin.guard.canActivate(admin.context)).resolves.toBe(true);
  });

  it('người chỉ đọc không ghi được và không bị nâng quyền bởi JWT cũ', async () => {
    const { guard, context } = setup(['workspace.read'], '/work-items');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it('ai vào được Workspace cũng đọc được danh mục thao tác Trợ lý', async () => {
    const { guard, context } = setup(['workspace.read'], '/assistant/actions', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  describe('tạo dự án cần workspace.project.create (ISS-BE-014)', () => {
    it('có quyền thì POST /projects được qua và actor mang cờ canCreateProject (SEC-BE014-01)', async () => {
      const { guard, request, context } = setup(
        ['workspace.read', 'workspace.task.write', 'workspace.project.create'],
        '/projects',
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspaceActor).toMatchObject({ canCreateProject: true });
    });

    it('chỉ có quyền ghi công việc (NV Basic) thì POST /projects bị 403 tiếng Việt (SEC-BE014-01)', async () => {
      const { guard, context } = setup(['workspace.read', 'workspace.task.write'], '/projects');
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACCESS_DENIED', message: 'Bạn không có quyền tạo dự án mới.' },
      });
    });

    it('workspace.manage và workspace.project.admin không kéo theo quyền tạo dự án', async () => {
      for (const held of [['workspace.manage'], ['workspace.project.admin']]) {
        const { guard, context } = setup(held, '/projects');
        await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
      }
    });

    it('quản trị tenant tạo được dự án', async () => {
      const all = ['workspace.read', 'workspace.task.write', 'workspace.project.create'];
      const { guard, request, context } = setup(all, '/projects', 'POST', ['tenant-admin']);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspaceActor).toMatchObject({ isTenantAdmin: true, canCreateProject: true });
    });

    it('thao tác ghi khác trên dự án có sẵn vẫn chỉ cần quyền ghi công việc; GET trả cờ false', async () => {
      const update = setup(['workspace.read', 'workspace.task.write'], '/projects/p1/members', 'PUT');
      await expect(update.guard.canActivate(update.context)).resolves.toBe(true);
      const read = setup(['workspace.read'], '/projects', 'GET');
      await expect(read.guard.canActivate(read.context)).resolves.toBe(true);
      expect(read.request.workspaceActor).toMatchObject({ canCreateProject: false });
    });
  });

  it('cờ mở hồ sơ Quy trình lấy từ procedure.instance.create thật của người dùng (ISS-BE-061)', async () => {
    const plain = setup(['workspace.read', 'workspace.task.write', 'procedure.instance.override'], '/work-items');
    await plain.guard.canActivate(plain.context);
    expect(plain.request.workspaceActor).toMatchObject({ canStartProcedures: false });
    const granted = setup(['workspace.read', 'workspace.task.write', 'procedure.instance.create'], '/work-items');
    await granted.guard.canActivate(granted.context);
    expect(granted.request.workspaceActor).toMatchObject({ canStartProcedures: true });
  });
});
