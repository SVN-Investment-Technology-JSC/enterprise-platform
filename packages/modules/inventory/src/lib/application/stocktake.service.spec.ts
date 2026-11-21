import type {
  PostedStockDocument,
  SettingsEntry,
  StockDocument,
  StocktakeLine,
  StocktakeSession,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { NewStockDocumentInput, StockDocumentStore } from './stock-document-store.port.js';
import { StocktakeService } from './stocktake.service.js';
import type { StocktakeStore, StocktakeTransition } from './stocktake-store.port.js';

/** Store kiểm kê giả trong bộ nhớ: chạy `check` trên bản ghi hiện có rồi mới đổi, như store thật làm sau khi khoá. */
class FakeStocktakeStore {
  readonly sessions = new Map<string, StocktakeSession>();
  readonly lineMap = new Map<string, StocktakeLine[]>();
  markPostedCalls = 0;

  async get(_tenantId: string, key: string): Promise<StocktakeSession | null> {
    return this.sessions.get(key) ?? null;
  }

  async lines(_tenantId: string, key: string): Promise<StocktakeLine[]> {
    return this.lineMap.get(key) ?? [];
  }

  async transition(
    _tenantId: string,
    key: string,
    change: StocktakeTransition,
    check: (current: StocktakeSession, lines: readonly StocktakeLine[]) => void,
  ): Promise<StocktakeSession> {
    const current = this.sessions.get(key);
    if (!current) throw new Error('not found');
    check(current, this.lineMap.get(key) ?? []);
    const next: StocktakeSession = {
      ...current,
      status: change.to,
      approvedBy: change.to === 'APPROVED' ? change.actorId : current.approvedBy,
      cancelReason: change.to === 'CANCELLED' ? change.reason : current.cancelReason,
    };
    this.sessions.set(key, next);
    return next;
  }

  async markPosted(
    _tenantId: string,
    key: string,
    input: { readonly documentId?: string; readonly actorId: string },
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeSession> {
    this.markPostedCalls += 1;
    const current = this.sessions.get(key);
    if (!current) throw new Error('not found');
    check(current);
    if (current.status === 'POSTED') return current;
    const next: StocktakeSession = { ...current, status: 'POSTED', documentId: input.documentId, documentCode: input.documentId ? `DC-${input.documentId}` : undefined };
    this.sessions.set(key, next);
    return next;
  }
}

/** Store chứng từ giả: ghi lại mỗi lần tạo và ghi sổ; `failWith` mô phỏng ghi sổ lỗi (âm tồn...). */
class FakeStockDocumentStore {
  readonly documents = new Map<string, StockDocument>();
  readonly posted: NewStockDocumentInput[] = [];
  failWith?: Error;

  async get(_tenantId: string, key: string): Promise<StockDocument | null> {
    return this.documents.get(key) ?? null;
  }

  async createAndPost(_tenantId: string, input: NewStockDocumentInput): Promise<PostedStockDocument> {
    if (this.failWith) throw this.failWith;
    this.posted.push(input);
    const id = `doc-${this.posted.length}`;
    const document: StockDocument = {
      id,
      code: `DC-${id}`,
      docType: input.docType,
      status: 'POSTED',
      warehouseId: 'w1',
      warehouseCode: input.warehouseCode,
      documentDate: '2026-11-20',
      createdBy: input.createdBy,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lines: [],
    };
    this.documents.set(id, document);
    return { document, transactions: [] };
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
  canCreateStocktake: false,
  canApproveStocktake: false,
  ...rights,
});

const clerk = actor('clerk', { canCreateStocktake: true });
const approver = actor('approver', { canApproveStocktake: true });
/** Vừa lập vừa có quyền duyệt (ví dụ ADMIN). */
const creatorApprover = actor('clerk', { canCreateStocktake: true, canApproveStocktake: true });

function session(patch: Partial<StocktakeSession> = {}): StocktakeSession {
  return {
    id: 'st-1',
    code: 'KK-2026-00001',
    title: 'Kiểm kê tháng 11',
    warehouseId: 'w1',
    warehouseCode: 'KHO-1',
    status: 'PENDING_APPROVAL',
    scopeType: 'ALL',
    totalItems: 2,
    countedItems: 2,
    differenceItems: 2,
    totalVarianceValue: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    createdBy: 'clerk',
    submittedBy: 'clerk',
    ...patch,
  };
}

function line(patch: Partial<StocktakeLine>): StocktakeLine {
  const systemQuantity = patch.systemQuantity ?? 10;
  const actualQuantity = patch.actualQuantity ?? systemQuantity;
  const difference = actualQuantity - systemQuantity;
  return {
    id: `line-${patch.materialCode}`,
    sessionId: 'st-1',
    materialId: `m-${patch.materialCode}`,
    materialCode: 'VT-A',
    materialName: 'Vật tư',
    unit: 'Cái',
    systemQuantity,
    actualQuantity,
    difference,
    unitCost: 1000,
    status: difference === 0 ? 'MATCHED' : difference > 0 ? 'SURPLUS' : 'DEFICIT',
    reason: difference === 0 ? undefined : 'Đếm lại thấy lệch',
    ...patch,
  };
}

async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; code: string; message: string };
  }
  throw new Error('expected rejection');
}

