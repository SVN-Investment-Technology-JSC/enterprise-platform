import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';

const manager: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Quản lý kho',
  canManage: true,
  canWriteTransactions: true,
};

const existing = { code: 'M1', name: 'Vật tư', unit: 'Cái', minStock: 0, maxStock: 100 };

function appWith(material: Partial<InventoryStore['material']>) {
  return new InventoryApplication({ material } as unknown as InventoryStore, {} as StockDocumentStore);
}

describe('InventoryApplication đơn giá vật tư', () => {
  it('cập nhật đơn giá hợp lệ, kể cả 0, được chuyển xuống store', async () => {
    const update = jest.fn().mockResolvedValue({ ...existing, purchasePrice: 0 });
    const app = appWith({ findAnyByCode: jest.fn().mockResolvedValue(existing), update });

    await app.updateMaterial(manager, 'M1', { purchasePrice: 0 });
    await app.updateMaterial(manager, 'M1', { purchasePrice: 125000.5 });

    expect(update).toHaveBeenNthCalledWith(1, 't1', 'M1', { purchasePrice: 0 });
    expect(update).toHaveBeenNthCalledWith(2, 't1', 'M1', { purchasePrice: 125000.5 });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'đơn giá %p bị từ chối trước khi chạm DB',
    async (price) => {
      const update = jest.fn();
      const findAnyByCode = jest.fn();
      const app = appWith({ findAnyByCode, update });

      await expect(app.updateMaterial(manager, 'M1', { purchasePrice: price })).rejects.toThrow(
        'Đơn giá phải là số không âm.',
      );
      expect(findAnyByCode).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('tạo vật tư với đơn giá âm bị từ chối', async () => {
    const create = jest.fn();
    const app = appWith({ findAnyByCode: jest.fn(), create });

    await expect(
      app.createMaterial(manager, {
        code: 'M2',
        name: 'Vật tư mới',
        category: 'SPARE_PART',
        unit: 'Cái',
        purchasePrice: -5,
      }),
    ).rejects.toThrow('Đơn giá phải là số không âm.');
    expect(create).not.toHaveBeenCalled();
  });

  it('bỏ trống đơn giá thì không kiểm và giữ nguyên giá cũ', async () => {
    const update = jest.fn().mockResolvedValue(existing);
    const app = appWith({ findAnyByCode: jest.fn().mockResolvedValue(existing), update });

    await app.updateMaterial(manager, 'M1', { name: 'Tên mới' });

    expect(update).toHaveBeenCalledWith('t1', 'M1', { name: 'Tên mới' });
  });
});
