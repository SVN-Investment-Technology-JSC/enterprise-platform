import { createHash, randomBytes, scrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPostgresPool, inTransaction, resolveTenantDatabaseUrl, withActiveTenant } from '@enterprise-platform/adapter-database';
import {
  TENANT_CORE_MIGRATIONS,
  tenantModuleMigrations,
} from '@enterprise-platform/platform-entitlement';

type PostgresPool = ReturnType<typeof createPostgresPool>;
const derivePassword = promisify(scrypt);

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }

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
    await removeCrmTenantSchemas(platform);
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
  module_key: 'inventory' | 'procedure-engine' | 'maintenance' | 'workspace' | 'hrm';
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

/** CRM was retired: clean up platform database and remove dedicated tenant schemas. */
async function removeCrmTenantSchemas(platform: PostgresPool) {
  try {
    await platform.query(`
      DELETE FROM audit_schema.audit_logs WHERE action LIKE 'crm.%' OR metadata->>'moduleKey' = 'crm' OR LOWER(action) LIKE 'crm.%';
      DELETE FROM integration_schema.provisioning_jobs WHERE LOWER(module_key) = 'crm';
      DELETE FROM subscription_schema.tenant_entitlements WHERE module_id IN (SELECT id FROM module_registry_schema.modules WHERE LOWER(key) = 'crm');
      DELETE FROM subscription_schema.plan_modules WHERE module_id IN (SELECT id FROM module_registry_schema.modules WHERE LOWER(key) = 'crm');
      DELETE FROM authorization_schema.role_permissions WHERE permission_id IN (SELECT id FROM authorization_schema.permissions WHERE LOWER(key) LIKE 'crm.%');
      DELETE FROM authorization_schema.permissions WHERE LOWER(key) LIKE 'crm.%';
      DELETE FROM module_registry_schema.modules WHERE LOWER(key) = 'crm';
    `);
  } catch (error) {
    console.warn('Could not complete platform CRM cleanup:', error instanceof Error ? error.message : String(error));
  }

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
      continue;
    }
    const tenant = createPostgresPool(connectionString);
    try {
      await inTransaction(tenant, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS crm_schema CASCADE');
        const hasTable = await client.query<{ exists: boolean }>(
          `SELECT to_regclass('integration_schema.schema_migrations') IS NOT NULL AS exists`,
        );
        if (hasTable.rows[0]?.exists) {
          await client.query("DELETE FROM integration_schema.schema_migrations WHERE LOWER(module_key)='crm'");
        }
      });
    } catch (error) {
      console.warn(`Could not clean CRM schema for tenant ${config.tenant_id}:`, error instanceof Error ? error.message : String(error));
    } finally {
      await tenant.end();
    }
  }
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

