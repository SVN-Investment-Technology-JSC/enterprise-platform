import {
  createPostgresPool,
  resolveTenantDatabaseUrl,
} from './adapter-database.js';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';

export interface TenantDatabaseDestructionTarget {
  readonly databaseName: string;
  readonly databaseOid: number;
  readonly clusterId: string;
  readonly endpoint: string;
}

/** Only server-owned endpoints are accepted. Aliases must be explicitly mapped by operations. */
export class TenantDatabaseDestruction {
  private readonly adminUrl: string;
  private readonly aliases: readonly string[];
  private readonly protectedNames: Set<string>;

  constructor(
    adminUrl = process.env.TENANT_DATABASE_ADMIN_URL ?? '',
    aliases = process.env.TENANT_DATABASE_ENDPOINT_ALIASES ?? '',
  ) {
    this.adminUrl = adminUrl;
    this.aliases = aliases
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    this.protectedNames = new Set([
      'postgres',
      'template0',
      'template1',
      'platform',
      ...(process.env.TENANT_DATABASE_PROTECTED_NAMES ?? '').split(','),
    ]);
    for (const value of [adminUrl, process.env.PLATFORM_DATABASE_URL]) {
      if (value)
        this.protectedNames.add(
          decodeURIComponent(new URL(value).pathname.slice(1)),
        );
    }
  }

  resourceKey(reference: TenantDatabaseReference): string {
    this.identifier(reference.databaseName);
    const admin = this.url(this.adminUrl);
    const resolved = this.url(
      resolveTenantDatabaseUrl(reference.secretRef, reference.databaseName),
    );
    const endpoint = this.endpoint(admin);
    if (
      decodeURIComponent(resolved.pathname.slice(1)) !==
        reference.databaseName ||
      !this.matches(this.endpoint(resolved), endpoint) ||
      !this.matches(
        `${reference.host.toLowerCase()}:${reference.port}`,
        endpoint,
      )
    ) {
      throw new Error('DATABASE_TARGET_MISMATCH');
    }
    return `${endpoint}/${reference.databaseName}`;
  }

  async inspect(
    reference: TenantDatabaseReference,
  ): Promise<TenantDatabaseDestructionTarget> {
    this.resourceKey(reference);
    const pool = this.pool();
    try {
      const clusterId = await this.cluster(pool);
      const result = await pool.query<{ oid: number; datistemplate: boolean }>(
        'SELECT oid,datistemplate FROM pg_database WHERE datname=$1',
        [reference.databaseName],
      );
      if (!result.rows[0] || result.rows[0].datistemplate)
        throw new Error('DATABASE_TARGET_NOT_FOUND');
      return {
        databaseName: reference.databaseName,
        databaseOid: result.rows[0].oid,
        clusterId,
        endpoint: this.endpoint(this.url(this.adminUrl)),
      };
    } finally {
      await pool.end();
    }
  }

  async drop(
    target: TenantDatabaseDestructionTarget,
    assertOwnership: () => Promise<void>,
  ): Promise<void> {
    this.identifier(target.databaseName);
    if (target.endpoint !== this.endpoint(this.url(this.adminUrl)))
      throw new Error('DATABASE_TARGET_MISMATCH');
    const pool = this.pool();
    try {
      if ((await this.cluster(pool)) !== target.clusterId)
        throw new Error('DATABASE_CLUSTER_CHANGED');
      const result = await pool.query<{ oid: number; datistemplate: boolean }>(
        'SELECT oid,datistemplate FROM pg_database WHERE datname=$1',
        [target.databaseName],
      );
      // An immutable snapshot permits resuming a crash immediately after DROP.
      if (!result.rows[0]) return;
      if (
        result.rows[0].oid !== target.databaseOid ||
        result.rows[0].datistemplate
      )
        throw new Error('DATABASE_IDENTITY_CHANGED');
      await assertOwnership();
      await pool.query(
        `ALTER DATABASE "${target.databaseName}" ALLOW_CONNECTIONS false`,
      );
      await assertOwnership();
      await pool.query(`DROP DATABASE "${target.databaseName}" WITH (FORCE)`);
      const remaining = await pool.query(
        'SELECT 1 FROM pg_database WHERE datname=$1',
        [target.databaseName],
      );
      if (remaining.rowCount) throw new Error('DATABASE_DELETE_INCOMPLETE');
    } finally {
      await pool.end();
    }
  }

  private identifier(value: string): void {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value) || this.protectedNames.has(value))
      throw new Error('DATABASE_PROTECTED');
  }
  private url(value: string): URL {
    if (!value) throw new Error('DATABASE_ADMIN_NOT_CONFIGURED');
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
      throw new Error('DATABASE_TARGET_MISMATCH');
    return url;
  }
  private endpoint(url: URL): string {
    return `${url.hostname.toLowerCase()}:${url.port || '5432'}`;
  }
  private matches(endpoint: string, canonical: string): boolean {
    return endpoint === canonical || this.aliases.includes(endpoint);
  }
  private pool() {
    return createPostgresPool(this.adminUrl, {
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      application_name: 'enterprise-platform:tenant-deletion',
    });
  }
  private async cluster(
    pool: ReturnType<typeof createPostgresPool>,
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'SELECT system_identifier::text AS id FROM pg_control_system()',
    );
    return result.rows[0].id;
  }
}
