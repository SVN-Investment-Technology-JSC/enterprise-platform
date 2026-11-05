import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const run = promisify(execFile);
const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

function initAvgCostScript(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) candidate = dirname(candidate);
  return resolve(candidate, 'tools/inventory/init-avg-cost.mjs');
}

integration('Giá vốn bình quân trên PostgreSQL (INV-09, INV-10, D4, D6)', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;

  const actor = (name: string, rights: Partial<InventoryActor>): InventoryActor => ({
    tenantId,
    userId: randomUUID(),
    displayName: name,
    canManage: false,
    canWriteTransactions: true,
    canApproveDocuments: false,
    ...rights,
  });
  const admin = actor('Quản trị kho', { canManage: true, canApproveDocuments: true });
  const clerk = actor('Thủ kho', {});
  let seq = 0;

  async function material(prefix: string, extra: Record<string, unknown> = {}): Promise<string> {
    seq += 1;
    const code = `${prefix}-${seq}`;
    await app.createMaterial(admin, { code, name: `Hàng ${code}`, category: 'SPARE_PART', unit: 'Cái', ...extra });
    return code;
  }

  async function balance(warehouseCode: string, materialCode: string) {
    const { rows } = await pool.query(
      `SELECT b.quantity, b.avg_cost
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouseCode, materialCode],
    );
    return { quantity: Number(rows[0]?.quantity ?? 0), avgCost: Number(rows[0]?.avg_cost ?? 0) };
  }

  async function receive(warehouseCode: string, materialCode: string, quantity: number, unitCost: number) {
    const draft = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode,
      lines: [{ materialCode, quantity, unitCost }],
    });
    return documents.post(clerk, draft.id);
  }

  async function issue(warehouseCode: string, materialCode: string, quantity: number) {
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_PROJECT',
      warehouseCode,
      lines: [{ materialCode, quantity, unitCost: 1 }],
    });
    return documents.post(clerk, draft.id);
  }

  async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string }> {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string };
    }
    throw new Error('expected rejection');
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore);
    documents = new StockDocumentService(documentStore, store);
    for (const code of ['KHO-A', 'KHO-B']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('TC-INV-17: nhập 10 @100.000 rồi 10 @120.000 cho bình quân 110.000', async () => {
    const code = await material('GV17');
    await receive('KHO-A', code, 10, 100_000);
    await receive('KHO-A', code, 10, 120_000);
    expect(await balance('KHO-A', code)).toEqual({ quantity: 20, avgCost: 110_000 });
  });

  it('TC-INV-18, TC-INV-21: nhập xen xuất; dòng xuất ghi giá vốn theo bình quân', async () => {
    const code = await material('GV18');
    await receive('KHO-A', code, 10, 100_000);
    const out = await issue('KHO-A', code, 4);
    // Đơn giá người nhập trên dòng xuất bị thay bằng bình quân lúc ghi sổ.
    expect(out.document.lines[0]).toMatchObject({ unitCost: 100_000, costAmount: 400_000 });
    expect(out.transactions[0].unitCost).toBe(100_000);
    expect(await balance('KHO-A', code)).toEqual({ quantity: 6, avgCost: 100_000 });
    await receive('KHO-A', code, 6, 130_000);
    expect((await balance('KHO-A', code)).avgCost).toBe(115_000);
    await receive('KHO-A', code, 4, 90_000);
    expect(await balance('KHO-A', code)).toEqual({ quantity: 16, avgCost: 108_750 });

    const three = await issue('KHO-A', code, 3);
    expect(three.document.lines[0]).toMatchObject({ unitCost: 108_750, costAmount: 326_250 });
  });

  it('TC-INV-21: bình quân 110.000, xuất 3 cái thì cost_amount 330.000', async () => {
    const code = await material('GV21');
    await receive('KHO-A', code, 10, 100_000);
    await receive('KHO-A', code, 10, 120_000);
    const out = await issue('KHO-A', code, 3);
    const { rows } = await pool.query(
      `SELECT unit_cost, cost_amount FROM inventory_schema.stock_document_lines WHERE document_id = $1`,
      [out.document.id],
    );
    expect(rows.map((row) => [Number(row.unit_cost), Number(row.cost_amount)])).toEqual([[110_000, 330_000]]);
  });

  it('TC-INV-19: bình quân 100.000,5714 (4 chữ số thập phân)', async () => {
    const code = await material('GV19');
    await receive('KHO-A', code, 3, 100_000);
    await receive('KHO-A', code, 4, 100_001);
    const after = await balance('KHO-A', code);
    expect(after.avgCost).toBe(100_000.5714);
    expect(Math.abs(after.avgCost * 7 - 700_004)).toBeLessThanOrEqual(1);
  });

  it('TC-INV-20: nhập trả hàng bán lấy giá vốn dòng xuất gốc; không có dòng gốc thì bình quân hiện tại', async () => {
    const code = await material('GV20');
    await receive('KHO-A', code, 10, 100_000);
    await receive('KHO-A', code, 10, 120_000);
    const out = await issue('KHO-A', code, 5); // giá vốn 110.000
    await receive('KHO-A', code, 15, 130_000); // bình quân (15×110.000 + 15×130.000) / 30 = 120.000
    expect(await balance('KHO-A', code)).toEqual({ quantity: 30, avgCost: 120_000 });

    const back = await documents.create(clerk, {
      docType: 'RECEIPT_SALES_RETURN',
      warehouseCode: 'KHO-A',
      lines: [{ materialCode: code, quantity: 1, unitCost: 999, sourceLineId: out.document.lines[0].id }],
    });
    const posted = await documents.post(clerk, back.id);
    expect(posted.document.lines[0]).toMatchObject({ unitCost: 110_000, costAmount: 110_000 });
    // (30 × 120.000 + 110.000) / 31 = 119.677,4194
    expect(await balance('KHO-A', code)).toEqual({ quantity: 31, avgCost: 119_677.4194 });

    const noSource = await documents.create(clerk, {
      docType: 'RECEIPT_SALES_RETURN',
      warehouseCode: 'KHO-A',
      lines: [{ materialCode: code, quantity: 1, unitCost: 1 }],
    });
    expect((await documents.post(clerk, noSource.id)).document.lines[0].unitCost).toBe(119_677.4194);

    // Dòng gốc không phải dòng xuất đã ghi sổ của cùng mặt hàng.
    const wrong = await documents.create(clerk, {
      docType: 'RECEIPT_SALES_RETURN',
      warehouseCode: 'KHO-A',
      lines: [{ materialCode: code, quantity: 1, sourceLineId: back.lines[0].id }],
    });
    expect((await rejection(documents.post(clerk, wrong.id))).code).toBe('RETURN_SOURCE_LINE_INVALID');
  });

  it('TC-CONC-10: hai chứng từ nhập song song cùng mặt hàng cho bình quân 110.000, tồn 20', async () => {
    const code = await material('GVC10');
    const first = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO-B',
      lines: [{ materialCode: code, quantity: 10, unitCost: 100_000 }],
    });
    const second = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO-B',
      lines: [{ materialCode: code, quantity: 10, unitCost: 120_000 }],
    });
    await Promise.all([documents.post(clerk, first.id), documents.post(clerk, second.id)]);
    expect(await balance('KHO-B', code)).toEqual({ quantity: 20, avgCost: 110_000 });
  });

  it('điều chuyển mang giá bình quân kho đi sang kho đến', async () => {
    const code = await material('GVTF');
    await receive('KHO-A', code, 10, 100_000);
    await receive('KHO-B', code, 10, 200_000);
    const moved = await documents.create(clerk, {
      docType: 'TRANSFER',
      warehouseCode: 'KHO-A',
      targetWarehouseCode: 'KHO-B',
      lines: [{ materialCode: code, quantity: 10 }],
    });
    const posted = await documents.post(clerk, moved.id);
    expect(posted.transactions.map((row) => row.unitCost)).toEqual([100_000, 100_000]);
    expect(posted.document.lines[0]).toMatchObject({ unitCost: 100_000, costAmount: 1_000_000 });
    expect(await balance('KHO-B', code)).toEqual({ quantity: 20, avgCost: 150_000 });
  });

  it('đảo phiếu nhập xuất lại đúng giá đã nhập, bình quân trở về như trước', async () => {
    const code = await material('GVRV');
    await receive('KHO-A', code, 10, 100_000);
    const second = await receive('KHO-A', code, 10, 120_000);
    expect((await balance('KHO-A', code)).avgCost).toBe(110_000);
    const reversal = await documents.reverse(clerk, second.document.id);
    expect(reversal.document.lines[0]).toMatchObject({ unitCost: 120_000, costAmount: 1_200_000 });
    expect(await balance('KHO-A', code)).toEqual({ quantity: 10, avgCost: 100_000 });
  });

  it('nhập không ghi đơn giá giữ nguyên bình quân', async () => {
    const code = await material('GV0');
    await receive('KHO-A', code, 10, 50_000);
    await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: code, quantity: 5 });
    expect(await balance('KHO-A', code)).toEqual({ quantity: 15, avgCost: 50_000 });
  });

  it('TC-INV-24, TC-QUO-02: mặt hàng dịch vụ không có tồn, mọi đường nhập xuất giữ hàng đều 400', async () => {
    const code = await material('BT', { kind: 'SERVICE', warrantyMonths: 12 });
    expect(await app.getMaterial(admin, code)).toMatchObject({ kind: 'SERVICE', warrantyMonths: 12 });

    const receipt = await rejection(
      documents.create(clerk, { docType: 'RECEIPT_PURCHASE', warehouseCode: 'KHO-A', lines: [{ materialCode: code, quantity: 5 }] }),
    );
    expect([receipt.statusCode, receipt.code]).toEqual([400, 'SERVICE_MATERIAL_NOT_STOCKED']);
    expect(receipt.message).toMatch(/^Mặt hàng dịch vụ không quản lý tồn/);

    const legacy = await rejection(app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: code, quantity: 1 }));
    expect(legacy.statusCode).toBe(400);
    const reservation = await rejection(
      app.createStockReservation(clerk, {
        referenceType: 'crm_order',
        warehouseCode: 'KHO-A',
        items: [{ materialCode: code, quantityReserved: 1 }],
      }),
    );
    expect([reservation.statusCode, reservation.code]).toEqual([400, 'SERVICE_MATERIAL_NOT_STOCKED']);
    const serials = await rejection(app.registerSerials(admin, { materialCode: code, serialNumbers: ['X1'] }));
    expect(serials.code).toBe('SERVICE_MATERIAL_NOT_STOCKED');

    // Lớp chặn cuối ở DB: không dựng được dòng tồn cho dịch vụ.
    await expect(
      pool.query(
        `INSERT INTO inventory_schema.material_inventory (id, warehouse_id, material_id, quantity, updated_at)
         SELECT gen_random_uuid(), w.id, m.id, 0, now() FROM inventory_schema.warehouses w, inventory_schema.materials m
          WHERE w.code = 'KHO-A' AND m.code = $1`,
        [code],
      ),
    ).rejects.toThrow(/Mặt hàng dịch vụ không quản lý tồn/);

    // Dịch vụ không theo serial; đổi sang hàng hoá được vì chưa có dấu vết tồn.
    expect((await rejection(app.updateMaterial(admin, code, { isSerialized: true }))).statusCode).toBe(400);
    expect((await app.updateMaterial(admin, code, { kind: 'STOCK', warrantyMonths: null })).kind).toBe('STOCK');
    expect((await app.getMaterial(admin, code)).warrantyMonths).toBeUndefined();
    await receive('KHO-A', code, 1, 10);
    const locked = await rejection(app.updateMaterial(admin, code, { kind: 'SERVICE' }));
    expect(locked.message).toMatch(/không đổi được giữa hàng hoá và dịch vụ/);
  });

  it('TC-MIG-04: script khởi tạo giá bình quân khớp giá tính lúc ghi sổ, chạy lại cho cùng kết quả', async () => {
    const { rows: expectedRows } = await pool.query(
      `SELECT id, avg_cost::text AS avg_cost FROM inventory_schema.material_inventory ORDER BY id`,
    );
    // Dữ liệu cũ trước 0016: bình quân 0.
    await pool.query(`UPDATE inventory_schema.material_inventory SET avg_cost = 0`);
    const script = initAvgCostScript();

    const dry = await run(process.execPath, [script, `--database-url=${database.url}`, '--dry-run', '--json']);
    const preview = JSON.parse(dry.stdout) as { material_code: string; warehouse_code: string; computed_avg_cost: string; changed: boolean }[];
    expect(preview.find((row) => row.material_code === 'GV18-2' && row.warehouse_code === 'KHO-A')).toMatchObject({
      computed_avg_cost: '108750.0000',
      changed: true,
    });
    const untouched = await pool.query(`SELECT count(*)::int AS n FROM inventory_schema.material_inventory WHERE avg_cost <> 0`);
    expect(untouched.rows[0].n).toBe(0);

    await run(process.execPath, [script, `--database-url=${database.url}`]);
    const { rows: actualRows } = await pool.query(
      `SELECT id, avg_cost::text AS avg_cost FROM inventory_schema.material_inventory ORDER BY id`,
    );
    expect(actualRows).toEqual(expectedRows);

    const again = await run(process.execPath, [script, `--database-url=${database.url}`, '--json']);
    expect((JSON.parse(again.stdout) as { changed: boolean }[]).every((row) => !row.changed)).toBe(true);
    expect(again.stderr).toMatch(/0 dòng đã đổi/);
  }, 60_000);
});
