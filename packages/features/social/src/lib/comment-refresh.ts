import type { SocialComment, SocialCommentPage } from '@enterprise-platform/contracts-social';

/** Số trang tối đa dò tìm một bình luận khi làm mới (mỗi trang một lần gọi); quá thì thôi, tránh quét cả bài. */
export const COMMENT_REFRESH_MAX_PAGES = 10;

export type LoadCommentPage = (
  postId: string,
  options: { parentId?: string; cursor?: string },
) => Promise<SocialCommentPage>;

/**
 * Tải lại đúng một bình luận (chưa có API lấy một bình luận): duyệt các trang cùng cấp theo `nextCursor` tới khi gặp
 * `commentId`. Không thấy (đã xoá, hoặc nằm quá `COMMENT_REFRESH_MAX_PAGES` trang) thì trả `undefined`.
 */
export async function findFreshComment(
  load: LoadCommentPage,
  postId: string,
  commentId: string,
  parentId?: string,
): Promise<SocialComment | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < COMMENT_REFRESH_MAX_PAGES; page += 1) {
    const result = await load(postId, { ...(parentId ? { parentId } : {}), ...(cursor ? { cursor } : {}) });
    const found = result.items.find((item) => item.id === commentId);
    if (found) return found;
    if (!result.nextCursor) return undefined;
    cursor = result.nextCursor;
  }
  return undefined;
}
