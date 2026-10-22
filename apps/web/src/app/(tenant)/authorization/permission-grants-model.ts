import {
  expandTenantActions,
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';

/** Một action có thể bổ sung riêng cho người dùng. */
export interface GrantableAction {
  readonly key: string;
  readonly label: string;
  readonly group: string;
}

/** Danh mục action cấp được: toàn bộ TENANT_PERMISSION_ACTIONS, trừ `tenant.manage` và ký tự đại diện. */
export const GRANTABLE_ACTIONS: readonly GrantableAction[] =
  TENANT_PERMISSION_ACTIONS.map((a): GrantableAction => ({
    key: a.key,
    label: a.label,
    group: a.group,
  })).filter((a) => a.key !== 'tenant.manage' && !a.key.includes('*'));

/** Vai trò hệ thống không liệt kê trong mục "Theo vai trò" (toàn quyền, không có action riêng). */
const SKIPPED_ROLE_KEYS: ReadonlySet<string> = new Set(['tenant-admin']);

type RoleLike = Pick<TenantRole, 'id' | 'key' | 'name' | 'permissionIds'>;
type PermissionLike = Pick<TenantPermission, 'id' | 'actionKeys'>;

/** Mọi khóa action thô mà vai trò nắm (qua các permission của vai trò). */
function roleHeldKeys(
  role: RoleLike,
  permissions: readonly PermissionLike[],
): string[] {
  const ids = new Set(role.permissionIds);
  return [
    ...new Set(
      permissions.filter((p) => ids.has(p.id)).flatMap((p) => p.actionKeys),
    ),
  ];
}

/** Action của vai trò nằm trong danh mục cấp được, theo thứ tự danh mục. */
export function roleActionKeys(
  role: RoleLike,
  permissions: readonly PermissionLike[],
  catalog: readonly GrantableAction[] = GRANTABLE_ACTIONS,
): string[] {
  const held = new Set(roleHeldKeys(role, permissions));
  return catalog.filter((a) => held.has(a.key)).map((a) => a.key);
}

export interface RoleSection {
  readonly role: RoleLike;
  readonly actionKeys: string[];
}

/** Mọi vai trò có action, kể cả vai trò người dùng chưa được gán; bỏ qua tenant-admin và vai trò rỗng. */
export function buildRoleSections(
  roles: readonly RoleLike[],
  permissions: readonly PermissionLike[],
  catalog: readonly GrantableAction[] = GRANTABLE_ACTIONS,
): RoleSection[] {
  return roles
    .filter((role) => !SKIPPED_ROLE_KEYS.has(role.key))
    .map((role) => ({ role, actionKeys: roleActionKeys(role, permissions, catalog) }))
    .filter((section) => section.actionKeys.length > 0);
}

export interface ActionGroup {
  readonly group: string;
  readonly actions: GrantableAction[];
}

/** Action trong danh mục mà không vai trò nào có, nhóm theo `group`. */
export function buildUnassignedGroups(
  roles: readonly RoleLike[],
  permissions: readonly PermissionLike[],
  catalog: readonly GrantableAction[] = GRANTABLE_ACTIONS,
): ActionGroup[] {
  const inRole = new Set(roles.flatMap((r) => roleHeldKeys(r, permissions)));
  const groups = new Map<string, GrantableAction[]>();
  for (const action of catalog) {
    if (inRole.has(action.key)) continue;
    groups.set(action.group, [...(groups.get(action.group) ?? []), action]);
  }
  return [...groups].map(([group, actions]) => ({ group, actions }));
}

/** Nguồn quyền từ các vai trò đang chọn: có đích danh, hoặc được một action khác bao hàm. */
export interface RoleSources {
  readonly direct: ReadonlyMap<string, string[]>;
  readonly implied: ReadonlyMap<string, { by: string[]; roles: string[] }>;
}

export function buildRoleSources(
  selectedRoles: readonly RoleLike[],
  permissions: readonly PermissionLike[],
): RoleSources {
  const direct = new Map<string, string[]>();
  const implied = new Map<string, { by: string[]; roles: string[] }>();
  const push = (list: string[], value: string) =>
    list.includes(value) ? list : [...list, value];
  for (const role of selectedRoles) {
    for (const key of roleHeldKeys(role, permissions)) {
      direct.set(key, push(direct.get(key) ?? [], role.name));
      for (const other of expandTenantActions([key])) {
        if (other === key) continue;
        const entry = implied.get(other) ?? { by: [], roles: [] };
        implied.set(other, {
          by: push(entry.by, key),
          roles: push(entry.roles, role.name),
        });
      }
    }
  }
  return { direct, implied };
}

export type ActionLock =
  | { readonly kind: 'role'; readonly roleNames: string[] }
  | { readonly kind: 'implied'; readonly byKeys: string[]; readonly roleNames: string[] };

/** Action đã có từ vai trò đang chọn thì bị khóa; không thì undefined. */
export function actionLock(
  key: string,
  sources: RoleSources,
): ActionLock | undefined {
  const direct = sources.direct.get(key);
  if (direct) return { kind: 'role', roleNames: direct };
  const implied = sources.implied.get(key);
  if (implied) return { kind: 'implied', byKeys: implied.by, roleNames: implied.roles };
  return undefined;
}

/** Câu giải thích vì sao action bị khóa. */
export function describeLock(
  lock: ActionLock,
  labelOf: (key: string) => string,
): string {
  if (lock.kind === 'role') return `Đã có từ vai trò ${lock.roleNames.join(', ')}`;
  return `Đã được bao hàm bởi ${lock.byKeys.map(labelOf).join(', ')} (vai trò ${lock.roleNames.join(', ')})`;
}

/** Quyền bổ sung mà vai trò đang chọn cũng đã có (hoặc bao hàm): trùng, nên gỡ được. */
export function overlappingGrants(
  grantKeys: readonly string[],
  sources: RoleSources,
): string[] {
  return grantKeys.filter((key) => actionLock(key, sources) !== undefined);
}

export function toggleGrant(draft: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(draft);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export interface GrantDiff {
  readonly added: string[];
  readonly removed: string[];
  readonly changed: boolean;
}

/** Khác biệt giữa tập đã lưu và tập đang chọn. */
export function diffGrants(
  saved: readonly string[],
  draft: Iterable<string>,
): GrantDiff {
  const savedSet = new Set(saved);
  const draftSet = new Set(draft);
  const added = [...draftSet].filter((k) => !savedSet.has(k));
  const removed = [...savedSet].filter((k) => !draftSet.has(k));
  return { added, removed, changed: added.length + removed.length > 0 };
}

/** Hai danh sách id có cùng phần tử (không kể thứ tự) không. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((x) => setB.has(x));
}

export interface RoleSummary {
  /** Có vai trò tenant-admin: toàn quyền, không cần liệt kê. */
  readonly admin: boolean;
  readonly moduleKeys: string[];
  readonly actionKeys: string[];
}

/** Quyền hạn tổng hợp từ các vai trò đang chọn: module truy cập và action (không trùng, giữ thứ tự gặp). */
export function summarizeRoles(
  selectedRoles: readonly (RoleLike & { moduleKeys: readonly string[] })[],
  permissions: readonly PermissionLike[],
): RoleSummary {
  return {
    admin: selectedRoles.some((r) => r.key === 'tenant-admin'),
    moduleKeys: [...new Set(selectedRoles.flatMap((r) => r.moduleKeys))],
    actionKeys: [...new Set(selectedRoles.flatMap((r) => roleHeldKeys(r, permissions)))],
  };
}
