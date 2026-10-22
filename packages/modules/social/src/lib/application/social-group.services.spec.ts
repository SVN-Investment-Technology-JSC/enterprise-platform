import { randomUUID } from 'node:crypto';
import {
  SOCIAL_EVENT_TYPES,
  SOCIAL_GROUP_TOPICS_MAX,
  type SocialGroupCoverPreset,
  type SocialGroupMembershipMode,
  type SocialGroupPostPermission,
  type SocialGroupRole,
  type SocialOrgNode,
  type SocialReportTargetSummary,
  type SocialUnitRef,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';
import {
  SocialGroupJoinRequestExistsError,
  SocialGroupLastAdminError,
  SocialGroupNameTakenError,
  SocialGroupPriorityLimitError,
  SocialGroupTopicLimitError,
  SocialGroupTopicNameTakenError,
  SocialReportExistsError,
} from '../domain/social-group.error.js';
import { SocialError } from '../domain/social.error.js';
import { GroupMembershipAdapter } from './group-membership.adapter.js';
import { GroupPostingAdapter } from './group-posting.adapter.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ReportTargetResolverPort, ResolvedReportTarget } from './ports/report-target.port.js';
import type { OrgNodeSelection, OrgStructurePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';
import { SocialGroupMemberService } from './social-group-member.service.js';
import { SocialGroupPriorityService } from './social-group-priority.service.js';
import { SocialGroupSyncService } from './social-group-sync.service.js';
import type {
  GroupMemberAddedVia,
  GroupMemberRow,
  GroupOutboxEvent,
  GroupRow,
  JoinRequestRow,
  SocialGroupStore,
} from './social-group-store.port.js';
import { SocialGroupTopicService } from './social-group-topic.service.js';
import type { GroupSourceRow, SocialGroupV2Store } from './social-group-v2-store.port.js';
import { SocialGroupService } from './social-group.service.js';
import type { ReportInsert, ReportListRead, ReportQueue, ReportRow, SocialReportStore } from './social-report-store.port.js';
import { SocialReportService, inModeratorQueue } from './social-report.service.js';

const TENANT = 'tenant-1';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const DAVE = '44444444-4444-4444-8444-444444444444';
const ERIN = '55555555-5555-4555-8555-555555555555';
const FRANK = '66666666-6666-4666-8666-666666666666';
const GHOST = '99999999-9999-4999-8999-999999999999';

const USERS: Record<string, SocialUserRef> = {
  [ALICE]: { id: ALICE, name: 'Alice Nguyễn' },
  [BOB]: { id: BOB, name: 'Bob Trần' },
  [CAROL]: { id: CAROL, name: 'Carol Lê' },
  [DAVE]: { id: DAVE, name: 'Dave Phạm' },
  [ERIN]: { id: ERIN, name: 'Erin Võ' },
  [FRANK]: { id: FRANK, name: 'Frank Đỗ' },
};

function actor(userId: string, flags: Partial<SocialActor> = {}): SocialActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: USERS[userId]?.name ?? 'Ai đó',
    isTenantAdmin: false,
    canRead: false,
    canWrite: false,
    canModerate: false,
    canManage: false,
    ...flags,
  };
}

const alice = actor(ALICE);
const bob = actor(BOB);
const carol = actor(CAROL);
const dave = actor(DAVE, { canManage: true });
const erin = actor(ERIN);

class FakeDirectory implements OrganizationDirectory {
  async resolve(_tenantId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, SocialUserRef>> {
    const found = new Map<string, SocialUserRef>();
    for (const id of userIds) {
      const user = USERS[id.toLowerCase()];
      if (user) found.set(id.toLowerCase(), user);
    }
    return found;
  }

  async search(_tenantId: string, query: string): Promise<readonly SocialUserRef[]> {
    return Object.values(USERS).filter((user) => user.name.toLowerCase().includes(query.toLowerCase()));
  }
}

interface StoredGroup {
  id: string;
  name: string;
  description?: string;
  descriptionHtml?: string;
  coverPreset?: SocialGroupCoverPreset;
  privacy: 'public' | 'private';
  color: GroupRow['color'];
  icon: GroupRow['icon'];
  createdBy: string;
  createdAt: string;
  deleted: boolean;
  postPermission: SocialGroupPostPermission;
  membershipMode: SocialGroupMembershipMode;
  lastSyncedAt?: string;
}

/** Store trong bộ nhớ, giữ đúng hợp đồng của `SocialGroupStore` (kể cả luật admin cuối cùng). */
class FakeGroupStore implements SocialGroupStore {
  readonly events: GroupOutboxEvent[] = [];
  readonly groupRows = new Map<string, StoredGroup>();
  readonly memberRows = new Map<string, Map<string, GroupMemberRow>>();
  /** groupId -> userId -> cách vào nhóm (`group_members.added_via`). */
  readonly viaRows = new Map<string, Map<string, GroupMemberAddedVia>>();
  readonly permittedRows = new Map<string, Set<string>>();
  /** userId -> groupId -> thời điểm ưu tiên. */
  readonly priorityRows = new Map<string, Map<string, string>>();
  readonly sourceRows = new Map<string, GroupSourceRow[]>();
  private readonly requestRows: { -readonly [K in keyof JoinRequestRow]: JoinRequestRow[K] }[] = [];
  private clock = 0;

  tick(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }

  membersOf(groupId: string): Map<string, GroupMemberRow> {
    let members = this.memberRows.get(groupId);
    if (!members) {
      members = new Map();
      this.memberRows.set(groupId, members);
    }
    return members;
  }

  viaOf(groupId: string): Map<string, GroupMemberAddedVia> {
    let via = this.viaRows.get(groupId);
    if (!via) {
      via = new Map();
      this.viaRows.set(groupId, via);
    }
    return via;
  }

  permittedOf(groupId: string): Set<string> {
    let permitted = this.permittedRows.get(groupId);
    if (!permitted) {
      permitted = new Set();
      this.permittedRows.set(groupId, permitted);
    }
    return permitted;
  }

  prioritiesOf(userId: string): Map<string, string> {
    let priorities = this.priorityRows.get(userId);
    if (!priorities) {
      priorities = new Map();
      this.priorityRows.set(userId, priorities);
    }
    return priorities;
  }

  /** Thêm một thành viên nếu chưa có (như `ON CONFLICT DO NOTHING`); trả `true` khi thực sự thêm. */
  putMember(groupId: string, userId: string, role: SocialGroupRole, via: GroupMemberAddedVia): boolean {
    const members = this.membersOf(groupId);
    if (members.has(userId)) return false;
    members.set(userId, { userId, role, joinedAt: this.tick() });
    this.viaOf(groupId).set(userId, via);
    return true;
  }

  dropMember(groupId: string, userId: string): void {
    this.membersOf(groupId).delete(userId);
    this.viaOf(groupId).delete(userId);
    this.prioritiesOf(userId).delete(groupId);
    this.permittedOf(groupId).delete(userId);
  }

  private toRow(group: StoredGroup, viewerId?: string): GroupRow {
    const members = [...this.membersOf(group.id).values()];
    const mine = viewerId ? this.membersOf(group.id).get(viewerId) : undefined;
    const pending = this.requestRows.filter((request) => request.groupId === group.id && request.status === 'pending');
    const myRequest = pending.find((request) => request.userId === viewerId);
    const priorityAt = viewerId ? this.prioritiesOf(viewerId).get(group.id) : undefined;
    return {
      id: group.id,
      name: group.name,
      ...(group.description ? { description: group.description } : {}),
      ...(group.descriptionHtml ? { descriptionHtml: group.descriptionHtml } : {}),
      ...(group.coverPreset ? { coverPreset: group.coverPreset } : {}),
      privacy: group.privacy,
      color: group.color,
      icon: group.icon,
      createdBy: group.createdBy,
      createdAt: group.createdAt,
      deleted: group.deleted,
      memberCount: members.length,
      adminCount: members.filter((member) => member.role === 'admin').length,
      pendingRequestCount: pending.length,
      ...(mine ? { myRole: mine.role, myJoinedAt: mine.joinedAt } : {}),
      ...(myRequest ? { myPendingRequestId: myRequest.id } : {}),
      postPermission: group.postPermission,
      membershipMode: group.membershipMode,
      ...(group.lastSyncedAt ? { lastSyncedAt: group.lastSyncedAt } : {}),
      ...(priorityAt ? { myPriorityAt: priorityAt } : {}),
      myPostPermitted: viewerId ? this.permittedOf(group.id).has(viewerId) : false,
    };
  }

