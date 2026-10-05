import {
  fetchPublishedProcedureDefinition,
  isProcedureReachable,
} from './hrm-procedure-api';

const json = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('API nội bộ Procedure cho HRM', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'token';
    process.env.PROCEDURE_API_URL = 'http://pe/api/procedure';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('đọc định nghĩa đã công bố bằng service token và tenant', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(json(200, { id: 'd1', steps: [] }));
    global.fetch = fetchMock;
    const definition = await fetchPublishedProcedureDefinition('t1', 'd1');
    expect(definition.id).toBe('d1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pe/api/procedure/v1/internal/definitions/d1');
    expect(init.headers).toEqual({
      'x-tenant-id': 't1',
      'x-service-token': 'token',
    });
  });

  it.each([403, 401, 502, 503])(
    'trả 409 PROCEDURE_UNAVAILABLE khi Procedure trả %s',
    async (status) => {
      global.fetch = jest.fn().mockResolvedValue(json(status));
      await expect(
        fetchPublishedProcedureDefinition('t1', 'd1'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'PROCEDURE_UNAVAILABLE' },
      });
    },
  );

  it('trả 409 PROCEDURE_UNAVAILABLE khi mất kết nối', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      fetchPublishedProcedureDefinition('t1', 'd1'),
    ).rejects.toMatchObject({ response: { code: 'PROCEDURE_UNAVAILABLE' } });
  });

  it('định nghĩa chưa công bố là 409 thường, không phải không khả dụng', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(404));
    await expect(
      fetchPublishedProcedureDefinition('t1', 'd1'),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Quy trình chưa có phiên bản công bố',
    });
  });

  it('isProcedureReachable: true khi 200, false khi tắt entitlement hoặc lỗi mạng', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(200, { ok: true }));
    await expect(isProcedureReachable('t1')).resolves.toBe(true);
    global.fetch = jest.fn().mockResolvedValue(json(403));
    await expect(isProcedureReachable('t1')).resolves.toBe(false);
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(isProcedureReachable('t1')).resolves.toBe(false);
  });
});