describe('StocktakeService duyệt và ghi sổ', () => {
  let stocktakes: FakeStocktakeStore;
  let documents: FakeStockDocumentStore;

  const service = (allowSelfApproval?: boolean) =>
    new StocktakeService(
      stocktakes as unknown as StocktakeStore,
      documents as unknown as StockDocumentStore,
      settingsStore(allowSelfApproval),
    );

  beforeEach(() => {
    stocktakes = new FakeStocktakeStore();
    documents = new FakeStockDocumentStore();
    stocktakes.sessions.set('st-1', session());
    stocktakes.lineMap.set('st-1', [
      line({ materialCode: 'VT-A', systemQuantity: 10, actualQuantity: 12 }),
      line({ materialCode: 'VT-B', systemQuantity: 5, actualQuantity: 4 }),
    ]);
  });

  it('duyệt cần quyền duyệt kiểm kê; đợt giữ Chờ duyệt', async () => {
    const error = await rejection(service().approve(clerk, 'st-1'));
    expect(error).toMatchObject({ statusCode: 403, code: 'ACCESS_DENIED' });
    expect(error.message).toBe('Bạn không có quyền duyệt và ghi sổ kiểm kê kho.');
    expect(stocktakes.sessions.get('st-1')?.status).toBe('PENDING_APPROVAL');
  });

  it('chặn người lập hoặc gửi duyệt tự duyệt khi cấu hình mặc định', async () => {
    const error = await rejection(service().approve(creatorApprover, 'st-1'));
    expect(error).toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(error.message).toContain('cần người khác duyệt');
    expect(stocktakes.sessions.get('st-1')?.status).toBe('PENDING_APPROVAL');

    // Chỉ người gửi duyệt là người duyệt cũng bị chặn.
    stocktakes.sessions.set('st-1', session({ createdBy: 'someone', submittedBy: 'clerk' }));
    expect(await rejection(service(false).approve(creatorApprover, 'st-1'))).toMatchObject({
      code: 'SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('allowSelfApproval=true cho người lập tự duyệt', async () => {
    const approved = await service(true).approve(creatorApprover, 'st-1');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('clerk');
  });

  it('người khác có quyền thì duyệt được', async () => {
    const approved = await service().approve(approver, 'st-1');
    expect(approved.status).toBe('APPROVED');
  });

  it('ghi sổ cần quyền duyệt kiểm kê', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    expect(await rejection(service().post(clerk, 'st-1'))).toMatchObject({ statusCode: 403 });
    expect(documents.posted).toHaveLength(0);
  });

  it('ghi sổ sinh một chứng từ ADJUSTMENT nguồn stocktake có khoá chống lặp', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    const result = await service().post(approver, 'st-1');
    expect(result.session.status).toBe('POSTED');
    expect(result.document?.id).toBe('doc-1');
    expect(documents.posted).toHaveLength(1);
    expect(documents.posted[0]).toMatchObject({
      docType: 'ADJUSTMENT',
      sourceType: 'stocktake',
      sourceId: 'st-1',
      idempotencyKey: 'stocktake:st-1',
      warehouseCode: 'KHO-1',
    });
    expect(documents.posted[0].lines.map((l) => [l.materialCode, l.quantity, l.direction])).toEqual([
      ['VT-A', 2, 'IN'],
      ['VT-B', 1, 'OUT'],
    ]);
  });

  it('ghi sổ lần hai trả kết quả cũ, không tạo thêm chứng từ', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    const first = await service().post(approver, 'st-1');
    const second = await service().post(approver, 'st-1');
    expect(documents.posted).toHaveLength(1);
    expect(stocktakes.markPostedCalls).toBe(1);
    expect(second.session).toEqual(first.session);
    expect(second.document?.id).toBe(first.document?.id);
  });

  it('người ghi sổ sau trong lúc tranh chấp thấy đợt đã ghi sổ thì không báo lỗi', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    const svc = service();
    // Người thứ nhất đã đọc đợt APPROVED; trước khi người đó đánh dấu, người thứ hai đã ghi sổ xong.
    const originalMark = stocktakes.markPosted.bind(stocktakes);
    let raced = false;
    stocktakes.markPosted = async (tenantId, key, input, check) => {
      if (!raced) {
        raced = true;
        stocktakes.sessions.set(key, session({ status: 'POSTED', documentId: 'doc-1' }));
      }
      return originalMark(tenantId, key, input, check);
    };
    const result = await svc.post(approver, 'st-1');
    expect(result.session.status).toBe('POSTED');
  });

  it('đợt không chênh lệch: ghi sổ không sinh chứng từ', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED', differenceItems: 0 }));
    stocktakes.lineMap.set('st-1', [
      line({ materialCode: 'VT-A', systemQuantity: 10, actualQuantity: 10 }),
      line({ materialCode: 'VT-B', systemQuantity: 5, actualQuantity: 5 }),
    ]);
    const result = await service().post(approver, 'st-1');
    expect(result.session.status).toBe('POSTED');
    expect(result.session.documentId).toBeUndefined();
    expect(result.document).toBeUndefined();
    expect(documents.posted).toHaveLength(0);
  });

  it('một dòng không dựng được chứng từ thì không ghi dòng nào, đợt giữ Đã duyệt', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    stocktakes.lineMap.set('st-1', [
      line({ materialCode: 'VT-A', systemQuantity: 10, actualQuantity: 12 }),
      // Hàng serial thiếu 1 nhưng không khai serial nào thiếu.
      line({ materialCode: 'VT-SR', systemQuantity: 3, actualQuantity: 2, isSerialized: true, serialAllocations: [] }),
    ]);
    const error = await rejection(service().post(approver, 'st-1'));
    expect(error).toMatchObject({ statusCode: 409, code: 'STOCKTAKE_SERIAL_MISMATCH' });
    expect(documents.posted).toHaveLength(0);
    expect(stocktakes.markPostedCalls).toBe(0);
    expect(stocktakes.sessions.get('st-1')?.status).toBe('APPROVED');
  });

  it('ghi sổ chứng từ lỗi (ví dụ âm tồn) thì đợt giữ Đã duyệt, gọi lại được sau khi sửa', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'APPROVED' }));
    documents.failWith = Object.assign(new Error('Tồn kho không đủ để xuất VT-B.'), { statusCode: 400 });
    await expect(service().post(approver, 'st-1')).rejects.toThrow('Tồn kho không đủ để xuất VT-B.');
    expect(documents.posted).toHaveLength(0);
    expect(stocktakes.markPostedCalls).toBe(0);
    expect(stocktakes.sessions.get('st-1')?.status).toBe('APPROVED');

    documents.failWith = undefined;
    const retried = await service().post(approver, 'st-1');
    expect(retried.session.status).toBe('POSTED');
    expect(documents.posted).toHaveLength(1);
  });

  it('chưa duyệt thì không ghi sổ được', async () => {
    expect(await rejection(service().post(approver, 'st-1'))).toMatchObject({
      statusCode: 409,
      code: 'INVALID_STOCKTAKE_TRANSITION',
    });
    expect(documents.posted).toHaveLength(0);
  });

  it('huỷ đợt bắt buộc lý do và lưu đúng lý do', async () => {
    stocktakes.sessions.set('st-1', session({ status: 'DRAFT' }));
    expect(await rejection(service().cancel(clerk, 'st-1', '   '))).toMatchObject({
      statusCode: 400,
      message: 'Phải ghi lý do huỷ đợt kiểm kê.',
    });
    const cancelled = await service().cancel(clerk, 'st-1', '  Sai phạm vi kho ');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Sai phạm vi kho' });
  });
});
