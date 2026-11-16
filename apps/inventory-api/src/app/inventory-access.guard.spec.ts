import type { ExecutionContext } from '@nestjs/common';
import type { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import {
  TENANT_ACTION_IMPLIES,
  TENANT_PERMISSION_ACTIONS,
  tenantActionHeld,
} from '@enterprise-platform/contracts-identity';
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
            canReadCost?: boolean;
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
  // SEC-BE046-02, SEC-BE046-03: phiếu nhiều dòng của thủ kho cần quyền ghi phát sinh, không cần quản lý.
  it('/movements/batch cho thủ kho có inventory.transaction.write', async () => {
    const keeper = setup(['inventory.read', 'inventory.transaction.write'], '/movements/batch');
    await expect(keeper.guard.canActivate(keeper.context)).resolves.toBe(true);
    const reader = setup(['inventory.read'], '/movements/batch');
    await expect(reader.guard.canActivate(reader.context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACCESS_DENIED', message: 'Bạn không có quyền ghi phát sinh tồn kho.' },
    });
  });

  it('đường dẫn chứa chuỗi con của route ghi phát sinh vẫn lấy quyền của chính nó', async () => {
    const keeper = setup(['inventory.read', 'inventory.transaction.write'], '/assets/issues/documents');
    await expect(keeper.guard.canActivate(keeper.context)).rejects.toMatchObject({ status: 403 });
  });

  // SEC-BE046-01: route không khai báo bị từ chối, kể cả với quyền quản lý.
  it('route không khai báo bị từ chối', async () => {
    for (const [path, method] of [['/new-feature', 'POST'], ['/receipts', 'DELETE'], ['/materials/x/y/z', 'GET']]) {
      const { guard, context, register } = setup(['inventory.manage'], path, method);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ROUTE_NOT_DECLARED' },
      });
      expect(register).not.toHaveBeenCalled();
    }
  });
  // SEC-BE013-01: action mới nằm trong danh mục quyền, `inventory.manage` bao hàm.
  it('inventory.cost.read có trong danh mục và được inventory.manage bao hàm', () => {
    expect(TENANT_PERMISSION_ACTIONS.some((action) => action.key === 'inventory.cost.read')).toBe(true);
    expect(TENANT_ACTION_IMPLIES['inventory.manage']).toContain('inventory.cost.read');
    expect(tenantActionHeld(['inventory.manage'], 'inventory.cost.read')).toBe(true);
    expect(tenantActionHeld(['inventory.read'], 'inventory.cost.read')).toBe(false);
  });

  it('cờ canReadCost: chỉ inventory.read thì không; cost.read hoặc manage thì có', async () => {
    const cases: [string[], boolean][] = [
      [['inventory.read'], false],
      [['inventory.read', 'inventory.transaction.write'], false],
      [['inventory.read', 'inventory.cost.read'], true],
      [['inventory.manage'], true],
    ];
    for (const [permissions, expected] of cases) {
      const { guard, context, request } = setup(permissions, '/warehouses/KHO-A/stock', 'GET');
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.inventoryActor?.canReadCost).toBe(expected);
    }
  });
});
