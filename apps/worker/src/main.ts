import { createPostgresPool, PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { IdempotentInbox, RabbitMqConsumer, RabbitMqPublisher, TransactionalOutboxRelay } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import { tenantModuleMigrations, TenantProvisioningProcessor } from '@enterprise-platform/platform-entitlement';

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }

const publisher = new RabbitMqPublisher(process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672');
const platformPool = createPostgresPool(process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform');
const tenantPools = new PostgresPoolRegistry(undefined, {
  maxPools: Number(process.env.WORKER_MAX_TENANT_POOLS ?? 100),
  maxConnectionsPerPool: Number(process.env.WORKER_MAX_CONNECTIONS_PER_TENANT ?? 4),
});
const platformRelay = new TransactionalOutboxRelay(platformPool, publisher);
const consumer = new RabbitMqConsumer(process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672', {
  queue: 'maintenance.integrations.v1',
  bindings: ['procedure.definition.published', 'procedure.definition.archived', 'procedure.instance.started', 'platform.entitlement.changed'],
});
const provisioning = new TenantProvisioningProcessor(
  process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform',
  tenantModuleMigrations,
);
let running = false;

interface TenantDatabaseRow {
  readonly tenant_id: string;
  readonly database_name: string;
  readonly host: string;
  readonly port: number;
  readonly secret_ref: string;
  readonly ssl: boolean;
  readonly config_version: number;
}

function toTenantDatabaseReference(row: TenantDatabaseRow): TenantDatabaseReference {
  return {
    tenantId: row.tenant_id,
    databaseName: row.database_name,
    host: row.host,
    port: row.port,
    secretRef: row.secret_ref,
    ssl: row.ssl,
    configVersion: row.config_version,
  };
}

async function activeTenantDatabase(tenantId: string): Promise<TenantDatabaseReference | null> {
  const result = await platformPool.query<TenantDatabaseRow>(
    `SELECT d.tenant_id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version
       FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.status = 'active' AND t.status = 'active'`,
    [tenantId],
  );
  return result.rows[0] ? toTenantDatabaseReference(result.rows[0]) : null;
}

async function activeTenantDatabases(): Promise<readonly TenantDatabaseReference[]> {
  const result = await platformPool.query<TenantDatabaseRow>(
    `SELECT d.tenant_id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version
       FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id = d.tenant_id
      WHERE d.status = 'active' AND t.status = 'active'`,
  );
  return result.rows.map(toTenantDatabaseReference);
}

async function flushTenantOutbox(database: TenantDatabaseReference): Promise<void> {
  const pool = await tenantPools.forTenant(database);
  const exists = await pool.query<{ exists: string | null }>(
    `SELECT to_regclass('integration_schema.outbox_events')::text AS exists`,
  );
  if (!exists.rows[0]?.exists) return;
  await new TransactionalOutboxRelay(pool, publisher).flush();
}

async function handleMaintenanceEvent(event: IntegrationEventEnvelope) {
  const database = await activeTenantDatabase(event.tenantId);
  if (!database) return;
  const pool = await tenantPools.forTenant(database);
  const exists = await pool.query<{ exists: string | null }>(`SELECT to_regclass('maintenance_schema.schedules')::text AS exists`);
  if (!exists.rows[0]?.exists) return;
  const inbox = new IdempotentInbox(pool, 'maintenance.integrations.v1');
  await inbox.process(event, async () => {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'procedure.definition.published') {
      await pool.query(`INSERT INTO maintenance_schema.procedure_catalog
        (definition_id,code,name,version_number,status,synchronized_at)
        VALUES ($1,$2,$3,$4,'published',now()) ON CONFLICT (definition_id)
        DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,version_number=EXCLUDED.version_number,status='published',synchronized_at=now()`,
        [payload.definitionId,payload.code,payload.name,payload.versionNumber]);
    } else if (event.type === 'procedure.definition.archived') {
      await pool.query(`UPDATE maintenance_schema.procedure_catalog SET status='archived',synchronized_at=now() WHERE definition_id=$1`,[payload.definitionId]);
      await pool.query(`UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_DEFINITION_UNAVAILABLE',updated_at=now() WHERE procedure_definition_id=$1 AND status='active'`,[payload.definitionId]);
    } else if (event.type === 'procedure.instance.started') {
      await pool.query(`UPDATE maintenance_schema.occurrences SET status='generated',procedure_instance_id=$2,procedure_instance_code=$3 WHERE id=$1`,[payload.occurrenceId,payload.instanceId,payload.instanceCode]);
    } else if (event.type === 'platform.entitlement.changed' && payload.moduleKey === 'procedure-engine') {
      if (payload.enabled === false) {
        await pool.query(`UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_ENTITLEMENT_DISABLED',updated_at=now() WHERE procedure_definition_id IS NOT NULL AND status='active'`);
      } else {
        await pool.query(`UPDATE maintenance_schema.schedules s SET status='active',paused_reason=NULL,updated_at=now()
          FROM maintenance_schema.procedure_catalog p WHERE s.procedure_definition_id=p.definition_id
          AND p.status='published' AND s.status='paused' AND s.paused_reason='PROCEDURE_ENTITLEMENT_DISABLED'`);
        await pool.query(`UPDATE maintenance_schema.schedules s SET paused_reason='PROCEDURE_DEFINITION_UNAVAILABLE',updated_at=now()
          WHERE s.status='paused' AND s.paused_reason='PROCEDURE_ENTITLEMENT_DISABLED'
          AND NOT EXISTS (SELECT 1 FROM maintenance_schema.procedure_catalog p WHERE p.definition_id=s.procedure_definition_id AND p.status='published')`);
      }
    }
  });
}

void consumer.start(handleMaintenanceEvent).catch((error) => {
  console.error('Maintenance consumer will require process restart:', error instanceof Error ? error.message : error);
});

async function tick() {
  if (running) return;
  running = true;
  try {
    await provisioning.processPending();
    const databases = await activeTenantDatabases();
    const results = await Promise.allSettled([
      platformRelay.flush(),
      ...databases.map(flushTenantOutbox),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Worker outbox relay will retry:', result.reason instanceof Error ? result.reason.message : result.reason);
      }
    }
  } catch (error) {
    console.error('Worker tick will retry:', error instanceof Error ? error.message : error);
  } finally { running = false; }
}

const timer = setInterval(() => { void tick(); }, 1_000);
void tick();

async function shutdown() {
  clearInterval(timer);
  await Promise.all([
    provisioning.close(),
    publisher.close(),
    consumer.close(),
    tenantPools.closeAll(),
    platformPool.end(),
  ]);
}

process.on('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
