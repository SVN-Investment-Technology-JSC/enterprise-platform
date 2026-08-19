import { createHash, randomBytes, scrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPostgresPool, inTransaction } from '@enterprise-platform/adapter-database';
import { SAVINA, SAVINA_ASSIGNMENTS, SAVINA_PEOPLE, SAVINA_UNITS, SAVINA_UNIT_TYPES } from './seed-savina.js';

type PostgresPool = ReturnType<typeof createPostgresPool>;
const derivePassword = promisify(scrypt);

try { process.loadEnvFile?.('.env'); } catch { /* environment can be injected by the runtime */ }

const urls = {
  platform: process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform',
  dakrosa: process.env.TENANT_DAKROSA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55433/dakrosa',
  anphat: process.env.TENANT_ANPHAT_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55434/anphat',
  minhlong: process.env.TENANT_MINHLONG_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55435/minhlong',
  savina: process.env.TENANT_SAVINA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55436/savina',
};

const ids = {
  tenantDakrosa: '11111111-1111-4111-8111-111111111111',
  tenantAnphat: '22222222-2222-4222-8222-222222222222',
  tenantMinhlong: '33333333-3333-4333-8333-333333333333',
  userSuper: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userDakrosa: 'b1111111-1111-4111-8111-111111111111',
  userAnphat: 'b2222222-2222-4222-8222-222222222222',
  userMinhlong: 'b3333333-3333-4333-8333-333333333333',
  // Demo accounts so a fresh environment can exercise the RACI roles without
  // anyone hand-crafting users: one manager, one plain participant.
  userMinhlongManager: 'b4444444-4444-4444-8444-444444444444',
  userMinhlongStaff: 'b5555555-5555-4555-8555-555555555555',
  membershipMinhlongManager: 'd4444444-4444-4444-8444-444444444444',
  membershipMinhlongStaff: 'd5555555-5555-4555-8555-555555555555',
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
    savina: createPostgresPool(urls.savina),
  };
  try {
    await migrate(platform, 'platform-core', '0001-platform', 'platform/0001-platform.sql');
    await migrate(platform, 'platform-core', '0002-organization', 'platform/0002-organization.sql');
    await migrate(platform, 'platform-core', '0003-platform-events', 'platform/0003-platform-events.sql');
    for (const pool of Object.values(tenants)) {
      await migrate(pool, 'integration', '0001-integration', 'tenant/0001-integration.sql');
    }
    // Inventory migrations for all tenants (minhlong has full setup)
    for (const pool of Object.values(tenants)) {
      await migrate(pool, 'inventory', '0001-inventory', 'tenant/inventory/0001-inventory.sql');
      await migrate(pool, 'inventory', '0002-inventory-balance-unique', 'tenant/inventory/0002-inventory-balance-unique.sql');
    }

    await migrate(tenants.dakrosa, 'procedure-engine', '0001-procedure', 'tenant/procedure/0001-procedure.sql');
    await migrate(tenants.anphat, 'crm', '0001-crm', 'tenant/crm/0001-crm.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0001-procedure', 'tenant/procedure/0001-procedure.sql');
    await migrate(tenants.minhlong, 'crm', '0001-crm', 'tenant/crm/0001-crm.sql');
    await migrate(tenants.minhlong, 'maintenance', '0001-maintenance', 'tenant/maintenance/0001-maintenance.sql');

    // Maintenance integration with inventory (asset_id → asset_code, add priority)
    await migrate(tenants.minhlong, 'maintenance', '0002-inventory-integration', 'tenant/maintenance/0002-inventory-integration.sql');
    await migrate(tenants.minhlong, 'maintenance', '0003-incident-and-history', 'tenant/maintenance/0003-incident-and-history.sql');

    // SAVINA dùng cả ba module.
    await migrate(tenants.savina, 'procedure-engine', '0001-procedure', 'tenant/procedure/0001-procedure.sql');
    await migrate(tenants.savina, 'procedure-engine', '0002-normalized-model', 'tenant/procedure/0002-normalized-model.sql');
    await migrate(tenants.savina, 'procedure-engine', '0003-runtime-model', 'tenant/procedure/0002-runtime-model.sql');
    await migrate(tenants.savina, 'procedure-engine', '0004-delegation-roles', 'tenant/procedure/0004-delegation-roles.sql');
    await migrate(tenants.savina, 'procedure-engine', '0005-subtask-attachments', 'tenant/procedure/0005-subtask-attachments.sql');
    await migrate(tenants.savina, 'procedure-engine', '0006-attachment-survives-writes', 'tenant/procedure/0006-attachment-survives-writes.sql');
    await migrate(tenants.savina, 'maintenance', '0001-maintenance', 'tenant/maintenance/0001-maintenance.sql');
    await migrate(tenants.savina, 'maintenance', '0002-inventory-integration', 'tenant/maintenance/0002-inventory-integration.sql');
    await migrate(tenants.savina, 'maintenance', '0003-incident-and-history', 'tenant/maintenance/0003-incident-and-history.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0002-normalized-model', 'tenant/procedure/0002-normalized-model.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0002-normalized-model', 'tenant/procedure/0002-normalized-model.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0003-runtime-model', 'tenant/procedure/0002-runtime-model.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0003-runtime-model', 'tenant/procedure/0002-runtime-model.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0004-delegation-roles', 'tenant/procedure/0004-delegation-roles.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0005-subtask-attachments', 'tenant/procedure/0005-subtask-attachments.sql');
    await migrate(tenants.dakrosa, 'procedure-engine', '0006-attachment-survives-writes', 'tenant/procedure/0006-attachment-survives-writes.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0004-delegation-roles', 'tenant/procedure/0004-delegation-roles.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0005-subtask-attachments', 'tenant/procedure/0005-subtask-attachments.sql');
    await migrate(tenants.minhlong, 'procedure-engine', '0006-attachment-survives-writes', 'tenant/procedure/0006-attachment-survives-writes.sql');
    await processProvisioningJobs(platform);

    if (!process.argv.includes('--migrate-only')) {
      await seedPlatform(platform);
      await seedOrganization(platform);
      await seedProcedure(tenants.dakrosa, ids.userDakrosa);
      await seedCrm(tenants.anphat, 'An Phát');
      await seedProcedure(tenants.minhlong, ids.userMinhlong);
      await seedCrm(tenants.minhlong, 'Minh Long');
      await seedMaintenance(tenants.minhlong);
      await seedSavina(platform, await hashPassword(process.env.SEED_TENANT_ADMIN_PASSWORD ?? ''));
    }
    console.log('Migrations and tenant provisioning completed.');
  } finally {
    await Promise.all([platform.end(), ...Object.values(tenants).map((pool) => pool.end())]);
  }
}

