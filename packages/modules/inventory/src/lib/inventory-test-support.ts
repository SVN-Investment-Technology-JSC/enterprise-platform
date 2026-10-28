import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  createPostgresPool,
} from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';

/**
 * DB Postgres dùng một lần cho integration test của Kho, theo mẫu
 * `finance-test-support.ts`. Bật bằng `INVENTORY_TEST_ADMIN_URL` (chỉ nhận
 * localhost): mỗi bộ test tạo DB riêng, chạy `0001-integration.sql` rồi các
 * migration Kho theo đúng thứ tự đăng ký trong `tenant-migrations.ts`, xong thì xoá DB.
 */
export const INVENTORY_TEST_ADMIN_URL = process.env['INVENTORY_TEST_ADMIN_URL'];

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
 * Đọc thứ tự migration Kho từ chính file đăng ký thay vì sắp theo tên file:
 * migrator chạy theo mảng, và có file cố ý chưa đăng ký (0007).
 */
export async function inventoryMigrationPaths(root = workspaceRoot()): Promise<string[]> {
  const registry = await readFile(
    resolve(root, 'packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const start = registry.indexOf('\n  inventory: [');
  if (start < 0) throw new Error('Không tìm thấy mảng migration inventory.');
  const block = registry.slice(start, registry.indexOf('\n  ],', start));
  return [...block.matchAll(/path: '(tenant\/inventory\/[^']+\.sql)'/g)].map((match) => match[1]);
}

/** Registry trả thẳng pool của DB test, bỏ qua bước guard đăng ký tenant. */
class TestTenantDatabaseRegistry extends TenantDatabaseRegistry {
  override require(): never {
    return {} as never;
  }
}

class TestPoolRegistry extends PostgresPoolRegistry {
  constructor(private readonly pool: Pool) {
    super();
  }
  override async forTenant(): Promise<Pool> {
    return this.pool;
  }
}

export class TestInventoryDatabase {
  readonly references: TenantDatabaseRegistry = new TestTenantDatabaseRegistry();
  readonly pools: PostgresPoolRegistry;

  private constructor(
    private readonly admin: Pool,
    readonly pool: Pool,
    readonly databaseName: string,
    /** URL của DB test, cho script chạy ngoài tiến trình test. */
    readonly url: string,
    /** Migration Kho chưa chạy khi tạo với `stopBefore`, theo đúng thứ tự đăng ký. */
    readonly pendingMigrations: readonly string[],
  ) {
    this.pools = new TestPoolRegistry(pool);
  }

  /** Chạy một file migration như migrator: cả file trong một transaction ngầm. */
  async runMigration(path: string): Promise<void> {
    await this.pool.query(await readFile(resolve(workspaceRoot(), 'migrations', path), 'utf8'));
  }

  /**
   * Tạo DB test và chạy migration Kho. `stopBefore` (tên version, ví dụ
   * `0013-serial-quality`) dừng trước migration đó để test dựng dữ liệu cũ.
   */
  static async create(
    adminUrl: string,
    options: { readonly stopBefore?: string } = {},
  ): Promise<TestInventoryDatabase> {
    const url = new URL(adminUrl);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Only local disposable PostgreSQL is allowed');
    }
    const databaseName = 'inventory_test_' + randomUUID().replace(/-/g, '');
    const admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    const pool = createPostgresPool(url.toString(), { max: 12 });
    const root = workspaceRoot();
    // Hạ tầng outbox có sẵn ở mọi DB tenant trước migration của module; cảnh báo tồn thấp ghi vào đó.
    await pool.query(await readFile(resolve(root, 'migrations/tenant/0001-integration.sql'), 'utf8'));
    const paths = await inventoryMigrationPaths(root);
    const stop = options.stopBefore
      ? paths.findIndex((path) => path.endsWith(`/${options.stopBefore}.sql`))
      : paths.length;
    if (stop < 0) throw new Error(`Không tìm thấy migration ${options.stopBefore}.`);
    for (const path of paths.slice(0, stop)) {
      await pool.query(await readFile(resolve(root, 'migrations', path), 'utf8'));
    }
    return new TestInventoryDatabase(admin, pool, databaseName, url.toString(), paths.slice(stop));
  }

  /**
   * Đóng pool rồi xoá DB. Chờ socket đóng hẳn và Postgres hết backend của DB
   * trước khi DROP, lý do như `dropTestDatabase` của Tài chính.
   */
  async drop(): Promise<void> {
    if (!/^inventory_test_[a-f0-9]{32}$/.test(this.databaseName)) {
      throw new Error('Invalid test database');
    }
    this.pool.on('error', () => undefined);
    let pending = this.pool.totalCount;
    const closed = new Promise<void>((resolveClosed) => {
      if (!pending) return resolveClosed();
      this.pool.on('remove', () => {
        pending -= 1;
        if (pending <= 0) resolveClosed();
      });
    });
    await this.pool.end();
    await Promise.race([closed, new Promise((done) => setTimeout(done, 5_000).unref())]);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const { rows } = await this.admin.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`,
        [this.databaseName],
      );
      if (!(rows[0] as { n: number }).n) break;
      await new Promise((done) => setTimeout(done, 100).unref());
    }
    await this.admin.query(`DROP DATABASE IF EXISTS "${this.databaseName}" WITH (FORCE)`);
    await this.admin.end();
  }
}
