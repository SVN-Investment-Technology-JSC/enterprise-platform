'use client';

import { authFetch, revokeSession } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';

export interface ShellPrincipal {
  readonly kind?: string;
  readonly displayName?: string;
  readonly tenantSlug?: string;
  readonly roles?: readonly string[];
  readonly systemRole?: string;
}

/**
 * Phiên đăng nhập mà khung module cần: ai đang dùng và cách đăng xuất.
 *
 * Tách khỏi `ModuleShell` để hai kiểu khung (tối và sáng) đọc cùng một nguồn,
 * không mỗi kiểu tự gọi `/me` và tự viết lại luồng đăng xuất.
 */
export function useShellSession() {
  const [principal, setPrincipal] = useState<ShellPrincipal | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const response = await authFetch('/api/auth/v1/me', {
          cache: 'no-store',
        });
        if (!active) return;
        setPrincipal(response.ok ? ((await response.json()) as ShellPrincipal) : null);
      } catch {
        if (active) setPrincipal(null);
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await revokeSession();
      window.location.replace('/');
    } catch (cause) {
      setLogoutError(
        cause instanceof Error ? cause.message : 'Không thể đăng xuất. Vui lòng thử lại.',
      );
      setLoggingOut(false);
    }
  };

  return { principal, loggingOut, logoutError, logout };
}

/** Hai chữ cái đầu của họ và tên: "Nguyễn Văn An" → "NA". */
export function initialsOfName(name?: string): string {
  if (!name) return 'EP';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