  readonly groups: SocialGroupStore['groups'] = {
    find: async (_t, groupId, viewerId) => {
      const group = this.groupRows.get(groupId);
      return group ? this.toRow(group, viewerId) : undefined;
    },
    refs: async (_t, ids) =>
      ids.flatMap((id) => {
        const group = this.groupRows.get(id);
        return group && !group.deleted ? [this.toRow(group)] : [];
      }),
    list: async (_t, read) => {
      const visible = [...this.groupRows.values()]
        .filter((group) => !group.deleted)
        .filter((group) => {
          const member = this.membersOf(group.id).has(read.viewerId);
          if (read.scope === 'mine') return member;
          return group.privacy === 'public' || member || read.seesAllGroups;
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (read.scope !== 'mine') return visible.slice(0, read.limit).map((group) => this.toRow(group, read.viewerId));
      const priorities = this.prioritiesOf(read.viewerId);
      const pinned = visible
        .filter((group) => priorities.has(group.id))
        .sort((a, b) => ((priorities.get(a.id) ?? '') < (priorities.get(b.id) ?? '') ? 1 : -1));
      const rest = visible.filter((group) => !priorities.has(group.id)).slice(0, read.limit);
      return [...(read.cursor ? [] : pinned), ...rest].map((group) => this.toRow(group, read.viewerId));
    },
    suggestions: async (_t, viewerId, limit) =>
      [...this.groupRows.values()]
        .filter((group) => !group.deleted && group.privacy === 'public' && !this.membersOf(group.id).has(viewerId))
        .sort(
          (a, b) =>
            this.membersOf(b.id).size - this.membersOf(a.id).size || (a.createdAt < b.createdAt ? 1 : -1),
        )
        .slice(0, limit)
        .map((group) => this.toRow(group, viewerId)),
    memberGroupIds: async (_t, userId) =>
      [...this.groupRows.values()]
        .filter((group) => !group.deleted && this.membersOf(group.id).has(userId))
        .map((group) => group.id),
    insert: async (_t, input) => {
      const taken = [...this.groupRows.values()].some(
        (group) => !group.deleted && group.name.toLowerCase() === input.name.toLowerCase(),
      );
      if (taken) throw new SocialGroupNameTakenError(input.name);
      this.groupRows.set(input.id, {
        id: input.id,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.descriptionHtml ? { descriptionHtml: input.descriptionHtml } : {}),
        ...(input.coverPreset ? { coverPreset: input.coverPreset } : {}),
        privacy: input.privacy,
        color: input.color,
        icon: input.icon,
        createdBy: input.createdBy,
        createdAt: this.tick(),
        deleted: false,
        postPermission: input.postPermission,
        membershipMode: input.membershipMode,
        ...(input.membershipMode === 'org' ? { lastSyncedAt: this.tick() } : {}),
      });
      this.putMember(input.id, input.createdBy, 'admin', 'creator');
      for (const userId of input.adminUserIds) this.putMember(input.id, userId, 'admin', 'manual');
      for (const userId of input.memberUserIds) this.putMember(input.id, userId, 'member', 'manual');
      for (const userId of input.syncedUserIds) this.putMember(input.id, userId, 'member', 'sync');
      this.sourceRows.set(
        input.id,
        input.sources.map((source, index) => ({
          id: `source-${input.id}-${index}`,
          type: source.type,
          sourceId: source.sourceId,
          name: source.name,
          includeDescendants: source.includeDescendants,
        })),
      );
      for (const userId of input.postPermittedUserIds) this.permittedOf(input.id).add(userId);
      this.events.push(...input.events);
    },
    update: async (_t, groupId, patch) => {
      const group = this.groupRows.get(groupId);
      if (!group) return;
      if (patch.name !== undefined) {
        const taken = [...this.groupRows.values()].some(
          (other) => other.id !== groupId && !other.deleted && other.name.toLowerCase() === patch.name?.toLowerCase(),
        );
        if (taken) throw new SocialGroupNameTakenError(patch.name);
        group.name = patch.name;
      }
      if (patch.description !== undefined) group.description = patch.description ?? undefined;
      if (patch.descriptionHtml !== undefined) group.descriptionHtml = patch.descriptionHtml ?? undefined;
      if (patch.coverPreset !== undefined) group.coverPreset = patch.coverPreset ?? undefined;
      if (patch.privacy !== undefined) group.privacy = patch.privacy;
      if (patch.color !== undefined) group.color = patch.color;
      if (patch.icon !== undefined) group.icon = patch.icon;
      if (patch.postPermission !== undefined) group.postPermission = patch.postPermission;
      if (patch.postPermittedUserIds !== undefined) {
        const permitted = this.permittedOf(groupId);
        permitted.clear();
        for (const userId of patch.postPermittedUserIds) {
          if (this.membersOf(groupId).has(userId)) permitted.add(userId);
        }
      }
    },
    softDelete: async (_t, groupId) => {
      const group = this.groupRows.get(groupId);
      if (group) group.deleted = true;
    },
  };

  private adminCount(groupId: string): number {
    return [...this.membersOf(groupId).values()].filter((member) => member.role === 'admin').length;
  }

  readonly members: SocialGroupStore['members'] = {
    find: async (_t, groupId, userId) => {
      const group = this.groupRows.get(groupId);
      return group && !group.deleted ? this.membersOf(groupId).get(userId) : undefined;
    },
    list: async (_t, read) =>
      [...this.membersOf(read.groupId).values()]
        .filter((member) => !read.role || member.role === read.role)
        .filter((member) => !read.userIds || read.userIds.includes(member.userId))
        .slice(0, read.limit),
    listIds: async (_t, groupId, limit) =>
      [...this.membersOf(groupId).values()]
        .sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin'))
        .slice(0, limit)
        .map((member) => member.userId),
    listAdminIds: async (_t, groupId) =>
      [...this.membersOf(groupId).values()].filter((member) => member.role === 'admin').map((member) => member.userId),
    add: async (_t, groupId, userIds, role: SocialGroupRole, addedBy, events, addedVia) => {
      const via = addedVia ?? (addedBy === null ? 'join' : 'manual');
      const inserted = userIds.filter((id) => this.putMember(groupId, id, role, via));
      if (via === 'manual') {
        for (const id of userIds) {
          if (this.viaOf(groupId).get(id) === 'sync') this.viaOf(groupId).set(id, 'manual');
        }
      }
      this.events.push(...events(inserted));
      return [...inserted];
    },
    setRole: async (_t, groupId, userId, role) => {
      const member = this.membersOf(groupId).get(userId);
      if (!member) return false;
      if (member.role === 'admin' && role !== 'admin' && this.adminCount(groupId) <= 1) {
        throw new SocialGroupLastAdminError();
      }
      this.membersOf(groupId).set(userId, { ...member, role });
      if (role === 'admin' && this.viaOf(groupId).get(userId) === 'sync') this.viaOf(groupId).set(userId, 'manual');
      return true;
    },
    remove: async (_t, groupId, userId) => {
      const member = this.membersOf(groupId).get(userId);
      if (!member) return false;
      if (member.role === 'admin' && this.adminCount(groupId) <= 1) throw new SocialGroupLastAdminError();
      this.dropMember(groupId, userId);
      return true;
    },
  };

  readonly requests: SocialGroupStore['requests'] = {
    findPending: async (_t, groupId, userId) =>
      this.requestRows.find((r) => r.groupId === groupId && r.userId === userId && r.status === 'pending'),
    findPendingById: async (_t, groupId, requestId) =>
      this.requestRows.find((r) => r.id === requestId && r.groupId === groupId && r.status === 'pending'),
    create: async (_t, input) => {
      const exists = this.requestRows.some(
        (r) => r.groupId === input.groupId && r.userId === input.userId && r.status === 'pending',
      );
      if (exists) throw new SocialGroupJoinRequestExistsError();
      this.requestRows.push({
        id: input.id,
        groupId: input.groupId,
        userId: input.userId,
        ...(input.message ? { message: input.message } : {}),
        status: 'pending',
        createdAt: this.tick(),
      });
      this.events.push(...input.events);
    },
    cancel: async (_t, groupId, userId) => {
      const request = this.requestRows.find((r) => r.groupId === groupId && r.userId === userId && r.status === 'pending');
      if (!request) return false;
      request.status = 'cancelled';
      return true;
    },
    decide: async (_t, input) => {
      const request = this.requestRows.find(
        (r) => r.id === input.requestId && r.groupId === input.groupId && r.status === 'pending',
      );
      if (!request) return undefined;
      request.status = input.decision;
      this.events.push(...input.events);
      if (input.decision === 'rejected') return {};
      this.putMember(input.groupId, request.userId, 'member', 'join');
      return { member: this.membersOf(input.groupId).get(request.userId) as GroupMemberRow };
    },
    listPending: async (_t, groupId, read) =>
      this.requestRows.filter((r) => r.groupId === groupId && r.status === 'pending').slice(0, read.limit),
    inbox: async (_t, adminUserId, read) =>
      this.requestRows
        .filter((r) => r.status === 'pending' && this.membersOf(r.groupId).get(adminUserId)?.role === 'admin')
        .slice(0, read.limit)
        .map((r) => ({ ...r, groupName: this.groupRows.get(r.groupId)?.name ?? '' })),
    inboxCount: async (_t, adminUserId) =>
      this.requestRows.filter(
        (r) => r.status === 'pending' && this.membersOf(r.groupId).get(adminUserId)?.role === 'admin',
      ).length,
  };
}

/** Store đợt 2 trong bộ nhớ, dùng chung trạng thái thành viên với `FakeGroupStore`. */
class FakeV2Store implements SocialGroupV2Store {
  readonly topicRows: { id: string; groupId: string; name: string; position: number; createdBy: string }[] = [];

  constructor(private readonly base: FakeGroupStore) {}

  readonly posting: SocialGroupV2Store['posting'] = {
    info: async (_t, groupId, userId) => {
      const group = this.base.groupRows.get(groupId);
      if (!group) return undefined;
      const role = this.base.membersOf(groupId).get(userId)?.role;
      return {
        deleted: group.deleted,
        postPermission: group.postPermission,
        ...(role ? { role } : {}),
        permitted: this.base.permittedOf(groupId).has(userId),
      };
    },
    permittedUserIds: async (_t, groupId) =>
      [...this.base.permittedOf(groupId)].filter((id) => this.base.membersOf(groupId).has(id)),
  };

  readonly topics: SocialGroupV2Store['topics'] = {
    list: async (_t, groupId) =>
      this.topicRows
        .filter((topic) => topic.groupId === groupId)
        .sort((a, b) => a.position - b.position)
        .map((topic) => ({ ...topic, postCount: 0 })),
    create: async (_t, input) => {
      const own = this.topicRows.filter((topic) => topic.groupId === input.groupId);
      if (own.length >= SOCIAL_GROUP_TOPICS_MAX) throw new SocialGroupTopicLimitError(SOCIAL_GROUP_TOPICS_MAX);
      if (own.some((topic) => topic.name.toLowerCase() === input.name.toLowerCase())) {
        throw new SocialGroupTopicNameTakenError(input.name);
      }
      const row = { ...input, position: own.length };
      this.topicRows.push(row);
      return { id: row.id, groupId: row.groupId, name: row.name, position: row.position, postCount: 0 };
    },
    update: async (_t, groupId, topicId, patch) => {
      const row = this.topicRows.find((topic) => topic.groupId === groupId && topic.id === topicId);
      if (!row) return undefined;
      if (
        patch.name !== undefined &&
        this.topicRows.some(
          (other) =>
            other.id !== row.id && other.groupId === groupId && other.name.toLowerCase() === patch.name?.toLowerCase(),
        )
      ) {
        throw new SocialGroupTopicNameTakenError(patch.name);
      }
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.position !== undefined) row.position = patch.position;
      return { id: row.id, groupId: row.groupId, name: row.name, position: row.position, postCount: 0 };
    },
    remove: async (_t, groupId, topicId) => {
      const index = this.topicRows.findIndex((topic) => topic.groupId === groupId && topic.id === topicId);
      if (index < 0) return false;
      this.topicRows.splice(index, 1);
      return true;
    },
    byIds: async (_t, topicIds, groupId) =>
      this.topicRows
        .filter((topic) => topicIds.includes(topic.id) && (!groupId || topic.groupId === groupId))
        .filter((topic) => this.base.groupRows.get(topic.groupId)?.deleted === false)
        .map((topic) => ({ id: topic.id, groupId: topic.groupId, name: topic.name })),
  };

