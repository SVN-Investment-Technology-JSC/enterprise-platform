import { randomUUID } from 'node:crypto';
import {
  SOCIAL_BOOKMARK_FOLDERS_MAX,
  SOCIAL_BOOKMARK_FOLDER_NAME_MAX,
  SOCIAL_EVENT_TYPES,
  type SocialGroupRole,
  type SocialOrgNode,
  type SocialUnitRef,
  type SocialReactionType,
  type SocialSettings,
  type SocialUserRef,
  type UpdateSocialSettingsRequest,
} from '@enterprise-platform/contracts-social';
import { mayManage, mayModerate } from '../domain/social-principal.js';
import { SocialError } from '../domain/social.error.js';
import { isExemptScheduled } from '../domain/social-publishing-rules.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { GroupAccessInfo, GroupMembershipInfo, GroupMembershipPort } from './ports/group-membership.port.js';
import type {
  ExtendedPostRow,
  PollRow,
  PostAudienceRow,
  PostEngagementRelations,
  ReadConfirmationRow,
} from './ports/post-read-model.js';
import {
  canViewPostInScope,
  type PostVisibilityPort,
  type PostVisibilityScope,
  type PostVisibilitySubject,
} from './ports/post-visibility.port.js';
import type { GroupPostingDecision, GroupPostingPort, GroupTopicRef } from './ports/group-posting.port.js';
import type { SocialSettingsPort } from './ports/social-settings.port.js';
import type { OrgStructurePort, ViewerScope, ViewerScopePort } from './ports/viewer-scope.port.js';
import { SocialPostHistoryService } from './social-post-history.service.js';
import type { PostEditRecord } from './social-post-history-store.port.js';
import type { SocialActor } from './social-actor.js';
import { SocialBookmarkService } from './social-bookmark.service.js';
import { SocialCommentService } from './social-comment.service.js';
import { SocialModerationService } from './social-moderation.service.js';
import { SocialMyPostsService } from './social-my-posts.service.js';
import { SocialPollService } from './social-poll.service.js';
import { SocialPostAccess } from './social-post-access.js';
import { SocialPostViewAssembler } from './social-post-view.assembler.js';
import { PublishedEventBuilder } from './social-publishing-events.js';
import { SocialPublishingService } from './social-publishing.service.js';
import type {
  BookmarkedPostRow,
  BookmarkFolderRow,
  BookmarkFolderSummary,
  BookmarkListQuery,
  DueDecision,
  InboxCountsRow,
  PollVoterRow,
  PostListQuery,
  PostTransition,
  PublishingPostInsert,
  PublishingPostPatch,
  ReadConfirmationRecord,
  SocialPublishingStore,
  WritablePostRow,
} from './social-publishing-store.port.js';
import { SocialReactionService } from './social-reaction.service.js';
import { ReadAudience } from './social-read-audience.js';
import { SocialReadConfirmationService } from './social-read-confirmation.service.js';
import { SocialSchedulerService } from './social-scheduler.service.js';
import { SocialSettingsService } from './social-settings.service.js';
import type { AttachmentRow, SocialOutboxEvent, SocialStore } from './social-store.port.js';
import {
  SocialPostStateError,
  SocialPollClosedError,
  SocialReadConfirmationLockedError,
} from '../domain/social-publishing.error.js';
import { SocialPostNotFoundError } from '../domain/social.error.js';

const TENANT = 'tenant-1';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const DAVE = '44444444-4444-4444-8444-444444444444';
const OUTSIDER = '55555555-5555-4555-8555-555555555555';
const G_PUBLIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G_PRIVATE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const G_GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const UNIT_PARENT = 'a0000000-0000-4000-8000-000000000001';
const UNIT_CHILD = 'a0000000-0000-4000-8000-000000000002';
const UNIT_OTHER = 'a0000000-0000-4000-8000-000000000003';
const UNIT_GONE = 'a0000000-0000-4000-8000-000000000009';
const TOPIC_A = 'e0000000-0000-4000-8000-00000000000a';
const TOPIC_FOREIGN = 'e0000000-0000-4000-8000-00000000000b';

/** Phòng ban của từng người, gồm cả tổ tiên (như `ViewerScope.unitIds`). Dave chưa thuộc phòng ban nào. */
const USER_UNITS: Record<string, string[]> = {
  [ALICE]: [UNIT_PARENT],
  [BOB]: [UNIT_CHILD, UNIT_PARENT],
  [CAROL]: [UNIT_OTHER],
  [DAVE]: [],
  [OUTSIDER]: [],
};
/** Phòng ban "gần nhất" của tác giả để chốt `author_unit_id`. */
const AUTHOR_UNIT: Record<string, string | undefined> = {
  [ALICE]: UNIT_PARENT,
  [BOB]: UNIT_CHILD,
  [CAROL]: UNIT_OTHER,
};

const NAMES: Record<string, SocialUserRef> = {
  [ALICE]: { id: ALICE, name: 'Alice Nguyễn' },
  [BOB]: { id: BOB, name: 'Bob Trần' },
  [CAROL]: { id: CAROL, name: 'Carol Lê' },
  [DAVE]: { id: DAVE, name: 'Dave Phạm' },
  [OUTSIDER]: { id: OUTSIDER, name: 'Người ngoài' },
};

function actor(userId: string, flags: Partial<SocialActor> = {}): SocialActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: NAMES[userId]?.name ?? 'Ai đó',
    isTenantAdmin: false,
    canRead: true,
    canWrite: true,
    canModerate: false,
    canManage: false,
    ...flags,
  };
}

const alice = actor(ALICE);
const bob = actor(BOB);
const dave = actor(DAVE);
const outsider = actor(OUTSIDER);
const moderator = actor(CAROL, { canModerate: true });
const manager = actor(DAVE, { canManage: true });

/* --------------------------------------------------------------- bản giả */

class FakeGroups implements GroupMembershipPort {
  readonly infos = new Map<string, GroupAccessInfo>([
    [G_PUBLIC, { id: G_PUBLIC, name: 'Cộng đồng', privacy: 'public', color: 'blue', icon: 'users', deleted: false }],
    [G_PRIVATE, { id: G_PRIVATE, name: 'Ban dự án', privacy: 'private', color: 'teal', icon: 'rocket', deleted: false }],
    [G_GONE, { id: G_GONE, name: 'Đã xoá', privacy: 'public', color: 'blue', icon: 'users', deleted: true }],
  ]);
  readonly members = new Map<string, Map<string, SocialGroupRole>>([
    [G_PUBLIC, new Map<string, SocialGroupRole>([[ALICE, 'admin'], [BOB, 'member']])],
    [G_PRIVATE, new Map<string, SocialGroupRole>([[ALICE, 'admin'], [BOB, 'member']])],
    [G_GONE, new Map<string, SocialGroupRole>([[ALICE, 'admin']])],
  ]);
  failFor?: string;

  async getGroup(_t: string, id: string) {
    if (this.failFor === id) throw new Error('Không tra được nhóm.');
    return this.infos.get(id);
  }
  async membershipOf(_t: string, groupId: string, userId: string): Promise<GroupMembershipInfo | undefined> {
    const role = this.members.get(groupId)?.get(userId);
    return role ? { role, joinedAt: '2026-01-01T00:00:00.000Z' } : undefined;
  }
  async isMember(t: string, groupId: string, userId: string) {
    return (await this.membershipOf(t, groupId, userId)) !== undefined;
  }
  async isAdmin(_t: string, groupId: string, userId: string) {
    return this.members.get(groupId)?.get(userId) === 'admin';
  }
  async memberGroupIds(_t: string, userId: string) {
    return [...this.members].filter(([id, m]) => m.has(userId) && !this.infos.get(id)?.deleted).map(([id]) => id);
  }
  async listMemberIds(_t: string, groupId: string) {
    return [...(this.members.get(groupId)?.keys() ?? [])];
  }
  async listAdminIds(_t: string, groupId: string) {
    return [...(this.members.get(groupId) ?? [])].filter(([, role]) => role === 'admin').map(([id]) => id);
  }
  async groupRefs() {
    return new Map();
  }
}

class FakeViewerScopes implements ViewerScopePort {
  /** Đặt để mô phỏng Tenant Core lỗi: không ai có phòng ban. */
  failing = false;
  async scopeOf(_t: string, userId: string): Promise<ViewerScope> {
    return { userId, unitIds: this.failing ? [] : (USER_UNITS[userId] ?? []) };
  }
  async scopesOf(t: string, userIds: readonly string[]) {
    return new Map(await Promise.all(userIds.map(async (id) => [id.toLowerCase(), await this.scopeOf(t, id)] as const)));
  }
  async authorUnitOf(_t: string, userId: string) {
    return this.failing ? undefined : AUTHOR_UNIT[userId];
  }
}

class FakeOrgs implements Pick<OrgStructurePort, 'nodeRefs' | 'listNodes'> {
  readonly nodes: SocialOrgNode[] = [
    { id: UNIT_PARENT, name: 'Khối vận hành', kind: 'unit', memberCount: 3 },
    { id: UNIT_CHILD, name: 'Phòng Kho', kind: 'unit', parentName: 'Khối vận hành', parentId: UNIT_PARENT, memberCount: 1 },
    { id: UNIT_OTHER, name: 'Phòng Kế toán', kind: 'unit', memberCount: 1 },
  ];
  async nodeRefs(_t: string, ids: readonly string[]) {
    return new Map<string, SocialUnitRef>(
      ids.flatMap((id) => {
        const node = this.nodes.find((n) => n.id === id.toLowerCase());
        return node ? [[id.toLowerCase(), { id: node.id, name: node.name, kind: node.kind }] as const] : [];
      }),
    );
  }
  async listNodes() {
    return this.nodes;
  }
}

class FakePosting implements GroupPostingPort {
  /** Nhóm chỉ cho admin đăng (`post_permission = 'admins'`). */
  adminsOnly = new Set<string>();
  constructor(private readonly groups: FakeGroups) {}
  async canPost(_t: string, groupId: string, userId: string): Promise<GroupPostingDecision> {
    const info = this.groups.infos.get(groupId);
    if (!info || info.deleted) return { allowed: false, reason: 'group-missing' };
    const role = this.groups.members.get(groupId)?.get(userId);
    if (!role) return { allowed: false, reason: 'not-member' };
    if (this.adminsOnly.has(groupId) && role !== 'admin') return { allowed: false, reason: 'restricted' };
    return { allowed: true };
  }
  async topicsOfGroup(_t: string, groupId: string, ids: readonly string[]) {
    return new Map<string, GroupTopicRef>(
      groupId === G_PUBLIC ? ids.filter((id) => id === TOPIC_A).map((id) => [id, { id, name: 'Chủ đề A' }] as const) : [],
    );
  }
  async topicRefs(_t: string, ids: readonly string[]) {
    return new Map<string, GroupTopicRef>(
      ids.filter((id) => id === TOPIC_A || id === TOPIC_FOREIGN).map((id) => [id, { id, name: id === TOPIC_A ? 'Chủ đề A' : 'Chủ đề B' }] as const),
    );
  }
}

class FakeVisibility implements PostVisibilityPort {
  constructor(
    private readonly groups: FakeGroups,
    private readonly scopes: FakeViewerScopes = new FakeViewerScopes(),
  ) {}
  async scopeFor(who: SocialActor): Promise<PostVisibilityScope> {
    return {
      viewerId: who.userId,
      seesAllGroups: mayManage(who),
      canModerate: mayModerate(who),
      memberGroupIds: await this.groups.memberGroupIds(who.tenantId, who.userId),
      unitIds: (await this.scopes.scopeOf(who.tenantId, who.userId)).unitIds,
    };
  }
  async canView(who: SocialActor, subject: PostVisibilitySubject): Promise<boolean> {
    return canViewPostInScope(await this.scopeFor(who), subject);
  }
}

class FakeSettings implements SocialSettingsPort {
  value: SocialSettings = { wallRequireApproval: false };
  async get() {
    return this.value;
  }
  async update(_t: string, patch: UpdateSocialSettingsRequest) {
    this.value = { ...this.value, ...patch };
    return this.value;
  }
}

class FakeDirectory implements OrganizationDirectory {
  async resolve(_t: string, ids: readonly string[]) {
    return new Map(ids.flatMap((id) => (NAMES[id.toLowerCase()] ? [[id.toLowerCase(), NAMES[id.toLowerCase()]] as const] : [])));
  }
  async search() {
    return [];
  }
}

interface FakePoll {
  id: string;
  postId: string;
  question: string;
  allowMultiple: boolean;
  anonymous: boolean;
  closesAt?: string;
  closedAt?: string;
  options: { id: string; text: string }[];
  votes: { optionId: string; userId: string; votedAt: string }[];
}

type StoredRow = ExtendedPostRow & { audienceUserIds?: readonly string[]; audienceUnitIds?: readonly string[] };

interface StoredEdit extends PostEditRecord {
  readonly postId: string;
}

class FakePublishingStore implements SocialPublishingStore {
  rows = new Map<string, StoredRow>();
  mentions = new Map<string, string[]>();
  polls = new Map<string, FakePoll>();
  confirmations = new Map<string, ReadConfirmationRecord[]>();
  bookmarks: { userId: string; postId: string; at: string; folderId?: string }[] = [];
  folders: { id: string; userId: string; name: string }[] = [];
  reactions = new Map<string, SocialReactionType>();
  events: SocialOutboxEvent[] = [];
  edits: StoredEdit[] = [];
  private tick = 0;

  constructor(
    private readonly groups: FakeGroups,
    private readonly clock: { now: Date },
  ) {}

  stamp(): string {
    this.tick += 1;
    return new Date(this.clock.now.getTime() + this.tick).toISOString();
  }

  /** Dựng bài trực tiếp (bài tự sinh, bài có dữ liệu cũ...). */
  seed(row: Partial<StoredRow> & { id: string; authorId: string; status: StoredRow['status'] }): void {
    const group = row.groupId ? this.groups.infos.get(row.groupId) : undefined;
    this.rows.set(row.id, {
      kind: 'post',
      bodyHtml: '<p>nội dung</p>',
      pinned: false,
      mentionsAll: false,
      publishedAt: this.stamp(),
      commentCount: 0,
      requiresReadConfirmation: false,
      ...(group
        ? { groupName: group.name, groupPrivacy: group.privacy, groupColor: group.color, groupIcon: group.icon, groupDeleted: group.deleted }
        : {}),
      ...row,
    });
  }

  private withGroup(row: StoredRow): StoredRow {
    if (!row.groupId) return row;
    const group = this.groups.infos.get(row.groupId);
    return group
      ? { ...row, groupName: group.name, groupPrivacy: group.privacy, groupColor: group.color, groupIcon: group.icon, groupDeleted: group.deleted }
      : row;
  }

  async findForWrite(_t: string, id: string): Promise<WritablePostRow | undefined> {
    const row = this.rows.get(id);
    return row && row.status !== 'deleted' ? this.withGroup(row) : undefined;
  }
  async mentionsOf(_t: string, id: string) {
    return this.mentions.get(id) ?? [];
  }

