import { hasTenantAction, type AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TenantUsers } from './tenant-users';

export default async function TenantUsersPage() {
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const me = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!me.ok) redirect('/');
  const principal = await me.json() as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (!hasTenantAction(principal.permissions, 'core.users.read')) return <p role="alert" className="p-6">Bạn không có quyền xem người dùng.</p>;
  return (
    <TenantUsers
      isAdmin={principal.roles.includes('tenant-admin')}
      permissions={principal.permissions}
      tenantSlug={principal.tenantSlug}
    />
  );
}

export type { TenantCoreUser } from './user-types';
