#!/usr/bin/env node
// Hai luật giao diện trong AGENTS.md: không dùng thẻ <select> gốc (dùng SearchableSelect của shared-ui) và không dùng
// emoji trong chữ hiển thị (dùng icon Lucide hoặc chữ). Quét mọi file .ts/.tsx được git theo dõi trong apps và packages,
// kể cả project chưa có cấu hình ESLint. Bỏ qua chú thích và file test.
// Chạy: node tools/check-ui-rules.mjs   (CI chạy ở job "Validate affected projects", sau khi cài dependency)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');

/**
 * Vi phạm có từ trước khi có kiểm tra này. Chỉ được giảm: sửa chỗ nào thì hạ số hoặc xoá dòng tương ứng,
 * không thêm file mới vào đây.
 */
const BASELINE = {
  'apps/web/src/app/(tenant)/applications/enterprise-applications.tsx': { select: 1 },
  'apps/web/src/app/(tenant)/organization/organization-assignment-table.tsx': { select: 2 },
  'apps/web/src/app/(tenant)/organization/organization-workspace.tsx': { emoji: 2 },
  'apps/web/src/app/platform/data-import/data-import-workspace.tsx': { select: 1 },
  'apps/web/src/app/platform/tenant-management.tsx': { select: 1 },
  'packages/features/inventory/src/lib/components/asset-detail.tsx': { select: 2 },
  'packages/features/inventory/src/lib/components/asset-list-modal.tsx': { select: 4 },
  'packages/features/inventory/src/lib/components/batch-requisition-modal.tsx': { select: 2 },
  'packages/features/inventory/src/lib/components/inventory-dashboard.tsx': { select: 1 },
  'packages/features/inventory/src/lib/components/serial-panel.tsx': { select: 2 },
  'packages/features/inventory/src/lib/components/stock-table.tsx': { select: 1 },
  'packages/features/inventory/src/lib/components/transaction-hub.tsx': { select: 3 },
  'packages/features/maintenance/src/lib/components/frequency-catalog-editor.tsx': { select: 4 },
  'packages/features/maintenance/src/lib/components/maintenance-history.tsx': { select: 3 },
  'packages/features/maintenance/src/lib/components/maintenance-matrix.tsx': { select: 5 },
  'packages/features/maintenance/src/lib/components/maintenance-schedules.tsx': { select: 3 },
  'packages/features/maintenance/src/lib/maintenance-screen.tsx': { select: 2 },
  'packages/features/procedure-engine/src/lib/components/material-request-panel.tsx': { select: 3 },
  'packages/features/procedure-engine/src/lib/components/organization-board.tsx': { select: 4 },
  'packages/features/procedure-engine/src/lib/components/rcsi-board.tsx': { select: 3 },
  'packages/features/procedure-engine/src/lib/components/subtask-panel.tsx': { emoji: 1, select: 6 },
  'packages/features/procedure-engine/src/lib/procedure-dashboard.cards.tsx': { select: 1 },
};

const RULES = {
  select: 'thẻ <select> gốc; dùng SearchableSelect của @enterprise-platform/shared-ui',
  emoji: 'emoji trong chữ hiển thị; dùng icon Lucide hoặc chữ',
};
const SELECT = /<select[\s>/]/;
const EMOJI = /\p{Emoji_Presentation}|️/u;
const TEST_FILE = /(\.(spec|test)\.tsx?$)|(-e2e\/)/;

const files = execFileSync('git', ['ls-files', '-z', '--', 'apps/*.ts', 'apps/*.tsx', 'packages/*.ts', 'packages/*.tsx'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 1 << 28,
})
  .split('\0')
  .filter((file) => file && !file.endsWith('.d.ts') && !TEST_FILE.test(file));

function isText(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  );
}

/** Vị trí vi phạm theo luật, chỉ tính trong mã (thẻ JSX, chuỗi, chữ trong JSX), không tính chú thích. */
function findHits(file, text) {
  const tsx = file.endsWith('.tsx');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = { select: [], emoji: [] };
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'select'
    )
      hits.select.push(line(node));
    if (isText(node) && EMOJI.test(node.text)) hits.emoji.push(line(node));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const problems = [];
for (const file of files) {
  const text = readFileSync(resolve(root, file), 'utf8');
  if (!BASELINE[file] && !SELECT.test(text) && !EMOJI.test(text)) continue;
  const hits = findHits(file, text);
  for (const rule of Object.keys(RULES)) {
    const allowed = BASELINE[file]?.[rule] ?? 0;
    const found = hits[rule].length;
    if (found > allowed)
      problems.push(`${file}:${hits[rule].join(',')}  ${RULES[rule]}${allowed ? ` (tồn đọng cho phép ${allowed}, đang có ${found})` : ''}`);
    else if (found < allowed)
      problems.push(
        `${file}  đã sửa bớt ${RULES[rule].split(';')[0]}: trong BASELINE (tools/check-ui-rules.mjs) ` +
          (found ? `hạ ${rule} xuống ${found}.` : `xoá ${rule} của file này.`),
      );
  }
}
for (const [file, counts] of Object.entries(BASELINE)) {
  if (!files.includes(file))
    problems.push(`${file}  không còn trong repo: xoá dòng này khỏi BASELINE (tools/check-ui-rules.mjs, ${Object.keys(counts).join(', ')}).`);
}

if (problems.length) {
  console.error('Vi phạm luật giao diện (AGENTS.md):\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`OK: ${files.length} file .ts/.tsx không có thẻ <select> gốc hay emoji mới.`);
