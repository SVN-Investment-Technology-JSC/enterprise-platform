import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPostgresPool, inTransaction, resolveTenantDatabaseUrl, withActiveTenant } from '@enterprise-platform/adapter-database';
import {
  TENANT_CORE_MIGRATIONS,
  tenantModuleMigrations,
} from '@enterprise-platform/platform-entitlement';
import { assertMigratorEnvironment } from './production-environment';
import { seedPlatform } from './seed-platform';

type PostgresPool = ReturnType<typeof createPostgresPool>;

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }
assertMigratorEnvironment();

const platformUrl = process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform';

async function main() {
  const platform = createPostgresPool(platformUrl);
  try {
    if (process.argv.includes('--hrm-only')) {
      await upgradeActiveEntitlements(platform, 'hrm');
      console.log('HRM migrations completed for active entitlements.');
      return;
    }
    if (process.argv.includes('--ensure-tenant-core')) {
      await ensureTenantCoreForAllowlist(platform);
      return;
    }
    if (process.argv.includes('--tenant-rbac-only')) {
      await migrateTenantCoreSchemas(platform, true);
      console.log('Tenant RBAC migrations completed.');
      return;
    }
    await migrate(platform, 'platform-core', '0001-platform', 'platform/0001-platform.sql');
    await migrate(platform, 'platform-core', '0003-platform-events', 'platform/0003-platform-events.sql');
    await migrate(platform, 'platform-core', '0004-tenant-password-reset', 'platform/0004-tenant-password-reset.sql');
    await migrate(platform, 'platform-core', '0005-drop-legacy-organization', 'platform/0005-drop-legacy-organization.sql');
    await migrate(platform, 'platform-core', '0006-tenant-deletion', 'platform/0006-tenant-deletion.sql');
    await migrate(platform, 'platform-core', '0007-remove-crm', 'platform/0007-remove-crm.sql');
    await migrate(platform, 'platform-core', '0009-tenant-storage-quota', 'platform/0009-tenant-storage-quota.sql');
    await migrate(platform, 'platform-core', '0010-brand-icon-storage', 'platform/0010-brand-icon-storage.sql');
    await migrate(platform, 'platform-core', '0011-brand-icon-slots', 'platform/0011-brand-icon-slots.sql');
    await migrate(platform, 'platform-core', '0012-brand-custom-slots', 'platform/0012-brand-custom-slots.sql');
    await migrate(platform, 'platform-core', '0013-brand-slot-groups', 'platform/0013-brand-slot-groups.sql');
    await migrate(platform, 'platform-core', '0014-brand-slot-overrides', 'platform/0014-brand-slot-overrides.sql');
    await migrateTenantCoreSchemas(platform);
    await processProvisioningJobs(platform);
    await upgradeActiveEntitlements(platform);
    if (!process.argv.includes('--migrate-only')) await seedPlatform(platform);
    console.log('Platform migrations and tenant provisioning completed.');
  } finally { await platform.end(); }
}

interface ProvisioningJob {
  id: string;
  tenant_id: string;
  module_key: 'inventory' | 'procedure-engine' | 'maintenance' | 'workspace' | 'hrm' | 'assistant' | 'finance' | 'shared' | 'social' | 'crm' | 'correspondence';
  target_version: string;
  module_id: string;
  secret_ref: string;
  database_name: string;
}

interface ActiveEntitlement {
  tenant_id: string;
  module_key: ProvisioningJob['module_key'];
  secret_ref: string;
  database_name: string;
}

/**
 * Ap migration core MOI (0010) len tenant DA TON TAI, chi voi tenant nam trong allowlist slug:
 *   --ensure-tenant-core --tenants=testrun2,testrun3
 *   hoac TENANT_CORE_ENSURE_SLUGS=testrun2,testrun3 (co CLI --tenants uu tien).
 * Allowlist rong => khong ap tenant nao (an toan mac dinh). Khong bao gio chay trong luong migrate thuong.
 */
const ENSURE_TENANT_CORE_MIGRATIONS = [
  { version: '0010-outbox-envelope-and-node-types', path: 'tenant/core/0010-outbox-envelope-and-node-types.sql' },
] as const;

function ensureTenantCoreAllowlist(): string[] {
  const cli = process.argv.find((arg) => arg.startsWith('--tenants='))?.slice('--tenants='.length);
  return (cli ?? process.env.TENANT_CORE_ENSURE_SLUGS ?? '')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter(Boolean);
}

