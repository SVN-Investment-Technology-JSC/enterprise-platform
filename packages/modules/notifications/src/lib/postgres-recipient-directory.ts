import type { Pool } from 'pg';
import type { RecipientDirectory } from './notification-policy.js';

export class PostgresRecipientDirectory implements RecipientDirectory {
  constructor(private readonly pool: Pool) {}

  async activeUsers(userIds: readonly string[]): Promise<readonly string[]> {
    if (userIds.length === 0) return [];
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM core_schema.users
        WHERE id = ANY($1::uuid[])
          AND status = 'active'
          AND is_active = true`,
      [userIds],
    );
    const active = new Set(result.rows.map((row) => row.id));
    return userIds.filter((userId) => active.has(userId));
  }

  async allActiveUsers(): Promise<readonly string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM core_schema.users
        WHERE status = 'active'
          AND is_active = true`,
    );
    return result.rows.map((row) => row.id);
  }

  async usersWithPermission(permission: string): Promise<readonly string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT DISTINCT users.id
         FROM core_schema.users users
        WHERE users.status = 'active'
          AND users.is_active = true
          AND (
            EXISTS (
              SELECT 1
                FROM core_schema.user_roles user_roles
                JOIN core_schema.roles roles ON roles.id = user_roles.role_id
                LEFT JOIN core_schema.role_permissions role_permissions
                  ON role_permissions.role_id = roles.id
                LEFT JOIN core_schema.permission_actions permission_actions
                  ON permission_actions.permission_id = role_permissions.permission_id
               WHERE user_roles.user_id = users.id
                 AND (roles.key = 'tenant-admin' OR permission_actions.action_key = $1)
            )
            OR EXISTS (
              SELECT 1
                FROM core_schema.user_permission_grants grants
               WHERE grants.user_id = users.id
                 AND grants.action_key = $1
            )
          )`,
      [permission],
    );
    return result.rows.map((row) => row.id);
  }
}
