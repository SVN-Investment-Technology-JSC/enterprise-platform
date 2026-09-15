import type { ReactNode } from 'react';
import { TenantShell } from './tenant-shell';

export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <TenantShell>{children}</TenantShell>;
}
