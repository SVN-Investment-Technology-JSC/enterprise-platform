import {
  PostgresPoolRegistry,
  type createPostgresPool,
} from '@enterprise-platform/adapter-database';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import {
  NotificationDeliveryRelay,
  PostgresNotificationStore,
  PostgresRecipientDirectory,
  type NotificationDeliveryPublisher,
} from '@enterprise-platform/module-notifications';
import type {
  NotificationTenantRuntime,
  NotificationTenantRuntimeRegistry,
} from './notification-processor.js';

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
    const pool = await this.pools.forTenant(reference);
    return {
      directory: new PostgresRecipientDirectory(pool),
      store: new PostgresNotificationStore(pool),
      relay: new NotificationDeliveryRelay(pool, this.publisher),
    };
  }
}
