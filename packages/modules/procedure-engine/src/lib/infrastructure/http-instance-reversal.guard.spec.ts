import { AUTO_COMPLETE_SOURCE_TYPES, REVERSAL_GUARDED_SOURCE_TYPES } from '../application/procedure-engine.application.js';
import { HttpInstanceReversalGuard } from './http-instance-reversal.guard.js';

describe('nguồn Bán hàng (crm_quote, crm_order_credit)', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env['INTERNAL_SERVICE_TOKEN'];

  beforeEach(() => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'service-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
    else process.env['INTERNAL_SERVICE_TOKEN'] = originalToken;
  });

  it('được tự hoàn thành bước S và phải hỏi trước khi huỷ hiệu lực', () => {
    for (const sourceType of ['crm_quote', 'crm_order_credit']) {
      expect(AUTO_COMPLETE_SOURCE_TYPES).toContain(sourceType);
      expect(REVERSAL_GUARDED_SOURCE_TYPES).toContain(sourceType);
    }
  });

  it('hỏi Bán hàng theo id lần gửi duyệt ở CRM_API_URL, chuyển tiếp câu trả lời chặn', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ allowed: false, reason: 'Báo giá BG2600001 đã chuyển thành hợp đồng.' }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const guard = new HttpInstanceReversalGuard('http://hrm', 'http://finance', 'http://crm/api/crm');

    const result = await guard.check('tenant-1', { sourceType: 'crm_quote', sourceId: 'link-1' });

    expect(result).toEqual({ allowed: false, reason: 'Báo giá BG2600001 đã chuyển thành hợp đồng.' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://crm/api/crm/v1/internal/instances/link-1/reversal-check');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 'tenant-1', 'x-service-token': 'service-token' });
  });

  it('Bán hàng không trả lời: không cho huỷ', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const guard = new HttpInstanceReversalGuard('http://hrm', 'http://finance', 'http://crm/api/crm');
    const result = await guard.check('tenant-1', { sourceType: 'crm_order_credit', sourceId: 'link-2' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('CRM');
  });
});
