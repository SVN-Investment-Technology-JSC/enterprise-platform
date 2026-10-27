import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { QualityService } from './application/quality.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { PostgresTraceabilityStore } from './infrastructure/postgres-traceability.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('API nội bộ Kho cho Bán hàng (T1-24 đến T1-27)', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;
  let quality: QualityService;

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
  /** Actor dịch vụ như guard dựng cho route `internal/`. */
  const service = actor('Hệ thống', {});
  const inspector = actor('Kiểm định', { canWriteQuality: true });

  async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string }> {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string };
    }
    throw new Error('expected rejection');
  }

  async function balance(warehouseCode: string, materialCode: string) {
    const { rows } = await pool.query(
      `SELECT b.quantity, b.quantity_reserved, b.quantity_blocked, b.available
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouseCode, materialCode],
    );
    const row = rows[0] ?? {};
    return {
      quantity: Number(row.quantity ?? 0),
      reserved: Number(row.quantity_reserved ?? 0),
      blocked: Number(row.quantity_blocked ?? 0),
      available: Number(row.available ?? 0),
    };
  }

  async function outbox(type: string, aggregateId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query(
      `SELECT payload FROM integration_schema.outbox_events WHERE event_type = $1 AND aggregate_id = $2`,
      [type, aggregateId],
    );
    return rows.map((row) => (row.payload as { payload: Record<string, unknown> }).payload);
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    app = new InventoryApplication(store, documentStore);
    documents = new StockDocumentService(documentStore, store);
    quality = new QualityService(new PostgresTraceabilityStore(database.references, database.pools));

    for (const code of ['QA-KHO', 'QA-KHO-2', 'QA-KHO-CL']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
    await app.createMaterial(admin, { code: 'QA-KHO-CAP', name: 'Cáp đồng', category: 'CONSUMABLE', unit: 'Mét', warrantyMonths: 24 });
    await app.createMaterial(admin, { code: 'QA-KHO-MAY', name: 'Máy cắt', category: 'SPARE_PART', unit: 'Cái', isSerialized: true });
    await app.createMaterial(admin, { code: 'QA-KHO-BT', name: 'Gói bảo trì', category: 'SPARE_PART', unit: 'Gói', kind: 'SERVICE', warrantyMonths: 0 });
    await app.createMaterial(admin, { code: 'QA-KHO-NGUNG', name: 'Mã ngừng dùng', category: 'SPARE_PART', unit: 'Cái' });
    await app.retireMaterial(admin, 'QA-KHO-NGUNG');

    const capReceipt = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'QA-KHO',
      lines: [{ materialCode: 'QA-KHO-CAP', quantity: 100, unitCost: 800_000 }],
    });
    await documents.post(clerk, capReceipt.id);
    await app.receiveStock(clerk, { warehouseCode: 'QA-KHO-2', materialCode: 'QA-KHO-CAP', quantity: 100, unitCost: 900_000 });
    await app.createStockReservation(clerk, {
      referenceType: 'crm_order',
      warehouseCode: 'QA-KHO',
      items: [{ materialCode: 'QA-KHO-CAP', quantityReserved: 30 }],
    });
    const mayReceipt = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'QA-KHO',
      lines: [{ materialCode: 'QA-KHO-MAY', quantity: 3, unitCost: 5_000_000, serials: ['SN031', 'SN032', 'SN033'] }],
    });
    await documents.post(clerk, mayReceipt.id);
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  describe('GET internal/materials (T1-24)', () => {
    it('TC-QUO-01, TC-QUO-03: tồn khả dụng theo kho, giá bình quân, loại, số tháng bảo hành', async () => {
      const page = await app.listMaterialCatalog(service, { codes: ['QA-KHO-CAP'] });
      expect(page.nextCursor).toBeNull();
      expect(page.materials).toHaveLength(1);
      const cap = page.materials[0];
      expect(cap).toMatchObject({
        code: 'QA-KHO-CAP',
        kind: 'STOCK',
        category: 'CONSUMABLE',
        unit: 'Mét',
        isSerialized: false,
        warrantyMonths: 24,
        totalAvailable: 170,
        available: 170,
        avgCost: 850_000,
      });
      expect(cap.availableByWarehouse).toEqual([
        expect.objectContaining({ warehouseCode: 'QA-KHO', available: 70, avgCost: 800_000 }),
        expect.objectContaining({ warehouseCode: 'QA-KHO-2', available: 100, avgCost: 900_000 }),
      ]);

      const onlyFirst = await app.listMaterialCatalog(service, { codes: ['QA-KHO-CAP'], warehouseCode: 'QA-KHO' });
      expect(onlyFirst.materials[0]).toMatchObject({ totalAvailable: 70, avgCost: 800_000 });
    });

    it('TC-QUO-02: dịch vụ không có trường tồn', async () => {
      const { materials } = await app.listMaterialCatalog(service, { kinds: ['SERVICE'] });
      expect(materials.map((item) => item.code)).toEqual(['QA-KHO-BT']);
      expect(materials[0]).toMatchObject({
        kind: 'SERVICE',
        warrantyMonths: 0,
        avgCost: null,
        availableByWarehouse: null,
        totalAvailable: null,
        available: 0,
      });
    });

    it('tìm theo mã, tên; phân trang theo mã; id và mã trả cả mã đã ngừng dùng', async () => {
      const search = await app.listMaterialCatalog(service, { search: 'máy' });
      expect(search.materials.map((item) => item.code)).toEqual(['QA-KHO-MAY']);

      const first = await app.listMaterialCatalog(service, { search: 'QA-KHO', limit: 2 });
      expect(first.materials.map((item) => item.code)).toEqual(['QA-KHO-BT', 'QA-KHO-CAP']);
      expect(first.nextCursor).toBe('QA-KHO-CAP');
      const second = await app.listMaterialCatalog(service, { search: 'QA-KHO', limit: 2, cursor: first.nextCursor ?? undefined });
      expect(second).toMatchObject({ nextCursor: null });
      expect(second.materials.map((item) => item.code)).toEqual(['QA-KHO-MAY']);

      const retired = await app.listMaterialCatalog(service, { codes: ['QA-KHO-NGUNG'] });
      expect(retired.materials[0]).toMatchObject({ code: 'QA-KHO-NGUNG', isActive: false });
      const byId = await app.listMaterialCatalog(service, { ids: [retired.materials[0].id] });
      expect(byId.materials.map((item) => item.code)).toEqual(['QA-KHO-NGUNG']);

      expect((await rejection(app.listMaterialCatalog(service, { limit: 0 }))).statusCode).toBe(400);
      expect((await rejection(app.listMaterialCatalog(service, { ids: ['x'] }))).statusCode).toBe(400);
      expect((await rejection(app.listMaterialCatalog(service, { kinds: ['ASSET' as never] }))).statusCode).toBe(400);
    });
  });

  describe('POST internal/issue-requests (T1-25) và inventory.stock.issued (T1-27)', () => {
    it('TC-ORD-06, TC-INT-16: chứng từ xuất nháp gắn giữ hàng và nguồn; chọn serial rồi ghi sổ phát sự kiện có giá vốn', async () => {
      const orderId = randomUUID();
      const reservation = await app.createStockReservation(service, {
        referenceType: 'crm_order',
        sourceType: 'crm_order',
        sourceId: orderId,
        warehouseCode: 'QA-KHO',
        items: [
          { materialCode: 'QA-KHO-CAP', quantityReserved: 10 },
          { materialCode: 'QA-KHO-MAY', quantityReserved: 2 },
        ],
      });
      const request = {
        idempotencyKey: `delivery-${orderId}-1`,
        warehouseCode: 'QA-KHO',
        sourceType: 'crm_delivery',
        sourceId: orderId,
        lines: [
          { materialCode: 'QA-KHO-CAP', quantity: 10, reservationId: reservation.id },
          { materialCode: 'QA-KHO-MAY', quantity: 2, reservationId: reservation.id },
        ],
      };
      const created = await documents.createIssueRequest(service, request);
      expect(created).toMatchObject({ docType: 'ISSUE_SALES', status: 'DRAFT' });
      expect(created.document).toMatchObject({ sourceType: 'crm_delivery', sourceId: orderId });
      expect(created.document.lines.map((line) => line.reservationId)).toEqual([reservation.id, reservation.id]);

      // Cùng khoá cùng nội dung: cùng chứng từ. Khác nội dung: 409.
      const replay = await documents.createIssueRequest(service, request);
      expect(replay.documentId).toBe(created.documentId);
      const conflict = await rejection(
        documents.createIssueRequest(service, { ...request, lines: [{ ...request.lines[0], quantity: 9 }] }),
      );
      expect([conflict.statusCode, conflict.code]).toEqual([409, 'IDEMPOTENCY_KEY_CONFLICT']);

      // Mặt hàng theo serial: ghi sổ thiếu serial bị từ chối.
      const missing = await rejection(documents.post(clerk, created.documentId));
      expect([missing.statusCode, missing.code]).toEqual([400, 'SERIALS_REQUIRED']);

      // Thủ kho chọn serial trên chứng từ nháp rồi ghi sổ.
      await documents.update(clerk, created.documentId, {
        lines: [
          { materialCode: 'QA-KHO-CAP', quantity: 10, reservationId: reservation.id },
          { materialCode: 'QA-KHO-MAY', quantity: 2, reservationId: reservation.id, serials: ['SN031', 'SN032'] },
        ],
      });
      const posted = await documents.post(clerk, created.documentId);
      expect(posted.document.lines.map((line) => [line.unitCost, line.costAmount])).toEqual([
        [800_000, 8_000_000],
        [5_000_000, 10_000_000],
      ]);

      const events = await outbox('inventory.stock.issued', created.documentId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        documentId: created.documentId,
        documentCode: created.documentCode,
        docType: 'ISSUE_SALES',
        sourceType: 'crm_delivery',
        sourceId: orderId,
        warehouseCode: 'QA-KHO',
        reversesDocumentId: null,
        totalCostAmount: 18_000_000,
        actorUserId: clerk.userId,
        materialCode: 'QA-KHO-CAP',
        quantityIssued: 10,
      });
      expect(events[0].lines).toEqual([
        expect.objectContaining({ materialCode: 'QA-KHO-CAP', quantity: 10, unitCost: 800_000, costAmount: 8_000_000, serials: [], reservationId: reservation.id }),
        expect.objectContaining({ materialCode: 'QA-KHO-MAY', quantity: 2, costAmount: 10_000_000, serials: ['SN031', 'SN032'] }),
      ]);
      expect((await app.getReservation(service, reservation.reservationCode)).status).toBe('COMPLETED');
    });

    it('TC-ORD-10: dòng dịch vụ không vào yêu cầu xuất; xuất bảo hành dùng ISSUE_WARRANTY', async () => {
      const service400 = await rejection(
        documents.createIssueRequest(service, {
          idempotencyKey: `svc-${randomUUID()}`,
          warehouseCode: 'QA-KHO',
          sourceType: 'crm_delivery',
          sourceId: randomUUID(),
          lines: [{ materialCode: 'QA-KHO-BT', quantity: 5 }],
        }),
      );
      expect([service400.statusCode, service400.code]).toEqual([400, 'SERVICE_MATERIAL_NOT_STOCKED']);

      const warranty = await documents.createIssueRequest(service, {
        idempotencyKey: `war-${randomUUID()}`,
        docType: 'ISSUE_WARRANTY',
        warehouseCode: 'QA-KHO',
        sourceType: 'crm_warranty',
        sourceId: randomUUID(),
        lines: [{ materialCode: 'QA-KHO-CAP', quantity: 1 }],
      });
      expect(warranty).toMatchObject({ docType: 'ISSUE_WARRANTY', status: 'DRAFT' });
      expect((await rejection(documents.createIssueRequest(service, { idempotencyKey: 'k', warehouseCode: 'QA-KHO', sourceType: 'x', sourceId: 'not-uuid', lines: [] }))).statusCode).toBe(400);
    });
  });

  describe('POST internal/return-receipts (T1-26) và inventory.stock.returned', () => {
    it('TC-WAR-07, TC-INT-17: serial về kho cách ly ở trạng thái Chờ kiểm định, không tính khả dụng', async () => {
      const warrantyId = randomUUID();
      const request = {
        idempotencyKey: `warranty-${warrantyId}`,
        warehouseCode: 'QA-KHO-CL',
        sourceType: 'crm_warranty',
        sourceId: warrantyId,
        lines: [{ materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN032'] }],
      };
      const result = await documents.receiveReturn(service, request);
      expect(result).toMatchObject({ docType: 'RECEIPT_SALES_RETURN', status: 'POSTED' });
      expect(await balance('QA-KHO-CL', 'QA-KHO-MAY')).toEqual({ quantity: 1, reserved: 0, blocked: 1, available: 0 });
      const { rows } = await pool.query(
        `SELECT s.quality_status, s.stock_state, w.code
           FROM inventory_schema.serial_tracking s
           JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
          WHERE s.serial_number = 'SN032'`,
      );
      expect(rows[0]).toEqual({ quality_status: 'PENDING_INSPECTION', stock_state: 'IN_STOCK', code: 'QA-KHO-CL' });

      const events = await outbox('inventory.stock.returned', result.documentId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        docType: 'RECEIPT_SALES_RETURN',
        warehouseCode: 'QA-KHO-CL',
        sourceType: 'crm_warranty',
        sourceId: warrantyId,
        qualityStatus: 'PENDING_INSPECTION',
      });
      expect(events[0].lines).toEqual([expect.objectContaining({ serials: ['SN032'], direction: 'IN' })]);

      // Gọi lại cùng khoá: cùng chứng từ, không nhập thêm, không phát thêm sự kiện.
      const replay = await documents.receiveReturn(service, request);
      expect(replay.documentId).toBe(result.documentId);
      expect((await balance('QA-KHO-CL', 'QA-KHO-MAY')).quantity).toBe(1);
      expect(await outbox('inventory.stock.returned', result.documentId)).toHaveLength(1);
      const conflict = await rejection(documents.receiveReturn(service, { ...request, warehouseCode: 'QA-KHO' }));
      expect(conflict.statusCode).toBe(409);

      // Kiểm định Đạt thì hàng trở lại khả dụng.
      await quality.changeSerial(inspector, 'SN032', { qualityStatus: 'PASSED', reason: 'Kiểm định đạt' });
      expect((await balance('QA-KHO-CL', 'QA-KHO-MAY')).available).toBe(1);
    });

    it('hàng không serial vào lô riêng Chờ kiểm định; giá vốn lấy theo dòng xuất gốc', async () => {
      const orderId = randomUUID();
      const issueDoc = await documents.createIssueRequest(service, {
        idempotencyKey: `cap-${orderId}`,
        warehouseCode: 'QA-KHO',
        sourceType: 'crm_delivery',
        sourceId: orderId,
        lines: [{ materialCode: 'QA-KHO-CAP', quantity: 5 }],
      });
      const posted = await documents.post(clerk, issueDoc.documentId);
      const issueLine = posted.document.lines[0];

      const back = await documents.receiveReturn(service, {
        idempotencyKey: `cap-back-${orderId}`,
        warehouseCode: 'QA-KHO-CL',
        sourceType: 'crm_return',
        sourceId: orderId,
        lines: [{ materialCode: 'QA-KHO-CAP', quantity: 2, sourceLineId: issueLine.id }],
      });
      const line = back.document.lines[0];
      expect(line).toMatchObject({ unitCost: issueLine.unitCost, sourceLineId: issueLine.id });
      expect(line.lotNo).toMatch(/^TH-[0-9A-F]{10}-1$/);
      expect(await balance('QA-KHO-CL', 'QA-KHO-CAP')).toEqual({ quantity: 2, reserved: 0, blocked: 2, available: 0 });
      const { rows } = await pool.query(`SELECT quality_status FROM inventory_schema.lots WHERE id = $1`, [line.lotId]);
      expect(rows[0].quality_status).toBe('PENDING_INSPECTION');
    });
  });
});
