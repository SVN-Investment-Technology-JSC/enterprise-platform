import { emptyDataImportDataset, type DataImportDataset } from '@enterprise-platform/contracts-data-import';
import type { InventoryApplication } from '@enterprise-platform/module-inventory';
import { InventoryDataImportController } from './inventory-data-import.controller';

describe('nhập dữ liệu ban đầu: số dư đầu kỳ của vật tư theo serial (ISS-BE-005, Q3-2)', () => {
  const app = {
    listAllWarehouses: jest.fn(async () => [{ code: 'KHO-1' }]),
    listMaterials: jest.fn(async () => [
      { code: 'VT-A', isSerialized: false },
      { code: 'VT-SR', isSerialized: true },
    ]),
    listAssets: jest.fn(async () => []),
    getSettings: jest.fn(async () => ({ 'catalog.asset': { version: 0, value: {} } })),
    receiveStock: jest.fn(),
  } as unknown as InventoryApplication;
  const controller = new InventoryDataImportController(app);
  const request = { inventoryActor: { tenantId: 'tenant' } } as never;

  const dataset = (patch: Partial<DataImportDataset>): DataImportDataset => ({
    ...emptyDataImportDataset(),
    ...patch,
  });

  it('báo lỗi đúng dòng vật tư serial (có sẵn hoặc khai trong tệp); dòng khác vẫn hợp lệ', async () => {
    const result = await controller.validate(request, {
      dataset: dataset({
        inventoryMaterials: [
          { code: 'VT-SR-MOI', name: 'Máy mới', category: 'SPARE_PART', unit: 'Cái', isSerialized: true },
        ],
        inventoryOpeningStock: [
          { warehouseCode: 'KHO-1', materialCode: 'VT-A', quantity: 10, unitCost: 1 },
          { warehouseCode: 'KHO-1', materialCode: 'VT-SR', quantity: 3, unitCost: 1 },
          { warehouseCode: 'KHO-1', materialCode: 'VT-SR-MOI', quantity: 1, unitCost: 1 },
        ],
      }),
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'OPENING_STOCK_SERIALIZED', sheet: 'OPENING_STOCK', row: 3 }),
      expect.objectContaining({ code: 'OPENING_STOCK_SERIALIZED', sheet: 'OPENING_STOCK', row: 4 }),
    ]);
    expect(result.issues[0].message).toBe(
      'Vật tư VT-SR theo dõi theo serial nên không nhập số dư đầu kỳ bằng tệp; hãy lập phiếu nhập kèm đủ serial.',
    );
  });

  it('bước chạy từ chối cả tệp, không ghi số dư nào', async () => {
    await expect(
      controller.execute(request, {
        dataset: dataset({
          inventoryOpeningStock: [{ warehouseCode: 'KHO-1', materialCode: 'VT-SR', quantity: 1, unitCost: 1 }],
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(app.receiveStock).not.toHaveBeenCalled();
  });
});
