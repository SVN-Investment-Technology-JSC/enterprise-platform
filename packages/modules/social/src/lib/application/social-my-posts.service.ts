import {
  SOCIAL_MY_POST_STATUSES,
  type SocialFeedPage,
  type SocialInboxCounts,
  type SocialMyPostStatus,
} from '@enterprise-platform/contracts-social';
import { mayModerate } from '../domain/social-principal.js';
import { decodeCursor, encodeCursor, normalizeLimit } from '../domain/social-rules.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';

export interface SocialMyPostsDeps {
  readonly store: SocialPublishingStore;
  readonly visibility: PostVisibilityPort;
  readonly assembler: PostViewAssembler;
}

/** Bài chưa đăng của chính mình (chờ duyệt, hẹn giờ, bị từ chối) và số mục chờ xử lý cho điều hướng. */
export class SocialMyPostsService {
  constructor(private readonly deps: SocialMyPostsDeps) {}

  async list(
    actor: SocialActor,
    query: { status?: string; cursor?: string; limit?: number | string },
  ): Promise<SocialFeedPage> {
    const status = query.status;
    if (!status || !(SOCIAL_MY_POST_STATUSES as readonly string[]).includes(status)) {
      throw new SocialValidationError('Trạng thái bài viết không hợp lệ.');
    }
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const scope = await this.deps.visibility.scopeFor(actor);
    const rows = await this.deps.store.listByAuthor(actor.tenantId, actor.userId, status as SocialMyPostStatus, scope, {
      limit: limit + 1,
      cursor,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.deps.assembler.assemble(actor, page),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.publishedAt, id: last.id }) } : {}),
    };
  }

  async inbox(actor: SocialActor): Promise<SocialInboxCounts> {
    const scope = await this.deps.visibility.scopeFor(actor);
    return this.deps.store.counts(actor.tenantId, actor.userId, mayModerate(actor), scope);
  }
}
