import { randomUUID } from 'node:crypto';
import { htmlToPlainText } from '../domain/html-sanitizer.js';
import {
  SOCIAL_MEDIA_LAYOUT_DEFAULT,
  SOCIAL_POST_KINDS,
  type CreateSocialPostRequest,
  type PinSocialPostRequest,
  type SocialFeedPage,
  type SocialFeedQuery,
  type SocialMediaLayout,
  type SocialPost,
  type UpdateSocialPostRequest,
} from '@enterprise-platform/contracts-social';
import {
  mayCommentOnPost,
  mayEditContent,
  mayModerate,
  mayPinPost,
  mayRead,
  mayWrite,
} from '../domain/social-principal.js';
import {
  decodeCursor,
  encodeCursor,
  normalizeAttachmentIds,
  normalizeBody,
  normalizeKind,
  normalizeLimit,
  normalizeMediaLayout,
  normalizeMentionIds,
  normalizeTitle,
  requireContent,
  requireUuid,
  toIso,
} from '../domain/social-rules.js';
import {
  SocialForbiddenError,
  SocialPostNotFoundError,
  SocialTopicInactiveError,
  SocialTopicNotFoundError,
  SocialValidationError,
} from '../domain/social.error.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import type { FeedFilter, PostRow, SocialOutboxEvent, SocialStore } from './social-store.port.js';
import {
  authorNameOf,
  knownUserIds,
  lookupUsers,
  mentionEvents,
  postPublishedEvent,
  toAttachmentView,
} from './social-views.js';

/** Số bài ghim tối đa hiện ở đầu trang đầu. */
export const SOCIAL_MAX_PINNED_SHOWN = 20;

/**
 * Bảng tin và bài viết: danh sách phân trang theo con trỏ, tạo, sửa, xoá mềm,
 * ghim. Quyền kiểm theo actor ở từng thao tác; `bodyHtml` luôn được làm sạch ở
 * đây trước khi xuống store.
 *
 * P2: lớp này giữ nguyên hành vi P1 (chỉ bài đã đăng, Tường công ty, không nhóm). Đường ghi mới
 * (tạo, sửa, xoá, ghim, chi tiết với nhóm/bình chọn/hẹn giờ/duyệt) nằm ở `SocialPublishingService`;
 * đường đọc bảng tin P2 ở service của BE-2. Khi `social.controller.ts` gỡ các route `posts` cũ, lớp này
 * không còn nơi gọi và có thể xoá cùng spec của nó.
 */
export class SocialPostService {
  constructor(
    private readonly store: SocialStore,
    private readonly directory: OrganizationDirectory,
    private readonly storage: AttachmentStorage,
  ) {}

