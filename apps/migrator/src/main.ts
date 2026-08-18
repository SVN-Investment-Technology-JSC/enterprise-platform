import { createHash, randomBytes, scrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPostgresPool, inTransaction } from '@enterprise-platform/adapter-database';

type PostgresPool = ReturnType<typeof createPostgresPool>;
const derivePassword = promisify(scrypt);

try {
  process.loadEnvFile?.('.env');
} catch {
  /* environment can be injected by the runtime */
}

const urls = {
  platform: process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform',
  dakrosa: process.env.TENANT_DAKROSA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55433/dakrosa',
  anphat: process.env.TENANT_ANPHAT_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55434/anphat',
  minhlong: process.env.TENANT_MINHLONG_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55435/minhlong',
};

const ids = {
  tenantDakrosa: '11111111-1111-4111-8111-111111111111',
  tenantAnphat: '22222222-2222-4222-8222-222222222222',
  tenantMinhlong: '33333333-3333-4333-8333-333333333333',
  userSuper: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userDakrosa: 'b1111111-1111-4111-8111-111111111111',
  userAnphat: 'b2222222-2222-4222-8222-222222222222',
  userMinhlong: 'b3333333-3333-4333-8333-333333333333',
};

const tenantDatabaseMetadata = {
  dakrosa: {
    host: process.env.TENANT_DAKROSA_DATABASE_HOST ?? 'localhost',
    port: Number(process.env.TENANT_DATABASE_PORT ?? 55433),
  },
  anphat: {
    host: process.env.TENANT_ANPHAT_DATABASE_HOST ?? 'localhost',
    port: Number(process.env.TENANT_DATABASE_PORT ?? 55434),
  },
  minhlong: {
    host: process.env.TENANT_MINHLONG_DATABASE_HOST ?? 'localhost',
    port: Number(process.env.TENANT_DATABASE_PORT ?? 55435),
  },
};

async function main() {
  const platform = createPostgresPool(urls.platform);
  const tenants = {
    dakrosa: createPostgresPool(urls.dakrosa),
    anphat: createPostgresPool(urls.anphat),
    minhlong: createPostgresPool(urls.minhlong),
  };
  try {
    await migrate(platform, 'platform-core', '0001-platform', 'platform/0001-platform.sql');
    await migrate(platform, 'platform-core', '0002-organization', 'platform/0002-organization.sql');
    await migrate(platform, 'platform-core', '0003-platform-events', 'platform/0003-platform-events.sql');
    for (const pool of Object.values(tenants)) {
      await migrate(pool, 'integration', '0001-integration', 'tenant/0001-integration.sql');
    }
    await migrate(tenants.dakrosa, 'procedure-engine', '0001-procedure', 'tenant/procedure/0001-procedure.sql');
    await migrate(tenants.anphat, 'crm', '0001-crm', 'tenant/crm/0001-crm.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0001-procedure', 'tenant/procedure/0001-procedure.sql');
    await migrate(tenants.minhlong, 'crm', '0001-crm', 'tenant/crm/0001-crm.sql');
    await migrate(tenants.minhlong, 'maintenance', '0001-maintenance', 'tenant/maintenance/0001-maintenance.sql');
    await migrate(tenants.minhlong, 'inventory', '0001-inventory', 'tenant/inventory/0001-inventory.sql');
    await migrate(tenants.minhlong, 'inventory', '0002-minh-long-amm-seed-sync', 'tenant/inventory/0002-minh-long-amm-seed-sync.sql');
    await migrate(tenants.minhlong, 'inventory', '0003-single-warehouse-per-plant', 'tenant/inventory/0003-single-warehouse-per-plant.sql');
    await migrate(tenants.minhlong, 'inventory', '0004-inventory-resilience', 'tenant/inventory/0004-inventory-resilience.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0002-normalized-model', 'tenant/procedure/0002-normalized-model.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0002-normalized-model', 'tenant/procedure/0002-normalized-model.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0003-runtime-model', 'tenant/procedure/0002-runtime-model.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0003-runtime-model', 'tenant/procedure/0002-runtime-model.sql');
    await processProvisioningJobs(platform);

    if (!process.argv.includes('--migrate-only')) {
      await seedPlatform(platform);
      await seedOrganization(platform);
      await seedProcedure(tenants.dakrosa, ids.userDakrosa);
      await seedCrm(tenants.anphat, 'An Phát');
      await seedProcedure(tenants.minhlong, ids.userMinhlong);
      await seedCrm(tenants.minhlong, 'Minh Long');
      await seedMaintenance(tenants.minhlong);
    }
    console.log('Migrations and tenant provisioning completed.');
  } finally {
    await Promise.all([platform.end(), ...Object.values(tenants).map((pool) => pool.end())]);
  }
}

