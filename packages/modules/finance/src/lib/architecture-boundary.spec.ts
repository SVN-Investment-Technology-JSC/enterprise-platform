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

/** Bỏ comment trước khi soát: comment được nhắc tên schema khác một cách chính đáng. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function filesUnder(directory: string, extension: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, extension));
    else if (extension.test(entry)) out.push(path);
  }
  return out;
}

const readDependencies = (path: string): Record<string, string> =>
  (JSON.parse(readFileSync(resolve(workspaceRoot(), path), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {};

const OWNED_SCHEMAS = new Set(['finance_schema', 'integration_schema']);
/** Catalog của Postgres, không phải schema nghiệp vụ. */
const SYSTEM_SCHEMAS = ['information_schema', 'pg_catalog', 'pg_temp'];
const schemasUsedIn = (text: string) => [...new Set([...text.matchAll(/\b([a-z][a-z0-9_]*_schema)\./g)].map((m) => m[1]))];
const trespassers = (schemas: string[]) => schemas.filter((s) => !OWNED_SCHEMAS.has(s) && !SYSTEM_SCHEMAS.includes(s));

describe('Finance architecture boundary', () => {
  const root = workspaceRoot();

  it('migration chỉ chạm schema module sở hữu và không chạm Core hay module khác', () => {
    const directory = resolve(root, 'migrations/tenant/finance');
    const files = readdirSync(directory).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = stripComments(readFileSync(join(directory, file), 'utf8'));
      expect({ file, trespassing: trespassers(schemasUsedIn(sql)) }).toEqual({ file, trespassing: [] });
    }
  });

  it('mã nguồn module chỉ truy vấn finance_schema, không đọc bảng của Core, HRM hay module khác', () => {
    const sources = filesUnder(resolve(root, 'packages/modules/finance/src'), /\.ts$/).filter((f) => !/\.spec\.ts$/.test(f));
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect({ file: file.replace(root, ''), trespassing: trespassers(schemasUsedIn(code)) }).toEqual({
        file: file.replace(root, ''),
        trespassing: [],
      });
    }
  });

  it('không khai báo định danh trùng tên toàn cục của CommonJS (require, module, exports)', () => {
    // Webpack gói module thành một file CJS: hàm tên `require` đè lên lệnh nạp thư viện và làm dịch vụ sập lúc khởi động
    // (jest không bắt được vì có môi trường module riêng).
    const sources = filesUnder(resolve(root, 'packages/modules/finance/src'), /\.ts$/).filter((f) => !/\.spec\.ts$/.test(f));
    const offenders = sources.filter((file) => /(?:function|const|let|var|class)\s+(?:require|module|exports)/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('Platform API và Portal không phụ thuộc package của module', () => {
    expect(readDependencies('apps/api/package.json')).not.toHaveProperty('@enterprise-platform/module-finance');
    expect(readDependencies('apps/web/package.json')).not.toHaveProperty('@enterprise-platform/feature-finance');
  });

  it('module không phụ thuộc package của Core hay của module khác', () => {
    const forbidden = Object.keys(readDependencies('packages/modules/finance/package.json')).filter(
      (name) =>
        name.startsWith('@enterprise-platform/platform-') ||
        (name.startsWith('@enterprise-platform/module-') && name !== '@enterprise-platform/module-finance'),
    );
    expect(forbidden).toEqual([]);
  });

  it('các module khác không phụ thuộc vào Tài chính', () => {
    for (const path of ['apps/hrm-api/package.json', 'apps/inventory-api/package.json', 'apps/maintenance-api/package.json', 'apps/workspace-api/package.json', 'apps/procedure-api/package.json']) {
      const deps = Object.keys(readDependencies(path)).filter((name) => name.includes('finance'));
      expect({ path, deps }).toEqual({ path, deps: [] });
    }
  });
});
