import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_COMMENT_PAGE_SIZE,
  type CreateSocialCommentRequest,
  type SetSocialReactionRequest,
  type SocialComment,
  type SocialCommentPage,
  type SocialReactionSummary,
  type SocialReactor,
  type UpdateSocialCommentRequest,
} from '@enterprise-platform/contracts-social';
import { mayCommentOnPost, mayEditContent, mayRead, mayWrite } from '../domain/social-principal.js';
import {
  assertAttachmentSet,
  assertAttachmentsPostable,
  assertReplyTarget,
  attachmentRulesFor,
  decodeCursor,
  encodeCursor,
  mentionIdsInBody,
  mergeMentions,
  normalizeCommentBody,
  normalizeLimit,
  normalizeMentionIds,
  normalizeReactionType,
  requireUuid,
  toIso,
} from '../domain/social-rules.js';
import {
  SocialAttachmentUnavailableError,
  SocialCommentNotFoundError,
  SocialForbiddenError,
  SocialPostNotFoundError,
  SocialValidationError,
} from '../domain/social.error.js';
import { SocialCommentsDisabledError } from '../domain/social-visibility.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import { canViewPostInScope, type PostVisibilitySubject } from './ports/post-visibility.port.js';
import type { ViewerScopePort } from './ports/viewer-scope.port.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialCommentAttachmentStore } from './social-comment-attachment-store.port.js';
import type { SocialCommentReactionStore } from './social-comment-reaction-store.port.js';
import { SOCIAL_MAX_REACTORS } from './social-reaction.service.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { AttachmentRow, CommentRow, SocialOutboxEvent, SocialStore } from './social-store.port.js';
import {
  authorNameOf,
  commentCreatedEvent,
  knownUserIds,
  lookupUsers,
  mentionEvents,
  toAttachmentView,
} from './social-views.js';

/** Cỡ trang bình luận mặc định: nhỏ vì bình luận có thể kèm ảnh. */
const COMMENT_PAGE_SIZE = SOCIAL_COMMENT_PAGE_SIZE;

/**
 * Bình luận: chỉ hai cấp (gốc và trả lời), nội dung văn bản thuần, mention ghi
 * `@[userId]`. Xoá là xoá mềm để giữ chuỗi trả lời.
 */
