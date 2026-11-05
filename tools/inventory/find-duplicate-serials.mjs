#!/usr/bin/env node
// Liệt kê serial trùng trong cùng một mặt hàng của MỘT DB tenant, xuất CSV ra stdout (T1-12, TC-MIG-03).
// Chạy trước migration inventory/0013-serial-quality: migration đó dừng nếu còn trùng.
// Chỉ đọc: mở transaction READ ONLY, không ghi gì vào DB.
//
//   node tools/inventory/find-duplicate-serials.mjs --database-url=postgres://user:pass@host:5432/tenant_db > trung.csv
//   INVENTORY_DATABASE_URL=postgres://... node tools/inventory/find-duplicate-serials.mjs > trung.csv
//
// Hai serial coi là trùng khi cùng material_id và giống nhau sau khi bỏ khoảng trắng hai đầu, không phân biệt hoa
// thường — đúng biểu thức của unique index trong 0013. Tóm tắt in ra stderr; mã thoát 0 khi chạy được (kể cả có
// trùng), 1 khi lỗi tham số hoặc kết nối. Thêm --fail-on-duplicates để thoát 2 khi còn trùng (dùng trong CI hoặc
// script deploy). Hướng dẫn: tools/inventory/README.md.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const COLUMNS = [
  'group_no',
  'group_size',
  'material_id',
  'material_code',
  'material_name',
  'normalized_serial',
  'serial_id',
  'serial_number',
  'internal_code',
  'current_status',
  'location_type',
  'warehouse_code',
  'current_asset_id',
  'created_at',
];

const QUERY = `
  WITH duplicate_groups AS (
    SELECT material_id, upper(btrim(serial_number)) AS normalized_serial, count(*) AS group_size
      FROM inventory_schema.serial_tracking
     GROUP BY material_id, upper(btrim(serial_number))
    HAVING count(*) > 1
  )
  SELECT dense_rank() OVER (ORDER BY m.code, g.normalized_serial, g.material_id) AS group_no,
         g.group_size, g.material_id, m.code AS material_code, m.name AS material_name,
         g.normalized_serial, s.id AS serial_id, s.serial_number, s.internal_code,
         s.current_status, s.location_type, w.code AS warehouse_code, s.current_asset_id,
         s.created_at
    FROM duplicate_groups g
    JOIN inventory_schema.serial_tracking s
      ON s.material_id = g.material_id AND upper(btrim(s.serial_number)) = g.normalized_serial
    JOIN inventory_schema.materials m ON m.id = g.material_id
    LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
   ORDER BY m.code, g.normalized_serial, g.material_id, s.created_at, s.id`;

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Cách dùng: node tools/inventory/find-duplicate-serials.mjs --database-url=<URL DB tenant> [--fail-on-duplicates]\n' +
      'Hoặc đặt biến môi trường INVENTORY_DATABASE_URL.',
  );
  process.exit(1);
}

/** Một ô CSV theo RFC 4180: bọc nháy kép khi có dấu phẩy, nháy, xuống dòng hoặc khoảng trắng đầu cuối. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        'database-url': { type: 'string' },
        'fail-on-duplicates': { type: 'boolean', default: false },
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

  const client = new Client({ connectionString: databaseUrl, application_name: 'find-duplicate-serials' });
  await client.connect();
  let rows;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '120s'`);
    const table = await client.query(`SELECT to_regclass('inventory_schema.serial_tracking') AS name`);
    if (!table.rows[0]?.name) {
      throw new Error('DB này không có bảng inventory_schema.serial_tracking (tenant chưa bật phân hệ Kho?).');
    }
    ({ rows } = await client.query(QUERY));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  process.stdout.write(`${COLUMNS.join(',')}\n`);
  for (const row of rows) {
    process.stdout.write(`${COLUMNS.map((column) => csvCell(row[column])).join(',')}\n`);
  }
  const groups = new Set(rows.map((row) => String(row.group_no))).size;
  console.error(
    groups === 0
      ? 'Không có serial trùng. Chạy được migration inventory/0013-serial-quality.'
      : `Có ${groups} nhóm serial trùng (${rows.length} bản ghi). Xử lý hết rồi mới chạy migration inventory/0013-serial-quality.`,
  );
  if (groups > 0 && parsed.values['fail-on-duplicates']) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
