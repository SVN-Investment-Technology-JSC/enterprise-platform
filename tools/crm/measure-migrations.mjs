#!/usr/bin/env node
// Đo thời gian áp migration phase 2 của CRM (0017–0027) trên bản sao có dữ liệu cỡ lớn (P2H-03,
// TC-P2MIG-01, 02, 04, 06). CHỈ chạy với PostgreSQL local (localhost, 127.0.0.1); luôn tạo DB MỚI
// `crm_mig_<mốc thời gian>` và không bao giờ xoá hay sửa DB có sẵn.
//
//   node tools/crm/measure-migrations.mjs --url=postgres://postgres:pg@localhost:55499/postgres            # đo (mặc định)
//   node tools/crm/measure-migrations.mjs --url=... --mode=fresh                                           # TC-P2MIG-04
//   node tools/crm/measure-migrations.mjs --url=... --mode=measure --scale=1 --keep                        # giữ DB để thử tiếp
//
// --mode=measure: tạo DB, áp integration + crm 0001–0016, seed dữ liệu kiểu phase 1 (50.000 khách, 50.000 cơ hội đủ 7
//   giai đoạn kèm lịch sử chuyển giai đoạn, 30.000 báo giá, 10.000 hợp đồng, 50.000 đơn; chỉ dùng cột phase 1), chụp số
//   liệu trước, áp lần lượt 0017…0027 (mỗi file một transaction như migrator, ghi ledger cùng checksum), đo giây từng
//   file, đối chiếu số liệu sau. Cuối cùng chạy lại cả danh sách để kiểm tra "chạy lại được" và không lỗi checksum.
// --mode=fresh: tạo DB trống, áp toàn bộ migration đã đăng ký (integration, tenant-core, mọi phân hệ) đúng thứ tự trong
//   packages/platform/entitlement/src/lib/tenant-migrations.ts, kiểm `crm_schema` đầy đủ và luồng mặc định có sẵn.
// --mode=fallback: TC-P2MIG-07. DB đầy đủ mọi phân hệ kèm dữ liệu tham chiếu chéo mẫu; chạy phương án dự phòng (xoá `crm_schema`, dòng ledger
//   `crm`, dọn tham chiếu Kho, Tài chính, Workspace) rồi áp lại từ 0001 và kiểm không còn tham chiếu mồ côi.
// --scale=N: nhân số lượng (1..10). --keep: không báo xoá DB (script không bao giờ tự xoá).
//
// Script này tự áp migration (không qua apps/migrator, vốn cần Platform DB) nhưng theo đúng cách của migrator:
// chuẩn hoá xuống dòng, sha256, mỗi file một transaction cùng dòng ledger `integration_schema.schema_migrations`.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const migrations = join(root, 'migrations');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const STAGES = ['NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST'];

function localUrl(raw) {
  if (!raw) throw new Error('Thiếu --url (hoặc biến CRM_TEST_ADMIN_URL).');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Từ chối: chỉ chạy trên PostgreSQL local (localhost, 127.0.0.1), không phải "${url.hostname}".`);
  }
  return url;
}

export function parseRegistry() {
  const text = readFileSync(join(root, 'packages/platform/entitlement/src/lib/tenant-migrations.ts'), 'utf8');
  const pairs = (block) => [...block.matchAll(/version:\s*'([^']+)',\s*path:\s*'([^']+)'/g)].map((m) => ({ version: m[1], path: m[2] }));
  const coreStart = text.indexOf('export const TENANT_CORE_MIGRATIONS');
  const modStart = text.indexOf('export const TENANT_MODULE_MIGRATIONS');
  const core = pairs(text.slice(coreStart, modStart));
  const modules = {};
  const body = text.slice(modStart, text.indexOf('export function tenantModuleMigrations'));
  const re = /^ {2}('?[\w-]+'?): \[/gm;
  const heads = [...body.matchAll(re)];
  heads.forEach((head, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
    modules[head[1].replace(/'/g, '')] = pairs(body.slice(head.index, end));
  });
  return { core, modules };
}

async function createDatabase(url, prefix) {
  const name = `${prefix}_${Date.now()}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const target = new URL(url);
  target.pathname = `/${name}`;
  return { name, url: target };
}