  async insert(_t: string, input: PublishingPostInsert) {
    this.rows.set(input.id, {
      id: input.id,
      authorId: input.authorId,
      kind: input.kind,
      ...(input.title ? { title: input.title } : {}),
      bodyHtml: input.bodyHtml,
      ...(input.topicId ? { topicId: input.topicId } : {}),
      pinned: input.pinned,
      mentionsAll: input.mentionsAll,
      mediaLayout: input.mediaLayout ?? 'auto',
      publishedAt: input.scheduledAt ?? this.stamp(),
      commentCount: 0,
      status: input.status,
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
      ...(input.status === 'scheduled' && input.exemptFromApproval ? { moderatedBy: input.authorId } : {}),
      requiresReadConfirmation: input.requiresReadConfirmation,
      visibility: input.visibility ?? 'company',
      ...(input.authorUnitId ? { authorUnitId: input.authorUnitId } : {}),
      commentsDisabled: input.commentsDisabled === true,
      editCount: 0,
      ...(input.groupTopicId ? { groupTopicId: input.groupTopicId } : {}),
      ...(input.visibility === 'custom' && input.audience
        ? { audienceUserIds: [...input.audience.userIds], audienceUnitIds: [...input.audience.unitIds] }
        : {}),
    });
    this.mentions.set(input.id, [...input.mentionUserIds]);
    if (input.poll) {
      this.polls.set(input.id, {
        id: input.poll.id,
        postId: input.id,
        question: input.poll.question,
        allowMultiple: input.poll.allowMultiple,
        anonymous: input.poll.anonymous,
        ...(input.poll.closesAt ? { closesAt: input.poll.closesAt } : {}),
        options: input.poll.options.map((o) => ({ ...o })),
        votes: [],
      });
    }
    this.events.push(...input.events);
  }

  async update(_t: string, id: string, patch: PublishingPostPatch) {
    const row = this.rows.get(id);
    if (!row || row.status !== patch.expectedStatus) throw new SocialPostStateError();
    const next: StoredRow = { ...row };
    const mutable = next as { -readonly [K in keyof StoredRow]: StoredRow[K] };
    if (patch.title !== undefined) mutable.title = patch.title ?? undefined;
    if (patch.bodyHtml !== undefined) mutable.bodyHtml = patch.bodyHtml;
    if (patch.mediaLayout !== undefined) mutable.mediaLayout = patch.mediaLayout;
    if (patch.scheduledAt !== undefined) {
      mutable.scheduledAt = patch.scheduledAt;
      mutable.publishedAt = patch.scheduledAt;
    }
    if (patch.requiresReadConfirmation !== undefined) mutable.requiresReadConfirmation = patch.requiresReadConfirmation;
    if (patch.visibility !== undefined) mutable.visibility = patch.visibility;
    if (patch.authorUnitId !== undefined) mutable.authorUnitId = patch.authorUnitId ?? undefined;
    if (patch.commentsDisabled !== undefined) mutable.commentsDisabled = patch.commentsDisabled;
    if (patch.groupTopicId !== undefined) mutable.groupTopicId = patch.groupTopicId ?? undefined;
    if (patch.audience !== undefined) {
      mutable.audienceUserIds = [...patch.audience.userIds];
      mutable.audienceUnitIds = [...patch.audience.unitIds];
    }
    const textChanged =
      (patch.title !== undefined && (patch.title ?? undefined) !== row.title) ||
      (patch.bodyHtml !== undefined && patch.bodyHtml !== row.bodyHtml);
    if (row.status === 'published' && !patch.resubmitAs && textChanged) {
      this.edits.push({
        postId: id,
        version: (row.editCount ?? 0) + 1,
        ...(row.title ? { title: row.title } : {}),
        bodyHtml: row.bodyHtml,
        editedBy: patch.editorId ?? patch.uploaderId,
        editedAt: this.stamp(),
      });
      mutable.editCount = (row.editCount ?? 0) + 1;
    }
    if (patch.resubmitAs) {
      mutable.status = patch.resubmitAs;
      mutable.publishedAt = this.stamp();
      mutable.rejectReason = undefined;
      mutable.moderatedBy = undefined;
    } else if (
      row.status === 'published' &&
      (textChanged ||
        patch.topicId !== undefined ||
        patch.mediaLayout !== undefined ||
        (patch.mentionUserIds !== undefined && patch.visibility === undefined) ||
        patch.attachmentIds !== undefined)
    ) {
      mutable.editedAt = this.stamp();
    }
    this.rows.set(id, next);
    if (patch.mentionUserIds) this.mentions.set(id, [...patch.mentionUserIds]);
    if (patch.pollClosesAt !== undefined) {
      const poll = this.polls.get(id);
      if (poll) poll.closesAt = patch.pollClosesAt ?? undefined;
    }
    this.events.push(...patch.events);
  }

  async transition(_t: string, id: string, t: PostTransition) {
    const row = this.rows.get(id);
    if (!row || !t.from.includes(row.status)) throw new SocialPostStateError();
    this.rows.set(id, {
      ...row,
      status: t.to,
      ...(t.to === 'rejected' ? { rejectReason: t.rejectReason } : { rejectReason: undefined }),
      ...(t.to !== 'rejected' ? { publishedAt: this.stamp() } : {}),
      ...(t.moderatedBy ? { moderatedBy: t.moderatedBy, moderatedAt: this.stamp() } : {}),
    });
    this.events.push(...t.events);
  }

  async softDelete(_t: string, id: string, _u: string, events: readonly SocialOutboxEvent[]) {
    const row = this.rows.get(id);
    if (!row || row.status === 'deleted') throw new SocialPostNotFoundError();
    this.rows.set(id, { ...row, status: 'deleted', pinned: false });
    this.events.push(...events);
  }

  async setPinned(_t: string, id: string, pinned: boolean, events: readonly SocialOutboxEvent[]) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'published') throw new SocialPostStateError();
    this.rows.set(id, { ...row, pinned });
    this.events.push(...events);
  }

  async publishNextDue(
    _t: string,
    now: string,
    excludeIds: readonly string[],
    decide: (post: ExtendedPostRow) => Promise<DueDecision>,
  ) {
    const due = [...this.rows.values()]
      .filter((r) => r.status === 'scheduled' && r.scheduledAt && r.scheduledAt <= now && !excludeIds.includes(r.id))
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') || a.id.localeCompare(b.id))[0];
    if (!due) return undefined;
    const decision = await decide(this.withGroup(due));
    this.rows.set(due.id, { ...due, status: decision.to, publishedAt: this.stamp() });
    this.events.push(...decision.events);
    return { postId: due.id, outcome: decision.to };
  }

  private visibleTo(scope: PostVisibilityScope, rows: StoredRow[]) {
    return rows.map((r) => this.withGroup(r)).filter((r) => canViewPostInScope(scope, r));
  }

  async listByAuthor(
    _t: string,
    authorId: string,
    status: 'pending' | 'scheduled' | 'rejected',
    scope: PostVisibilityScope,
    query: PostListQuery,
  ) {
    const rows = [...this.rows.values()].filter((r) => r.authorId === authorId && r.status === status);
    return (this.visibleTo(scope, rows))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, query.limit);
  }
  async listPending(_t: string, scope: PostVisibilityScope, query: PostListQuery) {
    const rows = [...this.rows.values()].filter((r) => r.status === 'pending' && !r.groupId);
    return (this.visibleTo(scope, rows))
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
      .slice(0, query.limit);
  }
  async counts(_t: string, userId: string, canModerate: boolean, scope: PostVisibilityScope): Promise<InboxCountsRow> {
    const all = this.visibleTo(scope, [...this.rows.values()]);
    const mine = (s: string) => all.filter((r) => r.authorId === userId && r.status === s).length;
    return {
      myPending: mine('pending'),
      myScheduled: mine('scheduled'),
      myRejected: mine('rejected'),
      toModerate: canModerate ? all.filter((r) => r.status === 'pending' && !r.groupId).length : 0,
      bookmarks: all.filter((r) => r.status === 'published' && this.bookmarks.some((b) => b.userId === userId && b.postId === r.id)).length,
    };
  }

  async engagement(_t: string, postIds: readonly string[], viewerId: string): Promise<PostEngagementRelations> {
    const polls = new Map<string, PollRow>();
    const readConfirmations = new Map<string, ReadConfirmationRow>();
    for (const id of postIds) {
      const poll = this.polls.get(id);
      if (poll) {
        polls.set(id, {
          id: poll.id,
          postId: id,
          question: poll.question,
          allowMultiple: poll.allowMultiple,
          anonymous: poll.anonymous,
          ...(poll.closesAt ? { closesAt: poll.closesAt } : {}),
          ...(poll.closedAt ? { closedAt: poll.closedAt } : {}),
          options: poll.options.map((o, position) => ({
            id: o.id,
            text: o.text,
            position,
            voteCount: poll.votes.filter((v) => v.optionId === o.id).length,
          })),
          totalVoters: new Set(poll.votes.map((v) => v.userId)).size,
          myOptionIds: poll.votes.filter((v) => v.userId === viewerId).map((v) => v.optionId),
        });
      }
      if (this.rows.get(id)?.requiresReadConfirmation) {
        const list = this.confirmations.get(id) ?? [];
        const mine = list.find((c) => c.userId === viewerId);
        readConfirmations.set(id, {
          confirmedByMe: !!mine,
          ...(mine ? { confirmedAt: mine.confirmedAt } : {}),
          confirmedCount: list.length,
        });
      }
    }
    const audiences = new Map<string, PostAudienceRow>();
    for (const id of postIds) {
      const row = this.rows.get(id);
      if (row?.visibility === 'custom' && row.authorId === viewerId) {
        audiences.set(id, { userIds: row.audienceUserIds ?? [], unitIds: row.audienceUnitIds ?? [] });
      }
    }
    return {
      polls,
      readConfirmations,
      bookmarkedPostIds: new Set(this.bookmarks.filter((b) => b.userId === viewerId).map((b) => b.postId)),
      bookmarkFolderIds: new Map(
        this.bookmarks.flatMap((b) => (b.userId === viewerId && b.folderId ? [[b.postId, b.folderId] as const] : [])),
      ),
      audiences,
    };
  }

  async vote(
    _t: string,
    input: { postId: string; pollId: string; userId: string; optionIds: readonly string[]; events: readonly SocialOutboxEvent[] },
  ) {
    const poll = this.polls.get(input.postId);
    if (!poll) throw new SocialPostNotFoundError();
    if (poll.closedAt || (poll.closesAt && poll.closesAt <= this.clock.now.toISOString())) throw new SocialPollClosedError();
    poll.votes = poll.votes.filter((v) => v.userId !== input.userId);
    for (const optionId of input.optionIds) poll.votes.push({ optionId, userId: input.userId, votedAt: this.stamp() });
    this.events.push(...input.events);
  }
  async closePoll(_t: string, pollId: string, _u: string, events: readonly SocialOutboxEvent[]) {
    const poll = [...this.polls.values()].find((p) => p.id === pollId);
    if (!poll || poll.closedAt) throw new SocialPollClosedError();
    poll.closedAt = this.stamp();
    this.events.push(...events);
  }
  async listVoters(_t: string, pollId: string, optionId: string | undefined, limit: number, offset: number): Promise<PollVoterRow[]> {
    const poll = [...this.polls.values()].find((p) => p.id === pollId);
    return (poll?.votes ?? [])
      .filter((v) => !optionId || v.optionId === optionId)
      .slice(offset, offset + limit);
  }

  async confirmRead(_t: string, postId: string, userId: string) {
    const list = this.confirmations.get(postId) ?? [];
    if (!list.some((c) => c.userId === userId)) list.push({ userId, confirmedAt: this.stamp() });
    this.confirmations.set(postId, list);
  }
  async listConfirmations(_t: string, postId: string) {
    return this.confirmations.get(postId) ?? [];
  }

  async setBookmark(_t: string, postId: string, userId: string, bookmarked: boolean, folderId?: string | null) {
    const previous = this.bookmarks.find((b) => b.postId === postId && b.userId === userId);
    this.bookmarks = this.bookmarks.filter((b) => b !== previous);
    if (!bookmarked) return;
    const folder = folderId === undefined ? previous?.folderId : (folderId ?? undefined);
    this.bookmarks.push({ userId, postId, at: previous?.at ?? this.stamp(), ...(folder ? { folderId: folder } : {}) });
  }
  async listBookmarkFolders(_t: string, userId: string): Promise<BookmarkFolderSummary> {
    const mine = this.bookmarks.filter((b) => b.userId === userId && this.rows.get(b.postId)?.status === 'published');
    return {
      folders: this.folders
        .filter((f) => f.userId === userId)
        .map((f) => ({ id: f.id, name: f.name, count: mine.filter((b) => b.folderId === f.id).length })),
      unfiledCount: mine.filter((b) => !b.folderId).length,
    };
  }
  async createBookmarkFolder(_t: string, userId: string, name: string): Promise<BookmarkFolderRow> {
    const existing = this.folders.find((f) => f.userId === userId && f.name.toLowerCase() === name.toLowerCase());
    const folder = existing ?? { id: randomUUID(), userId, name };
    if (!existing) this.folders.push(folder);
    return { id: folder.id, name: folder.name, count: 0 };
  }
  async renameBookmarkFolder(_t: string, userId: string, folderId: string, name: string) {
    const folder = this.folders.find((f) => f.id === folderId && f.userId === userId);
    if (folder) folder.name = name;
  }
  async deleteBookmarkFolder(_t: string, userId: string, folderId: string) {
    this.folders = this.folders.filter((f) => !(f.id === folderId && f.userId === userId));
    this.bookmarks = this.bookmarks.map((b) => (b.userId === userId && b.folderId === folderId ? { ...b, folderId: undefined } : b));
  }
  async bookmarkFolderExists(_t: string, userId: string, folderId: string) {
    return this.folders.some((f) => f.id === folderId && f.userId === userId);
  }
  async listBookmarks(_t: string, userId: string, scope: PostVisibilityScope, query: BookmarkListQuery): Promise<BookmarkedPostRow[]> {
    const mine = this.bookmarks
      .filter((b) => b.userId === userId)
      .filter((b) => (query.folderId === undefined ? true : query.folderId === 'none' ? !b.folderId : b.folderId === query.folderId))
      .sort((a, b) => b.at.localeCompare(a.at));
    const out: BookmarkedPostRow[] = [];
    for (const b of mine) {
      const row = this.rows.get(b.postId);
      if (row && row.status === 'published' && canViewPostInScope(scope, this.withGroup(row))) {
        out.push({ post: this.withGroup(row), bookmarkedAt: b.at });
      }
    }
    return out.slice(0, query.limit);
  }

  async setReaction(
    _t: string,
    input: { postId: string; userId: string; type: SocialReactionType | null; events: readonly SocialOutboxEvent[] },
  ) {
    const key = `${input.postId}|${input.userId}`;
    if (input.type === null) this.reactions.delete(key);
    else this.reactions.set(key, input.type);
    this.events.push(...input.events);
  }
}

