import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * Mọi file .sql dưới các thư mục migration, quét bằng thư mục chứ không liệt kê
 * tay từng đường dẫn.
 *
 * Liệt kê tay hỏng âm thầm: migration mới thêm sẽ nằm ngoài vòng kiểm mà không
 * ai biết — đúng thứ mà spec ranh giới sinh ra để ngăn.
 */
function readMigrations(): { sql: string; files: string[]; executable: string } {
  const root = workspaceRoot();
  const files: string[] = [];
  for (const directory of MIGRATION_DIRECTORIES) {
    const absolute = resolve(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute).sort()) {
      if (entry.endsWith('.sql')) files.push(join(absolute, entry));
    }
  }
  const sql = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  return { sql, files, executable: stripComments(sql) };
}

/**
 * Bỏ comment trước khi soát ranh giới.
 *
 * Comment thường nhắc tên schema của module khác một cách chính đáng — ví dụ
 * “moved to inventory_schema” hay “never reads procedure_schema”. Soát cả comment
 * thì spec báo động giả, và spec báo động giả sẽ bị người ta tắt đi.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function readDependencies(path: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(resolve(workspaceRoot(), path), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return parsed.dependencies ?? {};
}

const MIGRATION_DIRECTORIES = ['migrations/tenant/maintenance'];
/** Catalog của Postgres, không phải schema nghiệp vụ — truy vấn nó là hợp lệ. */
const SYSTEM_SCHEMAS = ['information_schema', 'pg_catalog', 'pg_temp'];

const OWNED_SCHEMAS = new Set(['maintenance_schema', 'integration_schema']);
const CORE_SCHEMAS = [
  'identity_schema',
  'tenancy_schema',
  'authorization_schema',
  'organization_schema',
  'subscription_schema',
  'module_registry_schema',
  'audit_schema',
];

describe('Maintenance architecture boundary', () => {
  it('tìm thấy migration để kiểm', () => {
    expect(readMigrations().files.length).toBeGreaterThan(0);
  });

  it('migration chỉ chạm schema module sở hữu', () => {
    const { executable, files } = readMigrations();
    const used = [...executable.matchAll(/\b([a-z][a-z0-9_]*_schema)\./g)].map(
      (match) => match[1],
    );
    const trespassing = [...new Set(used)].filter(
      (schema) => !OWNED_SCHEMAS.has(schema) && !SYSTEM_SCHEMAS.includes(schema),
    );
    // Kèm số file đã quét để một lần quét hụt cũng lộ ra, không lặng lẽ xanh.
    expect({ trespassing, checked: files.length }).toEqual({
      trespassing: [],
      checked: files.length,
    });
  });

  it('không chạm schema của Core', () => {
    const { executable } = readMigrations();
    for (const core of CORE_SCHEMAS) {
      expect(executable).not.toMatch(new RegExp(`\\b${core}\\b`));
    }
  });

  it('Platform API và Portal không phụ thuộc package của module', () => {
    expect(readDependencies('apps/api/package.json')).not.toHaveProperty('@enterprise-platform/module-maintenance');
    expect(readDependencies('apps/web/package.json')).not.toHaveProperty('@enterprise-platform/feature-maintenance');
  });

  it('module không phụ thuộc package của Core hay của module khác', () => {
    const forbidden = Object.keys(readDependencies('packages/modules/maintenance/package.json')).filter(
      (name) =>
        name.startsWith('@enterprise-platform/platform-') ||
        (name.startsWith('@enterprise-platform/module-') && name !== '@enterprise-platform/module-maintenance'),
    );
    expect(forbidden).toEqual([]);
  });
});
