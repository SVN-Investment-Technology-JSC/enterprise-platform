// Xóa SẠCH dữ liệu nghiệp vụ HRM của MỘT tenant để nạp lại từ Core (hồ sơ nhân sự, công, phép, lương, đơn từ, hợp đồng...).
// Giữ lại cấu hình/danh mục (ca, loại nghỉ, chính sách, công thức, ngạch lương, lịch làm việc mẫu, quy trình duyệt...)
// và TOÀN BỘ dữ liệu Core (tài khoản, nhân sự Core, sơ đồ tổ chức, bổ nhiệm).
//
//   Xem trước (mặc định, KHÔNG ghi gì):  node tools/reset-hrm-data.mjs --tenant=savinajsc
//   Xóa thật:                            node tools/reset-hrm-data.mjs --tenant=savinajsc --apply --confirm=savinajsc
//   Kèm dọn nhân sự Core "mồ côi":       thêm --prune-core-orphans (xóa mềm nhân sự Core không tài khoản, không bổ nhiệm)
//
// KHÔNG HOÀN TÁC ĐƯỢC. Hãy sao lưu CSDL tenant trước (pg_dump) khi --apply. Chạy trong một giao dịch: lỗi thì không đổi gì.
// File đính kèm đã tải lên kho đối tượng (object storage) không bị xóa ở đây; chỉ xóa dòng siêu dữ liệu trong DB.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

// Bảng GIỮ LẠI (cấu hình/danh mục). Mọi bảng khác trong hrm_schema đều bị xóa.
// Bảng mới thêm sau này mặc định bị XÓA: luôn xem bản xem trước trước khi --apply.
const KEEP = new Set([
  'approval_policy_settings',
  'attendance_sites',
  'automation_settings',
  'company_holidays',
  'leave_accrual_schedules',
  'leave_seniority_tiers',
  'leave_types',
  'payroll_sod_settings',
  'policies',
  'policy_versions',
  'position_profiles',
  'request_procedure_bindings',
  'request_procedure_field_mappings',
  'salary_grade_steps',
  'salary_grades',
  'shift_definitions',
  'work_calendar',
  'work_schedule_template_days',
  'work_schedule_templates',
  'workflow_rules',
]);

const root = resolve(import.meta.dirname, '..');
const { Client } = createRequire(join(root, 'apps/api/package.json'))('pg');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const slug = typeof args.tenant === 'string' ? args.tenant.trim() : '';
const apply = args.apply === true;
const prune = args['prune-core-orphans'] === true;
if (!slug || slug.includes(',')) {
  console.error('Thiếu --tenant=<slug>. Chỉ một tenant mỗi lần chạy, không có chế độ "tất cả".');
  process.exit(1);
}
if (apply && args.confirm !== slug) {
  console.error(`Để xóa thật phải thêm --confirm=${slug} (gõ lại đúng slug của tenant).`);
  process.exit(1);
}

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* biến môi trường có thể được truyền từ ngoài */
}
const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
if (!template?.includes('{databaseName}')) {
  console.error('Thiếu TENANT_DATABASE_URL_TEMPLATE.');
  process.exit(1);
}

const platform = new Client({ connectionString: process.env.PLATFORM_DATABASE_URL, connectionTimeoutMillis: 10_000 });
await platform.connect();
const found = await platform.query(
  `SELECT t.id, d.database_name
     FROM tenancy_schema.tenants t
     JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id = t.id AND d.status = 'active'
    WHERE t.slug = $1 AND t.status = 'active'`,
  [slug],
);
await platform.end();
if (!found.rows[0]) {
  console.error(`Không tìm thấy tenant đang hoạt động: ${slug}`);
  process.exit(1);
}
const { id: tenantId, database_name: databaseName } = found.rows[0];

