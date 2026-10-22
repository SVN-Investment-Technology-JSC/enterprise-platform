import { randomUUID } from 'node:crypto';
import type {
  AddSocialGroupMembersRequest,
  AddSocialGroupMembersResponse,
  JoinSocialGroupRequest,
  JoinSocialGroupResponse,
  SocialGroupMember,
  SocialGroupMemberPage,
  SocialGroupMemberQuery,
  SocialJoinRequest,
  SocialJoinRequestInboxPage,
  SocialJoinRequestPage,
  UpdateSocialGroupMemberRequest,
} from '@enterprise-platform/contracts-social';
import {
  isGlobalGroupAdmin,
  isPreviewOnly,
  normalizeGroupLimit,
  normalizeGroupRole,
  normalizeJoinMessage,
  normalizeSearchQuery,
  normalizeUserIds,
} from '../domain/social-group-rules.js';
import {
  SocialGroupAlreadyMemberError,
  SocialGroupJoinRequestExistsError,
  SocialGroupJoinRequestNotFoundError,
  SocialGroupNotFoundError,
  SocialGroupNotMemberError,
} from '../domain/social-group.error.js';
import { decodeCursor, encodeCursor, isUuid } from '../domain/social-rules.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import {
  actorNameOf,
  joinDecidedEvent,
  joinRequestedEvent,
  lookupGroupUsers,
  memberAddedEvent,
} from './social-group-support.js';
import type { GroupMemberRow, JoinRequestRow, SocialGroupStore } from './social-group-store.port.js';
import type { SocialGroupService } from './social-group.service.js';

/** Số người tối đa tìm theo tên trong danh bạ khi lọc danh sách thành viên. */
const MEMBER_SEARCH_LIMIT = 50;

/**
 * Thành viên nhóm, tham gia/rời nhóm, yêu cầu tham gia nhóm riêng tư.
 *
 * Quản trị nhóm = vai trò `admin` hoặc quản trị toàn hệ thống. Người cuối cùng là admin không được
 * rời, bị gỡ hay bị hạ vai trò: service kiểm sớm để báo lỗi rõ, store kiểm lại nguyên tử.
 */
export class SocialGroupMemberService {
  constructor(
    private readonly store: SocialGroupStore,
    private readonly directory: OrganizationDirectory,
    private readonly groups: SocialGroupService,
  ) {}

  /* ------------------------------------------------------------ thành viên */

