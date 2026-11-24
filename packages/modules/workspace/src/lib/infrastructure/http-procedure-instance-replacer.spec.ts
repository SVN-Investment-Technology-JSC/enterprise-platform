import { HttpProcedureInstanceReplacer } from './http-procedure-instance-replacer.js';

const INPUT = {
  workItemId: 'w 1',
  expectedInstanceId: 'inst-old',
  definitionId: 'def-new',
  requestedBy: 'u1',
  requestedByName: 'Người A',
  requestedByIsTenantAdmin: false,
  workItemCode: 'CV-1',
  workItemTitle: 'Việc',
  projectCode: 'DA-1',
};

describe('HttpProcedureInstanceReplacer', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env['INTERNAL_SERVICE_TOKEN'];

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
    else process.env['INTERNAL_SERVICE_TOKEN'] = originalToken;
  });

  function mockFetch(status: number, body: unknown) {
    const fetchMock = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('POST tới route nội bộ kèm service token, tenant và body (không lặp workItemId)', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    const reply = {
      ok: true,
      instance: { id: 'i2', code: 'HS-2', title: 'T', status: 'running', definitionId: 'def-new' },
      previous: { id: 'inst-old', code: 'HS-1' },
    };
    const fetchMock = mockFetch(200, reply);
    const result = await new HttpProcedureInstanceReplacer('http://proc/api/procedure').replace('t1', INPUT);
    expect(result).toEqual(reply);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://proc/api/procedure/v1/internal/workspace/work-items/w%201/replace-instance');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'tok' });
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ expectedInstanceId: 'inst-old', definitionId: 'def-new', projectCode: 'DA-1' });
    expect(sent.workItemId).toBeUndefined();
  });

  it('ok:false được trả nguyên lý do', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(200, { ok: false, reason: 'Hồ sơ đã được xử lý.' });
    await expect(new HttpProcedureInstanceReplacer('http://p').replace('t1', INPUT)).resolves.toEqual({
      ok: false,
      reason: 'Hồ sơ đã được xử lý.',
    });
  });

  it('5xx hoặc thiếu token là lỗi hạ tầng, ném ra', async () => {
    process.env['INTERNAL_SERVICE_TOKEN'] = 'tok';
    mockFetch(503, {});
    await expect(new HttpProcedureInstanceReplacer('http://p').replace('t1', INPUT)).rejects.toThrow('503');
    delete process.env['INTERNAL_SERVICE_TOKEN'];
    await expect(new HttpProcedureInstanceReplacer('http://p').replace('t1', INPUT)).rejects.toThrow(
      'Chưa cấu hình',
    );
  });
});