function readSql(path) {
  return readFileSync(join(migrations, path), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Áp một migration như migrator: đã có trong ledger thì chỉ so checksum; chưa có thì chạy cùng dòng ledger. */
async function applyMigration(client, moduleKey, version, path) {
  const sql = readSql(path);
  const checksum = createHash('sha256').update(sql).digest('hex');
  const hasLedger = (await client.query(`SELECT to_regclass('integration_schema.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
  if (hasLedger) {
    const existing = await client.query('SELECT checksum FROM integration_schema.schema_migrations WHERE module_key = $1 AND version = $2', [moduleKey, version]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Checksum mismatch for ${moduleKey}/${version}.`);
      return { skipped: true, seconds: 0 };
    }
  }
  const started = process.hrtime.bigint();
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO integration_schema.schema_migrations (module_key, version, checksum) VALUES ($1, $2, $3) ON CONFLICT (module_key, version) DO NOTHING`,
      [moduleKey, version, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { skipped: false, seconds: Number(process.hrtime.bigint() - started) / 1e9 };
}

async function applyBase(client, registry, { full }) {
  await applyMigration(client, 'integration', '0001-integration', 'tenant/0001-integration.sql');
  if (full) for (const m of registry.core) await applyMigration(client, 'tenant-core', m.version, m.path);
}

async function timed(client, label, sql, values = []) {
  const started = Date.now();
  const result = await client.query(sql, values);
  console.log(`  seed ${label}: ${result.rowCount ?? 0} dòng, ${((Date.now() - started) / 1000).toFixed(1)} giây`);
  return result;
}

/** Seed kiểu phase 1: chỉ dùng cột có từ 0001–0016 (logic theo tools/crm/seed-perf.mjs). */
async function seedPhase1(client, scale) {
  const owners = Array.from({ length: 30 }, () => randomUUID());
  const customers = 50_000 * scale;
  await client.query(`SET synchronous_commit = off`);
  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = 0`);
  const groups = (await timed(client, 'nhóm khách', `INSERT INTO crm_schema.customer_groups (code, name) SELECT 'PERF-G' || g, 'Nhóm hiệu năng ' || g FROM generate_series(1, 5) g RETURNING id`)).rows.map((r) => r.id);
  await timed(
    client,
    'khách hàng',
    `INSERT INTO crm_schema.customers (code, name, owner_user_id, group_id, region, province, kind, payment_term_days, created_at, updated_at)
     SELECT 'PF' || lpad(i::text, 6, '0'), 'Công ty hiệu năng ' || i, ($1::uuid[])[1 + i % 30], ($2::uuid[])[1 + i % 5],
            (ARRAY['Miền Bắc','Miền Trung','Miền Nam'])[1 + i % 3], (ARRAY['Hà Nội','Đà Nẵng','TP Hồ Chí Minh','Cần Thơ'])[1 + i % 4],
            'CUSTOMER', 30, now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $3::int) i`,
    [owners, groups, customers],
  );
  await client.query(`CREATE TEMP TABLE perf_customers ON COMMIT DROP AS SELECT id, owner_user_id, row_number() OVER (ORDER BY code) AS rn FROM crm_schema.customers WHERE code LIKE 'PF%'`);
  await client.query(`CREATE INDEX ON perf_customers (rn)`);
  await timed(
    client,
    'cơ hội (7 giai đoạn)',
    `INSERT INTO crm_schema.opportunities (customer_id, name, stage, probability, expected_value, lost_reason, owner_user_id, created_at, updated_at)
     SELECT c.id, 'Cơ hội hiệu năng ' || i, ($2::text[])[1 + i % 7], (i % 10) * 10, (i % 50 + 1) * 10000000,
            CASE WHEN i % 7 = 6 THEN 'Giá cao' END, c.owner_user_id, now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 7919) % $1::int`,
    [customers, STAGES],
  );
  // Lịch sử chuyển giai đoạn: dòng khởi tạo (NULL -> NEW) cho mọi cơ hội, rồi theo đường đi tới giai đoạn hiện tại
  // (WON đi qua QUOTING, NEGOTIATION; LOST rẽ từ DISCOVERY).
  await timed(
    client,
    'lịch sử chuyển giai đoạn',
    `INSERT INTO crm_schema.opportunity_stage_history (opportunity_id, from_stage, to_stage, actor_id, reason, at)
     SELECT o.id, CASE WHEN j = 0 THEN NULL ELSE p.path[j] END, p.path[j + 1], o.owner_user_id, NULL, o.created_at + j * interval '1 hour'
       FROM crm_schema.opportunities o
       CROSS JOIN LATERAL (SELECT CASE o.stage
                WHEN 'NEW' THEN ARRAY['NEW']
                WHEN 'CONTACTED' THEN ARRAY['NEW','CONTACTED']
                WHEN 'DISCOVERY' THEN ARRAY['NEW','CONTACTED','DISCOVERY']
                WHEN 'QUOTING' THEN ARRAY['NEW','CONTACTED','DISCOVERY','QUOTING']
                WHEN 'NEGOTIATION' THEN ARRAY['NEW','CONTACTED','DISCOVERY','QUOTING','NEGOTIATION']
                WHEN 'WON' THEN ARRAY['NEW','CONTACTED','DISCOVERY','QUOTING','NEGOTIATION','WON']
                ELSE ARRAY['NEW','CONTACTED','DISCOVERY','LOST'] END AS path) p
       CROSS JOIN LATERAL generate_series(0, array_length(p.path, 1) - 1) j
      WHERE o.name LIKE 'Cơ hội hiệu năng %'`,
  );
  await timed(
    client,
    'báo giá',
    `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, status, created_at, updated_at)
     SELECT 'PFBG' || lpad(i::text, 7, '0'), c.id, c.owner_user_id, (ARRAY['DRAFT','PENDING','APPROVED','SENT','ACCEPTED','DECLINED'])[1 + i % 6],
            now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 104729) % $2::int`,
    [Math.round(customers * 0.6), customers],
  );
  await timed(
    client,
    'hợp đồng',
    `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, valid_to, owner_user_id, status, created_at, updated_at)
     SELECT 'PFHD' || lpad(i::text, 7, '0'), 'SALE', c.id, 'Hợp đồng hiệu năng ' || i, (now() - (i % 365) * interval '1 day')::date,
            GREATEST(now() - (i % 365) * interval '1 day', now() + ((i % 400) - 30) * interval '1 day')::date,
            c.owner_user_id, (ARRAY['ACTIVE','ACTIVE','COMPLETED','CANCELLED'])[1 + i % 4], now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 15485863) % $2::int`,
    [Math.round(customers * 0.2), customers],
  );
  await timed(
    client,
    'đơn bán',
    `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, status, order_date, total_amount, net_amount, created_at, updated_at)
     SELECT 'PFDH' || lpad(i::text, 7, '0'), 'DIRECT', c.id, c.owner_user_id,
            (ARRAY['DONE','DONE','DELIVERED','DONE','DONE','PARTIAL','DELIVERING','DONE','CONFIRMED','DONE'])[1 + i % 10],
            (now() - (i % 365) * interval '1 day')::date, (i % 40 + 1) * 11000000, (i % 40 + 1) * 10000000, now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 31) % $1::int`,
    [50_000 * scale],
  );
  await client.query('COMMIT');
  await client.query('ANALYZE');
}

