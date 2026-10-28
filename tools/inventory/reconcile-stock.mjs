#!/usr/bin/env node
// Chụp và đối soát tồn kho của MỘT DB tenant (T8-02): trước và sau UAT, trước và sau deploy, số tồn theo kho và mặt
// hàng phải khớp giữa các bảng của Kho. Chỉ đọc: mở transaction READ ONLY, không ghi gì vào DB.
//
//   node tools/inventory/reconcile-stock.mjs --tenant=svn > truoc.json
//   node tools/inventory/reconcile-stock.mjs --database-url=postgres://user:pass@host:5432/tenant_db --format=csv
//   node tools/inventory/reconcile-stock.mjs --tenant=svn --compare=truoc.json
//
// Mỗi dòng là một cặp (kho, mặt hàng) có mặt ở ít nhất một nguồn: tồn (`material_inventory`, cộng mọi vị trí), sổ kho
// (`inventory_transactions`, số lượng có dấu), serial (`serial_tracking` theo kho hiện tại, đếm theo trạng thái tồn và
// chất lượng), lô (`lot_balances` nối `lots`). `--compare` chụp lại rồi so với file JSON đã chụp: in khác biệt, thoát 1
// khi có khác biệt. Hướng dẫn: tools/inventory/README.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const TOOL = 'reconcile-stock';
const FORMAT_VERSION = 1;

/** Cột số của một dòng, theo thứ tự in CSV và so sánh. */
const METRICS = [
  'quantity',
  'quantity_reserved',
  'quantity_blocked',
  'available',
  'avg_cost',
  'ledger_quantity',
  'ledger_diff',
  'ledger_entries',
  'lot_count',
  'lot_quantity',
  'lot_reserved',
  'lot_blocked',
];

// Số giữ dạng chuỗi chuẩn hoá (`trim_scale`) để so sánh đúng từng chữ số, không qua số thực.
const QUERY = `
  WITH balance AS (
    SELECT warehouse_id, material_id,
           sum(quantity) AS quantity, sum(quantity_reserved) AS quantity_reserved,
           sum(quantity_blocked) AS quantity_blocked, sum(available) AS available,
           -- Bình quân theo tồn khi có nhiều vị trí; một vị trí thì đúng giá đang lưu.
           CASE WHEN count(*) = 1 THEN max(avg_cost)
                WHEN sum(quantity) <> 0 THEN round(sum(quantity * avg_cost) / sum(quantity), 4)
                ELSE max(avg_cost) END AS avg_cost
      FROM inventory_schema.material_inventory
     GROUP BY warehouse_id, material_id
  ), ledger AS (
    SELECT warehouse_id, material_id, sum(quantity) AS quantity, count(*) AS entries
      FROM inventory_schema.inventory_transactions
     GROUP BY warehouse_id, material_id
  ), serial AS (
    SELECT current_warehouse_id AS warehouse_id, material_id,
           jsonb_object_agg(state, n ORDER BY state) AS counts, sum(n) FILTER (WHERE in_stock) AS in_stock
      FROM (
            SELECT current_warehouse_id, material_id,
                   coalesce(stock_state, '-') || '|' || coalesce(quality_status, '-') AS state,
                   stock_state = 'IN_STOCK' AS in_stock, count(*) AS n
              FROM inventory_schema.serial_tracking
             GROUP BY 1, 2, 3, 4
           ) grouped
     GROUP BY current_warehouse_id, material_id
  ), lot AS (
    SELECT b.warehouse_id, l.material_id, count(*) AS lots,
           sum(b.quantity) AS quantity, sum(b.quantity_reserved) AS reserved, sum(b.quantity_blocked) AS blocked
      FROM inventory_schema.lot_balances b
      JOIN inventory_schema.lots l ON l.id = b.lot_id
     GROUP BY b.warehouse_id, l.material_id
  ), keys AS (
    SELECT warehouse_id, material_id FROM balance
    UNION SELECT warehouse_id, material_id FROM ledger
    UNION SELECT warehouse_id, material_id FROM serial
    UNION SELECT warehouse_id, material_id FROM lot
  )
  SELECT coalesce(w.code, '-') AS warehouse_code, coalesce(m.code, k.material_id::text) AS material_code,
         m.is_serialized AS serialized,
         trim_scale(coalesce(b.quantity, 0))::text AS quantity,
         trim_scale(coalesce(b.quantity_reserved, 0))::text AS quantity_reserved,
         trim_scale(coalesce(b.quantity_blocked, 0))::text AS quantity_blocked,
         trim_scale(coalesce(b.available, 0))::text AS available,
         trim_scale(coalesce(b.avg_cost, 0))::text AS avg_cost,
         trim_scale(coalesce(g.quantity, 0))::text AS ledger_quantity,
         trim_scale(coalesce(b.quantity, 0) - coalesce(g.quantity, 0))::text AS ledger_diff,
         coalesce(g.entries, 0)::text AS ledger_entries,
         coalesce(s.counts, '{}'::jsonb) AS serials,
         coalesce(s.in_stock, 0)::text AS serials_in_stock,
         coalesce(t.lots, 0)::text AS lot_count,
         trim_scale(coalesce(t.quantity, 0))::text AS lot_quantity,
         trim_scale(coalesce(t.reserved, 0))::text AS lot_reserved,
         trim_scale(coalesce(t.blocked, 0))::text AS lot_blocked
    FROM keys k
    LEFT JOIN balance b ON b.warehouse_id IS NOT DISTINCT FROM k.warehouse_id AND b.material_id = k.material_id
    LEFT JOIN ledger g ON g.warehouse_id IS NOT DISTINCT FROM k.warehouse_id AND g.material_id = k.material_id
    LEFT JOIN serial s ON s.warehouse_id IS NOT DISTINCT FROM k.warehouse_id AND s.material_id = k.material_id
    LEFT JOIN lot t ON t.warehouse_id IS NOT DISTINCT FROM k.warehouse_id AND t.material_id = k.material_id
    LEFT JOIN inventory_schema.warehouses w ON w.id = k.warehouse_id
    LEFT JOIN inventory_schema.materials m ON m.id = k.material_id
   ORDER BY 1, 2`;

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Cách dùng: node tools/inventory/reconcile-stock.mjs (--tenant=<tên DB> | --database-url=<URL DB tenant>)\n' +
      '           [--format=json|csv] [--out=<file>] [--compare=<file JSON chụp trước>]\n' +
      '  --tenant      lấy URL từ TENANT_DATABASE_URL_TEMPLATE trong .env ở gốc repo ({databaseName} = tên DB).\n' +
      '  --compare     chụp lại rồi so với file JSON; in khác biệt, mã thoát 1 khi có khác biệt.\n' +
      'Hoặc đặt biến môi trường INVENTORY_DATABASE_URL.',
  );
  process.exit(message ? 2 : 0);
}

