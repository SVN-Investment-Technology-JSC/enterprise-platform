import { STOCK_MOVEMENT_MANUAL_SOURCE } from '@enterprise-platform/contracts-inventory';

export const STOCK_MOVEMENT_DEFAULT_PAGE_SIZE = 50;
export const STOCK_MOVEMENT_MAX_PAGE_SIZE = 200;
/** Chuỗi tìm kiếm dài hơn không có ý nghĩa với mã và tên mặt hàng. */
export const STOCK_MOVEMENT_SEARCH_MAX = 100;

/**
 * Chuẩn hoá nguồn phát sinh: bỏ khoảng trắng, chữ thường, trống thành `manual`.
 * Phải khớp biểu thức SQL trong store (`COALESCE(NULLIF(lower(btrim(x)), ''), 'manual')`)
 * để lọc theo nguồn và nhãn hiển thị dùng cùng một giá trị.
 */
export function normalizeMovementSource(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return trimmed || STOCK_MOVEMENT_MANUAL_SOURCE;
}

export function resolveMovementPaging(
  limit: number | undefined,
  offset: number | undefined,
): { limit: number; offset: number } {
  const size = Math.trunc(Number(limit));
  const skip = Math.trunc(Number(offset));
  return {
    limit:
      Number.isFinite(size) && size > 0
        ? Math.min(size, STOCK_MOVEMENT_MAX_PAGE_SIZE)
        : STOCK_MOVEMENT_DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

/** Thoát ký tự đại diện của LIKE để người dùng tìm được mã có `%` hoặc `_`. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
