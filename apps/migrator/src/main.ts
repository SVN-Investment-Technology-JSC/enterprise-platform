import { createHash, randomBytes, scrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPostgresPool, inTransaction, resolveTenantDatabaseUrl } from '@enterprise-platform/adapter-database';
import { tenantModuleMigrations } from '@enterprise-platform/platform-entitlement/migrations';

type PostgresPool = ReturnType<typeof createPostgresPool>;
const derivePassword = promisify(scrypt);

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }

const platformUrl = process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform';

async function main() {
  const platform = createPostgresPool(platformUrl);
  try {
    await migrate(platform, 'platform-core', '0001-platform', 'platform/0001-platform.sql');
    await migrate(platform, 'platform-core', '0003-platform-events', 'platform/0003-platform-events.sql');
    await migrate(platform, 'platform-core', '0004-tenant-password-reset', 'platform/0004-tenant-password-reset.sql');
    await migrate(platform, 'platform-core', '0005-drop-legacy-organization', 'platform/0005-drop-legacy-organization.sql');
    await processProvisioningJobs(platform);
    await upgradeActiveEntitlements(platform);
    if (!process.argv.includes('--migrate-only')) await seedPlatform(platform);
    console.log('Platform migrations and tenant provisioning completed.');
  } finally { await platform.end(); }
}

interface ProvisioningJob {
  id: string;
  tenant_id: string;
  module_key: 'inventory' | 'procedure-engine' | 'crm' | 'maintenance';
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

async function processProvisioningJobs(platform: PostgresPool) {
  const jobs = await platform.query<ProvisioningJob>(
    `SELECT j.id, j.tenant_id, j.module_key, j.target_version, mo.id AS module_id, d.secret_ref, d.database_name
       FROM integration_schema.provisioning_jobs j
       JOIN module_registry_schema.modules mo ON mo.key = j.module_key
       JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = j.tenant_id AND d.status = 'active'
      WHERE j.status = 'pending' ORDER BY j.created_at`,
  );
  for (const job of jobs.rows) {
    let connectionString: string;
    try { connectionString = resolveTenantDatabaseUrl(job.secret_ref, job.database_name); }
    catch { await failProvisioning(platform, job, `Missing database secret ${job.secret_ref}.`); continue; }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      for (const migration of tenantModuleMigrations(job.module_key)) {
        await migrate(tenant, job.module_key, migration.version, migration.path);
      }
      await inTransaction(platform, async (client) => {
        await client.query(`UPDATE integration_schema.provisioning_jobs SET status = 'completed', completed_at = now(), error = NULL WHERE id = $1`, [job.id]);
        await client.query(`UPDATE subscription_schema.tenant_entitlements SET status = 'active', provisioned_version = $3, updated_at = now() WHERE tenant_id = $1 AND module_id = $2`, [job.tenant_id, job.module_id, job.target_version]);
      });
    } catch (error) {
      await failProvisioning(platform, job, error instanceof Error ? error.message : String(error));
    } finally { await tenant.end(); }
  }
}

/**
 * Applies newly added module migrations to tenants already provisioned before
 * this release. Each migration is recorded per tenant, so rerunning the
 * deploy command is safe and never creates a shared tenant database.
 */
async function upgradeActiveEntitlements(platform: PostgresPool) {
  const entitlements = await platform.query<ActiveEntitlement>(
    `SELECT e.tenant_id, mo.key AS module_key, d.secret_ref, d.database_name
       FROM subscription_schema.tenant_entitlements e
       JOIN module_registry_schema.modules mo ON mo.id = e.module_id AND mo.status = 'active'
       JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = e.tenant_id AND d.status = 'active'
      WHERE e.status = 'active'
      ORDER BY e.tenant_id, mo.key`,
  );
  for (const entitlement of entitlements.rows) {
    let connectionString: string;
    try {
      connectionString = resolveTenantDatabaseUrl(entitlement.secret_ref, entitlement.database_name);
    } catch {
      throw new Error(`Missing database secret ${entitlement.secret_ref} for tenant ${entitlement.tenant_id}.`);
    }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      for (const moduleMigration of tenantModuleMigrations(entitlement.module_key)) {
        await migrate(tenant, entitlement.module_key, moduleMigration.version, moduleMigration.path);
      }
    } finally {
      await tenant.end();
    }
  }
}


