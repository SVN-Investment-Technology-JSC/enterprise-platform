import { startSessionKeepAlive } from './session-keep-alive';

const MIN = 60_000;

function setCookies(expiry?: number) {
  document.cookie = 'ep_csrf=csrf; path=/';
  if (expiry === undefined)
    document.cookie = 'ep_access_exp=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  else document.cookie = `ep_access_exp=${expiry}; path=/`;
}

describe('startSessionKeepAlive', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let stop: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockImplementation(async () => {
      // Máy chủ ghi lại cookie hết hạn mới sau mỗi lần làm mới thành công.
      setCookies(Date.now() + 60 * MIN);
      return { ok: true };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    stop?.();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('refreshes about five minutes before the access token expires, without any UI', async () => {
    setCookies(Date.now() + 60 * MIN);
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(54 * MIN);
    expect(fetchMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2 * MIN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/v1/refresh');

    // Sau khi làm mới, hẹn giờ lại cho chu kỳ kế tiếp.
    await jest.advanceTimersByTimeAsync(50 * MIN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6 * MIN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes immediately when the token already expired (tab was asleep)', async () => {
    setCookies(Date.now() - MIN);
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('establishes the expiry cookie once for sessions that predate it', async () => {
    setCookies(undefined);
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops quietly when the refresh fails instead of looping', async () => {
    setCookies(Date.now() - MIN);
    fetchMock.mockResolvedValue({ ok: false });
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(10 * MIN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when another tab already renewed the session', async () => {
    setCookies(Date.now() + 4 * MIN);
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    fetchMock.mockClear();
    setCookies(Date.now() + 59 * MIN);
    stop = startSessionKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
