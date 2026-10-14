'use client';

import { useEffect } from 'react';
import { readAccessExpiry, refreshSession } from './auth-fetch';

/** Làm mới trước khi hết hạn chừng này, đủ rộng cho đồng hồ máy khách lệch vài phút. */
const LEAD_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Giữ phiên đăng nhập sống: làm mới access token ngầm trước khi hết hạn để giao diện không gặp 401.
 * Không hiển thị gì và không thay đổi giao diện.
 *
 * Hẹn giờ dựa trên cookie `ep_access_exp`. Trình duyệt làm chậm hẹn giờ ở tab nền, nên mỗi lần tab
 * hiện lại hoặc lấy lại focus sẽ kiểm tra lại. Phiên cũ chưa có cookie này thì làm mới một lần để nhận cookie.
 * Làm mới thất bại thì dừng, không lặp lại; khi đó `authFetch` vẫn xử lý 401 theo từng request.
 */
export function startSessionKeepAlive(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    const expiry = readAccessExpiry();
    if (!expiry) return;
    const wait = Math.max(0, expiry - Date.now() - LEAD_MS);
    timer = setTimeout(() => void run(), Math.min(wait, MAX_TIMEOUT_MS));
  };

  const run = async () => {
    if (stopped) return;
    const expiry = readAccessExpiry();
    if (expiry && expiry - Date.now() > LEAD_MS) return schedule();
    if (await refreshSession()) schedule();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void run();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}

export function SessionKeepAlive() {
  useEffect(() => startSessionKeepAlive(), []);
  return null;
}