async function failProvisioning(platform: PostgresPool, job: ProvisioningJob, message: string) {
  await inTransaction(platform, async (client) => {
    await client.query(`UPDATE integration_schema.provisioning_jobs SET status = 'failed', completed_at = now(), error = left($2, 2000) WHERE id = $1`, [job.id, message]);
    await client.query(`UPDATE subscription_schema.tenant_entitlements SET status = 'failed', updated_at = now() WHERE tenant_id = $1 AND module_id = $2`, [job.tenant_id, job.module_id]);
  });
}

async function migrate(pool: PostgresPool, moduleKey: string, version: string, relativePath: string) {
  // A migration checksum identifies SQL content, not the checkout platform.
  // Git may convert LF to CRLF on Windows while production containers use LF.
  const sql = (await migration(relativePath)).replace(/\r\n?/g, '\n');
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
    await client.query(`INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'superadmin@platform.local', 'Platform Super Admin', $1, 'platform-admin') ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name, status = 'active'`, [hash]);
    await client.query(`INSERT INTO authorization_schema.roles (id, key, name, scope) VALUES ('e0000000-0000-4000-8000-000000000001', 'platform-admin', 'Platform Admin', 'platform'), ('e0000000-0000-4000-8000-000000000002', 'tenant-admin', 'Tenant Admin', 'tenant') ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.permissions (id, key, description) VALUES ('e1000000-0000-4000-8000-000000000001', 'platform.manage', 'Quản trị Platform Core'), ('e1000000-0000-4000-8000-000000000002', 'tenant.manage', 'Quản trị tenant'), ('e1000000-0000-4000-8000-000000000003', 'procedure.read', 'Đọc Procedure Engine'), ('e1000000-0000-4000-8000-000000000004', 'procedure.manage', 'Quản trị Procedure Engine'), ('e1000000-0000-4000-8000-000000000005', 'crm.read', 'Đọc CRM'), ('e1000000-0000-4000-8000-000000000006', 'crm.manage', 'Quản trị CRM'), ('e1000000-0000-4000-8000-000000000007', 'maintenance.read', 'Đọc Maintenance'), ('e1000000-0000-4000-8000-000000000008', 'maintenance.manage', 'Quản trị Maintenance'), ('e1000000-0000-4000-8000-000000000009', 'inventory.read', 'Đọc Inventory'), ('e1000000-0000-4000-8000-000000000010', 'inventory.manage', 'Quản trị Inventory'), ('e1000000-0000-4000-8000-000000000011', 'inventory.transaction.write', 'Ghi nhận giao dịch Inventory') ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.role_permissions (role_id, permission_id) SELECT 'e0000000-0000-4000-8000-000000000001'::uuid, id FROM authorization_schema.permissions WHERE key = 'platform.manage' UNION ALL SELECT 'e0000000-0000-4000-8000-000000000002'::uuid, id FROM authorization_schema.permissions WHERE key <> 'platform.manage' ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-000000000001', NULL, 'platform-superadmin') ON CONFLICT (assignment_key) DO NOTHING`);
    await client.query(`INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version) VALUES ('f0000000-0000-4000-8000-000000000001', 'procedure-engine', 'Procedure Engine', 'Thiết kế và vận hành quy trình RCSI', '/modules/procedure', 'PE', '1.0.0'), ('f0000000-0000-4000-8000-000000000002', 'crm', 'CRM', 'Khách hàng, lead và cơ hội', '/crm', 'CRM', '1.0.0'), ('f0000000-0000-4000-8000-000000000003', 'maintenance', 'Maintenance', 'Thiết bị, kế hoạch và bảo trì phòng ngừa', '/modules/maintenance', 'MT', '1.0.0'), ('f0000000-0000-4000-8000-000000000004', 'inventory', 'Inventory', 'Tài sản, vật tư, kho và giao dịch tồn kho', '/modules/inventory', 'IV', '1.0.0') ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, launch_url = EXCLUDED.launch_url, status = 'active'`);
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await derivePassword(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
