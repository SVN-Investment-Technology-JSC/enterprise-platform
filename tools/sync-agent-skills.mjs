#!/usr/bin/env node
// Skill cho trợ lý AI chỉ viết ở .agents/skills (Codex và các công cụ đọc chuẩn Agent Skills). Claude Code đọc
// .claude/skills nên giữ ở đó một bản sao y hệt, sinh bằng script này; đừng sửa tay bản sao.
// Chạy: node tools/sync-agent-skills.mjs           chép .agents/skills sang .claude/skills
//       node tools/sync-agent-skills.mjs --check   báo lỗi khi hai nơi khác nhau (CI chạy ở job "Detect CI scope")
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SOURCE = '.agents/skills';
const MIRROR = '.claude/skills';

function listFiles(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true })
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((entry) => statSync(join(abs, entry)).isFile())
    .sort();
}

/** So nội dung, bỏ qua khác biệt CRLF/LF do core.autocrlf trên Windows. */
function content(path) {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
}

if (!process.argv.includes('--check')) {
  rmSync(join(root, MIRROR), { recursive: true, force: true });
  cpSync(join(root, SOURCE), join(root, MIRROR), { recursive: true });
  console.log(`Đã chép ${listFiles(SOURCE).length} file từ ${SOURCE} sang ${MIRROR}.`);
  process.exit(0);
}

const source = listFiles(SOURCE);
const mirror = new Set(listFiles(MIRROR));
const problems = [];
for (const file of source) {
  if (!mirror.has(file)) problems.push(`${MIRROR}/${file}: thiếu`);
  else if (content(`${SOURCE}/${file}`) !== content(`${MIRROR}/${file}`))
    problems.push(`${MIRROR}/${file}: khác ${SOURCE}/${file}`);
  mirror.delete(file);
}
for (const file of mirror) problems.push(`${MIRROR}/${file}: không có trong ${SOURCE}`);

if (problems.length) {
  console.error(`${MIRROR} không khớp ${SOURCE}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nSửa skill ở ${SOURCE} rồi chạy: node tools/sync-agent-skills.mjs`);
  process.exit(1);
}
console.log(`OK: ${MIRROR} khớp ${SOURCE} (${source.length} file).`);
