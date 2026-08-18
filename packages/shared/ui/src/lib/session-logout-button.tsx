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

async function revokeSession(): Promise<void> {
  const initialCsrf = cookie('ep_csrf');
  if (!initialCsrf) throw new Error('Không tìm thấy CSRF token. Vui lòng tải lại trang.');

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
  const loginPath = explicitLoginPath ?? (portal === 'platform'
    ? '/platform/login'
    : window.location.pathname.match(/^\/t\/([^/]+)/)?.[1]
      ? `/t/${window.location.pathname.match(/^\/t\/([^/]+)/)?.[1]}/login`
      : '/');

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await revokeSession();
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
        <span aria-hidden="true">↪</span>
        {busy ? 'Đang đăng xuất…' : 'Đăng xuất'}
      </button>
      {error ? <small className={styles.error} role="alert">{error}</small> : null}
    </div>
  );
}
