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
  const access = { permissions: principal.permissions, isAdmin: principal.roles.includes('tenant-admin') };
  const tenantSlug = principal.tenantSlug;
  let users: Response;
  try {
    users = await fetch(`${api}/api/platform/v1/tenant-users`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
  } catch {
    return <TenantUsers {...access} initialError="Không thể kết nối API để tải danh sách người dùng." initialUsers={[]} tenantSlug={tenantSlug} />;
  }
  if (!users.ok) {
    return <TenantUsers {...access} initialError={`Không thể tải danh sách người dùng (HTTP ${users.status}).`} initialUsers={[]} tenantSlug={tenantSlug} />;
  }
  const payload = await users.json() as { users: TenantCoreUser[] };
  return <TenantUsers {...access} initialUsers={payload.users} tenantSlug={tenantSlug} />;
}

export interface TenantCoreUser {
  roleIds?: string[];
  roles?: { id: string; name: string }[];
  id: string;
  username: string | null;
  fullName: string;
  email: string;
  systemRole: 'tenant-admin' | 'tenant-user';
  status: 'active' | 'disabled';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
