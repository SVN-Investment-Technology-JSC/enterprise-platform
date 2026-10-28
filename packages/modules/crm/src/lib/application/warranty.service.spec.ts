import { CRM_NO_CAPABILITIES, type WarrantyCaseDetail, type WarrantyDocument } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import type { CatalogReader } from './pricing-store.port.js';
import { ReceivableWarrantyCredit } from './warranty-credit.js';
import { WarrantyResolutionService } from './warranty-resolution.service.js';
import { WarrantyService } from './warranty.service.js';
import {
  PendingReceivableCredit,
  type DeliveredItemRecord,
  type NewWarrantyCaseRecord,
  type WarrantyCreditPort,
  type WarrantyDocumentRecord,
  type WarrantyInventory,
  type WarrantyStore,
} from './warranty.port.js';

const TENANT = 'tenant';
const MAY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const ORDER_LINE = '44444444-4444-4444-8444-444444444444';
const KTV = '55555555-5555-4555-8555-555555555555';
const CASE_ID = '66666666-6666-4666-8666-666666666666';

const delivered = (serial: string, deliveredAt: string, extra: Partial<DeliveredItemRecord> = {}): DeliveredItemRecord => ({
  serial,
  materialId: MAY,
  materialCode: 'QA-KHO-MAY',
  materialName: 'Máy cắt',
  unit: 'Cái',
  quantity: 1,
  customerId: CUSTOMER,
  customerCode: 'KH000001',
  customerName: 'Công ty Bảo Hành',
  ownerUserId: 'owner',
  orderId: ORDER,
  orderCode: 'DH2600001',
  orderLineId: ORDER_LINE,
  orderLineQuantity: 3,
  orderLineTotal: 33_000_000,
  contractId: null,
  contractCode: null,
  contractWarrantyMonths: null,
  deliveryCode: 'DH2600001-01',
  warehouseCode: 'QA-KHO',
  deliveredAt,
  replacementOf: null,
  ...extra,
});

/** Store giả trong bộ nhớ: một yêu cầu, chứng từ theo khoá chống lặp. */
class FakeWarrantyStore implements WarrantyStore {
  readonly items = new Map<string, DeliveredItemRecord>();
  created?: NewWarrantyCaseRecord;
  detail?: WarrantyCaseDetail;
  readonly documents = new Map<string, WarrantyDocumentRecord>();
  open = new Map<string, string>();
  completed = 0;

