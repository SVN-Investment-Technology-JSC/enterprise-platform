import type { ReactNode } from 'react';
import { TenantShell } from './tenant-shell';

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <TenantShell tenantSlug={tenantSlug}>{children}</TenantShell>;
}
