#!/usr/bin/env node
// Khởi tạo giá vốn bình quân `material_inventory.avg_cost` từ sổ kho của MỘT DB tenant (T1-22, TC-MIG-04).
// Chạy sau migration inventory/0016-costing (cột avg_cost có giá trị 0 cho dòng cũ).
//
//   node tools/inventory/init-avg-cost.mjs --database-url=postgres://user:pass@host:5432/tenant_db --dry-run
//   node tools/inventory/init-avg-cost.mjs --database-url=postgres://...            # ghi avg_cost
//   INVENTORY_DATABASE_URL=postgres://... node tools/inventory/init-avg-cost.mjs --dry-run --json
//
// Cách tính: đọc `inventory_schema.inventory_transactions` theo thứ tự thời gian (created_at, rồi thứ tự ghi) cho
// từng dòng tồn (kho, vật tư) và áp đúng quy tắc của lúc ghi sổ (packages/modules/inventory/src/lib/domain/costing.ts):
//   - nhập: vế nhập điều chuyển lấy giá vế xuất; đơn giá > 0 thì dùng đơn giá; đơn giá 0 (không ghi) thì giá bình quân
//     hiện tại, tức bình quân không đổi; bình quân mới = (tồn × bình quân + số nhập × đơn giá) / (tồn + số nhập);
//   - xuất: theo bình quân hiện tại (bình quân không đổi); chứng từ đảo có đơn giá > 0 thì xuất ở giá đó;
//   - bình quân 4 chữ số thập phân, làm tròn nửa xa số 0, tính bằng số nguyên (BigInt).
// Chạy lại cho cùng kết quả: kết quả chỉ phụ thuộc sổ kho (chỉ ghi thêm), không phụ thuộc avg_cost đang có.
// --dry-run mở transaction READ ONLY, không ghi gì. Bảng so sánh ra stdout, tóm tắt ra stderr. Mã thoát 0 khi chạy được,
// 1 khi lỗi tham số hoặc kết nối. Hướng dẫn: tools/inventory/README.md.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const QUANTITY_SCALE = 3;
const COST_SCALE = 4;

