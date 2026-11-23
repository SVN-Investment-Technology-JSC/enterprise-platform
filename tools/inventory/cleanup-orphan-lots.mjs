#!/usr/bin/env node
// Dọn lô rác do lưu nháp chứng từ kho tạo ra trước ISS-BE-066 cho MỘT DB tenant. Bản cũ tạo lô (và điền hạn dùng, ngày
// sản xuất còn thiếu vào lô có sẵn) ngay lúc lưu nháp; huỷ, từ chối hay sửa nháp đổi lô không dọn. Từ migration
// inventory/0026-draft-line-lot lô chỉ tạo lúc ghi sổ.
//
//   node tools/inventory/cleanup-orphan-lots.mjs --tenant=svn                 # liệt kê (mặc định, READ ONLY)
//   node tools/inventory/cleanup-orphan-lots.mjs --tenant=svn --apply         # xoá lô rác
//   node tools/inventory/cleanup-orphan-lots.mjs --database-url=postgres://... --json
//
// Lô rác: không bảng nào khác tham chiếu (lot_balances, lot_quality_events, mọi khoá ngoại khác tới lots) và mọi dòng
// chứng từ trỏ tới lô đều là dòng nhập của chứng từ Đã huỷ hoặc Bị từ chối (kể cả lô không còn dòng nào, do sửa nháp
// đổi lô). `--apply` trong một transaction: chép thông tin lô vào `lot_draft` của dòng (nếu trống) để chứng từ bị từ
// chối sửa lại vẫn còn số lô, đặt `lot_id` NULL rồi xoá lô. Danh sách riêng "lô có sẵn có thể bị nháp điền ngày" chỉ để
// thủ kho xem lại, script không sửa. Bảng ra stdout, tóm tắt ra stderr, mật khẩu trong URL che ***. Mã thoát 0 khi
// chạy được, 1 khi lỗi tham số hoặc kết nối. Hướng dẫn: tools/inventory/README.md.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');
const TOOL = 'cleanup-orphan-lots';

// Mọi khoá ngoại khác (ngoài dòng chứng từ) trỏ tới inventory_schema.lots: lot_balances, lot_quality_events và bảng
// thêm sau này. Lô còn được bảng nào tham chiếu thì không phải lô rác.
const REFERENCES_QUERY = `
  SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND k.confrelid = 'inventory_schema.lots'::regclass
     AND array_length(k.conkey, 1) = 1
     AND NOT (n.nspname = 'inventory_schema' AND c.relname = 'stock_document_lines')
   ORDER BY 1, 2, 3`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function junkQuery(references) {
  const notReferenced = references
    .map(
      (ref) =>
        `AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(ref.schema_name)}.${quoteIdent(ref.table_name)} r
                          WHERE r.${quoteIdent(ref.column_name)} = lot.id)`,
    )
    .join('\n       ');
  return `
  SELECT lot.id, lot.lot_no, m.code AS material_code, lot.expires_on::text AS expires_on,
         lot.created_at,
         COALESCE(string_agg(d.code || ':' || d.status, ', ' ORDER BY d.code), '') AS documents
    FROM inventory_schema.lots lot
    JOIN inventory_schema.materials m ON m.id = lot.material_id
    LEFT JOIN inventory_schema.stock_document_lines l ON l.lot_id = lot.id
    LEFT JOIN inventory_schema.stock_documents d ON d.id = l.document_id
   WHERE NOT EXISTS (
           SELECT 1 FROM inventory_schema.stock_document_lines l2
             JOIN inventory_schema.stock_documents d2 ON d2.id = l2.document_id
            WHERE l2.lot_id = lot.id
              AND (d2.status NOT IN ('CANCELLED', 'REJECTED') OR l2.direction <> 'IN'))
       ${notReferenced}
   GROUP BY lot.id, m.code
   ORDER BY m.code, lot.lot_no`;
}

