import type { StocktakeLine, StocktakeSession } from '@enterprise-platform/contracts-inventory';
import { InsufficientStockError, StocktakeNotFoundError } from '../domain/inventory.error.js';
import {
  planStocktakeAdjustments,
  stocktakeDifference,
  stocktakeLineStatus,
} from '../domain/stocktake.domain.js';
import type { InventoryActor } from './inventory.application.js';
import type {
  CreateStocktakeInput,
  InventoryStore,
  StocktakeAdjustmentInput,
  StocktakeLinePatch,
  StocktakeTx,
} from './inventory-store.port.js';
import { StocktakeService } from './stocktake.service.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';

const manager: InventoryActor = {
  tenantId: 't1',
  userId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Quản lý kho',
  canManage: true,
};
const counter: InventoryActor = { ...manager, canManage: false, canCreateStocktake: true, canApproveStocktake: false };
const approver: InventoryActor = { ...manager, canManage: false, canCreateStocktake: false, canApproveStocktake: true };
const reader: InventoryActor = { ...manager, canManage: false, canWriteTransactions: true };

interface LedgerEntry {
  materialCode: string;
  delta: number;
  referenceId: string;
}

/**
 * Kho giả có ngữ nghĩa transaction: withSession tuần tự hoá theo khoá (như
 * SELECT ... FOR UPDATE) và hoàn tác toàn bộ trạng thái khi operation ném lỗi.
 */
function fakeStore(onHand: Record<string, number>) {
  const state = {
    sessions: new Map<string, StocktakeSession>(),
    lines: new Map<string, StocktakeLine[]>(),
    balance: { ...onHand },
    ledger: [] as LedgerEntry[],
    audits: [] as unknown[],
  };
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const clone = <T>(v: T): T => structuredClone(v);

  const store = {
    stocktake: {
      list: async () => [...state.sessions.values()],
      get: async (_t: string, id: string) => {
        const s = state.sessions.get(id);
        return s ? { ...s, lines: clone(state.lines.get(id) ?? []) } : null;
      },
      create: async (_t: string, input: CreateStocktakeInput) => {
        const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
        const codes = Object.keys(state.balance);
        const lines: StocktakeLine[] = codes.map((code, i) => ({
          id: `10000000-0000-4000-8000-${String(seq * 100 + i).padStart(12, '0')}`,
          sessionId: id,
          materialId: code,
          materialCode: code,
          materialName: code,
          unit: 'Cái',
          systemQuantity: state.balance[code],
          difference: 0,
          status: 'UNCOUNTED',
        }));
        const session = {
          id, code: `KK-2026-0000${seq}`, title: input.title, warehouseId: 'w', warehouseCode: input.warehouseCode,
          status: 'COUNTING', scopeType: input.scopeType, snapshotAt: new Date().toISOString(),
          totalItems: lines.length, countedItems: 0, differenceItems: 0, totalVarianceValue: 0,
          createdAt: '', updatedAt: '',
        } as StocktakeSession;
        state.sessions.set(id, session);
        state.lines.set(id, lines);
        return { ...session, lines };
      },
      withSession: async <T>(_t: string, id: string, op: (tx: StocktakeTx) => Promise<T>): Promise<T> => {
        const run = async (): Promise<T> => {
          const base = state.sessions.get(id);
          if (!base) throw new StocktakeNotFoundError();
          const backup = clone({ s: [...state.sessions], l: [...state.lines], b: state.balance, g: state.ledger, a: state.audits });
          const tx: StocktakeTx = {
            session: clone(base),
            lines: async () => clone(state.lines.get(id) ?? []),
            updateLine: async (lineId: string, patch: StocktakeLinePatch) => {
              const list = state.lines.get(id) ?? [];
              const i = list.findIndex((l) => l.id === lineId);
              const prev = list[i];
              const actual = patch.actualQuantity ?? prev.actualQuantity;
              list[i] = {
                ...prev,
                actualQuantity: actual,
                reason: patch.reason ?? prev.reason,
                status: patch.status,
                difference: actual === undefined ? 0 : stocktakeDifference(prev.systemQuantity, actual),
              };
              if (patch.audit) state.audits.push(patch.audit);
            },
            setStatus: async (patch) => {
              state.sessions.set(id, { ...state.sessions.get(id)!, ...patch } as StocktakeSession);
            },
            postAdjustment: async (input: StocktakeAdjustmentInput) => {
              const next = (state.balance[input.materialCode] ?? 0) + input.delta;
              if (next < 0) {
                throw new InsufficientStockError(input.materialCode, -input.delta, state.balance[input.materialCode] ?? 0);
              }
              state.balance[input.materialCode] = next;
              state.ledger.push({ materialCode: input.materialCode, delta: input.delta, referenceId: id });
            },
          };
          try {
            return await op(tx);
          } catch (error) {
            state.sessions = new Map(backup.s);
            state.lines = new Map(backup.l);
            state.balance = backup.b;
            state.ledger = backup.g;
            state.audits = backup.a;
            throw error;
          }
        };
        const result = chain.then(run, run);
        chain = result.catch(() => undefined);
        return result;
      },
    },
  };
  return { service: new StocktakeService(store as unknown as InventoryStore), state };
}

