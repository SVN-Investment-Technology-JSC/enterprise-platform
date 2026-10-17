import {
  DEFAULT_ROLE_PERMISSIONS,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  type ProjectPermission,
  type ProjectRoleDefinition,
  type ProjectRoleList,
  type SaveProjectRoleRequest,
} from '@enterprise-platform/contracts-workspace';
import { randomBytes } from 'node:crypto';
import {
  ProjectForbiddenError,
  ProjectRoleNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/** Vai trò đổi rất chậm; mỗi lần kiểm quyền không cần đọc lại bảng. */
const CACHE_TTL_MS = 30_000;

type PermissionMap = ReadonlyMap<string, readonly ProjectPermission[]>;

/** Bốn vai hệ thống với quyền mặc định — dùng khi chưa đọc được bảng vai trò. */
const DEFAULT_MAP: PermissionMap = new Map(
  PROJECT_ROLES.map((role) => [role, DEFAULT_ROLE_PERMISSIONS[role]]),
);

/**
 * Vai trò trong dự án do tenant tự định nghĩa.
 *
 * Ai cũng đọc được danh sách (để hiện tên vai); chỉ quản trị (canManage hoặc
 * quản trị tenant) được thêm, sửa, xoá. Chủ nhiệm luôn giữ đủ quyền — bỏ
 * quyền của chủ nhiệm là khoá luôn người duy nhất gỡ được rối cho dự án.
 */
export class ProjectRoleService {
  private readonly cache = new Map<string, { value: PermissionMap; expiresAt: number }>();

  constructor(private readonly store: WorkspaceStore) {}

  /** Quyền của một vai; vai không còn tồn tại thì không có quyền gì ngoài xem phần liên quan. */
  async permissionsOf(tenantId: string, role: string): Promise<readonly ProjectPermission[]> {
    if (role === 'owner') return PROJECT_PERMISSIONS;
    const map = await this.permissionMap(tenantId);
    return map.get(role) ?? ['project.view_related'];
  }

  /** Vai có tồn tại không — dùng khi lưu danh sách thành viên. */
  async exists(tenantId: string, role: string): Promise<boolean> {
    return (await this.permissionMap(tenantId)).has(role);
  }

  async list(actor: WorkspaceActor): Promise<ProjectRoleList> {
    return { items: await this.definitions(actor.tenantId), canEdit: canEdit(actor) };
  }

  async create(actor: WorkspaceActor, input: SaveProjectRoleRequest): Promise<ProjectRoleList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const existing = await this.definitions(actor.tenantId);
    const name = requireName(input?.name, existing);
    await this.store.roleDefinition.create(actor.tenantId, actor.userId, {
      key: `custom_${randomBytes(5).toString('hex')}`,
      name,
      permissions: cleanPermissions(input?.permissions),
    });
    this.cache.delete(actor.tenantId);
    return this.list(actor);
  }

  async update(
    actor: WorkspaceActor,
    key: string,
    input: SaveProjectRoleRequest,
  ): Promise<ProjectRoleList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const existing = await this.definitions(actor.tenantId);
    const current = existing.find((role) => role.key === key);
    if (!current) throw new ProjectRoleNotFoundError(key);
    const name = requireName(input?.name, existing, key);
    await this.store.roleDefinition.update(actor.tenantId, actor.userId, key, {
      name,
      permissions: current.locked ? PROJECT_PERMISSIONS : cleanPermissions(input?.permissions),
    });
    this.cache.delete(actor.tenantId);
    return this.list(actor);
  }

  async remove(actor: WorkspaceActor, key: string): Promise<ProjectRoleList> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const current = (await this.definitions(actor.tenantId)).find((role) => role.key === key);
    if (!current) throw new ProjectRoleNotFoundError(key);
    if (current.isSystem) {
      throw new WorkspaceValidationError('Không xoá được vai trò mặc định của hệ thống.');
    }
    if (current.memberCount > 0) {
      throw new WorkspaceValidationError(
        `Vai trò "${current.name}" đang được gán cho ${current.memberCount} thành viên dự án. ` +
          'Hãy đổi vai trò của họ trước khi xoá.',
      );
    }
    await this.store.roleDefinition.remove(actor.tenantId, key);
    this.cache.delete(actor.tenantId);
    return this.list(actor);
  }

  private async definitions(tenantId: string): Promise<ProjectRoleDefinition[]> {
    const rows = await this.store.roleDefinition.list(tenantId);
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      permissions: row.key === 'owner' ? PROJECT_PERMISSIONS : cleanPermissions(row.permissions),
      isSystem: row.isSystem,
      locked: row.key === 'owner',
      memberCount: row.memberCount,
      sortOrder: row.sortOrder,
    }));
  }

  /**
   * Bảng vai trò theo tenant, giữ trong bộ nhớ một lúc. Chưa đọc được (tenant
   * chưa chạy migration, mất kết nối) thì rơi về bốn vai mặc định thay vì chặn
   * mọi thao tác trong dự án.
   */
  private async permissionMap(tenantId: string): Promise<PermissionMap> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const rows = await this.store.roleDefinition.list(tenantId);
      const value: PermissionMap = new Map(
        rows.map((row) => [row.key, cleanPermissions(row.permissions)]),
      );
      this.cache.set(tenantId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    } catch {
      return DEFAULT_MAP;
    }
  }
}

function canEdit(actor: WorkspaceActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

function requireName(
  value: unknown,
  existing: readonly ProjectRoleDefinition[],
  selfKey?: string,
): string {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new WorkspaceValidationError('Tên vai trò không được để trống.');
  if (name.length > 80) {
    throw new WorkspaceValidationError('Tên vai trò không được dài quá 80 ký tự.');
  }
  const folded = name.toLocaleLowerCase('vi');
  if (
    existing.some(
      (role) => role.key !== selfKey && role.name.toLocaleLowerCase('vi') === folded,
    )
  ) {
    throw new WorkspaceValidationError(`Đã có vai trò tên "${name}".`);
  }
  return name;
}

/** Giữ đúng các quyền đã biết, không trùng, theo thứ tự chuẩn. */
function cleanPermissions(value: unknown): ProjectPermission[] {
  const given = new Set(Array.isArray(value) ? value.map(String) : []);
  return PROJECT_PERMISSIONS.filter((permission) => given.has(permission));
}
