import { refreshSession } from './auth-fetch';
import { loginPathForLocation, startSessionKeepAlive } from './session-keep-alive';

const MIN = 60_000;
/** Các ca về hẹn giờ làm mới: tắt theo dõi không thao tác để tách riêng hai việc. */
const ALWAYS_ACTIVE = { idleTimeoutMs: Number.POSITIVE_INFINITY };

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
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
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
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('establishes the expiry cookie once for sessions that predate it', async () => {
    setCookies(undefined);
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops quietly when the refresh fails instead of looping', async () => {
    setCookies(Date.now() - MIN);
    fetchMock.mockResolvedValue({ ok: false });
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(10 * MIN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when another tab already renewed the session', async () => {
    setCookies(Date.now() + 4 * MIN);
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    fetchMock.mockClear();
    setCookies(Date.now() + 59 * MIN);
    stop = startSessionKeepAlive(ALWAYS_ACTIVE);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('ngừng làm mới khi tab bỏ không (ISS-UI-026)', () => {
    const IDLE = 30 * MIN;
    const touch = () => window.dispatchEvent(new Event('mousemove'));
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    // SEC-UI026-01
    it('không thao tác quá 30 phút thì không làm mới, kể cả request 401 của authFetch', async () => {
      const onSessionLapsed = jest.fn();
      setCookies(Date.now() + 60 * MIN);
      stop = startSessionKeepAlive({ idleTimeoutMs: IDLE, onSessionLapsed });
      await jest.advanceTimersByTimeAsync(0);

      await jest.advanceTimersByTimeAsync(90 * MIN);
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(refreshSession()).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSessionLapsed).not.toHaveBeenCalled();
    });

    // SEC-UI026-02
    it('có thao tác chuột, phím trước 30 phút thì đặt lại bộ đếm và vẫn làm mới đúng hạn', async () => {
      setCookies(Date.now() + 60 * MIN);
      stop = startSessionKeepAlive({ idleTimeoutMs: IDLE, onSessionLapsed: jest.fn() });
      await jest.advanceTimersByTimeAsync(25 * MIN);
      touch();
      await jest.advanceTimersByTimeAsync(25 * MIN);
      press();
      await jest.advanceTimersByTimeAsync(6 * MIN);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/v1/refresh');
    });

    it('quay lại khi access token còn hạn thì làm mới tiếp', async () => {
      const onSessionLapsed = jest.fn();
      setCookies(Date.now() + 60 * MIN);
      stop = startSessionKeepAlive({ idleTimeoutMs: IDLE, onSessionLapsed });
      await jest.advanceTimersByTimeAsync(40 * MIN);
      touch();
      await jest.advanceTimersByTimeAsync(16 * MIN);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onSessionLapsed).not.toHaveBeenCalled();
    });

    it('quay lại khi access token đã hết hạn thì kết thúc phiên, không làm mới', async () => {
      const onSessionLapsed = jest.fn();
      setCookies(Date.now() + 60 * MIN);
      stop = startSessionKeepAlive({ idleTimeoutMs: IDLE, onSessionLapsed });
      await jest.advanceTimersByTimeAsync(61 * MIN);
      press();
      await jest.advanceTimersByTimeAsync(10 * MIN);
      expect(onSessionLapsed).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gỡ chặn làm mới khi dừng', async () => {
      setCookies(Date.now() + 60 * MIN);
      stop = startSessionKeepAlive({ idleTimeoutMs: IDLE, onSessionLapsed: jest.fn() });
      await jest.advanceTimersByTimeAsync(31 * MIN);
      stop();
      setCookies(Date.now() + MIN);
      await expect(refreshSession()).resolves.toBe(true);
    });
  });

  it('chọn trang đăng nhập theo cổng', () => {
    expect(loginPathForLocation('/platform/tenants')).toBe('/login/admin');
    expect(loginPathForLocation('/dashboard')).toBe('/login');
    expect(loginPathForLocation('/modules/hrm')).toBe('/login');
  });
});
