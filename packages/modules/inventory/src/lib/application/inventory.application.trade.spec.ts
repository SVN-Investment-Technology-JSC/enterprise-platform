import type { Material } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';

const manager: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Hải',
  canManage: true,
  canWriteTransactions: true,
};

function setup() {
  const material = {
    findAnyByCode: jest.fn(async (): Promise<Material | null> => null),
    create: jest.fn(async (_t: string, input: { code: string }) => ({ ...input }) as unknown as Material),
    update: jest.fn(async () => ({ code: 'VT-1', kind: 'STOCK' }) as unknown as Material),
    hasStockFootprint: jest.fn(async () => false),
  };
  const store = { material } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, {} as StockDocumentStore), material };
}

const base = { code: 'vt-1', name: 'Cáp', category: 'CONSUMABLE', unit: 'Mét' } as const;

describe('InventoryApplication hình thức kinh doanh và giá bán', () => {
  it('tạo: ghi tên người tạo và truyền hình thức, giá bán xuống kho dữ liệu', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, tradeMode: 'SALE_ONLY', salePrice: 45000 });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ code: 'VT-1', tradeMode: 'SALE_ONLY', salePrice: 45000 }),
      'Hải',
    );
  });

  it('tạo: nhận cách sử dụng và phân loại tự khai, truyền xuống kho dữ liệu', async () => {
    const { app, material } = setup();
    await app.createMaterial(manager, { ...base, tradeMode: 'Đi kèm combo', tradeCategory: 'Cáp điện' });
    expect(material.create).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ tradeMode: 'Đi kèm combo', tradeCategory: 'Cáp điện' }),
      'Hải',
    );
  });

  it('tạo: từ chối cách sử dụng, phân loại rỗng hoặc quá dài và giá bán âm', async () => {
    const { app, material } = setup();
    await expect(app.createMaterial(manager, { ...base, tradeMode: '   ' })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, tradeMode: 'x'.repeat(101) })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, tradeCategory: 'y'.repeat(101) })).rejects.toThrow('Phân loại');
    await expect(app.createMaterial(manager, { ...base, tradeMode: 5 as never })).rejects.toThrow('Cách sử dụng');
    await expect(app.createMaterial(manager, { ...base, salePrice: -1 })).rejects.toThrow('Giá bán');
    expect(material.create).not.toHaveBeenCalled();
  });

  it('sửa: cũng chặn nhãn không hợp lệ và giá bán không phải số, vẫn nhận mã cũ', async () => {
    const { app, material } = setup();
    material.findAnyByCode.mockResolvedValue({ code: 'VT-1', kind: 'STOCK', minStock: 0, maxStock: 0 } as unknown as Material);
    await expect(app.updateMaterial(manager, 'VT-1', { tradeMode: '' })).rejects.toThrow('Cách sử dụng');
    await expect(app.updateMaterial(manager, 'VT-1', { tradeCategory: '  ' })).rejects.toThrow('Phân loại');
    await expect(app.updateMaterial(manager, 'VT-1', { salePrice: Number.NaN })).rejects.toThrow('Giá bán');
    await app.updateMaterial(manager, 'VT-1', { tradeMode: 'GIFT_ONLY', salePrice: 0 });
    expect(material.update).toHaveBeenCalledTimes(1);
  });
});