  async serialDeliveries(_tenantId: string, _scope: unknown, serial: string) {
    const item = this.items.get(serial.toUpperCase());
    return item ? [item] : [];
  }
  async deliveredItems() {
    return [...this.items.values()];
  }
  async deliveryItem() {
    return undefined;
  }
  async orderLineValue() {
    return { quantity: 3, lineTotal: 33_000_000 };
  }
  async orderLineDelivery() {
    return undefined;
  }
  async openCasesBySerial(_tenantId: string, serials: readonly string[]) {
    return new Map([...this.open].filter(([serial]) => serials.map((value) => value.toUpperCase()).includes(serial)));
  }
  async listCases() {
    return { items: [], nextCursor: null };
  }
  async getCase() {
    if (!this.detail) return undefined;
    const documents: WarrantyDocument[] = [...this.documents.values()].map((record, index) => ({
      id: `d${index}`,
      lineId: record.lineId,
      kind: record.kind,
      status: record.status,
      documentId: record.documentId ?? null,
      documentCode: record.documentCode ?? null,
      amount: record.amount ?? null,
      lastError: record.lastError ?? null,
      createdAt: '',
      postedAt: null,
    }));
    return { ...this.detail, documents };
  }
  async createCase(_tenantId: string, record: NewWarrantyCaseRecord) {
    this.created = record;
    this.detail = {
      id: CASE_ID,
      code: 'BH2600001',
      customerId: record.customerId,
      customerCode: 'KH000001',
      customerName: 'Công ty Bảo Hành',
      orderId: record.orderId,
      orderCode: 'DH2600001',
      cause: record.cause,
      status: 'RECEIVED',
      chargeable: record.lines.some((line) => line.coverage.expired),
      lineCount: record.lines.length,
      serials: record.lines.flatMap((line) => (line.serial ? [line.serial] : [])),
      ownerUserId: record.ownerUserId,
      assigneeUserId: record.assigneeUserId,
      createdAt: '',
      updatedAt: '',
      description: record.description,
      contractId: record.contractId,
      quarantineWarehouseCode: null,
      rejectReason: null,
      revision: 1,
      lines: record.lines.map((line, index) => ({
        id: `line-${index + 1}`,
        lineNo: index + 1,
        serial: line.serial,
        materialId: line.materialId,
        materialCode: line.materialCode,
        materialName: line.materialName,
        unit: line.unit,
        quantity: line.quantity,
        orderId: line.orderId,
        orderCode: 'DH2600001',
        orderLineId: line.orderLineId,
        coverage: line.coverage,
        chargeable: line.coverage.expired,
        receivedAt: null,
        receivedLotId: null,
        receivedLotNo: null,
        deliveryWarehouseCode: line.deliveryWarehouseCode,
        inspectionResult: null,
        inspectionNote: null,
        inspectedAt: null,
        inspectedBy: null,
        disposition: null,
        remedy: null,
        resolutionNote: null,
        resolvedAt: null,
        replacementWarehouseCode: null,
        replacementSerials: [],
        replacementWarrantyUntil: null,
        creditAmount: null,
      })),
      documents: [],
      history: [],
    };
    return CASE_ID;
  }
  async reject() {
    return undefined;
  }
  async requestGoods(_tenantId: string, _id: string, _revision: number, warehouseCode: string) {
    if (!this.detail) throw new Error('no case');
    this.detail = { ...this.detail, status: 'AWAITING_GOODS', quarantineWarehouseCode: warehouseCode };
    return warehouseCode;
  }
  async saveDocument(_tenantId: string, _caseId: string, record: WarrantyDocumentRecord) {
    const previous = this.documents.get(record.idempotencyKey);
    this.documents.set(record.idempotencyKey, previous?.status === 'POSTED' ? previous : record);
  }
  async inspectLine() {
    return undefined;
  }
  async saveResolution(_tenantId: string, _caseId: string, _revision: number, lineId: string, resolution: { disposition: string; remedy: string; replacementWarehouseCode: string | null; creditAmount: number | null }) {
    if (!this.detail) throw new Error('no case');
    this.detail = {
      ...this.detail,
      lines: this.detail.lines.map((line) =>
        line.id === lineId
          ? {
              ...line,
              disposition: resolution.disposition as never,
              remedy: resolution.remedy as never,
              replacementWarehouseCode: resolution.replacementWarehouseCode,
              creditAmount: resolution.creditAmount,
            }
          : line,
      ),
    };
  }
  async completeResolution() {
    this.completed += 1;
    return true;
  }
  async close() {
    return undefined;
  }
  async serialCases() {
    return [];
  }
  warehouses: { quarantineWarehouseCode: string | null; defectWarehouseCode: string | null; restockWarehouseCode: string | null } = {
    quarantineWarehouseCode: 'QA-KHO-CL',
    defectWarehouseCode: 'QA-KHO-LOI',
    restockWarehouseCode: 'QA-KHO-HN',
  };
  async settings() {
    return this.warehouses;
  }
  async saveSettings() {
    return undefined;
  }

  /** Đưa yêu cầu sang Đang xử lý với kết quả kiểm định cho mọi dòng. */
  inspected(result: 'PASSED' | 'DEFECTIVE') {
    if (!this.detail) throw new Error('no case');
    this.detail = {
      ...this.detail,
      status: 'RESOLVING',
      quarantineWarehouseCode: 'QA-KHO-CL',
      lines: this.detail.lines.map((line) => ({ ...line, inspectionResult: result })),
    };
  }
}

