#!/usr/bin/env node
// Đo hiệu năng danh sách và báo cáo Bán hàng (T7-10, TC-PERF-01 đến TC-PERF-04, docs/crm/TEST.md mục 1.4) trên DB đã
// seed bằng seed-perf.mjs. Gọi thẳng các store Postgres đã build của module-crm (cùng câu SQL API chạy), với phạm vi
// "toàn bộ" (crm.read.all), "nhóm" (trưởng nhóm, 6 người) và "của tôi" (1 người): 5 lần làm nóng, 50 lần đo, in p95.
// Thời gian là thời gian truy vấn ở máy chủ ứng dụng, chưa gồm HTTP, guard và access-decision.
//
//   pnpm nx build module-crm
//   node tools/crm/measure-perf.mjs --url=postgres://postgres:pg@localhost:55499/crm_perf_<số> --seed=<file JSON của seed>
//
// --explain: in `EXPLAIN (ANALYZE, BUFFERS)` của câu chậm nhất. Chỉ chạy với PostgreSQL local.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Pool } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
const dist = join(root, 'packages/modules/crm/dist/lib');

async function load(path) {
  const file = join(dist, path);
  if (!existsSync(file)) throw new Error(`Chưa build module-crm (${file}). Chạy: pnpm nx build module-crm`);
  return import(pathToFileURL(file).href);
}

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function vietnamToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: process.env.CRM_PERF_DB_URL },
      seed: { type: 'string' },
      warmup: { type: 'string', default: '5' },
      runs: { type: 'string', default: '50' },
      only: { type: 'string' },
      explain: { type: 'boolean', default: false },
    },
  });
  if (!values.url || !values.seed) throw new Error('Cần --url (DB đã seed) và --seed (file JSON seed-perf.mjs ghi ra).');
  const url = new URL(values.url);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Từ chối: chỉ đo trên PostgreSQL local.');
  const seed = JSON.parse(readFileSync(values.seed, 'utf8'));
  const warmup = Number(values.warmup);
  const runs = Number(values.runs);

  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  // Ghi lại câu SQL cuối cùng của mỗi phép đo để EXPLAIN câu chậm nhất.
  let last = null;
  const traced = {
    query: (text, params) => {
      last = { text, params };
      return pool.query(text, params);
    },
  };
  const database = { pool: async () => traced, transaction: async () => Promise.reject(new Error('read only')) };

  const [{ PostgresCustomerStore }, { PostgresOpportunityStore }, { PostgresSalesOrderStore }, { PostgresSalesReportStore }, { PostgresReceivableStore }, { decodeCursor }] =
    await Promise.all([
      load('infrastructure/postgres-customer.store.js'),
      load('infrastructure/postgres-opportunity.store.js'),
      load('infrastructure/postgres-sales-order.store.js'),
      load('infrastructure/postgres-sales-report.store.js'),
      load('infrastructure/postgres-receivable.store.js'),
      load('domain/pagination.js'),
    ]);
  const customers = new PostgresCustomerStore(database);
  const opportunities = new PostgresOpportunityStore(database);
  const orders = new PostgresSalesOrderStore(database, new PostgresReceivableStore(database));
  const reports = new PostgresSalesReportStore(database);

  const tenant = 'perf';
  const all = { kind: 'all' };
  const team = { kind: 'users', userIds: seed.teams[0].members };
  const mine = { kind: 'users', userIds: [seed.teams[0].members[1]] };
  const scopes = [
    ['toàn bộ', all],
    ['nhóm', team],
    ['của tôi', mine],
  ];
  const today = vietnamToday();
  const year = { from: addDays(today, -364), to: today };
  const group = (await pool.query(`SELECT id FROM crm_schema.customer_groups WHERE code = 'PERF-G1'`)).rows[0]?.id;

  /** Con trỏ trang thứ `page` (đi lần lượt 30 dòng mỗi trang). */
  async function cursorOfPage(list, page) {
    let cursor;
    for (let index = 1; index < page; index += 1) {
      const result = await list(cursor);
      if (!result.nextCursor) return undefined;
      cursor = decodeCursor(result.nextCursor);
    }
    return cursor;
  }

  const cases = [];
  for (const [label, scope] of scopes) {
    const listCustomers = (cursor, extra = {}) => customers.listCustomers(tenant, scope, { limit: 30, cursor, ...extra });
    const listOpportunities = (cursor) => opportunities.listOpportunities(tenant, scope, { limit: 30, cursor });
    const listOrders = (cursor, extra = {}) => orders.listOrders(tenant, scope, { limit: 30, cursor, today, ...extra });
    cases.push(
      ['TC-PERF-01', `khách trang 1 (${label})`, () => listCustomers()],
      ['TC-PERF-01', `khách tìm "minh" (${label})`, () => listCustomers(undefined, { q: 'minh' })],
      ['TC-PERF-01', `khách lọc nhóm (${label})`, () => listCustomers(undefined, { groupId: group })],
      ['TC-PERF-01', `khách trang 100 (${label})`, async (cursor) => listCustomers(cursor), () => cursorOfPage((cursor) => listCustomers(cursor), 100)],
      ['TC-PERF-02', `cơ hội trang 1 (${label})`, () => listOpportunities()],
      ['TC-PERF-02', `cơ hội trang 100 (${label})`, async (cursor) => listOpportunities(cursor), () => cursorOfPage(listOpportunities, 100)],
      ['TC-PERF-02', `kanban cơ hội (${label})`, () => opportunities.board(tenant, scope, {}, 50)],
      ['TC-PERF-03', `đơn trang 1 (${label})`, () => listOrders()],
      ['TC-PERF-03', `đơn giao trễ (${label})`, () => listOrders(undefined, { late: true })],
      ['TC-PERF-03', `đơn trang 100 (${label})`, async (cursor) => listOrders(cursor), () => cursorOfPage((cursor) => listOrders(cursor), 100)],
    );
    for (const dimension of ['owner', 'customer', 'material', 'category', 'region', 'customerGroup']) {
      cases.push(['TC-PERF-04', `doanh thu 12 tháng theo ${dimension} (${label})`, () => reports.salesByDimension(tenant, scope, dimension, year, 2000)]);
    }
    cases.push(
      ['TC-PERF-04', `chuyển đổi 12 tháng (${label})`, () => reports.conversionCounts(tenant, scope, year)],
      ['TC-PERF-04', `cảnh báo (${label})`, () => reports.alerts(tenant, scope, { today, expiringUntil: addDays(today, 30) })],
      ['TC-PERF-04', `công nợ (${label})`, () => reports.receivables(tenant, scope, { today })],
    );
  }

  const counts = (
    await pool.query(`SELECT (SELECT count(*) FROM crm_schema.customers)::int AS customers,
                             (SELECT count(*) FROM crm_schema.opportunities)::int AS opportunities,
                             (SELECT count(*) FROM crm_schema.sales_orders)::int AS orders,
                             (SELECT count(*) FROM crm_schema.sales_facts)::int AS facts`)
  ).rows[0];
  const version = (await pool.query('SHOW server_version')).rows[0].server_version;
  console.log(`Dữ liệu: ${counts.customers} khách, ${counts.opportunities} cơ hội, ${counts.orders} đơn, ${counts.facts} dòng giao.`);
  console.log(`Máy: ${cpus()[0]?.model ?? '?'} x${cpus().length}, RAM ${(totalmem() / 2 ** 30).toFixed(0)} GB, PostgreSQL ${version}, Node ${process.version}.`);
  console.log(`Mỗi phép đo: ${warmup} lần làm nóng, ${runs} lần đo.\n`);

  const results = [];
  for (const [testCase, label, run, prepare] of cases) {
    if (values.only && !testCase.includes(values.only) && !label.includes(values.only)) continue;
    const argument = prepare ? await prepare() : undefined;
    for (let index = 0; index < warmup; index += 1) await run(argument);
    const samples = [];
    let query = null;
    for (let index = 0; index < runs; index += 1) {
      const started = performance.now();
      await run(argument);
      samples.push(performance.now() - started);
      query = last;
    }
    const limit = testCase === 'TC-PERF-04' ? 5000 : 1000;
    const value = p95(samples);
    results.push({ testCase, label, value, limit, query });
    console.log(`${testCase}  ${value <= limit ? 'Đạt ' : 'LỖI '} p95 ${value.toFixed(1).padStart(8)} ms  (ngưỡng ${limit} ms)  ${label}`);
  }

  const failed = results.filter((result) => result.value > result.limit);
  const slowest = results.reduce((worst, result) => (!worst || result.value > worst.value ? result : worst), null);
  console.log(`\n${results.length - failed.length}/${results.length} phép đo đạt ngưỡng. Chậm nhất: ${slowest?.label} (${slowest?.value.toFixed(1)} ms).`);
  if (values.explain && slowest?.query) {
    const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${slowest.query.text}`, slowest.query.params);
    console.log(`\nEXPLAIN (ANALYZE, BUFFERS) — ${slowest.label}:\n${plan.rows.map((row) => row['QUERY PLAN']).join('\n')}`);
  }
  await pool.end();
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(`\nLỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