/** Phần `SocialStore` của P1 mà đường ghi dùng: chuyên mục, quan hệ bài, phản ứng. */
function fakeSocialStore(publishing: FakePublishingStore, files: ReadonlyMap<string, AttachmentRow>): SocialStore {
  const store = {
    topics: {
      findById: async () => undefined,
    },
    posts: {
      relations: async (_t: string, ids: readonly string[], viewerId: string) => {
        const mentions = new Map<string, string[]>();
        const attachments = new Map();
        const reactions = new Map();
        for (const id of ids) {
          mentions.set(id, publishing.mentions.get(id) ?? []);
          attachments.set(
            id,
            [...files.values()].filter((file) => file.postId === id && file.completed),
          );
          const counts: Partial<Record<SocialReactionType, number>> = {};
          let total = 0;
          let mine: SocialReactionType | undefined;
          for (const [key, type] of publishing.reactions) {
            if (!key.startsWith(`${id}|`)) continue;
            counts[type] = (counts[type] ?? 0) + 1;
            total += 1;
            if (key.endsWith(`|${viewerId}`)) mine = type;
          }
          reactions.set(id, { counts, total, ...(mine ? { mine } : {}) });
        }
        return { mentions, attachments, reactions };
      },
    },
    reactions: {
      summary: async (_t: string, postId: string, viewerId: string) => {
        const counts: Partial<Record<SocialReactionType, number>> = {};
        let total = 0;
        let mine: SocialReactionType | undefined;
        for (const [key, type] of publishing.reactions) {
          if (!key.startsWith(`${postId}|`)) continue;
          counts[type] = (counts[type] ?? 0) + 1;
          total += 1;
          if (key.endsWith(`|${viewerId}`)) mine = type;
        }
        return { counts, total, ...(mine ? { mine } : {}) };
      },
      list: async () => [],
    },
    comments: {
      insert: async (_t: string, input: { events: readonly SocialOutboxEvent[] }) => {
        publishing.events.push(...input.events);
      },
      findById: async () => undefined,
      mentions: async () => new Map(),
      list: async () => [],
    },
  };
  return store as unknown as SocialStore;
}

function harness() {
  const clock = { now: new Date('2026-03-01T08:00:00.000Z') };
  const groups = new FakeGroups();
  const viewerScopes = new FakeViewerScopes();
  const orgs = new FakeOrgs();
  const posting = new FakePosting(groups);
  const visibility = new FakeVisibility(groups, viewerScopes);
  const store = new FakePublishingStore(groups, clock);
  // Tệp đính kèm giả: tests đặt dòng vào `files`; `deletedKeys` ghi các khoá bị xoá khỏi kho.
  const files = new Map<string, AttachmentRow>();
  const deletedKeys: string[] = [];
  const social = fakeSocialStore(store, files);
  const settings = new FakeSettings();
  const directory = new FakeDirectory();
  const people = { listActiveUserIds: async () => [ALICE, BOB, CAROL, DAVE] };
  const storage = { createDownloadUrl: async () => 'https://files.test/x' } as never;
  const now = () => clock.now;

  const access = new SocialPostAccess(store, visibility, groups);
  const assembler = new SocialPostViewAssembler({
    store: social,
    publishing: store,
    directory,
    storage,
    groups,
    people,
    topics: posting,
    orgs,
    now,
  });
  const events = new PublishedEventBuilder(directory, groups, store);
  const audience = new ReadAudience(people, groups);

  return {
    clock,
    files,
    deletedKeys,
    groups,
    viewerScopes,
    posting,
    store,
    settings,
    history: new SocialPostHistoryService({
      store: { list: async (_t: string, postId: string) => store.edits.filter((e) => e.postId === postId).sort((a, b) => b.version - a.version) },
      access,
      directory,
    }),
    publishing: new SocialPublishingService({
      store,
      social,
      attachments: {
        findById: async (_t: string, id: string) => files.get(id),
        deleteByIds: async (_t: string, ids: readonly string[]) => {
          for (const id of ids) files.delete(id);
        },
        listForPost: async (_t: string, postId: string) =>
          [...files.values()]
            .filter((file) => file.postId === postId)
            .map((file) => ({
              id: file.id,
              storageKey: file.storageKey,
              ...(file.posterKey ? { posterKey: file.posterKey } : {}),
              ...(file.sourceKey ? { sourceKey: file.sourceKey } : {}),
            })),
        deleteAttachedByIds: async (_t: string, ids: readonly string[]) => {
          for (const id of ids) files.delete(id);
        },
      },
      storage: {
        deleteObjects: async (keys: readonly string[]) => {
          deletedKeys.push(...keys);
          return { failed: [] };
        },
      },
      directory,
      groups,
      settings,
      access,
      assembler,
      events,
      posting,
      viewerScopes,
      orgs,
      now,
    }),
    moderation: new SocialModerationService({ store, access, visibility, assembler, events }),
    scheduler: new SocialSchedulerService({ store, groups, settings, events }),
    polls: new SocialPollService({ store, access, assembler, directory, now }),
    confirmations: new SocialReadConfirmationService({ store, access, assembler, directory, audience }),
    bookmarks: new SocialBookmarkService({ store, access, visibility, assembler }),
    myPosts: new SocialMyPostsService({ store, visibility, assembler }),
    settingsService: new SocialSettingsService(settings),
    reactions: new SocialReactionService(social, directory, { access, store }),
    comments: new SocialCommentService(social, directory, access, viewerScopes),
  };
}

const BODY = '<p>Xin chào mọi người</p>';

async function expectError(promise: Promise<unknown>, code: string, status?: number): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SocialError);
  expect((error as SocialError).code).toBe(code);
  if (status) expect((error as SocialError).statusCode).toBe(status);
}

const types = (events: readonly SocialOutboxEvent[]) => events.map((event) => event.type);
const iso = (offsetSeconds: number, from = new Date('2026-03-01T08:00:00.000Z')) =>
  new Date(from.getTime() + offsetSeconds * 1000).toISOString();

/* ---------------------------------------------------------------- tạo bài */

describe('tạo bài', () => {
  it('đăng ngay bài Tường công ty: published, phát post.published origin direct', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, title: 'Chào tuần mới', mentionUserIds: [BOB] });
    expect(post.status).toBe('published');
    expect(post.group).toBeUndefined();
    expect(post.author.name).toBe('Alice Nguyễn');
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postPublished, SOCIAL_EVENT_TYPES.mentioned]);
    expect(h.store.events[0].payload).toMatchObject({ postId: post.id, origin: 'direct', authorName: 'Alice Nguyễn' });
  });

  it('bật duyệt: người thường vào pending và chỉ phát post.pending; moderator đăng thẳng', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const pending = await h.publishing.create(alice, { bodyHtml: BODY });
    expect(pending.status).toBe('pending');
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postPending]);
    expect(h.store.events[0].payload).toMatchObject({ postId: pending.id, authorName: 'Alice Nguyễn' });

    h.store.events.length = 0;
    const direct = await h.publishing.create(moderator, { bodyHtml: BODY });
    expect(direct.status).toBe('published');
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postPublished]);
  });

  it('cài đặt duyệt không áp cho bài nhóm', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const post = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    expect(post.status).toBe('published');
    expect(post.group).toMatchObject({ id: G_PUBLIC, name: 'Cộng đồng', privacy: 'public' });
  });

  it('hẹn giờ: scheduled, kèm scheduledAt, chưa phát sự kiện nào', async () => {
    const h = harness();
    const at = iso(3600);
    const post = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: at, mentionUserIds: [BOB] });
    expect(post.status).toBe('scheduled');
    expect(post.scheduledAt).toBe(at);
    expect(post.capabilities).toMatchObject({ canPublishNow: true, canReschedule: true });
    expect(h.store.events).toEqual([]);
  });

  it('giờ hẹn phải cách ít nhất 60 giây và không quá 365 ngày', async () => {
    const h = harness();
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(30) }), 'VALIDATION', 400);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(-3600) }), 'VALIDATION');
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(366 * 86400) }), 'VALIDATION');
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: 'không phải ngày' }), 'VALIDATION');
    await expect(h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(61) })).resolves.toMatchObject({
      status: 'scheduled',
    });
  });

  it('bài nhóm: phải là thành viên; nhóm riêng tư người ngoài thấy như không có; nhóm đã xoá là 404', async () => {
    const h = harness();
    await expectError(h.publishing.create(dave, { bodyHtml: BODY, groupId: G_PUBLIC }), 'GROUP_NOT_MEMBER', 403);
    await expectError(h.publishing.create(dave, { bodyHtml: BODY, groupId: G_PRIVATE }), 'GROUP_NOT_FOUND', 404);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, groupId: G_GONE }), 'GROUP_NOT_FOUND', 404);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, groupId: MISSING }), 'GROUP_NOT_FOUND', 404);
    // quản trị toàn hệ thống thấy nhóm riêng tư nhưng vẫn phải là thành viên mới đăng được
    await expectError(h.publishing.create(manager, { bodyHtml: BODY, groupId: G_PRIVATE }), 'GROUP_NOT_MEMBER', 403);
  });

  it('bài nhóm không có chuyên mục', async () => {
    const h = harness();
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC, topicId: MISSING }),
      'VALIDATION',
    );
  });

  it('thông báo, ghim, @all: moderator ở Tường công ty, admin nhóm ở bài nhóm', async () => {
    const h = harness();
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, kind: 'announcement' }), 'FORBIDDEN', 403);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, pinned: true }), 'FORBIDDEN');
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, mentionsAll: true }), 'FORBIDDEN');
    await expectError(h.publishing.create(bob, { bodyHtml: BODY, kind: 'announcement', groupId: G_PUBLIC }), 'FORBIDDEN');
    // moderator không phải admin nhóm thì không đăng thông báo vào nhóm (và cũng chưa là thành viên)
    await expect(h.publishing.create(moderator, { bodyHtml: BODY, kind: 'announcement' })).resolves.toMatchObject({
      kind: 'announcement',
    });
    await expect(
      h.publishing.create(alice, { bodyHtml: BODY, kind: 'announcement', groupId: G_PUBLIC }),
    ).resolves.toMatchObject({ kind: 'announcement' });
  });

  it('thông báo nhóm: sự kiện mang groupId, groupName và người nhận (thành viên trừ tác giả)', async () => {
    const h = harness();
    await h.publishing.create(alice, { bodyHtml: BODY, kind: 'announcement', groupId: G_PUBLIC });
    expect(h.store.events[0].payload).toMatchObject({
      groupId: G_PUBLIC,
      groupName: 'Cộng đồng',
      recipientUserIds: [BOB],
      kind: 'announcement',
    });
  });

  it('bài nhóm thường không gắn người nhận; bài cần xác nhận đã đọc thì có', async () => {
    const h = harness();
    await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    expect(h.store.events[0].payload).not.toHaveProperty('recipientUserIds');
    h.store.events.length = 0;
    await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, requiresReadConfirmation: true });
    expect(h.store.events[0].payload).toMatchObject({ recipientUserIds: [ALICE], requiresReadConfirmation: true });
  });

  it('bình chọn: chỉ bình chọn không chữ vẫn hợp lệ; sai thì 400', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, {
      bodyHtml: '',
      poll: { question: 'Họp ngày nào?', options: ['Thứ hai', 'Thứ ba'], anonymous: true },
    });
    expect(post.poll).toMatchObject({ question: 'Họp ngày nào?', anonymous: true, allowMultiple: false, canVote: true });
    expect(post.poll?.options.map((o) => o.text)).toEqual(['Thứ hai', 'Thứ ba']);

    await expectError(h.publishing.create(alice, { bodyHtml: '' }), 'VALIDATION');
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, poll: { question: 'Hỏi', options: ['Một'] } }), 'VALIDATION');
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, poll: { question: 'Hỏi', options: ['Có', 'có'] } }),
      'VALIDATION',
    );
    await expectError(
      h.publishing.create(alice, {
        bodyHtml: BODY,
        poll: { question: 'Hỏi', options: Array.from({ length: 11 }, (_, i) => `Lựa chọn ${i}`) },
      }),
      'VALIDATION',
    );
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, poll: { question: 'Hỏi', options: ['A', 'B'], closesAt: iso(-60) } }),
      'VALIDATION',
    );
  });
});

/* ---------------------------------------------------------- nhìn thấy bài */

describe('luật nhìn thấy bài', () => {
  it('bài nhóm riêng tư: người ngoài nhóm nhận 404 ở mọi thao tác', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PRIVATE });
    await expectError(h.publishing.get(dave, post.id), 'POST_NOT_FOUND', 404);
    await expectError(h.reactions.set(dave, post.id, { type: 'like' }), 'POST_NOT_FOUND');
    await expectError(h.comments.create(dave, post.id, { body: 'Xin chào' }), 'POST_NOT_FOUND');
    await expectError(h.bookmarks.set(dave, post.id, { bookmarked: true }), 'POST_NOT_FOUND');
    await expectError(h.publishing.remove(moderator, post.id), 'POST_NOT_FOUND');
    await expect(h.publishing.get(bob, post.id)).resolves.toMatchObject({ id: post.id });
    // quản trị toàn hệ thống thấy nhóm riêng tư
    await expect(h.publishing.get(manager, post.id)).resolves.toMatchObject({ id: post.id });
  });

  it('bài pending/scheduled/rejected chỉ tác giả và moderator xem được', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.get(bob, post.id), 'POST_NOT_FOUND');
    await expect(h.publishing.get(alice, post.id)).resolves.toMatchObject({ status: 'pending' });
    await expect(h.publishing.get(moderator, post.id)).resolves.toMatchObject({
      status: 'pending',
      capabilities: { canModerate: true },
    });
  });

  it('bài chưa đăng không nhận phản ứng, bình luận, bình chọn, xác nhận đã đọc, đã lưu', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const post = await h.publishing.create(alice, {
      bodyHtml: BODY,
      requiresReadConfirmation: true,
      poll: { question: 'Hỏi', options: ['A', 'B'] },
    });
    await expectError(h.reactions.set(alice, post.id, { type: 'like' }), 'POST_STATE', 409);
    await expectError(h.comments.create(alice, post.id, { body: 'Xin chào' }), 'POST_STATE', 409);
    await expectError(h.polls.vote(alice, post.id, { optionIds: [] }), 'POST_STATE');
    await expectError(h.confirmations.confirm(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.bookmarks.set(alice, post.id, { bookmarked: true }), 'POST_STATE');
  });

  it('phản ứng đã đăng phát social.reaction.changed kèm groupId của bài nhóm', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PRIVATE });
    h.store.events.length = 0;
    const summary = await h.reactions.set(bob, post.id, { type: 'love' });
    expect(summary).toMatchObject({ reactionTotal: 1, myReaction: 'love' });
    expect(h.store.events).toHaveLength(1);
    expect(h.store.events[0]).toMatchObject({
      type: SOCIAL_EVENT_TYPES.reactionChanged,
      payload: { postId: post.id, groupId: G_PRIVATE, actorId: BOB },
    });
    await h.reactions.set(bob, post.id, { type: null });
    expect((await h.reactions.summary(bob, post.id)).reactionTotal).toBe(0);
  });

  it('bình luận bài nhóm gắn groupId vào sự kiện comment.created', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC });
    h.store.events.length = 0;
    // Bản giả của comments không dựng được bình luận để đọc lại, nên chỉ kiểm sự kiện.
    await h.comments.create(bob, post.id, { body: 'Hay quá' }).catch(() => undefined);
    const created = h.store.events.find((e) => e.type === SOCIAL_EVENT_TYPES.commentCreated);
    expect(created?.payload).toMatchObject({ postId: post.id, groupId: G_PUBLIC });
  });
});

