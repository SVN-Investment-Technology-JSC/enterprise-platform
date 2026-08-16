import { existsSync, readFileSync } from 'node:fs';
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

describe('Procedure Engine architecture boundary', () => {
  const root = workspaceRoot();

  it('keeps Procedure migrations inside owned schemas', () => {
    const paths = [
      'migrations/tenant/procedure/0001-procedure.sql',
      'packages/modules/procedure-engine/src/lib/infrastructure/persistence/migrations/0000-integration.sql',
      'packages/modules/procedure-engine/src/lib/infrastructure/persistence/migrations/0001-procedure-engine.sql',
      'packages/modules/procedure-engine/src/lib/infrastructure/persistence/migrations/0002-runtime-state.sql',
    ];
    const sql = paths.map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n');
    const referencedSchemas = [...sql.matchAll(/\b([a-z][a-z0-9_]*_schema)\./g)].map((match) => match[1]);
    expect(new Set(referencedSchemas)).toEqual(new Set(['integration_schema', 'procedure_schema']));
    expect(sql).not.toMatch(/\bcrm_schema\b|\bidentity_schema\b|\btenancy_schema\b/);
  });

  it('keeps Platform API and Portal free of Procedure package dependencies', () => {
    const api = JSON.parse(readFileSync(resolve(root, 'apps/api/package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const web = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(api.dependencies).not.toHaveProperty('@enterprise-platform/module-procedure-engine');
    expect(web.dependencies).not.toHaveProperty('@enterprise-platform/feature-procedure-engine');
  });
});
