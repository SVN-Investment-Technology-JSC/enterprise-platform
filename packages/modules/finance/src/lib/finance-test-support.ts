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
