import {
  hasTenantAction,
  isTenantAdmin,
  type AuthenticatedPrincipal,
} from '@enterprise-platform/contracts-identity';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { UserDetail } from './user-detail';

/**
 * Trang chi tiết người dùng. Máy chủ chỉ kiểm đăng nhập và quyền xem; dữ liệu người dùng do client lấy qua RTK Query
 * (có bộ nhớ đệm, đi từ danh sách vào là hiện ngay). Quyền ghi vẫn do API quyết định, giao diện chỉ ẩn nút.
 */
export default async function TenantUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const cookieHeader = (await cookies()).toString();
  const me = await fetch(`${api}/api/auth/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!me.ok) redirect('/');
  const principal = (await me.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  if (!hasTenantAction(principal.permissions, 'core.users.read')) {
    return (
      <p role="alert" className="p-6">
        Bạn không có quyền xem người dùng.
      </p>
    );
  }
  return (
    <UserDetail
      userId={id}
      tenantSlug={principal.tenantSlug}
      permissions={principal.permissions}
      isAdmin={isTenantAdmin(principal.roles)}
    />
  );
}
