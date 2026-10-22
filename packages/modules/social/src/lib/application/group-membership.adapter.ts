import type { SocialGroupRef } from '@enterprise-platform/contracts-social';
import type {
  GroupAccessInfo,
  GroupMembershipInfo,
  GroupMembershipPort,
} from './ports/group-membership.port.js';
import type { SocialGroupStore } from './social-group-store.port.js';

/** Hiện thực `GroupMembershipPort` trên store nhóm. Không ném lỗi khi không tìm thấy. */
export class GroupMembershipAdapter implements GroupMembershipPort {
  constructor(private readonly store: SocialGroupStore) {}

  async getGroup(tenantId: string, groupId: string): Promise<GroupAccessInfo | undefined> {
    const row = await this.store.groups.find(tenantId, groupId);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      privacy: row.privacy,
      color: row.color,
      icon: row.icon,
      deleted: row.deleted,
    };
  }

  async membershipOf(tenantId: string, groupId: string, userId: string): Promise<GroupMembershipInfo | undefined> {
    const member = await this.store.members.find(tenantId, groupId, userId);
    return member ? { role: member.role, joinedAt: member.joinedAt } : undefined;
  }

  async isMember(tenantId: string, groupId: string, userId: string): Promise<boolean> {
    return (await this.store.members.find(tenantId, groupId, userId)) !== undefined;
  }

  async isAdmin(tenantId: string, groupId: string, userId: string): Promise<boolean> {
    return (await this.store.members.find(tenantId, groupId, userId))?.role === 'admin';
  }

  memberGroupIds(tenantId: string, userId: string): Promise<readonly string[]> {
    return this.store.groups.memberGroupIds(tenantId, userId);
  }

  listMemberIds(tenantId: string, groupId: string, limit?: number): Promise<readonly string[]> {
    return this.store.members.listIds(tenantId, groupId, limit);
  }

  listAdminIds(tenantId: string, groupId: string): Promise<readonly string[]> {
    return this.store.members.listAdminIds(tenantId, groupId);
  }

  async groupRefs(tenantId: string, groupIds: readonly string[]): Promise<ReadonlyMap<string, SocialGroupRef>> {
    const refs = new Map<string, SocialGroupRef>();
    if (groupIds.length === 0) return refs;
    for (const row of await this.store.groups.refs(tenantId, groupIds)) {
      refs.set(row.id, { id: row.id, name: row.name, privacy: row.privacy, color: row.color, icon: row.icon });
    }
    return refs;
  }
}
