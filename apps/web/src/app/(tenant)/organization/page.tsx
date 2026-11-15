import { hasTenantAction, type AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { AccessDeniedNotice } from '@enterprise-platform/shared-ui';
import { OrganizationPermissionsProvider } from './organization-permissions';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { OrganizationWorkspace, type OrganizationSnapshot } from './organization-workspace';

const ORGANIZATION_DENIED = 'Bạn chưa được cấp quyền xem sơ đồ tổ chức. Liên hệ quản trị để được cấp quyền.';

export default async function OrganizationPage() {
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const me = await fetch(`${api}/api/auth/v1/me`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  if (!me.ok) redirect('/');
  const principal = await me.json() as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (!hasTenantAction(principal.permissions, 'core.organization.read')) return <AccessDeniedNotice message={ORGANIZATION_DENIED} />;
  const tenantSlug = principal.tenantSlug;
  const response = await fetch(`${api}/api/platform/v1/tenant-organization/core-snapshot`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  if (response.status === 403) return <AccessDeniedNotice message={ORGANIZATION_DENIED} />;
  const snapshot = response.ok ? await response.json() as OrganizationSnapshot : { trees: [], nodeTypes: [], nodes: [], assignments: [], users: [] };
  return <OrganizationPermissionsProvider permissions={principal.permissions}><OrganizationWorkspace initialSnapshot={snapshot} loadError={response.ok ? undefined : 'Không thể tải dữ liệu sơ đồ tổ chức. Vui lòng thử tải lại trang.'} tenantSlug={tenantSlug} /></OrganizationPermissionsProvider>;
}
