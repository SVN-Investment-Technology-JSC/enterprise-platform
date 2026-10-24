import type {
  SocialPoll,
  SocialPost,
  SocialPostAudience,
  SocialPostCapabilities,
  SocialReadConfirmationSummary,
  SocialUnitRef,
  SocialUserRef,
} from '@enterprise-platform/contracts-social';
import { isPollClosed } from '../domain/social-poll-rules.js';
import { mayManage, mayModerate } from '../domain/social-principal.js';
import { toIso } from '../domain/social-rules.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { GroupMembershipPort } from './ports/group-membership.port.js';
import type { GroupPostingPort } from './ports/group-posting.port.js';
import type { OrgStructurePort } from './ports/viewer-scope.port.js';
import type { PeopleProfilePort } from './ports/people-profile.port.js';
import type { ExtendedPostRow, PollRow, PostAudienceRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';
import { ReadAudience } from './social-read-audience.js';
import type { SocialStore } from './social-store.port.js';
import { lookupUsers, toAttachmentView } from './social-views.js';

export interface PostViewAssemblerDeps {
  readonly store: Pick<SocialStore, 'posts'>;
  readonly publishing: Pick<SocialPublishingStore, 'engagement'>;
  readonly directory: OrganizationDirectory;
  readonly storage: AttachmentStorage;
  readonly groups: Pick<GroupMembershipPort, 'isAdmin' | 'memberGroupIds' | 'listMemberIds'>;
  readonly people: Pick<PeopleProfilePort, 'listActiveUserIds'>;
  /** Đợt 2. Tên chủ đề nhóm (`SocialPost.groupTopic`); thiếu thì bỏ trường này. */
  readonly topics?: Pick<GroupPostingPort, 'topicRefs'>;
  /** Đợt 2. Tên phòng ban/vị trí trong danh sách chia sẻ (`SocialPost.audience`); thiếu thì bỏ phòng ban. */
  readonly orgs?: Pick<OrgStructurePort, 'nodeRefs'>;
  /** Đồng hồ; mặc định giờ hệ thống. Test truyền giờ cố định. */
  readonly now?: () => Date;
}

/**
 * Dựng `SocialPost` đầy đủ từ các dòng bài (hiện thực `PostViewAssembler`): tác giả, chuyên mục,
 * nhóm, tệp, phản ứng, bình chọn, xác nhận đã đọc, đã lưu và `capabilities` theo người xem. Không
 * kiểm quyền nhìn thấy: người gọi đã lọc `rows`.
 *
 * Bình chọn ẩn danh: view chỉ mang số phiếu và lựa chọn của chính người xem; danh sách người bỏ phiếu
 * không bao giờ đi qua đây.
 */
export class SocialPostViewAssembler implements PostViewAssembler {
  private readonly audience: ReadAudience;

  constructor(private readonly deps: PostViewAssemblerDeps) {
    this.audience = new ReadAudience(deps.people, deps.groups);
  }

  async assemble(actor: SocialActor, rows: readonly ExtendedPostRow[]): Promise<SocialPost[]> {
    if (rows.length === 0) return [];
    const { store, publishing, directory, storage, groups } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    const ids = rows.map((row) => row.id);

    const [relations, engagement] = await Promise.all([
      store.posts.relations(actor.tenantId, ids, actor.userId),
      publishing.engagement(actor.tenantId, ids, actor.userId),
    ]);

    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.authorId);
      if (row.moderatedBy) userIds.add(row.moderatedBy);
      for (const id of relations.mentions.get(row.id) ?? []) userIds.add(id);
    }
    // Danh sách chia sẻ chỉ có cho tác giả của bài `custom` (store chỉ nạp cho đúng người đó).
    const audiences = engagement.audiences ?? new Map<string, PostAudienceRow>();
    for (const audience of audiences.values()) for (const id of audience.userIds) userIds.add(id);
    const [userOf, groupTopics, unitRefs] = await Promise.all([
      lookupUsers(directory, actor.tenantId, userIds),
      this.topicRefsOf(actor, rows),
      this.unitRefsOf(actor, audiences),
    ]);

    const groupIds = [...new Set(rows.flatMap((row) => (row.groupId ? [row.groupId] : [])))];
    const adminOf = new Map<string, boolean>(
      await Promise.all(
        groupIds.map(async (groupId): Promise<[string, boolean]> => [
          groupId,
          mayManage(actor) || (await groups.isAdmin(actor.tenantId, groupId, actor.userId)),
        ]),
      ),
    );
    const memberGroups = new Set(
      rows.some((row) => row.requiresReadConfirmation && row.groupId)
        ? await groups.memberGroupIds(actor.tenantId, actor.userId)
        : [],
    );
    const audience = this.audience.session(actor.tenantId);

    return Promise.all(
      rows.map(async (row): Promise<SocialPost> => {
        const isAuthor = row.authorId.toLowerCase() === actor.userId.toLowerCase();
        const isGroupAdmin = row.groupId ? (adminOf.get(row.groupId) ?? false) : false;
        const published = row.status === 'published';
        const poll = engagement.polls.get(row.id);
        const pollClosed = poll ? isPollClosed(poll, now) : false;

        const canViewConfirmations =
          row.requiresReadConfirmation &&
          published &&
          (isAuthor || (row.groupId ? isGroupAdmin || mayModerate(actor) : mayModerate(actor)));
        const capabilities = this.capabilities(actor, row, { isAuthor, isGroupAdmin, pollOpen: !!poll && !pollClosed, canViewConfirmations });

        const reactions = relations.reactions.get(row.id);
        const attachments = await Promise.all(
          (relations.attachments.get(row.id) ?? []).map((attachment) => toAttachmentView(storage, attachment)),
        );

        const confirmation = row.requiresReadConfirmation
          ? await this.confirmationSummary(row, {
              state: engagement.readConfirmations.get(row.id),
              isAuthor,
              canView: canViewConfirmations,
              isMember: row.groupId ? memberGroups.has(row.groupId) : true,
              audience,
            })
          : undefined;

        // Lý do từ chối và người duyệt chỉ cho tác giả và moderator (bài chưa đăng cũng chỉ hai nhóm này thấy).
        const privileged = isAuthor || mayModerate(actor);
        const moderatedBy =
          privileged && row.moderatedBy && row.moderatedBy.toLowerCase() !== row.authorId.toLowerCase()
            ? row.moderatedBy
            : undefined;

        return {
          id: row.id,
          author: userOf(row.authorId),
          kind: row.kind,
          ...(row.title ? { title: row.title } : {}),
          bodyHtml: row.bodyHtml,
          ...(row.topicId ? { topic: { id: row.topicId, name: row.topicName ?? '' } } : {}),
          pinned: row.pinned,
          attachments,
          mentions: (relations.mentions.get(row.id) ?? []).map(userOf),
          mentionsAll: row.mentionsAll,
          reactionCounts: reactions?.counts ?? {},
          reactionTotal: reactions?.total ?? 0,
          ...(reactions?.mine ? { myReaction: reactions.mine } : {}),
          commentCount: row.commentCount,
          publishedAt: toIso(row.publishedAt),
          ...(row.editedAt ? { editedAt: toIso(row.editedAt) } : {}),
          capabilities,
          status: row.status,
          visibility: row.visibility ?? 'company',
          ...(isAuthor && audiences.has(row.id) ? { audience: audienceView(audiences.get(row.id), userOf, unitRefs) } : {}),
          ...(row.commentsDisabled ? { commentsDisabled: true } : {}),
          ...((row.editCount ?? 0) > 0 ? { editCount: row.editCount } : {}),
          ...(row.groupTopicId && groupTopics.get(row.groupTopicId.toLowerCase())
            ? { groupTopic: groupTopics.get(row.groupTopicId.toLowerCase()) }
            : {}),
          ...(row.groupId && row.groupName !== undefined
            ? {
                group: {
                  id: row.groupId,
                  name: row.groupName,
                  privacy: row.groupPrivacy ?? 'public',
                  color: row.groupColor ?? 'blue',
                  icon: row.groupIcon ?? 'users',
                },
              }
            : {}),
          ...(poll ? { poll: this.pollView(poll, { published, closed: pollClosed }) } : {}),
          ...(confirmation ? { readConfirmation: confirmation } : {}),
          ...(row.status === 'scheduled' && row.scheduledAt ? { scheduledAt: toIso(row.scheduledAt) } : {}),
          ...(row.status === 'rejected' && row.rejectReason && privileged ? { rejectReason: row.rejectReason } : {}),
          ...(moderatedBy ? { moderatedBy: userOf(moderatedBy) } : {}),
          ...(moderatedBy && row.moderatedAt ? { moderatedAt: toIso(row.moderatedAt) } : {}),
          bookmarked: engagement.bookmarkedPostIds.has(row.id),
          ...(row.activityType
            ? { activity: { type: row.activityType, payload: row.activityPayload ?? {} } }
            : {}),
        };
      }),
    );
  }

  private capabilities(
    actor: SocialActor,
    row: ExtendedPostRow,
    flags: { isAuthor: boolean; isGroupAdmin: boolean; pollOpen: boolean; canViewConfirmations: boolean },
  ): SocialPostCapabilities {
    const published = row.status === 'published';
    const activity = row.activityType !== undefined;
    const moderates = mayModerate(actor);
    // Cùng luật với `SocialPostAccess.mayDelete`: moderator không xoá được bài nhóm riêng tư.
    const canDelete =
      flags.isAuthor || flags.isGroupAdmin || (moderates && row.groupPrivacy !== 'private');
    const visibility = row.visibility ?? 'company';
    return {
      canEdit: !activity && (flags.isAuthor || moderates),
      canDelete,
      // Chỉ bài công khai ghim được (quyền xem hẹp không đi cùng ghim).
      canPin: published && visibility === 'company' && (row.groupId ? flags.isGroupAdmin : moderates),
      // Bài đã tắt bình luận không nhận bình luận mới (bình luận cũ vẫn đọc, sửa, xoá được).
      canComment: published && row.commentsDisabled !== true,
      canToggleComments: !activity && (flags.isAuthor || flags.isGroupAdmin || moderates),
      canChangeVisibility:
        !activity && flags.isAuthor && !row.groupId && (row.status === 'published' || row.status === 'scheduled'),
      canViewHistory: (row.editCount ?? 0) > 0 && (flags.isAuthor || (row.groupId ? flags.isGroupAdmin : moderates)),
      canReport: published && !flags.isAuthor,
      canModerate: row.status === 'pending' && moderates,
      canViewReadConfirmations: flags.canViewConfirmations,
      canPublishNow: row.status === 'scheduled' && flags.isAuthor,
      canReschedule: row.status === 'scheduled' && flags.isAuthor,
      canClosePoll: published && flags.pollOpen && (flags.isAuthor || moderates),
    };
  }

  /** Tên chủ đề của các bài nhóm trong trang (một lần gọi cho cả trang). */
  private async topicRefsOf(
    actor: SocialActor,
    rows: readonly ExtendedPostRow[],
  ): Promise<ReadonlyMap<string, { id: string; name: string }>> {
    const ids = [...new Set(rows.flatMap((row) => (row.groupTopicId ? [row.groupTopicId] : [])))];
    if (ids.length === 0 || !this.deps.topics) return new Map();
    return this.deps.topics.topicRefs(actor.tenantId, ids);
  }

  private async unitRefsOf(
    actor: SocialActor,
    audiences: ReadonlyMap<string, PostAudienceRow>,
  ): Promise<ReadonlyMap<string, SocialUnitRef>> {
    const ids = [...new Set([...audiences.values()].flatMap((audience) => audience.unitIds))];
    if (ids.length === 0 || !this.deps.orgs) return new Map();
    return this.deps.orgs.nodeRefs(actor.tenantId, ids);
  }

  private pollView(poll: PollRow, state: { published: boolean; closed: boolean }): SocialPoll {
    return {
      id: poll.id,
      question: poll.question,
      allowMultiple: poll.allowMultiple,
      anonymous: poll.anonymous,
      ...(poll.closesAt ? { closesAt: toIso(poll.closesAt) } : {}),
      ...(poll.closedAt ? { closedAt: toIso(poll.closedAt) } : {}),
      isClosed: state.closed,
      options: [...poll.options]
        .sort((a, b) => a.position - b.position)
        .map((option) => ({ id: option.id, text: option.text, voteCount: option.voteCount })),
      totalVoters: poll.totalVoters,
      myOptionIds: poll.myOptionIds,
      canVote: state.published && !state.closed,
      // Ẩn danh: không ai (kể cả tác giả) xem được ai chọn gì.
      canViewVoters: !poll.anonymous,
    };
  }

  private async confirmationSummary(
    row: ExtendedPostRow,
    input: {
      state: { confirmedByMe: boolean; confirmedAt?: string; confirmedCount: number } | undefined;
      isAuthor: boolean;
      canView: boolean;
      isMember: boolean;
      audience: ReturnType<ReadAudience['session']>;
    },
  ): Promise<SocialReadConfirmationSummary> {
    const state = input.state;
    const base = {
      required: true as const,
      confirmedByMe: state?.confirmedByMe ?? false,
      ...(state?.confirmedAt ? { confirmedAt: toIso(state.confirmedAt) } : {}),
      canConfirm: row.status === 'published' && !input.isAuthor && input.isMember,
    };
    if (!input.canView) return base;
    const audienceCount = (await input.audience.of(row)).length;
    return {
      ...base,
      confirmedCount: Math.min(state?.confirmedCount ?? 0, audienceCount),
      audienceCount,
    };
  }
}

/** Danh sách chia sẻ đã tra tên: người theo danh bạ, phòng ban/vị trí theo sơ đồ tổ chức (nút đã mất thì bỏ). */
function audienceView(
  audience: PostAudienceRow | undefined,
  userOf: (userId: string) => SocialUserRef,
  unitRefs: ReadonlyMap<string, SocialUnitRef>,
): SocialPostAudience {
  return {
    users: (audience?.userIds ?? []).map(userOf),
    units: (audience?.unitIds ?? []).flatMap((id) => {
      const ref = unitRefs.get(id.toLowerCase());
      return ref ? [ref] : [];
    }),
  };
}
