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
              salePrice: '1500000.00',
              tradeCategory: 'Mạng',
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
      salePrice: 1_500_000,
      tradeCategory: 'Mạng',
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

  it('đồng bộ bảng giá: dấu vân tay và trang danh mục gồm cả mặt hàng ngừng dùng', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2, fingerprint: 'abc' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            materials: [
              { id: CAP, code: 'M1', name: 'Cáp', unit: 'Cái', kind: 'STOCK', salePrice: null, isActive: false },
              { id: '22222222-2222-4222-8222-222222222222', code: 'M7', name: 'Không ĐVT', unit: null, isActive: true },
            ],
            nextCursor: 'M7',
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    const reader = new HttpInventoryCatalogReader('http://inv/api/inventory', () => 'token');

    await expect(reader.catalogFingerprint('t1', ['STOCK', 'SERVICE'])).resolves.toEqual({ count: 2, fingerprint: 'abc' });
    const fingerprintUrl = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(fingerprintUrl.pathname).toBe('/api/inventory/v1/internal/materials/fingerprint');
    expect(fingerprintUrl.searchParams.get('kind')).toBe('STOCK,SERVICE');

    const page = await reader.catalogPage('t1', { kinds: ['STOCK', 'SERVICE'], cursor: 'M0', limit: 500, includeInactive: true });
    expect(page.nextCursor).toBe('M7');
    expect(page.materials).toEqual([
      expect.objectContaining({ id: CAP, code: 'M1', unit: 'Cái', salePrice: null, isActive: false }),
      expect.objectContaining({ code: 'M7', unit: null, isActive: true }),
    ]);
    const pageUrl = new URL((fetchMock.mock.calls[1] as [string])[0]);
    expect(Object.fromEntries(pageUrl.searchParams)).toEqual({
      kind: 'STOCK,SERVICE',
      limit: '500',
      cursor: 'M0',
      includeInactive: 'true',
    });
  });

  it('dấu vân tay thiếu trường hoặc Kho lỗi thì 503', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ count: 1 }), { status: 200 })) as unknown as typeof fetch;
    await expect(new HttpInventoryCatalogReader('http://inv', () => 'token').catalogFingerprint('t1', [])).rejects.toMatchObject({
      statusCode: 503,
    });
    global.fetch = jest.fn().mockResolvedValue(new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(
      new HttpInventoryCatalogReader('http://inv', () => 'token').catalogPage('t1', {
        kinds: [],
        cursor: null,
        limit: 500,
        includeInactive: true,
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
