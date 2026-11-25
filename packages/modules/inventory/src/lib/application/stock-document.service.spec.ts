import type {
  PostedStockDocument,
  SettingsEntry,
  StockDocument,
  StockDocumentListQuery,
  StockDocumentPage,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import { StockDocumentService } from './stock-document.service.js';
import type {
  IdempotentDocumentRef,
  NewStockDocumentInput,
  PostOptions,
  StockDocumentChange,
  StockDocumentStore,
} from './stock-document-store.port.js';

/** Store giả trong bộ nhớ: chạy `decide` trên bản ghi hiện có, như store thật làm sau khi khoá. */
class FakeStockDocumentStore implements StockDocumentStore {
  readonly documents = new Map<string, StockDocument>();
  readonly created: NewStockDocumentInput[] = [];
  posts = 0;
  private sequence = 0;

  lastQuery?: StockDocumentListQuery;

  async list(_tenantId: string, query: StockDocumentListQuery): Promise<StockDocumentPage> {
    this.lastQuery = query;
    const items = [...this.documents.values()];
    return { items, total: items.length, limit: 50, offset: 0 };
  }

  async get(_tenantId: string, key: string): Promise<StockDocument | null> {
    return this.documents.get(key) ?? null;
  }

  async findByIdempotencyPrefixes(): Promise<IdempotentDocumentRef[]> {
    return [];
  }

  async create(_tenantId: string, input: NewStockDocumentInput): Promise<StockDocument> {
    this.created.push(input);
    this.sequence += 1;
    const id = `doc-${this.sequence}`;
    const document: StockDocument = {
      id,
      code: `PN-${this.sequence}`,
      docType: input.docType,
      status: 'DRAFT',
      warehouseId: 'w1',
      warehouseCode: input.warehouseCode,
      targetWarehouseCode: input.targetWarehouseCode,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      documentDate: '2026-10-27',
      createdBy: input.createdBy,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lines: input.lines.map((line, index) => ({
        id: `line-${index + 1}`,
        lineNo: index + 1,
        materialId: `m-${line.materialCode}`,
        materialCode: line.materialCode,
        materialName: line.materialCode,
        quantity: line.quantity,
        direction: line.direction,
        unitCost: line.unitCost,
      })),
    };
    this.documents.set(id, document);
    return document;
  }

  async change(
    _tenantId: string,
    key: string,
    decide: (current: StockDocument) => StockDocumentChange,
  ): Promise<PostedStockDocument> {
    const current = this.documents.get(key);
    if (!current) throw new Error('not found');
    const change = decide(current);
    let next: StockDocument;
    if (change.kind === 'update') next = { ...current, status: 'DRAFT', note: change.patch.note };
    else if (change.kind === 'post') {
      this.posts += 1;
      next = { ...current, status: 'POSTED', postedBy: change.actorId };
    } else next = { ...current, status: change.to, rejectReason: change.reason ?? current.rejectReason };
    this.documents.set(key, next);
    return { document: next, transactions: [] };
  }

  readonly postOptions: PostOptions[] = [];

  async createAndPost(
    tenantId: string,
    input: NewStockDocumentInput,
    _postedBy: string,
    options: PostOptions = {},
  ): Promise<PostedStockDocument> {
    this.postOptions.push(options);
    const document = await this.create(tenantId, input);
    const posted: StockDocument = { ...document, status: 'POSTED' };
    this.documents.set(document.id, posted);
    return { document: posted, transactions: [] };
  }

  async reverse(
    _tenantId: string,
    key: string,
    _actorId: string,
    check: (original: StockDocument) => void,
  ): Promise<PostedStockDocument> {
    const original = this.documents.get(key);
    if (!original) throw new Error('not found');
    check(original);
    const reversal: StockDocument = {
      ...original,
      id: `${original.id}-r`,
      reversesDocumentId: original.id,
    };
    this.documents.set(reversal.id, reversal);
    return { document: reversal, transactions: [] };
  }
}

function settingsStore(allowSelfApproval?: boolean): InventoryStore {
  const entry: SettingsEntry<unknown> | null =
    allowSelfApproval === undefined
      ? null
      : {
          key: 'documents.approval',
          value: { allowSelfApproval },
          version: 1,
          updatedAt: new Date(0).toISOString(),
        };
  return { settings: { get: async () => entry } } as unknown as InventoryStore;
}

const actor = (userId: string, rights: Partial<InventoryActor> = {}): InventoryActor => ({
  tenantId: 'tenant',
  userId,
  displayName: userId,
  canManage: false,
  canWriteTransactions: true,
  canApproveDocuments: false,
  ...rights,
});

const clerk = actor('clerk');
const manager = actor('manager', { canApproveDocuments: true });

async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; code: string; message: string };
  }
  throw new Error('expected rejection');
}

