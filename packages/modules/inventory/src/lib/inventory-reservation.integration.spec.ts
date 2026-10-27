import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  CreateStockReservationRequest,
  Reservation,
} from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { createInventoryJobs, type InventoryJobs } from './inventory-jobs.factory.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

/** Số vòng lặp cho test tranh chấp: một lần xanh chưa chứng minh được không có race. */
const ROUNDS = 8;

integration('Giữ hàng trên PostgreSQL (INV-07, INV-08, T1-07 đến T1-11)', () => {
  const tenantId = randomUUID();
  let database: TestInventoryDatabase;
  let pool: Pool;
  let app: InventoryApplication;
  let documents: StockDocumentService;
  let jobs: InventoryJobs;
  let sequence = 0;

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
  const sales = actor('Bán hàng', {});
  const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

  /** Mã vật tư mới có sẵn tồn ở KHO-A, để mỗi kịch bản không dính số dư của kịch bản khác. */
  async function material(quantity: number, warehouseCode = 'KHO-A'): Promise<string> {
    sequence += 1;
    const code = `GH-${sequence}`;
    await app.createMaterial(admin, { code, name: `Vật tư ${code}`, category: 'CONSUMABLE', unit: 'Cái' });
    if (quantity > 0) await app.receiveStock(clerk, { warehouseCode, materialCode: code, quantity });
    return code;
  }

  async function balance(materialCode: string, warehouseCode = 'KHO-A') {
    const { rows } = await pool.query(
      `SELECT b.quantity, b.quantity_reserved
         FROM inventory_schema.material_inventory b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.materials m ON m.id = b.material_id
        WHERE w.code = $1 AND m.code = $2 AND b.location_id IS NULL`,
      [warehouseCode, materialCode],
    );
    return { quantity: Number(rows[0]?.quantity ?? 0), reserved: Number(rows[0]?.quantity_reserved ?? 0) };
  }

  function reserve(
    items: CreateStockReservationRequest['items'],
    extra: Partial<CreateStockReservationRequest> = {},
  ): Promise<Reservation> {
    return app.createStockReservation(sales, {
      sourceType: 'crm_order',
      sourceId: randomUUID(),
      warehouseCode: 'KHO-A',
      expiresAt: future(),
      items,
      ...extra,
    });
  }

  async function reservation(code: string) {
    return app.getReservation(sales, code);
  }

  async function events(type: string, aggregateId: string) {
    const { rows } = await pool.query(
      `SELECT payload FROM integration_schema.outbox_events
        WHERE event_type = $1 AND aggregate_id = $2 ORDER BY occurred_at`,
      [type, aggregateId],
    );
    return rows.map((row) => (row as { payload: { payload: Record<string, unknown>; tenantId: string } }).payload);
  }

  async function expire(reservationCode: string): Promise<void> {
    await pool.query(
      `UPDATE inventory_schema.reservations SET expires_at = now() - interval '1 minute'
        WHERE reservation_code = $1`,
      [reservationCode],
    );
  }

  async function issueAgainst(reservationId: string, materialCode: string, quantity: number) {
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_SALES',
      warehouseCode: 'KHO-A',
      lines: [{ materialCode, quantity, reservationId }],
    });
    return draft;
  }

  async function rejection(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string; message: string; details?: Record<string, unknown> };
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
    jobs = createInventoryJobs(database.references, database.pools);
    for (const code of ['KHO-A', 'KHO-B']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('migration 0012 đã chạy: job nhận ra DB sẵn sàng', async () => {
    await expect(jobs.ready(tenantId)).resolves.toBe(true);
  });

  it('Q4: giữ nhiều dòng tất cả hoặc không, 409 liệt kê mọi dòng thiếu', async () => {
    const plenty = await material(10);
    const scarce = await material(1);
    const elsewhere = await material(2, 'KHO-B');
    const sourceId = randomUUID();
    const error = await rejection(
      reserve(
        [
          { materialCode: plenty, quantityReserved: 5 },
          { materialCode: scarce, quantityReserved: 3 },
          { materialCode: elsewhere, quantityReserved: 4, warehouseCode: 'KHO-B' },
        ],
        { sourceId },
      ),
    );
    expect([error.statusCode, error.code]).toEqual([409, 'RESERVATION_INSUFFICIENT_STOCK']);
    expect(error.details?.['shortages']).toEqual([
      expect.objectContaining({ materialCode: scarce, warehouseCode: 'KHO-A', requested: 3, available: 1 }),
      expect.objectContaining({ materialCode: elsewhere, warehouseCode: 'KHO-B', requested: 4, available: 2 }),
    ]);
    expect(await balance(plenty)).toEqual({ quantity: 10, reserved: 0 });
    expect(await balance(scarce)).toEqual({ quantity: 1, reserved: 0 });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.reservations WHERE source_id = $1`,
      [sourceId],
    );
    expect((rows[0] as { n: number }).n).toBe(0);

    // Đủ thì giữ cả hai kho trong một lần, phát inventory.reservation.created cùng transaction.
    const created = await reserve(
      [
        { materialCode: plenty, quantityReserved: 5 },
        { materialCode: elsewhere, quantityReserved: 2, warehouseCode: 'KHO-B' },
      ],
      { sourceId },
    );
    expect(created).toMatchObject({ status: 'RESERVED', sourceType: 'crm_order', sourceId, referenceId: sourceId });
    expect(created.items).toHaveLength(2);
    expect(await balance(plenty)).toEqual({ quantity: 10, reserved: 5 });
    expect(await balance(elsewhere, 'KHO-B')).toEqual({ quantity: 2, reserved: 2 });
    const [event] = await events('inventory.reservation.created', created.id);
    expect(event).toMatchObject({
      tenantId,
      payload: {
        reservationCode: created.reservationCode,
        sourceType: 'crm_order',
        sourceId,
        actorUserId: sales.userId,
        lines: [
          expect.objectContaining({ materialCode: plenty, warehouseCode: 'KHO-A', quantity: 5 }),
          expect.objectContaining({ materialCode: elsewhere, warehouseCode: 'KHO-B', quantity: 2 }),
        ],
      },
    });
  });

  it('TC-CONC-04: gọi ba lần cùng khoá (song song) ra một giữ hàng; khác nội dung cùng khoá trả 409', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = await material(10);
      const sourceId = randomUUID();
      const request: CreateStockReservationRequest = {
        sourceType: 'crm_order',
        sourceId,
        idempotencyKey: `crm-order-${sourceId}`,
        warehouseCode: 'KHO-A',
        expiresAt: future(),
        items: [{ materialCode: code, quantityReserved: 4 }],
      };
      const results = await Promise.all([
        app.createStockReservation(sales, request),
        app.createStockReservation(sales, request),
        app.createStockReservation(sales, request),
      ]);
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      expect(await balance(code)).toEqual({ quantity: 10, reserved: 4 });
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM inventory_schema.reservations WHERE idempotency_key = $1`,
        [request.idempotencyKey],
      );
      expect((rows[0] as { n: number }).n).toBe(1);
      expect(await events('inventory.reservation.created', results[0].id)).toHaveLength(1);

      const conflict = await rejection(
        app.createStockReservation(sales, { ...request, items: [{ materialCode: code, quantityReserved: 5 }] }),
      );
      expect([conflict.statusCode, conflict.code]).toEqual([409, 'IDEMPOTENCY_KEY_CONFLICT']);
      expect(await balance(code)).toEqual({ quantity: 10, reserved: 4 });
    }
  });

  it('TC-CONC-04: khoá đã dùng cho lần thiếu tồn thì gọi lại sau khi đủ hàng vẫn giữ được', async () => {
    const code = await material(1);
    const request: CreateStockReservationRequest = {
      sourceType: 'crm_order',
      sourceId: randomUUID(),
      idempotencyKey: `crm-retry-${randomUUID()}`,
      warehouseCode: 'KHO-A',
      items: [{ materialCode: code, quantityReserved: 3 }],
    };
    expect((await rejection(app.createStockReservation(sales, request))).statusCode).toBe(409);
    await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: code, quantity: 2 });
    const created = await app.createStockReservation(sales, request);
    expect(created.status).toBe('RESERVED');
    expect(await balance(code)).toEqual({ quantity: 3, reserved: 3 });
  });

  it('TC-CONC-01: hai đơn cùng giữ phần tồn cuối cùng, đúng một thành công', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = await material(1);
      const results = await Promise.allSettled([
        reserve([{ materialCode: code, quantityReserved: 1 }]),
        reserve([{ materialCode: code, quantityReserved: 1 }]),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ statusCode: 409, code: 'RESERVATION_INSUFFICIENT_STOCK' });
      expect(await balance(code)).toEqual({ quantity: 1, reserved: 1 });
    }
  });

  it('TC-CONC-03: xuất tự do song song với giữ hàng không làm khả dụng âm', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = await material(10);
      const results = await Promise.allSettled([
        reserve([{ materialCode: code, quantityReserved: 8 }]),
        app.issueStock(clerk, { warehouseCode: 'KHO-A', materialCode: code, quantity: 5 }),
      ]);
      // 8 + 5 > 10: đúng một bên được, bên kia bị từ chối vì thiếu khả dụng.
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const after = await balance(code);
      expect(after.quantity - after.reserved).toBeGreaterThanOrEqual(0);
      expect(after.reserved + (10 - after.quantity)).toBeLessThanOrEqual(10);
      expect([after, results[0].status]).toEqual(
        results[0].status === 'fulfilled'
          ? [{ quantity: 10, reserved: 8 }, 'fulfilled']
          : [{ quantity: 5, reserved: 0 }, 'rejected'],
      );
    }
  });

  it('TC-INV-16: xuất tự do không lấy hàng đã giữ (chứng từ, API cũ, lắp vật tư)', async () => {
    const code = await material(20);
    await reserve([{ materialCode: code, quantityReserved: 15 }]);

    const draft = await documents.create(clerk, {
      docType: 'ISSUE_PROJECT',
      warehouseCode: 'KHO-A',
      lines: [{ materialCode: code, quantity: 10 }],
    });
    const posted = await rejection(documents.post(clerk, draft.id));
    expect([posted.statusCode, posted.code]).toEqual([409, 'INSUFFICIENT_AVAILABLE_STOCK']);
    expect(posted.message).toMatch(/^Không đủ tồn khả dụng/);

    const legacy = await rejection(app.issueStock(clerk, { warehouseCode: 'KHO-A', materialCode: code, quantity: 10 }));
    expect([legacy.statusCode, legacy.code]).toEqual([400, 'INSUFFICIENT_STOCK']);

    // Lắp vật tư đi đường `append` cũ: cũng kiểm theo khả dụng.
    const install = await rejection(app.installItem(admin, code, { warehouseCode: 'KHO-A', quantity: 10 }));
    expect([install.statusCode, install.code, install.message]).toEqual([
      400,
      'INSUFFICIENT_STOCK',
      `Kho KHO-A chỉ còn 5 ${code}, không đủ cho 10.`,
    ]);
    expect(await balance(code)).toEqual({ quantity: 20, reserved: 15 });

    // Trong phần khả dụng thì vẫn lắp được.
    await app.installItem(admin, code, { warehouseCode: 'KHO-A', quantity: 5 });
    expect(await balance(code)).toEqual({ quantity: 15, reserved: 15 });
  });

  it('TC-INV-15: xuất theo giữ hàng A trừ vào phần giữ của A, B không đổi', async () => {
    const code = await material(20);
    const other = await material(5);
    const a = await reserve([{ materialCode: code, quantityReserved: 10 }]);
    const b = await reserve([{ materialCode: code, quantityReserved: 5 }]);

    const first = await issueAgainst(a.id, code, 4);
    expect(first.lines[0].reservationId).toBe(a.id);
    await documents.post(clerk, first.id);
    expect(await balance(code)).toEqual({ quantity: 16, reserved: 11 });
    expect(await reservation(a.reservationCode)).toMatchObject({
      status: 'PARTIALLY_ISSUED',
      items: [expect.objectContaining({ quantityReserved: 10, quantityIssued: 4 })],
    });
    expect(await reservation(b.reservationCode)).toMatchObject({
      status: 'RESERVED',
      items: [expect.objectContaining({ quantityReserved: 5, quantityIssued: 0 })],
    });

    // Xuất quá phần còn giữ: 409, không gì đổi.
    const over = await rejection(documents.post(clerk, (await issueAgainst(a.id, code, 7)).id));
    expect([over.statusCode, over.code]).toEqual([409, 'RESERVATION_OVER_ISSUE']);
    expect(await balance(code)).toEqual({ quantity: 16, reserved: 11 });

    // Lệch vật tư: giữ hàng B không giữ mã khác.
    const mismatch = await rejection(documents.post(clerk, (await issueAgainst(b.id, other, 1)).id));
    expect([mismatch.statusCode, mismatch.code]).toEqual([409, 'RESERVATION_MISMATCH']);

    // Xuất nốt 6 thì A xuất đủ; xuất thêm theo A bị từ chối vì A đã đóng.
    await documents.post(clerk, (await issueAgainst(a.id, code, 6)).id);
    expect(await balance(code)).toEqual({ quantity: 10, reserved: 5 });
    expect((await reservation(a.reservationCode)).status).toBe('COMPLETED');
    const closed = await rejection(documents.post(clerk, (await issueAgainst(a.id, code, 1)).id));
    expect([closed.statusCode, closed.code]).toEqual([409, 'RESERVATION_CLOSED']);

    // Nhả A đã xuất đủ không trừ gì thêm.
    await app.releaseReservation(sales, a.reservationCode);
    expect(await balance(code)).toEqual({ quantity: 10, reserved: 5 });
    expect((await reservation(a.reservationCode)).status).toBe('COMPLETED');

    // Chỉ chứng từ xuất mới tham chiếu giữ hàng.
    const receipt = await rejection(
      documents.create(clerk, {
        docType: 'RECEIPT_PURCHASE',
        warehouseCode: 'KHO-A',
        lines: [{ materialCode: code, quantity: 1, reservationId: b.id }],
      }),
    );
    expect([receipt.statusCode, receipt.code]).toEqual([400, 'VALIDATION']);
  });

  it('nhả giữ hàng: trả phần chưa xuất, phát inventory.reservation.released một lần', async () => {
    const code = await material(10);
    const held = await reserve([{ materialCode: code, quantityReserved: 6 }]);
    await documents.post(clerk, (await issueAgainst(held.id, code, 2)).id);
    expect(await balance(code)).toEqual({ quantity: 8, reserved: 4 });

    const [first, second] = await Promise.all([
      app.releaseReservation(sales, held.reservationCode),
      app.releaseReservation(sales, held.reservationCode),
    ]);
    expect([first.status, second.status]).toEqual(['CANCELLED', 'CANCELLED']);
    expect(await balance(code)).toEqual({ quantity: 8, reserved: 0 });
    const released = await events('inventory.reservation.released', held.id);
    expect(released).toHaveLength(1);
    expect(released[0].payload).toMatchObject({
      reservationCode: held.reservationCode,
      status: 'CANCELLED',
      releasedQuantity: 4,
      releasedLines: [expect.objectContaining({ materialCode: code, quantity: 4 })],
      actorUserId: sales.userId,
    });
  });

  it('TC-INV-26, TC-INV-27: job nhả giữ hàng hết hạn; còn hạn, không hạn, đã xuất đủ thì không đụng', async () => {
    const code = await material(40);
    const expired = await reserve([{ materialCode: code, quantityReserved: 10 }]);
    const partly = await reserve([{ materialCode: code, quantityReserved: 10 }]);
    const valid = await reserve([{ materialCode: code, quantityReserved: 5 }]);
    const done = await reserve([{ materialCode: code, quantityReserved: 3 }]);
    const forever = await reserve([{ materialCode: code, quantityReserved: 2 }], { expiresAt: undefined });
    expect(forever.expiresAt).toBeUndefined();
    await documents.post(clerk, (await issueAgainst(partly.id, code, 4)).id);
    await documents.post(clerk, (await issueAgainst(done.id, code, 3)).id);
    for (const held of [expired, partly, done]) await expire(held.reservationCode);
    expect(await balance(code)).toEqual({ quantity: 33, reserved: 23 });

    const result = await jobs.expireReservations(tenantId);
    expect(result.map((row) => row.reservationCode).sort()).toEqual(
      [expired.reservationCode, partly.reservationCode].sort(),
    );
    expect(await balance(code)).toEqual({ quantity: 33, reserved: 7 });
    expect((await reservation(expired.reservationCode)).status).toBe('EXPIRED');
    expect(await reservation(partly.reservationCode)).toMatchObject({
      status: 'EXPIRED',
      items: [expect.objectContaining({ quantityIssued: 4 })],
    });
    expect((await reservation(valid.reservationCode)).status).toBe('RESERVED');
    expect((await reservation(done.reservationCode)).status).toBe('COMPLETED');
    expect((await reservation(forever.reservationCode)).status).toBe('RESERVED');

    const [event] = await events('inventory.reservation.expired', expired.id);
    expect(event.payload).toEqual({
      reservationId: expired.id,
      reservationCode: expired.reservationCode,
      referenceType: 'crm_order',
      referenceId: expired.sourceId,
      sourceType: 'crm_order',
      sourceId: expired.sourceId,
      status: 'EXPIRED',
      releasedLines: [expect.objectContaining({ materialCode: code, warehouseCode: 'KHO-A', quantity: 10 })],
      releasedQuantity: 10,
      actorUserId: null,
    });
    expect((await events('inventory.reservation.expired', partly.id))[0].payload).toMatchObject({
      releasedQuantity: 6,
    });

    // Chạy lại không nhả thêm.
    expect(await jobs.expireReservations(tenantId)).toEqual([]);
    expect(await balance(code)).toEqual({ quantity: 33, reserved: 7 });
    expect(await events('inventory.reservation.expired', expired.id)).toHaveLength(1);
  });

  it('TC-CONC-08: job hết hạn chạy đúng lúc xuất theo giữ hàng, kết quả luôn nhất quán', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = await material(10);
      const held = await reserve([{ materialCode: code, quantityReserved: 10 }]);
      const draft = await issueAgainst(held.id, code, 4);
      await expire(held.reservationCode);

      const [, posted] = await Promise.allSettled([
        jobs.expireReservations(tenantId),
        documents.post(clerk, draft.id),
      ]);
      // Job bỏ qua giữ hàng đang bị khoá (SKIP LOCKED); lượt sau nhả nốt.
      await jobs.expireReservations(tenantId);

      const after = await reservation(held.reservationCode);
      expect(after.status).toBe('EXPIRED');
      if (posted.status === 'fulfilled') {
        expect(await balance(code)).toEqual({ quantity: 6, reserved: 0 });
        expect(after.items?.[0].quantityIssued).toBe(4);
        expect((await events('inventory.reservation.expired', held.id))[0].payload).toMatchObject({
          releasedQuantity: 6,
        });
      } else {
        expect(posted.reason).toMatchObject({ statusCode: 409, code: 'RESERVATION_CLOSED' });
        expect(await balance(code)).toEqual({ quantity: 10, reserved: 0 });
        expect(after.items?.[0].quantityIssued).toBe(0);
      }
    }
  });

  it('TC-REG-02: giữ hàng cũ (không nguồn, không khoá) nhả theo mã như trước', async () => {
    const code = await material(10);
    // Giữ hàng do phiên bản cũ của Quy trình tạo: ghi thẳng như store cũ, cột mới để NULL.
    const legacyCode = `RES-${Date.now()}-123`;
    const { rows } = await pool.query(
      `WITH header AS (
         INSERT INTO inventory_schema.reservations
           (reservation_code, reference_type, reference_id, status, created_by)
         VALUES ($1, 'procedure_step', $2, 'RESERVED', $3)
         RETURNING id
       )
       INSERT INTO inventory_schema.reservation_items
         (reservation_id, warehouse_id, material_id, quantity_reserved, quantity_issued)
       SELECT header.id, w.id, m.id, 3, 0
         FROM header, inventory_schema.warehouses w, inventory_schema.materials m
        WHERE w.code = 'KHO-A' AND m.code = $4
       RETURNING reservation_id`,
      [legacyCode, randomUUID(), admin.userId, code],
    );
    await pool.query(
      `UPDATE inventory_schema.material_inventory b SET quantity_reserved = quantity_reserved + 3
         FROM inventory_schema.materials m
        WHERE m.id = b.material_id AND m.code = $1`,
      [code],
    );
    expect(await balance(code)).toEqual({ quantity: 10, reserved: 3 });

    // Quy trình gọi POST /v1/internal/reservations/:code/release bằng actor dịch vụ.
    const service = actor('Hệ thống', { canWriteTransactions: true });
    const released = await app.releaseReservation(service, legacyCode);
    expect(released).toMatchObject({ status: 'CANCELLED', sourceType: undefined, idempotencyKey: undefined });
    expect(await balance(code)).toEqual({ quantity: 10, reserved: 0 });
    const again = await app.releaseReservation(service, legacyCode);
    expect(again.status).toBe('CANCELLED');
    expect(await balance(code)).toEqual({ quantity: 10, reserved: 0 });
    const reservationId = String((rows[0] as { reservation_id: string }).reservation_id);
    expect(await events('inventory.reservation.released', reservationId)).toHaveLength(1);
  });

  it('cách gọi cũ của API giữ hàng (kho ở đầu phiếu, referenceType) vẫn chạy', async () => {
    const code = await material(5);
    const created = await app.createStockReservation(clerk, {
      warehouseCode: 'KHO-A',
      referenceType: 'test',
      referenceId: randomUUID(),
      items: [{ materialCode: code, quantityReserved: 2 }],
    });
    expect(created).toMatchObject({ status: 'RESERVED', referenceType: 'test', sourceType: undefined });
    expect(await balance(code)).toEqual({ quantity: 5, reserved: 2 });
  });
});
