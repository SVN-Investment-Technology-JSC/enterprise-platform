import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { CustomerTimelineService } from './application/activity.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import type { CatalogReader } from './application/pricing-store.port.js';
import { vietnamToday } from './application/pricing.service.js';
import { WarrantyResolutionService } from './application/warranty-resolution.service.js';
import { WarrantyService } from './application/warranty.service.js';
import { ReceivableAdjustmentService } from './application/receivable-adjustment.service.js';
import { ReceivableWarrantyCredit } from './application/warranty-credit.js';
import {
  type QualityChange,
  type ReturnReceiptRequest,
  type WarrantyInventory,
  type WarrantyIssueRequest,
  type WarrantyStockDocument,
  type WarrantyStockDocumentRequest,
} from './application/warranty.port.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { CrmError } from './domain/crm.error.js';
import { PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresReceivableStore } from './infrastructure/postgres-receivable.store.js';
import { PostgresWarrantyStore } from './infrastructure/postgres-warranty.store.js';
import { applyWarrantyIssued, applyWarrantyReturned } from './infrastructure/warranty-events.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const MAY = randomUUID();
const NV = randomUUID();
const KTV = randomUUID();

/** Danh mục giả: máy cắt bảo hành 12 tháng. */
const catalog: CatalogReader = {
  materials: async (_tenantId, ids) =>
    new Map(
      ids.includes(MAY)
        ? [[MAY, { id: MAY, code: 'QA-KHO-MAY', name: 'Máy cắt', unit: 'Cái', category: null, kind: 'STOCK', warrantyMonths: 12 }]]
        : [],
    ),
  search: async () => [],
};

/**
 * Kho giả theo hợp đồng API nội bộ: chống lặp theo khoá (cùng khoá trả cùng
 * chứng từ), nhập trả ghi sổ ngay, điều chuyển ghi sổ ngay, xuất khác chờ
 * duyệt, xuất bảo hành nháp. Ghi lại chất lượng cuối của từng serial.
 */
class FakeWarrantyInventory implements WarrantyInventory {
  readonly documents = new Map<string, WarrantyStockDocument & { request: unknown }>();
  readonly quality = new Map<string, string>();
  private sequence = 0;

  private create(key: string, request: unknown, status: string, prefix: string): WarrantyStockDocument {
    const existing = this.documents.get(key);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) throw new CrmError('IDEMPOTENCY_KEY_CONFLICT', 'Khoá đã dùng.', 409);
      return { documentId: existing.documentId, documentCode: existing.documentCode, status: existing.status };
    }
    this.sequence += 1;
    const created = { documentId: randomUUID(), documentCode: `${prefix}-${this.sequence}`, status, request };
    this.documents.set(key, created);
    return { documentId: created.documentId, documentCode: created.documentCode, status };
  }
  async serial() {
    return null;
  }
  async receiveReturn(_tenantId: string, request: ReturnReceiptRequest) {
    return this.create(request.idempotencyKey, request, 'POSTED', 'NK');
  }
  async changeSerialQuality(_tenantId: string, serial: string, change: QualityChange) {
    this.quality.set(serial, change.qualityStatus);
  }
  async changeLotQuality(_tenantId: string, lotId: string, change: QualityChange) {
    this.quality.set(lotId, change.qualityStatus);
  }
  async createStockDocument(_tenantId: string, request: WarrantyStockDocumentRequest) {
    return this.create(request.idempotencyKey, request, request.docType === 'TRANSFER' ? 'POSTED' : 'PENDING', request.docType === 'TRANSFER' ? 'DC' : 'XK');
  }
  async createWarrantyIssue(_tenantId: string, request: WarrantyIssueRequest) {
    return this.create(request.idempotencyKey, request, 'DRAFT', 'XBH');
  }
}

