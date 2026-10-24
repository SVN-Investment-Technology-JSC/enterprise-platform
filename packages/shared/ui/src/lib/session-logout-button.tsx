'use client';

import { useState } from 'react';
import styles from './session-logout-button.module.css';

export type SessionPortal = 'platform' | 'tenant';

export interface SessionLogoutButtonProps {
  readonly portal: SessionPortal;
  readonly loginPath?: string;
  readonly tone?: 'dark' | 'light';
  readonly onLoggedOut?: (loginPath: string) => void;
}

function cookie(name: string): string | undefined {
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return encoded ? decodeURIComponent(encoded) : undefined;
}

async function postWithCsrf(path: string, csrfToken: string): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken },
  });
}

/**
 * Trình duyệt này thôi nhận thông báo đẩy (Web Push) của chat: người đăng nhập sau trên cùng máy không được nhận tin
 * của người vừa đăng xuất. Báo máy chủ xoá đăng ký (khi phiên còn) rồi huỷ đăng ký trong trình duyệt. Cố gắng tốt nhất,
 * tối đa vài giây, không chặn việc đăng xuất.
 */
async function stopBrowserPush(csrfToken: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const work = (async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await fetch('/api/platform/v1/push/subscription', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe();
  })().catch(() => undefined);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  try {
    window.localStorage.removeItem('ep-push-owner');
  } catch {
    // Bộ nhớ cục bộ bị chặn.
  }
}

/**
 * Kết thúc phiên hiện tại bằng CSRF token hiện hành. Nếu access token đã hết
 * hạn nhưng refresh session còn hiệu lực, làm mới token một lần để server có
 * thể xác định và thu hồi đúng phiên.
 */
export async function revokeSession(): Promise<void> {
  const initialCsrf = cookie('ep_csrf');
  if (!initialCsrf) throw new Error('Không tìm thấy CSRF token. Vui lòng tải lại trang.');
  await stopBrowserPush(initialCsrf);

  let response = await postWithCsrf('/api/auth/v1/logout', initialCsrf);
  if (response.status !== 401) {
    if (!response.ok) throw new Error('Platform Core không thể kết thúc phiên đăng nhập.');
    return;
  }

  const refresh = await postWithCsrf('/api/auth/v1/refresh', initialCsrf);
  if (!refresh.ok) return;

  const rotatedCsrf = cookie('ep_csrf');
  if (!rotatedCsrf) throw new Error('Không thể làm mới CSRF token.');
  response = await postWithCsrf('/api/auth/v1/logout', rotatedCsrf);
  if (!response.ok) throw new Error('Platform Core không thể kết thúc phiên đăng nhập.');
}

export function SessionLogoutButton({
  portal,
  loginPath: explicitLoginPath,
  tone = 'light',
  onLoggedOut,
}: SessionLogoutButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await revokeSession();
      const loginPath = resolveLoginPath(portal, explicitLoginPath);
      if (onLoggedOut) onLoggedOut(loginPath);
      else window.location.replace(loginPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng xuất.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.control}>
      <button
        aria-label="Đăng xuất khỏi hệ thống"
        className={`${styles.button} ${styles[tone]}`}
        disabled={busy}
        onClick={() => void logout()}
        type="button"
      >
        Đăng xuất
      </button>
      {error ? <small className={styles.error} role="alert">{error}</small> : null}
    </div>
  );
}

function resolveLoginPath(portal: SessionPortal, explicitLoginPath?: string): string {
  if (explicitLoginPath) return explicitLoginPath;
  if (portal === 'platform') return '/login/admin';
  return '/login';
}