async function snapshot(client) {
  const one = async (sql) => Number((await client.query(sql)).rows[0].n);
  const byStage = (await client.query(`SELECT stage, count(*)::int AS n FROM crm_schema.opportunities GROUP BY stage ORDER BY stage`)).rows;
  return {
    customers: await one(`SELECT count(*) n FROM crm_schema.customers`),
    opportunities: await one(`SELECT count(*) n FROM crm_schema.opportunities`),
    byStage: Object.fromEntries(byStage.map((r) => [r.stage, r.n])),
    history: await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history`),
    quotes: await one(`SELECT count(*) n FROM crm_schema.quotes`),
    contracts: await one(`SELECT count(*) n FROM crm_schema.contracts`),
    orders: await one(`SELECT count(*) n FROM crm_schema.sales_orders`),
  };
}

async function verifyAfter(client, before) {
  const one = async (sql) => Number((await client.query(sql)).rows[0].n);
  const stages = await one(`SELECT count(*) n FROM crm_schema.pipeline_stages s JOIN crm_schema.pipelines p ON p.id = s.pipeline_id WHERE p.is_default`);
  const checks = [];
  const add = (name, actual, expected) => checks.push({ name, actual, expected, ok: actual === expected });
  add('số cơ hội', await one(`SELECT count(*) n FROM crm_schema.opportunities`), before.opportunities);
  add('số cơ hội theo giai đoạn (stage) không đổi', JSON.stringify(Object.fromEntries((await client.query(`SELECT stage, count(*)::int n FROM crm_schema.opportunities GROUP BY stage ORDER BY stage`)).rows.map((r) => [r.stage, r.n]))), JSON.stringify(before.byStage));
  add('cơ hội thiếu pipeline_id hoặc stage_id', await one(`SELECT count(*) n FROM crm_schema.opportunities WHERE pipeline_id IS NULL OR stage_id IS NULL`), 0);
  add('cơ hội có stage_id không khớp mã stage', await one(`SELECT count(*) n FROM crm_schema.opportunities o JOIN crm_schema.pipeline_stages s ON s.id = o.stage_id WHERE s.code <> o.stage OR s.pipeline_id <> o.pipeline_id`), 0);
  add('số dòng lịch sử', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history`), before.history);
  add('lịch sử thiếu to_stage_id', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history WHERE to_stage_id IS NULL`), 0);
  add('lịch sử thiếu from_stage_id khi from_stage có giá trị', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history WHERE from_stage IS NOT NULL AND from_stage_id IS NULL`), 0);
  add('lịch sử to_stage_id không khớp to_stage', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history h JOIN crm_schema.pipeline_stages s ON s.id = h.to_stage_id WHERE s.code <> h.to_stage`), 0);
  add('lịch sử from_stage_id không khớp from_stage', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_history h JOIN crm_schema.pipeline_stages s ON s.id = h.from_stage_id WHERE s.code <> h.from_stage`), 0);
  add('giai đoạn của luồng mặc định', stages, 7);
  add('số dòng kế hoạch giai đoạn', await one(`SELECT count(*) n FROM crm_schema.opportunity_stage_plan`), before.opportunities * 7);
  add('cơ hội không đủ 7 dòng kế hoạch', await one(`SELECT count(*) n FROM crm_schema.opportunities o WHERE (SELECT count(*) FROM crm_schema.opportunity_stage_plan p WHERE p.opportunity_id = o.id) <> 7`), 0);
  add('cơ hội không có đúng 1 giai đoạn ACTIVE hoặc DONE tại giai đoạn hiện tại', await one(`SELECT count(*) n FROM crm_schema.opportunities o WHERE (SELECT count(*) FROM crm_schema.opportunity_stage_plan p WHERE p.opportunity_id = o.id AND p.stage_id = o.stage_id AND p.status IN ('ACTIVE','DONE')) <> 1`), 0);
  for (const key of ['customers', 'quotes', 'contracts', 'orders']) {
    const table = { customers: 'customers', quotes: 'quotes', contracts: 'contracts', orders: 'sales_orders' }[key];
    add(`số ${key}`, await one(`SELECT count(*) n FROM crm_schema.${table}`), before[key]);
  }
  return checks;
}

