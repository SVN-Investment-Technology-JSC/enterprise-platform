import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;
const run = promisify(execFile);

function script(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) candidate = dirname(candidate);
  return resolve(candidate, 'tools/inventory/backfill-serial-stock-state.mjs');
}

/**
 * Sau rollback rồi triển khai lại: bản cũ khai serial với stock_state NULL. Script đưa lại về Trong kho theo điều
 * kiện của 0013, không vượt tồn; mặc định chỉ xem trước.
 */
integration('Backfill stock_state của serial sau rollback', () => {
  const tenantId = randomUUID();
  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
  };
  let database: TestInventoryDatabase;
  let pool: Pool;

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const app = new InventoryApplication(
      new PostgresInventoryStore(database.references, database.pools),
      new PostgresStockDocumentStore(database.references, database.pools),
    );
    await app.createWarehouse(admin, { code: 'RB-KHO', name: 'Kho rollback' });
    await app.createMaterial(admin, { code: 'RB-MAY', name: 'Máy', category: 'SPARE_PART', unit: 'Cái', isSerialized: true });
    await app.createMaterial(admin, { code: 'RB-CAP', name: 'Cáp', category: 'CONSUMABLE', unit: 'Mét' });
    // Tồn 3 máy nhập không kèm serial (đường cũ), một serial đã Trong kho từ chứng từ.
    await app.receiveStock(admin, { warehouseCode: 'RB-KHO', materialCode: 'RB-MAY', quantity: 2 });
    await app.receiveStock(admin, { warehouseCode: 'RB-KHO', materialCode: 'RB-MAY', quantity: 1, serials: ['RB-00'] });
    await app.receiveStock(admin, { warehouseCode: 'RB-KHO', materialCode: 'RB-CAP', quantity: 5 });
    // Bản cũ khai serial kèm kho: stock_state NULL. Ba serial có kho, một không có kho (không phải ứng viên).
    await pool.query(
      `INSERT INTO inventory_schema.serial_tracking
         (material_id, serial_number, current_status, location_type, current_warehouse_id, created_at)
       SELECT m.id, v.serial, 'OPERATING', 'WAREHOUSE', CASE WHEN v.with_warehouse THEN w.id END, v.created_at
         FROM inventory_schema.materials m, inventory_schema.warehouses w,
              (VALUES ('RB-01', true, now() - interval '3 day'),
                      ('RB-02', true, now() - interval '2 day'),
                      ('RB-03', true, now() - interval '1 day'),
                      ('RB-04', false, now())) AS v(serial, with_warehouse, created_at)
        WHERE m.code = 'RB-MAY' AND w.code = 'RB-KHO'`,
    );
    // Bản cũ xuất bỏ qua phần không Đạt: khả dụng âm.
    await pool.query(
      `UPDATE inventory_schema.material_inventory b SET quantity_blocked = 7
         FROM inventory_schema.materials m
        WHERE m.id = b.material_id AND m.code = 'RB-CAP'`,
    );
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  async function states(): Promise<Record<string, string | null>> {
    const { rows } = await pool.query(
      `SELECT serial_number, stock_state FROM inventory_schema.serial_tracking ORDER BY serial_number`,
    );
    return Object.fromEntries((rows as { serial_number: string; stock_state: string | null }[]).map((row) => [row.serial_number, row.stock_state]));
  }

  it('xem trước không ghi; --apply đưa serial vào Trong kho trong giới hạn tồn; báo khả dụng âm', async () => {
    const preview = await run(process.execPath, [script(), `--database-url=${database.url}`, '--report-negative', '--json']);
    const report = JSON.parse(preview.stdout) as {
      applied: boolean;
      serials: { action: string; serial_number: string }[];
      negativeAvailable: { material_code: string; available: string }[];
    };
    expect(report.applied).toBe(false);
    // Tồn 3, đã có RB-00 Trong kho: chỉ còn chỗ cho 2 serial, ưu tiên serial khai trước.
    expect(report.serials.map((row) => [row.action, row.serial_number])).toEqual([
      ['SE_DUA_VAO_KHO', 'RB-01'],
      ['SE_DUA_VAO_KHO', 'RB-02'],
      ['BO_QUA', 'RB-03'],
    ]);
    expect(report.negativeAvailable).toEqual([expect.objectContaining({ material_code: 'RB-CAP' })]);
    expect(Number(report.negativeAvailable[0].available)).toBe(-2);
    expect(preview.stderr).toContain('xem trước');
    expect(await states()).toMatchObject({ 'RB-01': null, 'RB-02': null, 'RB-03': null });

    const applied = await run(process.execPath, [script(), `--database-url=${database.url}`, '--apply']);
    expect(applied.stderr).toContain('đã đưa 2 vào Trong kho, bỏ qua 1');
    expect(await states()).toEqual({
      'RB-00': 'IN_STOCK',
      'RB-01': 'IN_STOCK',
      'RB-02': 'IN_STOCK',
      'RB-03': null,
      'RB-04': null,
    });

    // Chạy lại: hết chỗ, không đổi gì.
    const again = await run(process.execPath, [script(), `--database-url=${database.url}`, '--apply']);
    expect(again.stderr).toContain('đã đưa 0 vào Trong kho, bỏ qua 1');
  }, 60_000);
});
