import { HttpCrmCustomerDirectory } from './http-crm-customer-directory.js';

const TENANT = 't1';

function response(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('HttpCrmCustomerDirectory', () => {
  const previous = process.env['INTERNAL_SERVICE_TOKEN'];
  beforeEach(() => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'secret';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
    else process.env['INTERNAL_SERVICE_TOKEN'] = previous;
  });

  it('hỏi Platform tenant có bật crm, giữ kết quả 30 giây', async () => {
    let now = 0;
    const fetcher = jest.fn().mockResolvedValue(response(200, { database: {} }));
    const directory = new HttpCrmCustomerDirectory('http://crm', 'http://platform/tenant-databases', fetcher, () => now);
    await expect(directory.enabled(TENANT)).resolves.toBe(true);
    await expect(directory.enabled(TENANT)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('http://platform/tenant-databases/t1?moduleKey=crm');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'x-service-token': 'secret' });
    now = 31_000;
    await directory.enabled(TENANT);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('403 MODULE_NOT_ENTITLED là chưa bật; Platform lỗi hay chưa cấu hình token thì coi như chưa bật, không cache', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(response(403, { code: 'MODULE_NOT_ENTITLED' }))
      .mockResolvedValueOnce(response(500))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(response(200));
    await expect(new HttpCrmCustomerDirectory('http://crm', 'http://p', fetcher).enabled(TENANT)).resolves.toBe(false);
    const flaky = new HttpCrmCustomerDirectory('http://crm', 'http://p', fetcher);
    await expect(flaky.enabled(TENANT)).resolves.toBe(false);
    await expect(flaky.enabled(TENANT)).resolves.toBe(false);
    await expect(flaky.enabled(TENANT)).resolves.toBe(true);
    delete process.env['INTERNAL_SERVICE_TOKEN'];
    await expect(new HttpCrmCustomerDirectory('http://crm', 'http://p', fetcher).enabled(TENANT)).resolves.toBe(false);
  });

  it('tra khách qua /v1/internal/customers bằng service token; Bán hàng lỗi thì 503', async () => {
    const item = { id: 'c1', code: 'KH1', name: 'A', taxCode: null, version: 1 };
    const fetcher = jest.fn().mockResolvedValueOnce(response(200, { items: [item] })).mockResolvedValueOnce(response(502));
    const directory = new HttpCrmCustomerDirectory('http://crm', 'http://p', fetcher);
    await expect(directory.lookup(TENANT, { search: 'a b', ids: ['c1', 'c2'], limit: 5 })).resolves.toEqual([item]);
    expect(fetcher.mock.calls[0][0]).toBe('http://crm/v1/internal/customers?search=a+b&ids=c1%2Cc2&limit=5');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'x-tenant-id': 't1', 'x-service-token': 'secret' });
    await expect(directory.lookup(TENANT, {})).rejects.toMatchObject({ statusCode: 503, code: 'CRM_UNAVAILABLE' });
  });
});
