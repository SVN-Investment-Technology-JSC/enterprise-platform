'use client';

import { useEffect } from 'react';
import { readAccessExpiry, refreshSession, setSessionRefreshSuspended } from './auth-fetch';
import { configuredIdleTimeoutMs, createIdleTimer, watchUserActivity } from './idle-timer';
import { revokeSession } from './session-logout-button';

/** Làm mới trước khi hết hạn chừng này, đủ rộng cho đồng hồ máy khách lệch vài phút. */
const LEAD_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface SessionKeepAliveOptions {
  /** Bao lâu không thao tác thì ngừng làm mới phiên. Mặc định lấy từ `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` (30 phút). */
  readonly idleTimeoutMs?: number;
  /** Tab bỏ không tới lúc access token hết hạn rồi người dùng quay lại. Mặc định: kết thúc phiên, về trang đăng nhập. */
  readonly onSessionLapsed?: () => void;
}

/**
 * Giữ phiên đăng nhập sống: làm mới access token ngầm trước khi hết hạn để giao diện không gặp 401.
 * Không hiển thị gì và không thay đổi giao diện.
 *
 * Hẹn giờ dựa trên cookie `ep_access_exp`. Trình duyệt làm chậm hẹn giờ ở tab nền, nên mỗi lần tab
 * hiện lại hoặc lấy lại focus sẽ kiểm tra lại. Phiên cũ chưa có cookie này thì làm mới một lần để nhận cookie.
 * Làm mới thất bại thì dừng, không lặp lại; khi đó `authFetch` vẫn xử lý 401 theo từng request.
 *
 * Tab không có thao tác (chuột, phím, chạm, focus) quá thời gian chờ thì ngừng làm mới, cả ở đây lẫn trong
 * `authFetch`. Người dùng quay lại khi access token còn hạn thì làm mới tiếp; đã hết hạn thì kết thúc phiên.
 */
export function startSessionKeepAlive(options: SessionKeepAliveOptions = {}): () => void {
  const onSessionLapsed = options.onSessionLapsed ?? endLapsedSession;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let idle = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    const expiry = readAccessExpiry();
    if (!expiry) return;
    const wait = Math.max(0, expiry - Date.now() - LEAD_MS);
    timer = setTimeout(() => void run(), Math.min(wait, MAX_TIMEOUT_MS));
  };

  const run = async () => {
    if (stopped || idle) return;
    const expiry = readAccessExpiry();
    if (expiry && expiry - Date.now() > LEAD_MS) return schedule();
    if (await refreshSession()) schedule();
  };

  const idleTimer = createIdleTimer({
    timeoutMs: options.idleTimeoutMs ?? configuredIdleTimeoutMs(),
    onIdle: () => {
      idle = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      setSessionRefreshSuspended(true);
    },
    onActive: () => {
      const expiry = readAccessExpiry();
      if (expiry && expiry > Date.now()) {
        idle = false;
        setSessionRefreshSuspended(false);
        void run();
        return;
      }
      stopped = true;
      onSessionLapsed();
    },
  });
  const unwatch = watchUserActivity(idleTimer);

  const onVisible = () => {
    if (document.visibilityState === 'visible') void run();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    idleTimer.stop();
    unwatch();
    setSessionRefreshSuspended(false);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}

/** Trang đăng nhập theo cổng: trang Platform dùng đăng nhập quản trị. */
export function loginPathForLocation(pathname: string): string {
  return pathname === '/platform' || pathname.startsWith('/platform/') ? '/login/admin' : '/login';
}

/** Thu hồi phiên ở máy chủ (để trang đăng nhập không tự khôi phục bằng refresh token) rồi về đăng nhập. */
function endLapsedSession(): void {
  const loginPath = loginPathForLocation(window.location.pathname);
  void revokeSession()
    .catch(() => undefined)
    .finally(() => window.location.replace(loginPath));
}

export function SessionKeepAlive() {
  useEffect(() => startSessionKeepAlive(), []);
  return null;
}
