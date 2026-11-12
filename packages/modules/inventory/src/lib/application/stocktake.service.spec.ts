import type { StocktakeSession } from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import type { InventoryActor } from './inventory.application.js';
import type { StocktakeStore } from './stocktake-store.port.js';
import { StocktakeService } from './stocktake.service.js';

function actor(overrides: Partial<InventoryActor> = {}): InventoryActor {
  return {
    tenantId: 'tenant-1',
    userId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Thủ kho',
    canManage: false,
    canWriteTransactions: true,
    canApproveStocktake: false,
    ...overrides,
  };
}

const sampleSession: StocktakeSession = {
  id: 'st-1',
  code: 'KK-2026-00001',
  title: 'Kiểm kê định kỳ',
  warehouseId: 'wh-1',
  warehouseCode: 'KHO-A',
  status: 'DRAFT',
  scopeType: 'ALL',
  totalItems: 0,
  countedItems: 0,
  differenceItems: 0,
  totalVarianceValue: 0,
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:00Z',
};

function makeStore(overrides: Partial<StocktakeStore> = {}): StocktakeStore {
  return {
    listSessions: jest.fn(async () => [sampleSession]),
    listLines: jest.fn(async () => []),
    latestByMaterial: jest.fn(async () => null),
    createSession: jest.fn(async () => sampleSession),
    startCounting: jest.fn(async () => ({ session: { ...sampleSession, status: 'COUNTING' as const }, lines: [] })),
    saveLines: jest.fn(async () => ({ session: { ...sampleSession, status: 'COUNTING' as const }, lines: [] })),
    submitForApproval: jest.fn(async () => ({ ...sampleSession, status: 'PENDING_APPROVAL' as const })),
    approveAndPost: jest.fn(async () => ({
      session: { ...sampleSession, status: 'POSTED' as const },
      transactionsCreated: 2,
    })),
    rejectSession: jest.fn(async () => ({ ...sampleSession, status: 'COUNTING' as const })),
    cancelSession: jest.fn(async () => ({ ...sampleSession, status: 'CANCELLED' as const })),
    ...overrides,
  };
}

describe('StocktakeService', () => {
  it('allows warehouse operator to create, start, save lines, and submit', async () => {
    const store = makeStore();
    const service = new StocktakeService(store);
    const op = actor();

    const created = await service.createSession(op, {
      title: 'Kiểm kê định kỳ',
      warehouseCode: 'KHO-A',
      scopeType: 'ALL',
    });
    expect(created.code).toBe('KK-2026-00001');

    await service.startCounting(op, 'st-1');
    await service.saveLines(op, 'st-1', [{ lineId: 'l-1', actualQuantity: 5 }]);
    await service.submitForApproval(op, 'st-1');

    expect(store.saveLines).toHaveBeenCalledWith('tenant-1', 'st-1', [{ lineId: 'l-1', actualQuantity: 5 }], 'Thủ kho');
  });

  it('rejects createSession when title or warehouseCode is missing', () => {
    const service = new StocktakeService(makeStore());
    expect(() =>
      service.createSession(actor(), { title: ' ', warehouseCode: 'KHO-A', scopeType: 'ALL' }),
    ).toThrow(InventoryError);
    expect(() =>
      service.createSession(actor(), { title: 'KK', warehouseCode: '', scopeType: 'ALL' }),
    ).toThrow(InventoryError);
  });

  it('forbids warehouse operator without inventory.stocktake.approve from approving or rejecting', () => {
    const service = new StocktakeService(makeStore());
    const op = actor({ canApproveStocktake: false, canManage: false });

    expect(() => service.approveAndPost(op, 'st-1')).toThrow(InventoryError);
    expect(() => service.rejectSession(op, 'st-1', 'Đếm lại')).toThrow(InventoryError);
  });

  it('allows approver with inventory.stocktake.approve to approve and post', async () => {
    const store = makeStore();
    const service = new StocktakeService(store);
    const approver = actor({ canWriteTransactions: false, canApproveStocktake: true });

    const res = await service.approveAndPost(approver, 'st-1');
    expect(res.session.status).toBe('POSTED');
    expect(res.transactionsCreated).toBe(2);
    expect(store.approveAndPost).toHaveBeenCalledWith('tenant-1', 'st-1', approver.userId);
  });
});
