import type { AttachmentRow } from './social-store.port.js';

/** Token DI của kho tệp đính kèm bình luận. */
export const SOCIAL_COMMENT_ATTACHMENT_STORE = Symbol('SOCIAL_COMMENT_ATTACHMENT_STORE');

/** Đọc và gỡ tệp đính kèm của bình luận (gắn tệp làm cùng giao dịch với tạo/sửa bình luận). */
export interface SocialCommentAttachmentStore {
  /** Tệp đã tải xong của các bình luận, cũ trước. */
  forComments(
    tenantId: string,
    commentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly AttachmentRow[]>>;
  /**
   * Gỡ khỏi bình luận mọi tệp không nằm trong `keepIds` và trả các dòng đã gỡ. Tệp đã gỡ thành tệp mồ côi:
   * người gọi xoá object rồi xoá dòng, nếu xoá object lỗi thì job dọn mồ côi thử lại sau.
   */
  detach(tenantId: string, commentId: string, keepIds: readonly string[]): Promise<AttachmentRow[]>;
}
