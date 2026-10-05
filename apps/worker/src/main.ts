import {
  createPostgresPool,
  PostgresPoolRegistry,
  withActiveTenant,
} from '@enterprise-platform/adapter-database';
import { TenantDeletionService } from '@enterprise-platform/platform-tenancy';
import {
  IdempotentInbox,
  RabbitMqConsumer,
  RabbitMqPublisher,
  TransactionalOutboxRelay,
  TransientConsumerError,
} from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import {
  tenantModuleMigrations,
  TenantProvisioningProcessor,
} from '@enterprise-platform/platform-entitlement';
import {
  applyDueDecisions,
  defaultOrgAppointmentPort,
  runHrmAutomation,
  processHrmProcedureSync,
  receiveHrmProcedureResult,
  receiveHrmProcedureStep,
} from '@enterprise-platform/module-hrm';
import type { Pool } from 'pg';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* environment can be injected by the runtime */
}

const publisher = new RabbitMqPublisher(
  process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672',
);
const platformPool = createPostgresPool(
  process.env.PLATFORM_DATABASE_URL ??
    'postgresql://platform:platform@localhost:55432/platform',
);
const tenantPools = new PostgresPoolRegistry(undefined, {
  maxPools: Number(process.env.WORKER_MAX_TENANT_POOLS ?? 100),
  maxConnectionsPerPool: Number(
    process.env.WORKER_MAX_CONNECTIONS_PER_TENANT ?? 4,
  ),
});
const platformRelay = new TransactionalOutboxRelay(
  platformPool,
  publisher,
  50,
  async (event) => Boolean(await activeTenantDatabase(event.tenantId)),
);
const deletion = new TenantDeletionService(platformPool);
const consumer = new RabbitMqConsumer(
  process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672',
  {
    queue: 'maintenance.integrations.v1',
    bindings: [
      'procedure.definition.published',
      'procedure.definition.archived',
      'procedure.instance.started',
      'platform.entitlement.changed',
    ],
  },
);
const hrmConsumer = new RabbitMqConsumer(
  process.env.RABBITMQ_URL ?? 'amqp://platform:platform@localhost:5672',
  {
    queue: 'hrm.integrations.v1',
    bindings: [
      'procedure.instance.completed',
      'procedure.instance.step_changed',
    ],
  },
);

async function hrmEnabled(tenantId: string) {
  return Boolean(
    (
      await platformPool.query(
        `SELECT 1 FROM subscription_schema.tenant_entitlements e JOIN module_registry_schema.modules m ON m.id=e.module_id WHERE e.tenant_id=$1 AND e.status='active' AND m.key='hrm' AND m.status='active'`,
        [tenantId],
      )
    ).rowCount,
  );
}
async function hrmReady(pool: Pool) {
  return Boolean(
    (
      await pool.query(
        `SELECT to_regclass('hrm_schema.automation_settings') AS relation`,
      )
    ).rows[0]?.relation,
  );
}
// Chạy bên trong withActiveTenant (khóa SHARED) của tick; không tự khóa lại.
async function processHrmJobs(database: TenantDatabaseReference) {
  if (!(await hrmEnabled(database.tenantId))) return;
  const pool = (await tenantPools.forTenant(database)) as unknown as Pool;
  if (!(await hrmReady(pool))) return;
  // A failed accrual must not prevent workflow result delivery.
  const outcomes = await Promise.allSettled([
    runHrmAutomation(pool, database.tenantId),
    processHrmProcedureSync(pool, database.tenantId),
    // Quyết định nhân sự đã duyệt đến ngày hiệu lực, hoặc đang chờ thử lại.
    applyDueDecisions(pool, database.tenantId, {
      org: defaultOrgAppointmentPort(),
    }),
  ]);
  for (const outcome of outcomes)
    if (outcome.status === 'rejected')
      console.error(
        'HRM worker will retry:',
        outcome.reason instanceof Error ? outcome.reason.message : 'Job failed',
      );
}
void hrmConsumer
  .start(async (event) => {
    if (
      (event.payload as { sourceType?: string })?.sourceType !== 'hrm_request'
    )
      return;
    const database = await activeTenantDatabase(event.tenantId);
    if (!database) return;
    if (!(await hrmEnabled(event.tenantId)))
      throw new TransientConsumerError('HRM entitlement chưa hoạt động');
    const outcome = await withActiveTenant(
      platformPool,
      event.tenantId,
      async () => {
        const pool = (await tenantPools.forTenant(database)) as unknown as Pool;
        if (!(await hrmReady(pool)))
          throw new TransientConsumerError(
            'HRM cần migration trước khi nhận callback',
          );
        if (event.type === 'procedure.instance.step_changed')
          await receiveHrmProcedureStep(pool, event.tenantId, event);
        else await receiveHrmProcedureResult(pool, event.tenantId, event);
      },
      { mode: 'shared' },
    );
    if (!outcome.executed && outcome.reason === 'busy')
      throw new TransientConsumerError(
        `Tenant ${event.tenantId} đang bận (khóa exclusive)`,
      );
  })
  .catch((error) =>
    console.error(
      'HRM consumer requires restart:',
      error instanceof Error ? error.message : 'Connection failed',
    ),
  );
