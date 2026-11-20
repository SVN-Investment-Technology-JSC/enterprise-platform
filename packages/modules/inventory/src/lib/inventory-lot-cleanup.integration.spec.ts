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
import { INVENTORY_TEST_ADMIN_URL, TestInventoryDatabase, purchaseSource } from './inventory-test-support.js';

const integration = INVENTORY_TEST_ADMIN_URL ? describe : describe.skip;
const run = promisify(execFile);

function script(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) candidate = dirname(candidate);
  return resolve(candidate, 'tools/inventory/cleanup-orphan-lots.mjs');
}

interface Report {
  applied: boolean;
  orphanLots: { action: string; lot_no: string; documents: string }[];
  clearedLines: number;
  possiblyFilledLots: { lot_no: string; expires_on: string }[];
}

/**
 * ISS-BE-066: bản cũ tạo lô lúc lưu nháp. Script liệt kê lô rác (chỉ dòng nhập của chứng từ huỷ, từ chối trỏ tới,
 * hoặc không dòng nào), `--apply` bỏ lot_id ở dòng rồi xoá lô; lô có tồn, có lịch sử hay có nháp còn dở không bị đụng.
 */
integration('Dọn lô rác do lưu nháp tạo (ISS-BE-066)', () => {
  const tenantId = randomUUID();
  const actor = (rights: Partial<InventoryActor>): InventoryActor => ({
    tenantId,
    userId: randomUUID(),
    displayName: 'Kho',
    canManage: false,
    canWriteTransactions: true,
    canApproveDocuments: false,
    ...rights,
  });
  const admin = actor({ canManage: true, canApproveDocuments: true });
  const clerk = actor({});
  let database: TestInventoryDatabase;
  let pool: Pool;
  let documents: StockDocumentService;

  /** Giả lập bản cũ: lô tạo ngay lúc lưu nháp và dòng nháp trỏ tới nó. */
  async function legacyDraft(lotNo: string): Promise<string> {
    const draft = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'CL-KHO',
      lines: [{ materialCode: 'CL-VT', quantity: 1, lot: { lotNo, expiresOn: '2029-12-31' } }],
    });
    await pool.query(
      `WITH lot AS (
         INSERT INTO inventory_schema.lots (material_id, lot_no, expires_on, created_by)
         SELECT material_id, $2, '2029-12-31', $3 FROM inventory_schema.stock_document_lines WHERE document_id = $1
         RETURNING id)
       UPDATE inventory_schema.stock_document_lines SET lot_id = (SELECT id FROM lot), lot_draft = NULL
        WHERE document_id = $1`,
      [draft.id, lotNo, clerk.userId],
    );
    return draft.id;
  }

  async function lotNos(): Promise<string[]> {
    const { rows } = await pool.query(`SELECT lot_no FROM inventory_schema.lots ORDER BY lot_no`);
    return rows.map((row) => (row as { lot_no: string }).lot_no);
  }

  beforeAll(async () => {
    database = await TestInventoryDatabase.create(INVENTORY_TEST_ADMIN_URL as string);
    pool = database.pool;
    const store = new PostgresInventoryStore(database.references, database.pools);
    const documentStore = new PostgresStockDocumentStore(database.references, database.pools);
    const app = new InventoryApplication(store, documentStore);
    documents = new StockDocumentService(documentStore, store);
    await app.createWarehouse(admin, { code: 'CL-KHO', name: 'Kho dọn lô' });
    await app.createMaterial(admin, { code: 'CL-VT', name: 'Vật tư', category: 'CONSUMABLE', unit: 'Cái' });
    // Lô thật có tồn, không hạn dùng; một nháp cũ đã điền hạn dùng vào nó.
    await app.receiveStock(clerk, { ...purchaseSource(), warehouseCode: 'CL-KHO', materialCode: 'CL-VT', quantity: 5, lot: { lotNo: 'LO-THAT' } });
    const filledDraft = await documents.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'CL-KHO',
      lines: [{ materialCode: 'CL-VT', quantity: 1, lot: { lotNo: 'LO-THAT' } }],
    });
    await pool.query(
      `UPDATE inventory_schema.lots SET expires_on = '2030-01-31', updated_at = now() + interval '1 second'
        WHERE lot_no = 'LO-THAT'`,
    );
    expect(filledDraft.lines[0].lotId).toBeDefined();

    const cancelled = await legacyDraft('LO-HUY');
    await documents.cancel(clerk, cancelled);
    const rejected = await legacyDraft('LO-TU-CHOI');
    await documents.submit(clerk, rejected);
    await documents.reject(admin, rejected, { reason: 'Sai' });
    await legacyDraft('LO-NHAP-DO');
    // Sửa nháp đổi lô: lô cũ không còn dòng nào.
    await pool.query(
      `INSERT INTO inventory_schema.lots (material_id, lot_no, created_by)
       SELECT id, 'LO-MO-COI', $1 FROM inventory_schema.materials WHERE code = 'CL-VT'`,
      [clerk.userId],
    );
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it('liệt kê không ghi; --apply xoá lô rác, giữ số lô trên dòng; chạy lại rỗng', async () => {
    const preview = await run(process.execPath, [script(), `--database-url=${database.url}`, '--json']);
    const report = JSON.parse(preview.stdout) as Report;
    expect(report.applied).toBe(false);
    expect(report.orphanLots.map((row) => [row.action, row.lot_no])).toEqual([
      ['SE_XOA', 'LO-HUY'],
      ['SE_XOA', 'LO-MO-COI'],
      ['SE_XOA', 'LO-TU-CHOI'],
    ]);
    expect(report.possiblyFilledLots).toEqual([expect.objectContaining({ lot_no: 'LO-THAT', expires_on: '2030-01-31' })]);
    expect(preview.stderr).toContain('liệt kê, chưa ghi');
    expect(await lotNos()).toEqual(['LO-HUY', 'LO-MO-COI', 'LO-NHAP-DO', 'LO-THAT', 'LO-TU-CHOI']);

    const applied = await run(process.execPath, [script(), `--database-url=${database.url}`, '--apply', '--json']);
    expect((JSON.parse(applied.stdout) as Report).clearedLines).toBe(2);
    expect(await lotNos()).toEqual(['LO-NHAP-DO', 'LO-THAT']);
    const { rows } = await pool.query(
      `SELECT l.lot_id, l.lot_draft->>'lotNo' AS lot_no, l.lot_draft->>'expiresOn' AS expires_on
         FROM inventory_schema.stock_document_lines l
         JOIN inventory_schema.stock_documents d ON d.id = l.document_id
        WHERE d.status IN ('CANCELLED', 'REJECTED') ORDER BY 2`,
    );
    expect(rows).toEqual([
      { lot_id: null, lot_no: 'LO-HUY', expires_on: '2029-12-31' },
      { lot_id: null, lot_no: 'LO-TU-CHOI', expires_on: '2029-12-31' },
    ]);

    const again = JSON.parse((await run(process.execPath, [script(), `--database-url=${database.url}`, '--json'])).stdout) as Report;
    expect(again.orphanLots).toEqual([]);
  }, 60_000);
});
