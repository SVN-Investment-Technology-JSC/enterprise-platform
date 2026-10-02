import {
  PostgresPoolRegistry,
  withActiveTenant,
  type createPostgresPool,
} from '@enterprise-platform/adapter-database';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import {
  NotificationDeliveryRelay,
  PostgresNotificationStore,
  PostgresNotificationScheduler,
  PostgresRecipientDirectory,
  type NotificationDeliveryPublisher,
} from '@enterprise-platform/module-notifications';
import type {
  NotificationTenantRuntime,
  NotificationTenantRuntimeRegistry,
} from './notification-processor.js';
import { PostgresNotificationScheduleSource } from './notification-schedule-source';

type PlatformPool = ReturnType<typeof createPostgresPool>;

interface TenantDatabaseRow {
  tenant_id: string;
  database_name: string;
  host: string;
  port: number;
  secret_ref: string;
  ssl: boolean;
  config_version: number;
}

export class PostgresNotificationTenantRuntimeRegistry
  implements NotificationTenantRuntimeRegistry
{
  constructor(
    private readonly platform: PlatformPool,
    private readonly pools: PostgresPoolRegistry,
    private readonly publisher: NotificationDeliveryPublisher,
  ) {}

  async resolve(tenantId: string): Promise<NotificationTenantRuntime | undefined> {
    const pool = await this.resolvePool(tenantId);
    if (!pool) return undefined;
    return {
      directory: new PostgresRecipientDirectory(pool),
      store: new PostgresNotificationStore(pool),
      relay: new NotificationDeliveryRelay(pool, this.publisher),
    };
  }

  async listActiveTenantIds(): Promise<readonly string[]> {
    const result = await this.platform.query<{ id: string }>(
      `SELECT tenant.id FROM tenancy_schema.tenants tenant
        JOIN tenancy_schema.tenant_db_configs database ON database.tenant_id = tenant.id
       WHERE tenant.status = 'active' AND database.status = 'active' ORDER BY tenant.id`);
    return result.rows.map((row) => row.id);
  }

  async maintain(tenantId: string, options: { schedule: boolean; cleanup: boolean }, now: Date): Promise<boolean> {
    const outcome = await withActiveTenant(this.platform, tenantId, async () => {
      const pool = await this.resolvePool(tenantId);
      if (!pool) return;
      const tables = await pool.query<{ notifications: boolean; outbox: boolean }>(
        `SELECT to_regclass('notification_schema.notification_events') IS NOT NULL AS notifications,
                to_regclass('integration_schema.outbox_events') IS NOT NULL AS outbox`);
      if (!tables.rows[0]?.notifications) return;
      const relay = new NotificationDeliveryRelay(pool, this.publisher);
      await relay.flush();
      if (options.schedule && tables.rows[0].outbox) {
        const source = new PostgresNotificationScheduleSource(pool, process.env.NOTIFICATION_DEADLINE_TIMEZONE ?? 'Asia/Ho_Chi_Minh');
        await new PostgresNotificationScheduler(pool).emitDue(tenantId, await source.candidates(now), now);
      }
      if (options.cleanup) {
        await new PostgresNotificationStore(pool).removeExpired(tenantId);
        await relay.flush();
      }
    });
    return outcome.executed;
  }

  private async resolvePool(tenantId: string) {
    const result = await this.platform.query<TenantDatabaseRow>(
      `SELECT database.tenant_id, database.database_name, database.host,
              database.port, database.secret_ref, database.ssl,
              database.config_version
         FROM tenancy_schema.tenant_db_configs database
         JOIN tenancy_schema.tenants tenant ON tenant.id = database.tenant_id
        WHERE database.tenant_id = $1
          AND database.status = 'active'
          AND tenant.status = 'active'`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      await this.pools.closeTenant(tenantId);
      return undefined;
    }
    const reference: TenantDatabaseReference = {
      tenantId: row.tenant_id,
      databaseName: row.database_name,
      host: row.host,
      port: row.port,
      secretRef: row.secret_ref,
      ssl: row.ssl,
      configVersion: row.config_version,
    };
    return this.pools.forTenant(reference);
  }
}
