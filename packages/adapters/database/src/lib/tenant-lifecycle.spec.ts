import type { Pool } from 'pg';
import { withActiveTenant } from './tenant-lifecycle.js';

function fakePool(locked: boolean, active = true) {
  const queries: string[] = [];
  const client = {
    on: jest.fn(),
    off: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('try_advisory')) return { rows: [{ locked }] };
      if (sql.includes('tenancy_schema')) return { rowCount: active ? 1 : 0 };
      return { rows: [] };
    }),
  };
  return {
    queries,
    client,
    pool: { connect: jest.fn(async () => client) } as unknown as Pool,
  };
}

describe('withActiveTenant lock modes', () => {
  it('uses the exclusive lock by default', async () => {
    const { pool, queries } = fakePool(true);
    const result = await withActiveTenant(pool, 't1', async () => 1);
    expect(result).toEqual({ executed: true, value: 1 });
    expect(queries[0]).toContain('pg_try_advisory_lock(');
    expect(queries.at(-1)).toContain('pg_advisory_unlock(');
  });

  it('uses the shared lock and shared unlock when requested', async () => {
    const { pool, queries } = fakePool(true);
    await withActiveTenant(pool, 't1', async () => 1, { mode: 'shared' });
    expect(queries[0]).toContain('pg_try_advisory_lock_shared(');
    expect(queries.at(-1)).toContain('pg_advisory_unlock_shared(');
  });

  it('reports busy without running the operation or unlocking', async () => {
    const { pool, queries } = fakePool(false);
    const op = jest.fn();
    const result = await withActiveTenant(pool, 't1', op, { mode: 'shared' });
    expect(result).toEqual({ executed: false, reason: 'busy' });
    expect(op).not.toHaveBeenCalled();
    expect(queries.some((q) => q.includes('unlock'))).toBe(false);
  });
});
