import type { ReactNode } from 'react';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadServerSession, platformRedirect } from '../_components/server-session';
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
  // Chuyển hướng nằm ngoài try/catch: `redirect()` ném NEXT_REDIRECT, bọc lại là nuốt mất lệnh.
  const session = await loadServerSession((await cookies()).toString());
  const target = platformRedirect(session);
  if (target) redirect(target);
  const principal: AuthenticatedPrincipal | undefined = session.status === 'authenticated' ? session.principal : undefined;

  const displayName = principal?.displayName ?? 'Platform Admin';

  return (
    <PlatformShell displayName={displayName} principal={principal}>
      {children}
    </PlatformShell>
  );
}
