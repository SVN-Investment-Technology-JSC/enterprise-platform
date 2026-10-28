import { HttpInventoryCatalogReader } from './http-inventory-catalog-reader.js';

const CAP = '11111111-1111-4111-8111-111111111111';

describe('HttpInventoryCatalogReader (TC-QUO-01)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('gọi API nội bộ của Kho với token dịch vụ, gồm cả dịch vụ; đọc tồn khả dụng và giá vốn', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          materials: [
            {
              id: CAP.toUpperCase(),
              code: 'QA-KHO-CAP',
              name: 'Cáp',
              unit: 'Cái',
              kind: 'STOCK',
              category: 'Thiết bị',
              avgCost: '800000.0000',
              totalAvailable: 70,
              availableByWarehouse: [{ warehouseId: 'w1', warehouseCode: 'KHO-1', available: 70, avgCost: 800000 }],
              warrantyMonths: 12,
            },
            { id: 'x', code: '' },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const reader = new HttpInventoryCatalogReader('http://inv/api/inventory/', () => 'token');

    const known = await reader.materials('t1', [CAP]);

    expect(known.get(CAP)).toEqual({
      id: CAP,
      code: 'QA-KHO-CAP',
      name: 'Cáp',
      unit: 'Cái',
      kind: 'STOCK',
      category: 'Thiết bị',
      avgCost: 800_000,
      totalAvailable: 70,
      availableByWarehouse: [{ warehouseId: 'w1', warehouseCode: 'KHO-1', available: 70 }],
      warrantyMonths: 12,
    });
    expect(known.size).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/inventory/v1/internal/materials');
    expect(parsed.searchParams.get('ids')).toBe(CAP);
    expect(parsed.searchParams.get('kind')).toBe('STOCK,SERVICE');
    expect(init.headers).toEqual({ 'x-tenant-id': 't1', 'x-service-token': 'token' });
  });

  it('Kho lỗi hoặc thiếu token: 503', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 502 })) as unknown as typeof fetch;
    await expect(new HttpInventoryCatalogReader('http://inv', () => 'token').search('t1', 'cap', 30)).rejects.toMatchObject({
      statusCode: 503,
      code: 'INVENTORY_UNAVAILABLE',
    });
    await expect(new HttpInventoryCatalogReader('http://inv', () => undefined).search('t1', 'cap', 30)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('TC-ORD-04: danh sách kho qua GET /v1/internal/warehouses (search, codes); bỏ dòng thiếu mã', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          warehouses: [
            { id: 'w1', code: 'KHO-1', name: 'Kho Hà Nội', isActive: true },
            { id: 'w2', code: 'KHO-2', name: 'Kho cũ', isActive: false },
            { id: 'w3', code: '' },
          ],
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const reader = new HttpInventoryCatalogReader('http://inv/api/inventory', () => 'token');
    await expect(reader.warehouses('t1', { search: ' ha ', codes: ['KHO-1', 'KHO-2'] })).resolves.toEqual([
      { id: 'w1', code: 'KHO-1', name: 'Kho Hà Nội', isActive: true },
      { id: 'w2', code: 'KHO-2', name: 'Kho cũ', isActive: false },
    ]);
    const parsed = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(parsed.pathname).toBe('/api/inventory/v1/internal/warehouses');
    expect(parsed.searchParams.get('search')).toBe('ha');
    expect(parsed.searchParams.get('codes')).toBe('KHO-1,KHO-2');
  });
});
