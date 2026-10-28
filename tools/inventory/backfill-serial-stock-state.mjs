#!/usr/bin/env node
// Đưa lại serial "chưa vào sổ kho" (stock_state NULL) về Trong kho cho MỘT DB tenant, theo đúng điều kiện backfill của
// migration inventory/0013-serial-quality (serial có kho hiện tại, không gắn thiết bị). Dùng sau khi rollback về bản cũ
// rồi triển khai lại: bản cũ khai serial với stock_state NULL, bản mới coi serial đó là chưa vào sổ kho và không xuất được.
//
//   node tools/inventory/backfill-serial-stock-state.mjs --tenant=svn                 # xem trước (mặc định, READ ONLY)
//   node tools/inventory/backfill-serial-stock-state.mjs --tenant=svn --apply         # ghi
//   node tools/inventory/backfill-serial-stock-state.mjs --database-url=postgres://... --report-negative --json
//
// Chỉ đưa vào Trong kho khi tồn của cặp (kho, mặt hàng) còn chỗ: số serial Trong kho sau khi đưa không vượt phần nguyên
// của `material_inventory.quantity`. Serial vượt tồn được liệt kê là bỏ qua (thủ kho kiểm đếm rồi nhập bằng chứng từ).
// `--report-negative` liệt kê thêm dòng tồn có `available` âm (bản cũ không trừ phần không Đạt khi xuất).
// Bảng ra stdout, tóm tắt ra stderr, mật khẩu trong URL che ***. Mã thoát 0 khi chạy được, 1 khi lỗi tham số hoặc kết
// nối. Hướng dẫn: tools/inventory/README.md.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
const TOOL = 'backfill-serial-stock-state';

// Ứng viên: điều kiện của 0013 (dòng UPDATE ... WHERE stock_state IS NULL AND current_warehouse_id IS NOT NULL AND
// current_asset_id IS NULL). Sắp theo ngày khai để serial khai trước được ưu tiên khi tồn không đủ chỗ.
const CANDIDATE_QUERY = `
  SELECT s.id, s.serial_number, s.material_id, s.current_warehouse_id AS warehouse_id,
         m.code AS material_code, w.code AS warehouse_code, s.created_at
    FROM inventory_schema.serial_tracking s
    JOIN inventory_schema.materials m ON m.id = s.material_id
    JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
   WHERE s.stock_state IS NULL
     AND s.current_warehouse_id IS NOT NULL
     AND s.current_asset_id IS NULL
   ORDER BY w.code, m.code, s.created_at, s.id`;

// Sức chứa của từng cặp (kho, mặt hàng) có ứng viên: tồn (mọi vị trí) và số serial đang Trong kho.
const CAPACITY_QUERY = `
  SELECT k.warehouse_id, k.material_id,
         COALESCE((SELECT SUM(b.quantity) FROM inventory_schema.material_inventory b
                    WHERE b.warehouse_id = k.warehouse_id AND b.material_id = k.material_id), 0)::text AS quantity,
         (SELECT count(*) FROM inventory_schema.serial_tracking s
           WHERE s.current_warehouse_id = k.warehouse_id AND s.material_id = k.material_id
             AND s.stock_state = 'IN_STOCK')::int AS in_stock
    FROM unnest($1::uuid[], $2::uuid[]) AS k(warehouse_id, material_id)`;

const NEGATIVE_QUERY = `
  SELECT w.code AS warehouse_code, m.code AS material_code, b.quantity::text AS quantity,
         b.quantity_reserved::text AS quantity_reserved, b.quantity_blocked::text AS quantity_blocked,
         b.available::text AS available
    FROM inventory_schema.material_inventory b
    JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
    JOIN inventory_schema.materials m ON m.id = b.material_id
   WHERE b.available < 0
   ORDER BY w.code, m.code`;

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Cách dùng: node tools/inventory/backfill-serial-stock-state.mjs (--tenant=<tên DB> | --database-url=<URL DB tenant>)\n' +
      '           [--apply] [--report-negative] [--json]\n' +
      '  mặc định   xem trước, transaction READ ONLY, không ghi gì.\n' +
      '  --apply    ghi stock_state = IN_STOCK cho serial đủ điều kiện.\n' +
      '  --tenant   lấy URL từ TENANT_DATABASE_URL_TEMPLATE (môi trường hoặc .env ở gốc repo, thay {databaseName}).\n' +
      'Hoặc đặt biến môi trường INVENTORY_DATABASE_URL.',
  );
  process.exit(message ? 1 : 0);
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

function maskUrl(url) {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}

/**
 * Chia ứng viên theo sức chứa của từng cặp (kho, mặt hàng). Hàm thuần: `capacity` là map khoá `kho|mặt hàng` ->
 * { quantity, inStock }. Trả danh sách đưa vào Trong kho và danh sách bỏ qua kèm lý do.
 */