/** Kho giả: ghi lại lệnh; `fail` làm lệnh kế tiếp lỗi 503 một lần. */
class FakeInventory implements WarrantyInventory {
  readonly calls: { op: string; args: unknown }[] = [];
  fail?: string;

  private record(op: string, args: unknown) {
    if (this.fail === op) {
      this.fail = undefined;
      throw new CrmError('INVENTORY_UNAVAILABLE', 'Không kết nối được Kho. Vui lòng thử lại sau.', 503);
    }
    this.calls.push({ op, args });
  }
  async serial() {
    return null;
  }
  async receiveReturn(_tenantId: string, request: unknown) {
    this.record('receive', request);
    return { documentId: 'r1', documentCode: 'NK-1', status: 'POSTED' };
  }
  async changeSerialQuality(_tenantId: string, serial: string, change: unknown) {
    this.record('quality', { serial, change });
  }
  async changeLotQuality(_tenantId: string, lotId: string, change: unknown) {
    this.record('lot-quality', { lotId, change });
  }
  async createStockDocument(_tenantId: string, request: { docType: string }) {
    this.record(request.docType, request);
    return { documentId: `${request.docType}-1`, documentCode: request.docType, status: request.docType === 'TRANSFER' ? 'POSTED' : 'PENDING' };
  }
  async createWarrantyIssue(_tenantId: string, request: unknown) {
    this.record('replacement', request);
    return { documentId: 'x1', documentCode: 'PX-BH-1', status: 'DRAFT' };
  }
}

const catalog = (months: number | null): CatalogReader => ({
  materials: async () => new Map([[MAY, { id: MAY, code: 'QA-KHO-MAY', name: 'Máy cắt', unit: 'Cái', category: null, warrantyMonths: months }]]),
  search: async () => [],
});

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: KTV,
  displayName: 'Kỹ thuật',
  canReadAll: true,
  canWriteWarranty: true,
  ...extra,
});

const scopes = { resolve: async () => ({ kind: 'all' as const }) };
const now = () => new Date('2026-10-27T03:00:00Z');

async function rejection(promise: Promise<unknown>): Promise<CrmError> {
  try {
    await promise;
  } catch (error) {
    return error as CrmError;
  }
  throw new Error('expected rejection');
}