  readonly priorities: SocialGroupV2Store['priorities'] = {
    set: async (_t, groupId, userId, pinned, max) => {
      const mine = this.base.prioritiesOf(userId);
      if (!pinned) {
        mine.delete(groupId);
        return { pinned: false };
      }
      const existing = mine.get(groupId);
      if (existing) return { pinned: true, pinnedAt: existing };
      if (mine.size >= max) throw new SocialGroupPriorityLimitError(max);
      const at = this.base.tick();
      mine.set(groupId, at);
      return { pinned: true, pinnedAt: at };
    },
  };

  readonly sources: SocialGroupV2Store['sources'] = {
    list: async (_t, groupId) => [...(this.base.sourceRows.get(groupId) ?? [])],
    replace: async (_t, groupId, sources, mode) => {
      this.base.sourceRows.set(
        groupId,
        sources.map((source, index) => ({
          id: `source-${groupId}-${index}`,
          type: source.type,
          sourceId: source.sourceId,
          name: source.name,
          includeDescendants: source.includeDescendants,
        })),
      );
      const group = this.base.groupRows.get(groupId);
      if (group) group.membershipMode = mode;
    },
  };

  readonly sync: SocialGroupV2Store['sync'] = {
    apply: async (_t, input) => {
      const group = this.base.groupRows.get(input.groupId);
      if (!group || group.deleted) return undefined;
      const added = input.desiredUserIds.filter((id) => this.base.putMember(input.groupId, id, 'member', 'sync'));
      let removedCount = 0;
      if (input.prune) {
        const desired = new Set(input.desiredUserIds);
        for (const [userId, member] of [...this.base.membersOf(input.groupId)]) {
          if (this.base.viaOf(input.groupId).get(userId) === 'sync' && member.role === 'member' && !desired.has(userId)) {
            this.base.dropMember(input.groupId, userId);
            removedCount += 1;
          }
        }
      }
      group.lastSyncedAt = this.base.tick();
      this.base.events.push(...input.events(added));
      return {
        added,
        removedCount,
        memberCount: this.base.membersOf(input.groupId).size,
        syncedAt: group.lastSyncedAt,
      };
    },
  };
}

const UNIT_SALES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNIT_OPS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const POSITION_LEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNIT_UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Sơ đồ tổ chức giả; test đổi `members` để mô phỏng người chuyển phòng. */
class FakeOrg implements OrgStructurePort {
  readonly nodes = new Map<string, { kind: 'unit' | 'position'; name: string; members: string[] }>([
    [UNIT_SALES, { kind: 'unit', name: 'Phòng Kinh doanh', members: [BOB, CAROL] }],
    [UNIT_OPS, { kind: 'unit', name: 'Phòng Vận hành', members: [CAROL, ERIN] }],
    [POSITION_LEAD, { kind: 'position', name: 'Trưởng nhóm', members: [FRANK] }],
  ]);

  async listNodes(): Promise<readonly SocialOrgNode[]> {
    return [];
  }

  async nodeRefs(_tenantId: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, SocialUnitRef>> {
    const found = new Map<string, SocialUnitRef>();
    for (const id of nodeIds) {
      const node = this.nodes.get(id);
      if (node) found.set(id, { id, name: node.name, kind: node.kind });
    }
    return found;
  }

  async memberIdsOf(_tenantId: string, selections: readonly OrgNodeSelection[]): Promise<readonly string[]> {
    return [...new Set(selections.flatMap((selection) => this.nodes.get(selection.id)?.members ?? []))];
  }
}

class FakeReportStore implements SocialReportStore {
  readonly rows: { -readonly [K in keyof ReportRow]: ReportRow[K] }[] = [];

  constructor(private readonly groupsStore: FakeGroupStore) {}

  private withGroup(row: ReportRow): ReportRow {
    const group = row.groupId ? this.groupsStore.groupRows.get(row.groupId) : undefined;
    return {
      ...row,
      ...(group ? { groupPrivacy: group.privacy, groupDeleted: group.deleted } : {}),
    };
  }

  private inQueue(row: ReportRow, queue: ReportQueue): boolean {
    const view = this.withGroup(row);
    if (queue.kind === 'moderator') return inModeratorQueue(view);
    return view.groupId === queue.groupId && view.groupDeleted === false;
  }

  async insert(_tenantId: string, input: ReportInsert): Promise<void> {
    const exists = this.rows.some(
      (row) =>
        row.status === 'open' &&
        row.reporterId === input.reporterId &&
        row.targetType === input.targetType &&
        row.targetId === input.targetId,
    );
    if (exists) throw new SocialReportExistsError();
    this.rows.push({
      id: input.id,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.postId ? { postId: input.postId } : {}),
      reporterId: input.reporterId,
      reason: input.reason,
      status: 'open',
      createdAt: this.groupsStore.tick(),
    });
    this.groupsStore.events.push(...input.events);
  }

  async find(_tenantId: string, reportId: string): Promise<ReportRow | undefined> {
    const row = this.rows.find((candidate) => candidate.id === reportId);
    return row ? this.withGroup(row) : undefined;
  }

  async list(_tenantId: string, read: ReportListRead): Promise<ReportRow[]> {
    return this.rows
      .filter((row) => row.status === read.status && this.inQueue(row, read.queue))
      .filter((row) => !read.targetType || row.targetType === read.targetType)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, read.limit)
      .map((row) => this.withGroup(row));
  }

  async openCount(_tenantId: string, queue: ReportQueue): Promise<number> {
    return this.rows.filter((row) => row.status === 'open' && this.inQueue(row, queue)).length;
  }

  async resolve(
    _tenantId: string,
    input: { reportId: string; status: Exclude<ReportRow['status'], 'open'>; note?: string; handledBy: string },
  ): Promise<ReportRow | undefined> {
    const row = this.rows.find((candidate) => candidate.id === input.reportId && candidate.status === 'open');
    if (!row) return undefined;
    row.status = input.status;
    row.handledBy = input.handledBy;
    row.handledAt = this.groupsStore.tick();
    if (input.note) row.handleNote = input.note;
    return this.withGroup(row);
  }
}

/** Bản giả của cổng tra đối tượng báo cáo (BE-V cấp bản thật). */
class FakeReportTargets implements ReportTargetResolverPort {
  readonly targets = new Map<string, ResolvedReportTarget>();
  /** Người không thấy đối tượng (luật nhìn thấy). */
  readonly blind = new Set<string>();

  add(target: ResolvedReportTarget): void {
    this.targets.set(`${target.targetType}:${target.targetId}`, target);
  }

  async resolveForReporter(
    actorRef: SocialActor,
    targetType: 'post' | 'comment',
    targetId: string,
  ): Promise<ResolvedReportTarget | undefined> {
    if (this.blind.has(actorRef.userId)) return undefined;
    return this.targets.get(`${targetType}:${targetId}`);
  }

  async summariesForHandler(
    _actor: SocialActor,
    targets: readonly { targetType: 'post' | 'comment'; targetId: string }[],
  ): Promise<ReadonlyMap<string, SocialReportTargetSummary>> {
    const found = new Map<string, SocialReportTargetSummary>();
    for (const target of targets) {
      const key = `${target.targetType}:${target.targetId}`;
      const resolved = this.targets.get(key);
      if (resolved) found.set(key, resolved.summary);
    }
    return found;
  }
}

function setup() {
  const store = new FakeGroupStore();
  const directory = new FakeDirectory();
  const org = new FakeOrg();
  const v2 = new FakeV2Store(store);
  const groups = new SocialGroupService(store, directory, org, v2);
  const members = new SocialGroupMemberService(store, directory, groups);
  const topics = new SocialGroupTopicService(v2, groups);
  const priority = new SocialGroupPriorityService(v2, groups);
  const sync = new SocialGroupSyncService(v2, directory, org, groups);
  const reportStore = new FakeReportStore(store);
  const targets = new FakeReportTargets();
  const reports = new SocialReportService(reportStore, store, directory, targets, groups);
  const posting = new GroupPostingAdapter(v2);
  return { store, v2, org, groups, members, topics, priority, sync, reportStore, targets, reports, posting };
}

async function expectError(promise: Promise<unknown>, code: string, statusCode?: number): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SocialError);
  expect((error as SocialError).code).toBe(code);
  if (statusCode !== undefined) expect((error as SocialError).statusCode).toBe(statusCode);
}