function printTable(rows, headers) {
  const width = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(width[i])).join('  ');
  console.log(line(headers));
  console.log(width.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

async function modeMeasure(url, scale) {
  const registry = parseRegistry();
  const crm = registry.modules.crm;
  const phase1 = crm.filter((m) => Number(m.version.slice(0, 4)) <= 16);
  const phase2 = crm.filter((m) => Number(m.version.slice(0, 4)) >= 17 && Number(m.version.slice(0, 4)) <= 27);
  if (phase1.length !== 16 || phase2.length !== 11) throw new Error(`Sổ đăng ký bất thường: ${phase1.length} file phase 1, ${phase2.length} file phase 2.`);
  const { name, url: dbUrl } = await createDatabase(url, 'crm_mig');
  console.log(`Đã tạo DB ${name} (không tự xoá; xoá tay khi xong: DROP DATABASE "${name}").`);
  const client = new Client({ connectionString: dbUrl.toString() });
  await client.connect();
  try {
    await applyBase(client, registry, { full: false });
    for (const m of phase1) await applyMigration(client, 'crm', m.version, m.path);
    console.log('Đã áp integration và crm 0001–0016. Seed dữ liệu kiểu phase 1...');
    const seedStart = Date.now();
    await seedPhase1(client, scale);
    console.log(`Seed xong trong ${((Date.now() - seedStart) / 1000).toFixed(1)} giây.`);
    const before = await snapshot(client);
    const size = (await client.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)).rows[0].s;
    console.log('\nTrước khi áp phase 2:', JSON.stringify(before), `| cỡ DB ${size}`);

    const rows = [];
    let total = 0;
    for (const m of phase2) {
      const timeout = Number((readSql(m.path).match(/SET LOCAL statement_timeout = '(\d+)s'/) ?? [])[1] ?? 0);
      const result = await applyMigration(client, 'crm', m.version, m.path);
      total += result.seconds;
      const notes = [];
      if (timeout) notes.push(`statement_timeout ${timeout}s`);
      if (timeout && result.seconds >= timeout * 0.5) notes.push(`CẢNH BÁO: file chạy ${result.seconds.toFixed(1)}s, từ 50% hạn ${timeout}s (một statement không thể vượt thời gian của cả file, nhưng nên kiểm lại với dữ liệu lớn hơn)`);
      rows.push([`${m.version}.sql`, result.seconds.toFixed(2), notes.join('; ')]);
    }
    rows.push(['TỔNG', total.toFixed(2), '']);
    console.log('\nThời gian áp từng migration (mỗi file một transaction, như migrator):');
    printTable(rows, ['file', 'giây', 'ghi chú']);

    const checks = await verifyAfter(client, before);
    console.log('\nĐối chiếu trước và sau (TC-P2MIG-01, 02):');
    printTable(checks.map((c) => [c.ok ? 'KHỚP' : 'LỆCH', c.name, c.actual, c.expected]), ['kết quả', 'hạng mục', 'sau', 'mong đợi']);

    const again = [];
    for (const m of crm) again.push(await applyMigration(client, 'crm', m.version, m.path));
    const reapplied = again.filter((r) => !r.skipped).length;
    const ledger = Number((await client.query(`SELECT count(*) n FROM integration_schema.schema_migrations WHERE module_key = 'crm'`)).rows[0].n);
    console.log(`\nChạy lại cả 27 file: ${reapplied} file bị áp lại (mong đợi 0), không lỗi checksum; ledger crm có ${ledger} dòng (mong đợi 27).`);
    const failed = checks.filter((c) => !c.ok).length + (reapplied === 0 ? 0 : 1) + (ledger === 27 ? 0 : 1);
    console.log(failed === 0 ? '\nKẾT QUẢ: ĐẠT' : `\nKẾT QUẢ: KHÔNG ĐẠT (${failed} lỗi)`);
    return failed === 0;
  } finally {
    await client.end();
  }
}

