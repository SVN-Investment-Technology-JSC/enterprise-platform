import { DEFAULT_PROCEDURE_ENGINE_SETTINGS } from '../application/workspace-link-settings.js';
import { HttpWorkspaceLinkSettingsReader } from './http-workspace-link-settings.reader.js';

describe('HttpWorkspaceLinkSettingsReader', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env['INTERNAL_SERVICE_TOKEN'];
  let clock = 1_000_000;
  const warn = jest.fn();
  const reader = () => new HttpWorkspaceLinkSettingsReader('http://ws/api/workspace/', () => clock, warn);
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  beforeEach(() => {
    clock = 1_000_000;
    warn.mockReset();
    process.env['INTERNAL_SERVICE_TOKEN'] = 'service-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env['INTERNAL_SERVICE_TOKEN'];
    else process.env['INTERNAL_SERVICE_TOKEN'] = originalToken;
  });

  it('gọi route nội bộ với tenant và service token, chuẩn hoá giá trị lạ về mặc định', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok({ engineChangeWho: 'admin_only', engineReverseWho: 'bogus' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await reader().get('t1');

    expect(result.engineChangeWho).toBe('admin_only');
    expect(result.engineReverseWho).toBe(DEFAULT_PROCEDURE_ENGINE_SETTINGS.engineReverseWho);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ws/api/workspace/v1/internal/procedure-link-settings');
    expect(init.headers).toMatchObject({ 'x-tenant-id': 't1', 'x-service-token': 'service-token' });
    expect(init.redirect).toBe('error');
  });

  it('cache 30 giây theo tenant rồi đọc lại', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => ok({ engineChangeWho: 'admin_only' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = reader();

    await r.get('t1');
    clock += 29_000;
    await r.get('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await r.get('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock += 2_000;
    await r.get('t1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gom các lời gọi đồng thời thành một', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => ok({}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = reader();

    await Promise.all([r.get('t1'), r.get('t1'), r.get('t1')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lỗi mạng và chưa có cache: trả mặc định, không ném, cảnh báo một lần mỗi phút', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const r = reader();

    expect(await r.get('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
    clock += 6_000;
    expect(await r.get('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await r.get('t1');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('lỗi mạng sau khi đã có cache: trả giá trị cũ (stale-if-error)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(ok({ engineAttachmentMirror: 'none' }))
      .mockRejectedValue(new Error('timeout'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = reader();

    expect((await r.get('t1')).engineAttachmentMirror).toBe('none');
    clock += 31_000;
    expect((await r.get('t1')).engineAttachmentMirror).toBe('none');
  });

  it('HTTP lỗi hoặc JSON sai: dùng mặc định', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(new Response('x', { status: 503 })) as unknown as typeof fetch;
    expect(await reader().get('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);

    global.fetch = jest.fn().mockResolvedValueOnce(new Response('khong-phai-json', { status: 200 })) as unknown as typeof fetch;
    expect(await reader().get('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
  });
});
