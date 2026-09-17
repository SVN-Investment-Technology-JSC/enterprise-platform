import type { ReactNode } from 'react';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { TenantShell } from './tenant-shell';

export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookie = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const response = await fetch(`${api}/api/auth/v1/me`, { headers: { cookie }, cache: 'no-store' });
  const principal = response.ok ? await response.json() as AuthenticatedPrincipal : undefined;
  const canManage = principal?.kind === 'tenant-user' && principal.permissions.includes('tenant.manage');
  return <TenantShell canManage={canManage}>{children}</TenantShell>;
}