describe('WarrantyService (T6-02 đến T6-04)', () => {
  let store: FakeWarrantyStore;
  let inventory: FakeInventory;
  let service: WarrantyService;

  beforeEach(() => {
    store = new FakeWarrantyStore();
    inventory = new FakeInventory();
    service = new WarrantyService(store, inventory, catalog(12), scopes, now);
    store.items.set('SN031', delivered('SN031', '2026-07-27T03:00:00Z'));
    store.items.set('SN033', delivered('SN033', '2025-09-27T03:00:00Z'));
    store.items.set('SN034', delivered('SN034', '2026-02-27T03:00:00Z', { contractId: 'k', contractCode: 'HD1', contractWarrantyMonths: 24 }));
    store.items.set('SN035', delivered('SN035', '2026-02-27T03:00:00Z', { contractId: 'k2', contractCode: 'HD2', contractWarrantyMonths: 6 }));
  });

  it('TC-WAR-01, 02, 03: tra serial ra đơn, khách, hạn còn lại; hợp đồng ưu tiên mặt hàng', async () => {
    const [sn031] = await service.lookup(actor(), { serial: ' sn031 ' });
    expect(sn031).toMatchObject({ orderCode: 'DH2600001', customerCode: 'KH000001' });
    expect(sn031.coverage).toMatchObject({ source: 'MATERIAL', warrantyUntil: '2027-07-27', remainingDays: 273, expired: false });
    expect((await service.lookup(actor(), { serial: 'SN034' }))[0].coverage).toMatchObject({ source: 'CONTRACT', warrantyUntil: '2028-02-27' });
    expect((await service.lookup(actor(), { serial: 'SN035' }))[0].coverage).toMatchObject({ source: 'CONTRACT', expired: true });
    expect((await rejection(service.lookup(actor(), { serial: 'SN999' }))).statusCode).toBe(404);
    expect((await rejection(service.lookup(actor(), {}))).statusCode).toBe(400);
  });

  it('TC-WAR-06: thiếu nguyên nhân trả 400; có nguyên nhân thì lưu', async () => {
    const missing = await rejection(service.create(actor(), { lines: [{ serial: 'SN031' }] }));
    expect([missing.statusCode, missing.code]).toEqual([400, 'CAUSE_REQUIRED']);
    const created = await service.create(actor(), { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }] });
    expect(created).toMatchObject({ status: 'RECEIVED', cause: 'WRONG_ITEM', chargeable: false });
    expect(store.created).toMatchObject({ customerId: CUSTOMER, orderId: ORDER, ownerUserId: 'owner', assigneeUserId: KTV });
  });

  it('TC-WAR-05: serial hết hạn vẫn tiếp nhận được, đánh dấu có phí', async () => {
    const created = await service.create(actor(), { cause: 'TECHNICAL_FAULT', lines: [{ serial: 'SN033' }] });
    expect(created.chargeable).toBe(true);
    expect(created.lines[0]).toMatchObject({ chargeable: true, coverage: expect.objectContaining({ expired: true, warrantyUntil: '2026-09-27' }) });
  });

  it('kiểm dòng: quyền, serial trùng, serial đang có yêu cầu mở, khác khách', async () => {
    expect((await rejection(service.create(actor({ canWriteWarranty: false }), { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }] }))).statusCode).toBe(403);
    expect((await rejection(service.create(actor(), { cause: 'WRONG_ITEM', lines: [] }))).code).toBe('LINES_REQUIRED');
    expect((await rejection(service.create(actor(), { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }, { serial: 'sn031' }] }))).code).toBe('DUPLICATE_SERIAL');
    store.items.set('SN040', delivered('SN040', '2026-07-27T03:00:00Z', { customerId: 'other' }));
    expect((await rejection(service.create(actor(), { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }, { serial: 'SN040' }] }))).code).toBe('CUSTOMER_MISMATCH');
    store.open.set('SN031', 'other-case');
    const open = await rejection(service.create(actor(), { cause: 'WRONG_ITEM', lines: [{ serial: 'SN031' }] }));
    expect([open.statusCode, open.code]).toEqual([409, 'SERIAL_HAS_OPEN_CASE']);
  });

  it('TC-WAR-07: nhận hàng gọi nhập trả về kho cách ly với khoá chống lặp; Kho lỗi thì ghi "chưa gửi được" và bấm lại được', async () => {
    await service.create(actor(), { cause: 'TECHNICAL_FAULT', lines: [{ serial: 'SN031' }] });
    inventory.fail = 'receive';
    expect((await rejection(service.receiveGoods(actor(), CASE_ID, { revision: 1 }))).statusCode).toBe(503);
    expect(store.documents.get(`crm-warranty:${CASE_ID}:receive`)).toMatchObject({ status: 'PENDING', kind: 'RETURN_RECEIPT' });
    const detail = await service.receiveGoods(actor(), CASE_ID, { revision: 2 });
    expect(detail.status).toBe('AWAITING_GOODS');
    expect(inventory.calls).toEqual([
      {
        op: 'receive',
        args: expect.objectContaining({
          idempotencyKey: `crm-warranty:${CASE_ID}:receive`,
          warehouseCode: 'QA-KHO-CL',
          sourceType: 'crm_warranty',
          sourceId: CASE_ID,
          lines: [{ materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN031'] }],
        }),
      },
    ]);
    expect(store.documents.get(`crm-warranty:${CASE_ID}:receive`)).toMatchObject({ status: 'POSTED', documentCode: 'NK-1' });
  });

  it('chưa cấu hình kho cách ly hoặc kho lỗi thì không nhận hàng (409), không gọi Kho', async () => {
    await service.create(actor(), { cause: 'TECHNICAL_FAULT', lines: [{ serial: 'SN031' }] });
    store.warehouses = { quarantineWarehouseCode: null, defectWarehouseCode: 'QA-KHO-LOI', restockWarehouseCode: null };
    const missingQuarantine = await rejection(service.receiveGoods(actor(), CASE_ID, { revision: 1 }));
    expect([missingQuarantine.statusCode, missingQuarantine.code, missingQuarantine.message]).toEqual([
      409,
      'WARRANTY_WAREHOUSE_NOT_CONFIGURED',
      'Chưa cấu hình kho cách ly hoặc kho hàng lỗi cho bảo hành. Vào Cấu hình > Bảo hành để chọn kho.',
    ]);
    store.warehouses = { quarantineWarehouseCode: 'QA-KHO-CL', defectWarehouseCode: null, restockWarehouseCode: null };
    expect((await rejection(service.receiveGoods(actor(), CASE_ID, { revision: 1 }))).code).toBe('WARRANTY_WAREHOUSE_NOT_CONFIGURED');
    expect(inventory.calls).toEqual([]);
    expect(store.documents.size).toBe(0);
  });

  it('cấu hình kho cần quyền quản trị bán hàng, hai kho phải khác nhau', async () => {
    expect((await rejection(service.saveSettings(actor(), { quarantineWarehouseCode: 'A', defectWarehouseCode: 'B' }))).statusCode).toBe(403);
    const manager = actor({ canManage: true });
    expect((await rejection(service.saveSettings(manager, { quarantineWarehouseCode: 'A', defectWarehouseCode: 'a' }))).code).toBe('SAME_WAREHOUSE');
  });
});

