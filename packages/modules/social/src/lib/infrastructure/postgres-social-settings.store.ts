import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import {
  SOCIAL_DEFAULT_SETTINGS,
  SOCIAL_SETTING_KEYS,
  type SocialSettings,
  type UpdateSocialSettingsRequest,
} from '@enterprise-platform/contracts-social';
import type { Pool } from 'pg';
import type { SocialSettingsPort } from '../application/ports/social-settings.port.js';
import { SocialNotProvisionedError } from '../domain/social.error.js';

/**
 * Cài đặt phân hệ trong `social_schema.settings` (key/value JSON). Thiếu dòng thì dùng
 * `SOCIAL_DEFAULT_SETTINGS`. Hiện thực `SocialSettingsPort` (token `SOCIAL_SETTINGS`).
 */
export class PostgresSocialSettingsStore implements SocialSettingsPort {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  private async run<T>(tenantId: string, operation: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = await this.poolFor(tenantId);
    try {
      return await operation(pool);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === '3F000') throw new SocialNotProvisionedError();
      throw error;
    }
  }

  get(tenantId: string): Promise<SocialSettings> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM social_schema.settings WHERE key = ANY($1::text[])`,
        [Object.values(SOCIAL_SETTING_KEYS)],
      );
      const byKey = new Map(result.rows.map((row) => [row.key, row.value]));
      const approval = byKey.get(SOCIAL_SETTING_KEYS.wallRequireApproval);
      return {
        wallRequireApproval:
          typeof approval === 'boolean' ? approval : SOCIAL_DEFAULT_SETTINGS.wallRequireApproval,
      };
    });
  }

  async update(tenantId: string, patch: UpdateSocialSettingsRequest, userId: string): Promise<SocialSettings> {
    await this.run(tenantId, async (pool) => {
      if (patch.wallRequireApproval !== undefined) {
        await pool.query(
          `INSERT INTO social_schema.settings (key, value, updated_by)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [SOCIAL_SETTING_KEYS.wallRequireApproval, JSON.stringify(patch.wallRequireApproval), userId],
        );
      }
    });
    return this.get(tenantId);
  }
}
