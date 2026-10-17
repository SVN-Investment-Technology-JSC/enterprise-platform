import type { Pool, PoolClient } from 'pg';
import type { FinanceStoragePort } from './infrastructure/attachments.store.js';
import { FinanceDatabase } from './infrastructure/finance.database.js';

/**
 * FinanceDatabase dùng pool của test; giao dịch tự quản để chạy được cả trên PostgreSQL thật lẫn PGlite cục bộ
 * (không cần đăng ký database theo tenant như khi chạy trong guard).
 */
export class TestFinanceDatabase extends FinanceDatabase {
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

/** Kho đối tượng giả: ghi nhớ tệp "đã tải lên" để kiểm tra bước xác nhận kích thước và định dạng. */
export class FakeFinanceStorage implements FinanceStoragePort {
  readonly objects = new Map<string, { sizeBytes: number; contentType: string }>();

  async createUploadUrl(input: { key: string }): Promise<string> {
    return `https://storage.test/upload/${input.key}`;
  }
  async createDownloadUrl(key: string): Promise<string> {
    return `https://storage.test/download/${key}`;
  }
  async objectMetadata(key: string): Promise<{ sizeBytes: number; contentType: string }> {
    const found = this.objects.get(key);
    if (!found) throw new Error('NoSuchKey');
    return found;
  }
  /** Giả lập trình duyệt PUT tệp lên URL ký sẵn. */
  upload(uploadUrl: string, sizeBytes: number, contentType: string): void {
    this.objects.set(uploadUrl.replace('https://storage.test/upload/', ''), { sizeBytes, contentType });
  }
}

/**
 * Đóng pool của DB test rồi xoá DB.
 *
 * `pool.end()` của pg-pool resolve ngay khi client bị bỏ khỏi danh sách, TRƯỚC khi `client.end()` đóng xong socket, và listener
 * lỗi của client vẫn còn gắn. Nếu DROP DATABASE ... WITH (FORCE) chạy lúc đó, Postgres giết các backend chưa đóng (57P01) và
 * pool phát sự kiện 'error' không ai nghe, làm Jest báo "Test suite failed to run" dù mọi test đã đạt. Vì vậy: chờ đủ sự kiện
 * 'remove' (socket đã đóng), chờ Postgres không còn backend nào của DB, rồi mới xoá.
 */
export async function dropTestDatabase(
  admin: Pick<Pool, 'query'>,
  pool: Pool | undefined,
  databaseName: string,
): Promise<void> {
  if (!/^finance_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
  if (pool) {
    // Lỗi đến SAU khi pool đã đóng chỉ có thể là kết nối đang đóng dở bị Postgres cắt: không còn ai dùng kết nối đó.
    pool.on('error', () => undefined);
    let pending = pool.totalCount;
    const closed = new Promise<void>((resolve) => {
      if (!pending) return resolve();
      pool.on('remove', () => {
        pending -= 1;
        if (pending <= 0) resolve();
      });
    });
    await pool.end();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [databaseName]);
    if (!(rows[0] as { n: number }).n) break;
    await new Promise((resolve) => setTimeout(resolve, 100).unref());
  }
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
}
