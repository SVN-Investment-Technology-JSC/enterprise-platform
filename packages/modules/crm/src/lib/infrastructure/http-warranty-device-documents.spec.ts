import { HttpWarrantyDeviceDocuments } from './http-warranty-device-documents.js';

describe('HttpWarrantyDeviceDocuments', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('gọi route nội bộ của Kho với x-service-token và đọc tài liệu', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'd1', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5, downloadUrl: 'https://s3/a', expiresInSeconds: 300, createdAt: 'x' }, { id: 'bad' }])),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await new HttpWarrantyDeviceDocuments('http://inv/api/inventory/', () => 'tok').list('t1', 'm1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://inv/api/inventory/v1/internal/materials/m1/documents');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'tok' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'd1', fileName: 'a.pdf', note: null });
  });

  it('Kho lỗi hoặc thiếu token thì ném lỗi', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 503 })) as unknown as typeof fetch;
    await expect(new HttpWarrantyDeviceDocuments('http://inv', () => 'tok').list('t1', 'm1')).rejects.toThrow();
    await expect(new HttpWarrantyDeviceDocuments('http://inv', () => undefined).list('t1', 'm1')).rejects.toThrow();
  });
});
