import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Pool, PoolClient } from 'pg';
import { CrmDatabase } from './infrastructure/crm.database.js';

/** Biến môi trường bật integration test: URL quản trị của một PostgreSQL cục bộ dùng xong bỏ. */
export const CRM_TEST_ADMIN_URL_ENV = 'CRM_TEST_ADMIN_URL';

/** `describe` khi có PostgreSQL thử, `describe.skip` khi không — CI không có DB vẫn xanh. */
export function crmIntegrationEnabled(): boolean {
  return Boolean(process.env[CRM_TEST_ADMIN_URL_ENV]);
}

/**
 * CrmDatabase dùng pool của test; giao dịch tự quản để không cần đăng ký
 * database theo tenant như khi chạy trong guard.
 */
export class TestCrmDatabase extends CrmDatabase {
  constructor(private readonly testPool: Pool) {
    super(undefined as never, undefined as never);
  }
  override async pool(): Promise<Pool> {
    return this.testPool;
  }
  override async transaction<T>(_tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.testPool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Một DB tạm cho một suite: tạo ở `beforeAll`, xoá ở `afterAll`. */
export interface CrmTestDatabaseHandle {
  readonly databaseName: string;
  readonly pool: Pool;
  readonly database: TestCrmDatabase;
  drop(): Promise<void>;
}

/**
 * Tạo DB tạm `crm_test_<uuid>` rồi chạy migration như lúc bật phân hệ cho
 * tenant: `tenant/0001-integration.sql` (outbox, inbox) trước, sau đó mọi file
 * trong `tenant/crm` theo thứ tự tên. Chỉ nhận PostgreSQL ở localhost để không
 * bao giờ tạo hay xoá DB trên máy chủ thật.
 */
export async function createCrmTestDatabase(): Promise<CrmTestDatabaseHandle> {
  const raw = process.env[CRM_TEST_ADMIN_URL_ENV];
  if (!raw) throw new Error(`${CRM_TEST_ADMIN_URL_ENV} is not set.`);
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
  const databaseName = 'crm_test_' + randomUUID().replace(/-/g, '');
  const admin = createPostgresPool(url.toString());
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const root = migrationsRoot();
    await pool.query(await readFile(resolve(root, 'tenant/0001-integration.sql'), 'utf8'));
    const directory = resolve(root, 'tenant/crm');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
      await pool.query(await readFile(resolve(directory, file), 'utf8'));
  } catch (error) {
    await dropTestDatabase(admin, pool, databaseName).catch(() => undefined);
    await admin.end();
    throw error;
  }
  const ready = pool;
  return {
    databaseName,
    pool: ready,
    database: new TestCrmDatabase(ready),
    drop: async () => {
      try {
        await dropTestDatabase(admin, ready, databaseName);
      } finally {
        await admin.end();
      }
    },
  };
}

/** Jest chạy với cwd là thư mục project (`packages/modules/crm`). */
function migrationsRoot(): string {
  return resolve(process.cwd(), '../../../migrations');
}

/**
 * Đóng pool của DB test rồi xoá DB.
 *
 * Như `finance-test-support.ts`: chờ mọi kết nối đóng hẳn và Postgres không
 * còn backend nào của DB rồi mới `DROP ... WITH (FORCE)`, để pool không phát
 * sự kiện lỗi lúc Jest đã xong suite.
 */
export async function dropTestDatabase(
  admin: Pick<Pool, 'query'>,
  pool: Pool | undefined,
  databaseName: string,
): Promise<void> {
  if (!/^crm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
  if (pool) {
    // Lỗi đến SAU khi pool đã đóng chỉ có thể là kết nối đang đóng dở bị Postgres cắt.
    pool.on('error', () => undefined);
    let pending = pool.totalCount;
    const closed = new Promise<void>((done) => {
      if (!pending) return done();
      pool.on('remove', () => {
        pending -= 1;
        if (pending <= 0) done();
      });
    });
    await pool.end();
    await Promise.race([closed, new Promise((done) => setTimeout(done, 5_000).unref())]);
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [databaseName]);
    if (!(rows[0] as { n: number }).n) break;
    await new Promise((done) => setTimeout(done, 100).unref());
  }
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
}