async function seedPlatform(pool: PostgresPool) {
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!password) throw new Error('SEED_SUPERADMIN_PASSWORD is required for seed data.');
  const hash = await hashPassword(password);
  await inTransaction(pool, async (client) => {
    await client.query(`INSERT INTO authorization_schema.roles (id, key, name, scope) VALUES
      ('e0000000-0000-4000-8000-000000000001', 'platform-admin', 'Platform Admin', 'platform'),
      ('e0000000-0000-4000-8000-000000000002', 'tenant-admin', 'Tenant Admin', 'tenant')
      ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'superadmin@platform.local', 'Platform Super Admin', $1, 'platform-admin') ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name, status = 'active'`, [hash]);
    await client.query(`INSERT INTO authorization_schema.permissions (id, key, description) VALUES ('e1000000-0000-4000-8000-000000000001', 'platform.manage', 'Quản trị Platform Core'), ('e1000000-0000-4000-8000-000000000002', 'tenant.manage', 'Quản trị tenant'), ('e1000000-0000-4000-8000-000000000003', 'procedure.read', 'Đọc Procedure Engine'), ('e1000000-0000-4000-8000-000000000004', 'procedure.manage', 'Quản trị Procedure Engine'), ('e1000000-0000-4000-8000-000000000007', 'maintenance.read', 'Đọc Maintenance'), ('e1000000-0000-4000-8000-000000000008', 'maintenance.manage', 'Quản trị Maintenance'), ('e1000000-0000-4000-8000-000000000009', 'inventory.read', 'Đọc Inventory'), ('e1000000-0000-4000-8000-000000000010', 'inventory.manage', 'Quản trị Inventory'), ('e1000000-0000-4000-8000-000000000011', 'inventory.transaction.write', 'Ghi nhận giao dịch Inventory'), ('e1000000-0000-4000-8000-000000000014', 'hrm.read', 'Đọc HRM'), ('e1000000-0000-4000-8000-000000000013', 'hrm.manage', 'Quản trị HRM'), ('e1000000-0000-4000-8000-000000000020', 'workspace.read', 'Đọc Workspace'), ('e1000000-0000-4000-8000-000000000021', 'workspace.manage', 'Quản trị Workspace'), ('e1000000-0000-4000-8000-000000000022', 'workspace.task.write', 'Ghi dự án và công việc Workspace'), ('e1000000-0000-4000-8000-000000000023', 'workspace.document.write', 'Ghi tài liệu Workspace'), ('e1000000-0000-4000-8000-000000000024', 'workspace.project.create', 'Tạo dự án Workspace'), ('e1000000-0000-4000-8000-000000000025', 'workspace.document.delete', 'Xóa và lưu trữ tài liệu Workspace'), ('e1000000-0000-4000-8000-000000000026', 'inventory.stocktake.create', 'Tạo đợt kiểm kê và nhập số đếm Inventory'), ('e1000000-0000-4000-8000-000000000027', 'inventory.stocktake.approve', 'Duyệt và ghi sổ kiểm kê Inventory') ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.role_permissions (role_id, permission_id) SELECT 'e0000000-0000-4000-8000-000000000001'::uuid, id FROM authorization_schema.permissions WHERE key IN ('platform.manage','platform.tenants.delete') UNION ALL SELECT 'e0000000-0000-4000-8000-000000000002'::uuid, id FROM authorization_schema.permissions WHERE key NOT LIKE 'platform.%' ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000001', NULL, 'platform-superadmin') ON CONFLICT (assignment_key) DO NOTHING`);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005' AND key = 'hrm') THEN
          IF NOT EXISTS (SELECT 1 FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000006') THEN
            INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version, status)
            SELECT 'f0000000-0000-4000-8000-000000000006', 'hrm-temp', name, description, launch_url, icon, version, status
            FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005';
          END IF;
          UPDATE subscription_schema.tenant_entitlements SET module_id = 'f0000000-0000-4000-8000-000000000006' WHERE module_id = 'f0000000-0000-4000-8000-000000000005';
          UPDATE subscription_schema.plan_modules SET module_id = 'f0000000-0000-4000-8000-000000000006' WHERE module_id = 'f0000000-0000-4000-8000-000000000005';
          DELETE FROM module_registry_schema.modules WHERE id = 'f0000000-0000-4000-8000-000000000005';
          UPDATE module_registry_schema.modules SET key = 'hrm' WHERE id = 'f0000000-0000-4000-8000-000000000006';
        END IF;
      END $$;
    `);
    await client.query(`INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version) VALUES ('f0000000-0000-4000-8000-000000000001', 'procedure-engine', 'Procedure Engine', 'Thiết kế và vận hành quy trình RCSI', '/modules/procedure', 'PE', '1.0.0'), ('f0000000-0000-4000-8000-000000000003', 'maintenance', 'Maintenance', 'Thiết bị, kế hoạch và bảo trì phòng ngừa', '/modules/maintenance', 'MT', '1.0.0'), ('f0000000-0000-4000-8000-000000000004', 'inventory', 'Inventory', 'Tài sản, vật tư, kho và giao dịch tồn kho', '/modules/inventory', 'IV', '1.0.0'), ('f0000000-0000-4000-8000-000000000005', 'workspace', 'Workspace', 'Dự án, công việc, tài liệu và lịch biểu', '/modules/workspace', 'WS', '1.0.0'), ('f0000000-0000-4000-8000-000000000006', 'hrm', 'HRM & Chấm công', 'Quản lý nhân sự, hồ sơ, chấm công và chi trả lương', '/modules/hrm', 'HRM', '1.0.0') ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, name = EXCLUDED.name, description = EXCLUDED.description, launch_url = EXCLUDED.launch_url, icon = EXCLUDED.icon, version = EXCLUDED.version, status = 'active'`);
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await derivePassword(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
