import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { OrganizationWorkspace, type OrganizationSnapshot } from './organization-workspace';

export default async function OrganizationPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const me = await fetch(`${api}/api/auth/v1/me`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  if (!me.ok) redirect(`/t/${tenantSlug}/login`);
  const principal = await me.json() as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (principal.tenantSlug !== tenantSlug) redirect(`/t/${principal.tenantSlug}/login`);
  const response = await fetch(`${api}/api/platform/v1/tenant-organization/core-snapshot`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  const snapshot = response.ok ? await response.json() as OrganizationSnapshot : { trees: [], nodeTypes: [], nodes: [], assignments: [], users: [] };
  return <OrganizationWorkspace initialSnapshot={snapshot} loadError={response.ok ? undefined : `Không thể tải dữ liệu sơ đồ tổ chức (HTTP ${response.status}).`} tenantSlug={tenantSlug} />;
}
