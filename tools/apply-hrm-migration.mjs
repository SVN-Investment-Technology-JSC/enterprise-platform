// Áp migration HRM của chức năng Phân ca cho các tenant được liệt kê (khác migrator: không đụng tới tenant khác).
// Ghi nhận y hệt migrator (cùng checksum đã chuẩn hoá xuống dòng) nên lần deploy sau không áp trùng.
//
//   Xem trước (mặc định, không ghi gì):  node tools/apply-hrm-migration.mjs --tenant=tho-demo
//   Áp thật:                             node tools/apply-hrm-migration.mjs --tenant=tho-demo --apply
//   Nhiều tenant (liệt kê tên):          node tools/apply-hrm-migration.mjs --tenant=cpc,tho-demo,svn,savinajsc --apply
//   Chỉ một migration:                   --version=0036-hrm-work-schedule-rules
//
// Mặc định áp lần lượt 0035 rồi 0036; migration nào tenant đã có thì bỏ qua.
// Không sửa file SQL sau khi đã áp cho bất kỳ tenant nào (checksum đổi sẽ làm migrator báo lỗi); cần đổi thì thêm migration mới.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const DEFAULT_VERSIONS = ['0035-hrm-work-schedules', '0036-hrm-work-schedule-rules'];

const root = resolve(import.meta.dirname, '..');
const { Client } = createRequire(join(root, 'apps/api/package.json'))('pg');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const slugs = typeof args.tenant === 'string' ? [...new Set(args.tenant.split(',').map((x) => x.trim()).filter(Boolean))] : [];
const versions = typeof args.version === 'string' ? args.version.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_VERSIONS;
const apply = args.apply === true;
if (!slugs.length) {
  console.error('Thiếu --tenant=<slug>[,<slug>...]. Phải liệt kê rõ tenant, không có chế độ "tất cả".');
  process.exit(1);
}
if (versions.some((v) => !/^[0-9]{4}-[a-z0-9-]+$/.test(v))) {
  console.error('--version không hợp lệ');
  process.exit(1);
}

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* biến môi trường có thể được truyền từ ngoài */
}

const migrations = [];
for (const version of versions) {
  const sql = (await readFile(join(root, 'migrations/tenant/hrm', `${version}.sql`), 'utf8')).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  migrations.push({ version, sql, checksum: createHash('sha256').update(sql).digest('hex') });
}

const platform = new Client({ connectionString: process.env.PLATFORM_DATABASE_URL, connectionTimeoutMillis: 10_000 });
await platform.connect();
const found = await platform.query(
  `SELECT t.slug, d.database_name
     FROM tenancy_schema.tenants t
     JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id AND d.status = 'active'
    WHERE t.slug = ANY($1::text[]) AND t.status = 'active'`,
  [slugs],
);
await platform.end();
const missing = slugs.filter((slug) => !found.rows.some((r) => r.slug === slug));
if (missing.length) {
  console.error(`Không tìm thấy tenant đang hoạt động: ${missing.join(', ')}. Không áp tenant nào.`);
  process.exit(1);
}
const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
if (!template?.includes('{databaseName}')) {
  console.error('Thiếu TENANT_DATABASE_URL_TEMPLATE.');
  process.exit(1);
}

let failed = 0;
for (const { slug, database_name: databaseName } of slugs.map((s) => found.rows.find((r) => r.slug === s))) {
  const tenant = new Client({ connectionString: template.replace('{databaseName}', databaseName), connectionTimeoutMillis: 10_000 });
  await tenant.connect();
  try {
    const hasHrm = (await tenant.query(`SELECT to_regclass('hrm_schema.shift_definitions') IS NOT NULL AS ok`)).rows[0].ok;
    if (!hasHrm) throw new Error(`Tenant "${slug}" chưa có schema HRM; không áp migration HRM.`);
    for (const { version, sql, checksum } of migrations) {
      const done = await tenant
        .query(`SELECT checksum FROM integration_schema.schema_migrations WHERE module_key = 'hrm' AND version = $1`, [version])
        .then((r) => r.rows[0] ?? null)
        .catch((e) => {
          if (e.code === '42P01' || e.code === '3F000') return null;
          throw e;
        });
      const label = `Tenant ${slug} | hrm/${version} | ${checksum.slice(0, 12)}`;
      if (done) {
        if (done.checksum !== checksum) throw new Error(`${version}: đã được áp với nội dung KHÁC (checksum không khớp). Dừng.`);
        console.log(`${label}: đã áp trước đó, bỏ qua.`);
      } else if (!apply) {
        console.log(`${label}: CHƯA áp (xem trước, chưa ghi gì; thêm --apply để áp).`);
      } else {
        await tenant.query('BEGIN');
        try {
          // Thất bại nhanh thay vì chặn các giao dịch đang chạy trên prod.
          await tenant.query(`SET LOCAL lock_timeout = '5s'`);
          await tenant.query(sql);
          await tenant.query(
            `INSERT INTO integration_schema.schema_migrations (module_key, version, checksum) VALUES ('hrm', $1, $2) ON CONFLICT (module_key, version) DO NOTHING`,
            [version, checksum],
          );
          await tenant.query('COMMIT');
          console.log(`${label}: ĐÃ ÁP.`);
        } catch (error) {
          await tenant.query('ROLLBACK');
          throw error;
        }
      }
    }
  } catch (error) {
    failed++;
    console.error(`Tenant ${slug}: LỖI, dừng tenant này: ${error.message}`);
  } finally {
    await tenant.end();
  }
}
process.exit(failed ? 1 : 0);
