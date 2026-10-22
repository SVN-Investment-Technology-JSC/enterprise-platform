import { randomUUID } from 'node:crypto';
import {
  SOCIAL_GROUP_MEMBER_PREVIEW,
  SOCIAL_GROUP_SUGGESTION_LIMIT,
  SOCIAL_NOTIFY_RECIPIENT_MAX,
  type CreateSocialGroupRequest,
  type SocialGroupDetail,
  type SocialGroupListQuery,
  type SocialGroupMemberSource,
  type SocialGroupPage,
  type SocialGroupSuggestions,
  type SocialGroupSummary,
  type SocialUserRef,
  type UpdateSocialGroupRequest,
} from '@enterprise-platform/contracts-social';
import {
  groupCapabilities,
  isGlobalGroupAdmin,
  isPreviewOnly,
  normalizeAdminUserIds,
  normalizeCoverPreset,
  normalizeGroupColor,
  normalizeGroupDescription,
  normalizeGroupDescriptionHtml,
  normalizeGroupIcon,
  normalizeGroupLimit,
  normalizeGroupListScope,
  normalizeGroupName,
  normalizeGroupPrivacy,
  normalizeMemberSources,
  normalizePermittedUserIds,
  normalizePostPermission,
  normalizeSearchQuery,
  normalizeUserIds,
} from '../domain/social-group-rules.js';
import {
  SocialGroupNoMemberSourcesError,
  SocialGroupNotFoundError,
  SocialGroupSourceUnknownError,
} from '../domain/social-group.error.js';
import { decodeCursor, encodeCursor, isUuid } from '../domain/social-rules.js';
import { SocialForbiddenError, SocialValidationError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { OrgStructurePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';
import { actorNameOf, lookupGroupUsers, memberAddedEvent } from './social-group-support.js';
import type { GroupPatch, GroupRow, GroupSourceInsert, SocialGroupStore } from './social-group-store.port.js';
import type { GroupSourceRow, SocialGroupV2Store } from './social-group-v2-store.port.js';

/**
 * Nhóm: danh sách, tạo, xem (đầy đủ hoặc bản xem trước), sửa, xoá mềm, gợi ý.
 *
 * Nhóm riêng tư với người ngoài: không có trong danh sách; có đường dẫn trực tiếp thì nhận bản xem
 * trước. Nhóm không có hoặc đã xoá: 404. Mọi thành viên tenant dùng được, không cần quyền `social.*`.
 *
 * Đợt 2: nhiều quản lý, mô tả rich text, ảnh bìa, quyền đăng bài, tạo theo phòng ban/vị trí.
 */
export class SocialGroupService {
  constructor(
    private readonly store: SocialGroupStore,
    private readonly directory: OrganizationDirectory,
    private readonly org: OrgStructurePort,
    private readonly v2: SocialGroupV2Store,
  ) {}

  async list(actor: SocialActor, query: SocialGroupListQuery = {}): Promise<SocialGroupPage> {
    const limit = normalizeGroupLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const scope = normalizeGroupListScope(query.scope);
    const rows = await this.store.groups.list(actor.tenantId, {
      viewerId: actor.userId,
      scope,
      seesAllGroups: isGlobalGroupAdmin(actor),
      query: normalizeSearchQuery(query.query),
      limit: limit + 1,
      cursor,
    });
    // `mine`: nhóm ưu tiên (tối đa SOCIAL_GROUP_PRIORITY_MAX) đứng đầu trang đầu và không tính vào cỡ trang.
    const pinned = scope === 'mine' ? rows.filter((row) => row.myPriorityAt !== undefined) : [];
    const rest = scope === 'mine' ? rows.filter((row) => row.myPriorityAt === undefined) : rows;
    const hasMore = rest.length > limit;
    const page = hasMore ? rest.slice(0, limit) : rest;
    const last = page[page.length - 1];
    return {
      items: [...pinned, ...page].map((row) => this.toSummary(row)),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }

  /** "Các nhóm khác": nhóm công khai tôi chưa tham gia, nhiều thành viên trước. Không có nhóm riêng tư. */
  async suggestions(actor: SocialActor, limit?: number | string): Promise<SocialGroupSuggestions> {
    const requested = limit === undefined || limit === '' ? SOCIAL_GROUP_SUGGESTION_LIMIT : Number(limit);
    if (!Number.isInteger(requested) || requested < 1) throw new SocialValidationError('Cỡ trang không hợp lệ.');
    const rows = await this.store.groups.suggestions(
      actor.tenantId,
      actor.userId,
      Math.min(requested, SOCIAL_GROUP_SUGGESTION_LIMIT),
    );
    return { items: rows.map((row) => this.toSummary(row)) };
  }

  async create(actor: SocialActor, request: CreateSocialGroupRequest): Promise<SocialGroupDetail> {
    const input = request ?? ({} as CreateSocialGroupRequest);
    const name = normalizeGroupName(input.name);
    const rich = normalizeGroupDescriptionHtml(input.descriptionHtml);
    // `descriptionHtml` ưu tiên hơn `description`; bản chữ thuần do server suy ra từ HTML đã làm sạch.
    const description = rich ? rich.text : normalizeGroupDescription(input.description);
    const privacy = normalizeGroupPrivacy(input.privacy);
    const color = normalizeGroupColor(input.color);
    const icon = normalizeGroupIcon(input.icon);
    const coverPreset = normalizeCoverPreset(input.coverPreset);
    const postPermission = normalizePostPermission(input.postPermission, 'all');
    const creatorId = actor.userId.toLowerCase();

    const adminCandidates = normalizeAdminUserIds(input.adminUserIds, creatorId);
    const membership = input.membership;
    const manualCandidates = normalizeUserIds([
      ...(input.memberUserIds ?? []),
      ...(membership?.mode === 'manual' ? (membership.userIds ?? []) : []),
    ]).filter((id) => id !== creatorId);

    const wanted = [...new Set([...adminCandidates, ...manualCandidates])];
    const known = wanted.length ? await this.directory.resolve(actor.tenantId, wanted) : new Map<string, SocialUserRef>();
    const adminUserIds = adminCandidates.filter((id) => known.has(id));
    const adminSet = new Set(adminUserIds);
    const memberUserIds = manualCandidates.filter((id) => known.has(id) && !adminSet.has(id));

    let sources: GroupSourceInsert[] = [];
    let syncedUserIds: string[] = [];
    if (membership?.mode === 'org') {
      const resolved = await this.resolveSources(actor.tenantId, membership.sources);
      if (resolved.length === 0) throw new SocialGroupNoMemberSourcesError();
      sources = resolved.map((entry) => entry.insert);
      const taken = new Set([creatorId, ...adminUserIds, ...memberUserIds]);
      const expanded = await this.org.memberIdsOf(
        actor.tenantId,
        resolved.map((entry) => ({ id: entry.insert.sourceId, includeDescendants: entry.insert.includeDescendants })),
      );
      syncedUserIds = [...new Set(expanded.map((id) => id.toLowerCase()))].filter((id) => !taken.has(id));
    }

    let postPermittedUserIds: string[] = [];
    if (postPermission === 'selected') {
      postPermittedUserIds = normalizePermittedUserIds(input.postPermittedUserIds);
      if (postPermittedUserIds.length === 0) {
        throw new SocialValidationError('Hãy chọn ít nhất một người được đăng bài.');
      }
      const everyone = new Set([creatorId, ...adminUserIds, ...memberUserIds, ...syncedUserIds]);
      if (postPermittedUserIds.some((id) => !everyone.has(id))) {
        throw new SocialValidationError('Người được chọn đăng bài phải là thành viên của nhóm.');
      }
    }

    const groupId = randomUUID();
    const addedByName = await actorNameOf(this.directory, actor);
    const invited = [...adminUserIds, ...memberUserIds].map((userId) =>
      memberAddedEvent({ groupId, groupName: name, userId, addedBy: actor.userId, addedByName, via: 'invited' }),
    );
    // Quá `SOCIAL_NOTIFY_RECIPIENT_MAX` người thì vẫn thêm nhưng không thông báo từng người.
    const synced =
      syncedUserIds.length <= SOCIAL_NOTIFY_RECIPIENT_MAX
        ? syncedUserIds.map((userId) =>
            memberAddedEvent({ groupId, groupName: name, userId, addedBy: actor.userId, addedByName, via: 'synced' }),
          )
        : [];

    await this.store.groups.insert(actor.tenantId, {
      id: groupId,
      name,
      ...(description ? { description } : {}),
      ...(rich ? { descriptionHtml: rich.html } : {}),
      ...(coverPreset ? { coverPreset } : {}),
      privacy,
      color,
      icon,
      createdBy: actor.userId,
      postPermission,
      membershipMode: sources.length > 0 ? 'org' : 'manual',
      adminUserIds,
      memberUserIds,
      syncedUserIds,
      sources,
      postPermittedUserIds,
      events: [...invited, ...synced],
    });
    return this.get(actor, groupId);
  }

  /** Chi tiết nhóm; nhóm riêng tư với người ngoài chỉ nhận bản xem trước (`access = 'preview'`). */
  async get(actor: SocialActor, groupId: string): Promise<SocialGroupDetail> {
    const row = await this.requireGroup(actor, groupId);
    return this.toDetail(actor, row);
  }

  async update(actor: SocialActor, groupId: string, request: UpdateSocialGroupRequest): Promise<SocialGroupDetail> {
    const row = await this.requireManageable(actor, groupId);
    const input = request ?? {};
    const patch: {
      -readonly [K in keyof GroupPatch]: GroupPatch[K];
    } = {};
    if (input.name !== undefined) patch.name = normalizeGroupName(input.name);
    if (input.descriptionHtml !== undefined) {
      const rich = normalizeGroupDescriptionHtml(input.descriptionHtml);
      patch.descriptionHtml = rich?.html ?? null;
      patch.description = rich
        ? rich.text
        : input.description !== undefined
          ? (normalizeGroupDescription(input.description) ?? null)
          : null;
    } else if (input.description !== undefined) {
      // Sửa riêng bản chữ thuần thì bản rich text cũ không còn khớp: bỏ nó.
      patch.description = normalizeGroupDescription(input.description) ?? null;
      patch.descriptionHtml = null;
    }
    if (input.coverPreset !== undefined) patch.coverPreset = normalizeCoverPreset(input.coverPreset) ?? null;
    if (input.privacy !== undefined) patch.privacy = normalizeGroupPrivacy(input.privacy);
    if (input.color !== undefined) patch.color = normalizeGroupColor(input.color);
    if (input.icon !== undefined) patch.icon = normalizeGroupIcon(input.icon);

    const nextPermission =
      input.postPermission !== undefined ? normalizePostPermission(input.postPermission) : row.postPermission;
    if (input.postPermission !== undefined) patch.postPermission = nextPermission;
    let permitted: string[] | undefined;
    if (input.postPermittedUserIds !== undefined) {
      permitted = normalizePermittedUserIds(input.postPermittedUserIds);
      await this.assertAllMembers(actor.tenantId, row.id, permitted);
      patch.postPermittedUserIds = permitted;
    }
    if (nextPermission === 'selected') {
      const effective = permitted ?? (await this.v2.posting.permittedUserIds(actor.tenantId, row.id));
      if (effective.length === 0) throw new SocialValidationError('Hãy chọn ít nhất một người được đăng bài.');
    }

    if (Object.keys(patch).length > 0) await this.store.groups.update(actor.tenantId, row.id, patch);
    return this.get(actor, row.id);
  }

  async remove(actor: SocialActor, groupId: string): Promise<void> {
    const row = await this.requireManageable(actor, groupId);
    await this.store.groups.softDelete(actor.tenantId, row.id, actor.userId);
  }

  /* ------------------------------------------------- dùng chung với service khác */

  /** Nhóm chưa xoá, kèm cột `my*` của người xem. 404 nếu không có, sai mã hoặc đã xoá. */
  async requireGroup(actor: SocialActor, groupId: string): Promise<GroupRow> {
    if (!isUuid(groupId)) throw new SocialGroupNotFoundError();
    const row = await this.store.groups.find(actor.tenantId, groupId, actor.userId);
    if (!row || row.deleted) throw new SocialGroupNotFoundError();
    return row;
  }

  /**
   * Nhóm mà người xem được xem đầy đủ: thành viên, quản trị toàn hệ thống, hoặc nhóm công khai. Nhóm
   * riêng tư với người ngoài nhận 404 (không lộ nhóm).
   */
  async requireFullAccess(actor: SocialActor, groupId: string): Promise<GroupRow> {
    const row = await this.requireGroup(actor, groupId);
    if (isPreviewOnly({ privacy: row.privacy, isMember: row.myRole !== undefined, globalAdmin: isGlobalGroupAdmin(actor) })) {
      throw new SocialGroupNotFoundError();
    }
    return row;
  }

  /**
   * Nhóm mà người gọi quản lý được (admin nhóm hoặc quản trị toàn hệ thống). Người ngoài nhóm riêng
   * tư nhận 404 (không lộ nhóm); người xem được nhóm nhưng không quản lý nhận 403.
   */
  async requireManageable(actor: SocialActor, groupId: string): Promise<GroupRow> {
    const row = await this.requireGroup(actor, groupId);
    if (canManageGroup(actor, row)) return row;
    if (isPreviewOnly({ privacy: row.privacy, isMember: row.myRole !== undefined, globalAdmin: false })) {
      throw new SocialGroupNotFoundError();
    }
    throw new SocialForbiddenError('Chỉ quản trị viên của nhóm mới thực hiện được thao tác này.');
  }

  /**
   * Tra các nút nguồn trong sơ đồ tổ chức: nút phải tồn tại và đúng loại (`unit`/`position`), nếu không
   * thì 400 `GROUP_SOURCE_UNKNOWN`. Tên nút được chốt vào nguồn tại lúc lưu.
   */
  async resolveSources(
    tenantId: string,
    value: unknown,
  ): Promise<readonly { readonly insert: GroupSourceInsert }[]> {
    const sources = normalizeMemberSources(value);
    if (sources.length === 0) return [];
    const refs = await this.org.nodeRefs(
      tenantId,
      sources.map((source) => source.id),
    );
    return sources.map((source) => {
      const ref = refs.get(source.id);
      if (!ref || ref.kind !== source.type) throw new SocialGroupSourceUnknownError();
      return {
        insert: {
          type: source.type,
          sourceId: source.id,
          name: ref.name,
          includeDescendants: source.includeDescendants,
        },
      };
    });
  }

  async toDetail(actor: SocialActor, row: GroupRow): Promise<SocialGroupDetail> {
    const globalAdmin = isGlobalGroupAdmin(actor);
    const isMember = row.myRole !== undefined;
    const preview = isPreviewOnly({ privacy: row.privacy, isMember, globalAdmin });
    const manageable = !preview && (row.myRole === 'admin' || globalAdmin);

    // Nguồn thành viên và người được chọn đăng bài chỉ trả cho người quản lý nhóm.
    const [sources, permittedIds] = manageable
      ? await Promise.all([
          row.membershipMode === 'org' ? this.v2.sources.list(actor.tenantId, row.id) : Promise.resolve([]),
          row.postPermission === 'selected'
            ? this.v2.posting.permittedUserIds(actor.tenantId, row.id)
            : Promise.resolve([] as string[]),
        ])
      : [[] as GroupSourceRow[], [] as string[]];

    const capabilities = groupCapabilities({
      privacy: row.privacy,
      myRole: row.myRole,
      globalAdmin: preview ? false : globalAdmin,
      adminCount: row.adminCount,
      hasPendingRequest: row.myPendingRequestId !== undefined,
      postPermission: row.postPermission,
      myPostPermitted: row.myPostPermitted,
      hasMemberSources: sources.length > 0,
    });

    if (preview) {
      return {
        id: row.id,
        name: row.name,
        privacy: row.privacy,
        color: row.color,
        icon: row.icon,
        memberCount: 0,
        ...(row.myPendingRequestId ? { myJoinRequestId: row.myPendingRequestId } : {}),
        createdAt: toIsoMs(row.createdAt),
        access: 'preview',
        memberPreview: [],
        adminCount: 0,
        capabilities: { ...capabilities, canReport: false, canPrioritize: false },
      };
    }

    const previewIds = await this.store.members.listIds(actor.tenantId, row.id, SOCIAL_GROUP_MEMBER_PREVIEW);
    const lookup = await lookupGroupUsers(this.directory, actor.tenantId, [row.createdBy, ...previewIds, ...permittedIds]);
    const memberSources: SocialGroupMemberSource[] = sources.map((source) => ({
      id: source.id,
      type: source.type,
      sourceId: source.sourceId,
      name: source.name,
      includeDescendants: source.includeDescendants,
    }));
    return {
      ...this.toSummary(row),
      access: 'full',
      createdBy: lookup(row.createdBy),
      memberPreview: previewIds.map(lookup),
      adminCount: row.adminCount,
      ...(capabilities.canManage ? { pendingJoinRequestCount: row.pendingRequestCount } : {}),
      capabilities,
      ...(row.descriptionHtml ? { descriptionHtml: row.descriptionHtml } : {}),
      postPermission: row.postPermission,
      ...(manageable && row.postPermission === 'selected' ? { postPermittedUsers: permittedIds.map(lookup) } : {}),
      ...(manageable && row.membershipMode === 'org' ? { memberSources } : {}),
      ...(row.lastSyncedAt ? { lastSyncedAt: toIsoMs(row.lastSyncedAt) } : {}),
    };
  }

  /* -------------------------------------------------------------- nội bộ */

  /** Mọi id phải đang là thành viên của nhóm; nếu không 400. */
  private async assertAllMembers(tenantId: string, groupId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const found = await this.store.members.list(tenantId, { groupId, userIds, limit: userIds.length });
    if (found.length !== userIds.length) {
      throw new SocialValidationError('Người được chọn đăng bài phải là thành viên của nhóm.');
    }
  }

  private toSummary(row: GroupRow): SocialGroupSummary {
    return {
      id: row.id,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      privacy: row.privacy,
      color: row.color,
      icon: row.icon,
      memberCount: row.memberCount,
      ...(row.myRole && row.myJoinedAt
        ? { myMembership: { role: row.myRole, joinedAt: toIsoMs(row.myJoinedAt) } }
        : {}),
      ...(row.myPendingRequestId ? { myJoinRequestId: row.myPendingRequestId } : {}),
      createdAt: toIsoMs(row.createdAt),
      ...(row.coverPreset ? { coverPreset: row.coverPreset } : {}),
      ...(row.myPriorityAt ? { myPriorityAt: toIsoMs(row.myPriorityAt) } : {}),
      membershipMode: row.membershipMode,
    };
  }
}

/** Admin của nhóm hoặc quản trị toàn hệ thống. */
export function canManageGroup(actor: SocialActor, row: Pick<GroupRow, 'myRole'>): boolean {
  return row.myRole === 'admin' || isGlobalGroupAdmin(actor);
}

function toIsoMs(value: string): string {
  return new Date(value).toISOString();
}