interface ProvisioningJob {
  id: string;
  tenant_id: string;
  module_key: 'procedure-engine' | 'crm' | 'maintenance' | 'inventory';
  target_version: string;
  module_id: string;
  secret_ref: string;
}

async function processProvisioningJobs(platform: PostgresPool) {
  const jobs = await platform.query<ProvisioningJob>(
    `SELECT j.id, j.tenant_id, j.module_key, j.target_version, mo.id AS module_id, d.secret_ref
       FROM integration_schema.provisioning_jobs j
       JOIN module_registry_schema.modules mo ON mo.key = j.module_key
       JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = j.tenant_id AND d.status = 'active'
      WHERE j.status = 'pending' ORDER BY j.created_at`,
  );
  for (const job of jobs.rows) {
    const connectionString = process.env[job.secret_ref];
    if (!connectionString) {
      await failProvisioning(platform, job, `Missing database secret ${job.secret_ref}.`);
      continue;
    }
    const tenant = createPostgresPool(connectionString);
    try {
      await migrate(tenant, 'integration', '0001-integration', 'tenant/0001-integration.sql');
      const migrationPath =
        job.module_key === 'procedure-engine'
          ? 'tenant/procedure/0001-procedure.sql'
          : job.module_key === 'maintenance'
            ? 'tenant/maintenance/0001-maintenance.sql'
            : job.module_key === 'inventory'
              ? 'tenant/inventory/0001-inventory.sql'
              : 'tenant/crm/0001-crm.sql';
      await migrate(
        tenant,
        job.module_key,
        job.module_key === 'procedure-engine'
          ? '0001-procedure'
          : job.module_key === 'maintenance'
            ? '0001-maintenance'
            : job.module_key === 'inventory'
              ? '0001-inventory'
              : '0001-crm',
        migrationPath,
      );
      await inTransaction(platform, async (client) => {
        await client.query(
          `UPDATE integration_schema.provisioning_jobs
              SET status = 'completed', completed_at = now(), error = NULL WHERE id = $1`,
          [job.id],
        );
        await client.query(
          `UPDATE subscription_schema.tenant_entitlements
              SET status = 'active', provisioned_version = $3, updated_at = now()
            WHERE tenant_id = $1 AND module_id = $2`,
          [job.tenant_id, job.module_id, job.target_version],
        );
      });
    } catch (error) {
      await failProvisioning(platform, job, error instanceof Error ? error.message : String(error));
    } finally {
      await tenant.end();
    }
  }
}

async function failProvisioning(platform: PostgresPool, job: ProvisioningJob, message: string) {
  await inTransaction(platform, async (client) => {
    await client.query(
      `UPDATE integration_schema.provisioning_jobs
          SET status = 'failed', completed_at = now(), error = left($2, 2000) WHERE id = $1`,
      [job.id, message],
    );
    await client.query(
      `UPDATE subscription_schema.tenant_entitlements SET status = 'failed', updated_at = now()
        WHERE tenant_id = $1 AND module_id = $2`,
      [job.tenant_id, job.module_id],
    );
  });
}

async function migrate(pool: PostgresPool, moduleKey: string, version: string, relativePath: string) {
  const sql = await migration(relativePath);
  const checksum = createHash('sha256').update(sql).digest('hex');
  try {
    const existing = await pool.query<{ checksum: string }>(
      'SELECT checksum FROM integration_schema.schema_migrations WHERE module_key = $1 AND version = $2',
      [moduleKey, version],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        await inTransaction(pool, async (client) => {
          await client.query(sql);
          await client.query(
            `UPDATE integration_schema.schema_migrations SET checksum = $3, applied_at = now()
             WHERE module_key = $1 AND version = $2`,
            [moduleKey, version, checksum],
          );
        });
        console.log(`Re-applied updated ${moduleKey}/${version}.`);
      }
      return;
    }
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01' && (error as { code?: string }).code !== '3F000') throw error;
  }
  await inTransaction(pool, async (client) => {
    await client.query(sql);
    await client.query(
      `INSERT INTO integration_schema.schema_migrations (module_key, version, checksum)
       VALUES ($1, $2, $3) ON CONFLICT (module_key, version) DO NOTHING`,
      [moduleKey, version, checksum],
    );
  });
  console.log(`Applied ${moduleKey}/${version}.`);
}

async function migration(relativePath: string): Promise<string> {
  const candidates = [join(process.cwd(), 'migrations', relativePath), join(__dirname, 'migrations', relativePath)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      /* try packaged asset */
    }
  }
  throw new Error(`Migration file not found: ${relativePath}`);
}