export function planBackfill(candidates, capacity) {
  const used = new Map();
  const apply = [];
  const skipped = [];
  for (const row of candidates) {
    const key = `${row.warehouse_id}|${row.material_id}`;
    const room = capacity.get(key) ?? { quantity: 0, inStock: 0 };
    const limit = Math.floor(room.quantity + 1e-9);
    const taken = used.get(key) ?? room.inStock;
    if (taken + 1 > limit) {
      skipped.push({
        ...row,
        reason: `tồn ${room.quantity}, đã có ${taken} serial Trong kho; thêm serial này sẽ vượt tồn`,
      });
      continue;
    }
    used.set(key, taken + 1);
    apply.push(row);
  }
  return { apply, skipped };
}

function printTable(headers, rows) {
  const cells = rows.map((row) => headers.map((header) => String(row[header] ?? '')));
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
        tenant: { type: 'string' },
        'database-url': { type: 'string' },
        apply: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'report-negative': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    usage(error.message);
  }
  const values = parsed.values;
  if (values.help) usage();
  if (values.apply && values['dry-run']) usage('Chọn một trong --apply và --dry-run.');
  const databaseUrl =
    values['database-url'] ?? (values.tenant ? tenantUrl(values.tenant) : process.env.INVENTORY_DATABASE_URL);
  if (!databaseUrl) usage('Thiếu --tenant, --database-url hoặc INVENTORY_DATABASE_URL.');
  const apply = values.apply;

  const client = new Client({ connectionString: databaseUrl, application_name: TOOL });
  await client.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '120s'`);
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'inventory_schema' AND table_name = 'serial_tracking' AND column_name = 'stock_state'`,
    );
    if (!column.rows[0]) throw new Error('DB này chưa chạy migration inventory/0013-serial-quality (thiếu cột stock_state).');

    if (apply) {
      // Khoá dòng tồn rồi serial như đường ghi sổ (tồn theo kho, vật tư; serial theo id) để chứng từ ghi sổ cùng lúc
      // chờ thay vì đọc số đang đổi.
      await client.query(
        `SELECT 1 FROM inventory_schema.material_inventory ORDER BY warehouse_id, material_id FOR UPDATE`,
      );
      await client.query(
        `SELECT 1 FROM inventory_schema.serial_tracking WHERE stock_state IS NULL ORDER BY id FOR UPDATE`,
      );
    }
    const candidates = (await client.query(CANDIDATE_QUERY)).rows;
    const pairs = [...new Map(candidates.map((row) => [`${row.warehouse_id}|${row.material_id}`, row])).values()];
    const capacityRows = pairs.length
      ? (
          await client.query(CAPACITY_QUERY, [
            pairs.map((row) => row.warehouse_id),
            pairs.map((row) => row.material_id),
          ])
        ).rows
      : [];
    const capacity = new Map(
      capacityRows.map((row) => [
        `${row.warehouse_id}|${row.material_id}`,
        { quantity: Number(row.quantity), inStock: Number(row.in_stock) },
      ]),
    );
    const plan = planBackfill(candidates, capacity);

    if (apply && plan.apply.length) {
      await client.query(
        `UPDATE inventory_schema.serial_tracking
            SET stock_state = 'IN_STOCK', updated_at = now()
          WHERE id = ANY($1::uuid[]) AND stock_state IS NULL`,
        [plan.apply.map((row) => row.id)],
      );
    }
    const negative = values['report-negative'] ? (await client.query(NEGATIVE_QUERY)).rows : undefined;
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');

    const view = (row, action) => ({
      action,
      warehouse_code: row.warehouse_code,
      material_code: row.material_code,
      serial_number: row.serial_number,
      reason: row.reason ?? '',
    });
    const rows = [
      ...plan.apply.map((row) => view(row, apply ? 'IN_STOCK' : 'SE_DUA_VAO_KHO')),
      ...plan.skipped.map((row) => view(row, 'BO_QUA')),
    ];
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ applied: apply, serials: rows, negativeAvailable: negative }, null, 2)}\n`);
    } else {
      if (rows.length) printTable(['action', 'warehouse_code', 'material_code', 'serial_number', 'reason'], rows);
      if (negative?.length) {
        process.stdout.write('\nDòng tồn có available âm:\n');
        printTable(['warehouse_code', 'material_code', 'quantity', 'quantity_reserved', 'quantity_blocked', 'available'], negative);
      }
    }
    console.error(
      `${maskUrl(databaseUrl)}: ${candidates.length} serial stock_state NULL có kho; ` +
        `${apply ? 'đã đưa' : 'sẽ đưa'} ${plan.apply.length} vào Trong kho, bỏ qua ${plan.skipped.length} vì vượt tồn` +
        (negative ? `; ${negative.length} dòng tồn available âm` : '') +
        (apply ? '.' : ' (xem trước, chưa ghi; thêm --apply để ghi).'),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
