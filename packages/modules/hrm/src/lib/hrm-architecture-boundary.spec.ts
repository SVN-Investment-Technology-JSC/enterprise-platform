import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function workspaceRoot(): string {
  let candidate = process.cwd();
  while (!existsSync(join(candidate, 'nx.json'))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('Nx workspace root not found.');
    candidate = parent;
  }
  return candidate;
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules') continue;
      files.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

/** Comment thường nhắc tên schema khác một cách chính đáng; chỉ soát mã chạy. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'procedure_schema.*', pattern: /procedure_schema\s*\./i },
  { name: "FROM/JOIN procedure_*", pattern: /\b(?:from|join)\s+procedure_/i },
  { name: "to_regclass('procedure_schema…')", pattern: /to_regclass\(\s*'procedure_schema/i },
];

describe('ranh giới module: HRM và worker không đọc DB của Procedure Engine', () => {
  const root = workspaceRoot();
  const roots = [
    resolve(root, 'packages/modules/hrm/src'),
    resolve(root, 'apps/worker/src'),
  ];

  it.each(FORBIDDEN)('mã nguồn không chứa $name (chỉ qua API nội bộ của Procedure)', ({ pattern }) => {
    const offenders: string[] = [];
    for (const directory of roots) {
      for (const file of sourceFiles(directory)) {
        if (pattern.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('có quét được mã nguồn HRM (tránh spec rỗng vô nghĩa)', () => {
    expect(sourceFiles(roots[0]).length).toBeGreaterThan(20);
    expect(sourceFiles(roots[1]).length).toBeGreaterThan(0);
  });
});
