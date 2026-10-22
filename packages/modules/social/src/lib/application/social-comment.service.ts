import { randomUUID } from 'node:crypto';
import type {
  CreateSocialCommentRequest,
  SocialComment,
  SocialCommentPage,
  UpdateSocialCommentRequest,
} from '@enterprise-platform/contracts-social';
import { mayCommentOnPost, mayEditContent, mayRead } from '../domain/social-principal.js';
import {
  assertReplyTarget,
  decodeCursor,
  encodeCursor,
  mentionIdsInBody,
  mergeMentions,
  normalizeCommentBody,
  normalizeLimit,
  normalizeMentionIds,
  requireUuid,
  toIso,
} from '../domain/social-rules.js';
import {
  SocialCommentNotFoundError,
  SocialForbiddenError,
  SocialPostNotFoundError,
} from '../domain/social.error.js';
import { SocialCommentsDisabledError } from '../domain/social-visibility.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import { canViewPostInScope, type PostVisibilitySubject } from './ports/post-visibility.port.js';
import type { ViewerScopePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { CommentRow, SocialOutboxEvent, SocialStore } from './social-store.port.js';
import { authorNameOf, commentCreatedEvent, knownUserIds, lookupUsers, mentionEvents } from './social-views.js';

/** Cỡ trang bình luận mặc định. */
const COMMENT_PAGE_SIZE = 20;

/**
 * Bình luận: chỉ hai cấp (gốc và trả lời), nội dung văn bản thuần, mention ghi
 * `@[userId]`. Xoá là xoá mềm để giữ chuỗi trả lời.
 */
export class SocialCommentService {
  /**
   * `access` (P2) áp luật nhìn thấy bài: bài nhóm riêng tư chỉ thành viên bình luận được, bài chưa
   * đăng không nhận bình luận. Thiếu `access` thì chạy như P1 (chỉ kiểm bài đã đăng).
   */
  constructor(
    private readonly store: SocialStore,
    private readonly directory: OrganizationDirectory,
    private readonly access?: SocialPostAccess,
    /**
     * Đợt 2: tra phòng ban của người được nhắc để chỉ báo cho người thấy được bài quyền xem hẹp. Thiếu thì
     * chỉ người trong danh sách chia sẻ trực tiếp được coi là thấy (an toàn: không báo nhầm).
     */
    private readonly viewerScopes?: Pick<ViewerScopePort, 'scopesOf'>,
  ) {}

  /**
   * Không có `parentId`: bình luận gốc của bài (cũ trước), kèm `replyCount`.
   * Có `parentId`: các trả lời của bình luận gốc đó.
   */
  async list(
    actor: SocialActor,
    postId: string,
    query: { cursor?: string; limit?: number | string; parentId?: string } = {},
  ): Promise<SocialCommentPage> {
    this.assertRead(actor);
    await this.requirePost(actor, postId);
    const limit = normalizeLimit(query.limit, COMMENT_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);
    const parentId = query.parentId ? requireUuid(query.parentId, 'Mã bình luận') : undefined;
    if (parentId) {
      const parent = await this.store.comments.findById(actor.tenantId, parentId);
      if (!parent || parent.postId !== postId) throw new SocialCommentNotFoundError();
    }

    const rows = await this.store.comments.list(actor.tenantId, { postId, parentId, limit: limit + 1, cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await this.hydrate(actor, page);
    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }

  async create(actor: SocialActor, postId: string, request: CreateSocialCommentRequest): Promise<SocialComment> {
    if (!mayCommentOnPost(actor)) throw new SocialForbiddenError('Bạn không có quyền bình luận.');
    const input = request ?? ({} as CreateSocialCommentRequest);
    const post = this.access
      ? await this.access.requirePublished(actor, postId)
      : await this.requirePost(actor, postId);
    // Đợt 2: bài đã tắt bình luận không nhận bình luận hay trả lời mới (bình luận cũ vẫn sửa, xoá được).
    if ((post as { commentsDisabled?: boolean }).commentsDisabled === true) throw new SocialCommentsDisabledError();
    const body = normalizeCommentBody(input.body);

    let parent: CommentRow | undefined;
    if (input.parentId) {
      parent = await this.store.comments.findById(actor.tenantId, requireUuid(input.parentId, 'Mã bình luận'));
      if (!parent || parent.postId !== postId || parent.deleted) throw new SocialCommentNotFoundError();
      assertReplyTarget(parent);
    }

    const mentionUserIds = await this.onlyThoseWhoCanSee(
      actor,
      post,
      await knownUserIds(
        this.directory,
        actor.tenantId,
        mergeMentions(normalizeMentionIds(input.mentionUserIds), mentionIdsInBody(body)),
      ),
    );
    // Người viết bình luận được trả lời có thể đã mất quyền xem bài (đổi quyền xem sau đó): không báo cho họ.
    const parentAuthorId = parent
      ? (await this.onlyThoseWhoCanSee(actor, post, [parent.authorId]))[0]
      : undefined;
    const commentId = randomUUID();
    const authorName = await authorNameOf(this.directory, actor);
    const events: SocialOutboxEvent[] = [
      withGroup(
        commentCreatedEvent({
          postId,
          commentId,
          postAuthorId: post.authorId,
          parentAuthorId,
          authorId: actor.userId,
          authorName,
          postTitle: post.title,
          mentionedUserIds: mentionUserIds,
        }),
        (post as { groupId?: string }).groupId,
      ),
      ...mentionEvents({ postId, commentId, authorId: actor.userId, authorName, mentionedUserIds: mentionUserIds }),
    ];
    await this.store.comments.insert(actor.tenantId, {
      id: commentId,
      postId,
      parentId: parent?.id,
      authorId: actor.userId,
      body,
      mentionUserIds,
      events,
    });
    return (await this.hydrate(actor, [await this.requireComment(actor, commentId)]))[0];
  }

  async update(actor: SocialActor, commentId: string, request: UpdateSocialCommentRequest): Promise<SocialComment> {
    this.assertRead(actor);
    const row = await this.requireComment(actor, commentId);
    if (row.deleted) throw new SocialCommentNotFoundError();
    if (!mayEditContent(actor, row.authorId)) throw new SocialForbiddenError();
    const input = request ?? ({} as UpdateSocialCommentRequest);
    const body = normalizeCommentBody(input.body);
    const mentionUserIds = await knownUserIds(
      this.directory,
      actor.tenantId,
      mergeMentions(normalizeMentionIds(input.mentionUserIds), mentionIdsInBody(body)),
    );

    // Chỉ người mới được nhắc ở lần sửa này mới nhận sự kiện.
    const before = new Set(
      ((await this.store.comments.mentions(actor.tenantId, [commentId])).get(commentId) ?? []).map((id) =>
        id.toLowerCase(),
      ),
    );
    const events = mentionEvents({
      postId: row.postId,
      commentId,
      authorId: actor.userId,
      authorName: await authorNameOf(this.directory, actor),
      mentionedUserIds: mentionUserIds.filter((id) => !before.has(id.toLowerCase())),
    });
    await this.store.comments.update(actor.tenantId, commentId, { body, mentionUserIds, events });
    return (await this.hydrate(actor, [await this.requireComment(actor, commentId)]))[0];
  }

  async remove(actor: SocialActor, commentId: string): Promise<void> {
    this.assertRead(actor);
    const row = await this.requireComment(actor, commentId);
    if (row.deleted) throw new SocialCommentNotFoundError();
    if (!mayEditContent(actor, row.authorId)) throw new SocialForbiddenError();
    await this.store.comments.softDelete(actor.tenantId, commentId, actor.userId);
  }

  /* ---------------------------------------------------------------- nội bộ */

  /**
   * Chỉ giữ người thấy được bài (đợt 2). Bài Tường công ty công khai và bài nhóm: không đổi (bài nhóm theo
   * thành viên nhóm như đợt 1). Bài quyền hẹp: kiểm bằng cùng luật `canViewPostInScope`.
   */
  private async onlyThoseWhoCanSee(
    actor: SocialActor,
    post: unknown,
    userIds: readonly string[],
  ): Promise<string[]> {
    const subject = post as PostVisibilitySubject;
    const restricted = subject.groupId === undefined && (subject.visibility ?? 'company') !== 'company';
    if (!restricted || userIds.length === 0) return [...userIds];
    const scopes = this.viewerScopes ? await this.viewerScopes.scopesOf(actor.tenantId, userIds) : undefined;
    return userIds.filter((userId) =>
      canViewPostInScope(
        {
          viewerId: userId.toLowerCase(),
          seesAllGroups: false,
          canModerate: false,
          memberGroupIds: [],
          unitIds: scopes?.get(userId.toLowerCase())?.unitIds ?? [],
        },
        subject,
      ),
    );
  }

  private assertRead(actor: SocialActor): void {
    if (!mayRead(actor)) throw new SocialForbiddenError();
  }

  private async requirePost(actor: SocialActor, postId: string) {
    if (this.access) return this.access.requireVisible(actor, postId);
    requireUuid(postId, 'Mã bài viết');
    const post = await this.store.posts.findById(actor.tenantId, postId);
    if (!post) throw new SocialPostNotFoundError();
    return post;
  }

  /** Bình luận phải còn bài viết chưa xoá. */
  private async requireComment(actor: SocialActor, commentId: string): Promise<CommentRow> {
    requireUuid(commentId, 'Mã bình luận');
    const row = await this.store.comments.findById(actor.tenantId, commentId);
    if (!row) throw new SocialCommentNotFoundError();
    await this.requirePost(actor, row.postId);
    return row;
  }

  private async hydrate(actor: SocialActor, rows: readonly CommentRow[]): Promise<SocialComment[]> {
    if (rows.length === 0) return [];
    const mentions = await this.store.comments.mentions(
      actor.tenantId,
      rows.filter((row) => !row.deleted).map((row) => row.id),
    );
    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.authorId);
      for (const id of mentions.get(row.id) ?? []) userIds.add(id);
    }
    const userOf = await lookupUsers(this.directory, actor.tenantId, userIds);

    return rows.map(
      (row): SocialComment => ({
        id: row.id,
        postId: row.postId,
        ...(row.parentId ? { parentId: row.parentId } : {}),
        author: userOf(row.authorId),
        // Bình luận đã xoá giữ chỗ trong chuỗi nhưng không lộ nội dung.
        body: row.deleted ? '' : row.body,
        mentions: row.deleted ? [] : (mentions.get(row.id) ?? []).map(userOf),
        createdAt: toIso(row.createdAt),
        ...(row.editedAt ? { editedAt: toIso(row.editedAt) } : {}),
        deleted: row.deleted,
        replyCount: row.replyCount,
        capabilities: {
          canEdit: !row.deleted && mayEditContent(actor, row.authorId),
          canDelete: !row.deleted && mayEditContent(actor, row.authorId),
        },
      }),
    );
  }
}

/** Gắn `groupId` của bài vào sự kiện để realtime chỉ gửi cho thành viên nhóm. */
function withGroup(event: SocialOutboxEvent, groupId: string | undefined): SocialOutboxEvent {
  return groupId ? { ...event, payload: { ...event.payload, groupId } } : event;
}