/* ------------------------------------------------------------ duyệt bài */

describe('duyệt và từ chối', () => {
  async function pendingPost(h: ReturnType<typeof harness>) {
    h.settings.value = { wallRequireApproval: true };
    const post = await h.publishing.create(alice, { bodyHtml: BODY, title: 'Cần duyệt', mentionUserIds: [BOB] });
    h.store.events.length = 0;
    return post;
  }

  it('duyệt: published, phát moderated rồi published origin approved (kèm nhắc tên)', async () => {
    const h = harness();
    const post = await pendingPost(h);
    const approved = await h.moderation.approve(moderator, post.id);
    expect(approved.status).toBe('published');
    expect(types(h.store.events)).toEqual([
      SOCIAL_EVENT_TYPES.postModerated,
      SOCIAL_EVENT_TYPES.postPublished,
      SOCIAL_EVENT_TYPES.mentioned,
    ]);
    expect(h.store.events[0].payload).toMatchObject({ decision: 'approved', moderatorId: CAROL, authorId: ALICE });
    expect(h.store.events[1].payload).toMatchObject({ origin: 'approved', authorId: ALICE, mentionedUserIds: [BOB] });
    await expect(h.publishing.get(bob, post.id)).resolves.toMatchObject({ status: 'published' });
  });

  it('chỉ moderator duyệt; chỉ bài pending duyệt được', async () => {
    const h = harness();
    const post = await pendingPost(h);
    await expectError(h.moderation.approve(alice, post.id), 'FORBIDDEN', 403);
    await expectError(h.moderation.approve(bob, post.id), 'FORBIDDEN');
    await h.moderation.approve(moderator, post.id);
    await expectError(h.moderation.approve(moderator, post.id), 'POST_STATE', 409);
    await expectError(h.moderation.reject(moderator, post.id, { reason: 'Muộn rồi' }), 'POST_STATE', 409);
  });

  it('từ chối cần lý do hợp lệ; rejected không phát published; tác giả và moderator thấy lý do', async () => {
    const h = harness();
    const post = await pendingPost(h);
    await expectError(h.moderation.reject(moderator, post.id, { reason: '   ' }), 'VALIDATION', 400);
    await expectError(h.moderation.reject(moderator, post.id, { reason: 'x'.repeat(501) }), 'VALIDATION');
    const rejected = await h.moderation.reject(moderator, post.id, { reason: 'Thiếu nguồn tham khảo' });
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Thiếu nguồn tham khảo' });
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postModerated]);
    expect(h.store.events[0].payload).toMatchObject({ decision: 'rejected', reason: 'Thiếu nguồn tham khảo' });
    await expect(h.publishing.get(alice, post.id)).resolves.toMatchObject({ rejectReason: 'Thiếu nguồn tham khảo' });
    await expectError(h.publishing.get(bob, post.id), 'POST_NOT_FOUND');
  });

  it('tác giả sửa bài bị từ chối: gửi lại duyệt, hoặc đăng luôn nếu cài đặt đã tắt', async () => {
    const h = harness();
    const post = await pendingPost(h);
    await h.moderation.reject(moderator, post.id, { reason: 'Chưa rõ ràng' });
    h.store.events.length = 0;

    const again = await h.publishing.update(alice, post.id, { bodyHtml: '<p>Đã bổ sung nội dung</p>' });
    expect(again.status).toBe('pending');
    expect(again.rejectReason).toBeUndefined();
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postPending]);

    await h.moderation.reject(moderator, post.id, { reason: 'Vẫn chưa đạt' });
    h.settings.value = { wallRequireApproval: false };
    h.store.events.length = 0;
    const published = await h.publishing.update(alice, post.id, { title: 'Tiêu đề mới' });
    expect(published.status).toBe('published');
    expect(h.store.events[0]).toMatchObject({ type: SOCIAL_EVENT_TYPES.postPublished });
    expect(h.store.events[0].payload).toMatchObject({ origin: 'direct', title: 'Tiêu đề mới' });
  });

  it('người khác sửa bài bị từ chối không làm bài gửi lại', async () => {
    const h = harness();
    const post = await pendingPost(h);
    await h.moderation.reject(moderator, post.id, { reason: 'Chưa rõ ràng' });
    const edited = await h.publishing.update(moderator, post.id, { title: 'Moderator sửa' });
    expect(edited.status).toBe('rejected');
  });

  it('hàng chờ: chỉ moderator; chỉ bài pending của Tường công ty; số đếm hộp thư', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    await h.publishing.create(alice, { bodyHtml: BODY });
    await h.publishing.create(bob, { bodyHtml: BODY });
    await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(600) });

    await expectError(h.moderation.listPending(alice), 'FORBIDDEN');
    const queue = await h.moderation.listPending(moderator);
    expect(queue.items).toHaveLength(2);
    expect(queue.items.every((p) => p.status === 'pending')).toBe(true);

    await expect(h.myPosts.inbox(alice)).resolves.toEqual({
      myPending: 1,
      myScheduled: 1,
      myRejected: 0,
      toModerate: 0,
      bookmarks: 0,
    });
    await expect(h.myPosts.inbox(moderator)).resolves.toMatchObject({ toModerate: 2 });
  });

  it('bài của tôi theo trạng thái; trạng thái lạ bị từ chối', async () => {
    const h = harness();
    await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(600) });
    await h.publishing.create(alice, { bodyHtml: BODY });
    const scheduled = await h.myPosts.list(alice, { status: 'scheduled' });
    expect(scheduled.items).toHaveLength(1);
    expect((await h.myPosts.list(bob, { status: 'scheduled' })).items).toEqual([]);
    await expectError(h.myPosts.list(alice, { status: 'published' }), 'VALIDATION');
    await expectError(h.myPosts.list(alice, {}), 'VALIDATION');
  });
});

/* ------------------------------------------------------------- hẹn giờ */

describe('hẹn giờ', () => {
  it('đăng ngay bài hẹn giờ: chỉ tác giả, chỉ bài scheduled', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600) });
    await expectError(h.publishing.publishNow(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.publishing.publishNow(moderator, post.id), 'FORBIDDEN');
    h.store.events.length = 0;
    const published = await h.publishing.publishNow(alice, post.id);
    expect(published.status).toBe('published');
    expect(h.store.events[0].payload).toMatchObject({ origin: 'direct' });
    await expectError(h.publishing.publishNow(alice, post.id), 'POST_STATE', 409);
  });

  it('đăng ngay vẫn qua duyệt khi cần; bài hẹn giờ của moderator được miễn duyệt', async () => {
    const h = harness();
    const normal = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600) });
    const privileged = await h.publishing.create(moderator, { bodyHtml: BODY, scheduledAt: iso(3600) });
    expect(isExemptScheduled(h.store.rows.get(privileged.id) as ExtendedPostRow)).toBe(true);
    expect(isExemptScheduled(h.store.rows.get(normal.id) as ExtendedPostRow)).toBe(false);
    expect(privileged.moderatedBy).toBeUndefined();

    h.settings.value = { wallRequireApproval: true };
    h.store.events.length = 0;
    expect((await h.publishing.publishNow(alice, normal.id)).status).toBe('pending');
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postPending]);
    expect((await h.publishing.publishNow(moderator, privileged.id)).status).toBe('published');
  });

  it('đổi giờ hẹn: chỉ bài scheduled của chính mình, vẫn phải ở tương lai', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600) });
    const moved = await h.publishing.update(alice, post.id, { scheduledAt: iso(7200) });
    expect(moved.scheduledAt).toBe(iso(7200));
    await expectError(h.publishing.update(alice, post.id, { scheduledAt: iso(10) }), 'VALIDATION');
    await expectError(h.publishing.update(moderator, post.id, { scheduledAt: iso(7300) }), 'FORBIDDEN');

    const live = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(alice, live.id, { scheduledAt: iso(7200) }), 'POST_STATE', 409);
  });

  it('huỷ hẹn là xoá bài: không phát sự kiện, bài biến mất', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600) });
    await h.publishing.remove(alice, post.id);
    expect(h.store.events).toEqual([]);
    await expectError(h.publishing.get(alice, post.id), 'POST_NOT_FOUND');
  });

  it('job quét: chỉ đăng bài đến hạn, đặt published_at, phát published origin scheduled theo thứ tự hạn', async () => {
    const h = harness();
    const later = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(7200) });
    const first = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600), mentionUserIds: [BOB] });
    const second = await h.publishing.create(bob, { bodyHtml: BODY, scheduledAt: iso(3700) });

    expect(await h.scheduler.publishDueScheduled(TENANT, { now: new Date(iso(60)) })).toMatchObject({ published: 0 });

    h.clock.now = new Date(iso(4000));
    const result = await h.scheduler.publishDueScheduled(TENANT, { now: h.clock.now });
    expect(result).toMatchObject({ published: 2, pending: 0, discarded: 0, failures: [] });
    expect(h.store.rows.get(first.id)?.status).toBe('published');
    expect(h.store.rows.get(second.id)?.status).toBe('published');
    expect(h.store.rows.get(later.id)?.status).toBe('scheduled');
    expect(h.store.rows.get(first.id)?.publishedAt).not.toBe(iso(3600));

    const published = h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.postPublished);
    expect(published.map((e) => e.payload['postId'])).toEqual([first.id, second.id]);
    expect(published[0].payload).toMatchObject({ origin: 'scheduled', mentionedUserIds: [BOB] });
    expect(h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned)).toHaveLength(1);

    // chạy lại không đăng lần hai
    h.store.events.length = 0;
    expect(await h.scheduler.publishDueScheduled(TENANT, { now: h.clock.now })).toMatchObject({ published: 0 });
    expect(h.store.events).toEqual([]);
  });

  it('job quét: Tường công ty cần duyệt thì vào pending (trừ bài của moderator); cài đặt bật sau khi hẹn vẫn có hiệu lực', async () => {
    const h = harness();
    const normal = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(600) });
    const privileged = await h.publishing.create(moderator, { bodyHtml: BODY, scheduledAt: iso(600) });
    const inGroup = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, scheduledAt: iso(600) });
    h.settings.value = { wallRequireApproval: true };
    h.clock.now = new Date(iso(700));
    const result = await h.scheduler.publishDueScheduled(TENANT, { now: h.clock.now });
    expect(result).toMatchObject({ published: 2, pending: 1 });
    expect(h.store.rows.get(normal.id)?.status).toBe('pending');
    expect(h.store.rows.get(privileged.id)?.status).toBe('published');
    expect(h.store.rows.get(inGroup.id)?.status).toBe('published');
    expect(h.store.events.some((e) => e.type === SOCIAL_EVENT_TYPES.postPending)).toBe(true);
  });

  it('job quét: bài nhóm mà tác giả đã rời nhóm bị bỏ; lỗi một bài không chặn các bài còn lại', async () => {
    const h = harness();
    const left = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, scheduledAt: iso(600) });
    const broken = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PRIVATE, scheduledAt: iso(610) });
    const fine = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(620) });
    h.groups.members.get(G_PUBLIC)?.delete(BOB);
    h.groups.failFor = G_PRIVATE;
    h.clock.now = new Date(iso(700));

    const result = await h.scheduler.publishDueScheduled(TENANT, { now: h.clock.now });
    expect(result).toMatchObject({ published: 1, discarded: 1 });
    expect(result.failures).toEqual([{ postId: broken.id, message: 'Không tra được nhóm.' }]);
    expect(h.store.rows.get(left.id)?.status).toBe('deleted');
    expect(h.store.rows.get(broken.id)?.status).toBe('scheduled');
    expect(h.store.rows.get(fine.id)?.status).toBe('published');
  });
});

/* ------------------------------------------------------------ sửa, xoá */

describe('sửa, xoá, ghim', () => {
  it('chỉ tác giả hoặc moderator sửa; bài tự sinh không sửa được', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(bob, post.id, { title: 'Của tôi' }), 'FORBIDDEN', 403);
    await expect(h.publishing.update(moderator, post.id, { title: 'Chỉnh bởi moderator' })).resolves.toMatchObject({
      title: 'Chỉnh bởi moderator',
    });

    h.store.seed({ id: MISSING, authorId: ALICE, status: 'published', bodyHtml: '', activityType: 'avatar.updated', activityPayload: {} });
    const activity = await h.publishing.get(alice, MISSING);
    expect(activity.activity?.type).toBe('avatar.updated');
    expect(activity.capabilities.canEdit).toBe(false);
    await expectError(h.publishing.update(alice, MISSING, { title: 'Sửa' }), 'FORBIDDEN');
    await expect(h.publishing.remove(alice, MISSING)).resolves.toBeUndefined();
  });

  it('sửa bài đã đăng phát post.changed và nhắc tên người mới', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, mentionUserIds: [BOB] });
    h.store.events.length = 0;
    const edited = await h.publishing.update(alice, post.id, { bodyHtml: '<p>Nội dung mới</p>', mentionUserIds: [BOB, CAROL] });
    expect(edited.editedAt).toBeDefined();
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postChanged, SOCIAL_EVENT_TYPES.mentioned]);
    expect(h.store.events[0].payload).toMatchObject({ change: 'updated', postId: post.id });
    expect(h.store.events[1].payload).toMatchObject({ mentionedUserId: CAROL });
  });

  it('sửa bài chỉ có bình chọn thành rỗng vẫn hợp lệ; bài thường thành rỗng bị từ chối', async () => {
    const h = harness();
    const withPoll = await h.publishing.create(alice, { bodyHtml: '', poll: { question: 'Hỏi', options: ['A', 'B'] } });
    await expect(h.publishing.update(alice, withPoll.id, { bodyHtml: '' })).resolves.toBeDefined();
    const plain = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(alice, plain.id, { bodyHtml: '' }), 'VALIDATION');
  });

  it('xoá bài nhóm: tác giả, admin nhóm, moderator (nhóm công khai); moderator không xoá được bài nhóm riêng tư', async () => {
    const h = harness();
    const publicPost = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    await expectError(h.publishing.remove(dave, publicPost.id), 'FORBIDDEN', 403);
    h.store.events.length = 0;
    await h.publishing.remove(alice, publicPost.id);
    expect(h.store.events[0]).toMatchObject({
      type: SOCIAL_EVENT_TYPES.postChanged,
      payload: { change: 'deleted', groupId: G_PUBLIC },
    });

    const another = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    await expect(h.publishing.remove(moderator, another.id)).resolves.toBeUndefined();

    const privatePost = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PRIVATE });
    h.groups.members.get(G_PRIVATE)?.set(CAROL, 'member');
    await expectError(h.publishing.remove(moderator, privatePost.id), 'FORBIDDEN');
    await expect(h.publishing.remove(bob, privatePost.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('ghim: moderator ở Tường công ty, admin nhóm ở bài nhóm; chỉ bài đã đăng; phát post.changed', async () => {
    const h = harness();
    const wall = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.setPinned(alice, wall.id, { pinned: true }), 'FORBIDDEN');
    h.store.events.length = 0;
    expect((await h.publishing.setPinned(moderator, wall.id, { pinned: true })).pinned).toBe(true);
    expect(h.store.events[0].payload).toMatchObject({ change: 'pinned' });
    await h.publishing.setPinned(moderator, wall.id, { pinned: false });
    expect(h.store.events[1].payload).toMatchObject({ change: 'unpinned' });

    const group = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    await expectError(h.publishing.setPinned(bob, group.id, { pinned: true }), 'FORBIDDEN');
    await expectError(h.publishing.setPinned(moderator, group.id, { pinned: true }), 'FORBIDDEN');
    await expect(h.publishing.setPinned(alice, group.id, { pinned: true })).resolves.toMatchObject({ pinned: true });

    const scheduled = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(600) });
    await expectError(h.publishing.setPinned(moderator, scheduled.id, { pinned: true }), 'POST_STATE');
  });
});