async function modeFresh(url) {
  const registry = parseRegistry();
  const { name, url: dbUrl } = await createDatabase(url, 'crm_mig_fresh');
  console.log(`Đã tạo DB ${name} (không tự xoá).`);
  const client = new Client({ connectionString: dbUrl.toString() });
  await client.connect();
  try {
    const started = Date.now();
    await applyBase(client, registry, { full: true });
    let count = 1 + registry.core.length;
    for (const key of Object.keys(registry.modules)) {
      for (const m of registry.modules[key]) {
        await applyMigration(client, key, m.version, m.path);
        count += 1;
      }
    }
    console.log(`Đã áp ${count} migration (integration, tenant-core, ${Object.keys(registry.modules).length} phân hệ) trong ${((Date.now() - started) / 1000).toFixed(1)} giây.`);
    const one = async (sql) => Number((await client.query(sql)).rows[0].n);
    const checks = [];
    const add = (name, actual, expected) => checks.push({ name, actual, expected, ok: actual === expected });
    add('dòng ledger crm', await one(`SELECT count(*) n FROM integration_schema.schema_migrations WHERE module_key = 'crm'`), registry.modules.crm.length);
    const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm_schema' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name);
    // Bảng mong đợi: mọi CREATE TABLE trong các file crm (quét từ nguồn migration).
    const expected = new Set();
    for (const m of registry.modules.crm) for (const t of readSql(m.path).matchAll(/CREATE TABLE IF NOT EXISTS crm_schema\.(\w+)/g)) expected.add(t[1]);
    const missing = [...expected].filter((t) => !tables.includes(t));
    add(`bảng crm_schema (mong đợi ${expected.size} bảng khai trong migration)`, tables.length, expected.size);
    add('bảng khai trong migration mà thiếu trong DB', missing.join(',') || 'không', 'không');
    const pipelines = (await client.query(`SELECT code, profile, is_default, (SELECT count(*)::int FROM crm_schema.pipeline_stages s WHERE s.pipeline_id = p.id) AS stages FROM crm_schema.pipelines p ORDER BY sort_order, code`)).rows;
    add('luồng mặc định (is_default) số lượng', pipelines.filter((p) => p.is_default).length, 1);
    add('luồng mặc định có 7 giai đoạn', pipelines.find((p) => p.is_default)?.stages, 7);
    add('có luồng chào thầu TENDER (0024)', pipelines.some((p) => p.profile === 'TENDER'), true);
    add('loại tài liệu mẫu (0020) > 0', (await one(`SELECT count(*) n FROM crm_schema.document_types`)) > 0, true);
    add('trigger đồng bộ stage (0018) có mặt', await one(`SELECT count(*) n FROM pg_trigger WHERE tgname IN ('trg_crm_opportunities_sync_stage','trg_crm_opportunity_stage_history_sync_ids') AND NOT tgisinternal`), 2);
    add('khi chạy lại không áp thêm file nào', await (async () => { let n = 0; for (const key of Object.keys(registry.modules)) for (const m of registry.modules[key]) if (!(await applyMigration(client, key, m.version, m.path)).skipped) n += 1; return n; })(), 0);
    console.log('\nLuồng:', JSON.stringify(pipelines));
    console.log('\nKiểm DB mới (TC-P2MIG-04):');
    printTable(checks.map((c) => [c.ok ? 'ĐẠT' : 'LỖI', c.name, String(c.actual), String(c.expected)]), ['kết quả', 'hạng mục', 'thực tế', 'mong đợi']);
    const ok = checks.every((c) => c.ok);
    console.log(ok ? '\nKẾT QUẢ: ĐẠT' : '\nKẾT QUẢ: KHÔNG ĐẠT');
    return ok;
  } finally {
    await client.end();
  }
}

// Phương án dự phòng (TC-P2MIG-07): xoá crm_schema và dòng ledger `crm`, dọn tham chiếu Kho, Tài chính, Workspace, rồi
// áp lại từ 0001. Danh sách câu lệnh dưới đây là bản đã thử; runbook (docs/crm/RUNBOOK_PHASE2.md) dùng cùng nội dung.
const FALLBACK_SQL = [
  ['Nhả giữ hàng của đơn, hợp đồng CRM còn mở (trả phần chưa xuất về tồn khả dụng, như releaseLockedReservation của Kho)',
    `UPDATE inventory_schema.material_inventory b
        SET quantity_reserved = GREATEST(0, b.quantity_reserved - r.outstanding), updated_at = now()
       FROM (SELECT i.warehouse_id, i.material_id, SUM(i.quantity_reserved - COALESCE(i.quantity_issued, 0)) AS outstanding
               FROM inventory_schema.reservation_items i
               JOIN inventory_schema.reservations h ON h.id = i.reservation_id
              WHERE h.source_type IN ('crm_order', 'crm_contract') AND h.status IN ('PENDING', 'RESERVED', 'PARTIALLY_ISSUED')
              GROUP BY i.warehouse_id, i.material_id) r
      WHERE b.warehouse_id = r.warehouse_id AND b.material_id = r.material_id AND b.location_id IS NULL`],
  ['Đóng giữ hàng CRM còn mở',
    `UPDATE inventory_schema.reservations SET status = 'CANCELLED'
      WHERE source_type IN ('crm_order', 'crm_contract') AND status IN ('PENDING', 'RESERVED', 'PARTIALLY_ISSUED')`],
  ['Tài chính: huỷ phiếu thu nháp do CRM tạo chưa ghi sổ (phiếu đã ghi sổ giữ nguyên làm chứng từ kế toán)',
    `UPDATE finance_schema.vouchers v SET status = 'CANCELLED', updated_at = now()
       FROM finance_schema.voucher_sources s
      WHERE s.voucher_id = v.id AND s.source_module = 'crm' AND v.status IN ('DRAFT', 'PENDING', 'REJECTED')`],
  ['Workspace: bỏ liên kết khách hàng với CRM (khách Workspace trở lại tự quản)',
    `UPDATE workspace_schema.customers SET crm_customer_id = NULL, crm_version = NULL, updated_at = now() WHERE crm_customer_id IS NOT NULL`],
  ['Workspace: gỡ liên kết dự án, công việc tới đối tượng CRM',
    `DELETE FROM workspace_schema.external_references WHERE module_key = 'crm'`],
  ['Dọn sự kiện CRM chưa phát khỏi outbox (sự kiện đã phát giữ nguyên)',
    `DELETE FROM integration_schema.outbox_events WHERE event_type LIKE 'crm.%' AND published_at IS NULL`],
  ['Dọn thông báo trỏ vào trang CRM',
    `DELETE FROM notification_schema.notifications WHERE deep_link LIKE '/modules/crm%'`],
  ['Xoá schema CRM',
    `DROP SCHEMA crm_schema CASCADE`],
  ['Xoá dòng ledger của CRM (để migrator áp lại 0001 đến mới nhất)',
    `DELETE FROM integration_schema.schema_migrations WHERE module_key = 'crm'`],
];