  /** Thành viên (hoặc quản trị toàn hệ thống) xem danh sách; người ngoài nhóm riêng tư nhận 404. */
  async list(actor: SocialActor, groupId: string, query: SocialGroupMemberQuery = {}): Promise<SocialGroupMemberPage> {
    const group = await this.groups.requireGroup(actor, groupId);
    if (group.myRole === undefined && !isGlobalGroupAdmin(actor)) {
      if (isPreviewOnly({ privacy: group.privacy, isMember: false, globalAdmin: false })) {
        throw new SocialGroupNotFoundError();
      }
      throw new SocialGroupNotMemberError('Hãy tham gia nhóm để xem danh sách thành viên.');
    }
    const limit = normalizeGroupLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const role = query.role === undefined ? undefined : normalizeGroupRole(query.role);

    let userIds: readonly string[] | undefined;
    const text = normalizeSearchQuery(query.query);
    if (text) {
      const found = await this.directory.search(actor.tenantId, text, MEMBER_SEARCH_LIMIT);
      if (found.length === 0) return { items: [] };
      userIds = found.map((user) => user.id.toLowerCase());
    }

    const rows = await this.store.members.list(actor.tenantId, {
      groupId: group.id,
      ...(role ? { role } : {}),
      ...(userIds ? { userIds } : {}),
      limit: limit + 1,
      cursor,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lookup = await lookupGroupUsers(
      this.directory,
      actor.tenantId,
      page.map((row) => row.userId),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toMember(row, lookup(row.userId))),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.joinedAt, id: last.userId }) } : {}),
    };
  }

  async add(
    actor: SocialActor,
    groupId: string,
    request: AddSocialGroupMembersRequest,
  ): Promise<AddSocialGroupMembersResponse> {
    const group = await this.groups.requireManageable(actor, groupId);
    const input = request ?? ({} as AddSocialGroupMembersRequest);
    const userIds = normalizeUserIds(input.userIds);
    const role = normalizeGroupRole(input.role, 'member');
    const known = userIds.length ? await this.directory.resolve(actor.tenantId, userIds) : new Map();
    const knownIds = userIds.filter((id) => known.has(id));
    const skippedUnknown = userIds.filter((id) => !known.has(id));
    const addedByName = await actorNameOf(this.directory, actor);

    const inserted = knownIds.length
      ? await this.store.members.add(actor.tenantId, group.id, knownIds, role, actor.userId, (ids) =>
          ids.map((userId) =>
            memberAddedEvent({
              groupId: group.id,
              groupName: group.name,
              userId,
              addedBy: actor.userId,
              addedByName,
              via: 'invited',
            }),
          ),
        )
      : [];
    const lookup = await lookupGroupUsers(this.directory, actor.tenantId, inserted);
    return { added: inserted.map(lookup), skippedUnknown };
  }

  async setRole(
    actor: SocialActor,
    groupId: string,
    userId: string,
    request: UpdateSocialGroupMemberRequest,
  ): Promise<SocialGroupMember> {
    const group = await this.groups.requireManageable(actor, groupId);
    const role = normalizeGroupRole((request ?? ({} as UpdateSocialGroupMemberRequest)).role);
    const target = await this.requireMember(actor, group.id, userId);
    if (target.role !== role) {
      // `setRole` ném SocialGroupLastAdminError khi hạ admin cuối cùng (kiểm nguyên tử trong store).
      const changed = await this.store.members.setRole(actor.tenantId, group.id, target.userId, role);
      if (!changed) throw notMemberTarget();
    }
    const updated = await this.requireMember(actor, group.id, userId);
    const lookup = await lookupGroupUsers(this.directory, actor.tenantId, [updated.userId]);
    return toMember(updated, lookup(updated.userId));
  }

  /** Admin gỡ người khác. Gỡ chính mình thì như rời nhóm. */
  async remove(actor: SocialActor, groupId: string, userId: string): Promise<void> {
    if (isUuid(userId) && userId.toLowerCase() === actor.userId.toLowerCase()) {
      await this.leave(actor, groupId);
      return;
    }
    const group = await this.groups.requireManageable(actor, groupId);
    const target = await this.requireMember(actor, group.id, userId);
    const removed = await this.store.members.remove(actor.tenantId, group.id, target.userId);
    if (!removed) throw notMemberTarget();
  }

  async leave(actor: SocialActor, groupId: string): Promise<void> {
    const group = await this.groups.requireGroup(actor, groupId);
    if (group.myRole === undefined) throw new SocialGroupNotMemberError();
    const removed = await this.store.members.remove(actor.tenantId, group.id, actor.userId);
    if (!removed) throw new SocialGroupNotMemberError();
  }

  /* ----------------------------------------------------- tham gia, yêu cầu */

  /** Nhóm công khai: vào ngay. Nhóm riêng tư: tạo yêu cầu chờ admin duyệt. */
  async join(actor: SocialActor, groupId: string, request: JoinSocialGroupRequest): Promise<JoinSocialGroupResponse> {
    const group = await this.groups.requireGroup(actor, groupId);
    if (group.myRole !== undefined) throw new SocialGroupAlreadyMemberError();

    if (group.privacy === 'public') {
      const inserted = await this.store.members.add(actor.tenantId, group.id, [actor.userId.toLowerCase()], 'member', null, () => []);
      if (inserted.length === 0) throw new SocialGroupAlreadyMemberError();
      return { result: 'joined', group: await this.groups.get(actor, group.id) };
    }

    if (group.myPendingRequestId !== undefined) throw new SocialGroupJoinRequestExistsError();
    const message = normalizeJoinMessage((request ?? {}).message);
    const requestId = randomUUID();
    const adminUserIds = await this.store.members.listAdminIds(actor.tenantId, group.id);
    await this.store.requests.create(actor.tenantId, {
      id: requestId,
      groupId: group.id,
      userId: actor.userId,
      ...(message ? { message } : {}),
      events: [
        joinRequestedEvent({
          groupId: group.id,
          groupName: group.name,
          requestId,
          requesterId: actor.userId,
          requesterName: await actorNameOf(this.directory, actor),
          adminUserIds,
        }),
      ],
    });
    return { result: 'requested', group: await this.groups.get(actor, group.id) };
  }

  /** Huỷ yêu cầu đang chờ của chính mình. */
  async cancelJoinRequest(actor: SocialActor, groupId: string): Promise<void> {
    const group = await this.groups.requireGroup(actor, groupId);
    const cancelled = await this.store.requests.cancel(actor.tenantId, group.id, actor.userId);
    if (!cancelled) throw new SocialGroupJoinRequestNotFoundError();
  }

  async listJoinRequests(
    actor: SocialActor,
    groupId: string,
    query: { cursor?: string; limit?: number | string } = {},
  ): Promise<SocialJoinRequestPage> {
    const group = await this.groups.requireManageable(actor, groupId);
    const limit = normalizeGroupLimit(query.limit);
    const rows = await this.store.requests.listPending(actor.tenantId, group.id, {
      limit: limit + 1,
      cursor: decodeCursor(query.cursor),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lookup = await lookupGroupUsers(
      this.directory,
      actor.tenantId,
      page.map((row) => row.userId),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toJoinRequest(row, lookup(row.userId))),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }

  /** Duyệt yêu cầu: người xin thành `member`. Phát `member.added` (via `approved`) và `join.decided`. */
  async approveJoinRequest(actor: SocialActor, groupId: string, requestId: string): Promise<SocialGroupMember> {
    const group = await this.groups.requireManageable(actor, groupId);
    const pending = await this.requirePendingRequest(actor, group.id, requestId);
    const result = await this.store.requests.decide(actor.tenantId, {
      groupId: group.id,
      requestId: pending.id,
      decision: 'approved',
      decidedBy: actor.userId,
      events: [
        memberAddedEvent({
          groupId: group.id,
          groupName: group.name,
          userId: pending.userId,
          addedBy: actor.userId,
          addedByName: await actorNameOf(this.directory, actor),
          via: 'approved',
        }),
        joinDecidedEvent({
          groupId: group.id,
          groupName: group.name,
          requestId: pending.id,
          requesterId: pending.userId,
          decision: 'approved',
          decidedBy: actor.userId,
        }),
      ],
    });
    if (!result?.member) throw new SocialGroupJoinRequestNotFoundError();
    const lookup = await lookupGroupUsers(this.directory, actor.tenantId, [result.member.userId]);
    return toMember(result.member, lookup(result.member.userId));
  }

  async rejectJoinRequest(actor: SocialActor, groupId: string, requestId: string): Promise<void> {
    const group = await this.groups.requireManageable(actor, groupId);
    const pending = await this.requirePendingRequest(actor, group.id, requestId);
    const result = await this.store.requests.decide(actor.tenantId, {
      groupId: group.id,
      requestId: pending.id,
      decision: 'rejected',
      decidedBy: actor.userId,
      events: [
        joinDecidedEvent({
          groupId: group.id,
          groupName: group.name,
          requestId: pending.id,
          requesterId: pending.userId,
          decision: 'rejected',
          decidedBy: actor.userId,
        }),
      ],
    });
    if (!result) throw new SocialGroupJoinRequestNotFoundError();
  }

  /** Yêu cầu đang chờ ở mọi nhóm tôi là admin của nhóm (vai trò `admin`). */
  async joinRequestInbox(
    actor: SocialActor,
    query: { cursor?: string; limit?: number | string } = {},
  ): Promise<SocialJoinRequestInboxPage> {
    const limit = normalizeGroupLimit(query.limit);
    const [rows, totalCount] = await Promise.all([
      this.store.requests.inbox(actor.tenantId, actor.userId, {
        limit: limit + 1,
        cursor: decodeCursor(query.cursor),
      }),
      this.store.requests.inboxCount(actor.tenantId, actor.userId),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lookup = await lookupGroupUsers(
      this.directory,
      actor.tenantId,
      page.map((row) => row.userId),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        ...toJoinRequest(row, lookup(row.userId)),
        group: { id: row.groupId, name: row.groupName },
      })),
      totalCount,
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }

  /* -------------------------------------------------------------- nội bộ */

  private async requireMember(actor: SocialActor, groupId: string, userId: string): Promise<GroupMemberRow> {
    if (!isUuid(userId)) throw notMemberTarget();
    const member = await this.store.members.find(actor.tenantId, groupId, userId.toLowerCase());
    if (!member) throw notMemberTarget();
    return member;
  }

  private async requirePendingRequest(actor: SocialActor, groupId: string, requestId: string): Promise<JoinRequestRow> {
    if (!isUuid(requestId)) throw new SocialGroupJoinRequestNotFoundError();
    const pending = await this.store.requests.findPendingById(actor.tenantId, groupId, requestId);
    if (!pending) throw new SocialGroupJoinRequestNotFoundError();
    return pending;
  }
}

function notMemberTarget(): SocialGroupNotMemberError {
  return new SocialGroupNotMemberError('Người này không phải thành viên của nhóm.', 404);
}

function toMember(row: GroupMemberRow, user: SocialGroupMember['user']): SocialGroupMember {
  return { user, role: row.role, joinedAt: new Date(row.joinedAt).toISOString() };
}

function toJoinRequest(row: JoinRequestRow, user: SocialJoinRequest['user']): SocialJoinRequest {
  return {
    id: row.id,
    groupId: row.groupId,
    user,
    ...(row.message ? { message: row.message } : {}),
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
