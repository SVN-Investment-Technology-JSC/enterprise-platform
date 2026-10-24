import { mayPostToGroup } from '../domain/social-group-rules.js';
import type {
  GroupPostingDecision,
  GroupPostingPort,
  GroupTopicRef,
} from './ports/group-posting.port.js';
import type { SocialGroupV2Store } from './social-group-v2-store.port.js';

/** Quyết định đăng bài từ thông tin nhóm; thuần, dùng chung với test. */
export function decideGroupPosting(
  info: Awaited<ReturnType<SocialGroupV2Store['posting']['info']>>,
): GroupPostingDecision {
  if (!info || info.deleted) return { allowed: false, reason: 'group-missing' };
  if (info.role === undefined) return { allowed: false, reason: 'not-member' };
  const allowed = mayPostToGroup({
    myRole: info.role,
    postPermission: info.postPermission,
    permitted: info.permitted,
  });
  return allowed ? { allowed: true } : { allowed: false, reason: 'restricted' };
}

/**
 * Hiện thực `GroupPostingPort` trên store nhóm đợt 2: thành viên và quyền đăng bài của nhóm
 * (`all`/`admins`/`selected`), cùng tra chủ đề. Không ném lỗi khi không tìm thấy.
 */
export class GroupPostingAdapter implements GroupPostingPort {
  constructor(private readonly store: SocialGroupV2Store) {}

  async canPost(tenantId: string, groupId: string, userId: string): Promise<GroupPostingDecision> {
    return decideGroupPosting(await this.store.posting.info(tenantId, groupId, userId.toLowerCase()));
  }

  async topicsOfGroup(
    tenantId: string,
    groupId: string,
    topicIds: readonly string[],
  ): Promise<ReadonlyMap<string, GroupTopicRef>> {
    return toMap(await this.store.topics.byIds(tenantId, topicIds, groupId));
  }

  async topicRefs(tenantId: string, topicIds: readonly string[]): Promise<ReadonlyMap<string, GroupTopicRef>> {
    return toMap(await this.store.topics.byIds(tenantId, topicIds));
  }
}

function toMap(rows: readonly { readonly id: string; readonly name: string }[]): Map<string, GroupTopicRef> {
  return new Map(rows.map((row) => [row.id.toLowerCase(), { id: row.id, name: row.name }]));
}