async function ensureTenantCoreForAllowlist(platform: PostgresPool) {
  const allowlist = ensureTenantCoreAllowlist();
  if (!allowlist.length) {
    console.log('[ensure-tenant-core] Allowlist rong (--tenants= hoac TENANT_CORE_ENSURE_SLUGS): khong ap tenant nao.');
    return;
  }
  const configs = await platform.query<{ slug: string; tenant_id: string; secret_ref: string; database_name: string }>(
    `SELECT t.slug,d.tenant_id,d.secret_ref,d.database_name FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id=d.tenant_id
       WHERE d.status='active' AND t.status IN ('active','disabled') AND lower(t.slug)=ANY($1::text[])`,
    [allowlist],
  );
  const found = new Set(configs.rows.map((row) => row.slug.toLowerCase()));
  for (const slug of allowlist) if (!found.has(slug)) console.warn(`[ensure-tenant-core] Khong tim thay tenant hoat dong voi slug "${slug}"; bo qua.`);
  for (const config of configs.rows) {
    console.log(`[ensure-tenant-core] Tenant ${config.slug} (${config.database_name}): bat dau.`);
    const tenant = createPostgresPool(resolveTenantDatabaseUrl(config.secret_ref, config.database_name));
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      const ready = await tenant.query<{ ok: boolean }>(
        `SELECT to_regclass('core_schema.organization_node_assignments') IS NOT NULL
            AND to_regclass('core_schema.organization_node_types') IS NOT NULL AS ok`,
      );
      if (!ready.rows[0]?.ok) {
        console.warn(`[ensure-tenant-core] Tenant ${config.slug}: thieu bang core; bo qua (can chay migrate day du truoc).`);
        continue;
      }
      for (const item of ENSURE_TENANT_CORE_MIGRATIONS) await migrate(tenant, 'tenant-core', item.version, item.path);
      console.log(`[ensure-tenant-core] Tenant ${config.slug}: hoan tat.`);
    } finally {
      await tenant.end();
    }
  }
}

async function migrateTenantCoreSchemas(platform: PostgresPool, rbacOnly = false) {
  const configs = await platform.query<{ tenant_id: string; secret_ref: string; database_name: string }>(
    `SELECT d.tenant_id,d.secret_ref,d.database_name FROM tenancy_schema.tenant_db_configs d
       JOIN tenancy_schema.tenants t ON t.id=d.tenant_id
       WHERE d.status='active' AND t.status IN ('active','disabled')`,
  );
  for (const config of configs.rows) {
    let connectionString: string;
    try {
      connectionString = resolveTenantDatabaseUrl(config.secret_ref, config.database_name);
    } catch {
      throw new Error(`Cannot resolve core database for tenant ${config.tenant_id}`);
    }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      const selected = rbacOnly
        ? TENANT_CORE_MIGRATIONS.filter((migration) =>
            [
              '0005-tenant-rbac-legacy-compat',
              '0005-tenant-rbac',
              '0007-default-tenant-user-role',
              '0011-module-access-from-actions',
            ].includes(migration.version),
          )
        : TENANT_CORE_MIGRATIONS;
      for (const coreMigration of selected) {
        await migrate(
          tenant,
          'tenant-core',
          coreMigration.version,
          coreMigration.path,
        );
      }
    } finally {
      await tenant.end();
    }
  }
}

async function processProvisioningJobs(platform: PostgresPool) {
  const jobs = await platform.query<ProvisioningJob>(
    `SELECT j.id, j.tenant_id, j.module_key, j.target_version, mo.id AS module_id, d.secret_ref, d.database_name
       FROM integration_schema.provisioning_jobs j
       JOIN module_registry_schema.modules mo ON mo.key = j.module_key
       JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = j.tenant_id AND d.status = 'active' JOIN tenancy_schema.tenants t ON t.id=j.tenant_id AND t.status='active'
      WHERE j.status = 'pending' ORDER BY j.created_at`,
  );
  for (const job of jobs.rows) {
    await withActiveTenant(platform, job.tenant_id, async () => {
    let connectionString: string;
    try { connectionString = resolveTenantDatabaseUrl(job.secret_ref, job.database_name); }
    catch { await failProvisioning(platform, job, `Missing database secret ${job.secret_ref}.`); return; }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      for (const coreMigration of TENANT_CORE_MIGRATIONS) {
        await migrate(tenant, 'tenant-core', coreMigration.version, coreMigration.path);
      }
      for (const migration of tenantModuleMigrations(job.module_key)) {
        await migrate(tenant, job.module_key, migration.version, migration.path);
      }
      await inTransaction(platform, async (client) => {
        const active = await client.query("SELECT 1 FROM tenancy_schema.tenants WHERE id=$1 AND status='active' FOR SHARE", [job.tenant_id]);
        if (!active.rowCount) return;
        await client.query(`UPDATE integration_schema.provisioning_jobs SET status = 'completed', completed_at = now(), error = NULL WHERE id = $1`, [job.id]);
        await client.query(`UPDATE subscription_schema.tenant_entitlements SET status = 'active', provisioned_version = $3, updated_at = now() WHERE tenant_id = $1 AND module_id = $2`, [job.tenant_id, job.module_id, job.target_version]);
      });
    } catch (error) {
      await failProvisioning(platform, job, error instanceof Error ? error.message : String(error));
    } finally { await tenant.end(); }
    });
  }
}