/** Chuỗi thập phân (pg trả NUMERIC dạng chuỗi) về số nguyên nhân 10^scale, làm tròn nửa xa số 0. */
function toScaled(value, scale) {
  const text = String(value ?? '0').trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`Số không hợp lệ: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  let scaled = BigInt((whole || '0') + (fraction + '0'.repeat(scale)).slice(0, scale));
  if (fraction.charCodeAt(scale) - 48 >= 5) scaled += 1n;
  return sign === '-' && scaled !== 0n ? -scaled : scaled;
}

function divideRounded(numerator, denominator) {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

function formatScaled(value, scale) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Bình quân sau khi nhập (giá trị nhân 10^4). */
function afterReceipt(quantity, average, incoming, cost) {
  if (quantity <= 0n || quantity + incoming <= 0n) return cost;
  return divideRounded(quantity * average + incoming * cost, quantity + incoming);
}

/** Bình quân sau khi xuất ở giá `cost`. */
function afterIssue(quantity, average, outgoing, cost) {
  const remaining = quantity - outgoing;
  if (remaining <= 0n || cost === average) return average;
  const value = quantity * average - outgoing * cost;
  if (value <= 0n) return 0n;
  return divideRounded(value, remaining);
}

const LEDGER_QUERY = `
  SELECT t.id, t.warehouse_id, t.material_id, t.quantity::text AS quantity, t.unit_cost::text AS unit_cost,
         t.reference_type, t.reference_id, (d.reverses_document_id IS NOT NULL) AS is_reversal
    FROM inventory_schema.inventory_transactions t
    JOIN inventory_schema.materials m ON m.id = t.material_id AND m.kind = 'STOCK'
    LEFT JOIN inventory_schema.stock_documents d ON d.id = t.document_id
   WHERE t.workflow_status = 'APPROVED'
   ORDER BY t.created_at, t.ctid`;

const BALANCE_QUERY = `
  SELECT b.id, b.warehouse_id, b.material_id, w.code AS warehouse_code, m.code AS material_code,
         b.quantity::text AS quantity, b.avg_cost::text AS avg_cost
    FROM inventory_schema.material_inventory b
    JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
    JOIN inventory_schema.materials m ON m.id = b.material_id
   WHERE b.location_id IS NULL
   ORDER BY w.code, m.code`;

/** Tính giá bình quân cuối cùng của từng dòng tồn từ sổ kho. Hàm thuần trên dòng đã đọc. */
export function replayLedger(rows) {
  const states = new Map();
  const costById = new Map();
  for (const row of rows) {
    const key = `${row.warehouse_id}|${row.material_id}`;
    const state = states.get(key) ?? { quantity: 0n, average: 0n };
    const delta = toScaled(row.quantity, QUANTITY_SCALE);
    const entered = toScaled(row.unit_cost, COST_SCALE);
    let cost;
    if (delta >= 0n) {
      const transferOut = row.reference_type === 'inventory_transaction' ? costById.get(String(row.reference_id)) : undefined;
      cost = transferOut ?? (entered > 0n ? entered : state.average);
      state.average = afterReceipt(state.quantity, state.average, delta, cost);
    } else {
      cost = row.is_reversal && entered > 0n ? entered : state.average;
      state.average = afterIssue(state.quantity, state.average, -delta, cost);
    }
    state.quantity += delta;
    costById.set(String(row.id), cost);
    states.set(key, state);
  }
  return states;
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Cách dùng: node tools/inventory/init-avg-cost.mjs --database-url=<URL DB tenant> [--dry-run] [--json]\n' +
      'Hoặc đặt biến môi trường INVENTORY_DATABASE_URL.',
  );
  process.exit(1);
}

function printTable(rows) {
  const headers = ['warehouse_code', 'material_code', 'quantity', 'ledger_quantity', 'current_avg_cost', 'computed_avg_cost', 'changed'];
  const cells = rows.map((row) => headers.map((header) => String(row[header])));
  const widths = headers.map((header, index) => Math.max(header.length, ...cells.map((line) => line[index].length)));
  const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd();
  process.stdout.write(`${line(headers)}\n`);
  for (const values of cells) process.stdout.write(`${line(values)}\n`);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        'database-url': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.help) usage();
  const databaseUrl = parsed.values['database-url'] ?? process.env.INVENTORY_DATABASE_URL;
  if (!databaseUrl) usage('Thiếu URL DB tenant.');
  try {
    new URL(databaseUrl);
  } catch {
    usage('URL DB tenant không hợp lệ.');
  }
  const dryRun = parsed.values['dry-run'];

  const client = new Client({ connectionString: databaseUrl, application_name: 'init-avg-cost' });
  await client.connect();
  const report = [];
  try {
    await client.query(dryRun ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN');
    await client.query(`SET LOCAL statement_timeout = '300s'`);
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'inventory_schema' AND table_name = 'material_inventory' AND column_name = 'avg_cost'`,
    );
    if (!column.rows[0]) {
      throw new Error('DB này chưa có cột material_inventory.avg_cost: chạy migration inventory/0016-costing trước.');
    }
    // Ghi thật thì khoá mọi dòng tồn trước khi đọc sổ: chứng từ ghi sổ giữa chừng phải chờ, sổ đọc được là sổ cuối.
    const balances = await client.query(dryRun ? BALANCE_QUERY : `${BALANCE_QUERY} FOR UPDATE OF b`);
    const ledger = await client.query(LEDGER_QUERY);
    const states = replayLedger(ledger.rows);
    for (const balance of balances.rows) {
      const state = states.get(`${balance.warehouse_id}|${balance.material_id}`) ?? { quantity: 0n, average: 0n };
      const current = toScaled(balance.avg_cost, COST_SCALE);
      const computed = state.average < 0n ? 0n : state.average;
      report.push({
        id: balance.id,
        warehouse_code: balance.warehouse_code,
        material_code: balance.material_code,
        quantity: formatScaled(toScaled(balance.quantity, QUANTITY_SCALE), QUANTITY_SCALE),
        ledger_quantity: formatScaled(state.quantity, QUANTITY_SCALE),
        current_avg_cost: formatScaled(current, COST_SCALE),
        computed_avg_cost: formatScaled(computed, COST_SCALE),
        changed: current !== computed,
      });
    }
    if (!dryRun) {
      for (const row of report.filter((item) => item.changed)) {
        await client.query(
          `UPDATE inventory_schema.material_inventory SET avg_cost = $2, updated_at = now() WHERE id = $1`,
          [row.id, row.computed_avg_cost],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const rows = report.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')));
  if (parsed.values.json) process.stdout.write(`${JSON.stringify(rows)}\n`);
  else printTable(rows);
  const changed = rows.filter((row) => row.changed).length;
  const mismatched = rows.filter((row) => row.quantity !== row.ledger_quantity).length;
  console.error(
    `${dryRun ? 'Chạy thử, không ghi gì' : 'Đã ghi'}: ${rows.length} dòng tồn, ${changed} dòng ${dryRun ? 'sẽ đổi' : 'đã đổi'} giá bình quân.` +
      (mismatched > 0 ? ` Cảnh báo: ${mismatched} dòng tồn lệch số lượng so với sổ kho, cần đối soát.` : ''),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