describe('WarrantyResolutionService (T6-05, T6-06)', () => {
  let store: FakeWarrantyStore;
  let inventory: FakeInventory;
  let credit: WarrantyCreditPort;
  let resolution: WarrantyResolutionService;
  let warranty: WarrantyService;

  beforeEach(async () => {
    store = new FakeWarrantyStore();
    inventory = new FakeInventory();
    credit = new PendingReceivableCredit();
    warranty = new WarrantyService(store, inventory, catalog(12), scopes, now);
    resolution = new WarrantyResolutionService(store, inventory, { requestCredit: (request) => credit.requestCredit(request) }, scopes);
    store.items.set('SN032', delivered('SN032', '2025-11-20T03:00:00Z'));
    await warranty.create(actor(), { cause: 'TECHNICAL_FAULT', lines: [{ serial: 'SN032' }] });
  });

  it('TC-WAR-08: Đạt và nhập lại: đổi chất lượng về Đạt rồi điều chuyển từ kho cách ly về kho xuất ban đầu, có khoá chống lặp', async () => {
    store.inspected('PASSED');
    await resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK', remedy: 'NONE' });
    expect(inventory.calls).toEqual([
      { op: 'quality', args: { serial: 'SN032', change: expect.objectContaining({ qualityStatus: 'PASSED', actorUserId: KTV, materialCode: 'QA-KHO-MAY' }) } },
      {
        op: 'TRANSFER',
        args: expect.objectContaining({
          idempotencyKey: `crm-warranty:${CASE_ID}:line-1:transfer`,
          warehouseCode: 'QA-KHO-CL',
          targetWarehouseCode: 'QA-KHO',
          lines: [{ materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN032'] }],
        }),
      },
    ]);
    expect(store.completed).toBe(1);
    // Gửi lại chứng từ: điều chuyển đã có thì không tạo lần nữa.
    await resolution.syncDocuments(actor(), CASE_ID, { revision: 2 });
    expect(inventory.calls.filter((call) => call.op === 'TRANSFER')).toHaveLength(1);
  });

  it('TC-WAR-08: không biết kho xuất ban đầu thì nhập lại về kho cấu hình', async () => {
    store.inspected('PASSED');
    const line = store.detail?.lines[0] as { deliveryWarehouseCode: string | null };
    line.deliveryWarehouseCode = null;
    await resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK', remedy: 'NONE' });
    expect(inventory.calls[1].args).toMatchObject({ warehouseCode: 'QA-KHO-CL', targetWarehouseCode: 'QA-KHO-HN' });
  });

  it('chưa cấu hình kho lỗi (hoặc kho nhập lại khi không biết kho xuất) thì không chốt chuyển kho (409), không lưu hướng xử lý', async () => {
    store.inspected('DEFECTIVE');
    store.warehouses = { quarantineWarehouseCode: 'QA-KHO-CL', defectWarehouseCode: null, restockWarehouseCode: null };
    const moved = await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'MOVE_TO_DEFECT', remedy: 'NONE' }));
    expect([moved.statusCode, moved.code]).toEqual([409, 'WARRANTY_WAREHOUSE_NOT_CONFIGURED']);
    store.inspected('PASSED');
    const line = store.detail?.lines[0] as { deliveryWarehouseCode: string | null };
    line.deliveryWarehouseCode = null;
    const restocked = await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK', remedy: 'NONE' }));
    expect([restocked.statusCode, restocked.message]).toEqual([409, 'Chưa cấu hình kho nhập lại hàng Đạt cho bảo hành. Vào Cấu hình > Bảo hành để chọn kho.']);
    expect(inventory.calls).toEqual([]);
    expect(store.documents.size).toBe(0);
  });

  it('TC-WAR-09, TC-WAR-10: Lỗi, chuyển kho lỗi và đổi hàng: ba chứng từ theo thứ tự, khoá theo dòng', async () => {
    store.inspected('DEFECTIVE');
    await resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'MOVE_TO_DEFECT', remedy: 'REPLACE' });
    expect(inventory.calls.map((call) => call.op)).toEqual(['quality', 'TRANSFER', 'replacement']);
    expect(inventory.calls[1].args).toMatchObject({
      idempotencyKey: `crm-warranty:${CASE_ID}:line-1:transfer`,
      warehouseCode: 'QA-KHO-CL',
      targetWarehouseCode: 'QA-KHO-LOI',
      lines: [{ materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN032'] }],
    });
    // Kho xuất hàng thay thế mặc định là kho đã giao serial cũ.
    expect(inventory.calls[2].args).toMatchObject({ warehouseCode: 'QA-KHO', idempotencyKey: `crm-warranty:${CASE_ID}:line-1:replacement` });
    expect([...store.documents.values()].map((document) => [document.kind, document.status])).toEqual([
      ['QUALITY', 'POSTED'],
      ['TRANSFER', 'POSTED'],
      ['REPLACEMENT', 'REQUESTED'],
    ]);
  });

  it('chứng từ lỗi tạm ghi "chưa gửi được"; gửi lại không lặp chứng từ đã có', async () => {
    store.inspected('DEFECTIVE');
    inventory.fail = 'ISSUE_OTHER';
    expect((await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'SCRAP', remedy: 'NONE' }))).statusCode).toBe(503);
    expect(store.documents.get(`crm-warranty:${CASE_ID}:line-1:scrap`)).toMatchObject({ status: 'PENDING' });
    await resolution.syncDocuments(actor(), CASE_ID, { revision: 2 });
    expect(inventory.calls.map((call) => call.op)).toEqual(['quality', 'ISSUE_OTHER']);
    expect(store.documents.get(`crm-warranty:${CASE_ID}:line-1:scrap`)).toMatchObject({ status: 'PENDING_APPROVAL', documentId: 'ISSUE_OTHER-1' });
  });

  it('TC-WAR-11: giảm trừ công nợ đúng giá trị dòng; chưa nối sổ công nợ thì Chờ sổ công nợ', async () => {
    store.inspected('PASSED');
    const requests: unknown[] = [];
    credit = { requestCredit: async (request) => (requests.push(request), { status: 'PENDING_RECEIVABLE', documentId: null, documentCode: null }) };
    await resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK', remedy: 'CREDIT' });
    expect(requests).toEqual([
      expect.objectContaining({
        kind: 'CREDIT',
        customerId: CUSTOMER,
        orderId: ORDER,
        amount: 11_000_000,
        sourceType: 'crm_warranty',
        sourceId: 'line-1',
        idempotencyKey: `crm-warranty:${CASE_ID}:line-1:credit`,
      }),
    ]);
    expect(store.documents.get(`crm-warranty:${CASE_ID}:line-1:credit`)).toMatchObject({ status: 'PENDING_RECEIVABLE', amount: 11_000_000 });
    // Nối sổ công nợ rồi gửi lại: hạch toán, chứng từ đã ghi sổ.
    credit = { requestCredit: async () => ({ status: 'POSTED', documentId: 'adj-1', documentCode: 'DC-1' }) };
    await resolution.syncDocuments(actor(), CASE_ID, { revision: 2 });
    expect(store.documents.get(`crm-warranty:${CASE_ID}:line-1:credit`)).toMatchObject({ status: 'POSTED', documentCode: 'DC-1' });
  });

  it('kiểm hướng xử lý: phải Đang xử lý, khớp kết quả kiểm định, có quyền', async () => {
    const early = await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK' }));
    expect([early.statusCode, early.code]).toEqual([409, 'NOT_RESOLVING']);
    store.inspected('PASSED');
    expect((await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1, disposition: 'SCRAP' }))).code).toBe('INVALID_DISPOSITION');
    expect((await rejection(resolution.resolve(actor(), CASE_ID, 'line-1', { revision: 1 }))).code).toBe('DISPOSITION_REQUIRED');
    expect((await rejection(resolution.resolve(actor({ canWriteWarranty: false }), CASE_ID, 'line-1', { revision: 1, disposition: 'RESTOCK' }))).statusCode).toBe(403);
    expect((await rejection(resolution.resolve(actor(), CASE_ID, 'nope', { revision: 1, disposition: 'RESTOCK' }))).statusCode).toBe(404);
  });
});