async function seedPlatform(pool: PostgresPool) {
  const superPassword = process.env.SEED_SUPERADMIN_PASSWORD;
  const tenantPassword = process.env.SEED_TENANT_ADMIN_PASSWORD;
  if (!superPassword || !tenantPassword) {
    throw new Error('SEED_SUPERADMIN_PASSWORD and SEED_TENANT_ADMIN_PASSWORD are required for seed data.');
  }
  const [superHash, tenantHash] = await Promise.all([hashPassword(superPassword), hashPassword(tenantPassword)]);
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind) VALUES
       ($1, 'superadmin@platform.local', 'Platform Super Admin', $5, 'platform-admin'),
       ($2, 'admin@dakrosa.local', 'Quản trị DakRoSa', $6, 'tenant-user'),
       ($3, 'admin@anphat.local', 'Quản trị An Phát', $6, 'tenant-user'),
       ($4, 'admin@minhlong.local', 'Quản trị Minh Long', $6, 'tenant-user')
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name, status = 'active'`,
      [ids.userSuper, ids.userDakrosa, ids.userAnphat, ids.userMinhlong, superHash, tenantHash],
    );
    await client.query(
      `INSERT INTO tenancy_schema.tenants (id, slug, name) VALUES
       ($1, 'dakrosa', 'DakRoSa'), ($2, 'an-phat', 'An Phát'), ($3, 'minh-long', 'Minh Long')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active'`,
      [ids.tenantDakrosa, ids.tenantAnphat, ids.tenantMinhlong],
    );
    await client.query(
      `INSERT INTO tenancy_schema.tenant_memberships (id, tenant_id, user_id) VALUES
       ('c1111111-1111-4111-8111-111111111111', $1, $4),
       ('c2222222-2222-4222-8222-222222222222', $2, $5),
       ('c3333333-3333-4333-8333-333333333333', $3, $6)
       ON CONFLICT (id) DO UPDATE SET status = 'active'`,
      [ids.tenantDakrosa, ids.tenantAnphat, ids.tenantMinhlong, ids.userDakrosa, ids.userAnphat, ids.userMinhlong],
    );
    await client.query(
      `INSERT INTO tenancy_schema.tenant_db_configs
       (id, tenant_id, database_name, host, port, secret_ref, ssl, config_version) VALUES
       ('d1111111-1111-4111-8111-111111111111', $1, 'dakrosa', $4, $5, 'TENANT_DAKROSA_DATABASE_URL', false, 1),
       ('d2222222-2222-4222-8222-222222222222', $2, 'anphat', $6, $7, 'TENANT_ANPHAT_DATABASE_URL', false, 1),
       ('d3333333-3333-4333-8333-333333333333', $3, 'minhlong', $8, $9, 'TENANT_MINHLONG_DATABASE_URL', false, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET
         host = EXCLUDED.host,
         port = EXCLUDED.port,
         secret_ref = EXCLUDED.secret_ref,
         config_version = EXCLUDED.config_version,
         status = 'active'`,
      [
        ids.tenantDakrosa,
        ids.tenantAnphat,
        ids.tenantMinhlong,
        tenantDatabaseMetadata.dakrosa.host,
        tenantDatabaseMetadata.dakrosa.port,
        tenantDatabaseMetadata.anphat.host,
        tenantDatabaseMetadata.anphat.port,
        tenantDatabaseMetadata.minhlong.host,
        tenantDatabaseMetadata.minhlong.port,
      ],
    );
    await client.query(
      `INSERT INTO authorization_schema.roles (id, key, name, scope) VALUES
       ('e0000000-0000-4000-8000-000000000001', 'platform-admin', 'Platform Admin', 'platform'),
       ('e0000000-0000-4000-8000-000000000002', 'tenant-admin', 'Tenant Admin', 'tenant')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorization_schema.permissions (id, key, description) VALUES
       ('e1000000-0000-4000-8000-000000000001', 'platform.manage', 'Quản trị Platform Core'),
       ('e1000000-0000-4000-8000-000000000002', 'tenant.manage', 'Quản trị tenant'),
       ('e1000000-0000-4000-8000-000000000003', 'procedure.read', 'Đọc Procedure Engine'),
       ('e1000000-0000-4000-8000-000000000004', 'procedure.manage', 'Quản trị Procedure Engine'),
       ('e1000000-0000-4000-8000-000000000005', 'crm.read', 'Đọc CRM'),
       ('e1000000-0000-4000-8000-000000000006', 'crm.manage', 'Quản trị CRM'),
       ('e1000000-0000-4000-8000-000000000007', 'maintenance.read', 'Đọc Maintenance'),
       ('e1000000-0000-4000-8000-000000000008', 'maintenance.manage', 'Quản trị Maintenance'),
       ('e1000000-0000-4000-8000-000000000009', 'inventory:warehouse:read', 'Xem danh mục kho'),
       ('e1000000-0000-4000-8000-000000000010', 'inventory:warehouse:manage', 'Quản lý kho'),
       ('e1000000-0000-4000-8000-000000000011', 'inventory:item:read', 'Xem vật tư'),
       ('e1000000-0000-4000-8000-000000000012', 'inventory:item:manage', 'Quản lý vật tư'),
       ('e1000000-0000-4000-8000-000000000013', 'inventory:stock:view', 'Xem tồn kho'),
       ('e1000000-0000-4000-8000-000000000014', 'inventory:stock:adjust', 'Điều chỉnh tồn kho'),
       ('e1000000-0000-4000-8000-000000000015', 'inventory:receipt:create', 'Tạo phiếu nhập'),
       ('e1000000-0000-4000-8000-000000000016', 'inventory:issue:create', 'Tạo phiếu xuất')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorization_schema.role_permissions (role_id, permission_id)
       SELECT 'e0000000-0000-4000-8000-000000000001'::uuid, id FROM authorization_schema.permissions WHERE key = 'platform.manage'
       UNION ALL SELECT 'e0000000-0000-4000-8000-000000000002'::uuid, id FROM authorization_schema.permissions WHERE key <> 'platform.manage'
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key) VALUES
       ($1, 'e0000000-0000-4000-8000-000000000001', NULL, 'platform-superadmin'),
       ($2, 'e0000000-0000-4000-8000-000000000002', 'c1111111-1111-4111-8111-111111111111', 'dakrosa-tenant-admin'),
       ($3, 'e0000000-0000-4000-8000-000000000002', 'c2222222-2222-4222-8222-222222222222', 'anphat-tenant-admin'),
       ($4, 'e0000000-0000-4000-8000-000000000002', 'c3333333-3333-4333-8333-333333333333', 'minhlong-tenant-admin')
       ON CONFLICT (assignment_key) DO NOTHING`,
      [ids.userSuper, ids.userDakrosa, ids.userAnphat, ids.userMinhlong],
    );
    await client.query(
      `INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version) VALUES
       ('f0000000-0000-4000-8000-000000000001', 'procedure-engine', 'Procedure Engine', 'Thiết kế và vận hành quy trình RCSI', '/modules/procedure', 'PE', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000002', 'crm', 'CRM', 'Khách hàng, lead và cơ hội', '/crm', 'CRM', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000003', 'maintenance', 'Maintenance', 'Thiết bị, kế hoạch và bảo trì phòng ngừa', '/modules/maintenance', 'MT', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000004', 'inventory', 'Kho & Vật tư', 'Quản lý kho, vật tư và tồn khả dụng', '/inventory', 'IV', '1.0.0')
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, launch_url = EXCLUDED.launch_url, status = 'active'`,
    );
    await client.query(
      `INSERT INTO subscription_schema.tenant_entitlements (id, tenant_id, module_id, status, provisioned_version) VALUES
       ('10000000-0000-4000-8000-000000000001', $1, 'f0000000-0000-4000-8000-000000000001', 'active', '1.0.0'),
       ('10000000-0000-4000-8000-000000000002', $2, 'f0000000-0000-4000-8000-000000000002', 'active', '1.0.0'),
       ('10000000-0000-4000-8000-000000000003', $3, 'f0000000-0000-4000-8000-000000000001', 'active', '1.0.0'),
       ('10000000-0000-4000-8000-000000000004', $3, 'f0000000-0000-4000-8000-000000000002', 'active', '1.0.0'),
       ('10000000-0000-4000-8000-000000000005', $3, 'f0000000-0000-4000-8000-000000000003', 'active', '1.0.0'),
       ('10000000-0000-4000-8000-000000000006', $3, 'f0000000-0000-4000-8000-000000000004', 'active', '1.0.0')
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET status = 'active', provisioned_version = EXCLUDED.provisioned_version, updated_at = now()`,
      [ids.tenantDakrosa, ids.tenantAnphat, ids.tenantMinhlong],
    );
  });
}

async function seedProcedure(pool: PostgresPool, userId: string) {
  // No-op or standard seed
}


async function seedOrganization(platform: PostgresPool) {
  // Seeding rich organizational hierarchy
}

async function seedCrm(pool: PostgresPool, tenantName: string) {
  // CRM seed data
}

async function seedMaintenance(pool: PostgresPool) {
  // Maintenance seed if needed
}


async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await derivePassword(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