const tenant = new Client({ connectionString: template.replace('{databaseName}', databaseName), connectionTimeoutMillis: 10_000 });
await tenant.connect();
let exitCode = 0;
try {
  console.log(`Tenant ${slug} (CSDL ${databaseName}) | ${apply ? 'XÓA THẬT' : 'XEM TRƯỚC, chưa ghi gì'}\n`);
  const all = (
    await tenant.query(
      `SELECT c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'hrm_schema' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        ORDER BY c.relname`,
    )
  ).rows.map((r) => r.name);
  if (!all.length) throw new Error('Tenant chưa có schema HRM.');
  const unknownKeep = [...KEEP].filter((t) => !all.includes(t));
  const wipe = all.filter((t) => !KEEP.has(t));

  const count = async (table) =>
    Number((await tenant.query(`SELECT count(*)::bigint AS n FROM hrm_schema.${table}`)).rows[0].n);
  const plan = [];
  for (const table of all) plan.push({ table, action: KEEP.has(table) ? 'GIỮ' : 'XÓA', rows: await count(table) });
  const width = Math.max(...plan.map((p) => p.table.length));
  for (const p of plan.filter((x) => x.action === 'XÓA'))
    console.log(`  XÓA  ${p.table.padEnd(width)}  ${String(p.rows).padStart(8)} dòng`);
  console.log('');
  for (const p of plan.filter((x) => x.action === 'GIỮ'))
    console.log(`  giữ  ${p.table.padEnd(width)}  ${String(p.rows).padStart(8)} dòng`);
  if (unknownKeep.length) console.log(`\n(Ghi chú: bảng trong danh sách GIỮ nhưng không tồn tại ở tenant này: ${unknownKeep.join(', ')})`);

  const profiles = await count('employee_profiles').catch(() => 0);
  const core = (await tenant.query(
    `SELECT
       (SELECT count(*) FROM core_schema.employees WHERE deleted_at IS NULL)::int AS employees,
       (SELECT count(*) FROM core_schema.employees WHERE deleted_at IS NULL AND user_id IS NULL)::int AS no_account,
       (SELECT count(*) FROM core_schema.users WHERE status = 'active')::int AS users,
       (SELECT count(*) FROM core_schema.organization_node_assignments
         WHERE deleted_at IS NULL AND status = 'active' AND source_decision_id IS NOT NULL)::int AS decision_assignments`,
  )).rows[0];
  console.log(
    `\nCore (KHÔNG bị xóa): ${core.users} tài khoản hoạt động, ${core.employees} nhân sự (${core.no_account} chưa có tài khoản).` +
      `\nHồ sơ HRM sẽ mất: ${profiles}.` +
      `\nBổ nhiệm Core sinh ra từ quyết định nhân sự của HRM: ${core.decision_assignments} (KHÔNG bị xóa; rà lại ở Core, Sơ đồ tổ chức nếu chức danh chưa đúng).`,
  );

  const orphans = (
    await tenant.query(
      `SELECT e.id, e.full_name, e.work_email
         FROM core_schema.employees e
        WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.user_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM core_schema.organization_node_assignments a
                           WHERE a.employee_id = e.id AND a.deleted_at IS NULL AND a.status = 'active')
        ORDER BY e.full_name`,
      [tenantId],
    )
  ).rows;
  console.log(
    `\nNhân sự Core mồ côi (không tài khoản, không bổ nhiệm): ${orphans.length}` +
      (orphans.length ? ` — ${prune ? 'SẼ xóa mềm' : 'không đụng tới (thêm --prune-core-orphans để xóa mềm)'}:` : ''),
  );
  for (const o of orphans.slice(0, 50)) console.log(`   - ${o.full_name}${o.work_email ? ` <${o.work_email}>` : ''}`);
  if (orphans.length > 50) console.log(`   ... và ${orphans.length - 50} người khác`);

  if (!apply) {
    console.log('\nChưa ghi gì. Sao lưu CSDL rồi chạy lại với --apply --confirm=' + slug + ' để xóa thật.');
  } else {
    await tenant.query('BEGIN');
    try {
      await tenant.query(`SET LOCAL lock_timeout = '5s'`);
      // Không dùng CASCADE: nếu một bảng GIỮ có khóa ngoại tới bảng bị xóa thì lỗi và hoàn tác, thay vì xóa lan.
      await tenant.query(`TRUNCATE ${wipe.map((t) => `hrm_schema.${t}`).join(', ')} RESTART IDENTITY`);
      if (prune && orphans.length)
        await tenant.query(
          `UPDATE core_schema.employees SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, orphans.map((o) => o.id)],
        );
      await tenant.query('COMMIT');
      console.log(`\nĐÃ XÓA ${wipe.length} bảng nghiệp vụ HRM${prune ? ` và xóa mềm ${orphans.length} nhân sự Core mồ côi` : ''}.`);
      console.log('Bước tiếp: rà Sơ đồ tổ chức ở Core, rồi vào HRM, Nhân sự, "Nạp nhân sự từ Core".');
    } catch (error) {
      await tenant.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  exitCode = 1;
  console.error(`LỖI, không đổi gì: ${error.message}`);
} finally {
  await tenant.end();
}
process.exit(exitCode);