describe('SocialGroupService', () => {
  it('người tạo nhóm thành admin, thành viên thêm ngay là member, người lạ bị bỏ qua', async () => {
    const { groups, store } = setup();
    const detail = await groups.create(alice, {
      name: '  Nhóm   Dự án  ',
      privacy: 'public',
      memberUserIds: [BOB, GHOST, ALICE],
    });
    expect(detail.name).toBe('Nhóm Dự án');
    expect(detail.access).toBe('full');
    expect(detail.myMembership?.role).toBe('admin');
    expect(detail.memberCount).toBe(2);
    expect(detail.adminCount).toBe(1);
    expect(detail.capabilities).toMatchObject({ canManage: true, canPost: true, canLeave: false, canJoin: false });
    expect(store.events.map((event) => [event.type, event.payload['userId']])).toEqual([
      [SOCIAL_EVENT_TYPES.groupMemberAdded, BOB],
    ]);
  });

  it('tên nhóm trùng (không phân biệt hoa thường) bị từ chối với 409', async () => {
    const { groups } = setup();
    await groups.create(alice, { name: 'Marketing', privacy: 'public' });
    await expectError(groups.create(bob, { name: 'marketing', privacy: 'private' }), 'GROUP_NAME_TAKEN', 409);
  });

  it('kiểm tra tên, màu và biểu tượng', async () => {
    const { groups } = setup();
    await expectError(groups.create(alice, { name: '   ', privacy: 'public' }), 'VALIDATION');
    await expectError(groups.create(alice, { name: 'A'.repeat(81), privacy: 'public' }), 'VALIDATION');
    await expectError(
      groups.create(alice, { name: 'Nhóm', privacy: 'secret' as unknown as 'public' }),
      'VALIDATION',
    );
    await expectError(
      groups.create(alice, { name: 'Nhóm', privacy: 'public', color: 'pink' as unknown as 'blue' }),
      'VALIDATION',
    );
  });

  it('nhóm riêng tư: người ngoài chỉ nhận bản xem trước, thành viên và quản trị toàn hệ thống thấy đầy đủ', async () => {
    const { groups } = setup();
    const created = await groups.create(alice, {
      name: 'Ban giám đốc',
      description: 'Kín',
      privacy: 'private',
      memberUserIds: [CAROL],
    });

    const preview = await groups.get(bob, created.id);
    expect(preview.access).toBe('preview');
    expect(preview.description).toBeUndefined();
    expect(preview.memberCount).toBe(0);
    expect(preview.memberPreview).toEqual([]);
    expect(preview.capabilities).toMatchObject({ canRequestJoin: true, canJoin: false, canManage: false, canPost: false });

    expect((await groups.get(carol, created.id)).access).toBe('full');
    const asGlobalAdmin = await groups.get(dave, created.id);
    expect(asGlobalAdmin.access).toBe('full');
    expect(asGlobalAdmin.capabilities.canManage).toBe(true);
    expect(asGlobalAdmin.capabilities.canPost).toBe(false);
  });

  it('nhóm không tồn tại, mã sai hoặc đã xoá trả 404', async () => {
    const { groups } = setup();
    const created = await groups.create(alice, { name: 'Tạm', privacy: 'public' });
    await groups.remove(alice, created.id);
    await expectError(groups.get(alice, created.id), 'GROUP_NOT_FOUND', 404);
    await expectError(groups.get(alice, randomUUID()), 'GROUP_NOT_FOUND', 404);
    await expectError(groups.get(alice, 'khong-phai-uuid'), 'GROUP_NOT_FOUND', 404);
  });

  it('danh sách "Tất cả nhóm" không có nhóm riêng tư của người ngoài; quản trị toàn hệ thống thấy hết', async () => {
    const { groups } = setup();
    await groups.create(alice, { name: 'Công khai', privacy: 'public' });
    await groups.create(alice, { name: 'Riêng tư', privacy: 'private' });
    await groups.create(bob, { name: 'Của Bob', privacy: 'private' });

    const names = async (a: SocialActor, scope: 'mine' | 'all') =>
      (await groups.list(a, { scope })).items.map((item) => item.name).sort();
    expect(await names(bob, 'all')).toEqual(['Công khai', 'Của Bob']);
    expect(await names(bob, 'mine')).toEqual(['Của Bob']);
    expect(await names(alice, 'all')).toEqual(['Công khai', 'Riêng tư']);
    expect(await names(dave, 'all')).toEqual(['Công khai', 'Của Bob', 'Riêng tư']);
    expect(await names(dave, 'mine')).toEqual([]);
  });

  it('chỉ admin nhóm hoặc quản trị toàn hệ thống sửa và xoá được', async () => {
    const { groups } = setup();
    const created = await groups.create(alice, { name: 'Nhóm A', privacy: 'public', memberUserIds: [BOB] });
    await expectError(groups.update(bob, created.id, { name: 'Đổi tên' }), 'FORBIDDEN', 403);
    await expectError(groups.remove(bob, created.id), 'FORBIDDEN', 403);
    const updated = await groups.update(alice, created.id, { name: 'Nhóm B', description: null, color: 'red' });
    expect(updated).toMatchObject({ name: 'Nhóm B', color: 'red' });
    await groups.remove(dave, created.id);
    await expectError(groups.get(alice, created.id), 'GROUP_NOT_FOUND');
  });

  it('người ngoài nhóm riêng tư sửa nhóm nhận 404 (không lộ nhóm), không phải 403', async () => {
    const { groups } = setup();
    const created = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    await expectError(groups.update(bob, created.id, { name: 'X' }), 'GROUP_NOT_FOUND', 404);
  });
});

describe('SocialGroupMemberService', () => {
  it('nhóm công khai: vào ngay, vào lần hai bị từ chối', async () => {
    const { groups, members } = setup();
    const created = await groups.create(alice, { name: 'Mở', privacy: 'public' });
    const joined = await members.join(bob, created.id, {});
    expect(joined.result).toBe('joined');
    expect(joined.group.myMembership?.role).toBe('member');
    await expectError(members.join(bob, created.id, {}), 'GROUP_ALREADY_MEMBER', 409);
  });

  it('nhóm riêng tư: tạo yêu cầu, báo admin, không gửi trùng', async () => {
    const { groups, members, store } = setup();
    const created = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    const result = await members.join(bob, created.id, { message: '  Cho tôi vào  ' });
    expect(result.result).toBe('requested');
    expect(result.group.myJoinRequestId).toBeDefined();
    expect(result.group.capabilities.canRequestJoin).toBe(false);

    const requested = store.events.find((event) => event.type === SOCIAL_EVENT_TYPES.groupJoinRequested);
    expect(requested?.payload).toMatchObject({ groupId: created.id, requesterId: BOB, adminUserIds: [ALICE] });
    await expectError(members.join(bob, created.id, {}), 'GROUP_JOIN_REQUEST_EXISTS', 409);

    const listed = await members.listJoinRequests(alice, created.id);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ message: 'Cho tôi vào', status: 'pending', user: { id: BOB } });
  });

  it('admin duyệt: người xin thành thành viên và có hai sự kiện; người xin không duyệt được', async () => {
    const { groups, members, store } = setup();
    const created = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    await members.join(bob, created.id, {});
    const requestId = (await members.listJoinRequests(alice, created.id)).items[0].id;

    await expectError(members.approveJoinRequest(bob, created.id, requestId), 'GROUP_NOT_FOUND', 404);
    const member = await members.approveJoinRequest(alice, created.id, requestId);
    expect(member).toMatchObject({ role: 'member', user: { id: BOB } });
    expect(store.events.slice(-2).map((event) => event.type)).toEqual([
      SOCIAL_EVENT_TYPES.groupMemberAdded,
      SOCIAL_EVENT_TYPES.groupJoinDecided,
    ]);
    expect(store.events.at(-2)?.payload).toMatchObject({ via: 'approved', userId: BOB });
    await expectError(members.approveJoinRequest(alice, created.id, requestId), 'GROUP_JOIN_REQUEST_NOT_FOUND', 404);
    expect((await groups.get(bob, created.id)).access).toBe('full');
  });

  it('admin từ chối: người xin vẫn ở ngoài và có thể gửi lại', async () => {
    const { groups, members, store } = setup();
    const created = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    await members.join(bob, created.id, {});
    const requestId = (await members.listJoinRequests(alice, created.id)).items[0].id;
    await members.rejectJoinRequest(alice, created.id, requestId);
    expect(store.events.at(-1)?.payload).toMatchObject({ decision: 'rejected', requesterId: BOB });
    expect((await groups.get(bob, created.id)).access).toBe('preview');
    expect((await members.join(bob, created.id, {})).result).toBe('requested');
  });

  it('người xin tự huỷ yêu cầu; không có yêu cầu thì 404', async () => {
    const { groups, members } = setup();
    const created = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    await expectError(members.cancelJoinRequest(bob, created.id), 'GROUP_JOIN_REQUEST_NOT_FOUND', 404);
    await members.join(bob, created.id, {});
    await members.cancelJoinRequest(bob, created.id);
    expect((await members.listJoinRequests(alice, created.id)).items).toEqual([]);
  });

  it('hộp thư yêu cầu chỉ có nhóm tôi là admin, kèm tổng số', async () => {
    const { groups, members } = setup();
    const mine = await groups.create(alice, { name: 'Của Alice', privacy: 'private' });
    const other = await groups.create(carol, { name: 'Của Carol', privacy: 'private' });
    await members.join(bob, mine.id, {});
    await members.join(bob, other.id, {});
    const inbox = await members.joinRequestInbox(alice);
    expect(inbox.totalCount).toBe(1);
    expect(inbox.items[0]).toMatchObject({ group: { id: mine.id, name: 'Của Alice' }, user: { id: BOB } });
    expect((await members.joinRequestInbox(bob)).totalCount).toBe(0);
  });

  it('admin cuối cùng không rời, không bị gỡ, không bị hạ vai trò', async () => {
    const { groups, members } = setup();
    const created = await groups.create(alice, { name: 'Nhóm', privacy: 'public', memberUserIds: [BOB] });
    await expectError(members.leave(alice, created.id), 'GROUP_LAST_ADMIN', 409);
    await expectError(members.remove(alice, created.id, ALICE), 'GROUP_LAST_ADMIN', 409);
    await expectError(members.setRole(alice, created.id, ALICE, { role: 'member' }), 'GROUP_LAST_ADMIN', 409);
    await expectError(members.remove(dave, created.id, ALICE), 'GROUP_LAST_ADMIN', 409);

    // Có admin thứ hai thì admin đầu rời được.
    expect(await members.setRole(alice, created.id, BOB, { role: 'admin' })).toMatchObject({ role: 'admin' });
    await members.leave(alice, created.id);
    expect((await groups.get(bob, created.id)).adminCount).toBe(1);
    await expectError(members.leave(bob, created.id), 'GROUP_LAST_ADMIN', 409);
  });

  it('thành viên thường rời được; người ngoài rời nhận 403', async () => {
    const { groups, members } = setup();
    const created = await groups.create(alice, { name: 'Nhóm', privacy: 'public', memberUserIds: [BOB] });
    await members.leave(bob, created.id);
    await expectError(members.leave(bob, created.id), 'GROUP_NOT_MEMBER', 403);
  });

  it('thêm thành viên: bỏ qua người đã có, báo id lạ, phát sự kiện cho người mới; chỉ admin được thêm', async () => {
    const { groups, members, store } = setup();
    const created = await groups.create(alice, { name: 'Nhóm', privacy: 'public', memberUserIds: [BOB] });
    await expectError(members.add(bob, created.id, { userIds: [CAROL] }), 'FORBIDDEN', 403);

    const result = await members.add(alice, created.id, { userIds: [BOB, CAROL, GHOST] });
    expect(result.added.map((user) => user.id)).toEqual([CAROL]);
    expect(result.skippedUnknown).toEqual([GHOST]);
    expect(
      store.events.filter((event) => event.type === SOCIAL_EVENT_TYPES.groupMemberAdded).map((e) => e.payload['userId']),
    ).toEqual([BOB, CAROL]);
    await expectError(members.add(alice, created.id, { userIds: ['abc'] }), 'VALIDATION');
  });

  it('đổi vai trò và gỡ thành viên cần admin; người không phải thành viên trả 404', async () => {
    const { groups, members } = setup();
    const created = await groups.create(alice, { name: 'Nhóm', privacy: 'public', memberUserIds: [BOB] });
    await expectError(members.setRole(bob, created.id, BOB, { role: 'admin' }), 'FORBIDDEN', 403);
    await expectError(members.setRole(alice, created.id, CAROL, { role: 'admin' }), 'GROUP_NOT_MEMBER', 404);
    await expectError(members.setRole(alice, created.id, BOB, { role: 'chief' as SocialGroupRole }), 'VALIDATION');
    await members.remove(alice, created.id, BOB);
    expect((await groups.get(alice, created.id)).memberCount).toBe(1);
  });

  it('danh sách thành viên: thành viên và quản trị toàn hệ thống xem được; người ngoài thì không', async () => {
    const { groups, members } = setup();
    const pub = await groups.create(alice, { name: 'Mở', privacy: 'public', memberUserIds: [BOB] });
    const priv = await groups.create(alice, { name: 'Kín', privacy: 'private' });

    expect((await members.list(bob, pub.id)).items.map((m) => m.user.id).sort()).toEqual([ALICE, BOB].sort());
    expect((await members.list(alice, pub.id, { role: 'admin' })).items.map((m) => m.user.id)).toEqual([ALICE]);
    expect((await members.list(alice, pub.id, { query: 'bob' })).items.map((m) => m.user.id)).toEqual([BOB]);
    expect((await members.list(alice, pub.id, { query: 'khong-ai' })).items).toEqual([]);
    expect((await members.list(dave, priv.id)).items).toHaveLength(1);
    await expectError(members.list(carol, pub.id), 'GROUP_NOT_MEMBER', 403);
    await expectError(members.list(carol, priv.id), 'GROUP_NOT_FOUND', 404);
  });
});