describe('StockDocumentService', () => {
  let store: FakeStockDocumentStore;
  let service: StockDocumentService;

  beforeEach(() => {
    store = new FakeStockDocumentStore();
    service = new StockDocumentService(store, settingsStore());
  });

  const createOther = () =>
    service.create(clerk, {
      docType: 'RECEIPT_OTHER',
      warehouseCode: ' KHO-HN ',
      lines: [{ materialCode: ' VT-01 ', quantity: 10 }],
    });

  it('danh sách lọc theo nhiều loại, nguồn, khoảng ngày; từ chối loại hoặc ngày sai', async () => {
    await service.list(clerk, {
      docTypes: ['ISSUE_SALES', 'ISSUE_WARRANTY'],
      status: 'DRAFT',
      sourceType: ' crm_order ',
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });
    expect(store.lastQuery).toMatchObject({
      docTypes: ['ISSUE_SALES', 'ISSUE_WARRANTY'],
      status: 'DRAFT',
      sourceType: 'crm_order',
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });
    await service.list(clerk, { docTypes: [], sourceType: '  ' });
    expect(store.lastQuery?.docTypes).toBeUndefined();
    expect(store.lastQuery?.sourceType).toBeUndefined();

    expect(
      await rejection(service.list(clerk, { docTypes: ['ISSUE_SALES', 'KHAC' as never] })),
    ).toMatchObject({ statusCode: 400, message: 'Loại chứng từ không hợp lệ.' });
    expect(await rejection(service.list(clerk, { fromDate: '27/10/2026' }))).toMatchObject({
      statusCode: 400,
      message: 'Ngày lọc phải có dạng YYYY-MM-DD.',
    });
    expect(
      await rejection(service.list(clerk, { fromDate: '2026-10-31', toDate: '2026-10-01' })),
    ).toMatchObject({ statusCode: 400, message: 'Từ ngày phải trước hoặc bằng đến ngày.' });
  });

  it('chuẩn hoá input khi tạo: cắt khoảng trắng, suy chiều dòng, đơn giá mặc định 0', async () => {
    await createOther();
    expect(store.created[0]).toMatchObject({
      docType: 'RECEIPT_OTHER',
      warehouseCode: 'KHO-HN',
      createdBy: 'clerk',
      lines: [{ materialCode: 'VT-01', quantity: 10, direction: 'IN', unitCost: 0 }],
    });
  });

  it('từ chối input sai: thiếu dòng, số lượng không dương, điều chuyển cùng kho, nguồn không phải UUID', async () => {
    await expect(
      service.create(clerk, { docType: 'ISSUE_SALES', warehouseCode: 'K', lines: [] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.create(clerk, {
        docType: 'ISSUE_SALES',
        warehouseCode: 'K',
        lines: [{ materialCode: 'A', quantity: 0 }],
      }),
    ).rejects.toThrow('Dòng 1: số lượng phải là số dương.');
    await expect(
      service.create(clerk, {
        docType: 'TRANSFER',
        warehouseCode: 'K',
        targetWarehouseCode: 'K',
        lines: [{ materialCode: 'A', quantity: 1 }],
      }),
    ).rejects.toThrow('Kho nguồn và kho đích phải khác nhau.');
    await expect(
      service.create(clerk, {
        docType: 'ISSUE_SALES',
        warehouseCode: 'K',
        sourceId: 'DH-01',
        lines: [{ materialCode: 'A', quantity: 1 }],
      }),
    ).rejects.toThrow('Mã chứng từ nguồn không hợp lệ.');
    expect(store.created).toHaveLength(0);
  });

  it('nhập khác: phải gửi duyệt, người khác duyệt rồi mới ghi sổ (TC-INV-03)', async () => {
    const draft = await createOther();
    expect((await rejection(service.post(clerk, draft.id))).statusCode).toBe(409);
    expect(store.posts).toBe(0);

    await service.submit(clerk, draft.id);
    await service.approve(manager, draft.id);
    const posted = await service.post(clerk, draft.id);
    expect(posted.document.status).toBe('POSTED');
    expect(store.posts).toBe(1);
  });

  it('người lập không tự duyệt; bật allowSelfApproval thì được (TC-INV-04)', async () => {
    const self = actor('manager', { canApproveDocuments: true });
    const draft = await service.create(self, {
      docType: 'ISSUE_OTHER',
      warehouseCode: 'KHO',
      lines: [{ materialCode: 'VT', quantity: 1 }],
    });
    await service.submit(self, draft.id);
    const error = await rejection(service.approve(self, draft.id));
    expect([error.statusCode, error.message]).toEqual([403, 'Không được tự duyệt chứng từ do mình lập.']);

    const permissive = new StockDocumentService(store, settingsStore(true));
    const approved = await permissive.approve(self, draft.id);
    expect(approved.status).toBe('APPROVED');
  });

  it('duyệt và từ chối cần quyền duyệt; từ chối phải có lý do', async () => {
    const draft = await createOther();
    await service.submit(clerk, draft.id);
    expect((await rejection(service.approve(actor('other'), draft.id))).statusCode).toBe(403);
    expect((await rejection(service.reject(manager, draft.id, { reason: '  ' }))).message).toBe(
      'Phải ghi lý do từ chối.',
    );
    const rejected = await service.reject(manager, draft.id, { reason: 'Sai số lượng' });
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'Sai số lượng' });

    // Sửa chứng từ bị từ chối đưa nó về Nháp.
    const edited = await service.update(clerk, draft.id, { note: 'Đã sửa' });
    expect(edited.status).toBe('DRAFT');
  });

  it('xuất theo đơn bán ghi sổ thẳng từ Nháp, không qua Chờ duyệt (TC-INV-05)', async () => {
    const draft = await service.create(clerk, {
      docType: 'ISSUE_SALES',
      warehouseCode: 'KHO',
      lines: [{ materialCode: 'VT', quantity: 2 }],
    });
    const posted = await service.post(clerk, draft.id);
    expect(posted.document.status).toBe('POSTED');
  });

  it('chứng từ đã ghi sổ: sửa trả 409, huỷ trả 409, chỉ đảo được (TC-INV-22, TC-INV-23)', async () => {
    const draft = await service.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO',
      sourceType: 'purchase_order',
      sourceId: '8d0f6c1e-2b8e-4f55-9d64-2f0d9a1c7e11',
      lines: [{ materialCode: 'VT', quantity: 2 }],
    });
    await service.post(clerk, draft.id);
    const edit = await rejection(service.update(clerk, draft.id, { note: 'x' }));
    expect([edit.statusCode, edit.message]).toEqual([409, 'Chứng từ đã ghi sổ không được sửa.']);
    expect((await rejection(service.cancel(clerk, draft.id))).statusCode).toBe(409);
    expect((await rejection(service.post(clerk, draft.id))).statusCode).toBe(409);

    const reversal = await service.reverse(manager, draft.id);
    expect(reversal.document.reversesDocumentId).toBe(draft.id);
    expect(store.documents.get(draft.id)?.status).toBe('POSTED');
  });

  it('nhập mua, xuất dự án không nguồn không ghi sổ thẳng từ Nháp; có nguồn thì được (ISS-BE-006)', async () => {
    for (const docType of ['RECEIPT_PURCHASE', 'ISSUE_PROJECT'] as const) {
      const draft = await service.create(clerk, { docType, warehouseCode: 'KHO', lines: [{ materialCode: 'VT', quantity: 1 }] });
      const error = await rejection(service.post(clerk, draft.id));
      expect([error.statusCode, error.message]).toEqual([409, 'Chứng từ này cần được duyệt trước khi ghi sổ.']);
      expect(store.documents.get(draft.id)?.status).toBe('DRAFT');
      await service.submit(clerk, draft.id);
      await service.approve(manager, draft.id);
      expect((await service.post(clerk, draft.id)).document.status).toBe('POSTED');
    }
    expect(store.posts).toBe(2);
  });

  it('đảo chứng từ cần quyền duyệt và khác người lập gốc, trừ khi cho tự duyệt (ISS-BE-006)', async () => {
    const source = { sourceType: 'purchase_order', sourceId: '8d0f6c1e-2b8e-4f55-9d64-2f0d9a1c7e11' };
    const byClerk = await service.create(clerk, { docType: 'RECEIPT_PURCHASE', warehouseCode: 'KHO', ...source, lines: [{ materialCode: 'VT', quantity: 1 }] });
    await service.post(clerk, byClerk.id);
    const denied = await rejection(service.reverse(clerk, byClerk.id));
    expect([denied.statusCode, denied.message]).toEqual([403, 'Bạn không có quyền duyệt chứng từ kho.']);

    const byManager = await service.create(manager, { docType: 'RECEIPT_PURCHASE', warehouseCode: 'KHO', ...source, lines: [{ materialCode: 'VT', quantity: 1 }] });
    await service.post(manager, byManager.id);
    const self = await rejection(service.reverse(manager, byManager.id));
    expect([self.statusCode, self.code, self.message]).toEqual([
      403,
      'STOCK_DOCUMENT_SELF_REVERSAL',
      'Bạn không được đảo chứng từ do chính mình lập.',
    ]);
    expect(store.documents.has(`${byManager.id}-r`)).toBe(false);

    const permissive = new StockDocumentService(store, settingsStore(true));
    expect((await permissive.reverse(manager, byManager.id)).document.reversesDocumentId).toBe(byManager.id);
    expect((await service.reverse(manager, byClerk.id)).document.reversesDocumentId).toBe(byClerk.id);
  });

  it('không có quyền ghi phát sinh thì không lập được chứng từ', async () => {
    const reader = actor('reader', { canWriteTransactions: false });
    await expect(createOtherAs(reader)).rejects.toMatchObject({ statusCode: 403 });

    function createOtherAs(who: InventoryActor) {
      return service.create(who, {
        docType: 'RECEIPT_OTHER',
        warehouseCode: 'KHO',
        lines: [{ materialCode: 'VT', quantity: 1 }],
      });
    }
  });

  it('T1-14: dòng serial chuẩn hoá serial, số serial phải bằng số lượng nguyên', async () => {
    await service.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO',
      lines: [{ materialCode: 'LAP', quantity: 2, serials: [' SN001 ', 'SN002'] }],
    });
    expect(store.created.at(-1)?.lines[0]).toMatchObject({ serials: ['SN001', 'SN002'] });

    const fewer = await rejection(
      service.create(clerk, {
        docType: 'ISSUE_SALES',
        warehouseCode: 'KHO',
        lines: [{ materialCode: 'LAP', quantity: 3, serials: ['SN001', 'SN002'] }],
      }),
    );
    expect([fewer.statusCode, fewer.message]).toEqual([
      400,
      'Dòng 1: số serial (2) phải bằng số lượng (3).',
    ]);
    const fractional = await rejection(
      service.create(clerk, {
        docType: 'ISSUE_SALES',
        warehouseCode: 'KHO',
        lines: [{ materialCode: 'LAP', quantity: 1.5, serials: ['SN001'] }],
      }),
    );
    expect(fractional.statusCode).toBe(400);
    const repeated = await rejection(
      service.create(clerk, {
        docType: 'ISSUE_SALES',
        warehouseCode: 'KHO',
        lines: [
          { materialCode: 'LAP', quantity: 1, serials: ['sn001'] },
          { materialCode: 'LAP', quantity: 1, serials: ['SN001'] },
        ],
      }),
    );
    expect(repeated.message).toBe('Serial SN001 của LAP có ở cả dòng 1 và dòng 2.');
  });

  it('T1-17: dòng lô viết hoa số lô; dòng xuất chỉ giữ số lô; không ghi cả lô và serial', async () => {
    await service.create(clerk, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO',
      lines: [
        { materialCode: 'MUC', quantity: 30, lot: { lotNo: ' l01 ', expiresOn: '2026-12-31', manufacturedOn: '2026-01-01' } },
      ],
    });
    expect(store.created.at(-1)?.lines[0].lot).toEqual({
      lotNo: 'L01',
      expiresOn: '2026-12-31',
      manufacturedOn: '2026-01-01',
      supplier: undefined,
      certificateNo: undefined,
    });
    await service.create(clerk, {
      docType: 'ISSUE_SALES',
      warehouseCode: 'KHO',
      lines: [{ materialCode: 'MUC', quantity: 3, lot: { lotNo: 'L01', expiresOn: '2027-01-01' } }],
    });
    expect(store.created.at(-1)?.lines[0].lot).toEqual({ lotNo: 'L01' });

    const both = await rejection(
      service.create(clerk, {
        docType: 'RECEIPT_PURCHASE',
        warehouseCode: 'KHO',
        lines: [{ materialCode: 'MUC', quantity: 1, serials: ['A'], lot: { lotNo: 'L01' } }],
      }),
    );
    expect(both.message).toBe('Dòng 1: một dòng chỉ ghi lô hoặc serial, không ghi cả hai.');
    const badDates = await rejection(
      service.create(clerk, {
        docType: 'RECEIPT_PURCHASE',
        warehouseCode: 'KHO',
        lines: [{ materialCode: 'MUC', quantity: 1, lot: { lotNo: 'L09', manufacturedOn: '2027-01-02', expiresOn: '2027-01-01' } }],
      }),
    );
    expect(badDates.message).toBe('Dòng 1: ngày sản xuất phải trước hạn dùng.');
  });

  describe('API nội bộ cho Bán hàng (T1-25, T1-26)', () => {
    const sourceId = '8d0f6c1e-2b8e-4f55-9d64-2f0d9a1c7e11';
    const issueRequest = {
      idempotencyKey: ' giao-1 ',
      warehouseCode: ' QA-KHO ',
      sourceType: 'crm_delivery',
      sourceId,
      lines: [{ materialCode: ' QA-KHO-CAP ', quantity: 3, lotNo: ' l01 ' }],
    };

    it('yêu cầu xuất tạo chứng từ nháp ISSUE_SALES, có dấu nội dung ổn định', async () => {
      const result = await service.createIssueRequest(clerk, issueRequest);
      expect(result).toMatchObject({ documentId: 'doc-1', documentCode: 'PN-1', docType: 'ISSUE_SALES', status: 'DRAFT' });
      expect(store.created[0]).toMatchObject({
        idempotencyKey: 'giao-1',
        warehouseCode: 'QA-KHO',
        sourceType: 'crm_delivery',
        sourceId,
        lines: [{ materialCode: 'QA-KHO-CAP', quantity: 3, direction: 'OUT', lot: { lotNo: 'L01' } }],
      });
      await service.createIssueRequest(clerk, issueRequest);
      await service.createIssueRequest(clerk, { ...issueRequest, docType: 'ISSUE_WARRANTY' });
      expect(store.created[0].requestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(store.created[1].requestHash).toBe(store.created[0].requestHash);
      expect(store.created[2].requestHash).not.toBe(store.created[0].requestHash);
    });

    it('yêu cầu xuất kiểm khoá chống lặp, nguồn, loại chứng từ và quyền', async () => {
      const cases: [Partial<typeof issueRequest> & { docType?: string }, string][] = [
        [{ idempotencyKey: ' ' }, 'Thiếu khoá chống lặp (idempotencyKey).'],
        [{ sourceType: '' }, 'Thiếu loại chứng từ nguồn (sourceType).'],
        [{ sourceId: 'abc' }, 'Mã chứng từ nguồn không hợp lệ.'],
        [{ docType: 'ISSUE_OTHER' }, 'Yêu cầu xuất chỉ nhận loại xuất bán hoặc xuất bảo hành.'],
      ];
      for (const [patch, message] of cases) {
        const error = await rejection(service.createIssueRequest(clerk, { ...issueRequest, ...patch } as never));
        expect([error.statusCode, error.message]).toEqual([400, message]);
      }
      const denied = await rejection(
        service.createIssueRequest(actor('viewer', { canWriteTransactions: false }), issueRequest),
      );
      expect(denied.statusCode).toBe(403);
    });

    it('nhập trả ghi sổ ngay với hàng Chờ kiểm định; dòng không serial vào lô TH riêng', async () => {
      const result = await service.receiveReturn(clerk, {
        idempotencyKey: 'tra-1',
        warehouseCode: 'QA-KHO-CL',
        sourceType: 'crm_warranty',
        sourceId,
        lines: [
          { materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN032'] },
          { materialCode: 'QA-KHO-CAP', quantity: 2, lotNo: 'l01', sourceLineId: sourceId },
        ],
      });
      expect(result).toMatchObject({ docType: 'RECEIPT_SALES_RETURN', status: 'POSTED' });
      expect(store.postOptions).toEqual([{ inboundQuality: 'PENDING_INSPECTION' }]);
      const [serialLine, lotLine] = store.created[0].lines;
      expect(serialLine).toMatchObject({ serials: ['SN032'], direction: 'IN' });
      expect(serialLine.lot).toBeUndefined();
      expect(lotLine).toMatchObject({
        newLotQuality: 'PENDING_INSPECTION',
        copyLotFrom: 'L01',
        sourceLineId: sourceId,
      });
      expect(lotLine.lot?.lotNo).toMatch(/^TH-[0-9A-F]{10}-2$/);
    });

    it('dòng xuất gốc chỉ dùng cho nhập trả hàng bán', async () => {
      const error = await rejection(
        service.create(clerk, {
          docType: 'RECEIPT_PURCHASE',
          warehouseCode: 'KHO',
          lines: [{ materialCode: 'VT', quantity: 1, sourceLineId: sourceId }],
        }),
      );
      expect(error.message).toBe('Dòng 1: chỉ dòng nhập trả hàng bán mới tham chiếu dòng xuất gốc.');
    });
  });

  describe('Chứng từ nội bộ cho bảo hành (T6-05)', () => {
    const sourceId = '8d0f6c1e-2b8e-4f55-9d64-2f0d9a1c7e11';
    const transfer = {
      idempotencyKey: 'crm-warranty:1:line:transfer',
      docType: 'TRANSFER' as const,
      warehouseCode: ' QA-KHO-CL ',
      targetWarehouseCode: ' QA-KHO-LOI ',
      sourceType: 'crm_warranty',
      sourceId,
      lines: [{ materialCode: 'QA-KHO-MAY', quantity: 1, serials: ['SN004'] }],
    };

    it('điều chuyển sang kho lỗi ghi sổ ngay, có nguồn và dấu nội dung', async () => {
      const result = await service.createInternalDocument(clerk, transfer);
      expect(result).toMatchObject({ docType: 'TRANSFER', status: 'POSTED' });
      expect(store.created[0]).toMatchObject({
        docType: 'TRANSFER',
        warehouseCode: 'QA-KHO-CL',
        targetWarehouseCode: 'QA-KHO-LOI',
        sourceType: 'crm_warranty',
        sourceId,
        lines: [{ materialCode: 'QA-KHO-MAY', serials: ['SN004'], direction: 'OUT' }],
      });
      expect(store.created[0].requestHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('xuất khác (loại bỏ) tạo rồi gửi duyệt, không ghi sổ (TC-WAR-09)', async () => {
      const result = await service.createInternalDocument(clerk, {
        ...transfer,
        docType: 'ISSUE_OTHER',
        targetWarehouseCode: undefined,
        idempotencyKey: 'crm-warranty:1:line:scrap',
      });
      expect(result).toMatchObject({ docType: 'ISSUE_OTHER', status: 'PENDING' });
      expect(store.posts).toBe(0);
    });

    it('chỉ nhận điều chuyển, xuất khác; kiểm kho đến, khoá chống lặp, quyền', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ docType: 'ISSUE_SALES' }, 'Chứng từ nội bộ chỉ nhận loại điều chuyển hoặc xuất khác.'],
        [{ targetWarehouseCode: undefined }, 'Chứng từ điều chuyển phải có kho đến.'],
        [{ targetWarehouseCode: 'QA-KHO-CL' }, 'Kho nguồn và kho đích phải khác nhau.'],
        [{ docType: 'ISSUE_OTHER' }, 'Chỉ chứng từ điều chuyển mới có kho đến.'],
        [{ idempotencyKey: '' }, 'Thiếu khoá chống lặp (idempotencyKey).'],
      ];
      for (const [patch, message] of cases) {
        const error = await rejection(service.createInternalDocument(clerk, { ...transfer, ...patch } as never));
        expect([error.statusCode, error.message]).toEqual([400, message]);
      }
      const denied = await rejection(
        service.createInternalDocument(actor('viewer', { canWriteTransactions: false }), transfer),
      );
      expect(denied.statusCode).toBe(403);
    });
  });
});