/**
 * Applies newly added module migrations to tenants already provisioned before
 * this release. Each migration is recorded per tenant, so rerunning the
 * deploy command is safe and never creates a shared tenant database.
 */
async function upgradeActiveEntitlements(platform: PostgresPool, moduleKey?: 'hrm') {
  const entitlements = await platform.query<ActiveEntitlement>(
    `SELECT e.tenant_id, mo.key AS module_key, d.secret_ref, d.database_name
       FROM subscription_schema.tenant_entitlements e
       JOIN module_registry_schema.modules mo ON mo.id = e.module_id AND mo.status = 'active'
       JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = e.tenant_id AND d.status = 'active' JOIN tenancy_schema.tenants t ON t.id=e.tenant_id AND t.status='active'
      WHERE e.status = 'active' AND ($1::text IS NULL OR mo.key=$1)
      ORDER BY e.tenant_id, mo.key`,
    [moduleKey || null],
  );
  for (const entitlement of entitlements.rows) {
    await withActiveTenant(platform, entitlement.tenant_id, async () => {
    let connectionString: string;
    try {
      connectionString = resolveTenantDatabaseUrl(entitlement.secret_ref, entitlement.database_name);
    } catch {
      throw new Error(`Missing database secret ${entitlement.secret_ref} for tenant ${entitlement.tenant_id}.`);
    }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      for (const coreMigration of TENANT_CORE_MIGRATIONS) {
        await migrate(tenant, 'tenant-core', coreMigration.version, coreMigration.path);
      }
      for (const moduleMigration of tenantModuleMigrations(entitlement.module_key)) {
        await migrate(tenant, entitlement.module_key, moduleMigration.version, moduleMigration.path);
      }
    } finally {
      await tenant.end();
    }
    });
  }
}


async function failProvisioning(platform: PostgresPool, job: ProvisioningJob, message: string) {
  await inTransaction(platform, async (client) => {
    const active = await client.query("SELECT 1 FROM tenancy_schema.tenants WHERE id=$1 AND status='active' FOR SHARE", [job.tenant_id]);
    if (!active.rowCount) return;
    await client.query(`UPDATE integration_schema.provisioning_jobs SET status = 'failed', completed_at = now(), error = left($2, 2000) WHERE id = $1`, [job.id, message]);
    await client.query(`UPDATE subscription_schema.tenant_entitlements SET status = 'failed', updated_at = now() WHERE tenant_id = $1 AND module_id = $2`, [job.tenant_id, job.module_id]);
  });
}

async function migrate(pool: PostgresPool, moduleKey: string, version: string, relativePath: string) {
  // A migration checksum identifies SQL content, not the checkout platform.
  // Git may convert LF to CRLF on Windows while production containers use LF.
  const sql = (await migration(relativePath)).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const checksum = createHash('sha256').update(sql).digest('hex');
  try {
    const existing = await pool.query<{ checksum: string }>('SELECT checksum FROM integration_schema.schema_migrations WHERE module_key = $1 AND version = $2', [moduleKey, version]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Checksum mismatch for ${moduleKey}/${version}.`);
      return;
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42P01' && code !== '3F000') throw error;
  }
  await inTransaction(pool, async (client) => {
    await client.query(sql);
    await client.query(`INSERT INTO integration_schema.schema_migrations (module_key, version, checksum) VALUES ($1, $2, $3) ON CONFLICT (module_key, version) DO NOTHING`, [moduleKey, version, checksum]);
  });
  console.log(`Applied ${moduleKey}/${version}.`);
}

async function migration(relativePath: string): Promise<string> {
  for (const candidate of [join(process.cwd(), 'migrations', relativePath), join(__dirname, 'migrations', relativePath)]) {
    try { return await readFile(candidate, 'utf8'); } catch { /* try the next packaged asset location */ }
  }
  throw new Error(`Migration file not found: ${relativePath}`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