  /**
   * Bảng tin: mới nhất trước theo `(publishedAt, id)`. Trang đầu (không có con
   * trỏ) mở bằng các bài đang ghim; các trang sau không lặp lại chúng.
   */
  async feed(actor: SocialActor, query: SocialFeedQuery = {}): Promise<SocialFeedPage> {
    this.assertRead(actor);
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const filter = this.filterOf(query);

    const rows = await this.store.posts.feed(actor.tenantId, { ...filter, limit: limit + 1, cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const pinned = cursor ? [] : await this.store.posts.pinned(actor.tenantId, filter, SOCIAL_MAX_PINNED_SHOWN);

    const items = await this.hydrate(actor, [...pinned, ...page]);
    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.publishedAt, id: last.id }) } : {}),
    };
  }

  async get(actor: SocialActor, postId: string): Promise<SocialPost> {
    this.assertRead(actor);
    const row = await this.requirePost(actor, postId);
    return (await this.hydrate(actor, [row]))[0];
  }

  async create(actor: SocialActor, request: CreateSocialPostRequest): Promise<SocialPost> {
    this.assertWrite(actor);
    const input = request ?? ({} as CreateSocialPostRequest);

    const kind = normalizeKind(input.kind);
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.bodyHtml);
    const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const mediaLayout = normalizeMediaLayout(input.mediaLayout);
    requireContent(body, attachmentIds.length);

    const wantsPinned = input.pinned === true;
    const wantsAll = input.mentionsAll === true;
    if ((wantsPinned || wantsAll) && !mayModerate(actor)) {
      throw new SocialForbiddenError('Chỉ người quản lý nội dung mới được ghim bài hoặc nhắc tất cả mọi người.');
    }

    const topicId = await this.validTopic(actor, input.topicId);
    const mentionUserIds = await knownUserIds(
      this.directory,
      actor.tenantId,
      normalizeMentionIds(input.mentionUserIds),
    );

    const postId = randomUUID();
    const authorName = await authorNameOf(this.directory, actor);
    const events: SocialOutboxEvent[] = [
      postPublishedEvent({
        postId,
        authorId: actor.userId,
        title,
        kind,
        mentionsAll: wantsAll,
        authorName,
        mentionedUserIds: mentionUserIds,
      }),
      ...mentionEvents({ postId, authorId: actor.userId, authorName, mentionedUserIds: mentionUserIds }),
    ];
    await this.store.posts.insert(actor.tenantId, {
      id: postId,
      authorId: actor.userId,
      kind,
      title,
      bodyHtml: body.html,
      topicId,
      pinned: wantsPinned,
      mentionsAll: wantsAll,
      ...(mediaLayout ? { mediaLayout } : {}),
      mentionUserIds,
      attachmentIds,
      uploaderId: actor.userId,
      events,
    });
    return this.get(actor, postId);
  }

  async update(actor: SocialActor, postId: string, request: UpdateSocialPostRequest): Promise<SocialPost> {
    this.assertRead(actor);
    const row = await this.requirePost(actor, postId);
    if (!mayEditContent(actor, row.authorId)) throw new SocialForbiddenError();
    const input = request ?? {};

    const patch: {
      title?: string | null;
      bodyHtml?: string;
      topicId?: string | null;
      mentionUserIds?: string[];
      attachmentIds?: string[];
      mediaLayout?: SocialMediaLayout;
    } = {};
    let bodyState = { html: row.bodyHtml, hasText: htmlToPlainText(row.bodyHtml).length > 0 };
    if (input.title !== undefined) patch.title = input.title === null ? null : (normalizeTitle(input.title) ?? null);
    if (input.bodyHtml !== undefined) {
      const body = normalizeBody(input.bodyHtml);
      patch.bodyHtml = body.html;
      bodyState = body;
    }
    if (input.topicId !== undefined) {
      patch.topicId = input.topicId === null ? null : await this.validTopic(actor, input.topicId);
    }
    if (input.attachmentIds !== undefined) patch.attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const mediaLayout = normalizeMediaLayout(input.mediaLayout);
    if (mediaLayout) patch.mediaLayout = mediaLayout;

    const relations = await this.store.posts.relations(actor.tenantId, [postId], actor.userId);
    if (patch.bodyHtml !== undefined || patch.attachmentIds !== undefined) {
      const attachmentCount = patch.attachmentIds?.length ?? relations.attachments.get(postId)?.length ?? 0;
      requireContent(bodyState, attachmentCount);
    }

    const events: SocialOutboxEvent[] = [];
    if (input.mentionUserIds !== undefined) {
      const next = await knownUserIds(this.directory, actor.tenantId, normalizeMentionIds(input.mentionUserIds));
      patch.mentionUserIds = next;
      const before = new Set((relations.mentions.get(postId) ?? []).map((id) => id.toLowerCase()));
      events.push(
        ...mentionEvents({
          postId,
          authorId: actor.userId,
          authorName: await authorNameOf(this.directory, actor),
          mentionedUserIds: next.filter((id) => !before.has(id.toLowerCase())),
        }),
      );
    }

    await this.store.posts.update(actor.tenantId, postId, { ...patch, uploaderId: actor.userId, events });
    return this.get(actor, postId);
  }

  /** Xoá mềm. Bình luận, phản ứng và tệp giữ nguyên trong DB nhưng không còn truy cập được qua bài. */
  async remove(actor: SocialActor, postId: string): Promise<void> {
    this.assertRead(actor);
    const row = await this.requirePost(actor, postId);
    if (!mayEditContent(actor, row.authorId)) throw new SocialForbiddenError();
    await this.store.posts.softDelete(actor.tenantId, postId, actor.userId);
  }

  async setPinned(actor: SocialActor, postId: string, request: PinSocialPostRequest): Promise<SocialPost> {
    this.assertRead(actor);
    if (!mayPinPost(actor)) throw new SocialForbiddenError('Chỉ người quản lý nội dung mới được ghim bài.');
    if (typeof request?.pinned !== 'boolean') throw new SocialValidationError('Thiếu trạng thái ghim.');
    await this.requirePost(actor, postId);
    await this.store.posts.setPinned(actor.tenantId, postId, request.pinned);
    return this.get(actor, postId);
  }

  /* ---------------------------------------------------------------- nội bộ */

  private assertRead(actor: SocialActor): void {
    if (!mayRead(actor)) throw new SocialForbiddenError();
  }

  private assertWrite(actor: SocialActor): void {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền đăng bài.');
  }

  private async requirePost(actor: SocialActor, postId: string): Promise<PostRow> {
    requireUuid(postId, 'Mã bài viết');
    const row = await this.store.posts.findById(actor.tenantId, postId);
    if (!row) throw new SocialPostNotFoundError();
    return row;
  }

  private filterOf(query: SocialFeedQuery): FeedFilter {
    if (query.kind !== undefined && !(SOCIAL_POST_KINDS as readonly string[]).includes(query.kind)) {
      throw new SocialValidationError('Loại bài viết không hợp lệ.');
    }
    return {
      topicId: query.topicId ? requireUuid(query.topicId, 'Mã chuyên mục') : undefined,
      kind: query.kind || undefined,
      authorId: query.authorId ? requireUuid(query.authorId, 'Mã tác giả') : undefined,
    };
  }

  /** Chuyên mục phải có và đang dùng; `undefined` hoặc rỗng là không chọn chuyên mục. */
  private async validTopic(actor: SocialActor, topicId: string | null | undefined): Promise<string | undefined> {
    if (topicId === undefined || topicId === null || topicId === '') return undefined;
    requireUuid(topicId, 'Mã chuyên mục');
    const topic = await this.store.topics.findById(actor.tenantId, topicId);
    if (!topic) throw new SocialTopicNotFoundError();
    if (!topic.isActive) throw new SocialTopicInactiveError();
    return topic.id;
  }

  /** Dựng `SocialPost` cho các dòng: tên người từ danh bạ, tệp ký URL, phản ứng, quyền của người xem. */
  private async hydrate(actor: SocialActor, rows: readonly PostRow[]): Promise<SocialPost[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const relations = await this.store.posts.relations(actor.tenantId, ids, actor.userId);
    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.authorId);
      for (const id of relations.mentions.get(row.id) ?? []) userIds.add(id);
    }
    const userOf = await lookupUsers(this.directory, actor.tenantId, userIds);

    return Promise.all(
      rows.map(async (row): Promise<SocialPost> => {
        const reactions = relations.reactions.get(row.id);
        const attachments = await Promise.all(
          (relations.attachments.get(row.id) ?? []).map((attachment) => toAttachmentView(this.storage, attachment)),
        );
        return {
          id: row.id,
          author: userOf(row.authorId),
          kind: row.kind,
          ...(row.title ? { title: row.title } : {}),
          bodyHtml: row.bodyHtml,
          ...(row.topicId ? { topic: { id: row.topicId, name: row.topicName ?? '' } } : {}),
          pinned: row.pinned,
          attachments,
          mentions: (relations.mentions.get(row.id) ?? []).map(userOf),
          mentionsAll: row.mentionsAll,
          mediaLayout: row.mediaLayout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
          reactionCounts: reactions?.counts ?? {},
          reactionTotal: reactions?.total ?? 0,
          ...(reactions?.mine ? { myReaction: reactions.mine } : {}),
          commentCount: row.commentCount,
          publishedAt: toIso(row.publishedAt),
          ...(row.editedAt ? { editedAt: toIso(row.editedAt) } : {}),
          capabilities: {
            canEdit: mayEditContent(actor, row.authorId),
            canDelete: mayEditContent(actor, row.authorId),
            canPin: mayPinPost(actor),
            canComment: mayCommentOnPost(actor),
          },
        };
      }),
    );
  }
}
