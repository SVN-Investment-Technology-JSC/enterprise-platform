#!/usr/bin/env node
// Migration đã merge vào dev/release thì coi như đã chạy trên DB của khách. Migrator lưu checksum từng file và dừng cả
// lượt khi file đổi (apps/migrator/src/main.ts), như sự cố PR #60 → #65. Script này chặn sửa, xoá, đổi tên file .sql đã
// có ở nhánh gốc, và kiểm file mới: không BOM, tên dạng NNNN-ten-file.sql, đã đăng ký cho migrator.
// Chạy: node tools/check-migrations.mjs   (so với điểm rẽ nhánh từ origin/dev/release, gồm cả thay đổi chưa commit)
// CI truyền MIGRATIONS_BASE = commit gốc của PR, ở job "Detect CI scope".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const DIR = 'migrations';
/** Nơi đăng ký migration: module tenant, danh sách cố ý chưa đăng ký, và platform (gọi thẳng trong migrator). */
const REGISTRIES = [
  'packages/platform/entitlement/src/lib/tenant-migrations.ts',
  'packages/platform/entitlement/src/lib/tenant-migrations.spec.ts',
  'apps/migrator/src/main.ts',
];
const NAME = /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.sql$/;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** Cùng cách chuẩn hoá với migrator trước khi tính checksum. */
function normalize(sql) {
  return sql.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function listSql(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .map((entry) => `${dir}/${String(entry).replaceAll('\\', '/')}`)
    .filter((path) => path.endsWith('.sql'))
    .sort();
}

let base = process.env.MIGRATIONS_BASE;
if (!base) {
  try {
    base = git('merge-base', 'HEAD', 'origin/dev/release').trim();
  } catch {
    console.error('Không tìm thấy origin/dev/release. Chạy `git fetch origin dev/release` rồi thử lại.');
    process.exit(2);
  }
}

const baseFiles = new Set(
  git('ls-tree', '-r', '--name-only', '-z', base, '--', DIR)
    .split('\0')
    .filter((path) => path.endsWith('.sql')),
);
const files = listSql(DIR);
const changed = git('diff', '--name-only', '--no-renames', '-z', base, '--', DIR)
  .split('\0')
  .filter((path) => baseFiles.has(path));

const problems = [];
for (const path of changed) {
  if (!existsSync(join(root, path))) {
    problems.push(`${path}: đã xoá hoặc đổi tên. Migration đã merge phải giữ nguyên tên và nội dung.`);
    continue;
  }
  const before = normalize(git('cat-file', 'blob', `${base}:${path}`));
  const after = normalize(readFileSync(join(root, path), 'utf8'));
  if (before !== after)
    problems.push(
      `${path}: đã bị sửa. Migration đã merge thì không sửa; tạo file mới với số kế tiếp để thay đổi tiếp.`,
    );
}

const registries = REGISTRIES.map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
const added = files.filter((path) => !baseFiles.has(path));
for (const path of files) {
  if (readFileSync(join(root, path)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    problems.push(`${path}: có BOM. Lưu UTF-8 không BOM; worker tạo tenant không bỏ BOM nên checksum sẽ lệch.`);
}
for (const path of added) {
  const name = path.split('/').pop();
  if (!NAME.test(name))
    problems.push(`${path}: tên phải có dạng NNNN-ten-thay-doi.sql (4 chữ số, chữ thường, gạch ngang).`);
  const relative = path.slice(DIR.length + 1);
  if (!registries.includes(`'${relative}'`))
    problems.push(
      `${path}: chưa đăng ký. Thêm '${relative}' vào tenant-migrations.ts (module tenant) hoặc apps/migrator/src/main.ts ` +
        '(platform); cố ý chưa chạy thì ghi vào DELIBERATELY_UNREGISTERED kèm lý do.',
    );
}

if (problems.length) {
  console.error(`Migration không hợp lệ (so với ${base.slice(0, 10)}):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nXem .agents/skills/erp-migrations/SKILL.md.');
  process.exit(1);
}
console.log(`OK: ${files.length} migration, ${added.length} file mới, không file cũ nào bị sửa (so với ${base.slice(0, 10)}).`);
