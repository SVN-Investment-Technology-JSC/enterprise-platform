import { SocialStorageQuotaExceededError } from '../domain/social.error.js';
import { HttpStorageQuota } from './http-storage-quota.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(respond: () => Response | Promise<Response>) {
  const fetcher = jest.fn(async (_input: string | URL | Request, _init?: RequestInit) => respond());
  const quota = new HttpStorageQuota({
    sharedApiUrl: 'http://shared.test/api/shared/',
    serviceToken: 'tok',
    fetcher: fetcher as unknown as typeof fetch,
  });
  return { quota, fetcher };
}

describe('HttpStorageQuota', () => {
  it('gọi đúng route nội bộ với token, tenant và dung lượng', async () => {
    const { quota, fetcher } = client(() => json({ allowed: true }));
    await expect(quota.ensureCapacity('t1', 1234)).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://shared.test/api/shared/v1/internal/storage/capacity-check');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'x-service-token': 'tok', 'x-tenant-id': 't1' });
    expect(JSON.parse(String(init?.body))).toEqual({ sizeBytes: 1234 });
  });

  it('ném lỗi 413 kèm thông báo của Hệ dùng chung khi vượt hạn mức', async () => {
    const { quota } = client(() => json({ allowed: false, message: 'Vượt hạn mức.' }));
    const error = await quota.ensureCapacity('t1', 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocialStorageQuotaExceededError);
    expect(error).toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED', statusCode: 413, message: 'Vượt hạn mức.' });
  });

  it('dùng thông báo mặc định khi Hệ dùng chung không kèm lời nhắn', async () => {
    const { quota } = client(() => json({ allowed: false }));
    await expect(quota.ensureCapacity('t1', 10)).rejects.toThrow(/hạn mức/);
  });

  it.each([
    ['5xx', () => json({}, 503)],
    ['401', () => json({}, 401)],
    ['dữ liệu lạ', () => json({ foo: 1 })],
    ['không phải JSON', () => new Response('<html>', { status: 200 })],
    ['lỗi mạng', () => Promise.reject(new Error('ECONNREFUSED'))],
  ])('cho qua khi %s', async (_name, respond) => {
    const { quota } = client(respond);
    await expect(quota.ensureCapacity('t1', 10)).resolves.toBeUndefined();
  });
});
