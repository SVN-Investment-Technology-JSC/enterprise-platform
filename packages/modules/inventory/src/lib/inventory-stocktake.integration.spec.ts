import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { StocktakeService } from './application/stocktake.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresStocktakeStore } from './infrastructure/postgres-stocktake.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('Kiểm kê kho trên PostgreSQL', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let stocktakes: StocktakeService;
  let documents: StockDocumentService;

  const actor = (name: string, rights: Partial<InventoryActor>): InventoryActor => ({
    tenantId,
    userId: randomUUID(),
    displayName: name,
    canManage: false,
    canWriteTransactions: true,
    canApproveDocuments: false,
    canCreateStocktake: false,
    canApproveStocktake: false,
    ...rights,
  });
  const admin = actor('Quản trị kho', { canManage: true, canCreateStocktake: true, canApproveStocktake: true });
  /** Thủ kho: lập, đếm, gửi duyệt, không duyệt. */
  const counter = actor('Thủ kho', { canCreateStocktake: true });
  /** Quản lý kho: duyệt, ghi sổ, không đếm. */
  const manager = actor('Quản lý kho', { canApproveStocktake: true });
  const outsider = actor('Nhân viên khác', {});

  async function onHand(warehouseCode: string, materialCode: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(b.quantity), 0) AS quantity
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2`,
      [warehouseCode, materialCode],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  async function lotOnHand(warehouseCode: string, materialCode: string, lotNo: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(lb.quantity), 0) AS quantity
         FROM inventory_schema.lot_balances lb
         JOIN inventory_schema.lots l ON l.id = lb.lot_id
         JOIN inventory_schema.materials m ON m.id = l.material_id
         JOIN inventory_schema.warehouses w ON w.id = lb.warehouse_id
        WHERE w.code = $1 AND m.code = $2 AND l.lot_no = $3`,
      [warehouseCode, materialCode, lotNo],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string }> {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string };
    }
    throw new Error('expected rejection');
  }

  async function newCountingSession(
    warehouseCode: string,
    scope: { readonly codes?: readonly string[] } = {},
  ): Promise<{ id: string; code: string; lines: Awaited<ReturnType<StocktakeService['lines']>> }> {
    const created = await stocktakes.create(counter, {
      title: `Kiểm kê ${warehouseCode}`,
      warehouseCode,
      scopeType: scope.codes ? 'SPECIFIC_ITEMS' : 'ALL',
      specificMaterialCodes: scope.codes,
    });
    const started = await stocktakes.start(counter, created.id);
    return { id: created.id, code: created.code, lines: [...started.lines] };
  }

  const line = (lines: readonly { materialCode: string; id: string }[], materialCode: string) => {
    const found = lines.find((item) => item.materialCode === materialCode);
    if (!found) throw new Error(`thiếu dòng ${materialCode}`);
    return found;
  };

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    const stocktakeStore = new PostgresStocktakeStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore);
    documents = new StockDocumentService(documentStore, store);
    stocktakes = new StocktakeService(stocktakeStore, documentStore, store);

    for (const code of ['KK-A', 'KK-B', 'KK-C', 'KK-D', 'KK-E', 'KK-EMPTY']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
    for (const code of ['VT-1', 'VT-2', 'VT-3', 'VT-LOT', 'VT-SN']) {
      await app.createMaterial(admin, {
        code,
        name: `Vật tư ${code}`,
        category: 'CONSUMABLE',
        unit: 'Cái',
        ...(code === 'VT-SN' ? { isSerialized: true } : {}),
      });
    }
    // KK-A, KK-B, KK-C, KK-D dùng cho từng ca; mỗi ca dựng tồn riêng để không dẫm nhau.
    for (const warehouse of ['KK-A', 'KK-B', 'KK-C', 'KK-D']) {
      await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: 'VT-1', quantity: 100, unitCost: 1000 });
      await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: 'VT-2', quantity: 50, unitCost: 2000 });
      await app.receiveStock(admin, { warehouseCode: warehouse, materialCode: 'VT-3', quantity: 5, unitCost: 500 });
    }
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('lập đợt ở Bản nháp với mã KK-năm-số tăng dần', async () => {
    const year = new Date().getFullYear();
    const first = await stocktakes.create(counter, { title: 'Đợt 1', warehouseCode: 'KK-E', scopeType: 'ALL' });
    const second = await stocktakes.create(counter, { title: 'Đợt 2', warehouseCode: 'KK-E', scopeType: 'ALL' });
    expect(first).toMatchObject({ status: 'DRAFT', warehouseCode: 'KK-E', totalItems: 0, createdBy: counter.userId });
    expect(first.code).toMatch(new RegExp(`^KK-${year}-\\d{5}$`));
    expect(Number(second.code.slice(-5))).toBe(Number(first.code.slice(-5)) + 1);
  });

  it('người không có quyền kiểm kê bị 403, kho hoặc phạm vi sai bị 400, 404', async () => {
    expect(
      (await rejection(stocktakes.create(outsider, { title: 'X', warehouseCode: 'KK-A', scopeType: 'ALL' }))).statusCode,
    ).toBe(403);
    expect(
      (await rejection(stocktakes.create(counter, { title: 'X', warehouseCode: 'KHONG-CO', scopeType: 'ALL' }))).statusCode,
    ).toBe(404);
    expect(
      (await rejection(stocktakes.create(counter, { title: 'X', warehouseCode: 'KK-A', scopeType: 'CATEGORY' }))).code,
    ).toBe('VALIDATION');
    expect((await rejection(stocktakes.create(counter, { title: '  ', warehouseCode: 'KK-A', scopeType: 'ALL' }))).code).toBe(
      'VALIDATION',
    );
  });

  it('bắt đầu chụp snapshot tồn và giá vốn; tồn đổi sau đó không làm đổi số sổ sách của đợt', async () => {
    const session = await newCountingSession('KK-A');
    const vt1 = line(session.lines, 'VT-1');
    expect(session.lines.filter((item) => ['VT-1', 'VT-2', 'VT-3'].includes(item.materialCode))).toHaveLength(3);
    expect(session.lines.find((item) => item.materialCode === 'VT-1')).toMatchObject({
      systemQuantity: 100,
      unitCost: 1000,
      status: 'UNCOUNTED',
    });

    // Nhập thêm sau snapshot: số sổ sách của đợt giữ 100, tồn hiện tại là 107.
    await app.receiveStock(admin, { warehouseCode: 'KK-A', materialCode: 'VT-1', quantity: 7, unitCost: 1000 });
    const lines = await stocktakes.lines(counter, session.id);
    expect(lines.find((item) => item.id === vt1.id)).toMatchObject({ systemQuantity: 100, currentQuantity: 107 });

    const header = await stocktakes.get(counter, session.id);
    expect(header).toMatchObject({ status: 'COUNTING', totalItems: 3, countedItems: 0 });
    expect(header.snapshotAt).toBeTruthy();
    // Trả tồn về như ban đầu cho các ca sau không lệch.
    await app.issueStock(admin, { warehouseCode: 'KK-A', materialCode: 'VT-1', quantity: 7 });
    await stocktakes.cancel(counter, session.id, 'Đợt thử snapshot');
  });

  it('không bắt đầu được khi phạm vi rỗng, mã không tồn tại hoặc đợt không ở Bản nháp', async () => {
    const empty = await stocktakes.create(counter, { title: 'Kho rỗng', warehouseCode: 'KK-EMPTY', scopeType: 'ALL' });
    expect((await rejection(stocktakes.start(counter, empty.id))).code).toBe('STOCKTAKE_EMPTY_SCOPE');

    const unknown = await stocktakes.create(counter, {
      title: 'Mã lạ',
      warehouseCode: 'KK-A',
      scopeType: 'SPECIFIC_ITEMS',
      specificMaterialCodes: ['VT-KHONG-CO'],
    });
    expect((await rejection(stocktakes.start(counter, unknown.id))).statusCode).toBe(404);

    const session = await newCountingSession('KK-A', { codes: ['VT-1'] });
    expect((await rejection(stocktakes.start(counter, session.id))).code).toBe('INVALID_STOCKTAKE_TRANSITION');
    await stocktakes.cancel(counter, session.id, 'Dọn');
  });

  it('ghi số đếm tính chênh lệch, giá trị lệch, nhật ký sửa; chưa bắt đầu hoặc sai số thì từ chối', async () => {
    const session = await newCountingSession('KK-B', { codes: ['VT-1', 'VT-2', 'VT-3'] });
    const vt1 = line(session.lines, 'VT-1');
    const vt2 = line(session.lines, 'VT-2');

    const saved = await stocktakes.saveLines(counter, session.id, {
      lines: [
        { lineId: vt1.id, actualQuantity: 97, reason: 'Hao hụt' },
        { lineId: vt2.id, actualQuantity: 50 },
      ],
    });
    expect(saved.lines.find((item) => item.id === vt1.id)).toMatchObject({
      status: 'DEFICIT',
      difference: -3,
      differenceValue: -3000,
      reason: 'Hao hụt',
    });
    expect(saved.lines.find((item) => item.id === vt2.id)).toMatchObject({ status: 'MATCHED', difference: 0 });
    expect(saved.session).toMatchObject({ countedItems: 2, differenceItems: 1, totalVarianceValue: -3000 });

    // Sửa lại số đếm: ghi nhật ký giá trị trước và sau.
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 98 }] });
    const audit = await stocktakes.audits(counter, session.id);
    const forLine = audit.filter((entry) => entry.lineId === vt1.id);
    expect(forLine.map((entry) => [entry.previousQuantity, entry.newQuantity, entry.operator])).toEqual([
      [undefined, 97, 'Thủ kho'],
      [97, 98, 'Thủ kho'],
    ]);

    expect(
      (await rejection(stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: -1 }] }))).code,
    ).toBe('VALIDATION');
    expect(
      (await rejection(stocktakes.saveLines(counter, session.id, { lines: [{ lineId: randomUUID(), actualQuantity: 1 }] })))
        .statusCode,
    ).toBe(404);
    await stocktakes.cancel(counter, session.id, 'Dọn');
  });

  it('gửi duyệt bắt buộc lý do ở dòng chênh lệch; sau khi gửi không sửa được số đếm', async () => {
    const session = await newCountingSession('KK-B', { codes: ['VT-1', 'VT-2'] });
    const vt1 = line(session.lines, 'VT-1');
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 90 }] });

    const noReason = await rejection(stocktakes.submit(counter, session.id));
    expect(noReason).toMatchObject({ statusCode: 409, code: 'STOCKTAKE_REASON_REQUIRED' });
    expect(noReason.message).toContain('VT-1');

    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, reason: 'Kiểm đếm lại thấy thiếu' }] });
    const submitted = await stocktakes.submit(counter, session.id);
    expect(submitted).toMatchObject({ status: 'PENDING_APPROVAL', submittedBy: counter.userId });

    expect(
      (await rejection(stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 91 }] }))).code,
    ).toBe('INVALID_STOCKTAKE_TRANSITION');

    // Trả về đếm lại: bắt buộc lý do, mở khoá số đếm.
    expect((await rejection(stocktakes.reject(manager, session.id, ' '))).code).toBe('VALIDATION');
    const rejected = await stocktakes.reject(manager, session.id, 'Đếm lại có kế toán giám sát');
    expect(rejected).toMatchObject({ status: 'COUNTING', rejectReason: 'Đếm lại có kế toán giám sát' });
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 91 }] });
    await stocktakes.cancel(counter, session.id, 'Dọn');
  });

  it('người lập hoặc gửi duyệt không tự duyệt; người không có quyền duyệt bị 403', async () => {
    const session = await newCountingSession('KK-B', { codes: ['VT-3'] });
    const vt3 = line(session.lines, 'VT-3');
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt3.id, actualQuantity: 5 }] });
    await stocktakes.submit(counter, session.id);

    expect((await rejection(stocktakes.approve(counter, session.id))).statusCode).toBe(403);
    // Quản trị cũng là người khác với người lập, nhưng tự lập rồi tự duyệt thì bị chặn.
    const adminSession = await stocktakes.create(admin, { title: 'Tự lập', warehouseCode: 'KK-B', scopeType: 'SPECIFIC_ITEMS', specificMaterialCodes: ['VT-3'] });
    await stocktakes.start(admin, adminSession.id);
    await stocktakes.submit(admin, adminSession.id);
    expect((await rejection(stocktakes.approve(admin, adminSession.id))).code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await stocktakes.approve(manager, adminSession.id)).status).toBe('APPROVED');

    const approved = await stocktakes.approve(manager, session.id);
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: manager.userId });
    await stocktakes.cancel(admin, session.id, 'Dọn');
    await stocktakes.cancel(admin, adminSession.id, 'Dọn');
  });

  it('ghi sổ cân kho: chứng từ điều chỉnh nguồn stocktake, tồn đúng, đợt khoá; gọi lại không điều chỉnh hai lần', async () => {
    const session = await newCountingSession('KK-C', { codes: ['VT-1', 'VT-2', 'VT-3'] });
    const vt1 = line(session.lines, 'VT-1');
    const vt2 = line(session.lines, 'VT-2');
    const vt3 = line(session.lines, 'VT-3');
    await stocktakes.saveLines(counter, session.id, {
      lines: [
        { lineId: vt1.id, actualQuantity: 96, reason: 'Hao hụt' },
        { lineId: vt2.id, actualQuantity: 53, reason: 'Nhập chưa ghi sổ' },
        { lineId: vt3.id, actualQuantity: 5 },
      ],
    });
    await stocktakes.submit(counter, session.id);

    // Chưa duyệt thì chưa ghi sổ được.
    expect((await rejection(stocktakes.post(manager, session.id))).code).toBe('INVALID_STOCKTAKE_TRANSITION');
    await stocktakes.approve(manager, session.id);
    expect((await rejection(stocktakes.post(counter, session.id))).statusCode).toBe(403);

    const result = await stocktakes.post(manager, session.id);
    expect(result.session).toMatchObject({ status: 'POSTED', documentId: result.document?.id });
    expect(result.document).toMatchObject({
      docType: 'ADJUSTMENT',
      status: 'POSTED',
      sourceType: 'stocktake',
      sourceId: session.id,
    });
    expect(result.document?.lines.map((item) => [item.materialCode, item.direction, item.quantity])).toEqual([
      ['VT-1', 'OUT', 4],
      ['VT-2', 'IN', 3],
    ]);
    expect([await onHand('KK-C', 'VT-1'), await onHand('KK-C', 'VT-2'), await onHand('KK-C', 'VT-3')]).toEqual([96, 53, 5]);

    // Gọi lại: trả kết quả cũ, tồn không đổi, không sinh chứng từ thứ hai.
    const again = await stocktakes.post(manager, session.id);
    expect(again.document?.id).toBe(result.document?.id);
    expect([await onHand('KK-C', 'VT-1'), await onHand('KK-C', 'VT-2')]).toEqual([96, 53]);
    const adjustments = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.stock_documents WHERE source_type = 'stocktake' AND source_id = $1`,
      [session.id],
    );
    expect(adjustments.rows[0].n).toBe(1);

    // Đợt đã ghi sổ chỉ đọc: không sửa, không huỷ.
    expect(
      (await rejection(stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 1 }] }))).code,
    ).toBe('INVALID_STOCKTAKE_TRANSITION');
    expect((await rejection(stocktakes.cancel(counter, session.id, 'Huỷ'))).code).toBe('INVALID_STOCKTAKE_TRANSITION');
    // Sổ kho thấy chứng từ điều chỉnh trong danh sách chứng từ.
    const listed = await documents.list(admin, { sourceType: 'stocktake' });
    expect(listed.items.some((item) => item.id === result.document?.id)).toBe(true);
  });

  it('hai người ghi sổ cùng lúc chỉ điều chỉnh tồn một lần', async () => {
    const session = await newCountingSession('KK-D', { codes: ['VT-1'] });
    const vt1 = line(session.lines, 'VT-1');
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: vt1.id, actualQuantity: 90, reason: 'Hao hụt' }] });
    await stocktakes.submit(counter, session.id);
    await stocktakes.approve(manager, session.id);

    const results = await Promise.allSettled([stocktakes.post(manager, session.id), stocktakes.post(admin, session.id)]);
    expect(results.some((item) => item.status === 'fulfilled')).toBe(true);
    expect(await onHand('KK-D', 'VT-1')).toBe(90);
    const adjustments = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.stock_documents WHERE source_type = 'stocktake' AND source_id = $1`,
      [session.id],
    );
    expect(adjustments.rows[0].n).toBe(1);
    expect((await stocktakes.get(manager, session.id)).status).toBe('POSTED');
  });

  it('đợt không có chênh lệch ghi sổ không sinh chứng từ', async () => {
    const session = await newCountingSession('KK-D', { codes: ['VT-2'] });
    await stocktakes.saveLines(counter, session.id, { lines: [{ lineId: line(session.lines, 'VT-2').id, actualQuantity: 50 }] });
    await stocktakes.submit(counter, session.id);
    await stocktakes.approve(manager, session.id);
    const result = await stocktakes.post(manager, session.id);
    expect(result.session.status).toBe('POSTED');
    expect(result.document).toBeUndefined();
    expect(result.session.documentId).toBeUndefined();
  });

  it('vật tư theo lô: snapshot có danh sách lô, ghi sổ điều chỉnh đúng từng lô', async () => {
    await app.receiveStock(admin, { warehouseCode: 'KK-E', materialCode: 'VT-LOT', quantity: 10, unitCost: 100, lot: { lotNo: 'L1' } });
    await app.receiveStock(admin, { warehouseCode: 'KK-E', materialCode: 'VT-LOT', quantity: 6, unitCost: 100, lot: { lotNo: 'L2' } });
    const session = await newCountingSession('KK-E', { codes: ['VT-LOT'] });
    const lot = line(session.lines, 'VT-LOT');
    const fresh = (await stocktakes.lines(counter, session.id)).find((item) => item.id === lot.id);
    expect(fresh).toMatchObject({ isLotTracked: true, systemQuantity: 16 });
    expect(fresh?.lotAllocations?.map((item) => [item.lotNumber, item.systemQty])).toEqual([
      ['L1', 10],
      ['L2', 6],
    ]);

    // Lệch mà chưa khai chi tiết lô: ghi sổ báo lỗi rõ ràng.
    await stocktakes.saveLines(counter, session.id, {
      lines: [{ lineId: lot.id, actualQuantity: 15, reason: 'Thiếu 1 ở lô L1' }],
    });
    await stocktakes.saveLines(counter, session.id, {
      lines: [
        {
          lineId: lot.id,
          lotAllocations: [
            { lotNumber: 'L1', systemQty: 10, actualQty: 9 },
            { lotNumber: 'L2', systemQty: 6, actualQty: 6 },
          ],
        },
      ],
    });
    await stocktakes.submit(counter, session.id);
    await stocktakes.approve(manager, session.id);
    const result = await stocktakes.post(manager, session.id);
    expect(result.document?.lines.map((item) => [item.lotNo, item.direction, item.quantity])).toEqual([['L1', 'OUT', 1]]);
    expect(await lotOnHand('KK-E', 'VT-LOT', 'L1')).toBe(9);
    expect(await lotOnHand('KK-E', 'VT-LOT', 'L2')).toBe(6);
    expect(await onHand('KK-E', 'VT-LOT')).toBe(15);
  });

  it('vật tư theo serial: serial báo mất thành dòng giảm kèm đúng serial', async () => {
    await app.receiveStock(admin, {
      warehouseCode: 'KK-E',
      materialCode: 'VT-SN',
      quantity: 3,
      unitCost: 5000,
      serials: ['SN-1', 'SN-2', 'SN-3'],
    });
    const session = await newCountingSession('KK-E', { codes: ['VT-SN'] });
    const sn = line(session.lines, 'VT-SN');
    const fresh = (await stocktakes.lines(counter, session.id)).find((item) => item.id === sn.id);
    expect(fresh?.isSerialized).toBe(true);
    expect(fresh?.serialAllocations?.map((item) => item.serialNumber)).toEqual(['SN-1', 'SN-2', 'SN-3']);

    await stocktakes.saveLines(counter, session.id, {
      lines: [
        {
          lineId: sn.id,
          reason: 'Mất SN-2',
          serialAllocations: [
            { serialNumber: 'SN-1', status: 'FOUND' },
            { serialNumber: 'SN-2', status: 'MISSING' },
            { serialNumber: 'SN-3', status: 'FOUND' },
          ],
        },
      ],
    });
    await stocktakes.submit(counter, session.id);
    await stocktakes.approve(manager, session.id);
    const result = await stocktakes.post(manager, session.id);
    expect(result.document?.lines.map((item) => [item.direction, item.quantity, item.serials])).toEqual([
      ['OUT', 1, ['SN-2']],
    ]);
    expect(await onHand('KK-E', 'VT-SN')).toBe(2);
    const state = await pool.query(
      `SELECT stock_state FROM inventory_schema.serial_tracking WHERE serial_number = 'SN-2'`,
    );
    expect(state.rows[0].stock_state).not.toBe('IN_STOCK');
  });

  it('huỷ đợt bắt buộc lý do và không huỷ được đợt đã huỷ', async () => {
    const created = await stocktakes.create(counter, { title: 'Huỷ thử', warehouseCode: 'KK-A', scopeType: 'ALL' });
    expect((await rejection(stocktakes.cancel(counter, created.id, ''))).code).toBe('VALIDATION');
    const cancelled = await stocktakes.cancel(counter, created.id, 'Lịch bảo trì đột xuất');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Lịch bảo trì đột xuất' });
    expect((await rejection(stocktakes.cancel(counter, created.id, 'Lần hai'))).code).toBe('INVALID_STOCKTAKE_TRANSITION');
  });

  it('danh sách lọc theo kho, trạng thái, từ khoá và đếm tổng', async () => {
    const all = await stocktakes.list(counter, { limit: 200 });
    expect(all.total).toBeGreaterThan(5);
    const cancelled = await stocktakes.list(counter, { status: 'CANCELLED', warehouseCode: 'KK-A' });
    expect(cancelled.items.length).toBeGreaterThan(0);
    expect(cancelled.items.every((item) => item.status === 'CANCELLED' && item.warehouseCode === 'KK-A')).toBe(true);
    const searched = await stocktakes.list(counter, { search: 'Huỷ thử' });
    expect(searched.items.map((item) => item.title)).toContain('Huỷ thử');
    expect((await rejection(stocktakes.list(counter, { status: 'XYZ' as never }))).code).toBe('VALIDATION');
    expect((await rejection(stocktakes.get(counter, randomUUID()))).statusCode).toBe(404);
  });
});
