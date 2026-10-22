import type { PostVisibilityScope } from '../application/ports/post-visibility.port.js';

export interface PostVisibilitySqlOptions {
  /** Bí danh bảng `social_schema.posts` trong truy vấn. Mặc định `p`. */
  readonly postAlias?: string;
  /** Bí danh của `LEFT JOIN social_schema.groups ON groups.id = p.group_id`. Mặc định `g`. */
  readonly groupAlias?: string;
  /** Số thứ tự của tham số `$n` đầu tiên mà mệnh đề được dùng. */
  readonly firstParam: number;
}

export interface PostVisibilitySql {
  /** Mệnh đề để AND vào WHERE; tham chiếu `$firstParam`, `$firstParam + 1` và `$firstParam + 2`. */
  readonly sql: string;
  /**
   * Tham số tương ứng, theo thứ tự: `uuid[]` nhóm của người xem, `uuid` người xem, `uuid[]` id nút
   * tổ chức của người xem (`ViewerScope.unitIds`, gồm cả tổ tiên). Mảng rỗng là hợp lệ.
   */
  readonly params: readonly [string[], string, string[]];
}

/** Số tham số mà `postVisibilitySql` chiếm. */
export const POST_VISIBILITY_PARAM_COUNT = 3;

/**
 * Mệnh đề SQL của luật nhìn thấy bài (xem `post-visibility.port.ts`, luật 1-5). Mọi truy vấn bài dành
 * cho người dùng phải nối `LEFT JOIN social_schema.groups g ON g.id = p.group_id` rồi AND mệnh đề này;
 * truy vấn bảng tin còn tự thêm điều kiện `status = 'published'` và lọc `group_id` theo phạm vi.
 *
 * Cờ `seesAllGroups` / `canModerate` được nhúng thành `TRUE`/`FALSE` (boolean của TypeScript, không
 * phải chuỗi người dùng) nên không cần tham số. SQL không nối bảng của Core: phòng ban của người xem
 * đến dưới dạng mảng `$units`.
 *
 * Ba nhánh cuối (đã đăng / chưa đăng) khớp từng dòng với `canViewPostInScope`:
 * - tác giả luôn thấy bài của mình (sau luật nhóm);
 * - bài nhóm: đã đăng thì thấy, chưa đăng chỉ moderator;
 * - bài Tường công ty: đã đăng theo `visibility`; chưa đăng chỉ moderator và chỉ khi `company`.
 */
export function postVisibilitySql(scope: PostVisibilityScope, options: PostVisibilitySqlOptions): PostVisibilitySql {
  const p = options.postAlias ?? 'p';
  const g = options.groupAlias ?? 'g';
  const groups = `$${options.firstParam}`;
  const viewer = `$${options.firstParam + 1}`;
  const units = `$${options.firstParam + 2}`;
  const seesAll = scope.seesAllGroups ? 'TRUE' : 'FALSE';
  const moderates = scope.canModerate ? 'TRUE' : 'FALSE';

  const audienceMatch =
    `EXISTS (SELECT 1 FROM social_schema.post_audience a WHERE a.post_id = ${p}.id AND (` +
    `(a.principal_type = 'user' AND a.principal_id = ${viewer}::uuid)` +
    ` OR (a.principal_type = 'unit' AND a.principal_id = ANY(${units}::uuid[]))))`;

  const sql =
    `(${p}.status <> 'deleted'` +
    ` AND (${p}.group_id IS NULL OR (${g}.deleted_at IS NULL AND (${g}.privacy = 'public' OR ${seesAll} OR ${p}.group_id = ANY(${groups}::uuid[]))))` +
    ` AND (${p}.author_id = ${viewer}::uuid` +
    ` OR (${p}.group_id IS NOT NULL AND (${p}.status = 'published' OR ${moderates}))` +
    ` OR (${p}.group_id IS NULL AND (` +
    `(${p}.status = 'published' AND (${p}.visibility = 'company'` +
    ` OR (${p}.visibility = 'unit' AND ${p}.author_unit_id = ANY(${units}::uuid[]))` +
    ` OR (${p}.visibility = 'custom' AND ${audienceMatch})))` +
    ` OR (${p}.status <> 'published' AND ${p}.visibility = 'company' AND ${moderates})))))`;

  return { sql, params: [[...scope.memberGroupIds], scope.viewerId, [...(scope.unitIds ?? [])]] };
}
