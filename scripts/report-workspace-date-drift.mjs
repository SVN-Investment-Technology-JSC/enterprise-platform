#!/usr/bin/env node
/**
 * CHỈ ĐỌC. Liệt kê dự án và công việc Workspace có ngày CÓ THỂ đã trôi do lỗi
 * múi giờ cũ (ngày lùi 1 ngày mỗi lần bấm Sửa). In CSV ra stdout.
 *
 * Dùng:
 *   node scripts/report-workspace-date-drift.mjs "postgresql://tenant:tenant@localhost:55436/testrun2" > drift.csv
 *   TENANT_DATABASE_URL=... node scripts/report-workspace-date-drift.mjs
 *
 * Không có cách nào suy ra ngày gốc, nên script chỉ ĐÁNH DẤU những dòng đã từng
 * được sửa sau lúc tạo (updated_at > created_at + 1 phút) và có cột ngày. Mọi
 * dòng đều ghi "nen ra tay". Không UPDATE/INSERT/DELETE: kết nối chạy trong
 * giao dịch READ ONLY.
 *
 * "so_lan_cap_nhat" lấy từ work_item_status_history (chỉ ghi đổi trạng thái,
 * nên là CẬN DƯỚI; sửa ngày không để lại dấu vết riêng). Dự án không có bảng
 * audit nên để trống. Sổ chi phí (cost_entries) không có cột ngày nhập tay nên
 * chỉ hiện số dòng sổ của việc để người rà biết việc đó có chi phí.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../packages/adapters/database/package.json'));
const { Client } = require('pg');

const connectionString = process.argv[2] ?? process.env.TENANT_DATABASE_URL;
if (!connectionString) {
  console.error('Thieu chuoi ket noi: truyen tham so thu nhat hoac dat TENANT_DATABASE_URL.');
  process.exit(2);
}

const MIN_EDIT_GAP = "interval '1 minute'";

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const dateText = (value) => {
  if (!value) return '';
  if (value instanceof Date) {
    // Cột DATE do pg dựng thành Date theo giờ máy; lấy lại đúng ngày lịch.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value);
};

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');

  const projects = await client.query(`
    SELECT code, name, status, start_date, end_date, created_at, updated_at
      FROM workspace_schema.projects
     WHERE (start_date IS NOT NULL OR end_date IS NOT NULL)
       AND updated_at > created_at + ${MIN_EDIT_GAP}
     ORDER BY code`);

  const items = await client.query(`
    SELECT p.code AS project_code, w.code, w.title, w.status,
           w.planned_start, w.planned_end, w.actual_start, w.actual_end,
           w.created_at, w.updated_at,
           (SELECT count(*) FROM workspace_schema.work_item_status_history h WHERE h.work_item_id = w.id) AS status_changes,
           (SELECT count(*) FROM workspace_schema.cost_entries c WHERE c.work_item_id = w.id) AS cost_entries,
           w.actual_cost
      FROM workspace_schema.work_items w
      JOIN workspace_schema.projects p ON p.id = w.project_id
     WHERE (w.planned_start IS NOT NULL OR w.planned_end IS NOT NULL
            OR w.actual_start IS NOT NULL OR w.actual_end IS NOT NULL)
       AND w.updated_at > w.created_at + ${MIN_EDIT_GAP}
     ORDER BY p.code, w.code`);

  await client.query('ROLLBACK');

  const header = [
    'loai', 'ma_du_an', 'ma', 'ten', 'trang_thai', 'ngay_hien_tai',
    'created_at', 'updated_at', 'so_lan_cap_nhat', 'so_dong_so_chi_phi', 'ghi_chu',
  ];
  const lines = [header.join(',')];
  for (const row of projects.rows) {
    lines.push([
      'du_an', row.code, row.code, row.name, row.status,
      `bat_dau=${dateText(row.start_date)}; ket_thuc=${dateText(row.end_date)}`,
      row.created_at, row.updated_at, '', '', 'nen ra tay',
    ].map(csvCell).join(','));
  }
  for (const row of items.rows) {
    lines.push([
      'viec', row.project_code, row.code, row.title, row.status,
      `ke_hoach=${dateText(row.planned_start)}..${dateText(row.planned_end)}; thuc_te=${dateText(row.actual_start)}..${dateText(row.actual_end)}`,
      row.created_at, row.updated_at, row.status_changes, row.cost_entries, 'nen ra tay',
    ].map(csvCell).join(','));
  }
  process.stdout.write(`﻿${lines.join('\r\n')}\r\n`);
  console.error(`Da xuat ${projects.rowCount} du an, ${items.rowCount} viec (chi doc).`);
} finally {
  await client.end();
}
