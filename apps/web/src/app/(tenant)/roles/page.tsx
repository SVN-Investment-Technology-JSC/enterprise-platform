import type { TenantRoleSummary } from '@enterprise-platform/contracts-tenancy';
import { cookies } from 'next/headers';
import { TenantRoles } from './tenant-roles';

const DEFAULT_ROLES: TenantRoleSummary[] = [
  {
    id: 'd0000000-0000-4000-8000-000000000001',
    code: 'tenant-admin',
    name: 'Quản trị viên Tenant',
    description: 'Toàn quyền quản trị phân hệ và người dùng trong tổ chức',
    isSystem: true,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    permissions: ['*'],
    userCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'd0000000-0000-4000-8000-000000000002',
    code: 'tenant-user',
    name: 'Nhân viên mặc định',
    description: 'Vai trò mặc định truy cập các phân hệ được cấp phát',
    isSystem: true,
    status: 'active',
    modules: ['procedure-engine', 'maintenance', 'inventory'],
    permissions: ['procedure.read', 'maintenance.read', 'inventory.read'],
    userCount: 18,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'd0000000-0000-4000-8000-000000000003',
    code: 'maintenance-lead',
    name: 'Trưởng nhóm bảo trì',
    description: 'Quản lý kế hoạch bảo trì và phê duyệt sự cố',
    isSystem: false,
    status: 'active',
    modules: ['maintenance', 'inventory'],
    permissions: ['maintenance.read', 'maintenance.manage', 'inventory.read'],
    userCount: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export default async function TenantRolesPage() {
  const cookieHeader = (await cookies()).toString();
  const api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  let roles: TenantRoleSummary[] = DEFAULT_ROLES;

  try {
    const res = await fetch(`${api}/api/platform/v1/tenant-roles`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.roles && data.roles.length > 0) {
        roles = data.roles;
      }
    }
  } catch {
    // Fallback to default roles
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Quản lý vai trò & Phân quyền tổ chức
        </h1>
        <p className="text-sm text-slate-500">
          Định nghĩa vai trò nhân sự, kiểm soát phạm vi phân hệ truy cập và ma trận quyền hạn theo nguyên tắc bảo mật tối thiểu.
        </p>
      </div>

      <TenantRoles initialRoles={roles} />
    </div>
  );
}