async function prepare(onHand: Record<string, number>) {
  const ctx = fakeStore(onHand);
  const created = await ctx.service.create(manager, {
    title: 'Kiểm kê quý', warehouseCode: 'wh-1', scopeType: 'ALL',
  });
  return { ...ctx, id: created.id, lines: created.lines as StocktakeLine[] };
}

const count = (lineId: string, actualQuantity: number, reason?: string) => ({ lineId, actualQuantity, reason });

describe('stocktake domain', () => {
  it('phân loại dòng thừa, thiếu, khớp và chưa đếm', () => {
    expect(stocktakeLineStatus(10, undefined)).toBe('UNCOUNTED');
    expect(stocktakeLineStatus(10, 10)).toBe('MATCHED');
    expect(stocktakeLineStatus(10, 12)).toBe('SURPLUS');
    expect(stocktakeLineStatus(10, 7)).toBe('DEFICIT');
  });

  it('chỉ lập bút toán cho dòng có chênh lệch khác 0', () => {
    const plans = planStocktakeAdjustments([
      { id: 'a', materialCode: 'A', systemQuantity: 10, actualQuantity: 12, reason: 'Thừa' },
      { id: 'b', materialCode: 'B', systemQuantity: 5, actualQuantity: 5 },
      { id: 'c', materialCode: 'C', systemQuantity: 4, actualQuantity: 1 },
      { id: 'd', materialCode: 'D', systemQuantity: 4 },
    ] as never);
    expect(plans.map((p) => [p.materialCode, p.delta])).toEqual([['A', 2], ['C', -3]]);
  });
});

