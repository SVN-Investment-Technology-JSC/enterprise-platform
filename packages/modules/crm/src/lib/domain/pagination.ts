import { CRM_PAGE_LIMIT_DEFAULT, CRM_PAGE_LIMIT_MAX } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Con trỏ phân trang keyset: vị trí dòng cuối của trang trước theo thứ tự
 * `(at DESC, id DESC)`. `at` giữ nguyên chuỗi thời điểm có micro giây của
 * PostgreSQL để không bỏ sót hay lặp dòng cùng mili giây.
 */
export interface KeysetCursor {
  readonly at: string;
  readonly id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), 'utf8').toString('base64url');
}

const INVALID_CURSOR = () => new CrmValidationError('INVALID_CURSOR', 'Vị trí trang không hợp lệ. Vui lòng tải lại danh sách.');

export function decodeCursor(raw: unknown): KeysetCursor | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > 200) throw INVALID_CURSOR();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw INVALID_CURSOR();
    const [at, id] = parsed as unknown[];
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw INVALID_CURSOR();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw INVALID_CURSOR();
    return { at, id };
  } catch {
    throw INVALID_CURSOR();
  }
}

/** Số dòng một trang: mặc định 30, tối đa 100. */
export function pageLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return CRM_PAGE_LIMIT_DEFAULT;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('INVALID_LIMIT', 'Số dòng mỗi trang không hợp lệ.');
  }
  return Math.min(number, CRM_PAGE_LIMIT_MAX);
}
