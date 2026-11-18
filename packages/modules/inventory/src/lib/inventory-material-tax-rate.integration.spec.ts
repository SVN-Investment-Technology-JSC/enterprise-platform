import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('Thuế suất của mặt hàng', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
    canApproveDocuments: true,
  };
  const base = { name: 'Mặt hàng thử', category: 'CONSUMABLE', unit: 'Cái' } as const;

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    app = new InventoryApplication(store, new PostgresStockDocumentStore(database.references, database.pools));
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('tạo: lưu và đọc lại đúng, giữ phần thập phân; không khai thì để trống', async () => {
    const created = await app.createMaterial(admin, { ...base, code: 'TAX-1', taxRate: 8, salePrice: 100000 });
    expect(created.taxRate).toBe(8);
    const decimal = await app.createMaterial(admin, { ...base, code: 'TAX-2', taxRate: 5.5 });
    expect(decimal.taxRate).toBe(5.5);
    const zero = await app.createMaterial(admin, { ...base, code: 'TAX-0', taxRate: 0 });
    expect(zero.taxRate).toBe(0);
    const none = await app.createMaterial(admin, { ...base, code: 'TAX-NONE' });
    expect(none.taxRate).toBeUndefined();
  });

  it('dịch vụ cũng có thuế suất', async () => {
    const service = await app.createMaterial(admin, { ...base, code: 'TAX-DV', kind: 'SERVICE', taxRate: 10 });
    expect(service).toMatchObject({ kind: 'SERVICE', taxRate: 10 });
  });

  it('sửa: đổi giá trị, bỏ qua thì giữ nguyên, null thì xoá', async () => {
    expect((await app.updateMaterial(admin, 'TAX-1', { taxRate: 10 })).taxRate).toBe(10);
    expect((await app.updateMaterial(admin, 'TAX-1', { name: 'Đổi tên' })).taxRate).toBe(10);
    expect((await app.updateMaterial(admin, 'TAX-1', { taxRate: null })).taxRate).toBeUndefined();
    // 0% khác chưa khai: sửa về 0 thì vẫn là 0.
    expect((await app.updateMaterial(admin, 'TAX-1', { taxRate: 0 })).taxRate).toBe(0);
  });

  it('danh mục nội bộ (cho Bán hàng) trả thuế suất, null khi chưa khai', async () => {
    const page = await app.listMaterialCatalog(admin, { codes: ['TAX-2', 'TAX-NONE'] });
    const byCode = Object.fromEntries(page.materials.map((item) => [item.code, item.taxRate]));
    expect(byCode).toEqual({ 'TAX-2': 5.5, 'TAX-NONE': null });
  });

  it('database chặn ngoài khoảng 0 đến 100 dù đi đường tắt', async () => {
    for (const value of [-1, 100.01]) {
      await expect(
        pool.query(`UPDATE inventory_schema.materials SET tax_rate = $1 WHERE code = 'TAX-2'`, [value]),
      ).rejects.toThrow();
    }
  });
});
