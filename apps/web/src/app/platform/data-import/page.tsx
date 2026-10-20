import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantSummary } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DataImportWorkspace } from './data-import-workspace';
import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';

export default async function PlatformDataImportPage() {
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
      <PageBreadcrumb
        className="mb-5"
        items={[
          { label: 'Quản trị hệ thống', href: '/platform' },
          { label: 'Data Import' },
        ]}
      />
      <DataImportWorkspace tenants={tenants} />
    </>
  );
}
