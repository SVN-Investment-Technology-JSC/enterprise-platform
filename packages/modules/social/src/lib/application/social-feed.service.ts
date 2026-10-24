import type { SocialFeedPage, SocialFeedQuery } from '@enterprise-platform/contracts-social';
import {
  isGlobalGroupAdmin,
  normalizeFeedKind,
  normalizeFeedSource,
} from '../domain/social-group-rules.js';
import { SocialGroupNotFoundError } from '../domain/social-group.error.js';
import { decodeCursor, encodeCursor, isUuid, normalizeLimit } from '../domain/social-rules.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { GroupPostingPort } from './ports/group-posting.port.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { FeedRead, SocialFeedStore } from './social-feed-store.port.js';

/** Số bài ghim tối đa hiện ở đầu trang đầu (cùng giá trị với P1). */
export const SOCIAL_FEED_MAX_PINNED = 20;

/**
 * Bảng tin P2: Tường công ty, bài của các nhóm tôi tham gia, bài của một nhóm. Mọi truy vấn áp luật
 * nhìn thấy bài (`PostVisibilityPort`); `SocialPost` do `PostViewAssembler` dựng. Mọi thành viên tenant
 * dùng được, không cần quyền `social.*`.
 */
export class SocialFeedService {
  constructor(
    private readonly store: SocialFeedStore,
    private readonly visibility: PostVisibilityPort,
    private readonly membership: GroupMembershipPort,
    private readonly assembler: PostViewAssembler,
    /** Đợt 2: kiểm chủ đề thuộc nhóm khi lọc `groupTopicId`. Thiếu thì không lọc theo chủ đề được. */
    private readonly posting?: Pick<GroupPostingPort, 'topicsOfGroup'>,
  ) {}

  /**
   * `GET /feed`: mới nhất trước theo `(publishedAt, id)`; trang đầu mở bằng các bài đang ghim trong
   * phạm vi đang xem. Có `groupId` thì là bảng tin của nhóm đó và bỏ qua `scope`.
   */
  async feed(actor: SocialActor, query: SocialFeedQuery = {}): Promise<SocialFeedPage> {
    const groupId = optionalUuid(query.groupId, 'Mã nhóm');
    if (groupId) await this.requireViewableGroup(actor, groupId);
    const groupTopicId = optionalUuid(query.groupTopicId, 'Chủ đề của nhóm');
    if (groupTopicId) await this.requireTopicOfGroup(actor, groupId, groupTopicId);

    const read: FeedRead = {
      visibility: await this.visibility.scopeFor(actor),
      source: normalizeFeedSource(query.scope),
      ...(groupId ? { groupId } : {}),
      ...optionalFilter('topicId', optionalUuid(query.topicId, 'Chuyên mục')),
      ...optionalFilter('kind', normalizeFeedKind(query.kind)),
      ...optionalFilter('authorId', optionalUuid(query.authorId, 'Tác giả')),
      ...optionalFilter('groupTopicId', groupTopicId),
    };
    return this.readPage(actor, read, query);
  }

  /** `GET /groups/:id/feed`: nhóm riêng tư chỉ thành viên (và quản trị toàn hệ thống) xem; còn lại 404. */
  async groupFeed(
    actor: SocialActor,
    groupId: string,
    query: Pick<SocialFeedQuery, 'cursor' | 'limit' | 'kind' | 'authorId' | 'groupTopicId'> = {},
  ): Promise<SocialFeedPage> {
    if (!isUuid(groupId)) throw new SocialGroupNotFoundError();
    return this.feed(actor, {
      cursor: query.cursor,
      limit: query.limit,
      kind: query.kind,
      authorId: query.authorId,
      groupTopicId: query.groupTopicId,
      groupId,
    });
  }

  /** 400 `VALIDATION` khi lọc theo chủ đề mà không có nhóm, hoặc chủ đề không thuộc nhóm đó. */
  private async requireTopicOfGroup(actor: SocialActor, groupId: string | undefined, topicId: string): Promise<void> {
    if (!groupId) throw new SocialValidationError('Lọc theo chủ đề của nhóm cần chọn nhóm.');
    const topics = await this.posting?.topicsOfGroup(actor.tenantId, groupId, [topicId]);
    if (!topics?.has(topicId.toLowerCase())) {
      throw new SocialValidationError('Chủ đề không thuộc nhóm này.');
    }
  }

  private async readPage(actor: SocialActor, read: FeedRead, query: SocialFeedQuery): Promise<SocialFeedPage> {
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);

    const rows = await this.store.page(actor.tenantId, { ...read, limit: limit + 1, cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const pinned = cursor ? [] : await this.store.pinned(actor.tenantId, read, SOCIAL_FEED_MAX_PINNED);

    const items = await this.assembler.assemble(actor, [...pinned, ...page]);
    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.publishedAt, id: last.id }) } : {}),
    };
  }

  private async requireViewableGroup(actor: SocialActor, groupId: string): Promise<void> {
    const group = await this.membership.getGroup(actor.tenantId, groupId);
    if (!group || group.deleted) throw new SocialGroupNotFoundError();
    if (group.privacy === 'public' || isGlobalGroupAdmin(actor)) return;
    if (!(await this.membership.isMember(actor.tenantId, groupId, actor.userId))) {
      throw new SocialGroupNotFoundError();
    }
  }
}

function optionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isUuid(value)) throw new SocialValidationError(`${label} không hợp lệ.`);
  return value;
}

/** `{}` khi không có giá trị, để không đặt khoá `undefined` vào truy vấn. */
function optionalFilter<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): { [K in TKey]?: TValue } {
  return (value === undefined ? {} : { [key]: value }) as { [K in TKey]?: TValue };
}
