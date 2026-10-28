#!/usr/bin/env node
// Seed dữ liệu lớn cho đo hiệu năng Bán hàng (T7-10, docs/crm/TEST.md mục 1.3 "svn-perf" và 1.4): 50.000 khách,
// 50.000 cơ hội, 30.000 báo giá, 10.000 hợp đồng, 50.000 đơn bán có đợt giao, khoảng 600.000 dòng giao
// (`sales_facts`) trải đều 12 tháng, 30 nhân viên trong 5 nhóm. Ghi thẳng SQL vào `crm_schema` của DB tenant,
// nên CHỈ chạy trên PostgreSQL local (localhost, 127.0.0.1); không bao giờ trỏ vào DB thật.
//
//   node tools/crm/seed-perf.mjs --url=postgres://postgres:pg@localhost:55499/postgres --create-db
//   node tools/crm/seed-perf.mjs --url=postgres://user:pass@localhost:55436/svn_perf
//
// --create-db: tạo DB mới `crm_perf_<số>` trên máy chủ của --url rồi chạy migration integration và crm (như test
// integration). Không có cờ này thì --url phải là DB tenant đã có `crm_schema` (ví dụ tenant `svn-perf` local).
// Kết quả: danh sách nhân viên, nhóm ghi ra file JSON (--out, mặc định thư mục tạm) để measure-perf.mjs dùng.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const OWNERS = 30;
const TEAMS = 5;

function localUrl(raw) {
  if (!raw) throw new Error('Thiếu --url (hoặc biến CRM_PERF_DB_URL).');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Từ chối: chỉ seed vào PostgreSQL local (localhost, 127.0.0.1), không phải "${url.hostname}".`);
  }
  return url;
}

async function createDatabase(url) {
  const name = `crm_perf_${Date.now()}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const target = new URL(url);
  target.pathname = `/${name}`;
  const client = new Client({ connectionString: target.toString() });
  await client.connect();
  try {
    const migrations = join(root, 'migrations');
    await client.query(readFileSync(join(migrations, 'tenant/0001-integration.sql'), 'utf8'));
    const directory = join(migrations, 'tenant/crm');
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
      await client.query(`BEGIN; ${readFileSync(join(directory, file), 'utf8')}; COMMIT;`);
    }
  } finally {
    await client.end();
  }
  console.log(`Đã tạo DB ${name} và chạy migration crm.`);
  return target;
}

async function timed(client, label, sql, values = []) {
  const started = Date.now();
  const result = await client.query(sql, values);
  console.log(`  ${label}: ${result.rowCount ?? 0} dòng, ${((Date.now() - started) / 1000).toFixed(1)} giây`);
  return result;
}

