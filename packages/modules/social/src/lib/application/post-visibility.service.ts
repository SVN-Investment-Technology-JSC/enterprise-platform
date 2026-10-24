import type { SocialActor } from './social-actor.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import {
  canViewPostInScope,
  type PostVisibilityPort,
  type PostVisibilityScope,
  type PostVisibilitySubject,
} from './ports/post-visibility.port.js';
import type { ViewerScopePort } from './ports/viewer-scope.port.js';
import { mayModerate } from '../domain/social-principal.js';
import { isGlobalGroupAdmin } from '../domain/social-group-rules.js';

/**
 * Hiện thực `PostVisibilityPort`: dựng scope của người xem rồi áp luật thuần `canViewPostInScope`.
 *
 * `unitIds` (phòng ban của người xem, gồm tổ tiên) lấy từ `ViewerScopePort`. Cổng không ném lỗi và trả
 * `unitIds` rỗng khi Tenant Core lỗi; nếu cổng vẫn ném thì ở đây cũng rơi về rỗng, tức là người xem chỉ
 * thấy bài công khai và bài của mình, không bao giờ mở rộng quyền.
 */
export class PostVisibilityService implements PostVisibilityPort {
  constructor(
    private readonly membership: GroupMembershipPort,
    private readonly viewerScopes?: ViewerScopePort,
  ) {}

  async scopeFor(actor: SocialActor): Promise<PostVisibilityScope> {
    const [memberGroupIds, unitIds] = await Promise.all([
      this.membership.memberGroupIds(actor.tenantId, actor.userId),
      this.unitIdsOf(actor),
    ]);
    return {
      viewerId: actor.userId,
      seesAllGroups: isGlobalGroupAdmin(actor),
      canModerate: mayModerate(actor),
      memberGroupIds,
      unitIds,
    };
  }

  async canView(actor: SocialActor, subject: PostVisibilitySubject): Promise<boolean> {
    return canViewPostInScope(await this.scopeFor(actor), subject);
  }

  private async unitIdsOf(actor: SocialActor): Promise<readonly string[]> {
    if (!this.viewerScopes) return [];
    try {
      return (await this.viewerScopes.scopeOf(actor.tenantId, actor.userId)).unitIds;
    } catch {
      return [];
    }
  }
}
