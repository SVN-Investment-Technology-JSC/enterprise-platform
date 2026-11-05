import { HttpInventoryClient } from './http-inventory-client.js';

describe('HttpInventoryClient (giữ hàng, yêu cầu xuất qua API nội bộ của Kho)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const reply = (status: number, body: unknown) => jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('giữ hàng: gửi khoá chống lặp, nguồn, hạn, từng dòng theo kho; đọc id, mã, trạng thái', async () => {
    const fetchMock = reply(200, { id: 'r-id', reservationCode: 'GH001', status: 'RESERVED', expiresAt: '2026-11-03T16:59:59.000Z' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new HttpInventoryClient('http://inv/api/inventory/', () => 'token');
    const reserved = await client.reserve('t1', {
      idempotencyKey: 'crm-order:o1',
      sourceType: 'crm_order',
      sourceId: 'o1',
      expiresAt: '2026-11-03T16:59:59.000Z',
      lines: [{ materialCode: 'CAP', warehouseCode: 'KHO-1', quantity: 10 }],
    });
    expect(reserved).toEqual({ reservationId: 'r-id', reservationCode: 'GH001', status: 'RESERVED', expiresAt: '2026-11-03T16:59:59.000Z' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://inv/api/inventory/v1/internal/reservations');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'token' });
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'crm-order:o1',
      sourceType: 'crm_order',
      sourceId: 'o1',
      expiresAt: '2026-11-03T16:59:59.000Z',
      items: [{ materialCode: 'CAP', warehouseCode: 'KHO-1', quantityReserved: 10 }],
    });
  });

  it('thiếu tồn: giữ mã, thông điệp và danh sách dòng thiếu của Kho (409)', async () => {
    global.fetch = reply(409, {
      code: 'RESERVATION_INSUFFICIENT_STOCK',
      message: 'Không đủ tồn khả dụng để giữ hàng.',
      shortages: [{ materialCode: 'CAP', warehouseCode: 'KHO-1', requested: 10, available: 5 }],
    }) as unknown as typeof fetch;
    const client = new HttpInventoryClient('http://inv', () => 'token');
    await expect(
      client.reserve('t1', { idempotencyKey: 'k', sourceType: 'crm_order', sourceId: 'o', expiresAt: 'x', lines: [] }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'RESERVATION_INSUFFICIENT_STOCK', details: { shortages: [expect.objectContaining({ available: 5 })] } });
  });

  it('lỗi hạ tầng, 5xx, thiếu token thành 503', async () => {
    global.fetch = reply(502, {}) as unknown as typeof fetch;
    await expect(new HttpInventoryClient('http://inv', () => 'token').release('t1', 'GH001')).rejects.toMatchObject({ statusCode: 503 });
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(new HttpInventoryClient('http://inv', () => 'token').release('t1', 'GH001')).rejects.toMatchObject({ code: 'INVENTORY_UNAVAILABLE' });
    await expect(new HttpInventoryClient('http://inv', () => undefined).release('t1', 'GH001')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('yêu cầu xuất: loại ISSUE_SALES, đọc id và mã chứng từ nháp', async () => {
    const fetchMock = reply(200, { documentId: 'd1', documentCode: 'PX001', docType: 'ISSUE_SALES', status: 'DRAFT' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await new HttpInventoryClient('http://inv', () => 'token').createIssueRequest('t1', {
      idempotencyKey: 'crm-delivery:d',
      warehouseCode: 'KHO-1',
      sourceType: 'crm_delivery',
      sourceId: 'd',
      lines: [{ materialCode: 'CAP', quantity: 4, reservationId: 'r-id' }],
    });
    expect(result).toEqual({ documentId: 'd1', documentCode: 'PX001', status: 'DRAFT' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://inv/v1/internal/issue-requests');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ docType: 'ISSUE_SALES', sourceType: 'crm_delivery' });
  });
});