describe('StocktakeService', () => {
  it('chốt snapshot tồn sổ sách khi tạo đợt và để ở trạng thái đang đếm', async () => {
    const { lines, state, id } = await prepare({ A: 10, B: 5 });
    expect(state.sessions.get(id)?.status).toBe('COUNTING');
    expect(lines.map((l) => [l.materialCode, l.systemQuantity])).toEqual([['A', 10], ['B', 5]]);
  });

  it('từ chối đầu vào sai bằng lỗi 400 tiếng Việt', async () => {
    const { service, id, lines } = await prepare({ A: 1 });
    await expect(service.create(manager, { title: ' ', warehouseCode: 'W', scopeType: 'ALL' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Tên đợt kiểm kê không được để trống.' });
    await expect(service.create(manager, { title: 'x', warehouseCode: 'W', scopeType: 'CATEGORY', scopeCategories: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateItems(manager, id, { items: [count(lines[0].id, -1)] }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Số thực đếm không được âm.' });
    await expect(service.updateItems(manager, id, { items: [count(lines[0].id, Number.NaN)] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateItems(manager, id, { items: [count('khong-phai-uuid', 1)] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updateItems(manager, id, { items: [count(UUID_A, 1)] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.get(manager, 'abc')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('ghi sổ chênh lệch dương, âm và bỏ qua dòng bằng 0 trong cùng một lần duyệt', async () => {
    const { service, state, id, lines } = await prepare({ A: 10, B: 5, C: 4 });
    await service.updateItems(counter, id, {
      items: [count(lines[0].id, 12, 'Tìm thấy thêm'), count(lines[1].id, 5), count(lines[2].id, 1, 'Mất')],
    });
    await service.submit(counter, id);
    const posted = await service.approve(approver, id);

    expect(posted.status).toBe('POSTED');
    expect(state.balance).toEqual({ A: 12, B: 5, C: 1 });
    expect(state.ledger).toEqual([
      { materialCode: 'A', delta: 2, referenceId: id },
      { materialCode: 'C', delta: -3, referenceId: id },
    ]);
    expect(state.audits).toHaveLength(3);
  });

  it('duyệt lần hai (tuần tự hoặc song song) không sinh bút toán lần nữa', async () => {
    const { service, state, id, lines } = await prepare({ A: 10 });
    await service.updateItems(counter, id, { items: [count(lines[0].id, 15, 'Thừa')] });
    await service.submit(counter, id);

    const results = await Promise.allSettled([service.approve(approver, id), service.approve(approver, id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ statusCode: 409 });
    await expect(service.approve(approver, id)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.ledger).toHaveLength(1);
    expect(state.balance.A).toBe(15);
  });

  it('hoàn tác toàn bộ khi một dòng làm tồn âm: không ghi sổ nửa chừng, đợt vẫn chờ duyệt', async () => {
    const { service, state, id, lines } = await prepare({ A: 10, B: 5 });
    await service.updateItems(counter, id, { items: [count(lines[0].id, 12, 'Thừa'), count(lines[1].id, 0, 'Mất hết')] });
    await service.submit(counter, id);
    // Hàng B bị xuất ra sau snapshot nên không còn đủ để trừ.
    state.balance.B = 2;
    await expect(service.approve(approver, id)).rejects.toMatchObject({ statusCode: 400 });
    expect(state.ledger).toHaveLength(0);
    expect(state.balance).toEqual({ A: 10, B: 2 });
    expect(state.sessions.get(id)?.status).toBe('PENDING_APPROVAL');
  });

  it('chỉ cho sửa số đếm khi đang đếm và bắt buộc có lý do khi gửi duyệt', async () => {
    const { service, id, lines } = await prepare({ A: 10 });
    await service.updateItems(counter, id, { items: [count(lines[0].id, 8)] });
    await expect(service.submit(counter, id)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Vật tư A có chênh lệch nhưng chưa ghi lý do.',
    });
    await service.updateItems(counter, id, { items: [count(lines[0].id, 8, 'Hỏng')] });
    await service.submit(counter, id);
    await expect(service.updateItems(counter, id, { items: [count(lines[0].id, 9)] }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('huỷ đợt rồi không duyệt được; trả lại đợt chờ duyệt về đang đếm', async () => {
    const a = await prepare({ A: 10 });
    await a.service.cancel(counter, a.id, 'Nhầm kho');
    expect(a.state.sessions.get(a.id)?.status).toBe('CANCELLED');
    await expect(a.service.approve(approver, a.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(a.service.cancel(counter, a.id)).rejects.toMatchObject({ statusCode: 409 });

    const b = await prepare({ A: 10 });
    await b.service.updateItems(counter, b.id, { items: [count(b.lines[0].id, 10)] });
    await b.service.submit(counter, b.id);
    await b.service.reject(approver, b.id, 'Đếm lại');
    expect(b.state.sessions.get(b.id)?.status).toBe('COUNTING');
  });

  it('phân quyền: tạo/nhập cần quyền create, duyệt cần quyền approve, manage có cả hai', async () => {
    const { service, id, lines } = await prepare({ A: 10 });
    const req = { title: 'x', warehouseCode: 'W', scopeType: 'ALL' as const };
    await expect(service.create(reader, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(approver, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.updateItems(approver, id, { items: [count(lines[0].id, 1)] })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(counter, req)).resolves.toBeDefined();

    await service.updateItems(counter, id, { items: [count(lines[0].id, 10)] });
    await service.submit(counter, id);
    await expect(service.approve(counter, id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.reject(reader, id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.approve(manager, id)).resolves.toMatchObject({ status: 'POSTED' });
  });
});
