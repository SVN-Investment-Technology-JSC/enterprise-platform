import {
  approveAndPostStocktake,
  isSampleLot,
  loadLots,
  loadStocktakeLines,
  loadStocktakes,
  rejectStocktakeSession,
  snapshotStocktakeLines,
  stocktakeLinesToPost,
  trackingModeOf,
} from '@enterprise-platform/feature-inventory';

type Material = NonNullable<Parameters<typeof trackingModeOf>[0]> & { id: string; code: string; name: string; unit: string; purchasePrice?: number; currency?: string };
type StocktakeLine = Parameters<typeof stocktakeLinesToPost>[0][number];
type StocktakeSession = Awaited<ReturnType<typeof loadStocktakes>>[number];

const material = (patch: Partial<Material>) =>
  ({ id: 'm1', code: 'VT-01', name: 'Vật tư', unit: 'Cái', category: 'SPARE_PART', isSerialized: false, ...patch }) as never as Material;

const line = (patch: Partial<StocktakeLine>): StocktakeLine => ({
  id: 'l1',
  sessionId: 's1',
  materialId: 'm1',
  materialCode: 'VT-01',
  materialName: 'Vật tư',
  unit: 'Cái',
  systemQuantity: 10,
  difference: 0,
  status: 'UNCOUNTED',
  ...patch,
});

const session = (patch: Partial<StocktakeSession> = {}): StocktakeSession =>
  ({
    id: 's1',
    code: 'KK-2026-00001',
    title: 'Kiểm kê',
    warehouseId: 'w1',
    warehouseCode: 'KHO-1',
    status: 'PENDING_APPROVAL',
    scopeType: 'ALL',
    totalItems: 2,
    countedItems: 2,
    differenceItems: 2,
    totalVarianceValue: 0,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
    ...patch,
  }) as StocktakeSession;

describe('Cách định danh vật tư', () => {
  it('theo cấu hình vật tư, không theo mã', () => {
    expect(trackingModeOf(material({ isSerialized: true }))).toBe('SERIAL');
    expect(trackingModeOf(material({ category: 'CONSUMABLE' }))).toBe('LOT');
    expect(trackingModeOf(material({ code: 'VT-DAU-01' }))).toBe('NONE');
    expect(trackingModeOf(material({ code: 'CAP-02' }))).toBe('NONE');
    expect(trackingModeOf(undefined)).toBe('NONE');
  });
});

describe('Ảnh chụp tồn khi bắt đầu đếm', () => {
  const materials = [
    material({ id: 'm1', code: 'VT-01', purchasePrice: 120000 }),
    material({ id: 'm2', code: 'VT-DAU-02', category: 'CONSUMABLE' }),
    material({ id: 'm3', code: 'VT-03', purchasePrice: 50, currency: 'USD' }),
  ];
  const stock = [
    { materialId: 'm1', quantity: 5, warehouseCode: 'KHO-1' },
    { materialId: 'm2', quantity: 7, warehouseCode: 'KHO-1' },
    { materialId: 'm3', quantity: 1, warehouseCode: 'KHO-1' },
    { materialId: 'm1', quantity: 9, warehouseCode: 'KHO-2' },
    { materialId: 'm-khong-co', quantity: 3, warehouseCode: 'KHO-1' },
  ] as never;

  const lines = snapshotStocktakeLines('s1', 'KHO-1', { materials: materials as never, stock }, 'now');

  it('chỉ lấy tồn của đúng kho và vật tư có thật', () => {
    expect(lines.map((l) => [l.materialCode, l.systemQuantity])).toEqual([
      ['VT-01', 5],
      ['VT-DAU-02', 7],
      ['VT-03', 1],
    ]);
  });

  it('đơn giá là giá mua VND; chưa khai giá hoặc khác tiền tệ thì để trống', () => {
    expect(lines.map((l) => l.unitCost)).toEqual([120000, undefined, undefined]);
  });

  it('lô theo cấu hình vật tư', () => {
    expect(lines.map((l) => l.isLotTracked)).toEqual([false, true, false]);
  });
});

describe('Dòng cần ghi cân kho', () => {
  it('bỏ dòng chưa đếm, không lệch, hoặc đã ghi', () => {
    const picked = stocktakeLinesToPost([
      line({ id: 'a', actualQuantity: 8, difference: -2 }),
      line({ id: 'b', actualQuantity: 10, difference: 0 }),
      line({ id: 'c', difference: 0 }),
      line({ id: 'd', actualQuantity: 12, difference: 2, adjustmentTransactionCode: 'TX-1' }),
    ]);
    expect(picked.map((l) => l.id)).toEqual(['a']);
  });
});

