import type { Pool } from 'pg';

/** Same session lock as deletion. No operation can queue behind a deletion and
 * then use a stale database reference. Busy callers retry on their next tick. */
export async function withActiveTenant<T>(
  pool: Pool,
  tenantId: string,
  operation: () => Promise<T>,
): Promise<
  | { executed: true; value: T }
  | { executed: false; reason: 'busy' | 'inactive' }
> {
  const client = await pool.connect();
  const key = `tenant-lifecycle:${tenantId}`;
  let locked = false;
  let failed = false;
  const onError = () => {
    failed = true;
  };
  client.on('error', onError);
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
      [key],
    );
    locked = lock.rows[0].locked;
    if (!locked) return { executed: false, reason: 'busy' };
    const active = await client.query(
      "SELECT 1 FROM tenancy_schema.tenants t JOIN tenancy_schema.tenant_db_configs d ON d.tenant_id=t.id WHERE t.id=$1 AND t.status='active' AND d.status='active'",
      [tenantId],
    );
    if (!active.rowCount) return { executed: false, reason: 'inactive' };
    const value = await operation();
    if (failed) throw new Error('Tenant lifecycle connection lost.');
    return { executed: true, value };
  } finally {
    if (locked && !failed)
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key])
        .catch(() => {
          failed = true;
        });
    client.off('error', onError);
    client.release(failed);
  }
}