describe('ReceivableWarrantyCredit (T6-06)', () => {
  const request = {
    tenantId: TENANT,
    kind: 'CREDIT' as const,
    customerId: CUSTOMER,
    orderId: ORDER,
    amount: 11_000_000,
    reason: 'Giảm trừ',
    sourceType: 'crm_warranty' as const,
    sourceId: 'line-1',
    idempotencyKey: 'k',
    actorId: KTV,
  };
  const adjustment = (status: string) => ({ adjustment: { id: 'adj', code: 'DC1', status } as never, created: true });

  it('điều chỉnh Chờ duyệt thì Chờ sổ công nợ, đã duyệt thì Đã ghi sổ, bị huỷ thì báo lỗi', async () => {
    const calls: unknown[] = [];
    let status = 'DRAFT';
    const credit = new ReceivableWarrantyCredit({ createAdjustment: async (command) => (calls.push(command), adjustment(status)) });
    expect(await credit.requestCredit(request)).toEqual({ status: 'PENDING_RECEIVABLE', documentId: 'adj', documentCode: 'DC1' });
    expect(calls[0]).toMatchObject({ customerId: CUSTOMER, orderId: ORDER, amount: 11_000_000, sourceType: 'crm_warranty', sourceId: 'line-1', direction: 'DECREASE', actor: { tenantId: TENANT, userId: KTV } });
    status = 'APPROVED';
    expect((await credit.requestCredit(request)).status).toBe('POSTED');
    status = 'CANCELLED';
    expect((await rejection(credit.requestCredit(request))).code).toBe('ADJUSTMENT_CANCELLED');
  });
});