export class SocialCommentService {
  private readonly logger = new Logger(SocialCommentService.name);

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
    /** Phản ứng trên bình luận. Thiếu thì bình luận không có phản ứng (số đếm luôn 0). */
    private readonly reactions?: SocialCommentReactionStore,
    /** Ảnh đính kèm bình luận. Thiếu một trong hai thì bình luận không có tệp (và từ chối `attachmentIds`). */
    private readonly commentAttachments?: SocialCommentAttachmentStore,
    private readonly storage?: AttachmentStorage,
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
    const attachmentIds = this.normalizeAttachmentIds(input.attachmentIds);
    const body = normalizeCommentBody(input.body, { allowEmpty: attachmentIds.length > 0 });
    await this.assertAttachable(actor, attachmentIds);

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
      attachmentIds,
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
    // Danh sách tệp mong muốn: thiếu là giữ nguyên tệp hiện có.
    const current = (await this.commentAttachments?.forComments(actor.tenantId, [commentId]))?.get(commentId) ?? [];
    const desiredIds =
      input.attachmentIds === undefined ? current.map((file) => file.id) : this.normalizeAttachmentIds(input.attachmentIds);
    const body = normalizeCommentBody(input.body, { allowEmpty: desiredIds.length > 0 });
    await this.assertAttachable(actor, desiredIds, commentId);
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
    await this.store.comments.update(actor.tenantId, commentId, {
      body,
      mentionUserIds,
      ...(input.attachmentIds !== undefined ? { attachmentIds: desiredIds, uploaderId: actor.userId } : {}),
      events,
    });
    if (input.attachmentIds !== undefined && this.commentAttachments) {
      // Tệp bị gỡ khỏi bình luận thì xoá khỏi kho ngay.
      await this.deleteFiles(actor.tenantId, await this.commentAttachments.detach(actor.tenantId, commentId, desiredIds));
    }
    return (await this.hydrate(actor, [await this.requireComment(actor, commentId)]))[0];
  }

  /** Đặt, đổi hoặc bỏ (`type: null`) phản ứng của người dùng trên một bình luận chưa xoá. */
  async react(actor: SocialActor, commentId: string, request: SetSocialReactionRequest): Promise<SocialReactionSummary> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền bày tỏ phản ứng.');
    if (!request || !('type' in request)) throw new SocialValidationError('Thiếu loại phản ứng.');
    const type = normalizeReactionType(request.type);
    if (!this.reactions) throw new SocialValidationError('Chưa bật phản ứng trên bình luận.');
    const row = await this.requireComment(actor, commentId);
    if (row.deleted) throw new SocialCommentNotFoundError();
    // Bài phải đã đăng (bài chờ duyệt, hẹn giờ, bị từ chối không nhận phản ứng).
    if (this.access) await this.access.requirePublished(actor, row.postId);

    if (type === null) await this.reactions.remove(actor.tenantId, commentId, actor.userId);
    else await this.reactions.set(actor.tenantId, commentId, actor.userId, type);

    const summary = (await this.reactions.summaries(actor.tenantId, [commentId], actor.userId)).get(commentId);
    return {
      reactionCounts: summary?.counts ?? {},
      reactionTotal: summary?.total ?? 0,
      ...(summary?.mine ? { myReaction: summary.mine } : {}),
    };
  }

  /** Người đã bày tỏ phản ứng trên một bình luận (mới nhất trước), cho người xem được bài. */
  async reactors(actor: SocialActor, commentId: string): Promise<{ items: SocialReactor[] }> {
    this.assertRead(actor);
    if (!this.reactions) return { items: [] };
    const row = await this.requireComment(actor, commentId);
    if (row.deleted) throw new SocialCommentNotFoundError();
    const rows = await this.reactions.list(actor.tenantId, commentId, SOCIAL_MAX_REACTORS);
    const userOf = await lookupUsers(
      this.directory,
      actor.tenantId,
      rows.map((item) => item.userId),
    );
    return {
      items: rows.map((item) => ({
        user: userOf(item.userId),
        type: item.type,
        reactedAt: new Date(item.reactedAt).toISOString(),
      })),
    };
  }

  async remove(actor: SocialActor, commentId: string): Promise<void> {
    this.assertRead(actor);
    const row = await this.requireComment(actor, commentId);
    if (row.deleted) throw new SocialCommentNotFoundError();
    if (!mayEditContent(actor, row.authorId)) throw new SocialForbiddenError();
    await this.store.comments.softDelete(actor.tenantId, commentId, actor.userId);
    // Bình luận xoá thì tệp xoá ngay khỏi kho (không đợi job dọn mồ côi).
    if (this.commentAttachments) {
      await this.deleteFiles(actor.tenantId, await this.commentAttachments.detach(actor.tenantId, commentId, []));
    }
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

  /** Id tệp: không trùng, đúng dạng UUID, không quá số tệp tối đa; chỉ chấp nhận khi đã bật tệp cho bình luận. */
  private normalizeAttachmentIds(ids: readonly string[] | undefined): string[] {
    const unique = [...new Set((ids ?? []).map((id) => requireUuid(id, 'Mã tệp').toLowerCase()))];
    if (unique.length === 0) return [];
    if (!this.commentAttachments || !this.storage) throw new SocialAttachmentUnavailableError();
    if (unique.length > SOCIAL_COMMENT_MAX_ATTACHMENTS) {
      throw new SocialValidationError(`Mỗi bình luận đính kèm tối đa ${SOCIAL_COMMENT_MAX_ATTACHMENTS} tệp.`);
    }
    return unique;
  }

  /**
   * Kiểm trước khi gắn: tệp đã tải xong, của người bình luận (hoặc đã thuộc chính bình luận này), chưa gắn
   * bài hay bình luận khác, và đúng luật của bình luận (ảnh nhỏ hơn, tối đa 1 video tải lên cho bình luận). Video
   * xử lý lỗi thì chưa đăng được (`SOCIAL_VIDEO_FAILED`); đang chờ hay đang xử lý vẫn đăng được. Lỗi chi tiết từng tệp không lộ ra
   * ngoài để khỏi lộ tệp của người khác.
   */
  private async assertAttachable(actor: SocialActor, ids: readonly string[], commentId?: string): Promise<void> {
    if (ids.length === 0) return;
    const rules = attachmentRulesFor('comment');
    const rows: AttachmentRow[] = [];
    for (const id of ids) {
      const row = await this.store.attachments.findById(actor.tenantId, id);
      const owned = row?.commentId !== undefined && row.commentId === commentId;
      const free = row !== undefined && row.commentId === undefined && row.postId === undefined;
      if (
        !row ||
        !row.completed ||
        !(owned || (free && row.uploadedBy === actor.userId)) ||
        !rules.allowedTypes.includes(row.contentType) ||
        row.sizeBytes > rules.maxBytesFor(row.contentType)
      ) {
        throw new SocialAttachmentUnavailableError();
      }
      rows.push(row);
    }
    assertAttachmentsPostable(rows);
    assertAttachmentSet('comment', rows);
  }

  /** Xoá object rồi xoá dòng; object kho từ chối xoá thì giữ dòng (đã mồ côi) để job dọn thử lại. */
  private async deleteFiles(
    tenantId: string,
    rows: readonly {
      readonly id: string;
      readonly storageKey: string;
      readonly posterKey?: string;
      readonly sourceKey?: string;
    }[],
  ): Promise<void> {
    if (rows.length === 0 || !this.storage) return;
    // Video có thêm poster và bản gốc còn sót (chưa kịp xoá sau chuyển mã): xoá hết cùng lúc.
    const keysOf = (row: (typeof rows)[number]) =>
      [row.storageKey, row.posterKey, row.sourceKey].filter((key): key is string => Boolean(key));
    let failed: readonly string[] = [];
    try {
      failed = (await this.storage.deleteObjects(rows.flatMap(keysOf))).failed;
    } catch (error) {
      this.logger.warn(`Không xoá được tệp bình luận của tenant ${tenantId}: ${String(error)}`);
      return;
    }
    if (failed.length > 0) {
      this.logger.warn(`Không xoá được ${failed.length} tệp bình luận của tenant ${tenantId}; job dọn sẽ thử lại.`);
    }
    const stuck = new Set(failed);
    const deletable = rows.filter((row) => !keysOf(row).some((key) => stuck.has(key)));
    if (deletable.length > 0) {
      await this.store.attachments.deleteByIds(
        tenantId,
        deletable.map((row) => row.id),
      );
    }
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
    const files =
      this.commentAttachments && this.storage
        ? await this.commentAttachments.forComments(
            actor.tenantId,
            rows.filter((row) => !row.deleted).map((row) => row.id),
          )
        : undefined;
    const storage = this.storage;
    const attachmentsOf = async (row: CommentRow) =>
      storage && !row.deleted
        ? await Promise.all((files?.get(row.id) ?? []).map((file) => toAttachmentView(storage, file)))
        : [];
    const attachmentViews = new Map(await Promise.all(rows.map(async (row) => [row.id, await attachmentsOf(row)] as const)));
    const reactions = this.reactions
      ? await this.reactions.summaries(
          actor.tenantId,
          rows.filter((row) => !row.deleted).map((row) => row.id),
          actor.userId,
        )
      : undefined;

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
        attachments: attachmentViews.get(row.id) ?? [],
        reactionCounts: reactions?.get(row.id)?.counts ?? {},
        reactionTotal: reactions?.get(row.id)?.total ?? 0,
        ...(reactions?.get(row.id)?.mine ? { myReaction: reactions.get(row.id)?.mine } : {}),
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