describe('Dữ liệu mẫu đã lưu trên trình duyệt', () => {
  beforeEach(() => localStorage.clear());

  it('bỏ lô mẫu, giữ lô thật', async () => {
    const sample = { id: 'lot-VT-DAU-01-01', materialCode: 'VT-DAU-01', lotNumber: 'LOT-2026-Q1-A01' };
    const real = { id: 'lot-1', materialCode: 'VT-DAU-01', lotNumber: 'LOT-2026-Q1-A01' };
    expect(isSampleLot(sample as never)).toBe(true);
    expect(isSampleLot(real as never)).toBe(false);
    localStorage.setItem('ep:inventory:lot_tracking:VT-DAU-01', JSON.stringify([sample, real]));
    expect((await loadLots('VT-DAU-01')).map((lot) => lot.id)).toEqual(['lot-1']);
    expect(JSON.parse(localStorage.getItem('ep:inventory:lot_tracking:VT-DAU-01') ?? '[]')).toHaveLength(1);
  });

  it('không tự sinh lô cho vật tư chưa có lô', async () => {
    expect(await loadLots('VT-DAU-02')).toEqual([]);
  });

  it('bỏ đợt kiểm kê mẫu và dòng của chúng, không tự sinh đợt mới', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    localStorage.setItem(
      'ep:inventory:stocktakes',
      JSON.stringify([session({ id: 'st-2026-00018', code: 'KK-2026-00018' }), session({ id: 'st-123', code: 'KK-2026-00001' })]),
    );
    localStorage.setItem('ep:inventory:stocktake_lines:st-2026-00018', '[]');
    expect((await loadStocktakes()).map((s) => s.id)).toEqual(['st-123']);
    expect(localStorage.getItem('ep:inventory:stocktake_lines:st-2026-00018')).toBeNull();

    localStorage.clear();
    expect(await loadStocktakes()).toEqual([]);
  });
});

describe('Duyệt & ghi sổ', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  const seed = (lines: StocktakeLine[]) => {
    localStorage.setItem('ep:inventory:stocktakes', JSON.stringify([session()]));
    localStorage.setItem('ep:inventory:stocktake_lines:s1', JSON.stringify(lines));
  };

  const ledger = (fail: Set<string>) => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/receipts') || path.endsWith('/issues')) {
        const body = JSON.parse(String((init as RequestInit).body));
        calls.push(`${path.endsWith('/receipts') ? '+' : '-'}${body.materialCode}:${body.quantity}`);
        if (fail.has(body.materialCode)) {
          return { ok: false, status: 400, json: async () => ({ message: 'Không đủ tồn' }) } as Response;
        }
        return { ok: true, status: 201, json: async () => ({ transactionCode: `TX-${body.materialCode}` }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    return calls;
  };

  it('một dòng lỗi thì đợt vẫn chờ duyệt, lần sau chỉ ghi dòng còn thiếu', async () => {
    seed([
      line({ id: 'a', materialCode: 'A', actualQuantity: 12, difference: 2 }),
      line({ id: 'b', materialCode: 'B', actualQuantity: 7, difference: -3 }),
    ]);
    const first = ledger(new Set(['B']));
    await expect(approveAndPostStocktake('s1', 'Người duyệt')).rejects.toThrow(/Chưa ghi được 1\/2/);
    expect(first).toEqual(['+A:2', '-B:3']);
    expect((await loadStocktakes())[0].status).toBe('PENDING_APPROVAL');
    expect((await loadStocktakeLines('s1')).find((l) => l.id === 'a')?.adjustmentTransactionCode).toBe('TX-A');

    await expect(rejectStocktakeSession('s1')).rejects.toThrow(/ghi sổ một phần/);

    const second = ledger(new Set());
    const done = await approveAndPostStocktake('s1', 'Người duyệt');
    expect(second).toEqual(['-B:3']);
    expect(done.status).toBe('POSTED');
    expect(done.approvedBy).toBe('Người duyệt');
  });

  it('chỉ duyệt đợt đang chờ duyệt', async () => {
    localStorage.setItem('ep:inventory:stocktakes', JSON.stringify([session({ status: 'COUNTING' })]));
    ledger(new Set());
    await expect(approveAndPostStocktake('s1')).rejects.toThrow(/đang chờ duyệt/);
  });
});