// Lô còn dùng (không phải lô rác) đã có hạn dùng hoặc ngày sản xuất, được sửa sau khi tạo, và có dòng chứng từ chưa ghi
// sổ trỏ tới: bản cũ có thể đã điền ngày từ nháp. Chỉ để xem lại.
const FILLED_QUERY = `
  SELECT lot.id, lot.lot_no, m.code AS material_code, lot.manufactured_on::text AS manufactured_on,
         lot.expires_on::text AS expires_on, lot.created_at, lot.updated_at,
         string_agg(DISTINCT d.code || ':' || d.status, ', ') AS documents
    FROM inventory_schema.lots lot
    JOIN inventory_schema.materials m ON m.id = lot.material_id
    JOIN inventory_schema.stock_document_lines l ON l.lot_id = lot.id AND l.direction = 'IN'
    JOIN inventory_schema.stock_documents d ON d.id = l.document_id AND d.status <> 'POSTED'
   WHERE (lot.expires_on IS NOT NULL OR lot.manufactured_on IS NOT NULL)
     AND lot.updated_at > lot.created_at
     AND NOT (lot.id = ANY($1::uuid[]))
   GROUP BY lot.id, m.code
   ORDER BY m.code, lot.lot_no`;

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Cách dùng: node tools/inventory/cleanup-orphan-lots.mjs (--tenant=<tên DB> | --database-url=<URL DB tenant>)\n' +
      '           [--apply] [--json]\n' +
      '  mặc định   liệt kê, transaction READ ONLY, không ghi gì.\n' +
      '  --apply    đặt lot_id NULL ở dòng chứng từ huỷ, từ chối rồi xoá lô rác, trong một transaction.\n' +
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
        WHERE table_schema = 'inventory_schema' AND table_name = 'stock_document_lines' AND column_name = 'lot_draft'`,
    );
    if (!column.rows[0]) throw new Error('DB này chưa chạy migration inventory/0026-draft-line-lot (thiếu cột lot_draft).');

    if (apply) {
      // Chặn ghi sổ, lưu nháp cùng lúc tạo hay gắn lô (khoá ngoại cần ROW SHARE) trong lúc tính và xoá; vẫn đọc được.
      await client.query(`LOCK TABLE inventory_schema.lots IN EXCLUSIVE MODE`);
    }
    const references = (await client.query(REFERENCES_QUERY)).rows;
    const junk = (await client.query(junkQuery(references))).rows;
    const junkIds = junk.map((row) => row.id);
    const filled = (await client.query(FILLED_QUERY, [junkIds])).rows;

    let cleared = 0;
    if (apply && junkIds.length) {
      const updated = await client.query(
        `UPDATE inventory_schema.stock_document_lines l
            SET lot_draft = COALESCE(l.lot_draft, jsonb_strip_nulls(jsonb_build_object(
                  'lotNo', lot.lot_no,
                  'manufacturedOn', lot.manufactured_on::text,
                  'expiresOn', lot.expires_on::text,
                  'supplier', lot.supplier,
                  'certificateNo', lot.certificate_no,
                  'newLotQuality', NULLIF(lot.quality_status, 'PASSED')))),
                lot_id = NULL
           FROM inventory_schema.lots lot
          WHERE lot.id = l.lot_id AND l.lot_id = ANY($1::uuid[])`,
        [junkIds],
      );
      cleared = updated.rowCount ?? 0;
      await client.query(`DELETE FROM inventory_schema.lots WHERE id = ANY($1::uuid[])`, [junkIds]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');

    const junkView = junk.map((row) => ({
      action: apply ? 'DA_XOA' : 'SE_XOA',
      material_code: row.material_code,
      lot_no: row.lot_no,
      expires_on: row.expires_on ?? '',
      documents: row.documents,
    }));
    const filledView = filled.map((row) => ({
      material_code: row.material_code,
      lot_no: row.lot_no,
      manufactured_on: row.manufactured_on ?? '',
      expires_on: row.expires_on ?? '',
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      documents: row.documents,
    }));
    if (values.json) {
      process.stdout.write(
        `${JSON.stringify({ applied: apply, orphanLots: junkView, clearedLines: cleared, possiblyFilledLots: filledView }, null, 2)}\n`,
      );
    } else {
      if (junkView.length) printTable(['action', 'material_code', 'lot_no', 'expires_on', 'documents'], junkView);
      if (filledView.length) {
        process.stdout.write('\nLô có sẵn có thể bị nháp điền ngày (chỉ để xem lại, không sửa):\n');
        printTable(['material_code', 'lot_no', 'manufactured_on', 'expires_on', 'updated_at', 'documents'], filledView);
      }
    }
    console.error(
      `${maskUrl(databaseUrl)}: ${junk.length} lô rác; ` +
        (apply ? `đã xoá ${junk.length} lô, bỏ lot_id ở ${cleared} dòng chứng từ; ` : '') +
        `${filled.length} lô có sẵn có thể bị nháp điền ngày` +
        (apply ? '.' : ' (liệt kê, chưa ghi; thêm --apply để xoá lô rác).'),
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