/* ------------------------------------------------------------ bình chọn */

describe('bình chọn', () => {
  async function pollPost(h: ReturnType<typeof harness>, poll: Partial<{ allowMultiple: boolean; anonymous: boolean; closesAt: string }> = {}) {
    const post = await h.publishing.create(alice, {
      bodyHtml: BODY,
      poll: { question: 'Ăn trưa gì?', options: ['Phở', 'Bún', 'Cơm'], ...poll },
    });
    const options = post.poll?.options ?? [];
    return { post, ids: options.map((o) => o.id) };
  }

  it('bỏ phiếu một lựa chọn: đếm phiếu, ghi lựa chọn của mình; chọn hai thì bị từ chối', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h);
    const voted = await h.polls.vote(bob, post.id, { optionIds: [ids[0]] });
    expect(voted).toMatchObject({ totalVoters: 1, myOptionIds: [ids[0]], canVote: true });
    expect(voted.options.map((o) => o.voteCount)).toEqual([1, 0, 0]);
    expect(h.store.events.at(-1)).toMatchObject({ type: SOCIAL_EVENT_TYPES.pollChanged, payload: { change: 'voted', postId: post.id } });
    await expectError(h.polls.vote(bob, post.id, { optionIds: [ids[0], ids[1]] }), 'VALIDATION', 400);
    await expectError(h.polls.vote(bob, post.id, { optionIds: [MISSING] }), 'VALIDATION');
    await expectError(h.polls.vote(bob, post.id, { optionIds: ['không phải uuid'] }), 'VALIDATION');
  });

  it('đổi phiếu và bỏ phiếu khi chưa đóng; số phiếu luôn xem được', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h);
    await h.polls.vote(bob, post.id, { optionIds: [ids[0]] });
    await h.polls.vote(alice, post.id, { optionIds: [ids[0]] });
    const changed = await h.polls.vote(bob, post.id, { optionIds: [ids[2]] });
    expect(changed.options.map((o) => o.voteCount)).toEqual([1, 0, 1]);
    expect(changed.myOptionIds).toEqual([ids[2]]);
    const cleared = await h.polls.vote(bob, post.id, { optionIds: [] });
    expect(cleared).toMatchObject({ totalVoters: 1, myOptionIds: [] });
    // người chưa bỏ phiếu vẫn thấy số phiếu
    expect((await h.publishing.get(dave, post.id)).poll?.options.map((o) => o.voteCount)).toEqual([1, 0, 0]);
  });

  it('chọn nhiều: nhận nhiều lựa chọn, mỗi người tính một lần', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h, { allowMultiple: true });
    const voted = await h.polls.vote(bob, post.id, { optionIds: [ids[0], ids[1]] });
    expect(voted.totalVoters).toBe(1);
    expect(voted.options.map((o) => o.voteCount)).toEqual([1, 1, 0]);
  });

  it('hết hạn: không bỏ, đổi phiếu được nữa nhưng vẫn xem được kết quả', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h, { closesAt: iso(3600) });
    await h.polls.vote(bob, post.id, { optionIds: [ids[0]] });
    h.clock.now = new Date(iso(3601));
    await expectError(h.polls.vote(bob, post.id, { optionIds: [ids[1]] }), 'POLL_CLOSED', 409);
    await expectError(h.polls.vote(bob, post.id, { optionIds: [] }), 'POLL_CLOSED');
    const view = (await h.publishing.get(bob, post.id)).poll;
    expect(view).toMatchObject({ isClosed: true, canVote: false, totalVoters: 1 });
    await expectError(h.polls.close(alice, post.id), 'POLL_CLOSED', 409);
  });

  it('đóng sớm: tác giả hoặc moderator; đóng rồi không bỏ phiếu được; đóng hai lần là 409', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h);
    await expectError(h.polls.close(bob, post.id), 'FORBIDDEN', 403);
    const closed = await h.polls.close(moderator, post.id);
    expect(closed).toMatchObject({ isClosed: true, canVote: false });
    expect(h.store.events.at(-1)).toMatchObject({ type: SOCIAL_EVENT_TYPES.pollChanged, payload: { change: 'closed' } });
    await expectError(h.polls.vote(bob, post.id, { optionIds: [ids[0]] }), 'POLL_CLOSED');
    await expectError(h.polls.close(alice, post.id), 'POLL_CLOSED');
  });

  it('bài không có bình chọn: 404 POLL_NOT_FOUND', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.polls.vote(bob, post.id, { optionIds: [] }), 'POLL_NOT_FOUND', 404);
    await expectError(h.polls.voters(bob, post.id), 'POLL_NOT_FOUND');
  });

  it('ẩn danh: không API nào lộ người bỏ phiếu, kể cả cho tác giả', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h, { anonymous: true });
    await h.polls.vote(bob, post.id, { optionIds: [ids[1]] });
    await h.polls.vote(dave, post.id, { optionIds: [ids[1]] });

    await expectError(h.polls.voters(alice, post.id), 'POLL_ANONYMOUS', 403);
    await expectError(h.polls.voters(moderator, post.id, { optionId: ids[1] }), 'POLL_ANONYMOUS');

    const asAuthor = await h.publishing.get(alice, post.id);
    expect(asAuthor.poll).toMatchObject({ anonymous: true, canViewVoters: false, totalVoters: 2 });
    const json = JSON.stringify(asAuthor);
    expect(json).not.toContain(BOB);
    expect(json).not.toContain(DAVE);
    expect(asAuthor.poll?.myOptionIds).toEqual([]);
    // chỉ chính người bỏ phiếu thấy lựa chọn của mình
    expect((await h.publishing.get(bob, post.id)).poll?.myOptionIds).toEqual([ids[1]]);
  });

  it('công khai: xem được ai chọn gì, lọc theo lựa chọn, phân trang', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h, { allowMultiple: true });
    await h.polls.vote(bob, post.id, { optionIds: [ids[0]] });
    await h.polls.vote(dave, post.id, { optionIds: [ids[0], ids[1]] });
    await h.polls.vote(alice, post.id, { optionIds: [ids[2]] });

    const all = await h.polls.voters(dave, post.id, { limit: 10 });
    expect(all.items).toHaveLength(4);
    const forFirst = await h.polls.voters(dave, post.id, { optionId: ids[0] });
    expect(forFirst.items.map((v) => v.user.id).sort()).toEqual([BOB, DAVE].sort());
    expect((await h.publishing.get(dave, post.id)).poll?.canViewVoters).toBe(true);

    const first = await h.polls.voters(dave, post.id, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeDefined();
    const second = await h.polls.voters(dave, post.id, { limit: 3, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    await expectError(h.polls.voters(dave, post.id, { optionId: MISSING }), 'VALIDATION');
    await expectError(h.polls.voters(dave, post.id, { cursor: 'rác' }), 'VALIDATION');
  });

  it('lựa chọn cố định sau phiếu đầu tiên: chỉ đổi được hạn đóng', async () => {
    const h = harness();
    const { post, ids } = await pollPost(h);
    const extended = await h.publishing.update(alice, post.id, { poll: { closesAt: iso(5000) } });
    expect(extended.poll?.closesAt).toBe(iso(5000));
    await expectError(h.publishing.update(alice, post.id, { poll: { closesAt: iso(-5) } }), 'VALIDATION');
    const cleared = await h.publishing.update(alice, post.id, { poll: { closesAt: null } });
    expect(cleared.poll?.closesAt).toBeUndefined();

    await h.polls.vote(bob, post.id, { optionIds: [ids[0]] });
    const withOptions = { options: ['X', 'Y'] } as unknown as { closesAt?: string | null };
    await expectError(h.publishing.update(alice, post.id, { poll: withOptions }), 'POLL_LOCKED', 409);
  });
});

/* ------------------------------------------------- xác nhận đã đọc */

describe('xác nhận đã đọc', () => {
  it('bài Tường công ty: mọi người đang làm việc trừ tác giả; xác nhận idempotent', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    expect((await h.publishing.get(bob, post.id)).readConfirmation).toMatchObject({
      required: true,
      confirmedByMe: false,
      canConfirm: true,
    });
    expect((await h.publishing.get(bob, post.id)).readConfirmation).not.toHaveProperty('confirmedCount');

    const first = await h.confirmations.confirm(bob, post.id);
    expect(first).toMatchObject({ confirmedByMe: true, canConfirm: true });
    expect(first.confirmedAt).toBeDefined();
    await h.confirmations.confirm(bob, post.id);
    expect(h.store.confirmations.get(post.id)).toHaveLength(1);

    // tác giả thấy số liệu
    expect((await h.publishing.get(alice, post.id)).readConfirmation).toMatchObject({
      confirmedCount: 1,
      audienceCount: 3,
      canConfirm: false,
    });
  });

  it('tác giả và người ngoài phạm vi không xác nhận được; bài không yêu cầu thì 400', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    await expectError(h.confirmations.confirm(alice, post.id), 'FORBIDDEN', 403);
    await expectError(h.confirmations.confirm(outsider, post.id), 'FORBIDDEN');
    const plain = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.confirmations.confirm(bob, plain.id), 'NOT_REQUIRED', 400);
    await expectError(h.confirmations.list(alice, plain.id), 'NOT_REQUIRED', 400);
  });

  it('bài nhóm: phạm vi là thành viên; người ngoài nhóm công khai không xác nhận được', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC, requiresReadConfirmation: true });
    const asOutsider = await h.publishing.get(dave, post.id);
    expect(asOutsider.readConfirmation).toMatchObject({ canConfirm: false });
    await expectError(h.confirmations.confirm(dave, post.id), 'FORBIDDEN');
    await expect(h.confirmations.confirm(bob, post.id)).resolves.toMatchObject({ confirmedByMe: true });
    expect((await h.publishing.get(alice, post.id)).readConfirmation).toMatchObject({ confirmedCount: 1, audienceCount: 1 });
  });

  it('danh sách đã/chưa xác nhận: tác giả, moderator, admin nhóm; người khác bị từ chối', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    await h.confirmations.confirm(bob, post.id);

    const confirmed = await h.confirmations.list(alice, post.id, { filter: 'confirmed' });
    expect(confirmed).toMatchObject({ confirmedCount: 1, audienceCount: 3 });
    expect(confirmed.items.map((e) => e.user.id)).toEqual([BOB]);
    expect(confirmed.items[0].confirmedAt).toBeDefined();

    const pending = await h.confirmations.list(moderator, post.id, { filter: 'pending' });
    expect(pending.items.map((e) => e.user.id).sort()).toEqual([CAROL, DAVE].sort());
    expect(pending.items.every((e) => e.confirmedAt === undefined)).toBe(true);
    const defaulted = await h.confirmations.list(alice, post.id);
    expect(defaulted.items).toHaveLength(2);

    await expectError(h.confirmations.list(bob, post.id), 'FORBIDDEN', 403);
    await expectError(h.confirmations.list(alice, post.id, { filter: 'khác' }), 'VALIDATION');

    const page = await h.confirmations.list(alice, post.id, { filter: 'pending', limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    const rest = await h.confirmations.list(alice, post.id, { filter: 'pending', limit: 1, cursor: page.nextCursor });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeUndefined();

    const group = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, requiresReadConfirmation: true });
    await expect(h.confirmations.list(alice, group.id, { filter: 'pending' })).resolves.toMatchObject({ audienceCount: 1 });
  });

  it('không tắt được khi đã có người xác nhận; bật lúc sửa được', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    await h.confirmations.confirm(bob, post.id);
    await expect(h.publishing.update(alice, post.id, { requiresReadConfirmation: false })).rejects.toBeInstanceOf(
      SocialReadConfirmationLockedError,
    );

    const other = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    const off = await h.publishing.update(alice, other.id, { requiresReadConfirmation: false });
    expect(off.readConfirmation).toBeUndefined();
    const on = await h.publishing.update(alice, other.id, { requiresReadConfirmation: true });
    expect(on.readConfirmation?.required).toBe(true);
  });
});

/* -------------------------------------------------------------- đã lưu */

