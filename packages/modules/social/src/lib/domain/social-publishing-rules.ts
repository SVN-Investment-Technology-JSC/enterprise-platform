import {
  SOCIAL_REJECT_REASON_MAX,
  SOCIAL_SCHEDULE_MAX_DAYS,
  SOCIAL_SCHEDULE_MIN_LEAD_SECONDS,
} from '@enterprise-platform/contracts-social';
import { SocialValidationError } from './social.error.js';

/** Trạng thái mà một bài có thể có ngay khi được tạo hoặc gửi lại. */
export type EntryStatus = 'published' | 'pending' | 'scheduled';

/** Hẹn giờ: ISO hợp lệ, cách hiện tại ít nhất 60 giây và tối đa 365 ngày. */
export function normalizeScheduledAt(value: unknown, now: Date): string {
  if (typeof value !== 'string' || !value.trim()) throw new SocialValidationError('Giờ hẹn đăng không hợp lệ.');
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new SocialValidationError('Giờ hẹn đăng không hợp lệ.');
  const lead = time - now.getTime();
  if (lead < SOCIAL_SCHEDULE_MIN_LEAD_SECONDS * 1000) {
    throw new SocialValidationError(
      `Giờ hẹn đăng phải cách hiện tại ít nhất ${SOCIAL_SCHEDULE_MIN_LEAD_SECONDS} giây.`,
    );
  }
  if (lead > SOCIAL_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000) {
    throw new SocialValidationError(`Chỉ hẹn giờ đăng trong vòng ${SOCIAL_SCHEDULE_MAX_DAYS} ngày tới.`);
  }
  return new Date(time).toISOString();
}

export function normalizeRejectReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SocialValidationError('Hãy nhập lý do từ chối để tác giả biết cách chỉnh sửa.');
  }
  const reason = value.trim();
  if (reason.length > SOCIAL_REJECT_REASON_MAX) {
    throw new SocialValidationError(`Lý do từ chối tối đa ${SOCIAL_REJECT_REASON_MAX} ký tự.`);
  }
  return reason;
}

/**
 * Trạng thái khi một bài được đăng (tạo, đăng ngay, đến giờ, gửi lại sau khi bị từ chối):
 * chỉ bài Tường công ty của người không được miễn duyệt mới vào `pending` khi cài đặt bật.
 * "Được miễn duyệt" là moderator, hoặc bài hẹn giờ do moderator tạo (xem `isExemptScheduled`).
 */
export function statusOnPublish(input: {
  readonly isWall: boolean;
  readonly requireApproval: boolean;
  readonly exempt: boolean;
}): 'published' | 'pending' {
  return input.isWall && input.requireApproval && !input.exempt ? 'pending' : 'published';
}

/**
 * Bài hẹn giờ do moderator tạo mang dấu miễn duyệt `moderatedBy = authorId` (không có cột riêng
 * và job đến giờ không biết quyền của tác giả). Dấu này chỉ có ý nghĩa khi bài còn `scheduled`.
 */
export function isExemptScheduled(post: { readonly authorId: string; readonly moderatedBy?: string }): boolean {
  return post.moderatedBy !== undefined && post.moderatedBy.toLowerCase() === post.authorId.toLowerCase();
}

/** Con trỏ theo vị trí cho danh sách tính toán trong bộ nhớ (xác nhận đã đọc, người bỏ phiếu). */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === '') return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = (parsed as { o?: unknown } | null)?.o;
    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    // rơi xuống lỗi chung
  }
  throw new SocialValidationError('Con trỏ phân trang không hợp lệ.');
}
