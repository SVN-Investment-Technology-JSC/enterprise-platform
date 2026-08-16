import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantEntitlementOverview } from '@enterprise-platform/contracts-tenancy';
import { PlatformShell } from '@enterprise-platform/shared-ui';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { TenantEntitlements } from './tenant-entitlements';

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
  if (!meResponse.ok) redirect('/platform/login');

  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'platform-admin') redirect(`/t/${principal.tenantSlug}`);

  const overviewResponse = await fetch(
    `${api}/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/modules`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (overviewResponse.status === 404) notFound();
  if (!overviewResponse.ok) {
    throw new Error('Không thể tải entitlement của tenant.');
  }
  const overview = (await overviewResponse.json()) as TenantEntitlementOverview;

  return (
    <PlatformShell
      eyebrow="Platform Core · Entitlement"
      title={overview.tenant.name}
      subtitle="Cấp hoặc thu hồi plugin theo Module Registry. Provisioning chỉ chạy migration thuộc schema của module được chọn."
      actor={principal.displayName}
    >
      <TenantEntitlements initialOverview={overview} />
    </PlatformShell>
  );
}
