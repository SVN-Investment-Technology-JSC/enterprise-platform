import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { PlatformShell } from '@enterprise-platform/shared-ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { OrgChart } from './org-chart';

/**
 * Sơ đồ tổ chức thuộc phần lõi: mọi doanh nghiệp đều xem được, không phụ thuộc
 * việc đã bật phân hệ nghiệp vụ nào.
 */
export default async function TenantOrganizationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';

  const [meResponse, snapshotResponse] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${api}/api/platform/v1/tenant-organization/snapshot`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);
  if (!meResponse.ok) redirect('/tenant/login');

  const principal = (await meResponse.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (principal.tenantSlug !== tenantSlug) redirect(`/t/${principal.tenantSlug}/to-chuc`);

  const snapshot = snapshotResponse.ok
    ? ((await snapshotResponse.json()) as TenantOrganizationSnapshot)
    : undefined;

  return (
    <PlatformShell
      eyebrow="Doanh nghiệp"
      title="Sơ đồ tổ chức"
      subtitle="Các đơn vị, chức danh và nhân sự. Một người có thể kiêm nhiệm nhiều đơn vị."
      actor={principal.displayName}
      logoutPortal="tenant"
      backHref={`/t/${tenantSlug}`}
    >
      {snapshot ? (
        <OrgChart snapshot={snapshot} />
      ) : (
        <p>Chưa tải được sơ đồ tổ chức. Thử lại sau hoặc liên hệ người quản trị.</p>
      )}
    </PlatformShell>
  );
}