async function referenceCounts(client) {
  const one = async (sql) => Number((await client.query(sql)).rows[0].n);
  return {
    'workspace.customers có crm_customer_id': await one(`SELECT count(*) n FROM workspace_schema.customers WHERE crm_customer_id IS NOT NULL`),
    'workspace.external_references module_key=crm': await one(`SELECT count(*) n FROM workspace_schema.external_references WHERE module_key = 'crm'`),
    'inventory.reservations nguồn crm_order/crm_contract còn mở': await one(`SELECT count(*) n FROM inventory_schema.reservations WHERE source_type IN ('crm_order','crm_contract') AND status IN ('PENDING','RESERVED','PARTIALLY_ISSUED')`),
    'inventory.reservations nguồn crm (mọi trạng thái)': await one(`SELECT count(*) n FROM inventory_schema.reservations WHERE source_type LIKE 'crm\\_%'`),
    'inventory.stock_documents nguồn crm_*': await one(`SELECT count(*) n FROM inventory_schema.stock_documents WHERE source_type LIKE 'crm\\_%'`),
    'inventory.material_inventory.quantity_reserved (tổng)': await one(`SELECT COALESCE(sum(quantity_reserved),0) n FROM inventory_schema.material_inventory`),
    'finance.voucher_sources source_module=crm': await one(`SELECT count(*) n FROM finance_schema.voucher_sources WHERE source_module = 'crm'`),
    'finance: phiếu từ CRM chưa ghi sổ (DRAFT/PENDING/REJECTED)': await one(`SELECT count(*) n FROM finance_schema.voucher_sources s JOIN finance_schema.vouchers v ON v.id = s.voucher_id WHERE s.source_module = 'crm' AND v.status IN ('DRAFT','PENDING','REJECTED')`),
    'procedure.instances nguồn crm_* (đang chạy)': await one(`SELECT count(*) n FROM procedure_schema.instances WHERE source_type LIKE 'crm\\_%' AND status = 'running'`),
    'procedure.instances nguồn crm_* (mọi trạng thái)': await one(`SELECT count(*) n FROM procedure_schema.instances WHERE source_type LIKE 'crm\\_%'`),
    'outbox crm.% chưa phát': await one(`SELECT count(*) n FROM integration_schema.outbox_events WHERE event_type LIKE 'crm.%' AND published_at IS NULL`),
    'notifications trỏ /modules/crm': await one(`SELECT count(*) n FROM notification_schema.notifications WHERE deep_link LIKE '/modules/crm%'`),
    'ledger crm': await one(`SELECT count(*) n FROM integration_schema.schema_migrations WHERE module_key = 'crm'`),
    'crm_schema tồn tại': await one(`SELECT count(*) n FROM pg_namespace WHERE nspname = 'crm_schema'`),
  };
}

