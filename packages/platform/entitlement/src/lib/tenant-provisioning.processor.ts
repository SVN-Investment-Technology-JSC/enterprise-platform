import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createPostgresPool,
  inTransaction,
} from '@enterprise-platform/adapter-database';

type PostgresPool = ReturnType<typeof createPostgresPool>;

interface ProvisioningJob {
  readonly id: string;
  readonly tenant_id: string;
  readonly module_key: string;
  readonly target_version: string;
  readonly module_id: string | null;
  readonly secret_ref: string | null;
}

interface ModuleMigration {
  readonly moduleKey: string;
  readonly migrationVersion: string;
  readonly path: string;
}

const MODULE_MIGRATIONS: Readonly<Record<string, readonly ModuleMigration[]>> = {
  'procedure-engine': [
    {
      moduleKey: 'procedure-engine',
      migrationVersion: '0001-procedure',
      path: 'tenant/procedure/0001-procedure.sql',
    },
    {
      moduleKey: 'procedure-engine',
      migrationVersion: '0002-normalized-model',
      path: 'tenant/procedure/0002-normalized-model.sql',
    },
    {
      moduleKey: 'procedure-engine',
      migrationVersion: '0003-runtime-model',
      path: 'tenant/procedure/0002-runtime-model.sql',
    },
  ],
  crm: [
    {
      moduleKey: 'crm',
      migrationVersion: '0001-crm',
      path: 'tenant/crm/0001-crm.sql',
    },
  ],
  maintenance: [
    {
      moduleKey: 'maintenance',
      migrationVersion: '0001-maintenance',
      path: 'tenant/maintenance/0001-maintenance.sql',
    },
  ],
  inventory: [
    {
      moduleKey: 'inventory',
      migrationVersion: '0001-inventory',
      path: 'tenant/inventory/0001-inventory.sql',
    },
    {
      moduleKey: 'inventory',
      migrationVersion: '0002-minh-long-amm-seed-sync',
      path: 'tenant/inventory/0002-minh-long-amm-seed-sync.sql',
    },
  ],
};

/**
 * Claims provisioning jobs from Platform DB and applies only the migration
 * owned by the requested module to the tenant's dedicated database.
 */
export class TenantProvisioningProcessor {
  private readonly platform: PostgresPool;

  constructor(platformDatabaseUrl: string) {
    this.platform = createPostgresPool(platformDatabaseUrl, {
      max: 4,
      application_name: 'enterprise-platform:provisioning-worker',
    });
  }

  async processPending(limit = 3): Promise<number> {
    const result = await this.platform.query<ProvisioningJob>(
      `WITH claimed AS (
         SELECT id
           FROM integration_schema.provisioning_jobs
          WHERE status = 'pending'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       ), updated AS (
         UPDATE integration_schema.provisioning_jobs job
            SET status = 'processing', error = NULL, completed_at = NULL
           FROM claimed
          WHERE job.id = claimed.id
          RETURNING job.id, job.tenant_id, job.module_key, job.target_version
       )
       SELECT updated.id, updated.tenant_id, updated.module_key, updated.target_version,
              module.id AS module_id, database.secret_ref
         FROM updated
         LEFT JOIN module_registry_schema.modules module
           ON module.key = updated.module_key AND module.status = 'active'
         LEFT JOIN tenancy_schema.tenant_db_configs database
           ON database.tenant_id = updated.tenant_id AND database.status = 'active'`,
      [Math.max(1, Math.min(limit, 20))],
    );

    await Promise.all(result.rows.map((job) => this.process(job)));
    return result.rowCount ?? result.rows.length;
  }

  async close(): Promise<void> {
    await this.platform.end();
  }

