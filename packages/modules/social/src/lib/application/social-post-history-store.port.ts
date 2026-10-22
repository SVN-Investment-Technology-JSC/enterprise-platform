/** Token DI của store lịch sử sửa bài (đợt 2). Hiện thực: `PostgresSocialPostHistoryStore`. */
export const SOCIAL_POST_HISTORY_STORE = Symbol('SOCIAL_POST_HISTORY_STORE');

/** Một bản cũ của bài trong `social_schema.post_edits`. */
export interface PostEditRecord {
  readonly version: number;
  readonly title?: string;
  readonly bodyHtml: string;
  /** Người đã sửa bản này thành bản kế tiếp. */
  readonly editedBy: string;
  /** ISO UTC; thời điểm bản này bị thay thế. */
  readonly editedAt: string;
}

export interface SocialPostHistoryStore {
  /** Các bản cũ của bài, mới nhất trước (tối đa 50 bản được giữ). Quyền xem đã kiểm ở service. */
  list(tenantId: string, postId: string): Promise<PostEditRecord[]>;
}