/** URL theo tên DB, từ biến môi trường hoặc `.env` ở gốc repo. */
function tenantUrl(databaseName) {
  let template = process.env.TENANT_DATABASE_URL_TEMPLATE;
  if (!template) {
    try {
      const line = readFileSync(join(root, '.env'), 'utf8')
        .split(/\r?\n/)
        .find((item) => item.startsWith('TENANT_DATABASE_URL_TEMPLATE='));
      template = line?.slice('TENANT_DATABASE_URL_TEMPLATE='.length).trim().replace(/^["']|["']$/g, '');
    } catch {
      template = undefined;
    }
  }
  if (!template?.includes('{databaseName}')) usage('Không có TENANT_DATABASE_URL_TEMPLATE (chứa {databaseName}) trong môi trường hoặc .env.');
  if (!/^[a-z0-9_]+$/i.test(databaseName)) usage('Tên DB tenant không hợp lệ.');
  return template.replace('{databaseName}', databaseName);
}

/** URL bỏ mật khẩu để in ra. */
function maskUrl(url) {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function snapshot(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, application_name: TOOL });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '120s'`);
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') throw new Error('Không mở được transaction READ ONLY; dừng.');
    const table = await client.query(`SELECT to_regclass('inventory_schema.material_inventory') AS name`);
    if (!table.rows[0]?.name) throw new Error('DB này không có inventory_schema.material_inventory (tenant chưa bật phân hệ Kho?).');
    const { rows } = await client.query(QUERY);
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    await client.query('ROLLBACK');
    return { database, rows };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Tóm tắt: số dòng, tổng tồn, các dòng lệch sổ, lệch serial, lệch lô. */
function summarize(rows) {
  const sum = (key) => rows.reduce((total, row) => total + Number(row[key]), 0);
  const ledgerMismatch = rows.filter((row) => Number(row.ledger_diff) !== 0).map((row) => `${row.warehouse_code}/${row.material_code}`);
  const serialMismatch = rows
    .filter((row) => row.serialized && Number(row.serials_in_stock) !== Number(row.quantity))
    .map((row) => `${row.warehouse_code}/${row.material_code}`);
  const lotMismatch = rows
    .filter((row) => Number(row.lot_count) > 0 && Number(row.lot_quantity) !== Number(row.quantity))
    .map((row) => `${row.warehouse_code}/${row.material_code}`);
  return {
    rows: rows.length,
    totalQuantity: Number(sum('quantity').toFixed(3)),
    totalReserved: Number(sum('quantity_reserved').toFixed(3)),
    totalBlocked: Number(sum('quantity_blocked').toFixed(3)),
    ledgerMismatch,
    serialMismatch,
    lotMismatch,
  };
}

/** So hai bản chụp theo khoá kho/mặt hàng; trả danh sách khác biệt dạng chữ. */
function compare(before, after) {
  const index = (rows) => new Map(rows.map((row) => [`${row.warehouse_code}/${row.material_code}`, row]));
  const left = index(before.rows ?? []);
  const right = index(after.rows ?? []);
  const differences = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(key);
    const b = right.get(key);
    if (!a) {
      differences.push(`${key}: chỉ có ở bản chụp mới (tồn ${b.quantity}).`);
      continue;
    }
    if (!b) {
      differences.push(`${key}: chỉ có ở bản chụp cũ (tồn ${a.quantity}).`);
      continue;
    }
    for (const metric of [...METRICS, 'serials_in_stock']) {
      if (a[metric] !== b[metric]) differences.push(`${key}: ${metric} ${a[metric]} -> ${b[metric]}`);
    }
    const serialStates = [...new Set([...Object.keys(a.serials ?? {}), ...Object.keys(b.serials ?? {})])].sort();
    for (const state of serialStates) {
      const x = Number(a.serials?.[state] ?? 0);
      const y = Number(b.serials?.[state] ?? 0);
      if (x !== y) differences.push(`${key}: serial ${state} ${x} -> ${y}`);
    }
  }
  return differences;
}

function toCsv(rows) {
  const headers = ['warehouse_code', 'material_code', 'serialized', ...METRICS, 'serials_in_stock', 'serials'];
  return [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n';
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        tenant: { type: 'string' },
        'database-url': { type: 'string' },
        format: { type: 'string', default: 'json' },
        out: { type: 'string' },
        compare: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  if (values.help) usage();
  if (values.format !== 'json' && values.format !== 'csv') usage('--format chỉ nhận json hoặc csv.');
  const databaseUrl = values['database-url'] ?? (values.tenant ? tenantUrl(values.tenant) : process.env.INVENTORY_DATABASE_URL);
  if (!databaseUrl) usage('Thiếu --tenant hoặc --database-url.');
  try {
    new URL(databaseUrl);
  } catch {
    usage('URL DB tenant không hợp lệ.');
  }

  const { database, rows } = await snapshot(databaseUrl);
  const result = {
    tool: TOOL,
    formatVersion: FORMAT_VERSION,
    database,
    takenAt: new Date().toISOString(),
    summary: summarize(rows),
    rows,
  };
  const { summary } = result;
  console.error(
    `${maskUrl(databaseUrl)}: ${summary.rows} dòng kho/mặt hàng, tổng tồn ${summary.totalQuantity}, giữ ${summary.totalReserved}, ` +
      `khoá ${summary.totalBlocked}; lệch sổ kho ${summary.ledgerMismatch.length}, lệch serial ${summary.serialMismatch.length}, ` +
      `lệch lô ${summary.lotMismatch.length}.`,
  );

  if (values.compare) {
    let before;
    try {
      before = JSON.parse(readFileSync(values.compare, 'utf8'));
    } catch (error) {
      usage(`Không đọc được file so sánh: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (before.tool !== TOOL) usage('File so sánh không phải bản chụp của reconcile-stock.');
    const differences = compare(before, result);
    if (before.database !== result.database) console.error(`Lưu ý: bản chụp cũ của DB ${before.database}, bản mới của DB ${result.database}.`);
    if (!differences.length) {
      console.log(`Khớp: ${summary.rows} dòng kho/mặt hàng không đổi so với bản chụp ${before.takenAt}.`);
      return;
    }
    console.log(`Khác ${differences.length} chỉ số so với bản chụp ${before.takenAt}:`);
    for (const line of differences) console.log(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  const output = values.format === 'csv' ? toCsv(rows) : `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, output);
  else process.stdout.write(output);
}

main().catch((error) => {
  console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
