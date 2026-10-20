import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TenantManagement } from '../tenant-management';

export default async function PlatformTenantsPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [meResponse, tenantsResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${api}/api/platform/v1/tenants`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);
  if (!meResponse.ok || !tenantsResponse.ok) redirect('/login/admin');
  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin') {
    redirect('/dashboard');
  }
  const { tenants } = (await tenantsResponse.json()) as {
    tenants: TenantSummary[];
  };

  return (
    <>
      <TenantManagement
        canDelete={principal.permissions?.includes('platform.tenants.delete') ?? false}
        initialTenants={tenants}
      />
    </>
  );
}
