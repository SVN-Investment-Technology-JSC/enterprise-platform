import type { CrmDataScope } from '../application/data-scope.js';
import type { KeysetCursor } from '../domain/pagination.js';
import { encodeCursor } from '../domain/pagination.js';
import { ownerScopeSql } from './owner-scope-sql.js';

/**
 * Bộ dựng mệnh đề WHERE có tham số đánh số tự động: mỗi `param` trả `$n` kế
 * tiếp. Giá trị người dùng chỉ đi qua tham số, không bao giờ ghép vào chuỗi SQL.
 */
export class SqlConditions {
  private readonly conditions: string[] = [];

  /**
   * `params` truyền vào khi nhiều mệnh đề WHERE (các nhánh UNION) dùng chung
   * một mảng tham số của cùng một câu gọi.
   */
  constructor(readonly params: unknown[] = []) {}

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  add(condition: string): void {
    this.conditions.push(condition);
  }

  /** Điều kiện phạm vi dữ liệu trên một hay nhiều cột người phụ trách (nối OR). */
  scope(scope: CrmDataScope, ...columns: string[]): void {
    if (scope.kind === 'all') return;
    const index = this.params.length + 1;
    const fragments = columns.map((column) => ownerScopeSql(scope, column, index));
    this.params.push(...fragments[0].params);
    this.add(fragments.length === 1 ? fragments[0].sql : `(${fragments.map((fragment) => fragment.sql).join(' OR ')})`);
  }

  /** Vị trí sau con trỏ theo thứ tự `(at DESC, id DESC)`. */
  after(cursor: KeysetCursor | undefined, atColumn: string, idColumn: string): void {
    if (!cursor) return;
    this.add(`(${atColumn}, ${idColumn}) < (${this.param(cursor.at)}::timestamptz, ${this.param(cursor.id)}::uuid)`);
  }

  where(): string {
    return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '';
  }
}

/** `abc` → `abc%` cho `LIKE`, thoát `%`, `_`, `\` mà người dùng gõ. */
export function prefixPattern(text: string): string {
  return `${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Truy vấn full-text khớp đầu từ: `minh anh` → `minh:* & anh:*`. Chỉ giữ chữ
 * và số (mọi ký tự khác thành dấu cách), nên chuỗi đưa vào `to_tsquery` không
 * bao giờ có toán tử lạ. Không còn từ nào thì trả `undefined`.
 */
export function prefixTsQuery(text: string): string | undefined {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((word) => `${word}:*`).join(' & ') : undefined;
}

/** Biểu thức SQL đọc thời điểm đủ micro giây theo UTC, để làm con trỏ. */
export function cursorAt(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Cắt dòng thừa (đọc `limit + 1`) và dựng con trỏ trang sau. */
export function keysetPage<TRow extends { cursor_at: string; id: string }, TItem>(
  rows: readonly TRow[],
  limit: number,
  map: (row: TRow) => TItem,
): { items: TItem[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
  };
}

/** Lỗi vi phạm ràng buộc của PostgreSQL (unique, khoá ngoại, check). */
export function constraintViolation(error: unknown, code: '23505' | '23503' | '23514', constraint?: string): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === code && (!constraint || pgError.constraint === constraint);
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** `numeric` của pg đọc ra chuỗi. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** `date` đọc ra chuỗi `YYYY-MM-DD` (pool đặt type parser), phòng khi là Date. */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
