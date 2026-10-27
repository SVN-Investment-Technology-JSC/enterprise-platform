import type { CrmDataScope } from '../application/data-scope.js';

/** Đoạn điều kiện SQL và tham số đi kèm, ghép vào mệnh đề WHERE của câu gọi. */
export interface ScopeSqlFragment {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Chỉ nhận định danh cột dạng `cot` hoặc `bi_danh.cot`, để không ghép nhầm chuỗi lạ vào SQL. */
const COLUMN_PATTERN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * Điều kiện lọc theo phạm vi dữ liệu trên cột người phụ trách.
 *
 * `column` là tên cột (thường `alias.owner_user_id`), `firstParam` là số thứ tự
 * `$n` kế tiếp của câu gọi. Phạm vi toàn bộ trả `TRUE` và không thêm tham số;
 * phạm vi theo người trả `column = ANY($n::uuid[])`. Danh sách rỗng (không xảy
 * ra vì luôn có chính actor) vẫn trả điều kiện không khớp dòng nào.
 */
export function ownerScopeSql(
  scope: CrmDataScope,
  column: string,
  firstParam: number,
): ScopeSqlFragment {
  if (!COLUMN_PATTERN.test(column)) throw new Error(`Invalid scope column: "${column}".`);
  if (!Number.isInteger(firstParam) || firstParam < 1) throw new Error(`Invalid parameter index: ${firstParam}.`);
  if (scope.kind === 'all') return { sql: 'TRUE', params: [] };
  return { sql: `${column} = ANY($${firstParam}::uuid[])`, params: [[...scope.userIds]] };
}
