import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isPendingStockMovement, type StockDocumentLineInput, type StockDocumentType } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { LotService } from './application/lot.service.js';
import { QualityService } from './application/quality.service.js';
import { SerialService } from './application/serial.service.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { todayInVietnam } from './domain/traceability-policy.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase, projectSource, purchaseSource, documentSource } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

/** Số vòng cho test tranh chấp: một lần xanh chưa chứng minh được không có race. */
const ROUNDS = 8;

function shiftDays(days: number): string {
  const date = new Date(`${todayInVietnam()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

integration('Serial, lô, trạng thái chất lượng trên PostgreSQL (INV-04 đến INV-07, T1-13 đến T1-19)', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;
  let lots: LotService;
  let serials: SerialService;
  let quality: QualityService;
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
    extra: { targetWarehouseCode?: string; sourceType?: string; sourceId?: string } = {},
  ) {
    // Nhập mua, xuất dự án ghi sổ thẳng cần chứng từ nguồn (ISS-BE-006).
    const source = docType === 'RECEIPT_PURCHASE' || docType === 'ISSUE_PROJECT' ? documentSource() : {};
    const draft = await documents.create(clerk, { docType, warehouseCode, lines, ...source, ...extra });
    return documents.post(clerk, draft.id);
  }

  async function stock(materialCode: string, warehouseCode = 'QA-KHO-HN') {
    const { rows } = await pool.query(
      `SELECT b.quantity, b.quantity_reserved, b.quantity_blocked, b.available
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouseCode, materialCode],
    );
    const row = rows[0] as Record<string, string> | undefined;
    return {
      quantity: Number(row?.quantity ?? 0),
      reserved: Number(row?.quantity_reserved ?? 0),
      blocked: Number(row?.quantity_blocked ?? 0),
      available: Number(row?.available ?? 0),
    };
  }

  async function serialRow(materialCode: string, serial: string) {
    const { rows } = await pool.query(
      `SELECT s.stock_state, s.quality_status, w.code AS warehouse_code
         FROM inventory_schema.serial_tracking s
         JOIN inventory_schema.materials m ON m.id = s.material_id
         LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
        WHERE m.code = $1 AND upper(btrim(s.serial_number)) = upper(btrim($2))`,
      [materialCode, serial],
    );
    return rows[0] as { stock_state: string | null; quality_status: string; warehouse_code: string | null } | undefined;
  }

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string };
    }
    throw new Error('expected rejection');
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
    serials = new SerialService(traceability);
    quality = new QualityService(traceability);
    for (const code of ['QA-KHO-HN', 'QA-KHO-LOI']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('TC-INV-09: nhập lại serial đã có cùng mặt hàng trả 409; DB có unique (material_id, serial)', async () => {
    const lap = await material('QA-KHO-LAP', true);
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 2, serials: ['SN001', 'SN002'] }]);
    expect(await stock(lap)).toMatchObject({ quantity: 2, available: 2 });
    expect(await serialRow(lap, 'SN001')).toEqual({
      stock_state: 'IN_STOCK',
      quality_status: 'PASSED',
      warehouse_code: 'QA-KHO-HN',
    });

    const again = await rejection(
      post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: [' sn001 '] }]),
    );
    expect([again.statusCode, again.code]).toEqual([409, 'SERIAL_DUPLICATE']);
    expect(await stock(lap)).toMatchObject({ quantity: 2 });

    await expect(
      pool.query(
        `INSERT INTO inventory_schema.serial_tracking (material_id, serial_number, current_status, location_type)
         SELECT id, 'sn002', 'OPERATING', 'WAREHOUSE' FROM inventory_schema.materials WHERE code = $1`,
        [lap],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const index = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_serial_tracking_material_serial'`,
    );
    expect(String((index.rows[0] as { indexdef: string }).indexdef)).toContain('UNIQUE INDEX');

    // Khai sê-ri ở danh mục cũng không tạo bản trùng khác hoa thường.
    const registered = await app.registerSerials(admin, { materialCode: lap, serialNumbers: ['sn001', 'SN-NEW'] });
    expect(registered).toEqual({ added: 1, total: 3 });
  });

  it('T8-11: khai sê-ri kèm kho không đưa sê-ri vào kho; chỉ chứng từ nhập mới đưa vào', async () => {
    const lap = await material('QA-KHO-LAP', true);
    const inStock = async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM inventory_schema.serial_tracking s
           JOIN inventory_schema.materials m ON m.id = s.material_id
          WHERE m.code = $1 AND s.stock_state = 'IN_STOCK'`,
        [lap],
      );
      return Number((rows[0] as { n: number }).n);
    };

    const registered = await app.registerSerials(admin, {
      materialCode: lap,
      warehouseCode: 'QA-KHO-HN',
      serialNumbers: ['SN-KHAI-01', 'SN-KHAI-02'],
    });
    expect(registered).toEqual({ added: 2, total: 2 });
    expect(await serialRow(lap, 'SN-KHAI-01')).toEqual({
      stock_state: null,
      quality_status: 'PASSED',
      warehouse_code: null,
    });
    expect(await inStock()).toBe(0);
    expect(await stock(lap)).toMatchObject({ quantity: 0 });

    // Chưa vào sổ kho thì không xuất được.
    const issue = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN-KHAI-01'] }]),
    );
    expect([issue.statusCode, issue.code, issue.message]).toEqual([
      400,
      'SERIAL_NOT_AVAILABLE',
      'Dòng 1: serial SN-KHAI-01 không ở trạng thái Trong kho, Đạt (đang chưa vào sổ kho).',
    ]);

    // Chứng từ nhập nhận lại đúng dòng đã khai, không tạo dòng mới.
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['sn-khai-01'] }]);
    expect(await serialRow(lap, 'SN-KHAI-01')).toMatchObject({ stock_state: 'IN_STOCK', warehouse_code: 'QA-KHO-HN' });
    expect(await serialRow(lap, 'SN-KHAI-02')).toMatchObject({ stock_state: null, warehouse_code: null });
    expect(await inStock()).toBe(1);
    expect((await app.listSerials(admin, lap)).length).toBe(2);

    // Nhập kho kiểu cũ (POST v1/receipts) mang sê-ri theo cùng phiếu.
    await app.receiveStock(clerk, { ...purchaseSource(),
      warehouseCode: 'QA-KHO-HN',
      materialCode: lap,
      quantity: 2,
      unitCost: 1000,
      serials: ['SN-KHAI-02', 'SN-KHAI-03'],
    });
    expect(await inStock()).toBe(3);
    expect(await stock(lap)).toMatchObject({ quantity: 3 });
    const mismatch = await rejection(
      app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: lap, quantity: 2, serials: ['SN-KHAI-04'] }),
    );
    expect([mismatch.statusCode, mismatch.code]).toEqual([400, 'VALIDATION']);
    expect(await stock(lap)).toMatchObject({ quantity: 3 });
  });

  it('TC-INV-10, TC-INV-11, TC-INV-12: xuất serial không có, ở kho khác, không Đạt đều 400', async () => {
    const lap = await material('QA-KHO-LAP', true);
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 2, serials: ['SN001', 'SN003'] }]);
    await post('RECEIPT_PURCHASE', 'QA-KHO-LOI', [{ materialCode: lap, quantity: 1, serials: ['SN002'] }]);
    await quality.changeSerial(inspector, 'SN003', {
      materialCode: lap,
      qualityStatus: 'QUARANTINE',
      reason: 'Nghi lỗi nguồn',
    });

    const missing = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN999'] }]),
    );
    expect([missing.statusCode, missing.code, missing.message]).toEqual([
      400,
      'SERIAL_NOT_FOUND',
      'Dòng 1: serial SN999 không tồn tại.',
    ]);
    const elsewhere = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN002'] }]),
    );
    expect([elsewhere.statusCode, elsewhere.code, elsewhere.message]).toEqual([
      400,
      'SERIAL_WRONG_WAREHOUSE',
      'Dòng 1: serial SN002 không ở kho xuất QA-KHO-HN (đang ở kho QA-KHO-LOI).',
    ]);
    const quarantined = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN003'] }]),
    );
    expect([quarantined.statusCode, quarantined.code, quarantined.message]).toEqual([
      400,
      'SERIAL_NOT_AVAILABLE',
      'Dòng 1: serial SN003 không ở trạng thái Trong kho, Đạt (đang Cách ly).',
    ]);
    const otherMaterial = await material('QA-KHO-MAY', true);
    await app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: otherMaterial, quantity: 1, serials: ['SN-MAY-1'] });
    const wrongMaterial = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: otherMaterial, quantity: 1, serials: ['SN001'] }]),
    );
    expect(wrongMaterial.code).toBe('SERIAL_MATERIAL_MISMATCH');

    // Một serial Cách ly làm giảm khả dụng; serial Đạt xuất được và đổi sang Đã xuất.
    expect(await stock(lap)).toMatchObject({ quantity: 2, blocked: 1, available: 1 });
    await post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN001'] }]);
    expect(await serialRow(lap, 'SN001')).toMatchObject({ stock_state: 'ISSUED', warehouse_code: null });
    expect(await stock(lap)).toMatchObject({ quantity: 1, blocked: 1, available: 0 });

    // Điều chuyển mang được hàng Cách ly sang kho lỗi; phần không Đạt đi theo.
    await post('TRANSFER', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN003'] }], {
      targetWarehouseCode: 'QA-KHO-LOI',
    });
    expect(await serialRow(lap, 'SN003')).toMatchObject({ stock_state: 'IN_STOCK', warehouse_code: 'QA-KHO-LOI' });
    expect(await stock(lap)).toMatchObject({ quantity: 0, blocked: 0 });
    expect(await stock(lap, 'QA-KHO-LOI')).toMatchObject({ quantity: 2, blocked: 1, available: 1 });
  });

  it('T1-15: lịch sử serial, lần xuất gần nhất theo chứng từ nguồn; đảo phiếu xuất nhận serial về kho', async () => {
    const lap = await material('QA-KHO-LAP', true);
    const orderId = randomUUID();
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN-H1'] }]);
    const issued = await post(
      'ISSUE_SALES',
      'QA-KHO-HN',
      [{ materialCode: lap, quantity: 1, serials: ['sn-h1'] }],
      { sourceType: 'crm_order', sourceId: orderId },
    );
    expect(issued.document.lines[0].serials).toEqual(['sn-h1']);

    const history = await serials.history(clerk, 'SN-H1');
    expect(history).toMatchObject({
      materialCode: lap,
      stockState: 'ISSUED',
      qualityStatus: 'PASSED',
      lastIssue: {
        documentId: issued.document.id,
        documentCode: issued.document.code,
        docType: 'ISSUE_SALES',
        warehouseCode: 'QA-KHO-HN',
        sourceType: 'crm_order',
        sourceId: orderId,
      },
    });
    expect(history.issuedAt).toBe(history.lastIssue?.issuedAt);
    expect(history.movements.map((movement) => movement.movementType)).toEqual(['RECEIPT', 'ISSUE']);

    const reversal = await documents.reverse(admin, issued.document.id);
    expect(reversal.document.lines[0].serials).toEqual(['sn-h1']);
    const after = await serials.history(clerk, 'SN-H1', lap);
    expect(after).toMatchObject({ stockState: 'IN_STOCK', warehouseCode: 'QA-KHO-HN' });
    expect(after.lastIssue).toBeUndefined();
    expect(after.movements.map((movement) => movement.movementType)).toEqual(['RECEIPT', 'ISSUE', 'REVERSAL']);
    expect(await stock(lap)).toMatchObject({ quantity: 1 });

    // Hàng trả về rồi xuất bảo hành: loại lịch sử theo loại chứng từ.
    await post('ISSUE_WARRANTY', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN-H1'] }]);
    await post('RECEIPT_SALES_RETURN', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN-H1'] }]);
    const latest = await serials.history(clerk, 'SN-H1');
    expect(latest.movements.map((movement) => movement.movementType).slice(-2)).toEqual(['WARRANTY_ISSUE', 'RETURN']);
    expect(latest.lastIssue?.docType).toBe('ISSUE_WARRANTY');

    // Cùng số serial ở hai mặt hàng: phải ghi mã vật tư.
    const other = await material('QA-KHO-MAY', true);
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: other, quantity: 1, serials: ['SN-H1'] }]);
    const ambiguous = await rejection(serials.history(clerk, 'SN-H1'));
    expect([ambiguous.statusCode, ambiguous.code]).toEqual([409, 'SERIAL_AMBIGUOUS']);
    await expect(serials.history(clerk, 'SN-H1', other)).resolves.toMatchObject({ materialCode: other });
  });

  it('serial_movements chỉ ghi thêm: UPDATE, DELETE bị DB chặn', async () => {
    const lap = await material('QA-KHO-LAP', true);
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['SN-AO'] }]);
    await expect(
      pool.query(`UPDATE inventory_schema.serial_movements SET reason = 'x' WHERE serial_number = 'SN-AO'`),
    ).rejects.toThrow(/Lịch sử serial chỉ ghi thêm/);
    await expect(
      pool.query(`DELETE FROM inventory_schema.serial_movements WHERE serial_number = 'SN-AO'`),
    ).rejects.toThrow(/Lịch sử serial chỉ ghi thêm/);
  });

  it('TC-CONC-02: hai chứng từ xuất cùng một serial ghi sổ cùng lúc, chỉ một thành công', async () => {
    const lap = await material('QA-KHO-LAP', true);
    for (let round = 0; round < ROUNDS; round += 1) {
      const serial = `SN-C${round}`;
      await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: [serial] }]);
      const drafts = await Promise.all(
        [0, 1].map(() =>
          documents.create(clerk, {
            docType: 'ISSUE_SALES',
            warehouseCode: 'QA-KHO-HN',
            lines: [{ materialCode: lap, quantity: 1, serials: [serial] }],
          }),
        ),
      );
      const results = await Promise.allSettled(drafts.map((draft) => documents.post(clerk, draft.id)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { code: string }).code).toBe('SERIAL_NOT_AVAILABLE');
      expect(await serialRow(lap, serial)).toMatchObject({ stock_state: 'ISSUED' });
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM inventory_schema.serial_movements
          WHERE serial_number = $1 AND movement_type = 'ISSUE'`,
        [serial],
      );
      expect((rows[0] as { n: number }).n).toBe(1);
      expect(await stock(lap)).toMatchObject({ quantity: 0 });
    }
  });

  it('TC-INV-07: nhập có lô lưu lô và hạn dùng ở server; nhập thêm cùng số lô cộng vào lô', async () => {
    const muc = await material('QA-KHO-MUC');
    await app.receiveStock(clerk, { ...purchaseSource(),
      warehouseCode: 'QA-KHO-HN',
      materialCode: muc,
      quantity: 20,
      lot: { lotNo: 'l01', expiresOn: '2026-12-31', certificateNo: 'CO-01' },
    });
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: muc, quantity: 10, lot: { lotNo: 'L01' } }]);
    const [lot] = await lots.list(clerk, muc);
    expect(lot).toMatchObject({
      lotNo: 'L01',
      expiresOn: '2026-12-31',
      certificateNo: 'CO-01',
      qualityStatus: 'PASSED',
      quantity: 30,
      balances: [expect.objectContaining({ warehouseCode: 'QA-KHO-HN', quantity: 30, available: 30 })],
    });
    const conflict = await rejection(
      post('RECEIPT_PURCHASE', 'QA-KHO-HN', [
        { materialCode: muc, quantity: 1, lot: { lotNo: 'L01', expiresOn: '2027-01-31' } },
      ]),
    );
    expect([conflict.statusCode, conflict.code]).toEqual([409, 'LOT_ATTRIBUTE_CONFLICT']);
    const missing = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: muc, quantity: 1, lot: { lotNo: 'L99' } }]),
    );
    expect([missing.statusCode, missing.code]).toEqual([404, 'LOT_NOT_FOUND']);
    await expect(lots.get(clerk, lot.id)).resolves.toMatchObject({ lotNo: 'L01', qualityEvents: [] });
  });

  it('TC-INV-08: gợi ý FEFO theo hạn gần nhất, bỏ lô hết hạn và lô Cách ly', async () => {
    const muc = await material('QA-KHO-MUC');
    const receipt = (lotNo: string, expiresOn: string) => ({
      materialCode: muc,
      quantity: 10,
      lot: { lotNo, expiresOn },
    });
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [
      receipt('L01', shiftDays(60)),
      receipt('L02', shiftDays(30)),
      receipt('L03', shiftDays(-1)),
      receipt('L04', shiftDays(10)),
    ]);
    await quality.changeLot(inspector, await lotId(muc, 'L04'), { qualityStatus: 'QUARANTINE', reason: 'Chờ CO/CQ' });

    const suggestion = await lots.suggest(clerk, { materialCode: muc, warehouseCode: 'QA-KHO-HN', quantity: 10 });
    expect(suggestion.lines.map((line) => [line.lotNo, line.quantity])).toEqual([
      ['L02', 10],
      ['L01', 0],
    ]);
    expect(suggestion).toMatchObject({ allocated: 10, shortage: 0 });
    const more = await lots.suggest(clerk, { materialCode: muc, warehouseCode: 'QA-KHO-HN', quantity: 25 });
    expect([more.allocated, more.shortage]).toEqual([20, 5]);

    // Xuất theo lô Cách ly bị từ chối; lô Đạt trừ tồn của lô.
    const blocked = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: muc, quantity: 1, lot: { lotNo: 'L04' } }]),
    );
    expect([blocked.statusCode, blocked.code]).toEqual([400, 'LOT_NOT_AVAILABLE']);
    const over = await rejection(
      post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: muc, quantity: 11, lot: { lotNo: 'L02' } }]),
    );
    expect([over.statusCode, over.code]).toEqual([409, 'LOT_INSUFFICIENT_STOCK']);
    await app.issueStock(clerk, { ...projectSource(),
      warehouseCode: 'QA-KHO-HN',
      materialCode: muc,
      quantity: 4,
      lots: [{ lotNo: 'L02', quantity: 4 }],
    });
    const l02 = (await lots.list(clerk, muc)).find((lot) => lot.lotNo === 'L02');
    expect(l02?.quantity).toBe(6);

    // Hàng đều thuộc lô: xuất không ghi lô bị từ chối, phải chọn lô.
    const unlotted = await rejection(
      app.issueStock(clerk, { ...projectSource(), warehouseCode: 'QA-KHO-HN', materialCode: muc, quantity: 1 }),
    );
    expect(unlotted.code).toBe('LOT_REQUIRED');

    // Điều chuyển một phần lô sang kho khác.
    await app.transferStock(clerk, {
      fromWarehouseCode: 'QA-KHO-HN',
      toWarehouseCode: 'QA-KHO-LOI',
      materialCode: muc,
      quantity: 3,
      lots: [{ lotNo: 'L01', quantity: 3 }],
    });
    const l01 = (await lots.list(clerk, muc)).find((lot) => lot.lotNo === 'L01');
    expect(l01?.balances.map((balance) => [balance.warehouseCode, balance.quantity])).toEqual([
      ['QA-KHO-HN', 7],
      ['QA-KHO-LOI', 3],
    ]);
  });

  it('TC-INV-13: lô 30 cái chuyển Cách ly có lý do thì khả dụng 0; về Đạt thì trả lại', async () => {
    const muc = await material('QA-KHO-MUC');
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: muc, quantity: 30, lot: { lotNo: 'L01' } }]);
    expect(await stock(muc)).toMatchObject({ quantity: 30, available: 30 });
    const id = await lotId(muc, 'L01');

    const denied = await rejection(quality.changeLot(clerk, id, { qualityStatus: 'QUARANTINE', reason: 'x' }));
    expect(denied.statusCode).toBe(403);
    const noReason = await rejection(quality.changeLot(inspector, id, { qualityStatus: 'QUARANTINE', reason: '' }));
    expect(noReason.statusCode).toBe(400);

    const changed = await quality.changeLot(inspector, id, { qualityStatus: 'QUARANTINE', reason: 'Bao bì rách' });
    expect(changed).toMatchObject({ qualityStatus: 'QUARANTINE' });
    expect(changed.qualityEvents).toEqual([
      expect.objectContaining({
        fromStatus: 'PASSED',
        toStatus: 'QUARANTINE',
        reason: 'Bao bì rách',
        actorId: inspector.userId,
      }),
    ]);
    expect(changed.balances[0]).toMatchObject({ quantity: 30, quantityBlocked: 30, available: 0 });
    expect(await stock(muc)).toMatchObject({ quantity: 30, blocked: 30, available: 0 });

    // Xuất tự do và giữ hàng đều tôn trọng khả dụng mới.
    const issue = await rejection(app.issueStock(clerk, { ...projectSource(), warehouseCode: 'QA-KHO-HN', materialCode: muc, quantity: 1 }));
    expect(issue.statusCode).toBe(400);
    const reserve = await rejection(
      app.createStockReservation(clerk, {
        sourceType: 'crm_order',
        sourceId: randomUUID(),
        warehouseCode: 'QA-KHO-HN',
        items: [{ materialCode: muc, quantityReserved: 1 }],
      }),
    );
    expect([reserve.statusCode, reserve.code]).toEqual([409, 'RESERVATION_INSUFFICIENT_STOCK']);
    // Lịch sử đổi trạng thái chỉ ghi thêm.
    await expect(pool.query(`DELETE FROM inventory_schema.lot_quality_events`)).rejects.toThrow(/chỉ ghi thêm/);

    // Điều chuyển lô Cách ly sang kho lỗi mang phần không Đạt theo.
    await post('TRANSFER', 'QA-KHO-HN', [{ materialCode: muc, quantity: 10, lot: { lotNo: 'L01' } }], {
      targetWarehouseCode: 'QA-KHO-LOI',
    });
    expect(await stock(muc)).toMatchObject({ quantity: 20, blocked: 20, available: 0 });
    expect(await stock(muc, 'QA-KHO-LOI')).toMatchObject({ quantity: 10, blocked: 10, available: 0 });

    await quality.changeLot(inspector, id, { qualityStatus: 'PASSED', reason: 'Kiểm định đạt' });
    expect(await stock(muc)).toMatchObject({ quantity: 20, blocked: 0, available: 20 });
    expect(await stock(muc, 'QA-KHO-LOI')).toMatchObject({ quantity: 10, blocked: 0, available: 10 });
    const same = await rejection(quality.changeLot(inspector, id, { qualityStatus: 'PASSED', reason: 'x' }));
    expect([same.statusCode, same.code]).toEqual([409, 'QUALITY_STATUS_UNCHANGED']);
  });

  it('TC-INV-14: tồn 100, giữ 20, cách ly 5, xuất 10 theo đơn: thực tế 90, đã giữ 10, khả dụng 75', async () => {
    const vt = await material('QA-KHO-VT');
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [
      { materialCode: vt, quantity: 95 },
      { materialCode: vt, quantity: 5, lot: { lotNo: 'LQ' } },
    ]);
    const reservation = await app.createStockReservation(clerk, {
      sourceType: 'crm_order',
      sourceId: randomUUID(),
      warehouseCode: 'QA-KHO-HN',
      items: [{ materialCode: vt, quantityReserved: 20 }],
    });
    await quality.changeLot(inspector, await lotId(vt, 'LQ'), { qualityStatus: 'QUARANTINE', reason: 'Nghi hỏng' });
    await post('ISSUE_SALES', 'QA-KHO-HN', [{ materialCode: vt, quantity: 10, reservationId: reservation.id }]);
    expect(await stock(vt)).toEqual({ quantity: 90, reserved: 10, blocked: 5, available: 75 });
    const item = (await app.listItems(admin)).find((candidate) => candidate.code === vt);
    expect(item?.available).toBe(75);
  });

  it('serial Cách ly: đổi trạng thái cộng trừ phần không Đạt, ghi lịch sử có lý do', async () => {
    const lap = await material('QA-KHO-LAP', true);
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 2, serials: ['SN-Q1', 'SN-Q2'] }]);
    const changed = await quality.changeSerial(inspector, 'sn-q1', {
      qualityStatus: 'PENDING_INSPECTION',
      reason: 'Khách báo lỗi',
    });
    expect(changed.qualityStatus).toBe('PENDING_INSPECTION');
    expect(changed.movements.at(-1)).toMatchObject({
      movementType: 'QUALITY_CHANGE',
      previousQualityStatus: 'PASSED',
      qualityStatus: 'PENDING_INSPECTION',
      reason: 'Khách báo lỗi',
      actorId: inspector.userId,
    });
    expect(await stock(lap)).toMatchObject({ quantity: 2, blocked: 1, available: 1 });
    await quality.changeSerial(inspector, 'SN-Q1', { qualityStatus: 'DEFECTIVE', reason: 'Hỏng bo mạch' });
    expect(await stock(lap)).toMatchObject({ blocked: 1 });
    // Điều chỉnh giảm (huỷ hàng hỏng) lấy được serial không Đạt.
    const draft = await documents.create(clerk, {
      docType: 'ADJUSTMENT',
      warehouseCode: 'QA-KHO-HN',
      lines: [{ materialCode: lap, quantity: 1, direction: 'OUT', serials: ['SN-Q1'] }],
    });
    await documents.submit(clerk, draft.id);
    await documents.approve(admin, draft.id);
    await documents.post(clerk, draft.id);
    expect(await stock(lap)).toMatchObject({ quantity: 1, blocked: 0, available: 1 });
  });

  it('Gắn serial cho tồn có sẵn: không vượt tồn, không đổi số lượng, có lịch sử ADJUSTMENT', async () => {
    const traced = new InventoryApplication(
      new PostgresInventoryStore(database.references, database.pools),
      new PostgresStockDocumentStore(database.references, database.pools),
      new PostgresTraceabilityStore(database.references, database.pools),
    );
    // Hàng vào kho bằng đường không kèm serial (như nhập qua API).
    const lap = await material('QA-KHO-ASSIGN');
    await app.receiveStock(clerk, { warehouseCode: 'QA-KHO-HN', materialCode: lap, quantity: 2 });
    expect(await traced.serialCoverage(admin, lap)).toEqual([
      expect.objectContaining({ warehouseCode: 'QA-KHO-HN', quantity: 2, serialized: 0, unassigned: 2 }),
    ]);

    const tooMany = await rejection(
      traced.assignSerialsToStock(admin, { materialCode: lap, warehouseCode: 'QA-KHO-HN', serialNumbers: ['A1', 'A2', 'A3'] }),
    );
    expect(tooMany).toMatchObject({ statusCode: 409, code: 'SERIAL_EXCEEDS_STOCK' });
    expect(await serialRow(lap, 'A1')).toBeUndefined();

    const first = await traced.assignSerialsToStock(admin, {
      materialCode: lap,
      warehouseCode: 'QA-KHO-HN',
      serialNumbers: ['A1', ' A1 '],
    });
    expect(first).toMatchObject({ assigned: 1, coverage: { quantity: 2, serialized: 1, unassigned: 1 } });
    expect(await serialRow(lap, 'A1')).toEqual({ stock_state: 'IN_STOCK', quality_status: 'PASSED', warehouse_code: 'QA-KHO-HN' });
    expect(await stock(lap)).toMatchObject({ quantity: 2 });

    const history = await serials.history(admin, 'A1', lap);
    expect(history.movements.map((movement) => movement.movementType)).toEqual(['ADJUSTMENT']);

    const duplicate = await rejection(
      traced.assignSerialsToStock(admin, { materialCode: lap, warehouseCode: 'QA-KHO-HN', serialNumbers: ['a1'] }),
    );
    expect(duplicate).toMatchObject({ code: 'SERIAL_DUPLICATE' });

    const second = await traced.assignSerialsToStock(admin, { materialCode: lap, warehouseCode: 'QA-KHO-HN', serialNumbers: ['A2'] });
    expect(second.coverage).toMatchObject({ serialized: 2, unassigned: 0 });
    await rejection(traced.assignSerialsToStock(clerk, { materialCode: lap, warehouseCode: 'QA-KHO-HN', serialNumbers: ['A9'] }));
  });

  it('Serial mới khai sửa số và xoá được; đã vào kho thì 409 SERIAL_IN_USE', async () => {
    const lap = await material('QA-KHO-DECL', true);
    await app.registerSerials(admin, { materialCode: lap, serialNumbers: ['D1', 'D2'] });

    const renamed = await app.updateSerial(admin, lap, 'D1', { serialNumber: ' D1-FIX ' });
    expect(renamed.serialNumber).toBe('D1-FIX');
    expect(await serialRow(lap, 'D1')).toBeUndefined();

    expect(await app.deleteSerial(admin, lap, 'D2')).toEqual({ deleted: true });
    expect(await serialRow(lap, 'D2')).toBeUndefined();
    expect(await rejection(app.deleteSerial(admin, lap, 'D2'))).toMatchObject({ statusCode: 404 });

    // Vào kho qua phiếu nhập: từ đó không sửa số, không xoá.
    await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: lap, quantity: 1, serials: ['D1-FIX'] }]);
    expect(await rejection(app.deleteSerial(admin, lap, 'D1-FIX'))).toMatchObject({ statusCode: 409, code: 'SERIAL_IN_USE' });
    expect(await rejection(app.updateSerial(admin, lap, 'D1-FIX', { serialNumber: 'D1-X' }))).toMatchObject({
      statusCode: 409,
      code: 'SERIAL_IN_USE',
    });
    expect(await serialRow(lap, 'D1-FIX')).toMatchObject({ stock_state: 'IN_STOCK' });
  });

  describe('ISS-BE-066: lô chỉ tạo lúc ghi sổ, không tạo lúc lưu nháp', () => {
    const receiptDraft = (materialCode: string, quantity: number, lot: StockDocumentLineInput['lot']) =>
      documents.create(clerk, {
        docType: 'RECEIPT_PURCHASE',
        warehouseCode: 'QA-KHO-HN',
        lines: [{ materialCode, quantity, lot }],
      });

    async function approveAndPost(documentId: string) {
      await documents.submit(clerk, documentId);
      await documents.approve(admin, documentId);
      return documents.post(clerk, documentId);
    }

    async function lineLotIds(documentId: string): Promise<(string | null)[]> {
      const { rows } = await pool.query(
        `SELECT lot_id FROM inventory_schema.stock_document_lines WHERE document_id = $1 ORDER BY line_no`,
        [documentId],
      );
      return rows.map((row) => (row as { lot_id: string | null }).lot_id);
    }

    it('BE066-04, BE066-07: nháp lô mới không tạo lô, huỷ không để lại lô; ghi sổ tạo lô đúng thông tin', async () => {
      const muc = await material('QA-BE066');
      const cancelled = await receiptDraft(muc, 5, {
        lotNo: 'lo-new-1',
        manufacturedOn: '2026-01-15',
        expiresOn: '2027-12-31',
        certificateNo: 'CO-066',
      });
      expect(await lots.list(clerk, muc)).toEqual([]);
      expect(cancelled.lines[0]).toMatchObject({ lotNo: 'LO-NEW-1', lotExpiresOn: '2027-12-31' });
      expect(cancelled.lines[0].lotId).toBeUndefined();
      await documents.cancel(clerk, cancelled.id);
      expect(await lots.list(clerk, muc)).toEqual([]);

      const draft = await receiptDraft(muc, 7, {
        lotNo: 'LO-NEW-1',
        manufacturedOn: '2026-01-15',
        expiresOn: '2027-12-31',
        certificateNo: 'CO-066',
      });
      expect(await lots.list(clerk, muc)).toEqual([]);
      const posted = await approveAndPost(draft.id);
      const [lot] = await lots.list(clerk, muc);
      expect(lot).toMatchObject({
        lotNo: 'LO-NEW-1',
        manufacturedOn: '2026-01-15',
        expiresOn: '2027-12-31',
        certificateNo: 'CO-066',
        quantity: 7,
      });
      expect(posted.document.lines[0]).toMatchObject({ lotId: lot.id, lotNo: 'LO-NEW-1' });
      expect(await lineLotIds(draft.id)).toEqual([lot.id]);
      expect(await lineLotIds(cancelled.id)).toEqual([null]);
    });

    it('BE066-05: nháp trên lô có sẵn chưa có hạn dùng không đổi lô; ghi sổ mới điền hạn dùng', async () => {
      const muc = await material('QA-BE066');
      await app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: muc, quantity: 3, lot: { lotNo: 'LO-OLD' } });
      const draft = await receiptDraft(muc, 2, { lotNo: 'LO-OLD', expiresOn: '2028-03-31' });
      const [before] = await lots.list(clerk, muc);
      expect(before.expiresOn).toBeUndefined();
      expect(draft.lines[0]).toMatchObject({ lotId: before.id, lotNo: 'LO-OLD', lotExpiresOn: '2028-03-31' });

      await approveAndPost(draft.id);
      const [after] = await lots.list(clerk, muc);
      expect(after).toMatchObject({ id: before.id, expiresOn: '2028-03-31', quantity: 5 });
    });

    it('BE066-06: hạn dùng xung đột trả 409 lúc lưu nháp và lúc ghi sổ', async () => {
      const muc = await material('QA-BE066');
      await app.receiveStock(clerk, {
        ...purchaseSource(),
        warehouseCode: 'QA-KHO-HN',
        materialCode: muc,
        quantity: 1,
        lot: { lotNo: 'LO-HAN', expiresOn: '2027-12-31' },
      });
      const atDraft = await rejection(receiptDraft(muc, 1, { lotNo: 'LO-HAN', expiresOn: '2027-06-30' }));
      expect([atDraft.statusCode, atDraft.code]).toEqual([409, 'LOT_ATTRIBUTE_CONFLICT']);

      // Nháp hợp lệ lúc lưu, nhưng lô cùng số được ghi sổ trước với hạn khác.
      const draft = await receiptDraft(muc, 1, { lotNo: 'LO-SAU', expiresOn: '2027-06-30' });
      await app.receiveStock(clerk, {
        ...purchaseSource(),
        warehouseCode: 'QA-KHO-HN',
        materialCode: muc,
        quantity: 1,
        lot: { lotNo: 'LO-SAU', expiresOn: '2027-12-31' },
      });
      const atPost = await rejection(approveAndPost(draft.id));
      expect([atPost.statusCode, atPost.code]).toEqual([409, 'LOT_ATTRIBUTE_CONFLICT']);
      expect((await documents.get(clerk, draft.id)).status).not.toBe('POSTED');
      expect((await lots.list(clerk, muc)).find((lot) => lot.lotNo === 'LO-SAU')?.expiresOn).toBe('2027-12-31');
    });

    it('BE066-08: hai nháp cùng lô mới, ghi sổ lần lượt: một lô, tồn bằng tổng', async () => {
      const muc = await material('QA-BE066');
      const first = await receiptDraft(muc, 4, { lotNo: 'LO-NEW-2', expiresOn: '2028-01-31' });
      const second = await receiptDraft(muc, 6, { lotNo: 'LO-NEW-2' });
      expect(await lots.list(clerk, muc)).toEqual([]);
      await approveAndPost(first.id);
      await approveAndPost(second.id);
      const list = await lots.list(clerk, muc);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ lotNo: 'LO-NEW-2', expiresOn: '2028-01-31', quantity: 10 });
      expect(await lineLotIds(second.id)).toEqual([list[0].id]);
    });

    it('BE066-09: tạo và ghi sổ ngay (createAndPost) vẫn tạo lô lúc ghi sổ', async () => {
      const muc = await material('QA-BE066');
      const received = await app.receiveStock(clerk, {
        ...purchaseSource(),
        warehouseCode: 'QA-KHO-HN',
        materialCode: muc,
        quantity: 8,
        lot: { lotNo: 'LO-NGAY', expiresOn: '2028-02-29' },
      });
      const [lot] = await lots.list(clerk, muc);
      expect(lot).toMatchObject({ lotNo: 'LO-NGAY', expiresOn: '2028-02-29', quantity: 8 });
      if (isPendingStockMovement(received)) throw new Error('Phiếu nhập có nguồn phải ghi sổ ngay');
      expect(received.documentId).toBeDefined();
      expect(await lineLotIds(received.documentId as string)).toEqual([lot.id]);
    });

    it('BE066-10: sửa nháp đổi lô không tạo lô nào trước khi ghi sổ', async () => {
      const muc = await material('QA-BE066');
      const draft = await receiptDraft(muc, 2, { lotNo: 'LO-A', expiresOn: '2028-05-31' });
      const edited = await documents.update(clerk, draft.id, {
        lines: [{ materialCode: muc, quantity: 2, lot: { lotNo: 'LO-B', expiresOn: '2028-06-30' } }],
      });
      expect(await lots.list(clerk, muc)).toEqual([]);
      expect(edited.lines[0]).toMatchObject({ lotNo: 'LO-B', lotExpiresOn: '2028-06-30' });
      await approveAndPost(draft.id);
      expect((await lots.list(clerk, muc)).map((lot) => lot.lotNo)).toEqual(['LO-B']);
    });

    it('BE066-11: dòng nháp cũ đã có lot_id, không có lot_draft vẫn ghi sổ bình thường', async () => {
      const muc = await material('QA-BE066');
      await app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: muc, quantity: 1, lot: { lotNo: 'LO-CU' } });
      const lot = await lotId(muc, 'LO-CU');
      const draft = await receiptDraft(muc, 3, { lotNo: 'LO-CU' });
      // Giả lập dòng tạo trước migration 0026: chỉ có lot_id.
      await pool.query(
        `UPDATE inventory_schema.stock_document_lines SET lot_draft = NULL WHERE document_id = $1`,
        [draft.id],
      );
      const posted = await approveAndPost(draft.id);
      expect(posted.document.lines[0]).toMatchObject({ lotId: lot, lotNo: 'LO-CU' });
      expect((await lots.list(clerk, muc))[0]).toMatchObject({ id: lot, quantity: 4 });
    });
  });

  describe('ISS-BE-005: hàng serial phải đủ serial ở mọi loại chứng từ, mọi đường', () => {
    async function inStockSerials(materialCode: string, warehouseCode = 'QA-KHO-HN'): Promise<number> {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM inventory_schema.serial_tracking s
           JOIN inventory_schema.materials m ON m.id = s.material_id
           JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
          WHERE m.code = $1 AND w.code = $2 AND s.stock_state = 'IN_STOCK'`,
        [materialCode, warehouseCode],
      );
      return (rows[0] as { n: number }).n;
    }

    it('BE005-03, BE005-05, BE005-06: nhập thiếu serial, lệch số lượng, số lượng lẻ đều 400; tồn không đổi', async () => {
      const sr = await material('QA-KHO-SR', true);
      const none = await rejection(app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 1 }));
      expect([none.statusCode, none.code, none.message]).toEqual([
        400,
        'SERIALS_REQUIRED',
        `Dòng 1: ${sr} theo dõi theo serial; nhập đủ 1 serial (đang có 0).`,
      ]);
      const fewer = await rejection(
        app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 3, serials: ['A1', 'A2'] }),
      );
      expect(fewer.statusCode).toBe(400);
      const fraction = await rejection(
        app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 1.5, serials: ['A1'] }),
      );
      expect(fraction.statusCode).toBe(400);
      expect(await stock(sr)).toMatchObject({ quantity: 0 });
    });

    it('BE005-04: xuất khác không serial đã duyệt vẫn bị chặn lúc ghi sổ; tồn và serial Trong kho không đổi', async () => {
      const sr = await material('QA-KHO-SR', true);
      await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: sr, quantity: 2, serials: ['B1', 'B2'] }]);
      const draft = await documents.create(clerk, {
        docType: 'ISSUE_OTHER',
        warehouseCode: 'QA-KHO-HN',
        lines: [{ materialCode: sr, quantity: 1 }],
      });
      await documents.submit(clerk, draft.id);
      await documents.approve(admin, draft.id);
      const error = await rejection(documents.post(clerk, draft.id));
      expect([error.statusCode, error.code, error.message]).toEqual([
        400,
        'SERIALS_REQUIRED',
        `Dòng 1: ${sr} theo dõi theo serial; chọn đủ 1 serial trước khi ghi sổ (đang có 0).`,
      ]);
      expect(await stock(sr)).toMatchObject({ quantity: 2 });
      expect(await inStockSerials(sr)).toBe(2);
      // Chứng từ điều chỉnh (kiểm cùng luật) cũng không ghi được khi thiếu serial.
      const adjustment = await documents.create(clerk, {
        docType: 'ADJUSTMENT',
        warehouseCode: 'QA-KHO-HN',
        lines: [{ materialCode: sr, quantity: 1, direction: 'IN' }],
      });
      await documents.submit(clerk, adjustment.id);
      await documents.approve(admin, adjustment.id);
      expect((await rejection(documents.post(clerk, adjustment.id))).code).toBe('SERIALS_REQUIRED');
      expect(await stock(sr)).toMatchObject({ quantity: 2 });
    });

    it('BE005-14, BE005-15, BE005-16: /issues, /transfers nhận serial; thiếu serial thì 400; tồn từng kho bằng số serial Trong kho', async () => {
      const sr = await material('QA-KHO-SR', true);
      await post('RECEIPT_PURCHASE', 'QA-KHO-HN', [{ materialCode: sr, quantity: 3, serials: ['C1', 'C2', 'C3'] }]);

      await app.issueStock(clerk, { ...projectSource(), warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 1, serials: ['C1'] });
      expect(await serialRow(sr, 'C1')).toMatchObject({ stock_state: 'ISSUED', warehouse_code: null });

      const noSerial = await rejection(
        app.transferStock(clerk, { fromWarehouseCode: 'QA-KHO-HN', toWarehouseCode: 'QA-KHO-LOI', materialCode: sr, quantity: 1 }),
      );
      expect([noSerial.statusCode, noSerial.code]).toEqual([400, 'SERIALS_REQUIRED']);
      await app.transferStock(clerk, {
        fromWarehouseCode: 'QA-KHO-HN',
        toWarehouseCode: 'QA-KHO-LOI',
        materialCode: sr,
        quantity: 1,
        serials: ['C2'],
      });
      expect(await serialRow(sr, 'C2')).toMatchObject({ stock_state: 'IN_STOCK', warehouse_code: 'QA-KHO-LOI' });
      for (const warehouse of ['QA-KHO-HN', 'QA-KHO-LOI']) {
        expect((await stock(sr, warehouse)).quantity).toBe(await inStockSerials(sr, warehouse));
      }
      expect((await stock(sr)).quantity).toBe(1);
    });

    it('BE005-17: phiếu nhiều dòng trộn hàng serial và hàng thường; dòng serial thiếu serial thì 400, không chứng từ nào', async () => {
      const sr = await material('QA-KHO-SR', true);
      const plain = await material('QA-KHO-THUONG');
      const before = await pool.query(`SELECT count(*)::int AS n FROM inventory_schema.stock_documents`);
      const missing = await rejection(
        app.recordMovementLines(clerk, {
          kind: 'receipt',
          lines: [
            { warehouseCode: 'QA-KHO-HN', materialCode: plain, quantity: 5 },
            { warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 1 },
          ],
        }),
      );
      expect([missing.statusCode, missing.code]).toEqual([400, 'SERIALS_REQUIRED']);
      const after = await pool.query(`SELECT count(*)::int AS n FROM inventory_schema.stock_documents`);
      expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);

      const batch = await app.recordMovementLines(clerk, {
        kind: 'receipt',
        lines: [
          { warehouseCode: 'QA-KHO-HN', materialCode: plain, quantity: 5 },
          { warehouseCode: 'QA-KHO-HN', materialCode: sr, quantity: 1, serials: ['D1'] },
        ],
      });
      expect(batch.document).toMatchObject({ status: 'PENDING' });
      await documents.approve(admin, batch.document.id);
      await documents.post(clerk, batch.document.id);
      expect(await stock(plain)).toMatchObject({ quantity: 5 });
      expect(await stock(sr)).toMatchObject({ quantity: 1 });
      expect(await serialRow(sr, 'D1')).toMatchObject({ stock_state: 'IN_STOCK', warehouse_code: 'QA-KHO-HN' });
    });

    it('BE005-21: chặn bật theo dõi serial khi tồn chưa có serial; hết tồn thì bật được', async () => {
      const plain = await material('QA-KHO-BAT');
      await app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'QA-KHO-HN', materialCode: plain, quantity: 10 });
      const blocked = await rejection(app.updateMaterial(admin, plain, { isSerialized: true }));
      expect([blocked.statusCode, blocked.code]).toEqual([409, 'SERIALIZATION_STOCK_MISMATCH']);
      expect(blocked.message).toMatch(/^Vật tư đang có tồn chưa có serial \(kho QA-KHO-HN tồn 10, 0 serial Trong kho\)/);
      const viaSerials = await rejection(app.registerSerials(admin, { materialCode: plain, serialNumbers: ['E1'] }));
      expect(viaSerials.code).toBe('SERIALIZATION_STOCK_MISMATCH');
      expect((await app.getMaterial(admin, plain)).isSerialized).toBe(false);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM inventory_schema.serial_tracking s
           JOIN inventory_schema.materials m ON m.id = s.material_id WHERE m.code = $1`,
        [plain],
      );
      expect((rows[0] as { n: number }).n).toBe(0);

      await app.issueStock(clerk, { ...projectSource(), warehouseCode: 'QA-KHO-HN', materialCode: plain, quantity: 10 });
      expect((await app.updateMaterial(admin, plain, { isSerialized: true })).isSerialized).toBe(true);
    });
  });
});
