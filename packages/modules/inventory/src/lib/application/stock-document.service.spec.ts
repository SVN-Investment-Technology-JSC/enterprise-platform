import type {
  PostedStockDocument,
  SettingsEntry,
  StockDocument,
  StockDocumentPage,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import { StockDocumentService } from './stock-document.service.js';
import type {
  NewStockDocumentInput,
  StockDocumentChange,
  StockDocumentStore,
} from './stock-document-store.port.js';

/** Store giả trong bộ nhớ: chạy `decide` trên bản ghi hiện có, như store thật làm sau khi khoá. */
class FakeStockDocumentStore implements StockDocumentStore {
  readonly documents = new Map<string, StockDocument>();
  readonly created: NewStockDocumentInput[] = [];
  posts = 0;
  private sequence = 0;

  async list(): Promise<StockDocumentPage> {
    const items = [...this.documents.values()];
    return { items, total: items.length, limit: 50, offset: 0 };
  }

  async get(_tenantId: string, key: string): Promise<StockDocument | null> {
    return this.documents.get(key) ?? null;
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

  async createAndPost(): Promise<PostedStockDocument> {
    throw new Error('not used');
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
      lines: [{ materialCode: 'VT', quantity: 2 }],
    });
    await service.post(clerk, draft.id);
    const edit = await rejection(service.update(clerk, draft.id, { note: 'x' }));
    expect([edit.statusCode, edit.message]).toEqual([409, 'Chứng từ đã ghi sổ không được sửa.']);
    expect((await rejection(service.cancel(clerk, draft.id))).statusCode).toBe(409);
    expect((await rejection(service.post(clerk, draft.id))).statusCode).toBe(409);

    const reversal = await service.reverse(clerk, draft.id);
    expect(reversal.document.reversesDocumentId).toBe(draft.id);
    expect(store.documents.get(draft.id)?.status).toBe('POSTED');
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
});
