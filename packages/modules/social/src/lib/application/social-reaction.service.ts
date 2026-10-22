import type {
  SetSocialReactionRequest,
  SocialReactionSummary,
  SocialReactor,
} from '@enterprise-platform/contracts-social';
import { mayRead, mayWrite } from '../domain/social-principal.js';
import { normalizeReactionType, requireUuid } from '../domain/social-rules.js';
import { SocialForbiddenError, SocialPostNotFoundError, SocialValidationError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import { reactionChangedEvent } from './social-publishing-events.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import type { SocialStore } from './social-store.port.js';
import { lookupUsers } from './social-views.js';

/** Số người phản ứng tối đa trả về trong danh sách. */
export const SOCIAL_MAX_REACTORS = 200;

/**
 * Phần P2 của phản ứng: luật nhìn thấy bài (`SocialPostAccess`) và sự kiện `social.reaction.changed`
 * ghi cùng transaction. Thiếu thì chạy như P1 (bài đã đăng, không sự kiện).
 */
export interface ReactionPublishing {
  readonly access: SocialPostAccess;
  readonly store: Pick<SocialPublishingStore, 'setReaction'>;
}

/** Phản ứng trên bài: mỗi người một phản ứng, đặt lại là đổi loại, `null` là bỏ. */
export class SocialReactionService {
  constructor(
    private readonly store: SocialStore,
    private readonly directory: OrganizationDirectory,
    private readonly publishing?: ReactionPublishing,
  ) {}

  async set(actor: SocialActor, postId: string, request: SetSocialReactionRequest): Promise<SocialReactionSummary> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền bày tỏ phản ứng.');
    if (!request || !('type' in request)) throw new SocialValidationError('Thiếu loại phản ứng.');
    const type = normalizeReactionType(request.type);
    if (this.publishing) {
      // Bài phải thấy được và đã đăng; bài nhóm riêng tư chỉ thành viên phản ứng được.
      const row = await this.publishing.access.requirePublished(actor, postId);
      await this.publishing.store.setReaction(actor.tenantId, {
        postId,
        userId: actor.userId,
        type,
        events: [reactionChangedEvent(row, actor.userId)],
      });
      return this.summary(actor, postId);
    }
    await this.requirePost(actor, postId);

    if (type === null) await this.store.reactions.remove(actor.tenantId, postId, actor.userId);
    else await this.store.reactions.set(actor.tenantId, postId, actor.userId, type);

    return this.summary(actor, postId);
  }

  async summary(actor: SocialActor, postId: string): Promise<SocialReactionSummary> {
    const row = await this.store.reactions.summary(actor.tenantId, postId, actor.userId);
    return {
      reactionCounts: row.counts,
      reactionTotal: row.total,
      ...(row.mine ? { myReaction: row.mine } : {}),
    };
  }

  async reactors(actor: SocialActor, postId: string): Promise<{ items: SocialReactor[] }> {
    if (!mayRead(actor)) throw new SocialForbiddenError();
    if (this.publishing) await this.publishing.access.requirePublished(actor, postId);
    else await this.requirePost(actor, postId);
    const rows = await this.store.reactions.list(actor.tenantId, postId, SOCIAL_MAX_REACTORS);
    const userOf = await lookupUsers(
      this.directory,
      actor.tenantId,
      rows.map((row) => row.userId),
    );
    return {
      items: rows.map((row) => ({
        user: userOf(row.userId),
        type: row.type,
        reactedAt: new Date(row.reactedAt).toISOString(),
      })),
    };
  }

  private async requirePost(actor: SocialActor, postId: string): Promise<void> {
    requireUuid(postId, 'Mã bài viết');
    if (!(await this.store.posts.findById(actor.tenantId, postId))) throw new SocialPostNotFoundError();
  }
}
