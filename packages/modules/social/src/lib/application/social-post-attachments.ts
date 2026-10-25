import {
  assertAttachmentSet,
  assertAttachmentsPostable,
  attachmentRulesFor,
} from '../domain/social-rules.js';
import { SocialAttachmentUnavailableError } from '../domain/social.error.js';
import type { AttachmentRow, SocialStore } from './social-store.port.js';

/** Phần của kho tệp mà việc kiểm tệp trước khi gắn vào bài cần. */
export type PostAttachmentLookup = Pick<SocialStore['attachments'], 'findById'>;

/**
 * Kiểm trước khi gắn tệp vào bài (tạo, sửa, hẹn giờ, gửi duyệt): tệp đã tải xong và của người gắn (hoặc đã thuộc
 * chính bài này), đúng luật tập tệp của bài (tối đa 3 video, ảnh, video và tài liệu trộn được, video phải tải lên cho bài
 * viết) và không có video xử lý lỗi (`SOCIAL_VIDEO_FAILED`); video đang chờ hay đang xử lý vẫn gắn được. Câu SQL gắn tệp vẫn chặn lần nữa ở tầng dữ
 * liệu; kiểm ở đây để trả lỗi rõ ràng và chặn ngay lúc lưu bài hẹn giờ.
 */
export async function assertPostAttachable(
  attachments: PostAttachmentLookup,
  tenantId: string,
  ids: readonly string[],
  uploaderId: string,
  postId?: string,
): Promise<void> {
  if (ids.length === 0) return;
  const rules = attachmentRulesFor('post');
  const rows: AttachmentRow[] = [];
  for (const id of ids) {
    const row = await attachments.findById(tenantId, id);
    const owned = postId !== undefined && row?.postId === postId;
    const free = row !== undefined && row.postId === undefined && row.commentId === undefined;
    if (
      !row ||
      !row.completed ||
      !(owned || (free && row.uploadedBy.toLowerCase() === uploaderId.toLowerCase())) ||
      !rules.allowedTypes.includes(row.contentType)
    ) {
      throw new SocialAttachmentUnavailableError();
    }
    rows.push(row);
  }
  assertAttachmentsPostable(rows);
  assertAttachmentSet('post', rows);
}
