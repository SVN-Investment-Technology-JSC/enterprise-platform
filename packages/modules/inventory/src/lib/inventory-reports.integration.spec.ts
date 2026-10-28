import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  StockDocumentLineInput,
  StockDocumentType,
  StockMovementCategory,
  StockMovementLine,
  StockReport,
} from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { InventoryReportService } from './application/inventory-report.service.js';
import { LotService } from './application/lot.service.js';
import { QualityService } from './application/quality.service.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { classifyMovement } from './domain/inventory-report.js';
import { todayInVietnam } from './domain/traceability-policy.js';
import { PostgresInventoryReportStore } from './infrastructure/postgres-inventory-report.store.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';
import { InternalCatalogController } from './presentation/internal-catalog.controller.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;
/** TC-PERF-05 chạy riêng (`INVENTORY_PERF=1`): dựng 5.000 mặt hàng và 100.000 serial mất vài chục giây. */
const performance = INVENTORY_TEST_ADMIN_URL && process.env['INVENTORY_PERF'] === '1' ? describe : describe.skip;

function shiftDays(days: number): string {
  const date = new Date(`${todayInVietnam()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rowsOf<G extends StockReport['groupBy']>(report: StockReport, groupBy: G) {
  if (report.groupBy !== groupBy) throw new Error(`expected ${groupBy}`);
  return report as Extract<StockReport, { groupBy: G }>;
}

integration('Báo cáo kho trên PostgreSQL (T7-06, T7-07, T4-19)', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;
  let lots: LotService;
  let quality: QualityService;
  let reports: InventoryReportService;
  let sequence = 0;

  const actor = (name: string, rights: Partial<InventoryActor>): InventoryActor => ({
    tenantId,
    userId: randomUUID(),
    displayName: name,
    canManage: false,
    canWriteTransactions: true,
    canApproveDocuments: false,
    canWriteQuality: false,
    ...rights,
  });
  const admin = actor('Quản trị kho', { canManage: true, canApproveDocuments: true });
  const clerk = actor('Thủ kho', {});
  const inspector = actor('Kiểm định', { canWriteTransactions: false, canWriteQuality: true });
  const viewer = actor('Người xem', { canWriteTransactions: false });

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

  async function post(
    docType: StockDocumentType,
    warehouseCode: string,
    lines: StockDocumentLineInput[],
    extra: { targetWarehouseCode?: string } = {},
  ) {
    const draft = await documents.create(clerk, { docType, warehouseCode, lines, ...extra });
    return documents.post(clerk, draft.id);
  }

  async function lotId(materialCode: string, lotNo: string): Promise<string> {
    const found = (await lots.list(clerk, materialCode)).find((lot) => lot.lotNo === lotNo);
    if (!found) throw new Error(`missing lot ${lotNo}`);
    return found.id;
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    const traceability = new PostgresTraceabilityStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore);
    documents = new StockDocumentService(documentStore, store);
    lots = new LotService(traceability);
    quality = new QualityService(traceability);
    reports = new InventoryReportService(new PostgresInventoryReportStore(database.references, database.pools));
    for (const code of ['RPT-HN', 'RPT-DN', 'RPT-CU']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('TC-RPT-05: bốn loại tồn khớp TC-INV-14; lô có hạn dùng; serial có trạng thái chất lượng', async () => {
    // Chuỗi nghiệp vụ của TC-INV-14: tồn 100, giữ 20, cách ly 5, xuất 10 theo đơn.
    const vt = await material('RPT-VT');
    await post('RECEIPT_PURCHASE', 'RPT-HN', [
      { materialCode: vt, quantity: 95, unitCost: 1_000 },
      { materialCode: vt, quantity: 5, unitCost: 1_000, lot: { lotNo: 'LQ', expiresOn: shiftDays(20) } },
    ]);
    const reservation = await app.createStockReservation(clerk, {
      sourceType: 'crm_order',
      sourceId: randomUUID(),
      warehouseCode: 'RPT-HN',
      items: [{ materialCode: vt, quantityReserved: 20 }],
    });
    await quality.changeLot(inspector, await lotId(vt, 'LQ'), { qualityStatus: 'QUARANTINE', reason: 'Nghi hỏng' });
    await post('ISSUE_SALES', 'RPT-HN', [{ materialCode: vt, quantity: 10, reservationId: reservation.id }]);

    const byWarehouse = rowsOf(await reports.stock(viewer, { materialCode: vt }), 'WAREHOUSE');
    expect(byWarehouse.rows).toEqual([
      expect.objectContaining({
        warehouseCode: 'RPT-HN',
        materialCode: vt,
        onHand: 90,
        reserved: 10,
        blocked: 5,
        available: 75,
        avgCost: 1_000,
        stockValue: 90_000,
      }),
    ]);
    expect(byWarehouse.rows[0]).not.toHaveProperty('inTransit');
    expect(byWarehouse.totals).toEqual({ onHand: 90, reserved: 10, blocked: 5, available: 75, stockValue: 90_000 });
    expect(byWarehouse.total).toBe(1);

    // Lô: hạn dùng, số ngày còn lại, chất lượng; lọc sắp hết hạn trong N ngày.
    const byLot = rowsOf(await reports.stock(viewer, { groupBy: 'LOT', materialCode: vt }), 'LOT');
    expect(byLot.rows).toEqual([
      expect.objectContaining({
        lotNo: 'LQ',
        warehouseCode: 'RPT-HN',
        expiresOn: shiftDays(20),
        daysToExpiry: 20,
        qualityStatus: 'QUARANTINE',
        onHand: 5,
        blocked: 5,
        available: 0,
      }),
    ]);
    const within30 = rowsOf(
      await reports.stock(viewer, { groupBy: 'LOT', materialCode: vt, expiringWithinDays: 30 }),
      'LOT',
    );
    expect(within30.total).toBe(1);
    const within10 = rowsOf(
      await reports.stock(viewer, { groupBy: 'LOT', materialCode: vt, expiringWithinDays: 10 }),
      'LOT',
    );
    expect(within10.total).toBe(0);

    // Serial: trạng thái kho và chất lượng; mặc định chỉ serial Trong kho.
    const lap = await material('RPT-LAP', true);
    await post('RECEIPT_PURCHASE', 'RPT-HN', [{ materialCode: lap, quantity: 3, serials: ['RPT-S1', 'RPT-S2', 'RPT-S3'] }]);
    await quality.changeSerial(inspector, 'RPT-S2', { qualityStatus: 'PENDING_INSPECTION', reason: 'Khách báo lỗi' });
    await post('ISSUE_PROJECT', 'RPT-HN', [{ materialCode: lap, quantity: 1, serials: ['RPT-S3'] }]);
    const bySerial = rowsOf(await reports.stock(viewer, { groupBy: 'SERIAL', materialCode: lap }), 'SERIAL');
    expect(bySerial.rows.map((row) => [row.serialNumber, row.stockState, row.qualityStatus, row.warehouseCode])).toEqual([
      ['RPT-S1', 'IN_STOCK', 'PASSED', 'RPT-HN'],
      ['RPT-S2', 'IN_STOCK', 'PENDING_INSPECTION', 'RPT-HN'],
    ]);
    expect(bySerial.totals).toEqual({ serials: 2, inStock: 2, blocked: 1, available: 1 });
    const allSerials = rowsOf(
      await reports.stock(viewer, { groupBy: 'SERIAL', materialCode: lap, stockState: 'ALL' }),
      'SERIAL',
    );
    expect(allSerials.rows.find((row) => row.serialNumber === 'RPT-S3')).toMatchObject({ stockState: 'ISSUED' });
    // Serial theo tồn thực tế khớp báo cáo theo kho.
    const lapStock = rowsOf(await reports.stock(viewer, { materialCode: lap }), 'WAREHOUSE');
    expect(lapStock.totals).toMatchObject({ onHand: 2, blocked: 1, available: 1 });

    // Phân trang: tổng giữ nguyên, trang chỉ một dòng.
    const all = rowsOf(await reports.stock(viewer, { search: 'RPT-', limit: 1 }), 'WAREHOUSE');
    expect(all.total).toBe(2);
    expect(all.rows).toHaveLength(1);
    expect(all.totals.onHand).toBe(92);
    const next = rowsOf(await reports.stock(viewer, { search: 'RPT-', limit: 1, offset: 1 }), 'WAREHOUSE');
    expect(next.rows[0].materialCode).not.toBe(all.rows[0].materialCode);
    // Nhóm vật tư và kho.
    expect(rowsOf(await reports.stock(viewer, { search: 'RPT-', category: 'SPARE_PART' }), 'WAREHOUSE').total).toBe(1);
    expect(rowsOf(await reports.stock(viewer, { search: 'RPT-', warehouseCode: 'RPT-DN' }), 'WAREHOUSE').total).toBe(0);
  });

  it('TC-RPT-06: nhập, xuất, điều chuyển, nhập trả, điều chỉnh, đảo khớp sổ; điều chỉnh có người duyệt', async () => {
    const code = await material('RPT6');
    await post('RECEIPT_PURCHASE', 'RPT-HN', [{ materialCode: code, quantity: 10, unitCost: 100_000 }]);
    await post('RECEIPT_PURCHASE', 'RPT-HN', [{ materialCode: code, quantity: 10, unitCost: 120_000 }]);
    const issued = await post('ISSUE_PROJECT', 'RPT-HN', [{ materialCode: code, quantity: 4 }]);
    await post('TRANSFER', 'RPT-HN', [{ materialCode: code, quantity: 3 }], { targetWarehouseCode: 'RPT-DN' });
    await post('RECEIPT_SALES_RETURN', 'RPT-HN', [
      { materialCode: code, quantity: 1, sourceLineId: issued.document.lines[0].id },
    ]);
    const adjustment = await documents.create(clerk, {
      docType: 'ADJUSTMENT',
      warehouseCode: 'RPT-HN',
      note: 'Kiểm kê thiếu 2 cái',
      lines: [{ materialCode: code, quantity: 2, direction: 'OUT' }],
    });
    await documents.submit(clerk, adjustment.id);
    await documents.approve(admin, adjustment.id);
    await documents.post(clerk, adjustment.id);
    const wrong = await post('RECEIPT_PURCHASE', 'RPT-HN', [{ materialCode: code, quantity: 5, unitCost: 90_000 }]);
    await documents.reverse(clerk, wrong.document.id);

    const report = await reports.movements(viewer, { search: code, limit: 1000 });
    const today = todayInVietnam();
    expect([report.fromDate, report.toDate]).toEqual([`${today.slice(0, 8)}01`, today]);

    // Đối chiếu độc lập với sổ kho: cộng bút toán của mặt hàng theo nhóm.
    const { rows } = await pool.query(
      `SELECT d.doc_type, (d.reverses_document_id IS NOT NULL) AS is_reversal, t.type, t.quantity::float8 AS quantity,
              (abs(t.quantity) * t.unit_cost)::float8 AS value
         FROM inventory_schema.inventory_transactions t
         JOIN inventory_schema.materials m ON m.id = t.material_id
         LEFT JOIN inventory_schema.stock_documents d ON d.id = t.document_id
        WHERE m.code = $1`,
      [code],
    );
    const expected = new Map<StockMovementCategory, { quantityIn: number; quantityOut: number; valueIn: number; valueOut: number }>();
    for (const row of rows as { doc_type: StockDocumentType; is_reversal: boolean; type: 'IMPORT'; quantity: number; value: number }[]) {
      const category = classifyMovement({ docType: row.doc_type, isReversal: row.is_reversal, ledgerType: row.type });
      const sum = expected.get(category) ?? { quantityIn: 0, quantityOut: 0, valueIn: 0, valueOut: 0 };
      if (row.quantity > 0) {
        sum.quantityIn += row.quantity;
        sum.valueIn += row.value;
      } else {
        sum.quantityOut -= row.quantity;
        sum.valueOut += row.value;
      }
      expected.set(category, sum);
    }
    const summary = Object.fromEntries(report.summary.map((row) => [row.category, row]));
    for (const [category, sum] of expected) {
      expect([category, summary[category]]).toEqual([category, expect.objectContaining(sum)]);
    }
    // Số liệu nghiệp vụ cụ thể: nhập 20, xuất 4 theo bình quân 110.000, chuyển 3 hai vế, trả 1, điều chỉnh giảm 2, đảo 5.
    expect(summary['RECEIPT']).toMatchObject({ quantityIn: 25, valueIn: 2_650_000, entries: 3 });
    expect(summary['ISSUE']).toMatchObject({ quantityOut: 4, valueOut: 440_000 });
    expect(summary['TRANSFER']).toMatchObject({ quantityIn: 3, quantityOut: 3, valueIn: 330_000, valueOut: 330_000 });
    expect(summary['SALES_RETURN']).toMatchObject({ quantityIn: 1, valueIn: 110_000 });
    expect(summary['ADJUSTMENT']).toMatchObject({ quantityOut: 2, valueOut: 220_000 });
    expect(summary['REVERSAL']).toMatchObject({ quantityOut: 5, valueOut: 450_000 });
    expect(report.totals.entries).toBe(rows.length);
    expect(report.total).toBe(rows.length);
    // Giá trị xuất khớp giá vốn ghi trên dòng chứng từ.
    expect(summary['ISSUE'].valueOut).toBe(issued.document.lines[0].costAmount);

    // Dòng chi tiết cộng lại bằng tổng; mỗi dòng có nhóm và chứng từ.
    const lines: StockMovementLine[] = [];
    for (let offset = 0; offset < report.total; offset += 3) {
      lines.push(...(await reports.movements(viewer, { search: code, limit: 3, offset })).lines);
    }
    expect(lines).toHaveLength(rows.length);
    expect(lines.every((line) => line.documentCode)).toBe(true);
    expect(lines.filter((line) => line.category === 'REVERSAL')[0]).toMatchObject({
      reversesDocumentCode: wrong.document.code,
      quantity: -5,
      value: 450_000,
    });
    // Lọc theo nhóm, kho, loại chứng từ.
    const transfers = await reports.movements(viewer, { search: code, category: 'TRANSFER', warehouseCode: 'RPT-DN' });
    expect(transfers.totals).toMatchObject({ quantityIn: 3, quantityOut: 0, entries: 1 });
    expect(transfers.lines.map((line) => line.warehouseCode)).toEqual(['RPT-DN']);
    const adjustments = await reports.movements(viewer, { search: code, docType: 'ADJUSTMENT' });
    expect(adjustments.lines.map((line) => line.category)).toEqual(['ADJUSTMENT']);
    // Kỳ trước không có phát sinh.
    const lastYear = await reports.movements(viewer, { search: code, fromDate: '2020-01-01', toDate: '2020-12-31' });
    expect(lastYear.totals.entries).toBe(0);

    // Lịch sử điều chỉnh: ai lập, ai duyệt, lúc nào, lý do.
    const approvals = await reports.approvals(viewer, { docType: 'ADJUSTMENT', warehouseCode: 'RPT-HN' });
    const row = approvals.rows.find((item) => item.documentId === adjustment.id);
    expect(row).toMatchObject({
      documentCode: adjustment.code,
      status: 'POSTED',
      reason: 'Kiểm kê thiếu 2 cái',
      createdBy: clerk.userId,
      submittedBy: clerk.userId,
      approvedBy: admin.userId,
      postedBy: clerk.userId,
      lineCount: 1,
      quantityOut: 2,
      value: 220_000,
    });
    expect(row?.approvedAt).toEqual(expect.any(String));
  });

  it('T4-19: GET v1/internal/warehouses lọc theo mã, id, chuỗi tìm; mặc định bỏ kho ngừng dùng', async () => {
    await app.updateWarehouse(admin, 'RPT-CU', { isActive: false });
    const controller = new InternalCatalogController(app);
    const request = { inventoryActor: actor('Hệ thống', {}) };

    const active = await controller.listWarehouses(request, 'RPT-');
    expect(active.warehouses.map((item) => item.code)).toEqual(['RPT-DN', 'RPT-HN']);
    expect(active.warehouses[0]).toEqual({
      id: expect.any(String),
      code: 'RPT-DN',
      name: 'Kho RPT-DN',
      isActive: true,
      type: 'PHYSICAL',
    });

    const withInactive = await controller.listWarehouses(request, 'rpt-', undefined, undefined, 'true');
    expect(withInactive.warehouses.map((item) => [item.code, item.isActive])).toEqual([
      ['RPT-CU', false],
      ['RPT-DN', true],
      ['RPT-HN', true],
    ]);
    const byCode = await controller.listWarehouses(request, undefined, 'rpt-hn, RPT-DN');
    expect(byCode.warehouses.map((item) => item.code)).toEqual(['RPT-DN', 'RPT-HN']);
    const byId = await controller.listWarehouses(request, undefined, undefined, active.warehouses[1].id);
    expect(byId.warehouses.map((item) => item.code)).toEqual(['RPT-HN']);
    await expect(controller.listWarehouses(request, undefined, undefined, 'abc')).rejects.toMatchObject({
      status: 400,
    });
  });
});

performance('TC-PERF-05: báo cáo tồn với 5.000 mặt hàng và 100.000 serial', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let reports: InventoryReportService;
  const viewer: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Người xem',
    canManage: false,
    canWriteTransactions: false,
  };

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    reports = new InventoryReportService(new PostgresInventoryReportStore(database.references, database.pools));
    const started = Date.now();
    // Dựng thẳng bằng SQL: 5 kho; 5.000 mặt hàng, 1.000 theo serial (100 serial mỗi mã);
    // 4.000 mặt hàng thường có tồn ở 3 kho, mỗi mã một lô có hạn dùng; 200.000 bút toán.
    await database.pool.query(`
      INSERT INTO inventory_schema.warehouses (code, name)
      SELECT 'PERF-K' || k, 'Kho hiệu năng ' || k FROM generate_series(1, 5) k;
      INSERT INTO inventory_schema.materials (code, name, category, unit, is_serialized)
      SELECT 'PERF-' || lpad(i::text, 5, '0'), 'Vật tư hiệu năng ' || i,
             (ARRAY['SPARE_PART','CONSUMABLE','TOOL','ROTABLE'])[1 + i % 4], 'Cái', i <= 1000
        FROM generate_series(1, 5000) i;
      INSERT INTO inventory_schema.material_inventory
             (warehouse_id, location_id, material_id, quantity, quantity_reserved, quantity_blocked, avg_cost)
      SELECT w.id, NULL, m.id, 100, 10, 5, 1000
        FROM inventory_schema.materials m
        JOIN inventory_schema.warehouses w ON w.code IN ('PERF-K1','PERF-K2','PERF-K3')
       WHERE NOT m.is_serialized;
      INSERT INTO inventory_schema.material_inventory
             (warehouse_id, location_id, material_id, quantity, quantity_reserved, quantity_blocked, avg_cost)
      SELECT (SELECT id FROM inventory_schema.warehouses WHERE code = 'PERF-K4'), NULL, m.id, 100, 0, 10, 5000
        FROM inventory_schema.materials m WHERE m.is_serialized;
      INSERT INTO inventory_schema.lots (material_id, lot_no, expires_on, created_by)
      SELECT m.id, 'L-' || m.code, current_date + (row_number() OVER (ORDER BY m.code))::int % 400, gen_random_uuid()
        FROM inventory_schema.materials m WHERE NOT m.is_serialized;
      INSERT INTO inventory_schema.lot_balances (warehouse_id, lot_id, quantity, quantity_reserved, quantity_blocked)
      SELECT w.id, l.id, 50, 0, 0
        FROM inventory_schema.lots l JOIN inventory_schema.warehouses w ON w.code IN ('PERF-K1','PERF-K2');
      INSERT INTO inventory_schema.serial_tracking
             (material_id, serial_number, current_status, location_type, current_warehouse_id, stock_state, quality_status)
      SELECT m.id, m.code || '-SN' || lpad(s::text, 3, '0'), 'IN_STOCK', 'WAREHOUSE',
             (SELECT id FROM inventory_schema.warehouses WHERE code = 'PERF-K4'),
             CASE WHEN s % 10 = 0 THEN 'ISSUED' ELSE 'IN_STOCK' END,
             CASE WHEN s % 10 = 1 THEN 'PENDING_INSPECTION' ELSE 'PASSED' END
        FROM inventory_schema.materials m CROSS JOIN generate_series(1, 100) s
       WHERE m.is_serialized;
      INSERT INTO inventory_schema.inventory_transactions
             (transaction_code, warehouse_id, material_id, type, quantity, unit_cost, created_by, created_at)
      SELECT 'PERF-TX-' || g, w.id, m.id, CASE WHEN g % 3 = 0 THEN 'EXPORT' ELSE 'IMPORT' END,
             CASE WHEN g % 3 = 0 THEN -1 ELSE 2 END, 1000, gen_random_uuid(), now() - (g % 90) * interval '1 day'
        FROM generate_series(1, 200000) g
        JOIN inventory_schema.materials m ON m.code = 'PERF-' || lpad((1 + g % 5000)::text, 5, '0')
        JOIN inventory_schema.warehouses w ON w.code = 'PERF-K' || (1 + g % 5);
      ANALYZE;
    `);
    process.stdout.write(`TC-PERF-05 seed: ${Date.now() - started} ms\n`);
  }, 600_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  async function p95(label: string, run: () => Promise<unknown>, rounds = 20): Promise<number> {
    await run();
    const samples: number[] = [];
    for (let index = 0; index < rounds; index += 1) {
      const started = process.hrtime.bigint();
      await run();
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    samples.sort((left, right) => left - right);
    const value = samples[Math.ceil(rounds * 0.95) - 1];
    process.stdout.write(
      `TC-PERF-05 ${label}: p50 ${samples[Math.floor(rounds / 2)].toFixed(1)} ms, p95 ${value.toFixed(1)} ms\n`,
    );
    return value;
  }

  it('p95 mỗi kiểu báo cáo dưới 5 giây', async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['kho, trang đầu', () => reports.stock(viewer, {})],
      ['kho, trang cuối 1000 dòng', () => reports.stock(viewer, { limit: 1000, offset: 12_000 })],
      ['kho, tìm và lọc nhóm', () => reports.stock(viewer, { search: 'hiệu năng 12', category: 'TOOL' })],
      ['lô, sắp hết hạn 30 ngày', () => reports.stock(viewer, { groupBy: 'LOT', expiringWithinDays: 30 })],
      ['serial, trang đầu', () => reports.stock(viewer, { groupBy: 'SERIAL' })],
      ['serial, trang sâu', () => reports.stock(viewer, { groupBy: 'SERIAL', limit: 1000, offset: 80_000 })],
      ['serial, tìm số serial', () => reports.stock(viewer, { groupBy: 'SERIAL', search: 'PERF-00500-SN05' })],
      ['serial, lọc kho và chất lượng', () =>
        reports.stock(viewer, { groupBy: 'SERIAL', warehouseCode: 'PERF-K4', qualityStatus: 'PENDING_INSPECTION' })],
      ['nhập xuất 90 ngày', () => reports.movements(viewer, { fromDate: shiftDays(-90), toDate: shiftDays(0) })],
    ];
    const serial = rowsOf(await reports.stock(viewer, { groupBy: 'SERIAL' }), 'SERIAL');
    expect(serial.totals.serials).toBe(90_000);
    for (const [label, run] of cases) {
      expect(await p95(label, run)).toBeLessThan(5_000);
    }
  }, 600_000);
});
