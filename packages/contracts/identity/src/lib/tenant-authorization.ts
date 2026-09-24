/** Supported application actions; tenant admins compose these into permissions. */
export const TENANT_PERMISSION_ACTIONS = [
  { key: 'inventory.read', group: 'Inventory', label: 'Xem kho và tài sản' },
  { key: 'inventory.manage', group: 'Inventory', label: 'Quản lý kho, tài sản và cấu hình (bao gồm giao dịch)' },
  { key: 'inventory.transaction.write', group: 'Inventory', label: 'Nhập, xuất, chuyển kho và giữ chỗ' },
  { key: 'maintenance.read', group: 'Maintenance', label: 'Xem lịch và hồ sơ bảo trì' },
  { key: 'maintenance.manage', group: 'Maintenance', label: 'Quản lý lịch và cấu hình bảo trì (bao gồm xử lý đợt)' },
  { key: 'maintenance.occurrence.manage', group: 'Maintenance', label: 'Xử lý đợt bảo trì' },
  { key: 'procedure.definition.manage', group: 'Procedure Engine', label: 'Thiết kế quy trình, phân vai RACI và cấu hình' },
  { key: 'procedure.definition.publish', group: 'Procedure Engine', label: 'Công bố và lưu trữ quy trình' },
  { key: 'procedure.instance.create', group: 'Procedure Engine', label: 'Khởi tạo hồ sơ (vẫn kiểm tra vai S)' },
  { key: 'procedure.instance.override', group: 'Procedure Engine', label: 'Can thiệp hồ sơ vượt phân vai RACI, xóa hồ sơ' },
  { key: 'core.users.read', group: 'Người dùng', label: 'Xem người dùng' },
  { key: 'core.users.create', group: 'Người dùng', label: 'Tạo người dùng' },
  { key: 'core.users.update', group: 'Người dùng', label: 'Sửa người dùng' },
  { key: 'core.users.delete', group: 'Người dùng', label: 'Xóa người dùng' },
  { key: 'core.organization.read', group: 'Tổ chức', label: 'Xem tổ chức' },
  {
    key: 'core.organization.create',
    group: 'Tổ chức',
    label: 'Tạo dữ liệu tổ chức',
  },
  {
    key: 'core.organization.update',
    group: 'Tổ chức',
    label: 'Sửa dữ liệu tổ chức',
  },
  {
    key: 'core.organization.delete',
    group: 'Tổ chức',
    label: 'Xóa dữ liệu tổ chức',
  },
] as const;
export type TenantAction = (typeof TENANT_PERMISSION_ACTIONS)[number]['key'];
export interface TenantPermission {
  id: string;
  name: string;
  description: string;
  actionKeys: string[];
  roleIds: string[];
}
export interface TenantRole {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionIds: string[];
  moduleKeys: string[];
  userIds: string[];
}
export interface TenantAuthorization {
  roles: string[];
  permissions: string[];
  moduleKeys: string[];
  authorizationRevision: string;
}
export function hasTenantAction(
  permissions: readonly string[],
  action: TenantAction,
): boolean {
  return permissions.includes('tenant.manage') || permissions.includes(action);
}

/** Management includes operational rights, never module admission. */
export function expandTenantActions(actions: readonly string[]): string[] {
  const effective = new Set(actions);
  if (effective.has('inventory.manage')) {
    effective.add('inventory.read');
    effective.add('inventory.transaction.write');
  }
  if (effective.has('maintenance.manage')) {
    effective.add('maintenance.read');
    effective.add('maintenance.occurrence.manage');
  }
  return [...effective];
}
