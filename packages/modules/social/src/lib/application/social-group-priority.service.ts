import {
  SOCIAL_GROUP_PRIORITY_MAX,
  type SetSocialGroupPriorityRequest,
  type SocialGroupPriorityState,
} from '@enterprise-platform/contracts-social';
import { SocialGroupNotMemberError } from '../domain/social-group.error.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { SocialActor } from './social-actor.js';
import type { SocialGroupV2Store } from './social-group-v2-store.port.js';
import type { SocialGroupService } from './social-group.service.js';

/**
 * "Ưu tiên lên trên": mỗi người ghim tối đa `SOCIAL_GROUP_PRIORITY_MAX` nhóm của mình; danh sách
 * `GET /groups?scope=mine` đưa nhóm đã ghim lên đầu (ghim mới trước). Chỉ thành viên mới ghim được.
 * Rời nhóm hoặc bị gỡ thì ưu tiên bị xoá ở store thành viên.
 */
export class SocialGroupPriorityService {
  constructor(
    private readonly v2: SocialGroupV2Store,
    private readonly groups: SocialGroupService,
  ) {}

  async set(
    actor: SocialActor,
    groupId: string,
    request: SetSocialGroupPriorityRequest,
  ): Promise<SocialGroupPriorityState> {
    const pinned = (request ?? ({} as SetSocialGroupPriorityRequest)).pinned;
    if (typeof pinned !== 'boolean') throw new SocialValidationError('Hãy chọn ghim hoặc bỏ ghim nhóm.');
    // 404 cho người ngoài nhóm riêng tư (không lộ nhóm), 403 `GROUP_NOT_MEMBER` cho người ngoài nhóm công khai.
    const group = await this.groups.requireFullAccess(actor, groupId);
    if (group.myRole === undefined) throw new SocialGroupNotMemberError('Hãy tham gia nhóm trước khi ưu tiên nhóm.');
    const state = await this.v2.priorities.set(
      actor.tenantId,
      group.id,
      actor.userId.toLowerCase(),
      pinned,
      SOCIAL_GROUP_PRIORITY_MAX,
    );
    return {
      pinned: state.pinned,
      ...(state.pinned && state.pinnedAt ? { pinnedAt: new Date(state.pinnedAt).toISOString() } : {}),
    };
  }
}
