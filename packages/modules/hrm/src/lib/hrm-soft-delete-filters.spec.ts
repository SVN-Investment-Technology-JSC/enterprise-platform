import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Mã loại nghỉ và mã ca chỉ duy nhất trong các dòng chưa xoá mềm (chỉ mục duy nhất một phần), nên cùng một mã có thể
 * ứng với một dòng đã xoá và một dòng đang dùng. Truy vấn tra theo MÃ mà không lọc `deleted_at` sẽ lấy nhầm dòng.
 * Tra theo id (đơn cũ, bảng công cũ) thì không thuộc phạm vi này.
 */
const GUARDED_TABLES = ['hrm_schema.leave_types', 'hrm_schema.shift_definitions'];
const BY_CODE = /(\bcode\s*=\s*(\$\d+|ANY\b|lower\()|\b(upper|lower)\(\s*(\w+\.)?code\s*\)\s*=|\w+\.code\s*=\s*\$\d+)/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

/** Các chuỗi truy vấn (template hoặc chuỗi bắt đầu bằng SELECT/UPDATE/DELETE) trong một file. */
function queries(text: string): { sql: string; line: number }[] {
  const found: { sql: string; line: number }[] = [];
  for (const m of text.matchAll(/`([^`]*)`|'((?:SELECT|UPDATE|DELETE)[^']*)'/g)) {
    const sql = m[1] ?? m[2] ?? '';
    if (/\b(SELECT|UPDATE|DELETE)\b/i.test(sql)) found.push({ sql, line: text.slice(0, m.index).split('\n').length });
  }
  return found;
}

describe('xoá mềm: truy vấn tra theo mã phải lọc dòng đã xoá', () => {
  const root = __dirname;
  const offenders: string[] = [];
  const scanned: string[] = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const { sql, line } of queries(text)) {
      if (!GUARDED_TABLES.some((t) => sql.includes(t))) continue;
      scanned.push(`${relative(root, file)}:${line}`);
      if (!BY_CODE.test(sql)) continue;
      // `${live}` là điều kiện lọc ghép động (findApprovalReason).
      if (/deleted_at/.test(sql) || /\$\{live\}/.test(sql)) continue;
      offenders.push(`${relative(root, file)}:${line}: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }

  it('quét được các truy vấn vào bảng có xoá mềm (bảo đảm bộ quét không rỗng)', () => {
    expect(scanned.length).toBeGreaterThan(20);
  });

  it('không có truy vấn nào tra loại nghỉ hoặc ca theo mã mà thiếu lọc deleted_at', () => {
    expect(offenders).toEqual([]);
  });

  it('bộ quét nhận ra truy vấn thiếu lọc', () => {
    const bad = 'SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND code=$2';
    expect(BY_CODE.test(bad)).toBe(true);
    expect(/deleted_at/.test(bad)).toBe(false);
    expect(BY_CODE.test('SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2')).toBe(false);
  });
});
