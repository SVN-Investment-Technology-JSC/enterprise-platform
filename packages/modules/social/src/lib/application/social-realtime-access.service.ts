import { isUuid } from '../domain/social-rules.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { SocialActor } from './social-actor.js';

/**
 * Quyền vào phòng thời gian thực của một nhóm: chỉ thành viên của nhóm chưa xoá (kể cả nhóm công khai,
 * vì tín hiệu bài nhóm chỉ đến thành viên). realtime-api gọi bằng cookie của chính người xin vào phòng.
 */
export class SocialRealtimeAccessService {
  constructor(private readonly groups: GroupMembershipPort) {}

  async canJoinGroupRoom(actor: SocialActor, groupId: string): Promise<boolean> {
    if (!isUuid(groupId)) return false;
    return this.groups.isMember(actor.tenantId, groupId, actor.userId);
  }
}
