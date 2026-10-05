import { createHash, randomUUID } from 'node:crypto';
import {
  inTransaction,
  type PostgresClient,
  type createPostgresPool,
} from '@enterprise-platform/adapter-database';
import {
  HRM_ROLE_TEMPLATES,
  TENANT_PERMISSION_ACTIONS,
  expandTenantActions,
  type TenantAuthorization,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

type Pool = ReturnType<typeof createPostgresPool>;
type Database = <T>(
  tenantId: string,
  operation: (pool: Pool) => Promise<T>,
) => Promise<T>;
const actionKeys = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));
const modulePermissions: Record<string, readonly string[]> = {
  hrm: [
    'module.access',
    ...TENANT_PERMISSION_ACTIONS.map((a) => a.key).filter((key) =>
      key.startsWith('hrm.'),
    ),
  ],
  'procedure-engine': [
    'module.access',
    ...TENANT_PERMISSION_ACTIONS.map((a) => a.key).filter((key) =>
      key.startsWith('procedure.'),
    ),
  ],
  maintenance: [
    'maintenance.read',
    'maintenance.manage',
    'maintenance.occurrence.manage',
  ],
  inventory: [
    'inventory.read',
    'inventory.manage',
    'inventory.transaction.write',
  ],
  workspace: [
    'module.access',
    ...TENANT_PERMISSION_ACTIONS.map((a) => a.key).filter((key) =>
      key.startsWith('workspace.'),
    ),
  ],
};

/** UUID xác định (dạng v5) từ khóa mẫu: cùng khóa cho cùng ID. */
export function hrmTemplateId(kind: 'role' | 'permission', key: string) {
  const h = createHash('sha1')
    .update(`enterprise-platform:hrm-template:${kind}:${key}`)
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException('ID không hợp lệ.');
  return value;
}
function strings(value: unknown, ids = false): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 100)
  )
    throw new BadRequestException('Danh sách quyền không hợp lệ.');
  return [...new Set(value as string[])].map((v) => (ids ? uuid(v) : v));
}
function metadata(input: Record<string, unknown>) {
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 180 ||
    (input.description !== undefined &&
      (typeof input.description !== 'string' ||
        input.description.length > 2000))
  )
    throw new BadRequestException('Tên hoặc mô tả không hợp lệ.');
  return [input.name.trim(), input.description ?? ''];
}

/** Bounded cache; every hit is fenced by a fresh DB revision and active-user check.
 * This works across API replicas without relying on best-effort pub/sub delivery.
 * Sessions and entitlements are always checked by the caller before decisions. */
export class TenantAuthorizationService {
  private readonly cache = new Map<
    string,
    {
      expires: number;
      value: TenantAuthorization;
      decisions: Map<string, boolean>;
    }
  >();
  constructor(
    private readonly database: Database,
    private readonly now = Date.now,
  ) {}

