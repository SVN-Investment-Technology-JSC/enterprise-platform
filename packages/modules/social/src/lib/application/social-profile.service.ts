import type { SocialPersonProfile } from '@enterprise-platform/contracts-social';
import { isUuid } from '../domain/social-rules.js';
import { SocialPersonNotFoundError } from '../domain/social-discovery.error.js';
import type { PeopleProfilePort } from './ports/people-profile.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialSearchStore } from './social-search-store.port.js';

/**
 * Trang cá nhân: thông tin lấy từ HRM/Core qua `PeopleProfilePort` (không sao chép vào `social_schema`),
 * cộng số bài người xem thấy được. Bài của người này hiện qua `GET /feed?authorId=&scope=all`.
 */
export class SocialProfileService {
  constructor(
    private readonly people: PeopleProfilePort,
    private readonly visibility: PostVisibilityPort,
    private readonly store: SocialSearchStore,
  ) {}

  async profile(actor: SocialActor, userId: string): Promise<SocialPersonProfile> {
    // Id không phải UUID thì không thể là người nào đó.
    if (!isUuid(userId)) throw new SocialPersonNotFoundError();
    const record = await this.people.profileOf(actor.tenantId, userId);
    if (!record) throw new SocialPersonNotFoundError();

    const isSelf = record.user.id.toLowerCase() === actor.userId.toLowerCase();
    const scope = await this.visibility.scopeFor(actor);
    const [postCount, canOpenInHrm] = await Promise.all([
      this.store.countVisibleAuthorPosts(actor.tenantId, scope, record.user.id),
      this.canOpenInHrm(actor, record.user.id, isSelf),
    ]);

    return {
      user: record.user,
      isSelf,
      ...(record.unitName ? { unitName: record.unitName } : {}),
      ...(record.position ? { position: record.position } : {}),
      ...(record.email ? { email: record.email } : {}),
      ...(record.birthday ? { birthday: record.birthday } : {}),
      ...(record.joinedAt ? { joinedAt: record.joinedAt } : {}),
      postCount,
      canOpenInHrm,
    };
  }

  /** Quản trị tenant và chính chủ luôn mở được; người khác tuỳ HRM. Lỗi HRM thì coi là không. */
  private async canOpenInHrm(actor: SocialActor, targetUserId: string, isSelf: boolean): Promise<boolean> {
    if (isSelf || actor.isTenantAdmin) return true;
    try {
      return await this.people.canOpenInHrm(actor.tenantId, actor.userId, targetUserId);
    } catch {
      return false;
    }
  }
}