integration('Bán hàng GĐ6: bảo hành, đổi trả (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    ...extra,
  });
  const nv = actor(NV, { canWriteOpportunity: true, canWriteOrder: true });
  const ktv = actor(KTV, { canReadAll: true, canWriteWarranty: true });
  const today = vietnamToday(new Date());
  /** Thời điểm giữa trưa (giờ Việt Nam) của ngày cách hôm nay `months` tháng. */
  const monthsAgo = (months: number) => {
    const value = new Date(`${today}T05:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() - months);
    return value.toISOString();
  };

  const inventory = new FakeWarrantyInventory();
  let store: PostgresWarrantyStore;
  let warranty: WarrantyService;
  let resolution: WarrantyResolutionService;
  let timeline: CustomerTimelineService;
  let adjustments: ReceivableAdjustmentService;
  let customerId: string;
  let sequence = 0;

  /** Đơn (từ hợp đồng nếu có `contractMonths`) đã giao các serial vào `deliveredAt`. */
  async function delivered(serials: string[], deliveredAt: string, contractMonths?: number) {
    sequence += 1;
    const pool = handle.pool;
    let contractId: string | null = null;
    if (contractMonths !== undefined) {
      contractId = (
        await pool.query<{ id: string }>(
          `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, warranty_months, status, owner_user_id)
           VALUES ($1, 'SALE', $2, 'Hợp đồng bảo hành', '2025-01-01', $3, 'ACTIVE', $4) RETURNING id`,
          [`HD-BH-${sequence}`, customerId, contractMonths, NV],
        )
      ).rows[0].id;
    }
    const orderId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.sales_orders (code, source, customer_id, contract_id, status, owner_user_id, order_date, warehouse_code)
         VALUES ($1, $2, $3, $4, 'DELIVERED', $5, '2025-01-01', 'QA-KHO') RETURNING id`,
        [`DH-BH-${sequence}`, contractId ? 'CONTRACT' : 'DIRECT', customerId, contractId, NV],
      )
    ).rows[0].id;
    const lineId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.sales_order_lines
           (order_id, line_no, material_id, material_code, material_name, unit, quantity, list_price, price_source, unit_price,
            gross_amount, discount_amount, vat_rate, line_amount, vat_amount, line_total, delivered_quantity, serials)
         VALUES ($1, 1, $2, 'QA-KHO-MAY', 'Máy cắt', 'Cái', $3, 10000000, 'MANUAL', 10000000, $4, 0, 10, $4, $5, $6, $3, $7::text[])
         RETURNING id`,
        [orderId, MAY, serials.length, serials.length * 10_000_000, serials.length * 1_000_000, serials.length * 11_000_000, serials],
      )
    ).rows[0].id;
    const deliveryId = (
      await pool.query<{ id: string }>(
        `INSERT INTO crm_schema.delivery_plans (order_id, code, seq, planned_date, warehouse_code, status, issued_at)
         VALUES ($1, $2, 1, '2025-01-01', 'QA-KHO', 'ISSUED', $3) RETURNING id`,
        [orderId, `DH-BH-${sequence}-01`, deliveredAt],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO crm_schema.delivery_lines (delivery_id, order_line_id, planned_quantity, delivered_quantity, serials)
       VALUES ($1, $2, $3, $3, $4::text[])`,
      [deliveryId, lineId, serials.length, serials],
    );
    return { orderId, lineId };
  }

  /** Kho phát `inventory.stock.returned` cho chứng từ nhập trả của yêu cầu. */
  async function stockReturned(caseId: string, serials: string[]) {
    const receipt = inventory.documents.get(`crm-warranty:${caseId}:receive`);
    if (!receipt) throw new Error('no receipt');
    return applyWarrantyReturned(handle.database, tenantId, {
      documentId: receipt.documentId,
      documentCode: receipt.documentCode,
      docType: 'RECEIPT_SALES_RETURN',
      sourceType: 'crm_warranty',
      sourceId: caseId,
      reversesDocumentId: null,
      postedAt: new Date().toISOString(),
      qualityStatus: 'PENDING_INSPECTION',
      lines: [{ materialId: MAY, materialCode: 'QA-KHO-MAY', quantity: serials.length, direction: 'IN', serials }],
    });
  }

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    store = new PostgresWarrantyStore(handle.database);
    warranty = new WarrantyService(store, inventory, catalog, scopes);
    adjustments = new ReceivableAdjustmentService(new PostgresReceivableStore(handle.database), scopes);
    resolution = new WarrantyResolutionService(store, inventory, new ReceivableWarrantyCredit(adjustments), scopes);
    timeline = new CustomerTimelineService(new PostgresTimelineStore(handle.database), customerStore, scopes);
    customerId = (await new CustomerService(customerStore, scopes).create(nv, { name: 'Công ty Bảo Hành', ownerUserId: NV })).id;
    await delivered(['SN031'], monthsAgo(3));
    await delivered(['SN032'], monthsAgo(11));
    await delivered(['SN033'], monthsAgo(13));
    await delivered(['SN034'], monthsAgo(8), 24);
    await delivered(['SN035'], monthsAgo(8), 6);
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  it('TC-WAR-01: tra theo serial, theo đơn, theo khách cho cùng kết quả', async () => {
    const [bySerial] = await warranty.lookup(ktv, { serial: 'SN031' });
    expect(bySerial).toMatchObject({ serial: 'SN031', customerId, orderCode: 'DH-BH-1' });
    expect(bySerial.coverage).toMatchObject({ source: 'MATERIAL', months: 12, expired: false });
    // Còn khoảng 9 tháng.
    expect(bySerial.coverage.remainingDays).toBeGreaterThan(260);
    expect(bySerial.coverage.remainingDays).toBeLessThan(280);
    const byOrder = (await warranty.lookup(ktv, { orderId: bySerial.orderId as string })).find((item) => item.serial === 'SN031');
    const byCustomer = (await warranty.lookup(ktv, { customerId })).find((item) => item.serial === 'SN031');
    expect(byOrder).toEqual(bySerial);
    expect(byCustomer).toEqual(bySerial);
    // Nhân viên khác ngoài phạm vi: 404.
    await expect(warranty.lookup(actor(randomUUID()), { serial: 'SN031' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-WAR-02, TC-WAR-03: hạn hợp đồng ưu tiên hạn mặt hàng, kể cả khi ngắn hơn', async () => {
    const [sn034] = await warranty.lookup(ktv, { serial: 'SN034' });
    expect(sn034.coverage).toMatchObject({ source: 'CONTRACT', months: 24, expired: false });
    expect(sn034.coverage.remainingDays).toBeGreaterThan(470);
    const [sn035] = await warranty.lookup(ktv, { serial: 'SN035' });
    expect(sn035.coverage).toMatchObject({ source: 'CONTRACT', months: 6, expired: true, remainingDays: 0 });
  });

  it('TC-WAR-05, TC-WAR-06: nguyên nhân bắt buộc; serial hết hạn vẫn tiếp nhận, loại có phí; từ chối rồi đóng', async () => {
    await expect(warranty.create(ktv, { lines: [{ serial: 'SN033' }] })).rejects.toMatchObject({ statusCode: 400, code: 'CAUSE_REQUIRED' });
    const created = await warranty.create(ktv, { cause: 'WRONG_ITEM', lines: [{ serial: 'SN033' }] });
    expect(created).toMatchObject({ status: 'RECEIVED', chargeable: true, cause: 'WRONG_ITEM', ownerUserId: NV, assigneeUserId: KTV });
    expect(created.lines[0].coverage).toMatchObject({ expired: true });
    // Đang mở thì không tiếp nhận serial này lần nữa.
    await expect(warranty.create(ktv, { cause: 'WRONG_ITEM', lines: [{ serial: 'sn033' }] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SERIAL_HAS_OPEN_CASE',
    });
    await expect(warranty.reject(ktv, created.id, { revision: created.revision })).rejects.toMatchObject({ statusCode: 400 });
    const rejected = await warranty.reject(ktv, created.id, { revision: created.revision, reason: 'Hết hạn, khách không đồng ý phí' });
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'Hết hạn, khách không đồng ý phí' });
    const closed = await warranty.close(ktv, created.id, { revision: rejected.revision });
    expect(closed.status).toBe('CLOSED');
    // Nhân viên kinh doanh phụ trách đơn thấy yêu cầu; người khác không thấy.
    expect((await warranty.get(nv, created.id)).id).toBe(created.id);
    await expect(warranty.get(actor(randomUUID()), created.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-WAR-07, TC-INT-17, TC-WAR-09, TC-WAR-10: nhận hàng, kiểm định Lỗi, chuyển kho lỗi, đổi serial kế thừa hạn, đóng', async () => {
    const [original] = await warranty.lookup(ktv, { serial: 'SN032' });
    const created = await warranty.create(ktv, { cause: 'TECHNICAL_FAULT', description: 'Không lên nguồn', lines: [{ serial: 'SN032' }] });
    expect(created.lines[0].coverage.warrantyUntil).toBe(original.coverage.warrantyUntil);

    // Nhận hàng: Chờ nhận hàng, chứng từ nhập trả vào kho cách ly; bấm lại không tạo chứng từ thứ hai.
    let detail = await warranty.receiveGoods(ktv, created.id, { revision: created.revision });
    expect(detail).toMatchObject({ status: 'AWAITING_GOODS', quarantineWarehouseCode: 'QA-KHO-CL' });
    detail = await warranty.receiveGoods(ktv, created.id, { revision: detail.revision });
    expect([...inventory.documents.keys()].filter((key) => key.startsWith(`crm-warranty:${created.id}`))).toEqual([
      `crm-warranty:${created.id}:receive`,
    ]);
    expect(detail.documents).toEqual([expect.objectContaining({ kind: 'RETURN_RECEIPT', status: 'POSTED' })]);
    await expect(warranty.inspect(ktv, created.id, detail.lines[0].id, { revision: detail.revision, result: 'DEFECTIVE' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'NOT_INSPECTING',
    });

    // Kho phát nhập trả: Đang kiểm định; nhận trùng thì bỏ qua.
    expect(await stockReturned(created.id, ['SN032'])).toBe('applied');
    expect(await stockReturned(created.id, ['SN032'])).toBe('ignored');
    detail = await warranty.get(ktv, created.id);
    expect(detail.status).toBe('INSPECTING');
    expect(detail.lines[0].receivedAt).not.toBeNull();

    detail = await warranty.inspect(ktv, created.id, detail.lines[0].id, { revision: detail.revision, result: 'DEFECTIVE', note: 'Hỏng nguồn' });
    expect(detail.status).toBe('RESOLVING');

    detail = await resolution.resolve(ktv, created.id, detail.lines[0].id, {
      revision: detail.revision,
      disposition: 'MOVE_TO_DEFECT',
      remedy: 'REPLACE',
    });
    expect(detail.status).toBe('RESOLVED');
    expect(inventory.quality.get('SN032')).toBe('DEFECTIVE');
    const transfer = inventory.documents.get(`crm-warranty:${created.id}:${detail.lines[0].id}:transfer`);
    expect(transfer?.request).toMatchObject({ docType: 'TRANSFER', warehouseCode: 'QA-KHO-CL', targetWarehouseCode: 'QA-KHO-LOI' });
    const replacement = inventory.documents.get(`crm-warranty:${created.id}:${detail.lines[0].id}:replacement`);
    expect(replacement?.request).toMatchObject({ warehouseCode: 'QA-KHO', sourceType: 'crm_warranty', sourceId: created.id });
    expect(detail.documents.map((document) => [document.kind, document.status])).toEqual([
      ['RETURN_RECEIPT', 'POSTED'],
      ['QUALITY', 'POSTED'],
      ['TRANSFER', 'POSTED'],
      ['REPLACEMENT', 'REQUESTED'],
    ]);
    // Bấm lại hướng xử lý: không sinh chứng từ thứ hai.
    await expect(
      resolution.resolve(ktv, created.id, detail.lines[0].id, { revision: detail.revision, disposition: 'SCRAP', remedy: 'NONE' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Xuất thay thế chưa ghi sổ: chưa đóng được.
    await expect(warranty.close(ktv, created.id, { revision: detail.revision })).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENTS_NOT_POSTED' });

    // Thủ kho xuất SN-DP01 và ghi sổ: serial mới kế thừa đúng ngày hết hạn của SN032 (Q9).
    expect(
      await applyWarrantyIssued(handle.database, tenantId, {
        documentId: replacement?.documentId,
        documentCode: replacement?.documentCode,
        docType: 'ISSUE_WARRANTY',
        sourceType: 'crm_warranty',
        sourceId: created.id,
        postedAt: new Date().toISOString(),
        lines: [{ materialId: MAY, materialCode: 'QA-KHO-MAY', quantity: 1, direction: 'OUT', serials: ['SN-DP01'] }],
      }),
    ).toBe('applied');
    detail = await warranty.get(ktv, created.id);
    expect(detail.lines[0]).toMatchObject({ replacementSerials: ['SN-DP01'], replacementWarrantyUntil: original.coverage.warrantyUntil });
    const [dp01] = await warranty.lookup(ktv, { serial: 'SN-DP01' });
    expect(dp01).toMatchObject({ customerId, replacementOf: { caseId: created.id, caseCode: created.code, serial: 'SN032' } });
    expect(dp01.coverage).toMatchObject({ source: 'INHERITED', warrantyUntil: original.coverage.warrantyUntil });
    expect(dp01.coverage.remainingDays).toBe(original.coverage.remainingDays);

    detail = await warranty.close(ktv, created.id, { revision: detail.revision });
    expect(detail.status).toBe('CLOSED');
    expect(detail.history.map((entry) => entry.action).reverse()).toEqual([
      'create',
      'request-goods',
      'goods-received',
      'inspect',
      'resolve-line',
      'resolve',
      'replacement-issued',
      'close',
    ]);
    expect(detail.history.every((entry) => entry.at)).toBe(true);

    // Lịch sử serial: SN032 là serial gốc, SN-DP01 là serial thay thế.
    expect((await store.serialCases(tenantId, { kind: 'all' }, 'SN-DP01')).map((item) => item.role)).toEqual(['REPLACEMENT']);
    expect((await store.serialCases(tenantId, { kind: 'all' }, 'SN032')).map((item) => item.role)).toEqual(['ORIGINAL']);

    // T6-09: dòng thời gian khách có các bước bảo hành.
    const page = await timeline.list(nv, customerId, {});
    const entries = page.items.filter((entry) => entry.kind === 'warranty' && entry.caseId === created.id);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(entries[0]).toMatchObject({ caseCode: created.code, action: 'close', toStatus: 'CLOSED' });
  });

  it('TC-WAR-12: còn dòng chưa có kết quả thì không đóng; xử lý xong thì đóng được', async () => {
    const extra = await delivered(['SN041', 'SN042'], monthsAgo(2));
    // Khách còn nợ đơn chứa SN042 (ghi nợ khi giao).
    await handle.pool.query(
      `INSERT INTO crm_schema.receivable_entries (kind, customer_id, order_id, amount, entry_date, due_date, source_type, source_id)
       VALUES ('DEBIT', $1, $2, 22000000, CURRENT_DATE, CURRENT_DATE + 30, 'stock_issue', $3)`,
      [customerId, extra.orderId, randomUUID()],
    );
    const created = await warranty.create(ktv, { cause: 'CHANGE_OF_MIND', lines: [{ serial: 'SN041' }, { serial: 'SN042' }] });
    let detail = await warranty.receiveGoods(ktv, created.id, { revision: created.revision });
    await stockReturned(created.id, ['SN041', 'SN042']);
    detail = await warranty.get(ktv, created.id);
    detail = await warranty.inspect(ktv, created.id, detail.lines[0].id, { revision: detail.revision, result: 'PASSED' });
    expect(detail.status).toBe('INSPECTING');
    await expect(warranty.close(ktv, created.id, { revision: detail.revision })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LINES_UNRESOLVED',
      message: 'Còn dòng chưa xử lý.',
    });
    detail = await warranty.inspect(ktv, created.id, detail.lines[1].id, { revision: detail.revision, result: 'PASSED' });
    expect(detail.status).toBe('RESOLVING');
    detail = await resolution.resolve(ktv, created.id, detail.lines[0].id, { revision: detail.revision, disposition: 'RESTOCK' });
    expect(detail.status).toBe('RESOLVING');
    await expect(warranty.close(ktv, created.id, { revision: detail.revision })).rejects.toMatchObject({ code: 'LINES_UNRESOLVED' });
    detail = await resolution.resolve(ktv, created.id, detail.lines[1].id, { revision: detail.revision, disposition: 'RESTOCK', remedy: 'CREDIT' });
    // Giảm trừ công nợ chờ sổ công nợ: đã xử lý nhưng chưa đóng được.
    expect(detail.status).toBe('RESOLVED');
    const credit = detail.documents.find((document) => document.kind === 'CREDIT');
    expect(credit).toMatchObject({ status: 'PENDING_RECEIVABLE', amount: 11_000_000 });
    expect(inventory.quality.get('SN041')).toBe('PASSED');
    await expect(warranty.close(ktv, created.id, { revision: detail.revision })).rejects.toMatchObject({ code: 'DOCUMENTS_NOT_POSTED' });
    // TC-WAR-11: sổ công nợ có điều chỉnh giảm trừ Chờ duyệt đúng giá trị dòng; quản lý duyệt rồi gửi lại thì Đã ghi sổ.
    const manager = actor(randomUUID(), { canReadAll: true, canManage: true, canWriteReceivable: true });
    const adjustment = await adjustments.get(manager, credit?.documentId as string);
    expect(adjustment).toMatchObject({ status: 'DRAFT', direction: 'DECREASE', amount: 11_000_000, sourceType: 'crm_warranty', customerId });
    await adjustments.approve(manager, adjustment.id, { revision: adjustment.revision });
    detail = await resolution.syncDocuments(ktv, created.id, { revision: detail.revision });
    expect(detail.documents.find((document) => document.kind === 'CREDIT')).toMatchObject({ status: 'POSTED', documentCode: adjustment.code });
    expect((await warranty.close(ktv, created.id, { revision: detail.revision })).status).toBe('CLOSED');
  });

  it('chỉ người có quyền bảo hành mới ghi; cập nhật song song bị chặn bằng revision', async () => {
    await expect(warranty.create(nv, { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }] })).rejects.toMatchObject({ statusCode: 403 });
    const created = await warranty.create(ktv, { cause: 'SHORTAGE', lines: [{ serial: 'SN031' }] });
    await warranty.receiveGoods(ktv, created.id, { revision: created.revision });
    await expect(warranty.reject(ktv, created.id, { revision: created.revision, reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    const page = await warranty.list(ktv, { serial: 'sn031' });
    expect(page.items.map((item) => item.id)).toContain(created.id);
  });
});