async function seed(client, scale) {
  const exists = await client.query(`SELECT to_regclass('crm_schema.sales_facts') IS NOT NULL AS ready`);
  if (!exists.rows[0].ready) throw new Error('DB chưa có crm_schema.sales_facts (migration crm 0011). Dùng --create-db hoặc chạy migration trước.');
  const seeded = await client.query(`SELECT 1 FROM crm_schema.customers WHERE code = 'PF000001'`);
  if (seeded.rows.length) throw new Error('DB đã có dữ liệu hiệu năng (khách PF000001). Dùng DB mới (--create-db).');

  const owners = Array.from({ length: OWNERS }, () => randomUUID());
  const teams = Array.from({ length: TEAMS }, (_, team) => ({ lead: owners[team * 6], members: owners.slice(team * 6, team * 6 + 6) }));
  const materials = Array.from({ length: 2000 }, () => randomUUID());
  const customers = 50_000 * scale;
  const orders = 50_000 * scale;

  await client.query(`SET synchronous_commit = off`);
  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = 0`);
  const groups = (
    await timed(
      client,
      'nhóm khách',
      `INSERT INTO crm_schema.customer_groups (code, name)
       SELECT 'PERF-G' || g, 'Nhóm hiệu năng ' || g FROM generate_series(1, 5) g RETURNING id`,
    )
  ).rows.map((row) => row.id);
  // Khách: người phụ trách xoay vòng 30 nhân viên, 5 nhóm, 3 miền, 10 tỉnh; tạo rải 12 tháng.
  await timed(
    client,
    'khách hàng',
    `INSERT INTO crm_schema.customers (code, name, owner_user_id, group_id, region, province, kind, payment_term_days, created_at, updated_at)
     SELECT 'PF' || lpad(i::text, 6, '0'),
            'Công ty ' || (ARRAY['An Phát','Bình Minh','Cường Thịnh','Đại Việt','Hà Thành','Lan Anh','Minh Long','Nam Sơn'])[1 + i % 8] || ' ' || i,
            ($1::uuid[])[1 + i % 30], ($2::uuid[])[1 + i % 5],
            (ARRAY['Miền Bắc','Miền Trung','Miền Nam'])[1 + i % 3],
            (ARRAY['Hà Nội','Hải Phòng','Quảng Ninh','Đà Nẵng','Huế','Khánh Hoà','TP Hồ Chí Minh','Cần Thơ','Bình Dương','Đồng Nai'])[1 + i % 10],
            'CUSTOMER', 30, now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day' + (i % 1000) * interval '1 second'
       FROM generate_series(1, $3::int) i`,
    [owners, groups, customers],
  );
  await client.query(`CREATE TEMP TABLE perf_customers ON COMMIT DROP AS
    SELECT id, owner_user_id, row_number() OVER (ORDER BY code) AS rn FROM crm_schema.customers WHERE code LIKE 'PF%'`);
  await client.query(`CREATE INDEX ON perf_customers (rn)`);
  await timed(
    client,
    'cơ hội',
    `INSERT INTO crm_schema.opportunities (customer_id, name, stage, probability, expected_value, lost_reason, owner_user_id, created_at, updated_at)
     SELECT c.id, 'Cơ hội hiệu năng ' || i,
            (ARRAY['NEW','CONTACTED','DISCOVERY','QUOTING','NEGOTIATION','WON','LOST'])[1 + i % 7],
            (i % 10) * 10, (i % 50 + 1) * 10000000,
            CASE WHEN i % 7 = 6 THEN 'Giá cao' END,
            c.owner_user_id, now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day' + (i % 1000) * interval '1 second'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 7919) % $1::int`,
    [customers],
  );
  await timed(
    client,
    'báo giá',
    `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id, status, created_at, updated_at)
     SELECT 'PFBG' || lpad(i::text, 7, '0'), c.id, c.owner_user_id,
            (ARRAY['DRAFT','PENDING','APPROVED','SENT','ACCEPTED','DECLINED'])[1 + i % 6],
            now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 104729) % $2::int`,
    [Math.round(customers * 0.6), customers],
  );
  await timed(
    client,
    'hợp đồng',
    `INSERT INTO crm_schema.contracts (code, type, customer_id, title, valid_from, valid_to, owner_user_id, status, created_at, updated_at)
     SELECT 'PFHD' || lpad(i::text, 7, '0'), 'SALE', c.id, 'Hợp đồng hiệu năng ' || i,
            (now() - (i % 365) * interval '1 day')::date,
            GREATEST(now() - (i % 365) * interval '1 day', now() + ((i % 400) - 30) * interval '1 day')::date,
            c.owner_user_id, (ARRAY['ACTIVE','ACTIVE','COMPLETED','CANCELLED'])[1 + i % 4],
            now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 15485863) % $2::int`,
    [Math.round(customers * 0.2), customers],
  );
  // Đơn: rải 12 tháng; trạng thái đã giao là chủ yếu, một phần đang chờ giao (có đợt trễ).
  await timed(
    client,
    'đơn bán',
    `INSERT INTO crm_schema.sales_orders (code, source, customer_id, owner_user_id, status, order_date, total_amount, net_amount, created_at, updated_at)
     SELECT 'PFDH' || lpad(i::text, 7, '0'), 'DIRECT', c.id, c.owner_user_id,
            (ARRAY['DONE','DONE','DELIVERED','DONE','DONE','PARTIAL','DELIVERING','DONE','CONFIRMED','DONE'])[1 + i % 10],
            (now() - (i % 365) * interval '1 day')::date, (i % 40 + 1) * 11000000, (i % 40 + 1) * 10000000,
            now() - (i % 365) * interval '1 day', now() - (i % 365) * interval '1 day' + (i % 1000) * interval '1 second'
       FROM generate_series(1, $1::int) i JOIN perf_customers c ON c.rn = 1 + (i::bigint * 31) % $1::int`,
    [orders],
  );
  await timed(
    client,
    'đợt giao',
    `INSERT INTO crm_schema.delivery_plans (order_id, code, seq, planned_date, status, issued_at)
     SELECT o.id, 'PFGH' || substr(o.code, 5), 1, o.order_date + 7,
            CASE WHEN o.status IN ('CONFIRMED', 'DELIVERING', 'PARTIAL') THEN 'PLANNED'
                 WHEN o.status IN ('DRAFT', 'CANCELLED') THEN 'CANCELLED' ELSE 'ISSUED' END,
            CASE WHEN o.status IN ('DONE', 'DELIVERED') THEN o.created_at + interval '7 days' END
       FROM crm_schema.sales_orders o WHERE o.code LIKE 'PFDH%'`,
  );
  // Dòng giao: 16 dòng mỗi đơn đã giao, 8 với đơn giao một phần (khoảng 600.000 với 50.000 đơn), 2.000 mặt hàng, 20 nhóm hàng.
  await timed(
    client,
    'dòng giao (sales_facts)',
    `INSERT INTO crm_schema.sales_facts
       (source_type, document_id, delivery_id, order_id, order_line_id, customer_id, customer_group_id, region, province,
        owner_user_id, material_id, material_code, material_name, category, delivered_at, delivered_date,
        quantity, revenue, vat_amount, cost_amount)
     SELECT 'stock_issue', d.id, d.id, o.id, gen_random_uuid(), o.customer_id, c.group_id, c.region, c.province, o.owner_user_id,
            ($1::uuid[])[m.n], 'PF-M' || lpad(m.n::text, 4, '0'), 'Mặt hàng hiệu năng ' || m.n, 'Nhóm hàng ' || (1 + m.n % 20),
            o.created_at, LEAST(o.order_date + (k % 10), (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date),
            1 + k % 5, (1 + k % 5) * (m.n % 50 + 1) * 100000, (1 + k % 5) * (m.n % 50 + 1) * 10000,
            (1 + k % 5) * (m.n % 50 + 1) * 100000 * (0.7 + (k % 3) * 0.05)
       FROM crm_schema.sales_orders o
       JOIN crm_schema.customers c ON c.id = o.customer_id
       JOIN crm_schema.delivery_plans d ON d.order_id = o.id
       CROSS JOIN generate_series(1, 16) k
       CROSS JOIN LATERAL (SELECT 1 + (abs(hashtext(o.code)) + k * 167) % 2000 AS n) m
      WHERE o.code LIKE 'PFDH%' AND o.status IN ('DONE', 'DELIVERED', 'PARTIAL') AND k <= CASE WHEN o.status = 'PARTIAL' THEN 8 ELSE 16 END`,
    [materials],
  );
  // Sổ công nợ: một khoản nợ mỗi đơn đã giao, khoảng một nửa đã thu.
  await timed(
    client,
    'sổ công nợ',
    `INSERT INTO crm_schema.receivable_entries (kind, customer_id, order_id, amount, entry_date, due_date, source_type, source_id)
     SELECT 'DEBIT', o.customer_id, o.id, o.total_amount, o.order_date + 7, o.order_date + 37, 'perf_debit', o.id::text
       FROM crm_schema.sales_orders o WHERE o.code LIKE 'PFDH%' AND o.status IN ('DONE', 'DELIVERED', 'PARTIAL')`,
  );
  await timed(
    client,
    'thu tiền',
    `INSERT INTO crm_schema.receivable_entries (kind, customer_id, order_id, amount, entry_date, ref_entry_id, source_type, source_id)
     SELECT 'CREDIT', e.customer_id, e.order_id, -e.amount, e.due_date, e.id, 'perf_credit', e.id::text
       FROM crm_schema.receivable_entries e WHERE e.source_type = 'perf_debit' AND abs(hashtext(e.source_id)) % 2 = 0`,
  );
  await client.query('COMMIT');
  console.log('  ANALYZE...');
  await client.query('ANALYZE');
  return { owners, teams };
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: process.env.CRM_PERF_DB_URL },
      'create-db': { type: 'boolean', default: false },
      scale: { type: 'string', default: '1' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Cách dùng: node tools/crm/seed-perf.mjs --url=<postgres local> [--create-db] [--scale=1] [--out=<file.json>]');
    return;
  }
  let url = localUrl(values.url);
  const scale = Number(values.scale);
  if (!Number.isInteger(scale) || scale < 1 || scale > 10) throw new Error('--scale phải là số nguyên 1..10.');
  if (values['create-db']) url = await createDatabase(url);
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const started = Date.now();
  try {
    const result = await seed(client, scale);
    const out = values.out ?? join(tmpdir(), 'crm-perf', `${url.pathname.slice(1)}.json`);
    mkdirSync(dirname(out), { recursive: true });
    const safeUrl = new URL(url);
    safeUrl.password = '';
    writeFileSync(out, JSON.stringify({ database: url.pathname.slice(1), url: safeUrl.toString(), ...result }, null, 2));
    console.log(`\nXong trong ${((Date.now() - started) / 1000).toFixed(1)} giây. Nhân viên, nhóm: ${out}`);
    console.log(`Đo: node tools/crm/measure-perf.mjs --url=<cùng URL DB> --seed=${out}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nLỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