describe('thư mục bài đã lưu', () => {
  it('tạo thư mục: cắt khoảng trắng, trùng tên (không phân biệt hoa thường) trả lại thư mục cũ', async () => {
    const h = harness();
    const first = await h.bookmarks.createFolder(bob, { name: '  Quy trình  ' });
    expect(first).toMatchObject({ name: 'Quy trình', count: 0 });
    const again = await h.bookmarks.createFolder(bob, { name: 'QUY TRÌNH' });
    expect(again.id).toBe(first.id);
    expect((await h.bookmarks.listFolders(bob)).items).toHaveLength(1);
    // Người khác tạo cùng tên thì ra thư mục riêng.
    expect((await h.bookmarks.createFolder(alice, { name: 'Quy trình' })).id).not.toBe(first.id);
  });

  it('từ chối tên rỗng, quá dài và vượt số thư mục tối đa', async () => {
    const h = harness();
    await expectError(h.bookmarks.createFolder(bob, { name: '   ' }), 'VALIDATION');
    await expectError(h.bookmarks.createFolder(bob, {} as { name: string }), 'VALIDATION');
    await expectError(h.bookmarks.createFolder(bob, { name: 'x'.repeat(SOCIAL_BOOKMARK_FOLDER_NAME_MAX + 1) }), 'VALIDATION');
    await expect(h.bookmarks.createFolder(bob, { name: 'x'.repeat(SOCIAL_BOOKMARK_FOLDER_NAME_MAX) })).resolves.toBeDefined();
    for (let i = 1; i < SOCIAL_BOOKMARK_FOLDERS_MAX; i += 1) await h.bookmarks.createFolder(bob, { name: `Thư mục ${i}` });
    await expectError(h.bookmarks.createFolder(bob, { name: 'Thêm một thư mục' }), 'VALIDATION');
    // Tên trùng vẫn trả thư mục cũ dù đã đủ số lượng.
    await expect(h.bookmarks.createFolder(bob, { name: 'thư mục 1' })).resolves.toMatchObject({ name: 'Thư mục 1' });
  });

  it('lưu bài vào thư mục: thư mục lạ bị từ chối, bỏ trống giữ thư mục cũ, null về chưa phân loại', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    const folder = await h.bookmarks.createFolder(bob, { name: 'Đọc sau' });
    const strangers = await h.bookmarks.createFolder(alice, { name: 'Của Alice' });

    await expectError(h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: strangers.id }), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
    await expectError(h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: 'khong-phai-uuid' }), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
    expect((await h.bookmarks.list(bob)).items).toEqual([]);

    await expect(h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: folder.id })).resolves.toEqual({
      bookmarked: true,
      folderId: folder.id,
    });
    expect((await h.bookmarks.list(bob)).items[0]).toMatchObject({ bookmarked: true, bookmarkFolderId: folder.id });

    // Lưu lại không nêu folderId: giữ thư mục cũ.
    await h.bookmarks.set(bob, post.id, { bookmarked: true });
    expect((await h.bookmarks.list(bob)).items[0]?.bookmarkFolderId).toBe(folder.id);

    // null: về chưa phân loại.
    await h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: null });
    const unfiled = (await h.bookmarks.list(bob)).items[0];
    expect(unfiled?.bookmarked).toBe(true);
    expect(unfiled?.bookmarkFolderId).toBeUndefined();
  });

  it('lọc danh sách theo thư mục hoặc none; danh sách thư mục kèm count, unfiledCount và sắp theo tên', async () => {
    const h = harness();
    const a = await h.publishing.create(alice, { bodyHtml: BODY });
    const b = await h.publishing.create(alice, { bodyHtml: '<p>Bài hai</p>' });
    const c = await h.publishing.create(alice, { bodyHtml: '<p>Bài ba</p>' });
    const zeta = await h.bookmarks.createFolder(bob, { name: 'zeta' });
    const alpha = await h.bookmarks.createFolder(bob, { name: 'Alpha' });
    await h.bookmarks.set(bob, a.id, { bookmarked: true, folderId: alpha.id });
    await h.bookmarks.set(bob, b.id, { bookmarked: true, folderId: alpha.id });
    await h.bookmarks.set(bob, c.id, { bookmarked: true });

    const ids = async (folderId?: string) => (await h.bookmarks.list(bob, { folderId })).items.map((p) => p.id).sort();
    expect(await ids()).toEqual([a.id, b.id, c.id].sort());
    expect(await ids(alpha.id)).toEqual([a.id, b.id].sort());
    expect(await ids('none')).toEqual([c.id]);
    expect(await ids(zeta.id)).toEqual([]);
    await expectError(h.bookmarks.list(bob, { folderId: 'bậy' }), 'VALIDATION');

    const folders = await h.bookmarks.listFolders(bob);
    expect(folders.items.map((f) => [f.name, f.count])).toEqual([
      ['Alpha', 2],
      ['zeta', 0],
    ]);
    expect(folders.unfiledCount).toBe(1);
    expect(folders.total).toBe(3);
  });
});

describe('sửa và xoá thư mục bài đã lưu', () => {
  it('đổi tên: cắt khoảng trắng, từ chối tên rỗng, quá dài hoặc trùng thư mục khác; giữ nguyên count', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    const a = await h.bookmarks.createFolder(bob, { name: 'Alpha' });
    const b = await h.bookmarks.createFolder(bob, { name: 'Beta' });
    await h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: a.id });

    await expect(h.bookmarks.renameFolder(bob, a.id, { name: '  Gamma  ' })).resolves.toEqual({ id: a.id, name: 'Gamma', count: 1 });
    expect((await h.bookmarks.listFolders(bob)).items.map((f) => f.name)).toEqual(['Beta', 'Gamma']);
    // Đổi hoa thường của chính nó thì được; trùng thư mục khác thì không.
    await expect(h.bookmarks.renameFolder(bob, a.id, { name: 'GAMMA' })).resolves.toMatchObject({ name: 'GAMMA' });
    await expectError(h.bookmarks.renameFolder(bob, a.id, { name: 'beta' }), 'VALIDATION');
    await expectError(h.bookmarks.renameFolder(bob, b.id, { name: '   ' }), 'VALIDATION');
    await expectError(h.bookmarks.renameFolder(bob, b.id, { name: 'x'.repeat(SOCIAL_BOOKMARK_FOLDER_NAME_MAX + 1) }), 'VALIDATION');
  });

  it('thư mục của người khác hoặc id sai: không tìm thấy, không lộ thư mục người khác', async () => {
    const h = harness();
    const theirs = await h.bookmarks.createFolder(alice, { name: 'Của Alice' });
    await expectError(h.bookmarks.renameFolder(bob, theirs.id, { name: 'Đổi' }), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
    await expectError(h.bookmarks.deleteFolder(bob, theirs.id), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
    await expectError(h.bookmarks.deleteFolder(bob, 'khong-phai-uuid'), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
    expect((await h.bookmarks.listFolders(alice)).items.map((f) => f.name)).toEqual(['Của Alice']);
  });

  it('xoá thư mục: bài đã lưu về chưa phân loại, không mất bài', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    const folder = await h.bookmarks.createFolder(bob, { name: 'Tạm' });
    await h.bookmarks.set(bob, post.id, { bookmarked: true, folderId: folder.id });

    await h.bookmarks.deleteFolder(bob, folder.id);
    const folders = await h.bookmarks.listFolders(bob);
    expect(folders.items).toEqual([]);
    expect(folders.unfiledCount).toBe(1);
    const saved = (await h.bookmarks.list(bob)).items;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.bookmarked).toBe(true);
    expect(saved[0]?.bookmarkFolderId).toBeUndefined();
    await expectError(h.bookmarks.deleteFolder(bob, folder.id), 'BOOKMARK_FOLDER_NOT_FOUND', 404);
  });
});

describe('bài đã lưu', () => {
  it('lưu và bỏ lưu; danh sách lưu gần nhất trước', async () => {
    const h = harness();
    const a = await h.publishing.create(alice, { bodyHtml: BODY });
    const b = await h.publishing.create(alice, { bodyHtml: '<p>Bài hai</p>' });
    await expect(h.bookmarks.set(bob, a.id, { bookmarked: true })).resolves.toEqual({ bookmarked: true });
    await h.bookmarks.set(bob, b.id, { bookmarked: true });
    expect((await h.bookmarks.list(bob)).items.map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await h.bookmarks.list(bob)).items.every((p) => p.bookmarked)).toBe(true);
    await h.bookmarks.set(bob, a.id, { bookmarked: false });
    expect((await h.bookmarks.list(bob)).items.map((p) => p.id)).toEqual([b.id]);
    expect((await h.bookmarks.list(alice)).items).toEqual([]);
    await expectError(h.bookmarks.set(bob, a.id, {} as { bookmarked: boolean }), 'VALIDATION');
  });

  it('bài không còn thấy được thì bị bỏ khỏi danh sách đã lưu', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PRIVATE });
    await h.bookmarks.set(bob, post.id, { bookmarked: true });
    expect((await h.bookmarks.list(bob)).items).toHaveLength(1);
    h.groups.members.get(G_PRIVATE)?.delete(BOB);
    expect((await h.bookmarks.list(bob)).items).toEqual([]);
    await h.publishing.remove(alice, post.id);
    expect((await h.myPosts.inbox(bob)).bookmarks).toBe(0);
  });
});

/* ------------------------------------------------------------- cài đặt */

describe('cài đặt', () => {
  it('mọi người đọc được, chỉ quản trị cài đặt mới sửa được', async () => {
    const h = harness();
    await expect(h.settingsService.get(bob)).resolves.toEqual({ wallRequireApproval: false });
    await expectError(h.settingsService.update(bob, { wallRequireApproval: true }), 'FORBIDDEN', 403);
    await expectError(h.settingsService.update(moderator, { wallRequireApproval: true }), 'FORBIDDEN');
    await expect(h.settingsService.update(manager, { wallRequireApproval: true })).resolves.toEqual({
      wallRequireApproval: true,
    });
    await expect(h.settingsService.update(actor(ALICE, { isTenantAdmin: true }), { wallRequireApproval: false })).resolves.toEqual({
      wallRequireApproval: false,
    });
  });

  it('giá trị sai kiểu bị từ chối; yêu cầu rỗng không đổi gì', async () => {
    const h = harness();
    await expectError(
      h.settingsService.update(manager, { wallRequireApproval: 'có' } as unknown as UpdateSocialSettingsRequest),
      'VALIDATION',
      400,
    );
    await expect(h.settingsService.update(manager, {})).resolves.toEqual({ wallRequireApproval: false });
  });
});

/* ------------------------------------------------ quyền xem bài (đợt 2) */

const FOREIGN_USER = '66666666-6666-4666-8666-666666666666';
/** Các vai trò có quyền rộng nhưng KHÔNG được ưu tiên ở quyền xem bài (không thuộc phòng ban nào). */
const tenantAdmin = actor(OUTSIDER, { isTenantAdmin: true });
const groupManager = actor(FOREIGN_USER, { canManage: true });

/** Mọi người trong bộ dữ liệu, để kiểm "ai thấy bài" bằng GET /posts/:id. */
async function whoSees(h: ReturnType<typeof harness>, postId: string): Promise<string[]> {
  const viewers: [string, SocialActor][] = [
    ['alice', alice],
    ['bob', bob],
    ['carol-moderator', moderator],
    ['dave', actor(DAVE)],
    ['manager', groupManager],
    ['tenant-admin', tenantAdmin],
    ['outsider', outsider],
  ];
  const seen: string[] = [];
  for (const [name, who] of viewers) {
    if (await h.publishing.get(who, postId).then(() => true, () => false)) seen.push(name);
  }
  return seen;
}

describe('quyền xem bài: tạo bài', () => {
  it('company là mặc định và ai cũng thấy; không có quyền riêng trong sự kiện', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    expect(post.visibility).toBe('company');
    expect(await whoSees(h, post.id)).toHaveLength(7);
    expect(h.store.events[0].payload).not.toHaveProperty('visibility');
  });

  it('unit: người cùng phòng và người ở phòng con thấy; người ở phòng khác, moderator, quản trị đều không', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit' });
    expect(post.visibility).toBe('unit');
    expect(h.store.rows.get(post.id)?.authorUnitId).toBe(UNIT_PARENT);
    // Bob ở phòng con của phòng Alice nên thấy; Carol (moderator), quản trị tenant, người quản lý nhóm thì không.
    expect(await whoSees(h, post.id)).toEqual(['alice', 'bob']);
    // Sự kiện vẫn phát (realtime cần) nhưng mang quyền xem để catalog thông báo bỏ qua.
    expect(h.store.events[0]).toMatchObject({
      type: SOCIAL_EVENT_TYPES.postPublished,
      payload: { postId: post.id, visibility: 'unit' },
    });
  });

  it('unit: người ở phòng cha KHÔNG tự thấy bài của phòng con', async () => {
    const h = harness();
    const post = await h.publishing.create(bob, { bodyHtml: BODY, visibility: 'unit' });
    expect(h.store.rows.get(post.id)?.authorUnitId).toBe(UNIT_CHILD);
    expect(await whoSees(h, post.id)).toEqual(['bob']);
  });

  it('unit: tác giả chưa thuộc phòng ban nào thì 400 VISIBILITY_UNIT_UNKNOWN', async () => {
    const h = harness();
    await expectError(h.publishing.create(actor(DAVE), { bodyHtml: BODY, visibility: 'unit' }), 'VISIBILITY_UNIT_UNKNOWN', 400);
  });

  it('Tenant Core lỗi: không chọn được unit và người xem không thấy bài unit/custom (không fail-open)', async () => {
    const h = harness();
    const unit = await h.publishing.create(bob, { bodyHtml: BODY, visibility: 'unit' });
    const custom = await h.publishing.create(bob, { bodyHtml: BODY, visibility: 'custom', audience: { unitIds: [UNIT_OTHER] } });
    expect(await whoSees(h, custom.id)).toEqual(['bob', 'carol-moderator']);
    h.viewerScopes.failing = true;
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit' }), 'VISIBILITY_UNIT_UNKNOWN');
    // Người xem chỉ còn thấy bài công khai và bài của mình.
    await expectError(h.publishing.get(alice, unit.id), 'POST_NOT_FOUND');
    await expectError(h.publishing.get(moderator, custom.id), 'POST_NOT_FOUND');
    await expect(h.publishing.get(bob, unit.id)).resolves.toMatchObject({ id: unit.id });
    await expect(h.publishing.create(alice, { bodyHtml: BODY })).resolves.toMatchObject({ visibility: 'company' });
  });

  it('custom: người được chọn và người thuộc phòng ban được chọn thấy; tác giả thấy danh sách, người khác thì không', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, {
      bodyHtml: BODY,
      visibility: 'custom',
      audience: { userIds: [DAVE], unitIds: [UNIT_OTHER] },
    });
    // Dave theo người, Carol theo phòng ban; Bob, quản trị và người ngoài thì không.
    expect(await whoSees(h, post.id)).toEqual(['alice', 'carol-moderator', 'dave']);
    expect(post.audience).toEqual({
      users: [NAMES[DAVE]],
      units: [{ id: UNIT_OTHER, name: 'Phòng Kế toán', kind: 'unit' }],
    });
    const seenByDave = await h.publishing.get(actor(DAVE), post.id);
    expect(seenByDave.audience).toBeUndefined();
    expect(seenByDave.capabilities.canChangeVisibility).toBe(false);
  });

  it('custom: phòng ban được chọn gồm cả phòng con', async () => {
    const h = harness();
    const post = await h.publishing.create(moderator, {
      bodyHtml: BODY,
      visibility: 'custom',
      audience: { unitIds: [UNIT_PARENT] },
    });
    // Alice ở phòng cha, Bob ở phòng con (ViewerScope.unitIds của Bob có cả tổ tiên).
    expect(await whoSees(h, post.id)).toEqual(['alice', 'bob', 'carol-moderator']);
  });

  it('custom: danh sách rỗng, id lạ, phòng ban không có hoặc vượt giới hạn đều 400 VISIBILITY_AUDIENCE_INVALID', async () => {
    const h = harness();
    const code = 'VISIBILITY_AUDIENCE_INVALID';
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom' }), code, 400);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { userIds: [], unitIds: [] } }), code);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { userIds: ['khong-phai-uuid'] } }), code);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { userIds: [FOREIGN_USER] } }), code);
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { unitIds: [UNIT_GONE] } }), code);
    const tooMany = Array.from({ length: 201 }, () => randomUUID());
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { userIds: tooMany } }), code);
    const tooManyUnits = Array.from({ length: 51 }, () => randomUUID());
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { unitIds: tooManyUnits } }), code);
    expect(h.store.rows.size).toBe(0);
  });

  it('custom: người được @mention tự vào danh sách chia sẻ và nhận sự kiện nhắc tên', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, {
      bodyHtml: BODY,
      visibility: 'custom',
      audience: { userIds: [BOB] },
      mentionUserIds: [DAVE],
    });
    expect(post.audience?.users.map((user) => user.id).sort()).toEqual([BOB, DAVE].sort());
    expect(post.mentions.map((user) => user.id)).toEqual([DAVE]);
    expect(await whoSees(h, post.id)).toContain('dave');
    expect(h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned).map((e) => e.payload['mentionedUserId'])).toEqual([DAVE]);
  });

  it('unit: người được nhắc mà không thấy được bài bị bỏ khỏi mentions và không có thông báo', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit', mentionUserIds: [BOB, DAVE, CAROL] });
    expect(post.mentions.map((user) => user.id)).toEqual([BOB]);
    expect(h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned).map((e) => e.payload['mentionedUserId'])).toEqual([BOB]);
  });

  it('private: chỉ tác giả thấy, kể cả bài hẹn giờ; người được nhắc bị bỏ; moderator và quản trị không thấy', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private', mentionUserIds: [BOB] });
    expect(post.mentions).toEqual([]);
    expect(h.store.events.some((e) => e.type === SOCIAL_EVENT_TYPES.mentioned)).toBe(false);
    expect(await whoSees(h, post.id)).toEqual(['alice']);

    const scheduled = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private', scheduledAt: iso(3600) });
    expect(scheduled.status).toBe('scheduled');
    expect(await whoSees(h, scheduled.id)).toEqual(['alice']);
  });

  it('không có quyền xem riêng cho bài nhóm; giá trị lạ là 400 VALIDATION', async () => {
    const h = harness();
    for (const visibility of ['unit', 'custom', 'private'] as const) {
      await expectError(
        h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC, visibility, audience: { userIds: [BOB] } }),
        'VISIBILITY_NOT_ALLOWED',
        400,
      );
    }
    await expect(h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC, visibility: 'company' })).resolves.toMatchObject({
      visibility: 'company',
    });
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, visibility: 'bi-mat' as never }), 'VALIDATION', 400);
  });

  it('thông báo, ghim, nhắc tất cả và xác nhận đã đọc chỉ đi với company', async () => {
    const h = harness();
    for (const visibility of ['unit', 'private'] as const) {
      await expectError(h.publishing.create(moderator, { bodyHtml: BODY, visibility, kind: 'announcement' }), 'VISIBILITY_NOT_ALLOWED', 400);
      await expectError(h.publishing.create(moderator, { bodyHtml: BODY, visibility, pinned: true }), 'VISIBILITY_NOT_ALLOWED');
      await expectError(h.publishing.create(moderator, { bodyHtml: BODY, visibility, mentionsAll: true }), 'VISIBILITY_NOT_ALLOWED');
      await expectError(
        h.publishing.create(alice, { bodyHtml: BODY, visibility, requiresReadConfirmation: true }),
        'VISIBILITY_NOT_ALLOWED',
      );
    }
    await expect(h.publishing.create(moderator, { bodyHtml: BODY, kind: 'announcement', pinned: true })).resolves.toMatchObject({
      kind: 'announcement',
      pinned: true,
    });
  });

  it('duyệt bài chỉ áp cho bài company; quyền hẹp đăng thẳng, kể cả khi hẹn giờ rồi đến hạn', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    expect((await h.publishing.create(alice, { bodyHtml: BODY })).status).toBe('pending');
    expect((await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit' })).status).toBe('published');
    expect((await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private' })).status).toBe('published');
    expect(
      (await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'custom', audience: { userIds: [BOB] } })).status,
    ).toBe('published');

    const scheduled = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private', scheduledAt: iso(600) });
    const publicScheduled = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(600) });
    h.clock.now = new Date(iso(700));
    await h.scheduler.publishDueScheduled(TENANT, { now: h.clock.now });
    expect(h.store.rows.get(scheduled.id)?.status).toBe('published');
    expect(h.store.rows.get(publicScheduled.id)?.status).toBe('pending');
  });

  it('đăng ngay bài hẹn giờ quyền hẹp không qua duyệt', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit', scheduledAt: iso(3600) });
    await expect(h.publishing.publishNow(alice, post.id)).resolves.toMatchObject({ status: 'published', visibility: 'unit' });
  });
});