interface ProvisioningJob {
  id: string;
  tenant_id: string;
  module_key: 'procedure-engine' | 'crm' | 'maintenance';
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
      const migrationPath = job.module_key === 'procedure-engine'
        ? 'tenant/procedure/0001-procedure.sql'
        : job.module_key === 'maintenance'
          ? 'tenant/maintenance/0001-maintenance.sql'
          : 'tenant/crm/0001-crm.sql';
      await migrate(
        tenant,
        job.module_key,
        job.module_key === 'procedure-engine'
          ? '0001-procedure'
          : job.module_key === 'maintenance'
            ? '0001-maintenance'
            : '0001-crm',
        migrationPath,
      );
      await inTransaction(platform, async (client) => {
        await client.query(
          `UPDATE integration_schema.provisioning_jobs
              SET status = 'completed', completed_at = now(), error = NULL WHERE id = $1`, [job.id],
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
    } finally { await tenant.end(); }
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
      if (existing.rows[0].checksum !== checksum) throw new Error(`Checksum mismatch for ${moduleKey}/${version}.`);
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
    try { return await readFile(candidate, 'utf8'); } catch { /* try packaged asset */ }
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
       ($4, 'admin@minhlong.local', 'Quản trị Minh Long', $6, 'tenant-user'),
       ($7, 'quanly@minhlong.local', 'Quản lý Quy trình Minh Long', $6, 'tenant-user'),
       ($8, 'nhanvien@minhlong.local', 'Nhân viên Minh Long', $6, 'tenant-user')
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name, status = 'active'`,
      [ids.userSuper, ids.userDakrosa, ids.userAnphat, ids.userMinhlong, superHash, tenantHash,
       ids.userMinhlongManager, ids.userMinhlongStaff],
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
       ('c3333333-3333-4333-8333-333333333333', $3, $6),
       ($7, $3, $8),
       ($9, $3, $10)
       ON CONFLICT (id) DO UPDATE SET status = 'active'`,
      [ids.tenantDakrosa, ids.tenantAnphat, ids.tenantMinhlong, ids.userDakrosa, ids.userAnphat, ids.userMinhlong,
       ids.membershipMinhlongManager, ids.userMinhlongManager,
       ids.membershipMinhlongStaff, ids.userMinhlongStaff],
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
       ('e0000000-0000-4000-8000-000000000002', 'tenant-admin', 'Tenant Admin', 'tenant'),
       ('e0000000-0000-4000-8000-000000000003', 'procedure-participant', 'Người tham gia quy trình', 'tenant'),
       ('e0000000-0000-4000-8000-000000000004', 'procedure-manager', 'Quản lý quy trình', 'tenant')
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
       ('e1000000-0000-4000-8000-000000000009', 'inventory.read', 'Đọc Inventory'),
       ('e1000000-0000-4000-8000-000000000010', 'inventory.manage', 'Quản trị Inventory'),
       ('e1000000-0000-4000-8000-000000000011', 'procedure.act', 'Thao tác trên hồ sơ theo vai trò RACI'),
       ('e1000000-0000-4000-8000-000000000012', 'procedure.design', 'Thiết kế và xem ma trận quy trình')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorization_schema.role_permissions (role_id, permission_id)
       SELECT 'e0000000-0000-4000-8000-000000000001'::uuid, id FROM authorization_schema.permissions WHERE key = 'platform.manage'
       UNION ALL SELECT 'e0000000-0000-4000-8000-000000000002'::uuid, id FROM authorization_schema.permissions WHERE key <> 'platform.manage'
       -- Người tham gia: đọc và thao tác theo vai trò được giao. Không có
       -- procedure.design (không thấy ma trận) và không có procedure.manage
       -- (không override được RACI).
       UNION ALL SELECT 'e0000000-0000-4000-8000-000000000003'::uuid, id FROM authorization_schema.permissions
         WHERE key IN ('procedure.read', 'procedure.act')
       -- Quản lý quy trình: điều hành ma trận RACI và override được mọi bước,
       -- nhưng KHÔNG kèm quyền quản trị tenant/CRM/Inventory. Cho phép cấp cho
       -- nhiều giám đốc mà không phải biến họ thành tenant-admin.
       UNION ALL SELECT 'e0000000-0000-4000-8000-000000000004'::uuid, id FROM authorization_schema.permissions
         WHERE key IN ('procedure.read', 'procedure.act', 'procedure.design', 'procedure.manage')
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key) VALUES
       ($1, 'e0000000-0000-4000-8000-000000000001', NULL, 'platform-superadmin'),
       ($2, 'e0000000-0000-4000-8000-000000000002', 'c1111111-1111-4111-8111-111111111111', 'dakrosa-tenant-admin'),
       ($3, 'e0000000-0000-4000-8000-000000000002', 'c2222222-2222-4222-8222-222222222222', 'anphat-tenant-admin'),
       ($4, 'e0000000-0000-4000-8000-000000000002', 'c3333333-3333-4333-8333-333333333333', 'minhlong-tenant-admin'),
       ($5, 'e0000000-0000-4000-8000-000000000004', $7, 'minhlong-procedure-manager'),
       ($6, 'e0000000-0000-4000-8000-000000000003', $8, 'minhlong-procedure-participant')
       ON CONFLICT (assignment_key) DO NOTHING`,
      [ids.userSuper, ids.userDakrosa, ids.userAnphat, ids.userMinhlong,
       ids.userMinhlongManager, ids.userMinhlongStaff,
       ids.membershipMinhlongManager, ids.membershipMinhlongStaff],
    );
    await client.query(
      `INSERT INTO module_registry_schema.modules (id, key, name, description, launch_url, icon, version) VALUES
       ('f0000000-0000-4000-8000-000000000001', 'procedure-engine', 'Procedure Engine', 'Thiết kế và vận hành quy trình RCSI', '/modules/procedure', 'PE', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000002', 'crm', 'CRM', 'Khách hàng, lead và cơ hội', '/crm', 'CRM', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000003', 'maintenance', 'Maintenance', 'Thiết bị, kế hoạch và bảo trì phòng ngừa', '/modules/maintenance', 'MT', '1.0.0'),
       ('f0000000-0000-4000-8000-000000000004', 'inventory', 'Inventory', 'Kho vật tư, tài sản và sổ cái tồn kho', '/modules/inventory', 'IV', '1.0.0')
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
  const now = new Date().toISOString();
  const richOrganization = userId === ids.userMinhlong;
  const subject = (fallbackLabel: string, unitId: string) => richOrganization
    ? { subjectType: 'organization_unit', subjectId: unitId, subjectLabel: fallbackLabel }
    : { subjectType: 'user', subjectId: userId, subjectLabel: 'Tenant Admin' };
  const assignment = (id: string, role: string, label = 'Ban Giám Đốc', unit = '52000000-0000-4000-8000-000000000001') =>
    ({ id, role, ...subject(label, unit) });
  const definitions = [
    {
      id: '41000000-0000-4000-8000-000000000001', code: 'QT_MSTB', name: 'Quy trình Mua sắm Vật tư thiết bị',
      description: 'Từ đề nghị mua sắm đến phê duyệt và đặt hàng.', kind: 'process', status: 'published', versionNumber: 1,
      steps: [
        { id:'41100000-0000-4000-8000-000000000001',key:'DE_XUAT',order:1,name:'Lập đề xuất mua sắm',assignments:[assignment('41200000-0000-4000-8000-000000000001','S','Phòng Thí Nghiệm','52000000-0000-4000-8000-000000000008'),assignment('41200000-0000-4000-8000-000000000002','R','Phòng Vận hành - Bảo trì','52000000-0000-4000-8000-000000000009')]},
        { id:'41100000-0000-4000-8000-000000000002',key:'KIEM_TRA',order:2,name:'Kiểm tra nhu cầu và ngân sách',assignments:[assignment('41200000-0000-4000-8000-000000000003','C','Phòng Tài chính Kế toán','52000000-0000-4000-8000-000000000012'),assignment('41200000-0000-4000-8000-000000000004','E','Phòng Kỹ thuật','52000000-0000-4000-8000-000000000006')]},
        { id:'41100000-0000-4000-8000-000000000003',key:'PHE_DUYET',order:3,name:'Phê duyệt đề nghị',assignments:[assignment('41200000-0000-4000-8000-000000000005','A'),assignment('41200000-0000-4000-8000-000000000006','I','Phòng Kinh Doanh','52000000-0000-4000-8000-000000000011')]},
      ], createdAt:now,updatedAt:now,publishedAt:now,
    },
    {
      id:'41000000-0000-4000-8000-000000000002',code:'EXEC_QT_MSTB',name:'Luồng Mua sắm, Lắp đặt và Bàn giao Thiết bị Thí nghiệm',
      description:'Luồng thực thi liên phòng ban từ mua sắm đến nghiệm thu.',kind:'process',status:'published',versionNumber:1,
      steps:[
        {id:'41100000-0000-4000-8000-000000000004',key:'MUA_SAM',order:1,name:'Thực hiện mua sắm',assignments:[assignment('41200000-0000-4000-8000-000000000007','S','Phòng Thí Nghiệm','52000000-0000-4000-8000-000000000008'),assignment('41200000-0000-4000-8000-000000000008','R','Phòng Kinh Doanh','52000000-0000-4000-8000-000000000011')]},
        {id:'41100000-0000-4000-8000-000000000005',key:'LAP_DAT',order:2,name:'Lắp đặt thiết bị',assignments:[assignment('41200000-0000-4000-8000-000000000009','R','Phòng Kỹ thuật','52000000-0000-4000-8000-000000000006'),assignment('41200000-0000-4000-8000-000000000010','E','Phòng Vận hành - Bảo trì','52000000-0000-4000-8000-000000000009')]},
        {id:'41100000-0000-4000-8000-000000000006',key:'NGHIEM_THU',order:3,name:'Nghiệm thu kỹ thuật',assignments:[assignment('41200000-0000-4000-8000-000000000011','C','Khối Dịch vụ Kỹ thuật','52000000-0000-4000-8000-000000000003')]},
        {id:'41100000-0000-4000-8000-000000000007',key:'BAN_GIAO',order:4,name:'Bàn giao đưa vào sử dụng',assignments:[assignment('41200000-0000-4000-8000-000000000012','A'),assignment('41200000-0000-4000-8000-000000000013','I','Khối Dịch vụ Thí nghiệm','52000000-0000-4000-8000-000000000004')]},
      ],createdAt:now,updatedAt:now,publishedAt:now,
    },
    {
      id:'41000000-0000-4000-8000-000000000003',code:'QT_THANH_TOAN',name:'Quy trình Thanh toán nhà cung cấp',
      description:'Đối chiếu hồ sơ, phê duyệt và ghi nhận thanh toán.',kind:'process',status:'published',versionNumber:1,
      steps:[
        {id:'41100000-0000-4000-8000-000000000008',key:'HO_SO',order:1,name:'Tập hợp hồ sơ thanh toán',assignments:[assignment('41200000-0000-4000-8000-000000000014','S','Phòng Tài chính Kế toán','52000000-0000-4000-8000-000000000012')]},
        {id:'41100000-0000-4000-8000-000000000009',key:'DOI_CHIEU',order:2,name:'Đối chiếu chứng từ',assignments:[assignment('41200000-0000-4000-8000-000000000015','R','Phòng Tài chính Kế toán','52000000-0000-4000-8000-000000000012'),assignment('41200000-0000-4000-8000-000000000016','C')]},
        {id:'41100000-0000-4000-8000-000000000010',key:'CHI_TIEN',order:3,name:'Phê duyệt chi tiền',assignments:[assignment('41200000-0000-4000-8000-000000000017','A')]},
      ],createdAt:now,updatedAt:now,publishedAt:now,
    },
  ];
  const instance = (number: number, definition: typeof definitions[number], current: number) => {
    const instanceId = `42000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
    const steps = definition.steps.map((step,index) => ({
      id:`42100000-0000-4000-8000-${String(number*10+index+1).padStart(12,'0')}`,
      definitionStepId:step.id,key:step.key,order:step.order,name:step.name,
      status:index<current?'completed':index===current?'active':'pending',
      currentRoleStage:index===current?(step.assignments[0]?.role ?? null):(step.assignments[0]?.role ?? null),
      assignments:step.assignments,startedAt:index<=current?now:undefined,completedAt:index<current?now:undefined,
    }));
    return { id:instanceId,code:`PROC-2026-${String(number).padStart(4,'0')}`,title:`${definition.name} · Hồ sơ ${number}`,
      definitionId:definition.id,definitionCode:definition.code,definitionName:definition.name,definitionVersion:1,status:'running',
      currentStepId:steps[current]?.id,initiatedBy:userId,startedAt:now,steps,
      activity:[{id:`42200000-0000-4000-8000-${String(number).padStart(12,'0')}`,action:'start',actorId:userId,actorName:'Tenant Admin',summary:`Khởi tạo quy trình “${definition.name}”.`,createdAt:now}] };
  };
  const state = { definitions, instances:[instance(1,definitions[0],0),instance(2,definitions[1],1),instance(3,definitions[1],2),instance(4,definitions[2],1)], idempotency:{} };
  await pool.query(
    `INSERT INTO procedure_schema.runtime_state (singleton, state) VALUES (true, $1::jsonb)
     ON CONFLICT (singleton) DO UPDATE SET state=EXCLUDED.state,updated_at=now()
     WHERE jsonb_array_length(procedure_schema.runtime_state.state->'instances')=0
       AND jsonb_array_length(procedure_schema.runtime_state.state->'definitions')<=1`, [JSON.stringify(state)],
  );
}

async function seedCrm(pool: PostgresPool, tenantName: string) {
  await pool.query(
    `INSERT INTO crm_schema.customers (id, name, email) VALUES
     ('20000000-0000-4000-8000-000000000001', $1, 'hello@customer.local'),
     ('20000000-0000-4000-8000-000000000002', $2, 'contact@partner.local')
     ON CONFLICT (id) DO NOTHING`,
    [`Khách hàng mẫu ${tenantName}`, `Đối tác ${tenantName}`],
  );
}

/**
 * Tenant SAVINA: pháp nhân, phòng ban và nhân sự theo sơ đồ tổ chức thực tế.
 * Người kiêm nhiệm nhiều đơn vị chỉ có một membership, gắn nhiều dòng unit_members.
 */
async function seedSavina(platform: PostgresPool, passwordHash: string) {
  const host = process.env.TENANT_SAVINA_DATABASE_HOST ?? 'localhost';
  const port = Number(process.env.TENANT_SAVINA_DATABASE_PORT ?? 55436);

  await inTransaction(platform, async (client) => {
    await client.query(
      `INSERT INTO tenancy_schema.tenants (id, slug, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active'`,
      [SAVINA.tenantId, SAVINA.slug, SAVINA.name],
    );
    await client.query(
      `INSERT INTO tenancy_schema.tenant_db_configs
         (id, tenant_id, database_name, host, port, secret_ref, ssl, config_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, false, 1, 'active')
       ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port, status = 'active'`,
      ['e6666666-6666-4666-8666-666666666666', SAVINA.tenantId, SAVINA.databaseName,
       host, port, SAVINA.secretRef],
    );

    // Tenant admin để đăng nhập và quản trị.
    await client.query(
      `INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind)
       VALUES ($1, $2, 'Quản trị SAVINA', $3, 'tenant-user')
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'`,
      [SAVINA.adminUserId, SAVINA.adminEmail, passwordHash],
    );
    await client.query(
      `INSERT INTO tenancy_schema.tenant_memberships (id, tenant_id, user_id)
       VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET status = 'active'`,
      [SAVINA.adminMembershipId, SAVINA.tenantId, SAVINA.adminUserId],
    );
    await client.query(
      `INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key)
       VALUES ($1, 'e0000000-0000-4000-8000-000000000002', $2, 'savina-tenant-admin')
       ON CONFLICT (assignment_key) DO NOTHING`,
      [SAVINA.adminUserId, SAVINA.adminMembershipId],
    );

    // Cấp toàn bộ module cho tenant.
    await client.query(
      `INSERT INTO subscription_schema.tenant_entitlements (id, tenant_id, module_id, status, provisioned_version)
       SELECT md5($1 || mo.id::text)::uuid, $1::uuid, mo.id, 'active', '1.0.0'
         FROM module_registry_schema.modules mo
        WHERE mo.key IN ('procedure-engine', 'maintenance', 'inventory')
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET status = 'active'`,
      [SAVINA.tenantId],
    );

    // Loại đơn vị.
    for (const [index, [key, name]] of SAVINA_UNIT_TYPES.entries()) {
      await client.query(
        `INSERT INTO organization_schema.unit_types (id, tenant_id, key, name)
         VALUES (md5($1 || $2)::uuid, $1::uuid, $2, $3)
         ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name`,
        [SAVINA.tenantId, key, name],
      );
      void index;
    }

    // Đơn vị: chèn theo thứ tự khai báo nên cha luôn có trước con.
    for (const [code, name, typeKey, parentCode] of SAVINA_UNITS) {
      await client.query(
        `INSERT INTO organization_schema.units (id, tenant_id, code, name, type_id, parent_id)
         VALUES (
           md5($1 || $2)::uuid, $1::uuid, $2, $3,
           (SELECT id FROM organization_schema.unit_types WHERE tenant_id = $1::uuid AND key = $4),
           CASE WHEN $5::text IS NULL THEN NULL ELSE md5($1 || $5)::uuid END
         )
         ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id`,
        [SAVINA.tenantId, code, name, typeKey, parentCode],
      );
    }

    // Nhân sự: mỗi người một tài khoản và một membership.
    for (const [key, fullName, email] of SAVINA_PEOPLE) {
      await client.query(
        `INSERT INTO identity_schema.users (id, email, display_name, password_hash, kind)
         VALUES (md5('savina-user-' || $1)::uuid, $2, $3, $4, 'tenant-user')
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active'`,
        [key, email, fullName, passwordHash],
      );
      await client.query(
        `INSERT INTO tenancy_schema.tenant_memberships (id, tenant_id, user_id)
         VALUES (md5('savina-mem-' || $1)::uuid, $2::uuid, md5('savina-user-' || $1)::uuid)
         ON CONFLICT (id) DO UPDATE SET status = 'active'`,
        [key, SAVINA.tenantId],
      );
      // Ai cũng tham gia hồ sơ theo vai trò được giao.
      await client.query(
        `INSERT INTO authorization_schema.user_roles (user_id, role_id, membership_id, assignment_key)
         VALUES (md5('savina-user-' || $1)::uuid, 'e0000000-0000-4000-8000-000000000003',
                 md5('savina-mem-' || $1)::uuid, 'savina-participant-' || $1)
         ON CONFLICT (assignment_key) DO NOTHING`,
        [key],
      );
    }

    // Gắn người vào đơn vị, kèm chức danh; đánh dấu trưởng đơn vị.
    for (const [personKey, unitCode, title, isHead] of SAVINA_ASSIGNMENTS) {
      await client.query(
        `INSERT INTO organization_schema.positions (id, unit_id, key, name)
         VALUES (md5('savina-pos-' || $1 || $2)::uuid, md5($3 || $2)::uuid, $1 || '@' || $2, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [personKey, unitCode, SAVINA.tenantId, title],
      );
      await client.query(
        `INSERT INTO organization_schema.unit_members (unit_id, membership_id, position_id)
         VALUES (md5($3 || $2)::uuid, md5('savina-mem-' || $1)::uuid, md5('savina-pos-' || $1 || $2)::uuid)
         ON CONFLICT (unit_id, membership_id) DO UPDATE SET position_id = EXCLUDED.position_id`,
        [personKey, unitCode, SAVINA.tenantId],
      );
      if (isHead) {
        await client.query(
          `UPDATE organization_schema.units SET head_membership_id = md5('savina-mem-' || $1)::uuid
            WHERE tenant_id = $3::uuid AND code = $2`,
          [personKey, unitCode, SAVINA.tenantId],
        );
      }
    }
  });
  console.log('Seeded tenant SAVINA.');
}

async function seedOrganization(pool: PostgresPool) {
  const tenantId = ids.tenantMinhlong;
  const membershipId = 'c3333333-3333-4333-8333-333333333333';
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO organization_schema.unit_types (id, tenant_id, key, name) VALUES
       ('51000000-0000-4000-8000-000000000001', $1, 'BOARD', 'Ban lãnh đạo'),
       ('51000000-0000-4000-8000-000000000002', $1, 'DIVISION', 'Khối'),
       ('51000000-0000-4000-8000-000000000003', $1, 'DEPARTMENT', 'Phòng ban'),
       ('51000000-0000-4000-8000-000000000004', $1, 'PLANT', 'Nhà máy'),
       ('51000000-0000-4000-8000-000000000005', $1, 'TEAM', 'Tổ/Nhóm'),
       ('51000000-0000-4000-8000-000000000006', $1, 'REPRESENTATIVE', 'Văn phòng đại diện')
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO organization_schema.units
       (id, tenant_id, code, name, type_id, parent_id, head_membership_id) VALUES
       ('52000000-0000-4000-8000-000000000001', $1, 'BOARD', 'Ban Giám Đốc', '51000000-0000-4000-8000-000000000001', NULL, $2),
       ('52000000-0000-4000-8000-000000000002', $1, 'IT', 'Khối Công nghệ (IT)', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', NULL),
       ('52000000-0000-4000-8000-000000000003', $1, 'TECH', 'Khối Dịch vụ Kỹ thuật', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', NULL),
       ('52000000-0000-4000-8000-000000000004', $1, 'LAB', 'Khối Dịch vụ Thí nghiệm', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', $2),
       ('52000000-0000-4000-8000-000000000005', $1, 'OFFICE', 'Khối Văn Phòng', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', NULL),
       ('52000000-0000-4000-8000-000000000006', $1, 'TECH-DEPT', 'Phòng Kỹ thuật', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000003', NULL),
       ('52000000-0000-4000-8000-000000000007', $1, 'CONSULT', 'Trung tâm Tư Vấn', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000003', NULL),
       ('52000000-0000-4000-8000-000000000008', $1, 'LAB-DEPT', 'Phòng Thí Nghiệm', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000004', $2),
       ('52000000-0000-4000-8000-000000000009', $1, 'OM', 'Phòng Vận hành - Bảo trì', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000004', NULL),
       ('52000000-0000-4000-8000-000000000010', $1, 'ADMIN', 'Phòng Hành chính Tổng hợp', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000005', NULL),
       ('52000000-0000-4000-8000-000000000011', $1, 'SALES', 'Phòng Kinh Doanh', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000005', NULL),
       ('52000000-0000-4000-8000-000000000012', $1, 'FINANCE', 'Phòng Tài chính Kế toán', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000005', NULL),
       ('52000000-0000-4000-8000-000000000013', $1, 'GENERAL', 'Văn phòng', '51000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000005', NULL),
       ('52000000-0000-4000-8000-000000000014', $1, 'SOUTH', 'Văn phòng đại diện phía Nam', '51000000-0000-4000-8000-000000000006', '52000000-0000-4000-8000-000000000001', NULL),
       ('52000000-0000-4000-8000-000000000015', $1, 'HIGHLAND', 'Văn phòng đại diện Tây Nguyên', '51000000-0000-4000-8000-000000000006', '52000000-0000-4000-8000-000000000001', NULL)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [tenantId, membershipId],
    );
    await client.query(
      `INSERT INTO organization_schema.positions (id, unit_id, key, name) VALUES
       ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'BOARD-HEAD', 'Trưởng Ban lãnh đạo'),
       ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000004', 'DIVISION-HEAD', 'Trưởng Khối'),
       ('53000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000008', 'DEPARTMENT-HEAD', 'Trưởng Phòng ban')
       ON CONFLICT (unit_id, key) DO UPDATE SET name = EXCLUDED.name`,
    );
    await client.query(
      `INSERT INTO organization_schema.unit_members (unit_id, membership_id, position_id) VALUES
       ('52000000-0000-4000-8000-000000000001', $1, '53000000-0000-4000-8000-000000000001'),
       ('52000000-0000-4000-8000-000000000004', $1, '53000000-0000-4000-8000-000000000002'),
       ('52000000-0000-4000-8000-000000000008', $1, '53000000-0000-4000-8000-000000000003')
       ON CONFLICT (unit_id, membership_id) DO UPDATE SET position_id = EXCLUDED.position_id`,
      [membershipId],
    );
  });
}

async function seedMaintenance(pool: PostgresPool) {
  await inTransaction(pool, async (client) => {
    // Note: Assets moved to inventory_schema. Seed those via inventory module.
    // Job plans moved to Procedure module as task templates. Seed via procedure module.

    await client.query(
      `INSERT INTO maintenance_schema.procedure_catalog
       (definition_id, code, name, version_number, status) VALUES
       ('41000000-0000-4000-8000-000000000002', 'EXEC_QT_MSTB',
        'Luồng Mua sắm, Lắp đặt và Bàn giao Thiết bị Thí nghiệm', 1, 'published')
       ON CONFLICT (definition_id) DO UPDATE SET name = EXCLUDED.name, version_number = EXCLUDED.version_number, synchronized_at = now()`,
    );
    await client.query(
      `INSERT INTO maintenance_schema.schedules
       (id, code, title, asset_code, procedure_definition_id,
        frequency, status, start_date, timezone, next_due_at) VALUES
       ('63000000-0000-4000-8000-000000000001', 'PEMX_MNK-01_Q',
        'Bảo trì quý - Máy nén khí - 01', 'MNK-01',
        '41000000-0000-4000-8000-000000000002',
        'quarter', 'active', current_date, 'Asia/Ho_Chi_Minh', now() + interval '3 months')
       ON CONFLICT (code) DO UPDATE SET status = 'active', next_due_at = EXCLUDED.next_due_at, updated_at = now()`,
    );
    await client.query(
      `INSERT INTO maintenance_schema.occurrences
       (id, schedule_id, due_at, status, procedure_instance_id,
        procedure_instance_code, idempotency_key) VALUES
       ('64000000-0000-4000-8000-000000000001',
        '63000000-0000-4000-8000-000000000001', now(), 'generated',
        '42000000-0000-4000-8000-000000000003', 'PROC-MAINT-0001',
        'maintenance-seed-occurrence')
       ON CONFLICT (idempotency_key) DO NOTHING`,
    );
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await derivePassword(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
