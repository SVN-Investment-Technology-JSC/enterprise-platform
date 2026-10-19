import type {
  AuthenticatedPrincipal,
  TenantPermission,
  TenantRole,
} from '@enterprise-platform/contracts-identity';
import type { TenantModuleCatalogItem } from '@enterprise-platform/contracts-tenancy';
import { isLauncherOnlyModule } from '@enterprise-platform/feature-module-shell';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthorizationWorkspace } from './authorization-workspace';
import type { RoleMemberUser } from './role-members';

export default async function AuthorizationPage() {
  const cookie = (await cookies()).toString();
  const root = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const get = (path: string) =>
    fetch(`${root}/api/${path}`, { headers: { cookie }, cache: 'no-store' });

  const me = await get('auth/v1/me');
  if (!me.ok) redirect('/');
  const principal = (await me.json()) as AuthenticatedPrincipal;
  if (principal.kind !== 'tenant-user') redirect('/platform');

  if (!principal.roles.includes('tenant-admin'))
    return (
      <div className="flex h-[calc(100dvh-6.5rem)] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <ShieldAlert className="size-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Không có quyền truy cập</h2>
          <p className="mt-1 text-sm text-slate-500">
            Bạn cần có vai trò Quản trị viên Tenant (tenant-admin) để xem và quản lý cấu hình phân quyền hệ thống.
          </p>
          <div className="mt-5">
            <Button render={<Link href="/dashboard" />} variant="outline">
              Về bảng điều khiển
            </Button>
          </div>
        </div>
      </div>
    );

  try {
    const responses = await Promise.all(
      ['tenant-roles', 'tenant-permissions', 'modules/catalog'].map((p) =>
        get(`platform/v1/${p}`),
      ),
    );
    if (responses.some((r) => !r.ok))
      return (
        <div className="flex h-[calc(100dvh-6.5rem)] items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-red-100 text-red-700">
              <AlertTriangle className="size-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Không thể tải dữ liệu</h2>
            <p className="mt-1 text-sm text-slate-500">
              Không thể tải danh mục phân quyền từ máy chủ. Vui lòng thử tải lại trang hoặc kiểm tra kết nối API.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Button render={<Link href="/dashboard" />} variant="outline">
                Về bảng điều khiển
              </Button>
              <Button render={<Link href="/authorization" />} className="bg-blue-600 text-white hover:bg-blue-700">
                Tải lại trang
              </Button>
            </div>
          </div>
        </div>
      );

    const [roles, permissions, modules] = (await Promise.all(
      responses.map((r) => r.json()),
    )) as [
      { roles: TenantRole[] },
      { permissions: TenantPermission[] },
      { modules: TenantModuleCatalogItem[] },
    ];

    // Danh sách người dùng chỉ để hiển thị tên trong vai trò; lỗi tải không chặn trang.
    const usersResponse = await get('platform/v1/tenant-users').catch(() => undefined);
    const users: RoleMemberUser[] = usersResponse?.ok
      ? (((await usersResponse.json()) as { users: RoleMemberUser[] }).users ?? []).map(
          (u) => ({ id: u.id, fullName: u.fullName, email: u.email, status: u.status }),
        )
      : [];

    return (
      <AuthorizationWorkspace
        users={users}
        initialRoles={roles.roles}
        initialPermissions={permissions.permissions}
        // Trợ lý mở cho mọi thành viên, không có quyền để gán theo vai trò.
        modules={modules.modules.filter((m) => !isLauncherOnlyModule(m.key))}
      />
    );
  } catch {
    return (
      <div className="flex h-[calc(100dvh-6.5rem)] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <AlertTriangle className="size-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Lỗi kết nối API</h2>
          <p className="mt-1 text-sm text-slate-500">
            Không thể thiết lập kết nối đến dịch vụ phân quyền. Vui lòng thử lại sau.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button render={<Link href="/dashboard" />} variant="outline">
              Về bảng điều khiển
            </Button>
            <Button render={<Link href="/authorization" />} className="bg-blue-600 text-white hover:bg-blue-700">
              Tải lại trang
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
