import type {
  RejectSocialPostRequest,
  SocialFeedPage,
  SocialPost,
} from '@enterprise-platform/contracts-social';
import { mayModerate } from '../domain/social-principal.js';
import { normalizeRejectReason } from '../domain/social-publishing-rules.js';
import { decodeCursor, encodeCursor, normalizeLimit } from '../domain/social-rules.js';
import { SocialPostStateError } from '../domain/social-publishing.error.js';
import { SocialForbiddenError } from '../domain/social.error.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import { postModeratedEvent, type PublishedEventBuilder } from './social-publishing-events.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';

export interface SocialModerationDeps {
  readonly store: SocialPublishingStore;
  readonly access: SocialPostAccess;
  readonly visibility: PostVisibilityPort;
  readonly assembler: PostViewAssembler;
  readonly events: PublishedEventBuilder;
}

/** Duyệt và từ chối bài chờ duyệt của Tường công ty (moderator). */
export class SocialModerationService {
  constructor(private readonly deps: SocialModerationDeps) {}

  /** Hàng chờ duyệt: bài `pending`, cũ nhất trước. */
  async listPending(actor: SocialActor, query: { cursor?: string; limit?: number | string } = {}): Promise<SocialFeedPage> {
    this.assertModerator(actor);
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const scope = await this.deps.visibility.scopeFor(actor);
    const rows = await this.deps.store.listPending(actor.tenantId, scope, { limit: limit + 1, cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.deps.assembler.assemble(actor, page),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.publishedAt, id: last.id }) } : {}),
    };
  }

  /** Duyệt: bài thành `published` (`published_at = now()`), phát `moderated` rồi `published` (origin `approved`). */
  async approve(actor: SocialActor, postId: string): Promise<SocialPost> {
    this.assertModerator(actor);
    const row = await this.deps.access.requireVisible(actor, postId);
    if (row.status !== 'pending') throw new SocialPostStateError('Chỉ duyệt được bài đang chờ duyệt.');
    const published = await this.deps.events.build(actor.tenantId, row, 'approved');
    await this.deps.store.transition(actor.tenantId, postId, {
      from: ['pending'],
      to: 'published',
      moderatedBy: actor.userId,
      events: [postModeratedEvent(row, actor.userId, 'approved'), ...published],
    });
    return this.get(actor, postId);
  }

  /** Từ chối kèm lý do bắt buộc. Tác giả sửa bài để gửi duyệt lại. */
  async reject(actor: SocialActor, postId: string, request: RejectSocialPostRequest): Promise<SocialPost> {
    this.assertModerator(actor);
    const reason = normalizeRejectReason(request?.reason);
    const row = await this.deps.access.requireVisible(actor, postId);
    if (row.status !== 'pending') throw new SocialPostStateError('Chỉ từ chối được bài đang chờ duyệt.');
    await this.deps.store.transition(actor.tenantId, postId, {
      from: ['pending'],
      to: 'rejected',
      moderatedBy: actor.userId,
      rejectReason: reason,
      events: [postModeratedEvent(row, actor.userId, 'rejected', reason)],
    });
    return this.get(actor, postId);
  }

  private async get(actor: SocialActor, postId: string): Promise<SocialPost> {
    const row = await this.deps.access.requireVisible(actor, postId);
    return (await this.deps.assembler.assemble(actor, [row]))[0];
  }

  private assertModerator(actor: SocialActor): void {
    if (!mayModerate(actor)) throw new SocialForbiddenError('Chỉ người kiểm duyệt mới duyệt được bài.');
  }
}
