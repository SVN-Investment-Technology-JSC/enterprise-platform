/**
 * Tín hiệu "bảng tin Mạng nội bộ có thay đổi" (`social.feed.changed`).
 *
 * Sinh từ sự kiện outbox của phân hệ social, không gọi trực tiếp. Tín hiệu chỉ mang id: người nhận gọi
 * lại API (có kiểm quyền nhìn thấy bài) để lấy nội dung, nên nội dung bài nhóm riêng tư không đi qua
 * broker. Hình dạng `SocialFeedSignal` giống hệt `SocialFeedSignal` của contracts-social (hai gói không
 * phụ thuộc nhau nên khai lại ở đây).
 *
 * Phạm vi gửi:
 * - Bài Tường công ty: mọi phiên của công ty (phòng của tenant).
 * - Bài nhóm: chỉ phòng của nhóm (`socialGroupRoom`). Chỉ thành viên được vào phòng đó, nên nhóm
 *   riêng tư không lộ cho người ngoài.
 */

/** Loại sự kiện outbox của social mà realtime-api phải nghe (khớp `SOCIAL_EVENT_TYPES` của contracts-social). */
export const SOCIAL_FEED_SOURCE_EVENT_TYPES = [
  'social.post.published',
  'social.post.changed',
  'social.comment.created',
  'social.reaction.changed',
  'social.poll.changed',
] as const;

export type SocialFeedSourceEventType = (typeof SOCIAL_FEED_SOURCE_EVENT_TYPES)[number];

export const SOCIAL_FEED_CHANGE_KINDS = [
  'post.created',
  'post.updated',
  'post.deleted',
  'comment.changed',
  'reaction.changed',
  'poll.changed',
] as const;

export interface SocialFeedSignalData {
  readonly change: (typeof SOCIAL_FEED_CHANGE_KINDS)[number];
  readonly postId: string;
  /** Thiếu là bài Tường công ty. */
  readonly groupId?: string;
  readonly actorUserId: string;
}

export type SocialFeedAudience =
  | { readonly kind: 'tenant' }
  | { readonly kind: 'group'; readonly groupId: string };

export interface SocialFeedDelivery {
  readonly audience: SocialFeedAudience;
  readonly signal: SocialFeedSignalData;
}

/** Phòng thời gian thực của một nhóm; tenant nằm trong tên phòng nên không lẫn giữa các công ty. */
export function socialGroupRoom(tenantId: string, groupId: string): string {
  return `tenant:${tenantId}:social-group:${groupId}`;
}

/** Client xin vào / rời phòng của một nhóm (sự kiện `social.subscribe` / `social.unsubscribe`). */
export interface SocialRoomMessage {
  readonly groupId: string;
}

const SOURCE_EVENTS: ReadonlySet<string> = new Set(SOCIAL_FEED_SOURCE_EVENT_TYPES);

export function isSocialFeedSourceEvent(type: string): type is SocialFeedSourceEventType {
  return SOURCE_EVENTS.has(type);
}

/**
 * Đổi một sự kiện outbox của social thành tín hiệu realtime. Trả `undefined` khi payload thiếu trường
 * bắt buộc hoặc loại sự kiện không sinh tín hiệu; người gọi coi đó là dữ liệu sai vĩnh viễn.
 *
 * Bình luận mới mang `groupId` (nếu bài thuộc nhóm) để tín hiệu đi đúng phòng. Thiếu `groupId` thì tín
 * hiệu được coi là của Tường công ty, nên bên phát bình luận PHẢI điền `groupId` cho bài nhóm.
 */
export function socialFeedDeliveryFromEvent(type: string, payload: unknown): SocialFeedDelivery | undefined {
  const body = record(payload);
  const postId = text(body?.postId);
  if (!body || !postId || !isSocialFeedSourceEvent(type)) return undefined;
  const groupId = text(body.groupId);
  const audience: SocialFeedAudience = groupId ? { kind: 'group', groupId } : { kind: 'tenant' };
  const base = (change: SocialFeedSignalData['change'], actorUserId: string | undefined) =>
    actorUserId
      ? { audience, signal: { change, postId, ...(groupId ? { groupId } : {}), actorUserId } }
      : undefined;

  switch (type) {
    case 'social.post.published':
      return base('post.created', text(body.authorId));
    case 'social.post.changed':
      return base(body.change === 'deleted' ? 'post.deleted' : 'post.updated', text(body.actorId));
    case 'social.comment.created':
      return base('comment.changed', text(body.authorId));
    case 'social.reaction.changed':
      return base('reaction.changed', text(body.actorId));
    case 'social.poll.changed':
      return base('poll.changed', text(body.actorId));
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