describe('quyền xem bài: đổi quyền xem', () => {
  it('chỉ tác giả đổi được; không tính là đã sửa; phát post.changed; bài mất khỏi tầm nhìn của người khác', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    h.store.events.length = 0;
    const updated = await h.publishing.update(alice, post.id, { visibility: 'private' });
    expect(updated).toMatchObject({ visibility: 'private' });
    expect(updated.editedAt).toBeUndefined();
    expect(updated.editCount ?? 0).toBe(0);
    expect(h.store.edits).toEqual([]);
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postChanged]);
    expect(h.store.events[0].payload).toMatchObject({ postId: post.id, change: 'updated', actorId: ALICE });
    expect(await whoSees(h, post.id)).toEqual(['alice']);

    // Không phải tác giả: 403 VISIBILITY_CHANGE_FORBIDDEN (moderator sửa nội dung được nhưng không đổi quyền xem).
    const open = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(moderator, open.id, { visibility: 'unit' }), 'VISIBILITY_CHANGE_FORBIDDEN', 403);
    await expectError(h.publishing.update(bob, open.id, { visibility: 'unit' }), 'VISIBILITY_CHANGE_FORBIDDEN', 403);
  });

  it('thu hẹp rồi mở lại: không gửi lại thông báo postPublished', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await h.publishing.update(alice, post.id, { visibility: 'unit' });
    expect(h.store.rows.get(post.id)?.authorUnitId).toBe(UNIT_PARENT);
    h.store.events.length = 0;
    await h.publishing.update(alice, post.id, { visibility: 'company' });
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postChanged]);
    expect(h.store.rows.get(post.id)?.authorUnitId).toBeUndefined();
    expect(await whoSees(h, post.id)).toHaveLength(7);
  });

  it('sang custom cần danh sách; đổi danh sách thay toàn bộ; giữ danh sách khi chỉ nhắc lại custom', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(alice, post.id, { visibility: 'custom' }), 'VISIBILITY_AUDIENCE_INVALID', 400);
    await expectError(
      h.publishing.update(alice, post.id, { visibility: 'custom', audience: { userIds: [FOREIGN_USER] } }),
      'VISIBILITY_AUDIENCE_INVALID',
    );
    await h.publishing.update(alice, post.id, { visibility: 'custom', audience: { userIds: [BOB] } });
    expect(await whoSees(h, post.id)).toEqual(['alice', 'bob']);
    await h.publishing.update(alice, post.id, { audience: { userIds: [DAVE] } });
    expect(await whoSees(h, post.id)).toEqual(['alice', 'dave']);
    await h.publishing.update(alice, post.id, { visibility: 'custom' });
    expect(await whoSees(h, post.id)).toEqual(['alice', 'dave']);
  });

  it('chỉ bài đã đăng hoặc hẹn giờ; bài chờ duyệt, bị từ chối và bài nhóm thì không', async () => {
    const h = harness();
    h.settings.value = { wallRequireApproval: true };
    const pending = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(alice, pending.id, { visibility: 'private' }), 'VISIBILITY_CHANGE_FORBIDDEN', 403);
    h.settings.value = { wallRequireApproval: false };
    const scheduled = await h.publishing.create(alice, { bodyHtml: BODY, scheduledAt: iso(3600) });
    await expect(h.publishing.update(alice, scheduled.id, { visibility: 'private' })).resolves.toMatchObject({ visibility: 'private' });
    const inGroup = await h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC });
    await expectError(h.publishing.update(alice, inGroup.id, { visibility: 'private' }), 'VISIBILITY_NOT_ALLOWED', 400);
    await expect(h.publishing.update(alice, inGroup.id, { visibility: 'company' })).resolves.toMatchObject({ id: inGroup.id });
  });

  it('bài đang là thông báo, ghim hoặc cần xác nhận đã đọc không thu hẹp được', async () => {
    const h = harness();
    const announcement = await h.publishing.create(moderator, { bodyHtml: BODY, kind: 'announcement' });
    await expectError(h.publishing.update(moderator, announcement.id, { visibility: 'unit' }), 'VISIBILITY_NOT_ALLOWED', 400);
    const pinned = await h.publishing.create(moderator, { bodyHtml: BODY, pinned: true });
    await expectError(h.publishing.update(moderator, pinned.id, { visibility: 'private' }), 'VISIBILITY_NOT_ALLOWED');
    const confirm = await h.publishing.create(alice, { bodyHtml: BODY, requiresReadConfirmation: true });
    await expectError(h.publishing.update(alice, confirm.id, { visibility: 'private' }), 'VISIBILITY_NOT_ALLOWED');
    // và bài quyền hẹp không bật được xác nhận đã đọc hay ghim
    const quiet = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private' });
    await expectError(h.publishing.update(alice, quiet.id, { requiresReadConfirmation: true }), 'VISIBILITY_NOT_ALLOWED');
    const own = await h.publishing.create(moderator, { bodyHtml: BODY, visibility: 'private' });
    await expectError(h.publishing.setPinned(moderator, own.id, { pinned: true }), 'VISIBILITY_NOT_ALLOWED');
  });

  it('đổi danh sách nhắc tên sau khi đổi quyền xem: custom thêm vào danh sách, unit bỏ người không thấy', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, mentionUserIds: [BOB, DAVE] });
    // Thu hẹp sang unit: Dave không thuộc phòng ban nào nên bị bỏ khỏi mentions, Bob giữ.
    const unit = await h.publishing.update(alice, post.id, { visibility: 'unit' });
    expect(unit.mentions.map((user) => user.id)).toEqual([BOB]);
    // Sang custom rồi nhắc Dave: Dave tự vào danh sách chia sẻ.
    await h.publishing.update(alice, post.id, { visibility: 'custom', audience: { userIds: [BOB] } });
    const custom = await h.publishing.update(alice, post.id, { mentionUserIds: [DAVE] });
    expect(custom.audience?.users.map((user) => user.id).sort()).toEqual([BOB, DAVE].sort());
    expect(await whoSees(h, post.id)).toContain('dave');
    // Sang private: không còn ai được nhắc.
    const priv = await h.publishing.update(alice, post.id, { visibility: 'private' });
    expect(priv.mentions).toEqual([]);
  });

  it('đổi quyền xem thì mọi đường đọc và tương tác của người khác đều 404 (đã lưu, phản ứng, bình luận, bình chọn)', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, poll: { question: 'Hỏi', options: ['A', 'B'] } });
    await h.bookmarks.set(bob, post.id, { bookmarked: true });
    await h.reactions.set(bob, post.id, { type: 'like' });
    expect((await h.bookmarks.list(bob)).items.map((item) => item.id)).toEqual([post.id]);
    expect((await h.myPosts.inbox(bob)).bookmarks).toBe(1);

    await h.publishing.update(alice, post.id, { visibility: 'private' });
    expect((await h.bookmarks.list(bob)).items).toEqual([]);
    expect((await h.myPosts.inbox(bob)).bookmarks).toBe(0);
    await expectError(h.publishing.get(bob, post.id), 'POST_NOT_FOUND', 404);
    await expectError(h.bookmarks.set(bob, post.id, { bookmarked: false }), 'POST_NOT_FOUND');
    await expectError(h.reactions.set(bob, post.id, { type: 'like' }), 'POST_NOT_FOUND');
    await expectError(h.reactions.reactors(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.comments.create(bob, post.id, { body: 'Xin chào' }), 'POST_NOT_FOUND');
    await expectError(h.comments.list(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.polls.vote(bob, post.id, { optionIds: [] }), 'POST_NOT_FOUND');
    await expectError(h.polls.voters(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.polls.close(moderator, post.id), 'POST_NOT_FOUND');
    await expectError(h.confirmations.confirm(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.history.get(bob, post.id), 'POST_NOT_FOUND');
    await expectError(h.publishing.remove(moderator, post.id), 'POST_NOT_FOUND');
    await expectError(h.publishing.update(moderator, post.id, { title: 'Sửa trộm' }), 'POST_NOT_FOUND');
    await expectError(h.publishing.setPinned(moderator, post.id, { pinned: true }), 'POST_NOT_FOUND');
    // Tác giả vẫn thấy, và mở lại thì bài trở về với người xem.
    await expect(h.publishing.get(alice, post.id)).resolves.toMatchObject({ visibility: 'private' });
    await h.publishing.update(alice, post.id, { visibility: 'company' });
    expect((await h.bookmarks.list(bob)).items.map((item) => item.id)).toEqual([post.id]);
  });

  it('bài của tôi: bài hẹn giờ quyền hẹp hiện và được đếm cho tác giả, moderator không thấy', async () => {
    const h = harness();
    await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private', scheduledAt: iso(3600) });
    expect((await h.myPosts.list(alice, { status: 'scheduled' })).items).toHaveLength(1);
    expect((await h.myPosts.inbox(alice)).myScheduled).toBe(1);
    expect((await h.myPosts.inbox(moderator)).myScheduled).toBe(0);
  });
});

describe('quyền xem bài: bình luận và thông báo', () => {
  it('bình luận của bài unit chỉ báo cho người nhắc thấy được bài; người trả lời đã mất quyền xem không nhận', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'unit' });
    h.store.events.length = 0;
    await h.comments.create(bob, post.id, { body: 'Chào', mentionUserIds: [ALICE, DAVE, CAROL] }).catch(() => undefined);
    const created = h.store.events.find((e) => e.type === SOCIAL_EVENT_TYPES.commentCreated);
    expect(created?.payload).toMatchObject({ postId: post.id, mentionedUserIds: [ALICE] });
    expect(
      h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned).map((e) => e.payload['mentionedUserId']),
    ).toEqual([ALICE]);
  });

  it('bài private: không ai ngoài tác giả được nhắc trong bình luận', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, visibility: 'private' });
    h.store.events.length = 0;
    await h.comments.create(alice, post.id, { body: 'Ghi chú', mentionUserIds: [BOB] }).catch(() => undefined);
    expect(h.store.events.some((e) => e.type === SOCIAL_EVENT_TYPES.mentioned)).toBe(false);
  });

  it('bài công khai và bài nhóm: người được nhắc như trước', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    h.store.events.length = 0;
    await h.comments.create(bob, post.id, { body: 'Chào', mentionUserIds: [DAVE, CAROL] }).catch(() => undefined);
    expect(
      h.store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned).map((e) => e.payload['mentionedUserId']),
    ).toEqual([DAVE, CAROL]);
  });
});