const provisioning = new TenantProvisioningProcessor(
  process.env.PLATFORM_DATABASE_URL ??
    'postgresql://platform:platform@localhost:55432/platform',
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

function toTenantDatabaseReference(
  row: TenantDatabaseRow,
): TenantDatabaseReference {
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

async function activeTenantDatabase(
  tenantId: string,
): Promise<TenantDatabaseReference | null> {
  const result = await platformPool.query<TenantDatabaseRow>(
    `SELECT d.tenant_id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version
       FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.status = 'active' AND t.status = 'active'`,
    [tenantId],
  );
  return result.rows[0] ? toTenantDatabaseReference(result.rows[0]) : null;
}

async function activeTenantDatabases(): Promise<
  readonly TenantDatabaseReference[]
> {
  const result = await platformPool.query<TenantDatabaseRow>(
    `SELECT d.tenant_id, d.database_name, d.host, d.port, d.secret_ref, d.ssl, d.config_version
       FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id = d.tenant_id
      WHERE d.status = 'active' AND t.status = 'active'`,
  );
  return result.rows.map(toTenantDatabaseReference);
}

async function processPendingDeletions(): Promise<void> {
  const table = await platformPool.query<{ relation: string | null }>(
    `SELECT to_regclass('integration_schema.tenant_deletion_jobs')::text AS relation`,
  );
  if (!table.rows[0]?.relation) {
    console.warn(
      'Tenant deletion migration is not installed; skipping deletion jobs until migrator completes.',
    );
    return;
  }
  await deletion.processPending();
}

async function flushTenantOutbox(
  database: TenantDatabaseReference,
): Promise<void> {
  const pool = await tenantPools.forTenant(database);
  const exists = await pool.query<{ exists: string | null }>(
    `SELECT to_regclass('integration_schema.outbox_events')::text AS exists`,
  );
  if (!exists.rows[0]?.exists) return;
  await new TransactionalOutboxRelay(pool, publisher).flush();
}

/** Một lần withActiveTenant (khóa SHARED) cho mỗi tenant mỗi tick: outbox rồi HRM jobs, tuần tự. */
async function processTenantTick(
  database: TenantDatabaseReference,
): Promise<void> {
  const outcome = await withActiveTenant(
    platformPool,
    database.tenantId,
    async () => {
      const errors: unknown[] = [];
      for (const step of [flushTenantOutbox, processHrmJobs]) {
        try {
          await step(database);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw errors[0];
    },
    { mode: 'shared' },
  );
  if (!outcome.executed && outcome.reason === 'busy')
    console.warn(
      `Tenant ${database.tenantId} đang bận (provisioning/migration/xóa); bỏ qua tick này.`,
    );
}

async function handleMaintenanceEvent(event: IntegrationEventEnvelope) {
  // A deletion may own the lifecycle lock: acknowledge closed tenants directly,
  // instead of requeueing their messages while the deletion drains the broker.
  if (!(await activeTenantDatabase(event.tenantId))) return;
  const outcome = await withActiveTenant(
    platformPool,
    event.tenantId,
    async () => {
      const database = await activeTenantDatabase(event.tenantId);
      if (!database) return;
      const pool = await tenantPools.forTenant(database);
      const exists = await pool.query<{ exists: string | null }>(
        `SELECT to_regclass('maintenance_schema.schedules')::text AS exists`,
      );
      if (!exists.rows[0]?.exists) return;
      const inbox = new IdempotentInbox(pool, 'maintenance.integrations.v1');
      await inbox.process(event, async () => {
        const payload = event.payload as Record<string, unknown>;
        if (event.type === 'procedure.definition.published') {
          await pool.query(
            `INSERT INTO maintenance_schema.procedure_catalog
        (definition_id,code,name,version_number,status,synchronized_at)
        VALUES ($1,$2,$3,$4,'published',now()) ON CONFLICT (definition_id)
        DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,version_number=EXCLUDED.version_number,status='published',synchronized_at=now()`,
            [
              payload.definitionId,
              payload.code,
              payload.name,
              payload.versionNumber,
            ],
          );
        } else if (event.type === 'procedure.definition.archived') {
          await pool.query(
            `UPDATE maintenance_schema.procedure_catalog SET status='archived',synchronized_at=now() WHERE definition_id=$1`,
            [payload.definitionId],
          );
          await pool.query(
            `UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_DEFINITION_UNAVAILABLE',updated_at=now() WHERE procedure_definition_id=$1 AND status='active'`,
            [payload.definitionId],
          );
        } else if (event.type === 'procedure.instance.started') {
          await pool.query(
            `UPDATE maintenance_schema.occurrences SET status='generated',procedure_instance_id=$2,procedure_instance_code=$3 WHERE id=$1`,
            [payload.occurrenceId, payload.instanceId, payload.instanceCode],
          );
        } else if (
          event.type === 'platform.entitlement.changed' &&
          payload.moduleKey === 'procedure-engine'
        ) {
          if (payload.enabled === false) {
            await pool.query(
              `UPDATE maintenance_schema.schedules SET status='paused',paused_reason='PROCEDURE_ENTITLEMENT_DISABLED',updated_at=now() WHERE procedure_definition_id IS NOT NULL AND status='active'`,
            );
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
    },
    { mode: 'shared' },
  );
  if (!outcome.executed && outcome.reason === 'busy')
    throw new TransientConsumerError(
      `Tenant ${event.tenantId} đang bận (khóa exclusive)`,
    );
}

void consumer.start(handleMaintenanceEvent).catch((error) => {
  console.error(
    'Maintenance consumer will require process restart:',
    error instanceof Error ? error.message : error,
  );
});

async function tick() {
  if (running) return;
  running = true;
  try {
    await processPendingDeletions();
    await provisioning.processPending();
    const databases = await activeTenantDatabases();
    await tenantPools.retainTenants(
      new Set(databases.map((database) => database.tenantId)),
    );
    const results = await Promise.allSettled([
      platformRelay.flush(),
      ...databases.map(processTenantTick),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(
          'Worker outbox relay will retry:',
          result.reason instanceof Error
            ? result.reason.message
            : result.reason,
        );
      }
    }
  } catch (error) {
    console.error(
      'Worker tick will retry:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  void tick();
}, 1_000);
void tick();

async function shutdown() {
  clearInterval(timer);
  deletion.close();
  await Promise.all([
    provisioning.close(),
    publisher.close(),
    consumer.close(),
    hrmConsumer.close(),
    tenantPools.closeAll(),
    platformPool.end(),
  ]);
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