describe('GroupMembershipAdapter', () => {
  it('trả thông tin nhóm, vai trò và danh sách id theo cổng', async () => {
    const { groups, store } = setup();
    const created = await groups.create(alice, { name: 'Nhóm', privacy: 'private', memberUserIds: [BOB] });
    const port = new GroupMembershipAdapter(store);

    expect(await port.getGroup(TENANT, created.id)).toMatchObject({ name: 'Nhóm', privacy: 'private', deleted: false });
    expect(await port.getGroup(TENANT, randomUUID())).toBeUndefined();
    expect(await port.isMember(TENANT, created.id, BOB)).toBe(true);
    expect(await port.isMember(TENANT, created.id, CAROL)).toBe(false);
    expect(await port.isAdmin(TENANT, created.id, ALICE)).toBe(true);
    expect(await port.isAdmin(TENANT, created.id, BOB)).toBe(false);
    expect((await port.membershipOf(TENANT, created.id, BOB))?.role).toBe('member');
    expect(await port.listMemberIds(TENANT, created.id)).toEqual([ALICE, BOB]);
    expect(await port.listAdminIds(TENANT, created.id)).toEqual([ALICE]);
    expect(await port.memberGroupIds(TENANT, BOB)).toEqual([created.id]);
    expect([...(await port.groupRefs(TENANT, [created.id, randomUUID()])).keys()]).toEqual([created.id]);

    await groups.remove(alice, created.id);
    expect((await port.getGroup(TENANT, created.id))?.deleted).toBe(true);
    expect(await port.isMember(TENANT, created.id, BOB)).toBe(false);
    expect(await port.memberGroupIds(TENANT, BOB)).toEqual([]);
    expect((await port.groupRefs(TENANT, [created.id])).size).toBe(0);
  });
});

/* ------------------------------------------------------------------------- đợt 2 */

const mod = actor(DAVE, { canModerate: true });

describe('SocialGroupService đợt 2: tạo và sửa nhóm mở rộng', () => {
  it('mô tả rich text được làm sạch, bản chữ thuần do server suy ra', async () => {
    const { groups } = setup();
    const detail = await groups.create(alice, {
      name: 'Rich',
      privacy: 'public',
      descriptionHtml: '<p>Xin <strong>chào</strong></p><script>alert(1)</script><img src=x onerror=alert(2)>',
      coverPreset: 'ocean',
    });
    expect(detail.descriptionHtml).toContain('<strong>chào</strong>');
    expect(detail.descriptionHtml).not.toMatch(/script|onerror|alert/i);
    expect(detail.description?.startsWith('Xin chào')).toBe(true);
    expect(detail.coverPreset).toBe('ocean');

    const updated = await groups.update(alice, detail.id, { descriptionHtml: null, coverPreset: null });
    expect(updated.descriptionHtml).toBeUndefined();
    expect(updated.description).toBeUndefined();
    expect(updated.coverPreset).toBeUndefined();
  });

  it('mô tả chữ thuần dài bị cắt có dấu "…"; HTML quá dài hoặc ảnh bìa lạ bị từ chối', async () => {
    const { groups } = setup();
    const detail = await groups.create(alice, {
      name: 'Dài',
      privacy: 'public',
      descriptionHtml: `<p>${'a'.repeat(900)}</p>`,
    });
    expect(detail.description).toHaveLength(500);
    expect(detail.description?.endsWith('…')).toBe(true);
    await expectError(
      groups.create(alice, { name: 'Quá dài', privacy: 'public', descriptionHtml: `<p>${'a'.repeat(5_100)}</p>` }),
      'VALIDATION',
    );
    await expectError(
      groups.create(alice, { name: 'Bìa', privacy: 'public', coverPreset: 'khong-co' as unknown as 'ocean' }),
      'VALIDATION',
    );
  });

  it('nhiều quản lý: người thêm là admin, người lạ bị bỏ qua, quá 20 quản lý bị từ chối', async () => {
    const { groups } = setup();
    const detail = await groups.create(alice, {
      name: 'Nhiều quản lý',
      privacy: 'private',
      adminUserIds: [BOB, GHOST, ALICE],
      memberUserIds: [CAROL],
    });
    expect(detail.adminCount).toBe(2);
    expect(detail.capabilities.canLeave).toBe(true);
    const asBob = await groups.get(bob, detail.id);
    expect(asBob.myMembership?.role).toBe('admin');
    expect(asBob.capabilities.canManage).toBe(true);

    const many = Array.from({ length: 20 }, () => randomUUID());
    await expectError(groups.create(alice, { name: 'Quá nhiều', privacy: 'public', adminUserIds: many }), 'VALIDATION');
  });

  it('quyền đăng bài: all, admins, selected; selected rỗng hoặc người ngoài nhóm bị từ chối', async () => {
    const { groups } = setup();
    const created = await groups.create(alice, {
      name: 'Chọn người',
      privacy: 'public',
      memberUserIds: [BOB, CAROL],
      postPermission: 'selected',
      postPermittedUserIds: [BOB],
    });
    expect(created.postPermission).toBe('selected');
    expect(created.postPermittedUsers?.map((user) => user.id)).toEqual([BOB]);
    expect(created.capabilities.canPost).toBe(true);
    expect((await groups.get(bob, created.id)).capabilities.canPost).toBe(true);
    const asCarol = await groups.get(carol, created.id);
    expect(asCarol.capabilities.canPost).toBe(false);
    expect(asCarol.postPermittedUsers).toBeUndefined();

    await expectError(
      groups.create(alice, { name: 'Rỗng', privacy: 'public', postPermission: 'selected' }),
      'VALIDATION',
    );
    await expectError(
      groups.create(alice, {
        name: 'Ngoài nhóm',
        privacy: 'public',
        postPermission: 'selected',
        postPermittedUserIds: [BOB],
      }),
      'VALIDATION',
    );

    const admins = await groups.update(alice, created.id, { postPermission: 'admins' });
    expect(admins.postPermission).toBe('admins');
    expect((await groups.get(bob, created.id)).capabilities.canPost).toBe(false);
    expect(admins.capabilities.canPost).toBe(true);

    await expectError(groups.update(alice, created.id, { postPermission: 'selected', postPermittedUserIds: [] }), 'VALIDATION');
    await expectError(groups.update(alice, created.id, { postPermittedUserIds: [DAVE] }), 'VALIDATION');
    const reselected = await groups.update(alice, created.id, { postPermission: 'selected', postPermittedUserIds: [CAROL] });
    expect(reselected.postPermittedUsers?.map((user) => user.id)).toEqual([CAROL]);
    expect((await groups.get(carol, created.id)).capabilities.canPost).toBe(true);
    expect((await groups.get(bob, created.id)).capabilities.canPost).toBe(false);
  });

  it('tạo nhóm theo phòng ban: thành viên nở lúc tạo, quản lý và người thêm tay không bị đổi vai', async () => {
    const { groups, store } = setup();
    const detail = await groups.create(alice, {
      name: 'Kinh doanh',
      privacy: 'private',
      adminUserIds: [BOB],
      membership: { mode: 'org', sources: [{ type: 'unit', id: UNIT_SALES }, { type: 'position', id: POSITION_LEAD }] },
    });
    expect(detail.membershipMode).toBe('org');
    // ALICE (người tạo), BOB (admin, cũng thuộc phòng), CAROL và FRANK (nở từ nguồn).
    expect(detail.memberCount).toBe(4);
    expect(detail.adminCount).toBe(2);
    expect(detail.memberSources?.map((source) => [source.type, source.sourceId, source.name])).toEqual([
      ['unit', UNIT_SALES, 'Phòng Kinh doanh'],
      ['position', POSITION_LEAD, 'Trưởng nhóm'],
    ]);
    expect(detail.lastSyncedAt).toBeDefined();
    expect(detail.capabilities.canSyncMembers).toBe(true);
    expect(store.viaOf(detail.id).get(ALICE)).toBe('creator');
    expect(store.viaOf(detail.id).get(BOB)).toBe('manual');
    expect(store.viaOf(detail.id).get(CAROL)).toBe('sync');

    const synced = store.events.filter((event) => event.payload['via'] === 'synced').map((event) => event.payload['userId']);
    expect(synced.sort()).toEqual([CAROL, FRANK].sort());
    // Người thường không thấy nguồn thành viên.
    const asCarol = await groups.get(carol, detail.id);
    expect(asCarol.memberSources).toBeUndefined();
    expect(asCarol.capabilities.canSyncMembers).toBe(false);
  });

  it('nguồn không có trong sơ đồ, sai loại, hoặc rỗng bị từ chối', async () => {
    const { groups } = setup();
    await expectError(
      groups.create(alice, { name: 'Lạ', privacy: 'public', membership: { mode: 'org', sources: [{ type: 'unit', id: UNIT_UNKNOWN }] } }),
      'GROUP_SOURCE_UNKNOWN',
      400,
    );
    await expectError(
      groups.create(alice, { name: 'Sai loại', privacy: 'public', membership: { mode: 'org', sources: [{ type: 'position', id: UNIT_SALES }] } }),
      'GROUP_SOURCE_UNKNOWN',
      400,
    );
    await expectError(
      groups.create(alice, { name: 'Rỗng', privacy: 'public', membership: { mode: 'org', sources: [] } }),
      'GROUP_NO_MEMBER_SOURCES',
      400,
    );
  });

  it('theo danh sách người dùng: membership.manual gộp với memberUserIds', async () => {
    const { groups } = setup();
    const detail = await groups.create(alice, {
      name: 'Danh sách',
      privacy: 'public',
      memberUserIds: [BOB],
      membership: { mode: 'manual', userIds: [CAROL, BOB] },
    });
    expect(detail.membershipMode).toBe('manual');
    expect(detail.memberCount).toBe(3);
  });
});

