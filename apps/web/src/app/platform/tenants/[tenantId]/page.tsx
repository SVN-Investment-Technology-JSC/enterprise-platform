import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantEntitlementOverview } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { TenantEntitlements } from './tenant-entitlements';
import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';

export default async function TenantEntitlementsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const meResponse = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!meResponse.ok) redirect('/login/admin');

  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin') {
    redirect('/dashboard');
  }

  const overviewResponse = await fetch(
    `${api}/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/modules`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (overviewResponse.status === 404) notFound();
  if (!overviewResponse.ok) {
    throw new Error('Không thể tải entitlement của tenant.');
  }
  const rawOverview = (await overviewResponse.json()) as TenantEntitlementOverview;
  const overview: TenantEntitlementOverview = {
    ...rawOverview,
    modules: rawOverview.modules.filter((m) => m.key.toLowerCase() !== 'crm'),
  };

  return (
    <>
      <PageBreadcrumb
        className="mb-5"
        items={[
          { label: 'Quản trị hệ thống', href: '/platform' },
          { label: 'Khách hàng', href: '/platform/tenants' },
          { label: overview.tenant.name },
          { label: 'Modules' },
        ]}
      />

      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Modules của {overview.tenant.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Quản lý module và entitlement được cấp cho tenant. Provisioning
          chỉ chạy migration thuộc schema của module được chọn.
        </p>
      </div>

      <TenantEntitlements initialOverview={overview} />
    </>
  );
}
