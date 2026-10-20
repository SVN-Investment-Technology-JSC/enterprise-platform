import type { ReactNode } from 'react';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlatformShell } from './platform-shell';

/**
 * Khung sườn quản trị nền tảng (Platform Superadmin):
 * Đồng bộ hoàn toàn UI/UX và tính năng với Tenant Portal qua ModuleShell (khung sáng, tìm nhanh Ctrl+K, thu gọn thanh bên).
 */
export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';

  let principal: AuthenticatedPrincipal | undefined;
  try {
    const meResponse = await fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (meResponse.ok) {
      principal = (await meResponse.json()) as AuthenticatedPrincipal;
      if (principal.kind !== 'platform-admin') {
        redirect('/dashboard');
      }
    } else {
      redirect('/login/admin');
    }
  } catch {
    // Development fallback without auth service
  }

  const displayName = principal?.displayName ?? 'Platform Admin';

  return (
    <PlatformShell displayName={displayName} principal={principal}>
      {children}
    </PlatformShell>
  );
}
