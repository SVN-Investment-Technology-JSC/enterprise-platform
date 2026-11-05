import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { InventoryApplication, type InventoryActor } from './application/inventory.application.js';
import { StockDocumentService } from './application/stock-document.service.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';
import { PostgresStockDocumentStore } from './infrastructure/postgres-stock-document.store.js';
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;

integration('Chứng từ kho trên PostgreSQL (INV-01, INV-02)', () => {
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
  const keeper = actor('Quản lý kho', { canApproveDocuments: true });

  async function onHand(warehouseCode: string, materialCode: string): Promise<{ quantity: number; reserved: number }> {
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

  async function ledgerCount(documentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.inventory_transactions WHERE document_id = $1`,
      [documentId],
    );
    return (rows[0] as { n: number }).n;
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

    for (const code of ['KHO-A', 'KHO-B', 'KHO-C']) {
      await app.createWarehouse(admin, { code, name: `Kho ${code}` });
    }
    for (const code of ['VT-1', 'VT-2', 'VT-3']) {
      await app.createMaterial(admin, { code, name: `Vật tư ${code}`, category: 'CONSUMABLE', unit: 'Cái' });
    }
    await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: 'VT-1', quantity: 100, unitCost: 1000 });
    await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: 'VT-2', quantity: 50 });
    await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: 'VT-3', quantity: 5 });
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('TC-INV-01: chứng từ nhập ba dòng ghi sổ nguyên tử, ba bút toán cùng document_id', async () => {
    const before = await Promise.all(['VT-1', 'VT-2', 'VT-3'].map((code) => onHand('KHO-B', code)));
    const draft = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO-B',
      lines: [
        { materialCode: 'VT-1', quantity: 10, unitCost: 1200 },
        { materialCode: 'VT-2', quantity: 20 },
        { materialCode: 'VT-3', quantity: 30 },
      ],
    });
    await documents.submit(clerk, draft.id);
    await documents.approve(keeper, draft.id);
    const posted = await documents.post(clerk, draft.id);

    expect(posted.document).toMatchObject({ status: 'POSTED', postedBy: clerk.userId, approvedBy: keeper.userId });
    expect(posted.transactions.map((row) => [row.type, row.quantity, row.documentId])).toEqual([
      ['IMPORT', 10, draft.id],
      ['IMPORT', 20, draft.id],
      ['IMPORT', 30, draft.id],
    ]);
    const after = await Promise.all(['VT-1', 'VT-2', 'VT-3'].map((code) => onHand('KHO-B', code)));
    expect(after.map((row, index) => row.quantity - before[index].quantity)).toEqual([10, 20, 30]);
    expect(await ledgerCount(draft.id)).toBe(3);
  });

  it('TC-INV-02: dòng thứ ba vượt tồn thì 409, không dòng nào được ghi', async () => {
    const before = await Promise.all(['VT-1', 'VT-2', 'VT-3'].map((code) => onHand('KHO-A', code)));
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_SALES',
      warehouseCode: 'KHO-A',
      lines: [
        { materialCode: 'VT-1', quantity: 1 },
        { materialCode: 'VT-2', quantity: 1 },
        { materialCode: 'VT-3', quantity: 999 },
      ],
    });
    const error = await rejection(documents.post(clerk, draft.id));
    expect([error.statusCode, error.code]).toEqual([409, 'INSUFFICIENT_AVAILABLE_STOCK']);
    expect(error.message).toMatch(/^Không đủ tồn khả dụng/);

    const after = await Promise.all(['VT-1', 'VT-2', 'VT-3'].map((code) => onHand('KHO-A', code)));
    expect(after).toEqual(before);
    expect(await ledgerCount(draft.id)).toBe(0);
    expect((await documents.get(clerk, draft.id)).status).toBe('DRAFT');
  });

  it('TC-INV-03, TC-INV-04: nhập khác chỉ đổi tồn sau khi người khác duyệt; bật cài đặt thì tự duyệt được', async () => {
    const before = await onHand('KHO-C', 'VT-1');
    const draft = await documents.create(keeper, {
      docType: 'RECEIPT_OTHER',
      warehouseCode: 'KHO-C',
      lines: [{ materialCode: 'VT-1', quantity: 10 }],
    });
    expect((await rejection(documents.post(keeper, draft.id))).statusCode).toBe(409);
    await documents.submit(keeper, draft.id);
    expect(await onHand('KHO-C', 'VT-1')).toEqual(before);

    const self = await rejection(documents.approve(keeper, draft.id));
    expect([self.statusCode, self.message]).toEqual([403, 'Không được tự duyệt chứng từ do mình lập.']);

    await app.updateSetting(admin, 'documents.approval', { value: { allowSelfApproval: true } });
    try {
      await documents.approve(keeper, draft.id);
    } finally {
      await app.updateSetting(admin, 'documents.approval', { value: { allowSelfApproval: false } });
    }
    expect(await onHand('KHO-C', 'VT-1')).toEqual(before);
    await documents.post(keeper, draft.id);
    expect((await onHand('KHO-C', 'VT-1')).quantity).toBe(before.quantity + 10);
  });

  it('TC-INV-05: xuất theo đơn bán ghi sổ thẳng từ Nháp', async () => {
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_SALES',
      warehouseCode: 'KHO-A',
      sourceType: 'crm_order',
      sourceId: randomUUID(),
      lines: [{ materialCode: 'VT-2', quantity: 1 }],
    });
    const posted = await documents.post(clerk, draft.id);
    expect(posted.document.status).toBe('POSTED');
    expect(posted.document.submittedAt).toBeUndefined();
    expect(posted.transactions[0]).toMatchObject({ referenceType: 'crm_order', referenceId: draft.sourceId });
  });

  it('TC-INV-06: điều chuyển nguyên tử — vế nhập lỗi thì kho đi không bị trừ', async () => {
    const source = await onHand('KHO-A', 'VT-1');
    const target = await onHand('KHO-C', 'VT-1');
    // Giả lập kho đến bị khoá: chặn mọi bút toán nhập vào KHO-C.
    await pool.query(`
      CREATE OR REPLACE FUNCTION inventory_schema.test_block_kho_c() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.quantity > 0 AND NEW.warehouse_id = (SELECT id FROM inventory_schema.warehouses WHERE code = 'KHO-C') THEN
          RAISE EXCEPTION 'Kho đến đang khoá';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_block_kho_c BEFORE INSERT ON inventory_schema.inventory_transactions
        FOR EACH ROW EXECUTE FUNCTION inventory_schema.test_block_kho_c();`);
    try {
      await expect(
        app.transferStock(clerk, { fromWarehouseCode: 'KHO-A', toWarehouseCode: 'KHO-C', materialCode: 'VT-1', quantity: 5 }),
      ).rejects.toThrow('Kho đến đang khoá');
    } finally {
      await pool.query(`DROP TRIGGER test_block_kho_c ON inventory_schema.inventory_transactions;
                        DROP FUNCTION inventory_schema.test_block_kho_c();`);
    }
    expect(await onHand('KHO-A', 'VT-1')).toEqual(source);
    expect(await onHand('KHO-C', 'VT-1')).toEqual(target);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_schema.stock_documents WHERE doc_type = 'TRANSFER' AND status <> 'POSTED'`,
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('TC-REG-01: API cũ nhập, xuất, điều chuyển giữ response, bút toán có document_id', async () => {
    const receipt = await app.receiveStock(clerk, {
      warehouseCode: 'KHO-B',
      materialCode: 'VT-1',
      quantity: 4,
      unitCost: 1500,
      note: 'Nhập lẻ',
    });
    expect(receipt).toMatchObject({ type: 'IMPORT', quantity: 4, unitCost: 1500, note: 'Nhập lẻ', workflowStatus: 'APPROVED' });
    expect(receipt.documentId).toBeDefined();

    const issue = await app.issueStock(clerk, { warehouseCode: 'KHO-B', materialCode: 'VT-1', quantity: 1 });
    expect(issue).toMatchObject({ type: 'EXPORT', quantity: -1 });

    const moved = await app.transferStock(clerk, {
      fromWarehouseCode: 'KHO-B',
      toWarehouseCode: 'KHO-C',
      materialCode: 'VT-1',
      quantity: 2,
      note: 'Bổ sung',
    });
    expect(moved.out).toMatchObject({ type: 'EXPORT', quantity: -2, note: 'Bổ sung (Xuất chuyển đến kho KHO-C)' });
    expect(moved.in).toMatchObject({
      type: 'IMPORT',
      quantity: 2,
      referenceType: 'inventory_transaction',
      referenceId: moved.out.id,
      note: `Bổ sung (Nhập chuyển từ kho KHO-B theo ${moved.out.transactionCode})`,
    });
    expect(moved.in.documentId).toBe(moved.out.documentId);

    const legacyError = await rejection(
      app.issueStock(clerk, { warehouseCode: 'KHO-B', materialCode: 'VT-1', quantity: 100_000 }),
    );
    expect([legacyError.statusCode, legacyError.code]).toEqual([400, 'INSUFFICIENT_STOCK']);
  });

  it('xuất tự do không lấy phần đã giữ: kiểm theo tồn khả dụng', async () => {
    await app.receiveStock(clerk, { warehouseCode: 'KHO-C', materialCode: 'VT-3', quantity: 20 });
    await app.createStockReservation(clerk, {
      warehouseCode: 'KHO-C',
      referenceType: 'test',
      referenceId: randomUUID(),
      items: [{ materialCode: 'VT-3', quantityReserved: 15 }],
    });
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_PROJECT',
      warehouseCode: 'KHO-C',
      lines: [{ materialCode: 'VT-3', quantity: 10 }],
    });
    const error = await rejection(documents.post(clerk, draft.id));
    expect([error.statusCode, error.code]).toEqual([409, 'INSUFFICIENT_AVAILABLE_STOCK']);
    expect(await onHand('KHO-C', 'VT-3')).toEqual({ quantity: 20, reserved: 15 });
  });

  it('TC-CONC-07: ba người cùng ghi sổ một chứng từ — ghi một lần, tồn đổi một lần', async () => {
    const before = await onHand('KHO-A', 'VT-1');
    const draft = await documents.create(clerk, {
      docType: 'ISSUE_OTHER',
      warehouseCode: 'KHO-A',
      lines: [
        { materialCode: 'VT-1', quantity: 3 },
        { materialCode: 'VT-1', quantity: 2 },
      ],
    });
    await documents.submit(clerk, draft.id);
    await documents.approve(keeper, draft.id);
    const results = await Promise.allSettled([
      documents.post(clerk, draft.id),
      documents.post(keeper, draft.id),
      documents.post(admin, draft.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ statusCode: 409, code: 'STOCK_DOCUMENT_INVALID_TRANSITION' });
      }
    }
    expect((await onHand('KHO-A', 'VT-1')).quantity).toBe(before.quantity - 5);
    expect(await ledgerCount(draft.id)).toBe(2);
  });

  it('điều chuyển ngược chiều đồng thời không khoá chéo (khoá theo thứ tự warehouse_id, material_id)', async () => {
    await app.receiveStock(clerk, { warehouseCode: 'KHO-B', materialCode: 'VT-2', quantity: 50 });
    await app.receiveStock(clerk, { warehouseCode: 'KHO-C', materialCode: 'VT-2', quantity: 50 });
    const total = async () =>
      (await onHand('KHO-B', 'VT-2')).quantity + (await onHand('KHO-C', 'VT-2')).quantity;
    const before = await total();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        app.transferStock(clerk, {
          fromWarehouseCode: index % 2 ? 'KHO-B' : 'KHO-C',
          toWarehouseCode: index % 2 ? 'KHO-C' : 'KHO-B',
          materialCode: 'VT-2',
          quantity: 1,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    expect(await total()).toBe(before);
  });

  it('TC-INV-22, TC-INV-23: chứng từ đã ghi sổ không sửa được, sửa sai bằng chứng từ đảo', async () => {
    const before = await onHand('KHO-B', 'VT-3');
    const draft = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO-B',
      lines: [{ materialCode: 'VT-3', quantity: 7, unitCost: 500 }],
    });
    await documents.post(clerk, draft.id);
    const edit = await rejection(
      documents.update(clerk, draft.id, { lines: [{ materialCode: 'VT-3', quantity: 70 }] }),
    );
    expect([edit.statusCode, edit.message]).toEqual([409, 'Chứng từ đã ghi sổ không được sửa.']);

    const reversal = await documents.reverse(clerk, draft.code);
    expect(reversal.document).toMatchObject({ status: 'POSTED', reversesDocumentId: draft.id, docType: 'RECEIPT_PURCHASE' });
    expect(reversal.document.lines[0]).toMatchObject({ direction: 'OUT', quantity: 7 });
    expect(reversal.transactions[0]).toMatchObject({ type: 'EXPORT', quantity: -7 });
    expect(await onHand('KHO-B', 'VT-3')).toEqual(before);

    const original = await documents.get(clerk, draft.id);
    expect(original).toMatchObject({ status: 'POSTED', lines: [{ quantity: 7, direction: 'IN' }] });
    expect((await rejection(documents.reverse(clerk, draft.id))).statusCode).toBe(409);
    expect((await rejection(documents.reverse(clerk, reversal.document.id))).statusCode).toBe(409);
  });

  it('TC-INV-25: sổ kho và chứng từ đã ghi sổ chặn UPDATE, DELETE ở DB', async () => {
    const receipt = await app.receiveStock(clerk, { warehouseCode: 'KHO-A', materialCode: 'VT-2', quantity: 1 });
    await expect(
      pool.query(`UPDATE inventory_schema.inventory_transactions SET quantity = 999 WHERE id = $1`, [receipt.id]),
    ).rejects.toThrow(/Sổ kho chỉ ghi thêm/);
    await expect(
      pool.query(`DELETE FROM inventory_schema.inventory_transactions WHERE id = $1`, [receipt.id]),
    ).rejects.toThrow(/Sổ kho chỉ ghi thêm/);
    await expect(
      pool.query(`UPDATE inventory_schema.stock_documents SET note = 'x' WHERE id = $1`, [receipt.documentId]),
    ).rejects.toThrow(/đã ghi sổ không được sửa/);
    await expect(
      pool.query(`UPDATE inventory_schema.stock_document_lines SET quantity = 2 WHERE document_id = $1`, [receipt.documentId]),
    ).rejects.toThrow(/đã ghi sổ không được sửa/);
  });

  it('khoá chống lặp: tạo lại cùng idempotencyKey trả chứng từ cũ', async () => {
    const request = {
      docType: 'ISSUE_SALES' as const,
      warehouseCode: 'KHO-A',
      idempotencyKey: `order-${randomUUID()}`,
      lines: [{ materialCode: 'VT-2', quantity: 1 }],
    };
    const [first, second] = await Promise.all([documents.create(clerk, request), documents.create(clerk, request)]);
    expect(second.id).toBe(first.id);
    const page = await documents.list(clerk, { docType: 'ISSUE_SALES', status: 'DRAFT', warehouseCode: 'KHO-A' });
    expect(page.items.filter((item) => item.idempotencyKey === request.idempotencyKey)).toHaveLength(1);
  });

  it('danh sách lọc nhiều loại, nguồn và khoảng ngày chứng từ (màn thủ kho)', async () => {
    const sourceType = `qa_source_${randomUUID().slice(0, 8)}`;
    const make = (docType: 'ISSUE_SALES' | 'ISSUE_WARRANTY' | 'ISSUE_OTHER', documentDate: string) =>
      documents.create(clerk, {
        docType,
        warehouseCode: 'KHO-B',
        sourceType,
        sourceId: randomUUID(),
        documentDate,
        lines: [{ materialCode: 'VT-2', quantity: 1 }],
      });
    const sales = await make('ISSUE_SALES', '2026-03-10');
    const warranty = await make('ISSUE_WARRANTY', '2026-03-20');
    await make('ISSUE_OTHER', '2026-03-15');
    await make('ISSUE_SALES', '2026-04-02');

    const page = await documents.list(clerk, {
      docTypes: ['ISSUE_SALES', 'ISSUE_WARRANTY'],
      status: 'DRAFT',
      sourceType,
      fromDate: '2026-03-01',
      toDate: '2026-03-31',
    });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id).sort()).toEqual([sales.id, warranty.id].sort());
  });
});
