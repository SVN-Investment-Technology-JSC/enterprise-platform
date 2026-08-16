export interface ConnectionFactory<TConfig, TConnection> {
  create(config: TConfig): Promise<TConnection>;
  close(connection: TConnection): Promise<void>;
}

export interface PoolRegistry<TKey, TConnection> {
  get(key: TKey): TConnection | undefined;
  set(key: TKey, connection: TConnection): void;
  delete(key: TKey): void;
}

export interface TransactionRunner<TConnection> {
  run<TValue>(
    connection: TConnection,
    operation: (connection: TConnection) => Promise<TValue>,
  ): Promise<TValue>;
}

export function createConnectionKey(...parts: readonly string[]): string {
  if (parts.length === 0 || parts.some((part) => part.trim().length === 0)) {
    throw new Error('A connection key requires non-empty parts.');
  }

  return parts.join(':');
}

export interface SecretProvider {
  resolve(secretRef: string): string;
}

export class EnvironmentSecretProvider implements SecretProvider {
  resolve(secretRef: string): string {
    const value = process.env[secretRef];
    if (!value) {
      throw new Error(`Database secret ${secretRef} is not configured.`);
    }
    return value;
  }
}

interface ManagedPool {
  readonly pool: Pool;
  lastUsedAt: number;
}

export interface PostgresPoolRegistryOptions {
  readonly maxPools?: number;
  readonly idleTtlMs?: number;
  readonly maxConnectionsPerPool?: number;
  readonly connectionTimeoutMillis?: number;
}

/**
 * A bounded LRU registry. It intentionally never falls back to another tenant:
 * a missing secret or unavailable tenant database is surfaced to the caller.
 */
export class PostgresPoolRegistry {
  private readonly pools = new Map<string, ManagedPool>();
  private readonly maxPools: number;
  private readonly idleTtlMs: number;
  private readonly maxConnectionsPerPool: number;
  private readonly connectionTimeoutMillis: number;

  constructor(
    private readonly secrets: SecretProvider = new EnvironmentSecretProvider(),
    options: PostgresPoolRegistryOptions = {},
  ) {
    this.maxPools = options.maxPools ?? 12;
    this.idleTtlMs = options.idleTtlMs ?? 5 * 60_000;
    this.maxConnectionsPerPool = options.maxConnectionsPerPool ?? 8;
    this.connectionTimeoutMillis = options.connectionTimeoutMillis ?? 3_000;
  }

  async forTenant(reference: TenantDatabaseReference): Promise<Pool> {
    await this.evictExpired();
    const key = createConnectionKey(
      reference.tenantId,
      String(reference.configVersion),
    );
    const existing = this.pools.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.pool;
    }
    if (this.pools.size >= this.maxPools) await this.evictLeastRecentlyUsed();
    const pool = new Pool({
      connectionString: this.secrets.resolve(reference.secretRef),
      max: this.maxConnectionsPerPool,
      idleTimeoutMillis: Math.min(this.idleTtlMs, 30_000),
      connectionTimeoutMillis: this.connectionTimeoutMillis,
      application_name: `enterprise-platform:${reference.tenantId}`,
      ssl: reference.ssl ? { rejectUnauthorized: true } : undefined,
    });
    pool.on('error', () => {
      // pg removes broken idle clients. The next query either reconnects or fails.
    });
    this.pools.set(key, { pool, lastUsedAt: Date.now() });
    return pool;
  }

  async closeAll(): Promise<void> {
    const active = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(active.map(({ pool }) => pool.end()));
  }

  private async evictExpired(): Promise<void> {
    const threshold = Date.now() - this.idleTtlMs;
    const expired = [...this.pools.entries()].filter(
      ([, value]) => value.lastUsedAt < threshold,
    );
    await Promise.all(
      expired.map(async ([key, value]) => {
        this.pools.delete(key);
        await value.pool.end();
      }),
    );
  }

  private async evictLeastRecentlyUsed(): Promise<void> {
    const oldest = [...this.pools.entries()].sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    )[0];
    if (!oldest) return;
    this.pools.delete(oldest[0]);
    await oldest[1].pool.end();
  }
}

export class TenantDatabaseRegistry {
  private readonly references = new Map<string, TenantDatabaseReference>();

  register(reference: TenantDatabaseReference): void {
    this.references.set(reference.tenantId, reference);
  }

  require(tenantId: string): TenantDatabaseReference {
    const reference = this.references.get(tenantId);
    if (!reference) {
      throw new Error(`No authorized database reference for tenant ${tenantId}.`);
    }
    return reference;
  }

  list(): readonly TenantDatabaseReference[] {
    return [...this.references.values()];
  }
}

export function createPostgresPool(
  connectionString: string,
  options: Omit<PoolConfig, 'connectionString'> = {},
): Pool {
  return new Pool({ connectionString, ...options });
}

export async function inTransaction<TValue>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<TValue>,
): Promise<TValue> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<TRow extends QueryResultRow>(
  pool: Pool,
  text: string,
  values: readonly unknown[] = [],
): Promise<TRow | undefined> {
  const result = await pool.query<TRow>(text, [...values]);
  return result.rows[0];
}
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