describe('StockDocumentService: nhà cung cấp của lô theo danh mục', () => {
  const catalog = ['Công ty A', 'ABB Việt Nam'];

  function build(suppliers: readonly string[]) {
    const store = new FakeStockDocumentStore();
    const get = jest.fn(async (_tenantId: string, key: string): Promise<SettingsEntry<unknown> | null> =>
      key === 'catalog.supplier'
        ? { key, value: { suppliers }, version: 1, updatedAt: new Date(0).toISOString() }
        : null,
    );
    const service = new StockDocumentService(store, { settings: { get } } as unknown as InventoryStore);
    return { store, service, get };
  }

  const receipt = (supplier?: string) => ({
    docType: 'RECEIPT_OTHER' as const,
    warehouseCode: 'KHO-HN',
    lines: [{ materialCode: 'VT-01', quantity: 10, lot: { lotNo: 'L1', supplier } }],
  });

  it('tạo: nhà cung cấp của lô được đổi thành tên chuẩn trong danh mục', async () => {
    const { store, service } = build(catalog);
    await service.create(clerk, receipt('cong ty a'));
    expect(store.created[0].lines[0].lot).toMatchObject({ lotNo: 'L1', supplier: 'Công ty A' });
  });

  it('tạo: nhà ngoài danh mục bị từ chối kèm số dòng, chứng từ không được tạo', async () => {
    const { store, service } = build(catalog);
    const error = await rejection(service.create(clerk, receipt('Nhà lạ')));
    expect([error.statusCode, error.code]).toEqual([400, 'SUPPLIER_NOT_IN_CATALOG']);
    expect(error.message).toBe(
      'Dòng 1: Nhà cung cấp "Nhà lạ" chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt.',
    );
    expect(store.created).toHaveLength(0);
  });

  it('danh mục rỗng: nhập tự do như trước', async () => {
    const { store, service } = build([]);
    await service.create(clerk, receipt('Nhà lạ'));
    expect(store.created[0].lines[0].lot?.supplier).toBe('Nhà lạ');
  });

  it('không khai nhà cung cấp cho lô thì không đọc cấu hình', async () => {
    const { service, get } = build(catalog);
    await service.create(clerk, receipt(undefined));
    await service.create(clerk, {
      docType: 'RECEIPT_OTHER',
      warehouseCode: 'KHO-HN',
      lines: [{ materialCode: 'VT-01', quantity: 1 }],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('sửa chứng từ nháp: dòng mới có nhà ngoài danh mục bị từ chối, dòng đúng thì qua', async () => {
    const { service } = build(catalog);
    const draft = await service.create(clerk, receipt(undefined));
    const bad = await rejection(service.update(clerk, draft.id, receipt('Nhà lạ')));
    expect(bad.code).toBe('SUPPLIER_NOT_IN_CATALOG');
    await expect(service.update(clerk, draft.id, receipt('abb viet nam'))).resolves.toBeDefined();
  });
});

describe('người duyệt cố định theo chức danh', () => {
  const KHO_TRUONG = '11111111-1111-4111-8111-111111111111';
  const KE_TOAN = '22222222-2222-4222-8222-222222222222';
  const THU_KHO = '33333333-3333-4333-8333-333333333333';

  const policyStore = (approvers: Record<string, unknown>, extra: Record<string, unknown> = {}): InventoryStore =>
    ({
      settings: {
        get: async () => ({
          key: 'documents.approval',
          value: { allowSelfApproval: false, mode: 'FIXED_APPROVER', overrides: {}, approvers, ...extra },
          version: 1,
          updatedAt: new Date(0).toISOString(),
        }),
      },
    }) as unknown as InventoryStore;

  const org = (held: Record<string, string[]>, fail = false) => ({
    positions: async () => [],
    heldPositionIds: async (_tenant: string, userId: string) => {
      if (fail) throw Object.assign(new Error('x'), { statusCode: 503, code: 'ORGANIZATION_UNAVAILABLE' });
      return held[userId] ?? [];
    },
  });

  const submitted = async (service: StockDocumentService, store: FakeStockDocumentStore) => {
    const draft = await service.create(clerk, {
      docType: 'RECEIPT_OTHER',
      warehouseCode: 'KHO-HN',
      lines: [{ materialCode: 'VT-01', quantity: 1 }],
    });
    await service.submit(clerk, draft.id);
    return draft.id;
  };

  it('chỉ người giữ chức danh được chỉ định duyệt được; người có quyền duyệt kho nhưng khác chức danh bị 403', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(
      store,
      policyStore({ DEFAULT: { positionId: KHO_TRUONG } }),
      org({ truong: [KHO_TRUONG], khac: [THU_KHO] }),
    );
    const id = await submitted(service, store);
    const denied = await rejection(service.approve(actor('khac', { canApproveDocuments: true }), id));
    expect([denied.statusCode, denied.code]).toEqual([403, 'APPROVER_NOT_ASSIGNED']);
    const approved = await service.approve(actor('truong', { canApproveDocuments: true }), id);
    expect(approved.status).toBe('APPROVED');
  });

  it('chức danh dự phòng cũng duyệt được', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(
      store,
      policyStore({ DEFAULT: { positionId: KHO_TRUONG, fallbackPositionId: KE_TOAN } }),
      org({ ketoan: [KE_TOAN] }),
    );
    const id = await submitted(service, store);
    expect((await service.approve(actor('ketoan', { canApproveDocuments: true }), id)).status).toBe('APPROVED');
  });

  it('người có quyền quản lý Kho duyệt được mọi chứng từ, như hrm.manage bên HRM', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(
      store,
      policyStore({ DEFAULT: { positionId: KHO_TRUONG } }),
      org({}),
    );
    const id = await submitted(service, store);
    expect((await service.approve(actor('admin', { canManage: true, canApproveDocuments: true }), id)).status).toBe('APPROVED');
  });

  it('không đọc được sơ đồ tổ chức thì từ chối, không cho qua', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(
      store,
      policyStore({ DEFAULT: { positionId: KHO_TRUONG } }),
      org({}, true),
    );
    const id = await submitted(service, store);
    const error = await rejection(service.approve(actor('truong', { canApproveDocuments: true }), id));
    expect(error.statusCode).toBe(503);
  });

  it('chưa khai báo người duyệt thì giữ như cũ: ai có quyền duyệt kho cũng duyệt được', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(store, policyStore({}), org({}, true));
    const id = await submitted(service, store);
    expect((await service.approve(manager, id)).status).toBe('APPROVED');
  });

  it('nhóm có cách duyệt riêng dùng người duyệt của nhóm, không dùng của dòng mặc định', async () => {
    const store = new FakeStockDocumentStore();
    const service = new StockDocumentService(
      store,
      policyStore(
        { DEFAULT: { positionId: KHO_TRUONG }, RECEIPT: { positionId: THU_KHO } },
        { overrides: { RECEIPT: 'FIXED_APPROVER' } },
      ),
      org({ truong: [KHO_TRUONG], thukho: [THU_KHO] }),
    );
    const id = await submitted(service, store);
    expect((await rejection(service.approve(actor('truong', { canApproveDocuments: true }), id))).statusCode).toBe(403);
    expect((await service.approve(actor('thukho', { canApproveDocuments: true }), id)).status).toBe('APPROVED');
  });
});
