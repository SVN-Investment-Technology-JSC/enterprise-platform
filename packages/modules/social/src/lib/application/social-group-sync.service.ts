import {
  SOCIAL_NOTIFY_RECIPIENT_MAX,
  type SetSocialGroupMemberSourcesRequest,
  type SocialGroupDetail,
  type SyncSocialGroupMembersRequest,
  type SyncSocialGroupMembersResponse,
} from '@enterprise-platform/contracts-social';
import { SocialGroupNoMemberSourcesError } from '../domain/social-group.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { OrgStructurePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';
import { actorNameOf, lookupGroupUsers, memberAddedEvent } from './social-group-support.js';
import type { SocialGroupV2Store } from './social-group-v2-store.port.js';
import type { SocialGroupService } from './social-group.service.js';

/** Số người tối đa trả lại trong `added` của một lần đồng bộ (phần còn lại có trong `memberCount`). */
export const SYNC_RESPONSE_ADDED_MAX = 500;

/**
 * Thành viên theo phòng ban/vị trí: đặt nguồn (`PUT member-sources`) và đồng bộ lại
 * (`POST sync-members`). Chỉ admin nhóm (hoặc quản trị toàn hệ thống).
 *
 * Quy tắc an toàn:
 * - Mặc định chỉ THÊM người mới của các nguồn (vai trò `member`, `added_via = sync`).
 * - `prune` chỉ gỡ người `added_via = sync` vai trò `member` không còn thuộc nguồn nào; admin, người
 *   thêm tay, người tự tham gia và người tạo nhóm không bao giờ bị gỡ (store bảo đảm bằng SQL).
 * - Sơ đồ tổ chức trả về rỗng thì KHÔNG gỡ ai: coi là lỗi/đang đổi cấu trúc, tránh xoá cả nhóm.
 * - Không đồng bộ nền tự động; đặt nguồn không tự thêm hay gỡ người.
 */
export class SocialGroupSyncService {
  constructor(
    private readonly v2: SocialGroupV2Store,
    private readonly directory: OrganizationDirectory,
    private readonly org: OrgStructurePort,
    private readonly groups: SocialGroupService,
  ) {}

  /** Thay toàn bộ nguồn; rỗng thì nhóm về `manual`. Không thêm/xoá người. */
  async setSources(
    actor: SocialActor,
    groupId: string,
    request: SetSocialGroupMemberSourcesRequest,
  ): Promise<SocialGroupDetail> {
    const group = await this.groups.requireManageable(actor, groupId);
    const resolved = await this.groups.resolveSources(actor.tenantId, (request ?? { sources: [] }).sources ?? []);
    await this.v2.sources.replace(
      actor.tenantId,
      group.id,
      resolved.map((entry) => entry.insert),
      resolved.length > 0 ? 'org' : 'manual',
    );
    return this.groups.get(actor, group.id);
  }

  async sync(
    actor: SocialActor,
    groupId: string,
    request: SyncSocialGroupMembersRequest,
  ): Promise<SyncSocialGroupMembersResponse> {
    const group = await this.groups.requireManageable(actor, groupId);
    const prune = (request ?? {}).prune === true;
    const sources = group.membershipMode === 'org' ? await this.v2.sources.list(actor.tenantId, group.id) : [];
    if (sources.length === 0) throw new SocialGroupNoMemberSourcesError();

    const expanded = await this.org.memberIdsOf(
      actor.tenantId,
      sources.map((source) => ({ id: source.sourceId, includeDescendants: source.includeDescendants })),
    );
    const desired = [...new Set(expanded.map((id) => id.toLowerCase()))];
    const addedByName = await actorNameOf(this.directory, actor);

    const result = await this.v2.sync.apply(actor.tenantId, {
      groupId: group.id,
      desiredUserIds: desired,
      // Danh sách rỗng gần như chắc chắn là lỗi nguồn dữ liệu: thêm thì vô hại, gỡ thì nguy hiểm.
      prune: prune && desired.length > 0,
      actorId: actor.userId,
      events: (added) =>
        added.length > SOCIAL_NOTIFY_RECIPIENT_MAX
          ? []
          : added.map((userId) =>
              memberAddedEvent({
                groupId: group.id,
                groupName: group.name,
                userId,
                addedBy: actor.userId,
                addedByName,
                via: 'synced',
              }),
            ),
    });
    if (!result) {
      // Nhóm vừa bị xoá giữa chừng.
      await this.groups.requireGroup(actor, groupId);
      throw new SocialGroupNoMemberSourcesError();
    }

    const shown = result.added.slice(0, SYNC_RESPONSE_ADDED_MAX);
    const lookup = await lookupGroupUsers(this.directory, actor.tenantId, shown);
    return {
      added: shown.map(lookup),
      removedCount: result.removedCount,
      memberCount: result.memberCount,
      syncedAt: new Date(result.syncedAt).toISOString(),
    };
  }
}
