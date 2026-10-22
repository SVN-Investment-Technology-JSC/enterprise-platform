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

/** Mọi file .sql của phân hệ, quét theo thư mục để migration mới thêm không lọt khỏi vòng kiểm. */
function readMigrations(): { executable: string; files: string[] } {
  const directory = resolve(workspaceRoot(), 'migrations/tenant/social');
  const files = existsSync(directory)
    ? readdirSync(directory)
        .sort()
        .filter((entry) => entry.endsWith('.sql'))
        .map((entry) => join(directory, entry))
    : [];
  const sql = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  // Comment được phép nhắc tên schema khác; chỉ soát phần câu lệnh.
  return { executable: sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' '), files };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const OWNED_SCHEMAS = new Set(['social_schema', 'integration_schema']);
const SYSTEM_SCHEMAS = ['information_schema', 'pg_catalog', 'pg_temp'];
const CORE_SCHEMAS = [
  'identity_schema',
  'tenancy_schema',
  'authorization_schema',
  'organization_schema',
  'subscription_schema',
  'module_registry_schema',
  'audit_schema',
  'core_schema',
];

describe('Social architecture boundary', () => {
  it('tìm thấy migration để kiểm', () => {
    expect(readMigrations().files.length).toBeGreaterThan(0);
  });

  it('migration chỉ chạm schema của mình', () => {
    const { executable, files } = readMigrations();
    const used = [...executable.matchAll(/\b([a-z][a-z0-9_]*_schema)\./g)].map((match) => match[1]);
    const trespassing = [...new Set(used)].filter(
      (schema) => !OWNED_SCHEMAS.has(schema) && !SYSTEM_SCHEMAS.includes(schema),
    );
    expect({ trespassing, checked: files.length }).toEqual({ trespassing: [], checked: files.length });
  });

  it('migration không chạm schema của Core', () => {
    const { executable } = readMigrations();
    for (const core of CORE_SCHEMAS) expect(executable).not.toMatch(new RegExp(`\\b${core}\\b`));
  });

  it('code của module chỉ ghi vào social_schema và outbox, không đụng schema khác', () => {
    const root = resolve(workspaceRoot(), 'packages/modules/social/src/lib/infrastructure');
    const used = new Set<string>();
    for (const file of sourceFiles(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\b([a-z][a-z0-9_]*_schema)\./g)) used.add(match[1]);
    }
    expect([...used].filter((schema) => !OWNED_SCHEMAS.has(schema))).toEqual([]);
  });

  it('domain và application không import infrastructure hay presentation; domain không import application', () => {
    const base = resolve(workspaceRoot(), 'packages/modules/social/src/lib');
    const importsOf = (file: string) =>
      [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    for (const file of sourceFiles(join(base, 'domain'))) {
      expect({ file, bad: importsOf(file).filter((path) => /\.\.\/(application|infrastructure|presentation)\//.test(path)) }).toEqual({
        file,
        bad: [],
      });
    }
    for (const file of sourceFiles(join(base, 'application'))) {
      expect({ file, bad: importsOf(file).filter((path) => /\.\.\/(infrastructure|presentation)\//.test(path)) }).toEqual({
        file,
        bad: [],
      });
    }
  });

  it('module không phụ thuộc package của Core hay của module khác', () => {
    const parsed = JSON.parse(
      readFileSync(resolve(workspaceRoot(), 'packages/modules/social/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const forbidden = Object.keys(parsed.dependencies ?? {}).filter(
      (name) =>
        name.startsWith('@enterprise-platform/platform-') ||
        (name.startsWith('@enterprise-platform/module-') && name !== '@enterprise-platform/module-social'),
    );
    expect(forbidden).toEqual([]);
  });
});
