import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { todayInVietnam } from './domain/traceability-policy.js';
import { toInventoryError } from './domain/inventory.error.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import { InventoryController } from './presentation/inventory.controller.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

function shiftDays(days: number): string {
  const date = new Date(`${todayInVietnam()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

integration('Lắp, tháo, thanh lý vật tư theo serial, lô, giá vốn trên PostgreSQL', () => {
  const tenantId = randomUUID();
  const warehouse = 'LAP-KHO';
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let store: PostgresInventoryStore;
  let sequence = 0;

  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
    canApproveDocuments: true,
    canWriteQuality: true,
  };

  async function material(prefix: string, serialized = false): Promise<string> {
    sequence += 1;
    const code = `${prefix}-${sequence}`;
    await app.createMaterial(admin, {
      code,
      name: `Vật tư ${code}`,
      category: serialized ? 'SPARE_PART' : 'CONSUMABLE',
      unit: 'Cái',
      isSerialized: serialized,
    });
    return code;
  }

  async function stock(materialCode: string) {
    const { rows } = await pool.query(
      `SELECT b.quantity, b.quantity_reserved, b.available, b.avg_cost
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouse, materialCode],
    );
    const row = rows[0] as Record<string, string> | undefined;
    return {
      quantity: Number(row?.quantity ?? 0),
      available: Number(row?.available ?? 0),
      avgCost: Number(row?.avg_cost ?? 0),
    };
  }

  async function serialState(materialCode: string, serial: string) {
    const { rows } = await pool.query(
      `SELECT s.stock_state, w.code AS warehouse_code
         FROM inventory_schema.serial_tracking s
         JOIN inventory_schema.materials m ON m.id = s.material_id
         LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
        WHERE m.code = $1 AND upper(btrim(s.serial_number)) = upper(btrim($2))`,
      [materialCode, serial],
    );
    return rows[0] as { stock_state: string | null; warehouse_code: string | null } | undefined;
  }

  async function serialMovements(materialCode: string, serial: string) {
    const { rows } = await pool.query(
      `SELECT mv.movement_type, mv.stock_state, mv.source_type, mv.source_id
         FROM inventory_schema.serial_movements mv
         JOIN inventory_schema.materials m ON m.id = mv.material_id
        WHERE m.code = $1 AND upper(mv.serial_number) = upper($2)
        ORDER BY mv.occurred_at, mv.id`,
      [materialCode, serial],
    );
    return rows as { movement_type: string; stock_state: string; source_type: string | null; source_id: string | null }[];
  }

  async function lotQuantity(materialCode: string, lotNo: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT b.quantity FROM inventory_schema.lot_balances b
         JOIN inventory_schema.lots l ON l.id = b.lot_id
         JOIN inventory_schema.materials m ON m.id = l.material_id
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
        WHERE m.code = $1 AND l.lot_no = $2 AND w.code = $3`,
      [materialCode, lotNo, warehouse],
    );
    return Number((rows[0] as { quantity?: string } | undefined)?.quantity ?? 0);
  }

  async function unitOf(referenceId: string | undefined) {
    const { rows } = await pool.query(
      `SELECT code, is_active FROM inventory_schema.materials WHERE id = $1`,
      [referenceId],
    );
    return rows[0] as { code: string; is_active: boolean };
  }

  async function rejection(promise: Promise<unknown>) {
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
    store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    const traceability = new PostgresTraceabilityStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore, traceability);
    await app.createWarehouse(admin, { code: warehouse, name: 'Kho lắp đặt' });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('vật tư thường: lắp, tháo giữ request, response cũ; vẫn kiểm phần đã giữ', async () => {
    const cap = await material('LAP-CAP');
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: cap, quantity: 10, unitCost: 100 });

    const installed = await app.installItem(admin, cap, { warehouseCode: warehouse, quantity: 3 });
    expect(installed).toMatchObject({ type: 'EXPORT', quantity: -3, unitCost: 100, referenceType: 'asset' });
    expect(installed.documentId).toBeDefined();
    const unit = await unitOf(installed.referenceId);
    expect((await app.listInstalled(admin)).find((line) => line.unitCode === unit.code)).toMatchObject({
      materialCode: cap,
      quantity: 3,
    });
    expect(await stock(cap)).toMatchObject({ quantity: 7, available: 7, avgCost: 100 });

    // Lắp không được lấy hàng đã giữ cho đơn khác.
    await app.createStockReservation(admin, {
      referenceType: 'test',
      items: [{ warehouseCode: warehouse, materialCode: cap, quantityReserved: 6 }],
    });
    const short = await rejection(app.installItem(admin, cap, { warehouseCode: warehouse, quantity: 2 }));
    expect([short.statusCode, short.code]).toEqual([400, 'INSUFFICIENT_STOCK']);

    const partial = await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse, quantity: 2 });
    expect(partial).toMatchObject({ type: 'RETURN', quantity: 2, unitCost: 100, referenceType: 'asset' });
    expect(partial.referenceId).toBe(installed.referenceId);
    await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse });
    expect((await app.listInstalled(admin)).some((line) => line.unitCode === unit.code)).toBe(false);
    expect((await unitOf(installed.referenceId)).is_active).toBe(false);
    expect(await stock(cap)).toMatchObject({ quantity: 10, avgCost: 100 });
  });

  it('giá vốn: lắp theo bình quân hiện tại, tháo về đúng giá lúc lắp', async () => {
    const day = await material('LAP-DAY');
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: day, quantity: 2, unitCost: 100 });
    const installed = await app.installItem(admin, day, { warehouseCode: warehouse, quantity: 1 });
    expect(installed.unitCost).toBe(100);
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: day, quantity: 1, unitCost: 200 });
    expect(await stock(day)).toMatchObject({ quantity: 2, avgCost: 150 });

    const unit = await unitOf(installed.referenceId);
    const back = await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse });
    expect(back.unitCost).toBe(100);
    // (2 × 150 + 1 × 100) / 3
    expect(await stock(day)).toMatchObject({ quantity: 3, avgCost: 133.3333 });
  });

  it('lắp trước đây chưa ghi giá: tháo theo bình quân hiện tại, bình quân không đổi', async () => {
    const ong = await material('LAP-ONG');
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: ong, quantity: 4, unitCost: 50 });
    // Lắp theo đường cũ của bản trước: bút toán ghi thẳng sổ cái, giá 0, không chứng từ.
    const unit = await store.item.createInstalledUnit(tenantId, ong);
    if (unit === 'not_found') throw new Error('missing unit');
    await store.transaction.append(tenantId, {
      warehouseCode: warehouse,
      materialCode: ong,
      type: 'EXPORT',
      quantity: -1,
      referenceType: 'asset',
      referenceId: unit.unitId,
      createdBy: admin.userId,
    });
    const back = await app.uninstallMaterial(admin, unit.unitCode, { warehouseCode: warehouse });
    expect(back).toMatchObject({ type: 'RETURN', quantity: 1, unitCost: 50 });
    expect(await stock(ong)).toMatchObject({ quantity: 4, avgCost: 50 });
  });

  it('vật tư theo serial: lắp bắt buộc serial, serial Đã xuất; tháo đúng serial về Trong kho, có lịch sử', async () => {
    const may = await material('LAP-MAY', true);
    await app.receiveStock(admin, {
      warehouseCode: warehouse,
      materialCode: may,
      quantity: 2,
      unitCost: 1000,
      serials: ['SN-A', 'SN-B'],
    });

    // Không gửi serial mà kho không đủ serial Trong kho, Đạt: 400 kèm lý do.
    const missing = await rejection(app.installItem(admin, may, { warehouseCode: warehouse, quantity: 3 }));
    expect([missing.statusCode, missing.code]).toEqual([400, 'SERIALS_REQUIRED']);
    expect(missing.message).toContain('chỉ còn 2 serial');
    const wrongCount = await rejection(
      app.installItem(admin, may, { warehouseCode: warehouse, quantity: 2, serials: ['SN-A'] }),
    );
    expect(wrongCount.code).toBe('VALIDATION');
    const unknown = await rejection(
      app.installItem(admin, may, { warehouseCode: warehouse, quantity: 1, serials: ['SN-Z'] }),
    );
    expect(unknown.code).toBe('SERIAL_NOT_FOUND');
    // Lắp hỏng không để lại đơn vị trên cây.
    const leftover = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.materials WHERE code LIKE $1 AND is_active`,
      [`${may}@%`],
    );
    expect((leftover.rows[0] as { n: number }).n).toBe(0);

    const installed = await app.installItem(admin, may, { warehouseCode: warehouse, quantity: 1, serials: [' sn-a '] });
    expect(installed).toMatchObject({ type: 'EXPORT', quantity: -1, unitCost: 1000 });
    expect(await serialState(may, 'SN-A')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });
    expect(await serialState(may, 'SN-B')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect(await stock(may)).toMatchObject({ quantity: 1 });
    expect(await serialMovements(may, 'SN-A')).toEqual([
      expect.objectContaining({ movement_type: 'RECEIPT', stock_state: 'IN_STOCK' }),
      expect.objectContaining({
        movement_type: 'ISSUE',
        stock_state: 'ISSUED',
        source_type: 'asset',
        source_id: installed.referenceId,
      }),
    ]);

    // Serial đã lắp thì không lắp lần nữa.
    const again = await rejection(
      app.installItem(admin, may, { warehouseCode: warehouse, quantity: 1, serials: ['SN-A'] }),
    );
    expect(again.code).toBe('SERIAL_NOT_AVAILABLE');

    const unit = await unitOf(installed.referenceId);
    const foreign = await rejection(
      app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse, serials: ['SN-B'] }),
    );
    expect(foreign.code).toBe('SERIAL_NOT_INSTALLED');

    const back = await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse, serials: ['SN-A'] });
    expect(back).toMatchObject({ type: 'RETURN', quantity: 1, unitCost: 1000 });
    expect(await serialState(may, 'SN-A')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect((await serialMovements(may, 'SN-A')).at(-1)).toMatchObject({
      movement_type: 'RETURN',
      stock_state: 'IN_STOCK',
      source_type: 'asset',
      source_id: installed.referenceId,
    });
    expect(await stock(may)).toMatchObject({ quantity: 2, avgCost: 1000 });
  });

  it('đường lắp cũ không gửi serial: tự chọn serial Trong kho, Đạt theo thứ tự nhập rồi số serial; tháo, thanh lý tự lấy serial đã lắp', async () => {
    const den = await material('LAP-DEN', true);
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: den, quantity: 1, unitCost: 10, serials: ['AP-0'] });
    await app.receiveStock(admin, {
      warehouseCode: warehouse,
      materialCode: den,
      quantity: 3,
      unitCost: 10,
      serials: ['AP-C', 'AP-B', 'AP-A'],
    });
    // Serial Cách ly không được chọn.
    await pool.query(
      `UPDATE inventory_schema.serial_tracking SET quality_status = 'QUARANTINE'
        WHERE serial_number = 'AP-A' AND material_id = (SELECT id FROM inventory_schema.materials WHERE code = $1)`,
      [den],
    );
    await pool.query(
      `UPDATE inventory_schema.material_inventory SET quantity_blocked = 1
        WHERE material_id = (SELECT id FROM inventory_schema.materials WHERE code = $1)`,
      [den],
    );

    const first = await app.installItem(admin, den, { warehouseCode: warehouse, quantity: 2 });
    expect(first).toMatchObject({ type: 'EXPORT', quantity: -2 });
    expect(await serialState(den, 'AP-0')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });
    expect(await serialState(den, 'AP-B')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });
    expect(await serialState(den, 'AP-A')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect(await serialState(den, 'AP-C')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    const { rows } = await pool.query(
      `SELECT serial_numbers FROM inventory_schema.stock_document_lines WHERE document_id = $1`,
      [first.documentId],
    );
    expect((rows[0] as { serial_numbers: string[] }).serial_numbers).toEqual(['AP-0', 'AP-B']);

    // Còn một serial Đạt (AP-C), lắp 2 không đủ: 400, không để lại đơn vị.
    const short = await rejection(app.installItem(admin, den, { warehouseCode: warehouse, quantity: 2 }));
    expect([short.statusCode, short.code]).toEqual([400, 'SERIALS_REQUIRED']);
    expect(short.message).toContain(`kho ${warehouse} chỉ còn 1 serial Trong kho, Đạt, không đủ 2`);
    const leftover = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.materials WHERE code LIKE $1 AND is_active`,
      [`${den}@%`],
    );
    expect((leftover.rows[0] as { n: number }).n).toBe(1);

    // Serial gửi lên vẫn được ưu tiên.
    const explicit = await app.installItem(admin, den, { warehouseCode: warehouse, quantity: 1, serials: ['AP-C'] });
    expect(await serialState(den, 'AP-C')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });

    // Tháo không gửi serial: lấy serial đang trên đơn vị.
    const unit = await unitOf(first.referenceId);
    await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse, quantity: 1 });
    expect(await serialState(den, 'AP-0')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect(await serialState(den, 'AP-B')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });

    // Thanh lý mã theo serial không gửi serial: lấy serial đã xuất của mã, thứ tự cố định.
    const back = await app.returnItemToStock(admin, den, { warehouseCode: warehouse });
    expect(back).toMatchObject({ type: 'RETURN', quantity: 1 });
    expect(await serialState(den, 'AP-B')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect(await serialState(den, 'AP-C')).toEqual({ stock_state: 'ISSUED', warehouse_code: null });
    expect(explicit.referenceId).toBeDefined();
  });

  it('thanh lý mã theo serial về kho: bắt buộc serial, serial vào Trong kho, lịch sử RETURN', async () => {
    const tu = await material('LAP-TU', true);
    const missing = await rejection(app.returnItemToStock(admin, tu, { warehouseCode: warehouse }));
    expect(missing.code).toBe('SERIALS_REQUIRED');

    const back = await app.returnItemToStock(admin, tu, { warehouseCode: warehouse, serials: ['TU-01'] });
    expect(back).toMatchObject({ type: 'RETURN', quantity: 1 });
    expect(await serialState(tu, 'TU-01')).toEqual({ stock_state: 'IN_STOCK', warehouse_code: warehouse });
    expect((await serialMovements(tu, 'TU-01')).map((row) => row.movement_type)).toEqual(['RETURN']);
    expect(await stock(tu)).toMatchObject({ quantity: 1 });
  });

  it('thanh lý một đơn vị đã lắp: nhập về theo giá lúc lắp', async () => {
    const bom = await material('LAP-BOM');
    await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: bom, quantity: 1, unitCost: 300 });
    const installed = await app.installItem(admin, bom, { warehouseCode: warehouse, quantity: 1 });
    const unit = await unitOf(installed.referenceId);

    const back = await app.returnItemToStock(admin, unit.code, { warehouseCode: warehouse });
    expect(back).toMatchObject({ type: 'RETURN', quantity: 1, unitCost: 300 });
    expect(await stock(unit.code)).toMatchObject({ quantity: 1, avgCost: 300 });
  });

  it('vật tư theo lô: lắp tự chọn lô FEFO, tháo trả về đúng lô; chỉ định lô thì lấy đúng lô', async () => {
    const keo = await material('LAP-KEO');
    await app.receiveStock(admin, {
      warehouseCode: warehouse,
      materialCode: keo,
      quantity: 5,
      unitCost: 10,
      lot: { lotNo: 'L-XA', expiresOn: shiftDays(60) },
    });
    await app.receiveStock(admin, {
      warehouseCode: warehouse,
      materialCode: keo,
      quantity: 5,
      unitCost: 10,
      lot: { lotNo: 'L-GAN', expiresOn: shiftDays(10) },
    });

    const installed = await app.installItem(admin, keo, { warehouseCode: warehouse, quantity: 6 });
    expect(installed.unitCost).toBe(10);
    expect(await lotQuantity(keo, 'L-GAN')).toBe(0);
    expect(await lotQuantity(keo, 'L-XA')).toBe(4);
    expect(await stock(keo)).toMatchObject({ quantity: 4 });

    const unit = await unitOf(installed.referenceId);
    expect((await app.listInstalled(admin)).find((line) => line.unitCode === unit.code)?.quantity).toBe(6);
    await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse, quantity: 2 });
    expect(await lotQuantity(keo, 'L-GAN')).toBe(2);
    await app.uninstallMaterial(admin, unit.code, { warehouseCode: warehouse });
    expect(await lotQuantity(keo, 'L-GAN')).toBe(5);
    expect(await lotQuantity(keo, 'L-XA')).toBe(5);
    expect(await stock(keo)).toMatchObject({ quantity: 10, avgCost: 10 });

    await app.installItem(admin, keo, {
      warehouseCode: warehouse,
      quantity: 1,
      lots: [{ lotNo: 'l-xa', quantity: 1 }],
    });
    expect(await lotQuantity(keo, 'L-XA')).toBe(4);
    expect(await lotQuantity(keo, 'L-GAN')).toBe(5);

    const overLot = await rejection(
      app.installItem(admin, keo, { warehouseCode: warehouse, quantity: 5, lots: [{ lotNo: 'L-XA', quantity: 5 }] }),
    );
    expect(overLot.code).toBe('LOT_INSUFFICIENT_STOCK');
  });

  it('trùng serial ở tầng DB (23505) trả 409 SERIAL_DUPLICATE, không 500', async () => {
    const rad = await material('LAP-RAD', true);
    await app.registerSerials(admin, { materialCode: rad, serialNumbers: ['RAD-01'] });
    let raw: unknown;
    try {
      await pool.query(
        `INSERT INTO inventory_schema.serial_tracking (material_id, serial_number, current_status, location_type)
         SELECT id, ' rad-01', 'OPERATING', 'WAREHOUSE' FROM inventory_schema.materials WHERE code = $1`,
        [rad],
      );
    } catch (error) {
      raw = error;
    }
    expect(raw).toMatchObject({ code: '23505', constraint: 'uq_serial_tracking_material_serial' });
    expect(toInventoryError(raw)).toMatchObject({ statusCode: 409, code: 'SERIAL_DUPLICATE' });
    expect(toInventoryError(new Error('khác'))).toBeNull();

    // Qua controller: lỗi DB trùng serial ra HttpException 409 với câu tiếng Việt.
    const failing = {
      registerSerials: async () => {
        throw raw;
      },
    } as unknown as InventoryApplication;
    const controller = new InventoryController(failing, {} as never);
    const thrown = await rejection(
      controller.registerSerials({ inventoryActor: admin }, { materialCode: rad, serialNumbers: ['rad-01'] }),
    );
    expect(thrown).toBeInstanceOf(HttpException);
    const http = thrown as unknown as HttpException;
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toMatchObject({ code: 'SERIAL_DUPLICATE', message: expect.stringContaining('serial') });
  });
});