describe('tắt bình luận', () => {
  it('tạo bài đã tắt bình luận: capability canComment=false, bình luận mới 403 COMMENTS_DISABLED, phản ứng vẫn dùng được', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, commentsDisabled: true });
    expect(post.commentsDisabled).toBe(true);
    expect(post.capabilities).toMatchObject({ canComment: false, canToggleComments: true });
    const seenByBob = await h.publishing.get(bob, post.id);
    expect(seenByBob.capabilities).toMatchObject({ canComment: false, canToggleComments: false });
    await expectError(h.comments.create(bob, post.id, { body: 'Xin chào' }), 'COMMENTS_DISABLED', 403);
    await expectError(h.comments.create(alice, post.id, { body: 'Tôi cũng không bình luận được' }), 'COMMENTS_DISABLED');
    await expect(h.reactions.set(bob, post.id, { type: 'like' })).resolves.toMatchObject({ reactionTotal: 1 });
  });

  it('tác giả, moderator bật/tắt; người khác 403 FORBIDDEN; có sự kiện post.changed và không tính là đã sửa', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    expect(post.capabilities.canComment).toBe(true);
    h.store.events.length = 0;
    const off = await h.publishing.update(alice, post.id, { commentsDisabled: true });
    expect(off).toMatchObject({ commentsDisabled: true });
    expect(off.editedAt).toBeUndefined();
    expect(types(h.store.events)).toEqual([SOCIAL_EVENT_TYPES.postChanged]);
    await expectError(h.publishing.update(bob, post.id, { commentsDisabled: false }), 'FORBIDDEN', 403);
    await expect(h.publishing.update(moderator, post.id, { commentsDisabled: false })).resolves.toMatchObject({
      capabilities: { canComment: true },
    });
    // Đặt lại đúng giá trị hiện tại là không có gì đổi: không sự kiện mới.
    h.store.events.length = 0;
    await h.publishing.update(alice, post.id, { commentsDisabled: false });
    expect(h.store.events).toEqual([]);
  });

  it('bình luận được phép lại sau khi bật: không còn bị chặn bởi COMMENTS_DISABLED', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY, commentsDisabled: true });
    await h.publishing.update(alice, post.id, { commentsDisabled: false });
    h.store.events.length = 0;
    await h.comments.create(bob, post.id, { body: 'Hay quá' }).catch(() => undefined);
    expect(h.store.events.some((e) => e.type === SOCIAL_EVENT_TYPES.commentCreated)).toBe(true);
  });

  it('bài nhóm: admin nhóm bật/tắt được, thành viên thường thì không', async () => {
    const h = harness();
    const post = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC });
    await expect(h.publishing.update(alice, post.id, { commentsDisabled: true })).resolves.toMatchObject({ commentsDisabled: true });
    await expectError(h.publishing.update(actor(CAROL), post.id, { commentsDisabled: false }), 'FORBIDDEN', 403);
  });
});

describe('lịch sử sửa', () => {
  it('sửa nội dung hoặc tiêu đề lưu bản trước khi ghi đè; version 1 là bản gốc; bản hiện tại là editCount + 1', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: '<p>Bản gốc</p>', title: 'Tiêu đề gốc' });
    await h.publishing.update(alice, post.id, { bodyHtml: '<p>Bản hai</p>' });
    const third = await h.publishing.update(moderator, post.id, { title: 'Tiêu đề mới' });
    expect(third.editCount).toBe(2);
    expect(third.capabilities.canViewHistory).toBe(true);

    const history = await h.history.get(alice, post.id);
    expect(history.postId).toBe(post.id);
    expect(history.current).toMatchObject({ version: 3, title: 'Tiêu đề mới', bodyHtml: '<p>Bản hai</p>' });
    expect(history.current.editedAt).toBeDefined();
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history.versions[1]).toMatchObject({ title: 'Tiêu đề gốc', bodyHtml: '<p>Bản gốc</p>', editedBy: NAMES[ALICE] });
    // Người sửa bản 2 thành bản 3 là moderator.
    expect(history.versions[0]).toMatchObject({ bodyHtml: '<p>Bản hai</p>', editedBy: NAMES[CAROL] });
  });

  it('chỉ đổi trường khác, hoặc lưu lại đúng nội dung cũ, không tạo bản', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: '<p>Nội dung</p>' });
    await h.publishing.update(alice, post.id, { bodyHtml: '<p>Nội dung</p>' });
    await h.publishing.update(alice, post.id, { commentsDisabled: true, visibility: 'unit' });
    await h.publishing.update(alice, post.id, { mentionUserIds: [BOB] });
    expect(h.store.edits).toEqual([]);
    const history = await h.history.get(alice, post.id);
    expect(history.versions).toEqual([]);
    expect(history.current.version).toBe(1);
  });

  it('bài chưa đăng sửa thoải mái không để lại lịch sử', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: '<p>Hẹn giờ</p>', scheduledAt: iso(3600) });
    await h.publishing.update(alice, post.id, { bodyHtml: '<p>Sửa trước khi đăng</p>' });
    expect(h.store.edits).toEqual([]);
  });

  it('quyền xem lịch sử: tác giả, moderator (Tường công ty), admin nhóm (bài nhóm); người khác 403, người không thấy bài 404', async () => {
    const h = harness();
    const wall = await h.publishing.create(alice, { bodyHtml: '<p>a</p>' });
    await h.publishing.update(alice, wall.id, { bodyHtml: '<p>b</p>' });
    await expect(h.history.get(alice, wall.id)).resolves.toMatchObject({ postId: wall.id });
    await expect(h.history.get(moderator, wall.id)).resolves.toMatchObject({ postId: wall.id });
    await expectError(h.history.get(bob, wall.id), 'FORBIDDEN', 403);
    await expect(h.publishing.get(bob, wall.id)).resolves.toMatchObject({ capabilities: { canViewHistory: false } });

    const grouped = await h.publishing.create(bob, { bodyHtml: '<p>a</p>', groupId: G_PUBLIC });
    await h.publishing.update(bob, grouped.id, { bodyHtml: '<p>b</p>' });
    await expect(h.history.get(alice, grouped.id)).resolves.toMatchObject({ postId: grouped.id }); // admin nhóm
    await expect(h.history.get(bob, grouped.id)).resolves.toMatchObject({ postId: grouped.id }); // tác giả
    await expectError(h.history.get(moderator, grouped.id), 'FORBIDDEN', 403);

    const secret = await h.publishing.create(alice, { bodyHtml: '<p>a</p>', visibility: 'private' });
    await expectError(h.history.get(moderator, secret.id), 'POST_NOT_FOUND', 404);
    await expectError(h.history.get(alice, randomUUID()), 'POST_NOT_FOUND');
  });
});

describe('bài trong nhóm: quyền đăng và chủ đề', () => {
  it('nhóm chỉ cho admin đăng: thành viên thường 403 GROUP_POST_NOT_ALLOWED, admin đăng được, người ngoài 403 GROUP_NOT_MEMBER', async () => {
    const h = harness();
    h.posting.adminsOnly.add(G_PUBLIC);
    await expectError(h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC }), 'GROUP_POST_NOT_ALLOWED', 403);
    await expectError(h.publishing.create(dave, { bodyHtml: BODY, groupId: G_PUBLIC }), 'GROUP_NOT_MEMBER', 403);
    await expect(h.publishing.create(alice, { bodyHtml: BODY, groupId: G_PUBLIC })).resolves.toMatchObject({ status: 'published' });
    // nhóm riêng tư người ngoài vẫn là 404 (không lộ nhóm)
    await expectError(h.publishing.create(dave, { bodyHtml: BODY, groupId: G_PRIVATE }), 'GROUP_NOT_FOUND', 404);
  });

  it('chọn chủ đề của nhóm khi đăng và đổi sau: tác giả, admin nhóm; chủ đề phải thuộc nhóm', async () => {
    const h = harness();
    const post = await h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, groupTopicId: TOPIC_A });
    expect(post.groupTopic).toEqual({ id: TOPIC_A, name: 'Chủ đề A' });
    await expectError(h.publishing.create(bob, { bodyHtml: BODY, groupId: G_PUBLIC, groupTopicId: TOPIC_FOREIGN }), 'GROUP_TOPIC_NOT_FOUND', 404);
    await expectError(h.publishing.create(bob, { bodyHtml: BODY, groupTopicId: TOPIC_A }), 'VALIDATION', 400);

    const cleared = await h.publishing.update(bob, post.id, { groupTopicId: null });
    expect(cleared.groupTopic).toBeUndefined();
    expect(cleared.editedAt).toBeUndefined();
    await expect(h.publishing.update(alice, post.id, { groupTopicId: TOPIC_A })).resolves.toMatchObject({
      groupTopic: { id: TOPIC_A },
    });
    await expectError(h.publishing.update(actor(CAROL), post.id, { groupTopicId: null }), 'FORBIDDEN', 403);
    await expectError(h.publishing.update(bob, post.id, { groupTopicId: TOPIC_FOREIGN }), 'GROUP_TOPIC_NOT_FOUND', 404);
    const wall = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(h.publishing.update(alice, wall.id, { groupTopicId: TOPIC_A }), 'FORBIDDEN');
  });
});


/* ------------------------------------------------- video đính kèm và gate */

describe('video đính kèm bài viết', () => {
  type Harness = ReturnType<typeof harness>;
  let counter = 0;

  function file(
    h: Harness,
    over: Partial<AttachmentRow> & { readonly owner?: string } = {},
  ): string {
    counter += 1;
    const id = `aaaaaaaa-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    const { owner, ...rest } = over;
    h.files.set(id, {
      id,
      uploadedBy: owner ?? ALICE,
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1000,
      storageKey: `k/${id}/clip.mp4`,
      completed: true,
      purpose: 'post',
      processingStatus: 'ready',
      ...rest,
    });
    return id;
  }

  it('video none, ready, queued, processing đăng được ngay, hẹn giờ và chờ duyệt', async () => {
    const h = harness();
    const ready = file(h);
    const legacy = file(h, { processingStatus: 'none' });
    await h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [ready, legacy] });

    for (const status of ['queued', 'processing'] as const) {
      const pending = file(h, { processingStatus: status });
      await expect(h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [pending] })).resolves.toBeDefined();
      const scheduled = file(h, { processingStatus: status });
      await expect(
        h.publishing.create(alice, {
          bodyHtml: BODY,
          attachmentIds: [scheduled],
          scheduledAt: new Date(h.clock.now.getTime() + 3_600_000).toISOString(),
        }),
      ).resolves.toBeDefined();
    }
    h.settings.value = { wallRequireApproval: true };
    await expect(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [file(h, { processingStatus: 'queued' })] }),
    ).resolves.toBeDefined();
  });

  it('video failed bị từ chối SOCIAL_VIDEO_FAILED khi đăng ngay, hẹn giờ và gửi duyệt', async () => {
    const h = harness();
    const failed = file(h, { processingStatus: 'failed' });
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [failed] }), 'SOCIAL_VIDEO_FAILED', 409);
    // Bài hẹn giờ kiểm ngay lúc lưu, không đợi tới giờ đăng.
    await expectError(
      h.publishing.create(alice, {
        bodyHtml: BODY,
        attachmentIds: [failed],
        scheduledAt: new Date(h.clock.now.getTime() + 3_600_000).toISOString(),
      }),
      'SOCIAL_VIDEO_FAILED',
    );
    h.settings.value = { wallRequireApproval: true };
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [failed] }), 'SOCIAL_VIDEO_FAILED');
  });

  it('sửa bài: thêm video processing được, video failed bị chặn', async () => {
    const h = harness();
    const post = await h.publishing.create(alice, { bodyHtml: BODY });
    await expectError(
      h.publishing.update(alice, post.id, { attachmentIds: [file(h, { processingStatus: 'failed' })] }),
      'SOCIAL_VIDEO_FAILED',
    );
    const processing = await h.publishing.update(alice, post.id, {
      attachmentIds: [file(h, { processingStatus: 'processing' })],
    });
    expect(processing.id).toBe(post.id);
    const updated = await h.publishing.update(alice, post.id, { attachmentIds: [file(h)] });
    expect(updated.id).toBe(post.id);
  });

  it('tối đa 3 video, ảnh trộn được với video, video của bình luận không gắn vào bài, tài liệu thì được', async () => {
    const h = harness();
    const videos = [file(h), file(h), file(h)];
    await h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: videos });
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [...videos, file(h)] }),
      'VALIDATION',
    );
    const image = file(h, { contentType: 'image/png', fileName: 'a.png' });
    await expect(h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [image, file(h)] })).resolves.toBeDefined();
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [file(h, { purpose: 'comment' })] }),
      'VALIDATION',
    );
    const pdf = file(h, { contentType: 'application/pdf', fileName: 'a.pdf', processingStatus: 'none' });
    await h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [pdf, file(h)] });
    // Đủ ba loại cùng lúc, nhưng vẫn không quá 10 tệp.
    await expect(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [pdf, image, file(h), file(h)] }),
    ).resolves.toBeDefined();
    const many = Array.from({ length: 9 }, () => file(h, { contentType: 'image/png', fileName: 'b.png' }));
    await expectError(h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [...many, pdf, file(h)] }), 'VALIDATION');
  });

  it('bố cục ảnh và video: mặc định auto, lưu khi hợp lệ, từ chối khi sai, sửa thì đổi hoặc giữ nguyên', async () => {
    const h = harness();
    const plain = await h.publishing.create(alice, { bodyHtml: BODY });
    expect(plain.mediaLayout).toBe('auto');
    const grid = await h.publishing.create(alice, { bodyHtml: BODY, mediaLayout: 'grid' });
    expect(grid.mediaLayout).toBe('grid');
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, mediaLayout: 'mosaic' as never }),
      'VALIDATION',
      400,
    );
    await expectError(h.publishing.update(alice, grid.id, { mediaLayout: 'mosaic' as never }), 'VALIDATION', 400);
    expect((await h.publishing.update(alice, grid.id, { mediaLayout: 'carousel' })).mediaLayout).toBe('carousel');
    // Sửa mà không gửi bố cục thì giữ nguyên.
    expect((await h.publishing.update(alice, grid.id, { bodyHtml: '<p>Nội dung mới</p>' })).mediaLayout).toBe('carousel');
    expect((await h.publishing.get(alice, grid.id)).mediaLayout).toBe('carousel');
  });

  it('bố cục giữ nguyên khi bài hẹn giờ được đăng và khi bài chờ duyệt được duyệt', async () => {
    const h = harness();
    const scheduled = await h.publishing.create(alice, {
      bodyHtml: BODY,
      mediaLayout: 'featured',
      scheduledAt: new Date(h.clock.now.getTime() + 3_600_000).toISOString(),
    });
    expect(scheduled.status).toBe('scheduled');
    const now = await h.publishing.publishNow(alice, scheduled.id);
    expect(now.status).toBe('published');
    expect(now.mediaLayout).toBe('featured');

    h.settings.value = { wallRequireApproval: true };
    const pending = await h.publishing.create(alice, { bodyHtml: BODY, mediaLayout: 'stack' });
    expect(pending.status).toBe('pending');
    expect(pending.mediaLayout).toBe('stack');
    const approved = await h.moderation.approve(moderator, pending.id);
    expect(approved.status).toBe('published');
    expect(approved.mediaLayout).toBe('stack');
  });

  it('không gắn tệp của người khác hay chưa tải xong', async () => {
    const h = harness();
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [file(h, { owner: BOB })] }),
      'ATTACHMENT_UNAVAILABLE',
    );
    await expectError(
      h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [file(h, { completed: false })] }),
      'ATTACHMENT_UNAVAILABLE',
    );
  });

  it('xoá bài xoá ngay video, poster và bản gốc còn sót, kể cả dòng', async () => {
    const h = harness();
    const id = file(h, { posterKey: 'k/poster.jpg', sourceKey: 'k/source.mov' });
    const other = file(h);
    const post = await h.publishing.create(alice, { bodyHtml: BODY, attachmentIds: [id, other] });
    h.files.set(id, { ...(h.files.get(id) as AttachmentRow), postId: post.id });
    h.files.set(other, { ...(h.files.get(other) as AttachmentRow), postId: post.id });

    await h.publishing.remove(alice, post.id);
    expect(h.deletedKeys.sort()).toEqual(
      [`k/${id}/clip.mp4`, 'k/poster.jpg', 'k/source.mov', `k/${other}/clip.mp4`].sort(),
    );
    expect(h.files.size).toBe(0);
  });
});
