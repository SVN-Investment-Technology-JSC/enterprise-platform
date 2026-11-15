import type { ReactNode } from 'react';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadServerSession, tenantRedirect } from '../_components/server-session';
import { TenantShell } from './tenant-shell';

export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await loadServerSession((await cookies()).toString());
  const target = tenantRedirect(session);
  if (target) redirect(target);
  const principal: AuthenticatedPrincipal | undefined = session.status === 'authenticated' ? session.principal : undefined;
  const canManage = principal?.kind === 'tenant-user' && principal.permissions.includes('tenant.manage');
  const userRole = principal?.roles?.[0] ?? (principal?.kind === 'tenant-user' ? 'Tenant User' : 'Tenant Admin');
  return (
    <TenantShell
      canManage={canManage}
      permissions={principal?.permissions ?? []}
      principal={principal}
      displayName={principal?.displayName}
      role={userRole}
    >
      {children}
    </TenantShell>
  );
}
