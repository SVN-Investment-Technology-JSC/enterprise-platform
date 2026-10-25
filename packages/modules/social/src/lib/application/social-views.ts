import {
  SOCIAL_EVENT_TYPES,
  SOCIAL_PRESIGNED_URL_TTL_SECONDS,
  SOCIAL_VIDEO_URL_TTL_SECONDS,
  type SocialAttachment,
  type SocialCommentCreatedPayload,
  type SocialMentionPayload,
  type SocialPostKind,
  type SocialPostPublishedPayload,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { isImageContentType, isVideoContentType } from '../domain/social-rules.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { AttachmentRow, SocialOutboxEvent } from './social-store.port.js';

/** Hiển thị khi danh bạ không có người này (đã nghỉ việc hoặc danh bạ tạm lỗi). */
export const UNKNOWN_USER_NAME = 'Người dùng không xác định';

export type UserLookup = (userId: string) => SocialUserRef;

/** Tra danh bạ một lần cho cả nhóm id; id lạ trả về người "không xác định" chứ không lỗi. */
export async function lookupUsers(
  directory: OrganizationDirectory,
  tenantId: string,
  userIds: Iterable<string>,
): Promise<UserLookup> {
  const unique = [...new Set([...userIds].map((id) => id.toLowerCase()))];
  const found = unique.length ? await directory.resolve(tenantId, unique) : new Map<string, SocialUserRef>();
  return (userId) => found.get(userId.toLowerCase()) ?? { id: userId, name: UNKNOWN_USER_NAME };
}

/** Id trong `ids` mà danh bạ biết, giữ thứ tự; dùng để bỏ id lạ khỏi danh sách nhắc tên. */
export async function knownUserIds(
  directory: OrganizationDirectory,
  tenantId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await directory.resolve(tenantId, ids);
  return ids.filter((id) => found.has(id.toLowerCase()));
}

function dimensionsOf(row: AttachmentRow): { width?: number; height?: number } {
  return {
    ...(row.width !== undefined ? { width: row.width } : {}),
    ...(row.height !== undefined ? { height: row.height } : {}),
  };
}

export async function toAttachmentView(
  storage: AttachmentStorage,
  row: AttachmentRow,
): Promise<SocialAttachment> {
  const isImage = isImageContentType(row.contentType);
  const isVideo = isVideoContentType(row.contentType);
  // Video cũ (không cần xử lý) phát được ngay nên coi là `ready`.
  const processingStatus = isVideo ? (row.processingStatus === 'none' ? 'ready' : row.processingStatus) : undefined;
  // Chưa `ready` thì không bao giờ lộ URL: khoá hiện tại còn là bản gốc chưa chuyển mã.
  const downloadable = row.completed && (!isVideo || processingStatus === 'ready');
  const url = downloadable
    ? await storage.createDownloadUrl(
        row.storageKey,
        isVideo ? SOCIAL_VIDEO_URL_TTL_SECONDS : SOCIAL_PRESIGNED_URL_TTL_SECONDS,
        {
          inline: isImage || isVideo,
          contentType: row.contentType,
          fileName: row.fileName,
        },
      )
    : undefined;
  const posterUrl =
    isVideo && processingStatus === 'ready' && row.posterKey
      ? await storage.createDownloadUrl(row.posterKey, SOCIAL_VIDEO_URL_TTL_SECONDS, {
          inline: true,
          contentType: 'image/jpeg',
          fileName: 'poster.jpg',
        })
      : undefined;
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    isImage,
    ...(isVideo ? { isVideo: true } : {}),
    ...(processingStatus ? { processingStatus } : {}),
    ...(isVideo && processingStatus === 'failed' && row.processingError
      ? { processingError: row.processingError }
      : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(isVideo && row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
    ...(isVideo || isImage ? dimensionsOf(row) : {}),
    ...(url ? { url } : {}),
  };
}

/* ------------------------------------------------------------------ sự kiện */

export function postPublishedEvent(input: {
  postId: string;
  authorId: string;
  title?: string;
  kind: SocialPostKind;
  mentionsAll: boolean;
  authorName: string;
  mentionedUserIds: readonly string[];
}): SocialOutboxEvent {
  const payload: SocialPostPublishedPayload & { actorUserId: string } = {
    postId: input.postId,
    authorId: input.authorId,
    ...(input.title ? { title: input.title } : {}),
    kind: input.kind,
    mentionsAll: input.mentionsAll,
    authorName: input.authorName,
    ...(input.mentionedUserIds.length ? { mentionedUserIds: input.mentionedUserIds } : {}),
    actorUserId: input.authorId,
  };
  return {
    type: SOCIAL_EVENT_TYPES.postPublished,
    aggregateType: 'social-post',
    aggregateId: input.postId,
    payload: { ...payload },
  };
}

export function commentCreatedEvent(input: {
  postId: string;
  commentId: string;
  postAuthorId: string;
  parentAuthorId?: string;
  authorId: string;
  authorName: string;
  postTitle?: string;
  mentionedUserIds: readonly string[];
}): SocialOutboxEvent {
  const payload: SocialCommentCreatedPayload & { actorUserId: string } = {
    postId: input.postId,
    commentId: input.commentId,
    postAuthorId: input.postAuthorId,
    ...(input.parentAuthorId ? { parentAuthorId: input.parentAuthorId } : {}),
    authorId: input.authorId,
    authorName: input.authorName,
    ...(input.postTitle ? { postTitle: input.postTitle } : {}),
    ...(input.mentionedUserIds.length ? { mentionedUserIds: input.mentionedUserIds } : {}),
    actorUserId: input.authorId,
  };
  return {
    type: SOCIAL_EVENT_TYPES.commentCreated,
    aggregateType: 'social-comment',
    aggregateId: input.commentId,
    payload: { ...payload },
  };
}

/** Một sự kiện cho mỗi người được nhắc, trừ chính tác giả. */
export function mentionEvents(input: {
  postId: string;
  commentId?: string;
  authorId: string;
  authorName: string;
  mentionedUserIds: readonly string[];
}): SocialOutboxEvent[] {
  return input.mentionedUserIds
    .filter((userId) => userId.toLowerCase() !== input.authorId.toLowerCase())
    .map((mentionedUserId) => {
      const payload: SocialMentionPayload & { actorUserId: string } = {
        postId: input.postId,
        ...(input.commentId ? { commentId: input.commentId } : {}),
        mentionedUserId,
        authorId: input.authorId,
        authorName: input.authorName,
        actorUserId: input.authorId,
      };
      return {
        type: SOCIAL_EVENT_TYPES.mentioned,
        aggregateType: input.commentId ? ('social-comment' as const) : ('social-post' as const),
        aggregateId: input.commentId ?? input.postId,
        payload: { ...payload },
      };
    });
}

/** Tên hiển thị của người thao tác theo danh bạ; thiếu thì dùng tên trong phiên đăng nhập. */
export async function authorNameOf(
  directory: OrganizationDirectory,
  actor: { readonly tenantId: string; readonly userId: string; readonly displayName: string },
): Promise<string> {
  const found = (await directory.resolve(actor.tenantId, [actor.userId])).get(actor.userId.toLowerCase());
  return found?.name ?? (actor.displayName || UNKNOWN_USER_NAME);
}