  private async process(job: ProvisioningJob): Promise<void> {
    const migrations = MODULE_MIGRATIONS[job.module_key];
    if (!migrations || migrations.length === 0) {
      await this.fail(job, `No migration is registered for module ${job.module_key}.`);
      return;
    }
    if (!job.module_id) {
      await this.fail(job, `Module ${job.module_key} is not active in Module Registry.`);
      return;
    }
    if (!job.secret_ref) {
      await this.fail(job, 'Tenant does not have an active database configuration.');
      return;
    }
    const connectionString = process.env[job.secret_ref];
    if (!connectionString) {
      await this.fail(job, `Database secret ${job.secret_ref} is not configured.`);
      return;
    }

    const tenant = createPostgresPool(connectionString, {
      max: 2,
      connectionTimeoutMillis: 5_000,
      application_name: `enterprise-platform:provisioning:${job.tenant_id}`,
    });
    try {
      await this.migrate(
        tenant,
        'integration',
        '0001-integration',
        'tenant/0001-integration.sql',
      );
      for (const migration of migrations) {
        await this.migrate(
          tenant,
          migration.moduleKey,
          migration.migrationVersion,
          migration.path,
        );
      }
      await inTransaction(this.platform, async (client) => {
        const completed = await client.query(
          `UPDATE integration_schema.provisioning_jobs
              SET status = 'completed', completed_at = now(), error = NULL
            WHERE id = $1 AND status = 'processing'`,
          [job.id],
        );
        if (!completed.rowCount) return;
        await client.query(
          `UPDATE subscription_schema.tenant_entitlements
              SET status = 'active', provisioned_version = $3, updated_at = now()
            WHERE tenant_id = $1 AND module_id = $2`,
          [job.tenant_id, job.module_id, job.target_version],
        );
      });
    } catch (error) {
      await this.fail(
        job,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      await tenant.end();
    }
  }

  private async fail(job: ProvisioningJob, message: string): Promise<void> {
    console.error(
      `Provisioning failed for tenant ${job.tenant_id}, module ${job.module_key}: ${message}`,
    );
    await inTransaction(this.platform, async (client) => {
      const failed = await client.query(
        `UPDATE integration_schema.provisioning_jobs
            SET status = 'failed', completed_at = now(), error = left($2, 2000)
          WHERE id = $1 AND status = 'processing'`,
        [job.id, message],
      );
      if (!failed.rowCount || !job.module_id) return;
      await client.query(
        `UPDATE subscription_schema.tenant_entitlements
            SET status = 'failed', updated_at = now()
          WHERE tenant_id = $1 AND module_id = $2 AND status = 'provisioning'`,
        [job.tenant_id, job.module_id],
      );
    });
  }

  private async migrate(
    pool: PostgresPool,
    moduleKey: string,
    version: string,
    relativePath: string,
  ): Promise<void> {
    const sql = await this.readMigration(relativePath);
    const checksum = createHash('sha256').update(sql).digest('hex');
    try {
      const existing = await pool.query<{ checksum: string }>(
        `SELECT checksum
           FROM integration_schema.schema_migrations
          WHERE module_key = $1 AND version = $2`,
        [moduleKey, version],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Checksum mismatch for ${moduleKey}/${version}.`);
        }
        return;
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '42P01' && code !== '3F000') throw error;
    }

    await inTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        `INSERT INTO integration_schema.schema_migrations (module_key, version, checksum)
         VALUES ($1, $2, $3)
         ON CONFLICT (module_key, version) DO NOTHING`,
        [moduleKey, version, checksum],
      );
    });
  }

  private async readMigration(relativePath: string): Promise<string> {
    const candidates = [
      join(process.cwd(), 'migrations', relativePath),
      join(process.cwd(), '..', '..', 'migrations', relativePath),
      join(dirname(process.argv[1] ?? process.cwd()), 'migrations', relativePath),
    ];
    for (const candidate of candidates) {
      try {
        return await readFile(candidate, 'utf8');
      } catch {
        // Development and packaged worker use different asset roots.
      }
    }
    throw new Error(`Migration file not found: ${relativePath}`);
  }
}