describe('SocialGroupSyncService', () => {
  async function orgGroup() {
    const ctx = setup();
    const detail = await ctx.groups.create(alice, {
      name: 'Phòng Kinh doanh',
      privacy: 'public',
      membership: { mode: 'org', sources: [{ type: 'unit', id: UNIT_SALES }] },
    });
    return { ...ctx, groupId: detail.id };
  }

  it('đồng bộ mặc định chỉ thêm người mới, không gỡ ai và phát sự kiện synced', async () => {
    const { sync, org, store, groupId } = await orgGroup();
    org.nodes.get(UNIT_SALES)?.members.splice(0, 2, ERIN); // BOB, CAROL rời phòng; ERIN vào
    const before = store.events.length;
    const result = await sync.sync(alice, groupId, {});
    expect(result.added.map((user) => user.id)).toEqual([ERIN]);
    expect(result.removedCount).toBe(0);
    expect(result.memberCount).toBe(4);
    expect(store.membersOf(groupId).has(BOB)).toBe(true);
    const fresh = store.events.slice(before);
    expect(fresh.map((event) => [event.type, event.payload['userId'], event.payload['via']])).toEqual([
      [SOCIAL_EVENT_TYPES.groupMemberAdded, ERIN, 'synced'],
    ]);
  });

  it('prune chỉ gỡ người do đồng bộ mang vào: không gỡ admin, người thêm tay, tự tham gia, người tạo', async () => {
    const { sync, members, org, store, groupId } = await orgGroup();
    // ALICE: người tạo. BOB, CAROL: do đồng bộ. DAVE: thêm tay. ERIN: tự tham gia. FRANK: đồng bộ rồi lên admin.
    await members.add(alice, groupId, { userIds: [DAVE] });
    await members.join(actor(ERIN), groupId, {});
    org.nodes.get(UNIT_SALES)?.members.push(FRANK);
    await sync.sync(alice, groupId, {});
    await members.setRole(alice, groupId, FRANK, { role: 'admin' });

    // Cả phòng đổi người: chỉ còn một người khác, nên BOB, CAROL không còn thuộc nguồn nào.
    org.nodes.get(UNIT_SALES)?.members.splice(0, 3, '77777777-7777-4777-8777-777777777777');
    const result = await sync.sync(alice, groupId, { prune: true });
    expect(result.removedCount).toBe(2);
    const left = [...store.membersOf(groupId).keys()];
    expect(left).toEqual(expect.arrayContaining([ALICE, DAVE, ERIN, FRANK]));
    expect(left).not.toContain(BOB);
    expect(left).not.toContain(CAROL);
    expect(store.membersOf(groupId).get(FRANK)?.role).toBe('admin');
  });

  it('người được thêm tay sau khi đã vào do đồng bộ thì từ đó không bị prune gỡ', async () => {
    const { sync, members, org, store, groupId } = await orgGroup();
    await members.add(alice, groupId, { userIds: [CAROL] }); // CAROL đã là thành viên (sync): chuyển sang thêm tay
    org.nodes.get(UNIT_SALES)?.members.splice(0, 2, ERIN);
    await sync.sync(alice, groupId, { prune: true });
    expect(store.membersOf(groupId).has(CAROL)).toBe(true);
    expect(store.membersOf(groupId).has(BOB)).toBe(false);
  });

  it('prune khi sơ đồ trả về rỗng thì không gỡ ai (tránh xoá cả nhóm)', async () => {
    const { sync, org, store, groupId } = await orgGroup();
    org.nodes.get(UNIT_SALES)?.members.splice(0);
    const result = await sync.sync(alice, groupId, { prune: true });
    expect(result.removedCount).toBe(0);
    expect(store.membersOf(groupId).has(BOB)).toBe(true);
    expect(store.membersOf(groupId).has(CAROL)).toBe(true);
  });

  it('chỉ admin nhóm đồng bộ; nhóm thủ công hoặc không còn nguồn thì 400 GROUP_NO_MEMBER_SOURCES', async () => {
    const { groups, sync, groupId } = await orgGroup();
    await expectError(sync.sync(bob, groupId, {}), 'FORBIDDEN', 403);
    const manual = await groups.create(alice, { name: 'Thủ công', privacy: 'public' });
    await expectError(sync.sync(alice, manual.id, {}), 'GROUP_NO_MEMBER_SOURCES', 400);
  });

  it('đặt nguồn thay toàn bộ danh sách và không tự thêm hay gỡ người; rỗng thì về manual', async () => {
    const { groups, sync, store } = setup();
    const manual = await groups.create(alice, { name: 'Sẽ thành org', privacy: 'public' });
    const withSources = await sync.setSources(alice, manual.id, { sources: [{ type: 'unit', id: UNIT_OPS }] });
    expect(withSources.membershipMode).toBe('org');
    expect(withSources.memberSources?.map((source) => source.sourceId)).toEqual([UNIT_OPS]);
    expect(withSources.memberCount).toBe(1);

    await expectError(sync.setSources(alice, manual.id, { sources: [{ type: 'unit', id: UNIT_UNKNOWN }] }), 'GROUP_SOURCE_UNKNOWN', 400);
    await expectError(sync.setSources(bob, manual.id, { sources: [] }), 'FORBIDDEN', 403);

    const result = await sync.sync(alice, manual.id, {});
    expect(result.added.map((user) => user.id).sort()).toEqual([CAROL, ERIN].sort());
    const cleared = await sync.setSources(alice, manual.id, { sources: [] });
    expect(cleared.membershipMode).toBe('manual');
    expect(cleared.memberSources).toBeUndefined();
    expect(store.membersOf(manual.id).size).toBe(3);
  });
});

describe('SocialGroupPriorityService và danh sách nhóm của tôi', () => {
  it('nhóm ưu tiên đứng đầu "nhóm của bạn" (ghim mới trước), bỏ ghim thì về thứ tự cũ', async () => {
    const { groups, priority } = setup();
    const first = await groups.create(alice, { name: 'Một', privacy: 'public' });
    const second = await groups.create(alice, { name: 'Hai', privacy: 'public' });
    const third = await groups.create(alice, { name: 'Ba', privacy: 'public' });
    const names = async () => (await groups.list(alice, { scope: 'mine' })).items.map((item) => item.name);
    expect(await names()).toEqual(['Ba', 'Hai', 'Một']);

    await priority.set(alice, first.id, { pinned: true });
    const pinnedThird = await priority.set(alice, third.id, { pinned: true });
    expect(pinnedThird.pinned).toBe(true);
    expect(pinnedThird.pinnedAt).toBeDefined();
    expect(await names()).toEqual(['Ba', 'Một', 'Hai']);
    const page = await groups.list(alice, { scope: 'mine' });
    expect(page.items[0]?.myPriorityAt).toBeDefined();
    expect(page.items[2]?.myPriorityAt).toBeUndefined();

    // `scope=all` giữ nguyên thứ tự đợt 1.
    expect((await groups.list(alice, { scope: 'all' })).items.map((item) => item.name)).toEqual(['Ba', 'Hai', 'Một']);

    expect(await priority.set(alice, third.id, { pinned: false })).toEqual({ pinned: false });
    expect(await priority.set(alice, third.id, { pinned: false })).toEqual({ pinned: false });
    expect(await names()).toEqual(['Một', 'Ba', 'Hai']);
    expect(second.id).toBeDefined();
  });

  it('ghim lần hai giữ nguyên thời điểm; ưu tiên là riêng từng người', async () => {
    const { groups, priority } = setup();
    const group = await groups.create(alice, { name: 'Chung', privacy: 'public', memberUserIds: [BOB] });
    const once = await priority.set(alice, group.id, { pinned: true });
    const twice = await priority.set(alice, group.id, { pinned: true });
    expect(twice.pinnedAt).toBe(once.pinnedAt);
    expect((await groups.list(bob, { scope: 'mine' })).items[0]?.myPriorityAt).toBeUndefined();
  });

  it('tối đa 10 nhóm ưu tiên: thứ 11 bị 409 GROUP_PRIORITY_LIMIT, bỏ một nhóm thì ghim được lại', async () => {
    const { groups, priority } = setup();
    const created = [];
    for (let index = 0; index < 11; index += 1) {
      created.push(await groups.create(alice, { name: `Nhóm ${index}`, privacy: 'public' }));
    }
    for (const group of created.slice(0, 10)) await priority.set(alice, group.id, { pinned: true });
    await expectError(priority.set(alice, created[10]?.id ?? '', { pinned: true }), 'GROUP_PRIORITY_LIMIT', 409);
    await priority.set(alice, created[0]?.id ?? '', { pinned: false });
    expect((await priority.set(alice, created[10]?.id ?? '', { pinned: true })).pinned).toBe(true);
    // Trang đầu có đủ mười nhóm ưu tiên cộng phần còn lại.
    const page = await groups.list(alice, { scope: 'mine', limit: 1 });
    expect(page.items.filter((item) => item.myPriorityAt)).toHaveLength(10);
  });

  it('chỉ thành viên mới ưu tiên được; người ngoài nhóm riêng tư nhận 404; rời nhóm thì xoá ưu tiên', async () => {
    const { groups, priority, members, store } = setup();
    const open = await groups.create(alice, { name: 'Mở', privacy: 'public', memberUserIds: [BOB] });
    const closed = await groups.create(alice, { name: 'Kín', privacy: 'private' });
    await expectError(priority.set(carol, open.id, { pinned: true }), 'GROUP_NOT_MEMBER', 403);
    await expectError(priority.set(carol, closed.id, { pinned: true }), 'GROUP_NOT_FOUND', 404);
    await expectError(priority.set(bob, open.id, { pinned: 'có' as unknown as boolean }), 'VALIDATION');
    await priority.set(bob, open.id, { pinned: true });
    await members.leave(bob, open.id);
    expect(store.prioritiesOf(BOB).has(open.id)).toBe(false);
  });
});

