#!/usr/bin/env node
// T6-13: lùi ngày giao của các serial seed bảo hành (bước `warranty` của seed-svn.mjs) về đúng mốc ở
// docs/crm/TEST.md mục 1.3, để test hạn bảo hành theo thời gian (TC-WAR-01, 02, 03, 05).
//
//   node tools/crm/backdate-deliveries.mjs --tenant=svn [--dry-run]
//
// Ghi thẳng SQL vào DB tenant nên CHỈ chạy trên PostgreSQL local (localhost, 127.0.0.1). URL lấy từ
// TENANT_DATABASE_URL_TEMPLATE trong .env (`{databaseName}` thay bằng slug, `-` thành `_`).
//
// Cột được sửa: `crm_schema.delivery_plans.issued_at` của đợt giao chứa serial, thuộc đơn seed có ghi chú
// `seed-svn:warranty:<serial>`. Đây là cột duy nhất tra cứu bảo hành đọc làm ngày giao (postgres-warranty.store.ts,
// SERIAL_ITEMS `d.issued_at AS delivered_at`, rồi warranty-period.ts `computeWarranty`). Đường dự phòng đọc ngày xuất
// của Kho (`serial_movements.occurred_at`) chỉ chạy khi `issued_at` rỗng, nên không cần sửa; bảng Kho đó cũng bị
// trigger append-only chặn UPDATE. Chạy lại được: đặt lại theo hôm nay, đã đúng thì không đổi.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'packages/adapters/database/package.json'))('pg');

const CASES = [
  { serial: 'SN031', monthsAgo: 3 },
  { serial: 'SN032', monthsAgo: 11 },
  { serial: 'SN033', monthsAgo: 13 },
  { serial: 'SN034', monthsAgo: 8 },
  { serial: 'SN035', monthsAgo: 8 },
];

const VN_OFFSET_MS = 7 * 3600_000;
const vnToday = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);

function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** 9 giờ sáng giờ Việt Nam của ngày `date`, dạng ISO UTC. */
const vnMorning = (date) => new Date(Date.parse(`${date}T09:00:00Z`) - VN_OFFSET_MS).toISOString();

function databaseUrl(tenant) {
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
  if (!template) throw new Error('Thiếu TENANT_DATABASE_URL_TEMPLATE (trong .env).');
  const url = new URL(template.replace('{databaseName}', tenant.replace(/-/g, '_')));
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Từ chối: chỉ sửa PostgreSQL local (localhost, 127.0.0.1), không phải "${url.hostname}".`);
  }
  return url.toString();
}

async function main() {
  const { values } = parseArgs({
    options: { tenant: { type: 'string', default: 'svn' }, 'dry-run': { type: 'boolean', default: false } },
  });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.tenant)) throw new Error(`Tenant slug không hợp lệ: ${values.tenant}`);
  const client = new Client({ connectionString: databaseUrl(values.tenant) });
  await client.connect();
  const today = vnToday();
  let changed = 0;
  let missing = 0;
  try {
    await client.query('BEGIN');
    for (const item of CASES) {
      const deliveredOn = addMonths(today, -item.monthsAgo);
      const target = vnMorning(deliveredOn);
      const { rows } = await client.query(
        `SELECT d.id, d.code, o.code AS order_code, d.issued_at
           FROM crm_schema.delivery_plans d
           JOIN crm_schema.sales_orders o ON o.id = d.order_id
           JOIN crm_schema.delivery_lines dl ON dl.delivery_id = d.id
          WHERE o.note = $1 AND d.status = 'ISSUED' AND $2 = ANY (dl.serials)`,
        [`seed-svn:warranty:${item.serial}`, item.serial],
      );
      if (!rows.length) {
        missing += 1;
        console.warn(` ! ${item.serial}: không thấy đợt giao đã xuất của đơn seed. Chạy seed-svn.mjs --step=warranty trước.`);
        continue;
      }
      for (const row of rows) {
        const current = row.issued_at ? new Date(row.issued_at).toISOString() : null;
        if (current === target) {
          console.log(` = ${item.serial}: đơn ${row.order_code}, đợt ${row.code} đã giao ${deliveredOn}.`);
          continue;
        }
        if (!values['dry-run']) {
          await client.query('UPDATE crm_schema.delivery_plans SET issued_at = $2, updated_at = now() WHERE id = $1', [
            row.id,
            target,
          ]);
        }
        changed += 1;
        console.log(` + ${item.serial}: đơn ${row.order_code}, đợt ${row.code}: ${current ?? '(trống)'} -> ${target} (${deliveredOn}, ${item.monthsAgo} tháng trước).`);
      }
    }
    await client.query(values['dry-run'] ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  console.log(`\n${values['dry-run'] ? 'Thử (không ghi)' : 'Xong'}: ${changed} đợt giao đổi ngày, ${missing} serial không thấy.`);
  if (missing) process.exit(1);
}

main().catch((error) => {
  console.error(`LỖI: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