async function seedCrossRefs(client) {
  const user = randomUUID();
  const sql = (text, values) => client.query(text, values);
  const crmCustomer = (await sql(`INSERT INTO crm_schema.customers (code, name, kind, payment_term_days, owner_user_id) VALUES ('KHTEST1', 'Khách thử dự phòng', 'CUSTOMER', 30, $1) RETURNING id`, [user])).rows[0].id;
  await sql(`INSERT INTO crm_schema.customers (code, name, kind, payment_term_days, owner_user_id) VALUES ('KHTEST2', 'Khách thử dự phòng 2', 'CUSTOMER', 30, $1)`, [user]);
  await sql(`INSERT INTO workspace_schema.customers (code, name, created_by, crm_customer_id, crm_version) VALUES ('KHTEST1', 'Khách thử dự phòng', $1, $2, 3), ('WSONLY', 'Khách chỉ ở Workspace', $1, NULL, NULL)`, [user, crmCustomer]);
  const project = (await sql(`INSERT INTO workspace_schema.projects (code, name, owner_user_id, created_by) VALUES ('DA-TEST', 'Dự án thử', $1, $1) RETURNING id`, [user])).rows[0].id;
  await sql(`INSERT INTO workspace_schema.external_references (entity_type, entity_id, project_id, module_key, external_id, external_code, launch_url, created_by)
             VALUES ('project', $1, $1, 'crm', $2, 'CO-1', '/modules/crm/opportunities/x', $3), ('project', $1, $1, 'inventory', $2, 'IV-1', '/modules/inventory/x', $3)`, [project, randomUUID(), user]);
  const wh = (await sql(`INSERT INTO inventory_schema.warehouses (code, name) VALUES ('KHO-TEST', 'Kho thử') RETURNING id`)).rows[0].id;
  const mat = (await sql(`INSERT INTO inventory_schema.materials (code, name, kind, category, unit) VALUES ('VT-TEST', 'Vật tư thử', 'STOCK', 'CONSUMABLE', 'cái') RETURNING id`)).rows[0].id;
  await sql(`INSERT INTO inventory_schema.material_inventory (warehouse_id, material_id, quantity, quantity_reserved) VALUES ($1, $2, 100, 12)`, [wh, mat]);
  for (const [code, type, qty, issued, status] of [['RES-T1', 'crm_order', 5, 0, 'RESERVED'], ['RES-T2', 'crm_contract', 7, 2, 'PARTIALLY_ISSUED']]) {
    const res = (await sql(`INSERT INTO inventory_schema.reservations (reservation_code, reference_type, reference_id, status, created_by, source_type, source_id) VALUES ($1, 'SALES', $2, $3, $4, $5, $2) RETURNING id`, [code, randomUUID(), status, user, type])).rows[0].id;
    await sql(`INSERT INTO inventory_schema.reservation_items (reservation_id, warehouse_id, material_id, quantity_reserved, quantity_issued) VALUES ($1, $2, $3, $4, $5)`, [res, wh, mat, qty, issued]);
  }
  await sql(`INSERT INTO inventory_schema.stock_documents (code, doc_type, status, warehouse_id, source_type, source_id, created_by) VALUES ('PX-TEST', 'ISSUE_SALES', 'POSTED', $1, 'crm_delivery', $2, $3)`, [wh, randomUUID(), user]);
  const tenant = randomUUID();
  for (const [code, status] of [['PT-T1', 'DRAFT'], ['PT-T2', 'DRAFT']]) {
    const v = (await sql(`INSERT INTO finance_schema.vouchers (tenant_id, kind, code, voucher_date, posting_date, content, created_by) VALUES ($1, 'RECEIPT', $2, current_date, current_date, 'Thu tiền CRM', $3) RETURNING id`, [tenant, code, user])).rows[0].id;
    await sql(`INSERT INTO finance_schema.voucher_sources (voucher_id, tenant_id, instance_code, activation, snapshot, status, source_module, source_ref) VALUES ($1, $2, $3, 1, '{}', $4, 'crm', $5)`, [v, tenant, code, code === 'PT-T1' ? 'OPEN' : 'POSTED', randomUUID()]);
  }
  // Phiếu T2 coi như đã ghi sổ phía nguồn (POSTED); phiếu thu vẫn ở trạng thái DRAFT trong test này nên đổi sang APPROVED không cần thiết:
  await sql(`UPDATE finance_schema.vouchers SET status = 'CANCELLED' WHERE code = 'PT-T2'`);
  await sql(`INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, published_at)
             VALUES ($1, 'crm.customer', $2, 'crm.customer.updated', 1, '{}', now(), NULL), ($3, 'crm.customer', $2, 'crm.customer.created', 1, '{}', now(), now())`, [randomUUID(), randomUUID(), randomUUID()]);
  await sql(`INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Người dùng thử', 'thu-du-phong@example.invalid', 'x')`, [user]);
  await sql(`INSERT INTO notification_schema.notifications (id, user_id, module, category, priority, title, body, deep_link, source_type, source_id, sequence)
             VALUES ($1, $2, 'crm', 'reminder', 'informational', 'Nhắc', 'nội dung', '/modules/crm/activities/1', 'crm_activity', '1', 1), ($3, $2, 'hrm', 'x', 'informational', 'Khác', 'nội dung', '/modules/hrm/x', 'hrm', '2', 2)`, [randomUUID(), user, randomUUID()]);
  const def = (await sql(`INSERT INTO procedure_schema.definitions (id, code, name, kind, status, created_at, updated_at) VALUES ($1, 'QT-TEST', 'QT thử', 'process', 'published', now(), now()) RETURNING id`, [randomUUID()])).rows[0].id;
  const ver = (await sql(`INSERT INTO procedure_schema.versions (id, definition_id, version_number, status, snapshot, created_at) VALUES ($1, $2, 1, 'published', '{}', now()) RETURNING id`, [randomUUID(), def])).rows[0].id;
  await sql(`INSERT INTO procedure_schema.instances (id, definition_id, version_id, code, title, status, initiated_by, source_type, source_id, snapshot, started_at) VALUES ($1, $2, $3, 'HS-T1', 'Duyệt báo giá', 'running', $4, 'crm_quote', $5, '{}', now())`, [randomUUID(), def, ver, user, randomUUID()]);
}