  async resolve(
    tenantId: string,
    userId: string,
  ): Promise<TenantAuthorization> {
    return this.database(tenantId, async (pool) => {
      const state = (
        await pool.query<{ revision: string }>(
          `SELECT s.revision::text FROM core_schema.authorization_state s
         JOIN core_schema.users u ON u.id=$1 AND u.status='active' AND u.is_active=true WHERE s.id=true`,
          [userId],
        )
      ).rows[0];
      if (!state)
        throw new UnauthorizedException('Người dùng không còn hoạt động.');
      const key = `${tenantId}:${userId}`;
      const cached = this.cache.get(key);
      if (
        cached &&
        cached.expires > this.now() &&
        cached.value.authorizationRevision === state.revision
      )
        return structuredClone(cached.value);
      const roles = (
        await pool.query<{ key: string }>(
          `SELECT r.key FROM core_schema.roles r JOIN core_schema.user_roles ur ON ur.role_id=r.id WHERE ur.user_id=$1`,
          [userId],
        )
      ).rows.map((r) => r.key);
      const admin = roles.includes('tenant-admin');
      const permissions = admin
        ? ['tenant.manage', ...actionKeys]
        : (
            await pool.query<{ key: string }>(
              `SELECT DISTINCT pa.action_key AS key FROM core_schema.user_roles ur
         JOIN core_schema.role_permissions rp ON rp.role_id=ur.role_id
         JOIN core_schema.permission_actions pa ON pa.permission_id=rp.permission_id WHERE ur.user_id=$1`,
              [userId],
            )
          ).rows
            .map((r) => r.key)
            .filter((k) => actionKeys.has(k));
      const modules = (
        await pool.query<{ key: string }>(
          `SELECT DISTINCT rm.module_key AS key FROM core_schema.user_roles ur
         JOIN core_schema.role_modules rm ON rm.role_id=ur.role_id WHERE ur.user_id=$1`,
          [userId],
        )
      ).rows.map((r) => r.key);
      const value: TenantAuthorization = {
        roles: ['tenant-user', ...roles.filter((r) => r !== 'tenant-user')],
        permissions: expandTenantActions(permissions),
        moduleKeys: modules,
        authorizationRevision: state.revision,
      };
      if (this.cache.size >= 2000)
        this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, {
        expires: this.now() + 30_000,
        value,
        decisions: new Map(),
      });
      return structuredClone(value);
    });
  }

  allowsModule(
    tenantId: string,
    userId: string,
    access: TenantAuthorization,
    module: string,
    permission: string,
  ): boolean {
    const cached = this.cache.get(`${tenantId}:${userId}`);
    const decisionKey = JSON.stringify([module, permission]);
    const valid =
      cached &&
      cached.expires > this.now() &&
      cached.value.authorizationRevision === access.authorizationRevision;
    const previous = valid ? cached.decisions.get(decisionKey) : undefined;
    if (previous !== undefined) return previous;
    const allowed =
      (access.moduleKeys.includes('*') || access.moduleKeys.includes(module)) &&
      (modulePermissions[module] ?? []).includes(permission) &&
      (permission === 'module.access' ||
        access.permissions.includes(permission));
    if (valid && cached.decisions.size < 64)
      cached.decisions.set(decisionKey, allowed);
    return allowed;
  }

  async listRoles(tenantId: string): Promise<TenantRole[]> {
    return this.database(
      tenantId,
      async (pool) =>
        (
          await pool.query<TenantRole>(`SELECT r.id,r.key,r.name,r.description,r.is_system AS "isSystem",
      ARRAY(SELECT permission_id::text FROM core_schema.role_permissions WHERE role_id=r.id ORDER BY permission_id) AS "permissionIds",
      ARRAY(SELECT module_key FROM core_schema.role_modules WHERE role_id=r.id ORDER BY module_key) AS "moduleKeys",
      ARRAY(SELECT user_id::text FROM core_schema.user_roles WHERE role_id=r.id ORDER BY user_id) AS "userIds"
      FROM core_schema.roles r ORDER BY r.is_system DESC,r.name`)
        ).rows,
    );
  }

  async listPermissions(tenantId: string): Promise<TenantPermission[]> {
    return this.database(
      tenantId,
      async (pool) =>
        (
          await pool.query<TenantPermission>(`SELECT p.id,p.name,p.description,
      ARRAY(SELECT action_key FROM core_schema.permission_actions WHERE permission_id=p.id ORDER BY action_key) AS "actionKeys",
      ARRAY(SELECT role_id::text FROM core_schema.role_permissions WHERE permission_id=p.id ORDER BY role_id) AS "roleIds"
      FROM core_schema.permissions p ORDER BY p.name`)
        ).rows,
    );
  }

  async userRoles(tenantId: string, userId: string) {
    uuid(userId);
    return this.database(tenantId, async (pool) => {
      if (
        !(
          await pool.query('SELECT 1 FROM core_schema.users WHERE id=$1', [
            userId,
          ])
        ).rowCount
      )
        throw new NotFoundException();
      return {
        roleIds: (
          await pool.query<{ role_id: string }>(
            'SELECT role_id FROM core_schema.user_roles WHERE user_id=$1',
            [userId],
          )
        ).rows.map((r) => r.role_id),
      };
    });
  }

  /** Serializes all authorization and user-account writes in this tenant. */
  async mutate<T>(
    tenantId: string,
    actorId: string,
    operation: (client: PostgresClient) => Promise<T>,
    requiredAction?: string,
  ): Promise<T> {
    try {
      return await this.database(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          await client.query(
            'SELECT revision FROM core_schema.authorization_state WHERE id=true FOR UPDATE',
          );
          const admin = await this.isAdmin(client, actorId);
          if (!admin) {
            if (
              !requiredAction ||
              !(
                await client.query(
                  `SELECT 1 FROM core_schema.user_roles ur
            JOIN core_schema.users u ON u.id=ur.user_id AND u.status='active' AND u.is_active=true
            JOIN core_schema.role_permissions rp ON rp.role_id=ur.role_id
            JOIN core_schema.permission_actions pa ON pa.permission_id=rp.permission_id
            WHERE ur.user_id=$1 AND pa.action_key=$2`,
                  [actorId, requiredAction],
                )
              ).rowCount
            )
              throw new ForbiddenException(
                'Không có quyền thực hiện thao tác.',
              );
          }
          return operation(client);
        }),
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505')
        throw new ConflictException('Tên hoặc dữ liệu đã tồn tại.');
      if (code === '23503')
        throw new ConflictException(
          'Dữ liệu còn liên kết sử dụng hoặc liên kết không tồn tại.',
        );
      throw error;
    }
  }

  async isAdmin(client: PostgresClient, userId: string) {
    return !!(
      await client.query(
        `SELECT 1 FROM core_schema.user_roles ur JOIN core_schema.roles r ON r.id=ur.role_id
      JOIN core_schema.users u ON u.id=ur.user_id AND u.status='active' AND u.is_active=true
      WHERE ur.user_id=$1 AND r.key='tenant-admin'`,
        [userId],
      )
    ).rowCount;
  }
  async protectAdmin(client: PostgresClient, userId: string, actorId: string) {
    // Assigned admin roles remain privileged even while the target is disabled.
    const targetAdmin = (
      await client.query(
        `SELECT 1 FROM core_schema.user_roles ur
      JOIN core_schema.roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.key='tenant-admin'`,
        [userId],
      )
    ).rowCount;
    if (targetAdmin && !(await this.isAdmin(client, actorId)))
      throw new ForbiddenException(
        'Chỉ quản trị tenant được sửa tài khoản quản trị.',
      );
  }
  async assertAdminRemains(client: PostgresClient) {
    if (
      !(
        await client.query(`SELECT 1 FROM core_schema.user_roles ur JOIN core_schema.roles r ON r.id=ur.role_id
      JOIN core_schema.users u ON u.id=ur.user_id WHERE r.key='tenant-admin' AND u.status='active' AND u.is_active=true LIMIT 1`)
      ).rowCount
    )
      throw new ConflictException(
        'Tenant phải có ít nhất một quản trị viên đang hoạt động.',
      );
  }
  async audit(
    client: PostgresClient,
    actor: string,
    operation: string,
    subject: string,
    before: unknown,
    after: unknown,
  ) {
    await client.query(
      `INSERT INTO core_schema.authorization_audit(id,actor_id,operation,subject_id,before_data,after_data)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        randomUUID(),
        actor,
        operation,
        subject,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
  }

  async savePermission(
    tenantId: string,
    actor: string,
    input: Record<string, unknown>,
    id?: string,
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Dữ liệu permission không hợp lệ.');
    if (id) uuid(id);
    return this.mutate(tenantId, actor, async (client) => {
      const before = id
        ? (
            await client.query(
              'SELECT id,name,description FROM core_schema.permissions WHERE id=$1',
              [id],
            )
          ).rows[0]
        : null;
      if (id && !before) throw new NotFoundException();
      const oldActions = id
        ? (
            await client.query<{ action_key: string }>(
              'SELECT action_key FROM core_schema.permission_actions WHERE permission_id=$1',
              [id],
            )
          ).rows.map((r) => r.action_key)
        : [];
      const actions = strings(input.actionKeys ?? oldActions);
      if (!actions.length || actions.some((k) => !actionKeys.has(k)))
        throw new BadRequestException('Chọn ít nhất một hành động hợp lệ.');
      const [name, description] = metadata({ ...before, ...input });
      const target = id ?? randomUUID();
      await client.query(
        `INSERT INTO core_schema.permissions(id,name,description) VALUES ($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,updated_at=now()`,
        [target, name, description],
      );
      await client.query(
        'DELETE FROM core_schema.permission_actions WHERE permission_id=$1',
        [target],
      );
      for (const key of actions)
        await client.query(
          'INSERT INTO core_schema.permission_actions VALUES ($1,$2)',
          [target, key],
        );
      await this.audit(
        client,
        actor,
        id ? 'permission.update' : 'permission.create',
        target,
        before ? { ...before, actionKeys: oldActions } : null,
        { name, description, actionKeys: actions },
      );
      return { id: target };
    });
  }

  async saveRole(
    tenantId: string,
    actor: string,
    input: Record<string, unknown>,
    availableModules: readonly string[],
    id?: string,
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Dữ liệu role không hợp lệ.');
    if (id) uuid(id);
    return this.mutate(tenantId, actor, async (client) => {
      const before = id
        ? (
            await client.query('SELECT * FROM core_schema.roles WHERE id=$1', [
              id,
            ])
          ).rows[0]
        : null;
      if (id && !before) throw new NotFoundException();
      if (before?.is_system)
        throw new ConflictException('Không thể chỉnh sửa role hệ thống.');
      const oldPermissions = id
        ? (
            await client.query<{ permission_id: string }>(
              'SELECT permission_id FROM core_schema.role_permissions WHERE role_id=$1',
              [id],
            )
          ).rows.map((r) => r.permission_id)
        : [];
      const oldModules = id
        ? (
            await client.query<{ module_key: string }>(
              'SELECT module_key FROM core_schema.role_modules WHERE role_id=$1',
              [id],
            )
          ).rows.map((r) => r.module_key)
        : [];
      const permissions = strings(input.permissionIds ?? oldPermissions, true);
      const modules = strings(input.moduleKeys ?? oldModules);
      if (modules.some((m) => m === '*' || !availableModules.includes(m)))
        throw new BadRequestException('Module không hợp lệ.');
      if (
        (
          await client.query(
            'SELECT id FROM core_schema.permissions WHERE id=ANY($1::uuid[])',
            [permissions],
          )
        ).rowCount !== permissions.length
      )
        throw new BadRequestException('Permission không tồn tại trong tenant.');
      const [name, description] = metadata({ ...before, ...input });
      const target = id ?? randomUUID();
      await client.query(
        `INSERT INTO core_schema.roles(id,key,name,description) VALUES ($1,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET name=$3,description=$4,updated_at=now()`,
        [target, `custom-${target}`, name, description],
      );
      await client.query(
        'DELETE FROM core_schema.role_permissions WHERE role_id=$1',
        [target],
      );
      await client.query(
        'DELETE FROM core_schema.role_modules WHERE role_id=$1',
        [target],
      );
      for (const pid of permissions)
        await client.query(
          'INSERT INTO core_schema.role_permissions VALUES ($1,$2)',
          [target, pid],
        );
      for (const key of modules)
        await client.query(
          'INSERT INTO core_schema.role_modules VALUES ($1,$2)',
          [target, key],
        );
      await this.audit(
        client,
        actor,
        id ? 'role.update' : 'role.create',
        target,
        before
          ? { ...before, permissionIds: oldPermissions, moduleKeys: oldModules }
          : null,
        { name, description, permissionIds: permissions, moduleKeys: modules },
      );
      return { id: target };
    });
  }

  async remove(
    tenantId: string,
    actor: string,
    kind: 'roles' | 'permissions',
    id: string,
  ) {
    uuid(id);
    return this.mutate(tenantId, actor, async (client) => {
      const before = (
        await client.query(`SELECT * FROM core_schema.${kind} WHERE id=$1`, [
          id,
        ])
      ).rows[0];
      if (!before) throw new NotFoundException();
      if (before.is_system)
        throw new ConflictException('Không thể xóa role hệ thống.');
      const used =
        kind === 'roles'
          ? await client.query(
              'SELECT user_id AS id FROM core_schema.user_roles WHERE role_id=$1',
              [id],
            )
          : await client.query(
              'SELECT role_id AS id FROM core_schema.role_permissions WHERE permission_id=$1',
              [id],
            );
      if (used.rowCount)
        throw new ConflictException({
          code: 'AUTHORIZATION_IN_USE',
          message: 'Gỡ liên kết sử dụng trước khi xóa.',
          linkedIds: used.rows.map((r) => r.id),
        });
      const links =
        kind === 'roles'
          ? {
              permissionIds: (
                await client.query(
                  'SELECT permission_id AS id FROM core_schema.role_permissions WHERE role_id=$1',
                  [id],
                )
              ).rows.map((r) => r.id),
              moduleKeys: (
                await client.query(
                  'SELECT module_key AS key FROM core_schema.role_modules WHERE role_id=$1',
                  [id],
                )
              ).rows.map((r) => r.key),
            }
          : {
              actionKeys: (
                await client.query(
                  'SELECT action_key AS key FROM core_schema.permission_actions WHERE permission_id=$1',
                  [id],
                )
              ).rows.map((r) => r.key),
            };
      await client.query(`DELETE FROM core_schema.${kind} WHERE id=$1`, [id]);
      await this.audit(
        client,
        actor,
        `${kind}.delete`,
        id,
        { ...before, ...links },
        null,
      );
      return { status: 'deleted' };
    });
  }

  async assignRoles(
    tenantId: string,
    actor: string,
    userId: string,
    roleIds: unknown,
  ) {
    uuid(userId);
    const ids = strings(roleIds, true);
    return this.mutate(tenantId, actor, async (client) => {
      if (
        !(
          await client.query('SELECT id FROM core_schema.users WHERE id=$1', [
            userId,
          ])
        ).rowCount
      )
        throw new NotFoundException();
      const before = (
        await client.query<{ role_id: string }>(
          'SELECT role_id FROM core_schema.user_roles WHERE user_id=$1',
          [userId],
        )
      ).rows.map((r) => r.role_id);
      const roles = (
        await client.query<{ id: string; key: string }>(
          'SELECT id,key FROM core_schema.roles WHERE id=ANY($1::uuid[])',
          [ids],
        )
      ).rows;
      if (
        roles.length !== ids.length ||
        roles.some(
          (r) => r.key === 'legacy-tenant-user' && !before.includes(r.id),
        )
      )
        throw new BadRequestException(
          'Role không hợp lệ hoặc chỉ dành cho chuyển tiếp.',
        );
      await client.query(
        'DELETE FROM core_schema.user_roles WHERE user_id=$1',
        [userId],
      );
      for (const role of ids)
        await client.query(
          'INSERT INTO core_schema.user_roles VALUES ($1,$2)',
          [userId, role],
        );
      await client.query(
        `UPDATE core_schema.users SET system_role=$2,updated_at=now() WHERE id=$1`,
        [
          userId,
          roles.some((r) => r.key === 'tenant-admin')
            ? 'tenant-admin'
            : 'tenant-user',
        ],
      );
      await this.assertAdminRemains(client);
      await this.audit(
        client,
        actor,
        'user.roles.replace',
        userId,
        { roleIds: before },
        { roleIds: ids },
      );
      return { roleIds: ids };
    });
  }
  /**
   * Tạo bộ Permission + Role mẫu HRM. Idempotent: ID xác định theo khóa mẫu,
   * đã tồn tại (kể cả đã đổi tên) thì bỏ qua, không ghi đè. Chỉ tenant admin
   * (mutate không truyền requiredAction).
   */
  async seedHrmRoleTemplates(tenantId: string, actor: string) {
    return this.mutate(tenantId, actor, async (client) => {
      const created: string[] = [];
      const skipped: string[] = [];
      for (const template of HRM_ROLE_TEMPLATES) {
        const roleId = hrmTemplateId('role', template.key);
        const permissionId = hrmTemplateId('permission', template.key);
        const role = await client.query(
          `INSERT INTO core_schema.roles(id,key,name,description) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [roleId, `custom-${roleId}`, template.name, template.description],
        );
        if (!role.rowCount) {
          skipped.push(template.name);
          continue;
        }
        await client.query(
          `INSERT INTO core_schema.permissions(id,name,description) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [permissionId, template.name, template.description],
        );
        const permission = await client.query(
          'SELECT id FROM core_schema.permissions WHERE id=$1',
          [permissionId],
        );
        if (!permission.rowCount)
          throw new ConflictException(
            `Đã có quyền trùng tên '${template.name}' không phải bản mẫu; hãy đổi tên rồi thử lại.`,
          );
        for (const key of template.actions)
          await client.query(
            'INSERT INTO core_schema.permission_actions VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [permissionId, key],
          );
        await client.query(
          'INSERT INTO core_schema.role_permissions VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [roleId, permissionId],
        );
        await client.query(
          'INSERT INTO core_schema.role_modules VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [roleId, 'hrm'],
        );
        await this.audit(client, actor, 'role.template.hrm.create', roleId, null, {
          name: template.name,
          actionKeys: template.actions,
        });
        created.push(template.name);
      }
      return { created, skipped };
    });
  }
}
