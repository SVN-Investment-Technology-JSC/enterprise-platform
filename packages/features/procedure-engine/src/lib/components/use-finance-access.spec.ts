/** @jest-environment jsdom */
import { financeAccessFromStatus, loadFinanceAccess, resetFinanceAccessCache } from './use-finance-access';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  resetFinanceAccessCache();
});

const reply = (status: number) => jest.fn(async () => ({ status }) as Response);

describe('financeAccessFromStatus', () => {
  it('2xx là có quyền; 401, 403, 404 là không dùng được; lỗi tạm thời thì chưa kết luận', () => {
    expect(financeAccessFromStatus(200)).toBe('allowed');
    expect(financeAccessFromStatus(204)).toBe('allowed');
    for (const status of [401, 403, 404]) expect(financeAccessFromStatus(status)).toBe('denied');
    for (const status of [400, 429, 500, 502, 503, 504]) expect(financeAccessFromStatus(status)).toBe('unknown');
  });
});

describe('loadFinanceAccess', () => {
  it('hỏi API quyền hạn của Tài chính bằng phiên của người dùng (không dùng cache của trình duyệt)', async () => {
    const fetchMock = reply(200);
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(loadFinanceAccess()).resolves.toBe('allowed');
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/v1/capabilities', { credentials: 'include', cache: 'no-store' });
  });

  it('403 (không có quyền hoặc doanh nghiệp chưa có phân hệ) thì bị từ chối', async () => {
    global.fetch = reply(403) as unknown as typeof fetch;
    await expect(loadFinanceAccess()).resolves.toBe('denied');
  });

  it('nhiều thẻ cùng hỏi một lúc chỉ gửi một lời gọi; kết quả rõ ràng được nhớ trong một phút rồi hỏi lại', async () => {
    const fetchMock = reply(403);
    global.fetch = fetchMock as unknown as typeof fetch;
    let now = 1_000;
    const [a, b, c] = await Promise.all([loadFinanceAccess(() => now), loadFinanceAccess(() => now), loadFinanceAccess(() => now)]);
    expect([a, b, c]).toEqual(['denied', 'denied', 'denied']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 30_000;
    await loadFinanceAccess(() => now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 31_000;
    await loadFinanceAccess(() => now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lỗi tạm thời (5xx, mất mạng) không ẩn nút và không bị nhớ: lần sau hỏi lại', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({ status: 503 }).mockRejectedValueOnce(new Error('mạng')).mockResolvedValue({ status: 403 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(loadFinanceAccess()).resolves.toBe('allowed');
    await expect(loadFinanceAccess()).resolves.toBe('allowed');
    await expect(loadFinanceAccess()).resolves.toBe('denied');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