async function modeFallback(url) {
  const registry = parseRegistry();
  const { name, url: dbUrl } = await createDatabase(url, 'crm_mig_fallback');
  console.log(`Đã tạo DB ${name} (không tự xoá).`);
  const client = new Client({ connectionString: dbUrl.toString() });
  await client.connect();
  try {
    await applyBase(client, registry, { full: true });
    for (const key of Object.keys(registry.modules)) for (const m of registry.modules[key]) await applyMigration(client, key, m.version, m.path);
    // Dữ liệu tham chiếu chéo mẫu (ít dòng, đủ mọi loại tham chiếu); thời gian xoá schema cỡ lớn đo riêng.
    await seedCrossRefs(client);
    const before = await referenceCounts(client);
    const crmRows = Number((await client.query(`SELECT (SELECT count(*) FROM crm_schema.customers) + (SELECT count(*) FROM crm_schema.opportunities) AS n`)).rows[0].n);
    const otherLedger = (await client.query(`SELECT module_key, count(*)::int n FROM integration_schema.schema_migrations WHERE module_key <> 'crm' GROUP BY module_key ORDER BY 1`)).rows;
    console.log('\nTrước khi xoá:', JSON.stringify(before, null, 1));
    console.log(`Dòng khách+cơ hội CRM: ${crmRows}`);
    await client.query('BEGIN');
    const started = Date.now();
    try {
      for (const [label, text] of FALLBACK_SQL) {
        const r = await client.query(text);
        console.log(`  [${r.rowCount ?? '-'}] ${label}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`Xoá xong trong ${((Date.now() - started) / 1000).toFixed(2)} giây (một transaction).`);
    const mid = await referenceCounts(client);
    console.log('\nSau khi xoá, trước khi áp lại:', JSON.stringify(mid, null, 1));
    const t0 = Date.now();
    let applied = 0;
    for (const key of Object.keys(registry.modules)) for (const m of registry.modules[key]) if (!(await applyMigration(client, key, m.version, m.path)).skipped) { applied += 1; if (key !== 'crm') throw new Error(`Áp lại file không phải CRM: ${key}/${m.version}`); }
    console.log(`\nÁp lại: ${applied} file CRM trong ${((Date.now() - t0) / 1000).toFixed(2)} giây (mong đợi ${registry.modules.crm.length}).`);
    const after = await referenceCounts(client);
    const otherLedgerAfter = (await client.query(`SELECT module_key, count(*)::int n FROM integration_schema.schema_migrations WHERE module_key <> 'crm' GROUP BY module_key ORDER BY 1`)).rows;
    const pipelines = Number((await client.query(`SELECT count(*) n FROM crm_schema.pipelines WHERE is_default`)).rows[0].n);
    const leftover = Number((await client.query(`SELECT count(*) n FROM workspace_schema.customers WHERE crm_customer_id IS NOT NULL`)).rows[0].n);
    const checks = [
      ['áp lại đủ file CRM', applied, registry.modules.crm.length],
      ['ledger crm sau khi áp lại', after['ledger crm'], registry.modules.crm.length],
      ['ledger các module khác không đổi', JSON.stringify(otherLedgerAfter), JSON.stringify(otherLedger)],
      ['luồng mặc định có sẵn', pipelines, 1],
      ['khách CRM sau áp lại (DB trống)', Number((await client.query(`SELECT count(*) n FROM crm_schema.customers`)).rows[0].n), 0],
      ['khách Workspace còn trỏ crm_customer_id', leftover, 0],
      ['external_references crm', after['workspace.external_references module_key=crm'], 0],
      ['giữ hàng CRM còn mở', after['inventory.reservations nguồn crm_order/crm_contract còn mở'], 0],
      ['quantity_reserved tổng (12 - 5 - 5 chưa xuất = 2)', after['inventory.material_inventory.quantity_reserved (tổng)'], 2],
      ['phiếu thu CRM chưa ghi sổ', after['finance: phiếu từ CRM chưa ghi sổ (DRAFT/PENDING/REJECTED)'], 0],
      ['outbox crm chưa phát', after['outbox crm.% chưa phát'], 0],
      ['notification trỏ CRM', after['notifications trỏ /modules/crm'], 0],
    ];
    console.log('\nKiểm sau khi áp lại (TC-P2MIG-07):');
    printTable(checks.map((c) => [String(c[1]) === String(c[2]) ? 'ĐẠT' : 'LỖI', c[0], String(c[1]), String(c[2])]), ['kết quả', 'hạng mục', 'thực tế', 'mong đợi']);
    console.log('\nDữ liệu còn lại có tham chiếu mồ côi tới id CRM cũ (cố ý giữ, chỉ để tra cứu):',
      `stock_documents nguồn crm_* = ${after['inventory.stock_documents nguồn crm_*']}, voucher_sources crm = ${after['finance.voucher_sources source_module=crm']}, procedure.instances nguồn crm_* = ${after['procedure.instances nguồn crm_* (mọi trạng thái)']} (đang chạy: ${after['procedure.instances nguồn crm_* (đang chạy)']}).`);
    const ok = checks.every((c) => String(c[1]) === String(c[2]));
    console.log(ok ? '\nKẾT QUẢ: ĐẠT' : '\nKẾT QUẢ: KHÔNG ĐẠT');
    return ok;
  } finally {
    await client.end();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: process.env.CRM_TEST_ADMIN_URL },
      mode: { type: 'string', default: 'measure' },
      scale: { type: 'string', default: '1' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Cách dùng: node tools/crm/measure-migrations.mjs --url=<postgres local> [--mode=measure|fresh|fallback] [--scale=1]');
    return;
  }
  const url = localUrl(values.url);
  const scale = Number(values.scale);
  if (!Number.isInteger(scale) || scale < 1 || scale > 10) throw new Error('--scale phải là số nguyên 1..10.');
  let ok;
  if (values.mode === 'measure') ok = await modeMeasure(url, scale);
  else if (values.mode === 'fresh') ok = await modeFresh(url);
  else if (values.mode === 'fallback') ok = await modeFallback(url);
  else throw new Error(`--mode không hợp lệ: ${values.mode}`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nLỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
