import {
  SOCIAL_EVENT_TYPES,
  SOCIAL_NOTIFY_RECIPIENT_MAX,
  type SocialPollChangedPayload,
  type SocialPostChangedPayload,
  type SocialPostModeratedPayload,
  type SocialPostPendingPayload,
  type SocialPostPublishedPayload,
  type SocialReactionChangedPayload,
} from '@enterprise-platform/contracts-social';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import type { SocialOutboxEvent } from './social-store.port.js';
import { UNKNOWN_USER_NAME, mentionEvents } from './social-views.js';

export type PublishOrigin = 'direct' | 'approved' | 'scheduled';

/** Thông tin tối thiểu của bài để dựng sự kiện. */
type EventPost = Pick<
  ExtendedPostRow,
  'id' | 'authorId' | 'title' | 'kind' | 'mentionsAll' | 'groupId' | 'groupName' | 'requiresReadConfirmation' | 'visibility'
>;

function withActor<T extends object>(payload: T, actorUserId: string): Readonly<Record<string, unknown>> {
  return { ...payload, actorUserId };
}

export function postPendingEvent(post: EventPost, authorName: string): SocialOutboxEvent {
  const payload: SocialPostPendingPayload = {
    postId: post.id,
    authorId: post.authorId,
    authorName,
    ...(post.title ? { title: post.title } : {}),
  };
  return {
    type: SOCIAL_EVENT_TYPES.postPending,
    aggregateType: 'social-post',
    aggregateId: post.id,
    payload: withActor(payload, post.authorId),
  };
}

export function postModeratedEvent(
  post: Pick<EventPost, 'id' | 'authorId' | 'title'>,
  moderatorId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): SocialOutboxEvent {
  const payload: SocialPostModeratedPayload = {
    postId: post.id,
    authorId: post.authorId,
    moderatorId,
    decision,
    ...(reason ? { reason } : {}),
    ...(post.title ? { title: post.title } : {}),
  };
  return {
    type: SOCIAL_EVENT_TYPES.postModerated,
    aggregateType: 'social-post',
    aggregateId: post.id,
    payload: withActor(payload, moderatorId),
  };
}

export function postChangedEvent(
  post: Pick<EventPost, 'id' | 'groupId'>,
  change: SocialPostChangedPayload['change'],
  actorId: string,
): SocialOutboxEvent {
  const payload: SocialPostChangedPayload = {
    postId: post.id,
    ...(post.groupId ? { groupId: post.groupId } : {}),
    change,
    actorId,
  };
  return {
    type: SOCIAL_EVENT_TYPES.postChanged,
    aggregateType: 'social-post',
    aggregateId: post.id,
    payload: withActor(payload, actorId),
  };
}

export function reactionChangedEvent(post: Pick<EventPost, 'id' | 'groupId'>, actorId: string): SocialOutboxEvent {
  const payload: SocialReactionChangedPayload = {
    postId: post.id,
    ...(post.groupId ? { groupId: post.groupId } : {}),
    actorId,
  };
  return {
    type: SOCIAL_EVENT_TYPES.reactionChanged,
    aggregateType: 'social-post',
    aggregateId: post.id,
    payload: withActor(payload, actorId),
  };
}

export function pollChangedEvent(
  post: Pick<EventPost, 'id' | 'groupId'>,
  change: SocialPollChangedPayload['change'],
  actorId: string,
): SocialOutboxEvent {
  const payload: SocialPollChangedPayload = {
    postId: post.id,
    ...(post.groupId ? { groupId: post.groupId } : {}),
    actorId,
    change,
  };
  return {
    type: SOCIAL_EVENT_TYPES.pollChanged,
    aggregateType: 'social-post',
    aggregateId: post.id,
    payload: withActor(payload, actorId),
  };
}

/**
 * Dựng sự kiện "bài thực sự được đăng": `social.post.published` kèm thông tin nhóm và người nhận,
 * cùng một sự kiện nhắc tên cho mỗi người được nhắc (trừ tác giả). Dùng khi đăng ngay, duyệt, đến
 * giờ hẹn và đăng lại sau khi bị từ chối, để mọi đường đăng phát đúng cùng một sự kiện.
 */
export class PublishedEventBuilder {
  constructor(
    private readonly directory: OrganizationDirectory,
    private readonly groups: GroupMembershipPort,
    private readonly store: Pick<SocialPublishingStore, 'mentionsOf'>,
  ) {}

  async build(
    tenantId: string,
    post: EventPost,
    origin: PublishOrigin,
    mentionUserIds?: readonly string[],
  ): Promise<SocialOutboxEvent[]> {
    const mentioned = mentionUserIds ?? (await this.store.mentionsOf(tenantId, post.id));
    const authorName = await this.authorName(tenantId, post.authorId);
    const recipients = await this.recipientsOf(tenantId, post);

    const payload: SocialPostPublishedPayload = {
      postId: post.id,
      authorId: post.authorId,
      ...(post.title ? { title: post.title } : {}),
      kind: post.kind,
      mentionsAll: post.mentionsAll,
      authorName,
      ...(mentioned.length ? { mentionedUserIds: mentioned } : {}),
      ...(post.groupId ? { groupId: post.groupId, groupName: post.groupName ?? '' } : {}),
      ...(recipients ? { recipientUserIds: recipients } : {}),
      ...(post.requiresReadConfirmation ? { requiresReadConfirmation: true } : {}),
      // Đợt 2: bài quyền hẹp vẫn phát (realtime cần) nhưng catalog thông báo bỏ qua; thiếu là `company`.
      ...(post.visibility && post.visibility !== 'company' ? { visibility: post.visibility } : {}),
      origin,
    };
    return [
      {
        type: SOCIAL_EVENT_TYPES.postPublished,
        aggregateType: 'social-post',
        aggregateId: post.id,
        payload: withActor(payload, post.authorId),
      },
      ...mentionEvents({ postId: post.id, authorId: post.authorId, authorName, mentionedUserIds: mentioned }),
    ];
  }

  async authorName(tenantId: string, userId: string): Promise<string> {
    const found = (await this.directory.resolve(tenantId, [userId])).get(userId.toLowerCase());
    return found?.name ?? UNKNOWN_USER_NAME;
  }

  /** Tên người thao tác theo danh bạ; thiếu thì dùng tên trong phiên. */
  async actorName(actor: SocialActor): Promise<string> {
    const found = (await this.directory.resolve(actor.tenantId, [actor.userId])).get(actor.userId.toLowerCase());
    return found?.name ?? (actor.displayName || UNKNOWN_USER_NAME);
  }

  /**
   * Bài nhóm có thông báo (thông báo, @all, cần xác nhận đã đọc) gửi cho thành viên trừ tác giả.
   * Bài Tường công ty để `undefined`: người nhận do catalog thông báo tính theo `kind`/`mentionsAll`.
   */
  private async recipientsOf(tenantId: string, post: EventPost): Promise<string[] | undefined> {
    if (!post.groupId) return undefined;
    if (post.kind !== 'announcement' && !post.mentionsAll && !post.requiresReadConfirmation) return undefined;
    const members = await this.groups.listMemberIds(tenantId, post.groupId, SOCIAL_NOTIFY_RECIPIENT_MAX + 1);
    return members
      .filter((id) => id.toLowerCase() !== post.authorId.toLowerCase())
      .slice(0, SOCIAL_NOTIFY_RECIPIENT_MAX);
  }
}