describe('SocialGroupService.suggestions', () => {
  it('chỉ nhóm công khai tôi chưa tham gia, nhiều thành viên trước, tối đa 10', async () => {
    const { groups } = setup();
    await groups.create(alice, { name: 'Nhỏ', privacy: 'public' });
    await groups.create(alice, { name: 'Lớn', privacy: 'public', memberUserIds: [BOB, CAROL, DAVE] });
    await groups.create(alice, { name: 'Kín', privacy: 'private', memberUserIds: [BOB, CAROL] });
    await groups.create(erin, { name: 'Của Erin', privacy: 'public', memberUserIds: [BOB] });

    const forErin = await groups.suggestions(erin);
    expect(forErin.items.map((item) => item.name)).toEqual(['Lớn', 'Nhỏ']);
    const forBob = await groups.suggestions(bob);
    expect(forBob.items.map((item) => item.name)).toEqual(['Nhỏ']);

    for (let index = 0; index < 12; index += 1) {
      await groups.create(alice, { name: `Thêm ${index}`, privacy: 'public' });
    }
    expect((await groups.suggestions(carol)).items.length).toBeLessThanOrEqual(10);
    expect((await groups.suggestions(carol, 3)).items).toHaveLength(3);
  });
});

describe('SocialGroupTopicService', () => {
  it('admin tạo, sửa, xoá chủ đề; tên trùng không phân biệt hoa thường; tối đa 30', async () => {
    const { groups, topics } = setup();
    const group = await groups.create(alice, { name: 'Có chủ đề', privacy: 'public', memberUserIds: [BOB] });
    const created = await topics.create(alice, group.id, { name: '  Thông báo   chung ' });
    expect(created).toMatchObject({ name: 'Thông báo chung', groupId: group.id, postCount: 0 });
    await expectError(topics.create(alice, group.id, { name: 'THÔNG BÁO CHUNG' }), 'GROUP_TOPIC_NAME_TAKEN', 409);
    await expectError(topics.create(alice, group.id, { name: '   ' }), 'VALIDATION');
    await expectError(topics.create(alice, group.id, { name: 'x'.repeat(61) }), 'VALIDATION');
    await expectError(topics.create(bob, group.id, { name: 'Của Bob' }), 'FORBIDDEN', 403);

    const renamed = await topics.update(alice, group.id, created.id, { name: 'Đổi tên', position: 3 });
    expect(renamed).toMatchObject({ name: 'Đổi tên', position: 3 });
    await expectError(topics.update(alice, group.id, randomUUID(), { name: 'Không có' }), 'GROUP_TOPIC_NOT_FOUND', 404);

    for (let index = 0; index < 29; index += 1) await topics.create(alice, group.id, { name: `Chủ đề ${index}` });
    await expectError(topics.create(alice, group.id, { name: 'Thứ 31' }), 'GROUP_TOPIC_LIMIT', 409);

    expect((await topics.list(bob, group.id)).items).toHaveLength(30);
    await topics.remove(alice, group.id, created.id);
    await expectError(topics.remove(alice, group.id, created.id), 'GROUP_TOPIC_NOT_FOUND', 404);
    expect((await topics.list(alice, group.id)).items).toHaveLength(29);
  });

  it('chủ đề của nhóm khác không sửa hay xoá được; người ngoài nhóm riêng tư nhận 404', async () => {
    const { groups, topics } = setup();
    const one = await groups.create(alice, { name: 'Một', privacy: 'public' });
    const two = await groups.create(alice, { name: 'Hai', privacy: 'private' });
    const topic = await topics.create(alice, one.id, { name: 'Của nhóm một' });
    await expectError(topics.remove(alice, two.id, topic.id), 'GROUP_TOPIC_NOT_FOUND', 404);
    await expectError(topics.update(alice, two.id, topic.id, { name: 'X' }), 'GROUP_TOPIC_NOT_FOUND', 404);
    await expectError(topics.list(bob, two.id), 'GROUP_NOT_FOUND', 404);
    expect((await topics.list(bob, one.id)).items).toHaveLength(1);
  });
});

describe('GroupPostingAdapter', () => {
  it('all: mọi thành viên; admins: chỉ admin; selected: admin và người được chọn', async () => {
    const { groups, posting } = setup();
    const created = await groups.create(alice, {
      name: 'Đăng bài',
      privacy: 'private',
      memberUserIds: [BOB, CAROL],
      adminUserIds: [DAVE],
    });
    const decide = (userId: string) => posting.canPost(TENANT, created.id, userId);
    expect(await decide(BOB)).toEqual({ allowed: true });
    expect(await decide(ERIN)).toEqual({ allowed: false, reason: 'not-member' });
    expect(await decide(randomUUID())).toEqual({ allowed: false, reason: 'not-member' });

    await groups.update(alice, created.id, { postPermission: 'admins' });
    expect(await decide(ALICE)).toEqual({ allowed: true });
    expect(await decide(DAVE)).toEqual({ allowed: true });
    expect(await decide(BOB)).toEqual({ allowed: false, reason: 'restricted' });

    await groups.update(alice, created.id, { postPermission: 'selected', postPermittedUserIds: [CAROL] });
    expect(await decide(CAROL)).toEqual({ allowed: true });
    expect(await decide(BOB)).toEqual({ allowed: false, reason: 'restricted' });
    expect(await decide(ALICE)).toEqual({ allowed: true });
  });

  it('quản trị toàn hệ thống không phải thành viên thì không đăng được; nhóm không có hoặc đã xoá', async () => {
    const { groups, posting } = setup();
    const created = await groups.create(alice, { name: 'Tạm', privacy: 'public' });
    expect(await posting.canPost(TENANT, created.id, DAVE)).toEqual({ allowed: false, reason: 'not-member' });
    expect(await posting.canPost(TENANT, randomUUID(), ALICE)).toEqual({ allowed: false, reason: 'group-missing' });
    await groups.remove(alice, created.id);
    expect(await posting.canPost(TENANT, created.id, ALICE)).toEqual({ allowed: false, reason: 'group-missing' });
  });

  it('gỡ thành viên thì gỡ luôn khỏi danh sách được chọn đăng bài', async () => {
    const { groups, members, posting, store } = setup();
    const created = await groups.create(alice, {
      name: 'Chọn',
      privacy: 'public',
      memberUserIds: [BOB],
      postPermission: 'selected',
      postPermittedUserIds: [BOB],
    });
    expect((await posting.canPost(TENANT, created.id, BOB)).allowed).toBe(true);
    await members.remove(alice, created.id, BOB);
    expect(store.permittedOf(created.id).has(BOB)).toBe(false);
    await members.add(alice, created.id, { userIds: [BOB] });
    // Vào lại không tự có quyền đăng.
    expect(await posting.canPost(TENANT, created.id, BOB)).toEqual({ allowed: false, reason: 'restricted' });
  });

  it('tra chủ đề theo nhóm và theo id; chủ đề nhóm đã xoá không có', async () => {
    const { groups, topics, posting } = setup();
    const one = await groups.create(alice, { name: 'Một', privacy: 'public' });
    const two = await groups.create(alice, { name: 'Hai', privacy: 'public' });
    const topicOne = await topics.create(alice, one.id, { name: 'Chủ đề một' });
    const topicTwo = await topics.create(alice, two.id, { name: 'Chủ đề hai' });

    const ofOne = await posting.topicsOfGroup(TENANT, one.id, [topicOne.id, topicTwo.id]);
    expect([...ofOne.keys()]).toEqual([topicOne.id]);
    expect(ofOne.get(topicOne.id)?.name).toBe('Chủ đề một');
    expect((await posting.topicRefs(TENANT, [topicOne.id, topicTwo.id])).size).toBe(2);
    await groups.remove(alice, two.id);
    expect((await posting.topicRefs(TENANT, [topicTwo.id])).size).toBe(0);
  });
});

