import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { StockMovementService } from './application/stock-movement.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresStockMovementStore } from './infrastructure/postgres-stock-movement.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

// Lần gọi đầu mở ba kết nối mới tới DB vừa tạo; 5 giây mặc định không đủ khi máy bận.
jest.setTimeout(30_000);

integration('Danh sách gộp xuất/nhập kho trên PostgreSQL', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;
  let movements: StockMovementService;

  const admin: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Quản trị kho',
    canManage: true,
    canWriteTransactions: true,
    canApproveDocuments: true,
  };
  /** Người chỉ có quyền xem: danh sách gộp là endpoint đọc. */
  const reader: InventoryActor = {
    tenantId,
    userId: randomUUID(),
    displayName: 'Người xem',
    canManage: false,
    canWriteTransactions: false,
    canApproveDocuments: false,
  };

  /** Bút toán từ trước khi có chứng từ: ghi thẳng sổ, `document_id` trống. */
  async function legacyEntry(input: {
    code: string;
    warehouseCode: string;
    materialCode: string;
    type: string;
    quantity: number;
    createdAt: string;
    referenceType?: string;
    workflowStatus?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO inventory_schema.inventory_transactions
         (id, transaction_code, warehouse_id, material_id, type, quantity, unit_cost,
          reference_type, workflow_status, note, created_by, created_at)
       SELECT $1, $2, w.id, m.id, $5, $6, 0, $7, $8, 'Bút toán cũ', $9, $10::timestamptz
         FROM inventory_schema.warehouses w, inventory_schema.materials m
        WHERE w.code = $3 AND m.code = $4`,
      [
        id,
        input.code,
        input.warehouseCode,
        input.materialCode,
        input.type,
        input.quantity,
        input.referenceType ?? null,
        input.workflowStatus ?? 'APPROVED',
        admin.userId,
        input.createdAt,
      ],
    );
    return id;
  }

  async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string };
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
    movements = new StockMovementService(new PostgresStockMovementStore(database.references, database.pools));

    for (const code of ['GM-A', 'GM-B']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
    await app.createMaterial(admin, { code: 'GM-DAY', name: 'Dây cáp đồng', category: 'CONSUMABLE', unit: 'Mét' });
    await app.createMaterial(admin, { code: 'GM-OC', name: 'Ốc vít M8', category: 'CONSUMABLE', unit: 'Cái' });

    // Ghi sổ trực tiếp: sinh chứng từ Đã ghi sổ, không có nguồn.
    await app.receiveStock(admin, { warehouseCode: 'GM-A', materialCode: 'GM-DAY', quantity: 100, unitCost: 1000 });
    await app.receiveStock(admin, { warehouseCode: 'GM-A', materialCode: 'GM-OC', quantity: 40, unitCost: 500 });
    await app.transferStock(admin, {
      fromWarehouseCode: 'GM-A',
      toWarehouseCode: 'GM-B',
      materialCode: 'GM-DAY',
      quantity: 10,
    });
    // Chứng từ đầy đủ đang chờ duyệt, có nguồn viết hoa để kiểm chuẩn hoá.
    const pending = await documents.create(admin, {
      docType: 'ISSUE_OTHER',
      warehouseCode: 'GM-A',
      sourceType: 'Procedure',
      sourceId: randomUUID(),
      lines: [
        { materialCode: 'GM-OC', quantity: 3 },
        { materialCode: 'GM-DAY', quantity: 2 },
      ],
    });
    await documents.submit(admin, pending.id);

    // Ba bút toán cũ, trải trước và xen giữa các chứng từ theo thời gian.
    await legacyEntry({
      code: 'OLD-0001',
      warehouseCode: 'GM-A',
      materialCode: 'GM-DAY',
      type: 'IMPORT',
      quantity: 25,
      createdAt: '2020-01-10T03:00:00Z',
    });
    await legacyEntry({
      code: 'OLD-0002',
      warehouseCode: 'GM-B',
      materialCode: 'GM-OC',
      type: 'EXPORT',
      quantity: -4,
      createdAt: '2020-01-11T18:30:00Z',
      referenceType: 'STOCKTAKE',
    });
    await legacyEntry({
      code: 'OLD-0003',
      warehouseCode: 'GM-A',
      materialCode: 'GM-OC',
      type: 'EXPORT',
      quantity: -1,
      createdAt: '2099-01-01T00:00:00Z',
      workflowStatus: 'PENDING',
    });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('gộp chứng từ và bút toán cũ, mới nhất trước, tổng đúng', async () => {
    const page = await movements.list(reader, {});
    // 2 nhập + 1 điều chuyển + 1 chờ duyệt = 4 chứng từ; 3 bút toán cũ.
    expect(page.total).toBe(7);
    expect(page.rows).toHaveLength(7);
    expect(page.rows.filter((row) => row.kind === 'document')).toHaveLength(4);
    expect(page.rows.filter((row) => row.kind === 'legacy').map((row) => row.code)).toEqual([
      'OLD-0003',
      'OLD-0002',
      'OLD-0001',
    ]);
    const times = page.rows.map((row) => Date.parse(row.occurredAt));
    expect([...times].sort((left, right) => right - left)).toEqual(times);
    // Bút toán năm 2099 đứng đầu, trước mọi chứng từ: thứ tự chung, không theo nguồn.
    expect(page.rows[0]).toMatchObject({ kind: 'legacy', code: 'OLD-0003' });
    expect(page.pendingCount).toBe(1);
  });

  it('bút toán của chứng từ đã ghi sổ không hiện lặp thành dòng riêng', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.inventory_transactions WHERE document_id IS NOT NULL`,
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
    const page = await movements.list(reader, { kind: 'legacy' });
    expect(page.total).toBe(3);
    expect(page.rows.every((row) => row.code.startsWith('OLD-'))).toBe(true);
  });

  it('dòng chứng từ có số dòng, tổng số lượng, mặt hàng đầu và kho đích', async () => {
    const pending = (await movements.list(reader, { status: 'PENDING', kind: 'document' })).rows[0];
    expect(pending).toMatchObject({
      type: 'ISSUE_OTHER',
      status: 'PENDING',
      warehouseCode: 'GM-A',
      sourceType: 'procedure',
      lineCount: 2,
      quantityTotal: 5,
      materialCode: 'GM-OC',
      createdBy: admin.userId,
    });
    expect(pending.sourceId).toBeTruthy();

    const transfer = (await movements.list(reader, { docType: 'TRANSFER' })).rows;
    expect(transfer).toHaveLength(1);
    expect(transfer[0]).toMatchObject({
      kind: 'document',
      status: 'POSTED',
      warehouseCode: 'GM-A',
      targetWarehouseCode: 'GM-B',
      sourceType: 'manual',
      quantityTotal: 10,
    });
  });

  it('bút toán cũ: trạng thái suy từ workflow, nguồn chuẩn hoá, ngày theo giờ Việt Nam', async () => {
    const legacy = (await movements.list(reader, { kind: 'legacy' })).rows;
    const byCode = new Map(legacy.map((row) => [row.code, row]));
    expect(byCode.get('OLD-0001')).toMatchObject({
      type: 'IMPORT',
      status: 'POSTED',
      sourceType: 'manual',
      lineCount: 1,
      quantityTotal: 25,
      materialCode: 'GM-DAY',
      materialName: 'Dây cáp đồng',
      movementDate: '2020-01-10',
    });
    // 18:30 UTC ngày 11 là 01:30 ngày 12 giờ Việt Nam; số lượng âm hiện trị tuyệt đối.
    expect(byCode.get('OLD-0002')).toMatchObject({
      status: 'POSTED',
      sourceType: 'stocktake',
      quantityTotal: 4,
      movementDate: '2020-01-12',
    });
    expect(byCode.get('OLD-0003')).toMatchObject({ status: 'PENDING' });
  });

  it('phân trang đi qua ranh giới hai nguồn không lặp, không sót', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 7; offset += 3) {
      const page = await movements.list(reader, { limit: 3, offset });
      expect(page).toMatchObject({ total: 7, limit: 3, offset });
      seen.push(...page.rows.map((row) => `${row.kind}:${row.id}`));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const all = (await movements.list(reader, {})).rows.map((row) => `${row.kind}:${row.id}`);
    expect(seen).toEqual(all);
  });

  it('lọc theo kho khớp cả kho đi lẫn kho đích của điều chuyển', async () => {
    const page = await movements.list(reader, { warehouseCode: 'GM-B' });
    expect(page.rows.map((row) => row.kind).sort()).toEqual(['document', 'legacy']);
    expect(page.rows.find((row) => row.kind === 'document')).toMatchObject({ type: 'TRANSFER' });
    expect(page.rows.find((row) => row.kind === 'legacy')).toMatchObject({ code: 'OLD-0002' });
    expect(page.total).toBe(2);
    // Không có chứng từ chờ duyệt nào ở GM-B.
    expect(page.pendingCount).toBe(0);
  });

  it('lọc theo nguồn, trạng thái, khoảng ngày và từ khoá; tổng theo đúng bộ lọc', async () => {
    const stocktake = await movements.list(reader, { sourceType: 'Stocktake' });
    expect(stocktake.rows.map((row) => row.code)).toEqual(['OLD-0002']);

    const manual = await movements.list(reader, { sourceType: 'manual' });
    // 3 chứng từ ghi sổ trực tiếp + OLD-0001 + OLD-0003.
    expect(manual.total).toBe(5);

    const pending = await movements.list(reader, { status: 'PENDING' });
    expect(pending.rows.map((row) => row.kind).sort()).toEqual(['document', 'legacy']);

    const old = await movements.list(reader, { fromDate: '2020-01-12', toDate: '2020-01-12' });
    expect(old.rows.map((row) => row.code)).toEqual(['OLD-0002']);
    expect(old.total).toBe(1);

    const byName = await movements.list(reader, { search: 'ốc vít' });
    // Chứng từ nhập GM-OC, chứng từ chờ duyệt có dòng GM-OC, OLD-0002, OLD-0003.
    expect(byName.total).toBe(4);
    const byCode = await movements.list(reader, { search: 'OLD-0001' });
    expect(byCode.rows.map((row) => row.code)).toEqual(['OLD-0001']);
    // Ký tự đại diện của LIKE là chữ thường, không khớp mọi dòng.
    expect((await movements.list(reader, { search: '%' })).total).toBe(0);
  });

  it('tham số sai bị từ chối bằng lỗi VALIDATION', async () => {
    expect((await rejection(movements.list(reader, { kind: 'khac' as never }))).code).toBe('VALIDATION');
    expect((await rejection(movements.list(reader, { status: 'XONG' as never }))).code).toBe('VALIDATION');
    expect((await rejection(movements.list(reader, { docType: 'NHAP' as never }))).code).toBe('VALIDATION');
    expect((await rejection(movements.list(reader, { fromDate: '12/01/2020' }))).code).toBe('VALIDATION');
    expect((await rejection(movements.list(reader, { fromDate: '2020-02-01', toDate: '2020-01-01' }))).code).toBe(
      'VALIDATION',
    );
  });
});
