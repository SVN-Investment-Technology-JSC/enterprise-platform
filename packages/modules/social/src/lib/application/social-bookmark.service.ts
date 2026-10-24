import type {
  SetSocialBookmarkRequest,
  SocialBookmarkState,
  SocialFeedPage,
} from '@enterprise-platform/contracts-social';
import { decodeCursor, encodeCursor, normalizeLimit } from '../domain/social-rules.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';

export interface SocialBookmarkDeps {
  readonly store: SocialPublishingStore;
  readonly access: SocialPostAccess;
  readonly visibility: PostVisibilityPort;
  readonly assembler: PostViewAssembler;
}

/** Bài đã lưu: lưu/bỏ lưu bài thấy được; danh sách lưu gần nhất trước, bài không còn thấy được bị bỏ. */
export class SocialBookmarkService {
  constructor(private readonly deps: SocialBookmarkDeps) {}

  async set(actor: SocialActor, postId: string, request: SetSocialBookmarkRequest): Promise<SocialBookmarkState> {
    if (typeof request?.bookmarked !== 'boolean') throw new SocialValidationError('Thiếu trạng thái lưu bài.');
    await this.deps.access.requirePublished(actor, postId);
    await this.deps.store.setBookmark(actor.tenantId, postId, actor.userId, request.bookmarked);
    return { bookmarked: request.bookmarked };
  }

  async list(actor: SocialActor, query: { cursor?: string; limit?: number | string } = {}): Promise<SocialFeedPage> {
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const scope = await this.deps.visibility.scopeFor(actor);
    const rows = await this.deps.store.listBookmarks(actor.tenantId, actor.userId, scope, { limit: limit + 1, cursor });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.deps.assembler.assemble(
        actor,
        page.map((entry) => entry.post),
      ),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.bookmarkedAt, id: last.post.id }) } : {}),
    };
  }
}