describe('SocialReportService', () => {
  const POST_WALL = '10000000-0000-4000-8000-000000000001';
  const POST_PUBLIC = '10000000-0000-4000-8000-000000000002';
  const POST_PRIVATE = '10000000-0000-4000-8000-000000000003';
  const COMMENT_WALL = '20000000-0000-4000-8000-000000000001';

  async function fixture() {
    const ctx = setup();
    const open = await ctx.groups.create(alice, { name: 'Nhóm mở', privacy: 'public', memberUserIds: [BOB, CAROL] });
    const closed = await ctx.groups.create(alice, { name: 'Nhóm kín', privacy: 'private', memberUserIds: [BOB, CAROL] });
    ctx.targets.add({
      targetType: 'post',
      targetId: POST_WALL,
      postId: POST_WALL,
      authorId: BOB,
      summary: { label: 'Bài trên tường', authorName: 'Bob Trần' },
    });
    ctx.targets.add({
      targetType: 'comment',
      targetId: COMMENT_WALL,
      postId: POST_WALL,
      authorId: BOB,
      summary: { label: 'Bình luận mẫu', postId: POST_WALL, commentId: COMMENT_WALL },
    });
    ctx.targets.add({
      targetType: 'post',
      targetId: POST_PUBLIC,
      postId: POST_PUBLIC,
      groupId: open.id,
      groupPrivacy: 'public',
      authorId: BOB,
      summary: { label: 'Bài nhóm mở' },
    });
    ctx.targets.add({
      targetType: 'post',
      targetId: POST_PRIVATE,
      postId: POST_PRIVATE,
      groupId: closed.id,
      groupPrivacy: 'private',
      authorId: BOB,
      summary: { label: 'Bài nhóm kín' },
    });
    return { ...ctx, open, closed };
  }

  it('báo cáo bài Tường công ty: vào hàng đợi moderator, sự kiện không có người nhận nhóm', async () => {
    const { reports, store } = await fixture();
    const report = await reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: '  Nội dung không phù hợp ' });
    expect(report).toMatchObject({ status: 'open', reason: 'Nội dung không phù hợp', reporter: { id: CAROL } });
    expect(report.target?.label).toBe('Bài trên tường');

    const event = store.events.find((candidate) => candidate.type === SOCIAL_EVENT_TYPES.reportCreated);
    expect(event?.aggregateType).toBe('social-report');
    expect(event?.payload).toMatchObject({ reportId: report.id, targetType: 'post', reporterId: CAROL });
    expect(event?.payload['recipientUserIds']).toBeUndefined();
    expect(event?.payload['groupId']).toBeUndefined();

    const queue = await reports.listForModerators(mod);
    expect(queue.openCount).toBe(1);
    expect(queue.items.map((item) => item.id)).toEqual([report.id]);
    expect(queue.items[0]?.reporter.name).toBe('Carol Lê');
    expect(queue.items[0]?.target?.label).toBe('Bài trên tường');
  });

  it('báo cáo bình luận; không báo cáo của chính mình; người không thấy đối tượng nhận 404', async () => {
    const { reports, targets } = await fixture();
    const report = await reports.create(carol, { targetType: 'comment', targetId: COMMENT_WALL, reason: 'Spam hoặc quảng cáo' });
    expect(report.target).toMatchObject({ commentId: COMMENT_WALL });
    await expectError(reports.create(bob, { targetType: 'post', targetId: POST_WALL, reason: 'Của chính tôi' }), 'VALIDATION', 400);
    await expectError(reports.create(bob, { targetType: 'comment', targetId: COMMENT_WALL, reason: 'Của chính tôi' }), 'VALIDATION', 400);

    targets.blind.add(ERIN);
    await expectError(reports.create(erin, { targetType: 'post', targetId: POST_WALL, reason: 'Không thấy bài' }), 'POST_NOT_FOUND', 404);
    await expectError(reports.create(carol, { targetType: 'post', targetId: randomUUID(), reason: 'Bài không có' }), 'POST_NOT_FOUND', 404);
    await expectError(reports.create(carol, { targetType: 'comment', targetId: 'khong-phai-uuid', reason: 'Sai mã' }), 'COMMENT_NOT_FOUND', 404);
  });

  it('kiểm tra loại đối tượng và độ dài lý do', async () => {
    const { reports } = await fixture();
    await expectError(reports.create(carol, { targetType: 'user' as unknown as 'post', targetId: POST_WALL, reason: 'Lý do hợp lệ' }), 'VALIDATION');
    await expectError(reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'ngắn' }), 'VALIDATION');
    await expectError(reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'x'.repeat(501) }), 'VALIDATION');
  });

  it('mỗi người một báo cáo mở cho mỗi đối tượng; xử lý xong thì báo cáo lại được', async () => {
    const { reports } = await fixture();
    const first = await reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'Lần đầu báo cáo' });
    await expectError(reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'Báo cáo lần hai' }), 'REPORT_EXISTS', 409);
    await reports.create(erin, { targetType: 'post', targetId: POST_WALL, reason: 'Người khác báo cáo' });
    await reports.resolveAsModerator(mod, first.id, { status: 'dismissed' });
    await reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'Báo cáo lại sau khi đóng' });
  });

  it('báo cáo nhóm: người xem được nhóm báo cáo, admin nhóm thì không, người ngoài nhóm kín nhận 404', async () => {
    const { reports, store, open, closed } = await fixture();
    const report = await reports.create(erin, { targetType: 'group', targetId: open.id, reason: 'Nhóm đăng tin sai' });
    expect(report).toMatchObject({ targetType: 'group', group: { id: open.id, name: 'Nhóm mở' }, target: { label: 'Nhóm mở' } });
    const event = store.events.find((candidate) => candidate.type === SOCIAL_EVENT_TYPES.reportCreated);
    expect(event?.payload).toMatchObject({ groupId: open.id, groupName: 'Nhóm mở', groupPrivacy: 'public', recipientUserIds: [ALICE] });

    await expectError(reports.create(alice, { targetType: 'group', targetId: open.id, reason: 'Tôi là quản lý' }), 'VALIDATION', 400);
    await expectError(reports.create(erin, { targetType: 'group', targetId: closed.id, reason: 'Nhóm kín lạ' }), 'GROUP_NOT_FOUND', 404);
    await expectError(reports.create(erin, { targetType: 'group', targetId: open.id, reason: 'Báo cáo lần hai' }), 'REPORT_EXISTS', 409);
    // Thành viên nhóm kín báo cáo được; người nhận chỉ là admin nhóm.
    await reports.create(bob, { targetType: 'group', targetId: closed.id, reason: 'Nhóm kín có vấn đề' });
    const privateEvent = store.events.filter((candidate) => candidate.type === SOCIAL_EVENT_TYPES.reportCreated).pop();
    expect(privateEvent?.payload).toMatchObject({ groupPrivacy: 'private', recipientUserIds: [ALICE] });
  });

  it('nhóm công khai: báo cáo ở cả hai hàng đợi, ai xử lý trước thì xong', async () => {
    const { reports, open } = await fixture();
    const report = await reports.create(carol, { targetType: 'post', targetId: POST_PUBLIC, reason: 'Bài nhóm có vấn đề' });
    expect(report.group?.id).toBe(open.id);

    expect((await reports.listForModerators(mod)).items.map((item) => item.id)).toEqual([report.id]);
    expect((await reports.listForGroup(alice, open.id)).items.map((item) => item.id)).toEqual([report.id]);

    const resolved = await reports.resolveForGroup(alice, open.id, report.id, { status: 'resolved', note: ' Đã xoá bài ' });
    expect(resolved).toMatchObject({ status: 'resolved', handleNote: 'Đã xoá bài', handledBy: { id: ALICE } });
    await expectError(reports.resolveAsModerator(mod, report.id, { status: 'dismissed' }), 'REPORT_HANDLED', 409);
    expect((await reports.listForModerators(mod)).items).toEqual([]);
    expect((await reports.listForModerators(mod, { status: 'resolved' })).items.map((item) => item.id)).toEqual([report.id]);
    expect((await reports.listForGroup(alice, open.id)).openCount).toBe(0);
  });

  it('nhóm riêng tư: chỉ admin nhóm và quản trị toàn hệ thống xử lý, moderator không thấy', async () => {
    const { reports, closed } = await fixture();
    const report = await reports.create(carol, { targetType: 'post', targetId: POST_PRIVATE, reason: 'Bài nhóm kín có vấn đề' });
    expect((await reports.listForModerators(mod)).items).toEqual([]);
    expect((await reports.listForModerators(mod)).openCount).toBe(0);
    await expectError(reports.resolveAsModerator(mod, report.id, { status: 'resolved' }), 'REPORT_NOT_FOUND', 404);

    // Moderator không phải admin nhóm, và không vào được nhóm kín.
    await expectError(reports.listForGroup(mod, closed.id), 'GROUP_NOT_FOUND', 404);
    await expectError(reports.listForGroup(bob, closed.id), 'FORBIDDEN', 403);
    expect((await reports.listForGroup(alice, closed.id)).items.map((item) => item.id)).toEqual([report.id]);
    const byGlobalAdmin = await reports.resolveForGroup(actor(DAVE, { canManage: true }), closed.id, report.id, { status: 'dismissed' });
    expect(byGlobalAdmin.status).toBe('dismissed');
  });

  it('hàng đợi moderator cần quyền kiểm duyệt; báo cáo của nhóm khác không xử lý qua nhóm này', async () => {
    const { reports, open, closed } = await fixture();
    const inClosed = await reports.create(carol, { targetType: 'post', targetId: POST_PRIVATE, reason: 'Bài nhóm kín có vấn đề' });
    await expectError(reports.listForModerators(bob), 'FORBIDDEN', 403);
    await expectError(reports.resolveAsModerator(carol, inClosed.id, { status: 'resolved' }), 'FORBIDDEN', 403);
    await expectError(reports.resolveForGroup(alice, open.id, inClosed.id, { status: 'resolved' }), 'REPORT_NOT_FOUND', 404);
    await expectError(reports.resolveForGroup(alice, closed.id, randomUUID(), { status: 'resolved' }), 'REPORT_NOT_FOUND', 404);
    await expectError(reports.resolveForGroup(alice, closed.id, inClosed.id, { status: 'open' as unknown as 'resolved' }), 'VALIDATION');
    await expectError(reports.resolveForGroup(alice, closed.id, inClosed.id, { status: 'resolved', note: 'x'.repeat(501) }), 'VALIDATION');
    // Quản trị tenant là moderator.
    const tenantAdmin = actor(DAVE, { isTenantAdmin: true });
    expect((await reports.listForModerators(tenantAdmin)).items).toEqual([]);
  });

  it('lọc theo loại đối tượng và trạng thái; nhóm đã xoá không còn trong hàng đợi', async () => {
    const { reports, groups, open } = await fixture();
    await reports.create(carol, { targetType: 'post', targetId: POST_WALL, reason: 'Báo cáo bài tường' });
    await reports.create(carol, { targetType: 'comment', targetId: COMMENT_WALL, reason: 'Báo cáo bình luận' });
    await reports.create(erin, { targetType: 'group', targetId: open.id, reason: 'Báo cáo nhóm mở' });

    expect((await reports.listForModerators(mod)).items).toHaveLength(3);
    expect((await reports.listForModerators(mod, { targetType: 'comment' })).items.map((item) => item.targetType)).toEqual(['comment']);
    expect((await reports.listForModerators(mod, { status: 'resolved' })).items).toEqual([]);
    await expectError(reports.listForModerators(mod, { status: 'xong' as unknown as 'open' }), 'VALIDATION');

    await groups.remove(alice, open.id);
    const after = await reports.listForModerators(mod);
    expect(after.items.map((item) => item.targetType).sort()).toEqual(['comment', 'post']);
    expect(after.openCount).toBe(2);
  });

  it('phân trang theo con trỏ, mới nhất trước', async () => {
    const { reports } = await fixture();
    const reporters = [carol, erin, actor(FRANK)];
    for (const reporter of reporters) {
      await reports.create(reporter, { targetType: 'post', targetId: POST_WALL, reason: 'Báo cáo để phân trang' });
    }
    const page = await reports.listForModerators(mod, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.openCount).toBe(3);
  });
});
