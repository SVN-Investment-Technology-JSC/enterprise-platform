import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

/** Nơi chạy truy vấn: pool (một câu lệnh) hoặc client đang trong giao dịch. */
export type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * Phân giải database của tenant đã được guard ủy quyền (đăng ký trong TenantDatabaseRegistry)
 * và chạy giao dịch. Module không tự dựng connection string.
 */
@Injectable()
export class FinanceDatabase {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  pool(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId)) as unknown as Promise<Pool>;
  }

  async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return inTransaction(await this.pool(tenantId), work);
  }
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
export function todayVn(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString());
/** Cột `date` của pg trả về Date theo giờ máy; chuyển về YYYY-MM-DD không lệch múi giờ. */
export function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}
export const num = (value: unknown): number => Number(value ?? 0);
export const optStr = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
