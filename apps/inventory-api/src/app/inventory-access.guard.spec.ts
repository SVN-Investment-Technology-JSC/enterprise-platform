import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { InventoryAccessGuard } from './inventory-access.guard';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => ({ payload: { principal: {
    kind: 'tenant-user', userId: 'user', sessionId: 'session', tenantId: 'tenant',
    permissions: ['inventory.manage'],
  } } })),
}));

describe('inventory module capabilities', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  function setup(permissions: string[], path: string, method = 'POST') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({
        allowed: true, database: { tenantId: 'tenant' },
        principal: { tenantId: 'tenant', userId: 'user', displayName: 'User', permissions },
      }),
    });
    const register = jest.fn();
    const guard = new InventoryAccessGuard({ register } as unknown as TenantDatabaseRegistry);
    const request = {
      path: '/api/inventory/v1' + path, method,
      headers: { authorization: 'Bearer token', 'x-csrf-token': 'csrf' },
      cookies: { ep_csrf: 'csrf' },
      inventoryActor: undefined as
        | undefined
        | {
            canManage: boolean;
            canWriteTransactions: boolean;
            canApproveDocuments?: boolean;
            canWriteQuality?: boolean;
          },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard, request, context, register };
  }
  it('ignores stale elevated JWT claims and rejects a read-only mutation', async () => {
    const { guard, context, register } = setup(['inventory.read'], '/materials');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(register).not.toHaveBeenCalled();
  });
  it('allows narrow operations without granting management', async () => {
    const { guard, context, request } = setup(['inventory.read', 'inventory.transaction.write'], '/receipts');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: true });
  });
  it('rejects management for a narrow operator', async () => {
    const { guard, context } = setup(['inventory.read', 'inventory.transaction.write'], '/materials');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
  it('allows read requests without write capabilities', async () => {
    const { guard, context, request } = setup(['inventory.read'], '/materials', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: false });
  });
  it('stock documents: writing needs transaction.write, approving needs document.approve', async () => {
    const writer = ['inventory.read', 'inventory.transaction.write'];
    const create = setup(writer, '/stock-documents');
    await expect(create.guard.canActivate(create.context)).resolves.toBe(true);
    const post = setup(writer, '/stock-documents/abc/post');
    await expect(post.guard.canActivate(post.context)).resolves.toBe(true);
    const approveByWriter = setup(writer, '/stock-documents/abc/approve');
    await expect(approveByWriter.guard.canActivate(approveByWriter.context)).rejects.toMatchObject({ status: 403 });
    const reader = setup(['inventory.read'], '/stock-documents/abc/submit');
    await expect(reader.guard.canActivate(reader.context)).rejects.toMatchObject({ status: 403 });

    const approver = setup(['inventory.read', 'inventory.document.approve'], '/stock-documents/abc/reject');
    await expect(approver.guard.canActivate(approver.context)).resolves.toBe(true);
    expect(approver.request.inventoryActor).toMatchObject({ canApproveDocuments: true, canWriteTransactions: false });
  });
  it('quality status changes need inventory.quality.write, not transaction.write', async () => {
    const writer = ['inventory.read', 'inventory.transaction.write'];
    for (const path of ['/lots/abc/quality', '/serials/SN001/quality']) {
      const denied = setup(writer, path);
      await expect(denied.guard.canActivate(denied.context)).rejects.toMatchObject({ status: 403 });
    }
    const inspector = setup(['inventory.read', 'inventory.quality.write'], '/lots/abc/quality');
    await expect(inspector.guard.canActivate(inspector.context)).resolves.toBe(true);
    expect(inspector.request.inventoryActor).toMatchObject({ canWriteQuality: true, canWriteTransactions: false });

    const serial = setup(['inventory.read', 'inventory.quality.write'], '/serials/SN001/quality');
    await expect(serial.guard.canActivate(serial.context)).resolves.toBe(true);

    // Đọc lô, lịch sử serial chỉ cần quyền đọc.
    const reader = setup(['inventory.read'], '/serials/SN001/history', 'GET');
    await expect(reader.guard.canActivate(reader.context)).resolves.toBe(true);
    expect(reader.request.inventoryActor).toMatchObject({ canWriteQuality: false });
  });
  it('vị trí lưu trữ: sửa dùng chung quyền sửa danh mục (inventory.manage), đọc chỉ cần quyền đọc', async () => {
    const paths: [string, string][] = [
      ['PUT', '/materials/VT-001/storage-locations/KHO-A'],
      ['PUT', '/warehouses/KHO-A/location-levels'],
    ];
    for (const [method, path] of paths) {
      // Người ghi phát sinh tồn kho không đủ quyền sửa danh mục.
      const writer = setup(['inventory.read', 'inventory.transaction.write'], path, method);
      await expect(writer.guard.canActivate(writer.context)).rejects.toMatchObject({ status: 403 });
      const readOnly = setup(['inventory.read'], path, method);
      await expect(readOnly.guard.canActivate(readOnly.context)).rejects.toMatchObject({ status: 403 });
      const manager = setup(['inventory.read', 'inventory.manage'], path, method);
      await expect(manager.guard.canActivate(manager.context)).resolves.toBe(true);
      expect(manager.request.inventoryActor).toMatchObject({ canManage: true });
    }
    for (const path of ['/materials/VT-001/storage-locations', '/warehouses/KHO-A/storage-locations', '/storage-locations']) {
      const reader = setup(['inventory.read'], path, 'GET');
      await expect(reader.guard.canActivate(reader.context)).resolves.toBe(true);
    }
  });
  it('reversing a stock document needs document.approve, not transaction.write (ISS-BE-006)', async () => {
    const writer = setup(['inventory.read', 'inventory.transaction.write'], '/stock-documents/abc/reverse');
    await expect(writer.guard.canActivate(writer.context)).rejects.toMatchObject({
      status: 403,
      response: { message: 'Bạn không có quyền duyệt chứng từ kho.' },
    });
    const approver = setup(['inventory.read', 'inventory.document.approve'], '/stock-documents/abc/reverse');
    await expect(approver.guard.canActivate(approver.context)).resolves.toBe(true);
    expect(approver.request.inventoryActor).toMatchObject({ canApproveDocuments: true });
  });
  it('movement batch maps explicitly to transaction.write, not manage (ISS-BE-046)', async () => {
    const writer = setup(['inventory.read', 'inventory.transaction.write'], '/movements/batch');
    await expect(writer.guard.canActivate(writer.context)).resolves.toBe(true);
    expect(writer.request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: true });
    const reader = setup(['inventory.read'], '/movements/batch');
    await expect(reader.guard.canActivate(reader.context)).rejects.toMatchObject({
      status: 403,
      response: { message: 'Bạn không có quyền ghi phát sinh tồn kho.' },
    });
  });
  it('requisition fulfil maps explicitly to transaction.write; status is a read (ISS-BE-031)', async () => {
    const keeper = setup(['inventory.read', 'inventory.transaction.write'], '/requisitions/PR-001/fulfil');
    await expect(keeper.guard.canActivate(keeper.context)).resolves.toBe(true);
    expect(keeper.request.inventoryActor).toMatchObject({ canManage: false, canWriteTransactions: true });
    const basic = setup(['inventory.read'], '/requisitions/PR-001/fulfil');
    await expect(basic.guard.canActivate(basic.context)).rejects.toMatchObject({
      status: 403,
      response: { message: 'Bạn không có quyền ghi phát sinh tồn kho.' },
    });
    const status = setup(['inventory.read'], '/requisitions/status', 'GET');
    await expect(status.guard.canActivate(status.context)).resolves.toBe(true);
  });
});
