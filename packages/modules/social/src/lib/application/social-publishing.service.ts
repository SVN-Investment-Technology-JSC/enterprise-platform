import { randomUUID } from 'node:crypto';
import {
  SOCIAL_AUDIENCE_MAX_USERS,
  type CreateSocialPostRequest,
  type PinSocialPostRequest,
  type SocialPost,
  type SocialPostVisibility,
  type UpdateSocialPostRequest,
} from '@enterprise-platform/contracts-social';
import { htmlToPlainText } from '../domain/html-sanitizer.js';
import { normalizeClosesAt, normalizePoll } from '../domain/social-poll-rules.js';
import {
  isExemptScheduled,
  normalizeScheduledAt,
  statusOnPublish,
  type EntryStatus,
} from '../domain/social-publishing-rules.js';
import { mayManage, mayModerate } from '../domain/social-principal.js';
import {
  normalizeAttachmentIds,
  normalizeBody,
  normalizeKind,
  normalizeMentionIds,
  normalizeTitle,
  requireContent,
  requireUuid,
} from '../domain/social-rules.js';
import { SocialGroupPostNotAllowedError, SocialGroupTopicNotFoundError } from '../domain/social-group.error.js';
import {
  EMPTY_AUDIENCE,
  assertCompanyOnlyFeatures,
  audienceIsEmpty,
  normalizeAudienceInput,
  normalizeVisibility,
  type PostAudience,
} from '../domain/social-visibility-rules.js';
import {
  SocialVisibilityAudienceError,
  SocialVisibilityChangeForbiddenError,
  SocialVisibilityNotAllowedError,
  SocialVisibilityUnitUnknownError,
} from '../domain/social-visibility.error.js';
import {
  SocialGroupNotMemberError,
  SocialPollClosedError,
  SocialPollLockedError,
  SocialPollNotFoundError,
  SocialPostGroupNotFoundError,
  SocialPostStateError,
  SocialReadConfirmationLockedError,
} from '../domain/social-publishing.error.js';
import {
  SocialForbiddenError,
  SocialTopicInactiveError,
  SocialTopicNotFoundError,
  SocialValidationError,
} from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { GroupAccessInfo, GroupMembershipPort } from './ports/group-membership.port.js';
import type { GroupPostingPort } from './ports/group-posting.port.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { SocialSettingsPort } from './ports/social-settings.port.js';
import type { OrgStructurePort, ViewerScopePort } from './ports/viewer-scope.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import {
  postChangedEvent,
  postPendingEvent,
  type PublishedEventBuilder,
} from './social-publishing-events.js';
import type { PublishingPostPatch, SocialPublishingStore, WritablePostRow } from './social-publishing-store.port.js';
import type { SocialOutboxEvent, SocialStore } from './social-store.port.js';
import { knownUserIds, mentionEvents } from './social-views.js';

/** Trường của `UpdateSocialPostRequest` thuộc về nội dung bài (tác giả hoặc moderator sửa). */
const CONTENT_FIELDS = [
  'title',
  'bodyHtml',
  'topicId',
  'attachmentIds',
  'mentionUserIds',
  'scheduledAt',
  'requiresReadConfirmation',
  'poll',
] as const satisfies readonly (keyof UpdateSocialPostRequest)[];

export interface SocialPublishingDeps {
  readonly store: SocialPublishingStore;
  /** Chỉ dùng chuyên mục và quan hệ (tệp, người nhắc) của store P1. */
  readonly social: Pick<SocialStore, 'topics' | 'posts'>;
  readonly directory: OrganizationDirectory;
  readonly groups: GroupMembershipPort;
  readonly settings: SocialSettingsPort;
  readonly access: SocialPostAccess;
  readonly assembler: PostViewAssembler;
  readonly events: PublishedEventBuilder;
  /**
   * Đợt 2. Quyền đăng bài và chủ đề của nhóm (BE-G hiện thực). Thiếu thì chạy như đợt 1: chỉ cần là thành
   * viên, và không dùng được `groupTopicId`.
   */
  readonly posting?: GroupPostingPort;
  /** Đợt 2. Phòng ban của tác giả và phòng ban của người được nhắc (quyền xem `unit`/`custom`). */
  readonly viewerScopes?: Pick<ViewerScopePort, 'authorUnitOf' | 'scopesOf'>;
  /** Đợt 2. Kiểm id phòng ban/vị trí trong danh sách chia sẻ `custom`. */
  readonly orgs?: Pick<OrgStructurePort, 'nodeRefs'>;
  /** Đồng hồ; mặc định giờ hệ thống. Test truyền giờ cố định. */
  readonly now?: () => Date;
}

/** Quyền xem đã phân giải của một bài: phòng ban chốt, danh sách chia sẻ, người được nhắc còn lại. */
interface ResolvedPlacement {
  readonly visibility: SocialPostVisibility;
  readonly authorUnitId?: string;
  readonly audience: PostAudience;
  readonly mentions: string[];
}

/**
 * Đường ghi bài P2: tạo (đăng ngay, hẹn giờ, chờ duyệt, bài nhóm, bình chọn, xác nhận đã đọc), sửa,
 * xoá, đăng ngay, ghim. Mọi truy vấn bài qua `SocialPostAccess` nên bài không thấy được là 404.
 *
 * Máy trạng thái: docs/architecture/social-p2-p3-api.md mục 2. Sự kiện outbox cùng transaction với
 * thay đổi dữ liệu; `social.post.published` chỉ phát khi bài thực sự được đăng.
 */
export class SocialPublishingService {
  constructor(private readonly deps: SocialPublishingDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  async get(actor: SocialActor, postId: string): Promise<SocialPost> {
    const row = await this.deps.access.requireVisible(actor, postId);
    return (await this.deps.assembler.assemble(actor, [row]))[0];
  }

  async create(actor: SocialActor, request: CreateSocialPostRequest): Promise<SocialPost> {
    const { store, settings, events } = this.deps;
    const now = this.now();
    const input = request ?? ({} as CreateSocialPostRequest);

    const kind = normalizeKind(input.kind);
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.bodyHtml ?? '');
    const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const poll = input.poll === undefined || input.poll === null ? undefined : normalizePoll(input.poll, now);
    // Bình chọn tính là nội dung: bài chỉ có bình chọn vẫn hợp lệ.
    requireContent(body, attachmentIds.length + (poll ? 1 : 0));
    const requiresReadConfirmation = optionalBoolean(input.requiresReadConfirmation, 'Xác nhận đã đọc');
    const scheduledAt =
      input.scheduledAt === undefined || input.scheduledAt === null
        ? undefined
        : normalizeScheduledAt(input.scheduledAt, now);

    const visibility = normalizeVisibility(input.visibility);
    const commentsDisabled = optionalBoolean(input.commentsDisabled, 'Tắt bình luận');
    if (input.groupId && visibility !== 'company') {
      throw new SocialVisibilityNotAllowedError('Bài trong nhóm theo quyền xem của nhóm, không chọn quyền xem riêng.');
    }
    assertCompanyOnlyFeatures(visibility, {
      announcement: kind === 'announcement',
      pinned: input.pinned === true,
      mentionsAll: input.mentionsAll === true,
      requiresReadConfirmation,
    });

    const group = input.groupId ? await this.resolveGroup(actor, input.groupId) : undefined;
    const wantsPinned = input.pinned === true;
    const wantsAll = input.mentionsAll === true;
    if (kind === 'announcement' || wantsPinned || wantsAll) {
      const allowed = group ? await this.isGroupAdmin(actor, group.id) : mayModerate(actor);
      if (!allowed) {
        throw new SocialForbiddenError(
          group
            ? 'Chỉ quản trị nhóm mới đăng thông báo, ghim bài hoặc nhắc tất cả thành viên.'
            : 'Chỉ người quản lý nội dung mới đăng thông báo, ghim bài hoặc nhắc tất cả mọi người.',
        );
      }
    }

    if (group && input.topicId) throw new SocialValidationError('Bài trong nhóm không có chuyên mục.');
    const topicId = group ? undefined : await this.validTopic(actor, input.topicId);
    const groupTopicId = await this.validGroupTopic(actor, group?.id, input.groupTopicId);
    const placement = await this.resolvePlacement(actor, {
      visibility,
      authorId: actor.userId,
      audience: normalizeAudienceInput(input.audience),
      mentions: await knownUserIds(this.deps.directory, actor.tenantId, normalizeMentionIds(input.mentionUserIds)),
    });
    const mentionUserIds = placement.mentions;

    const exempt = mayModerate(actor);
    let status: EntryStatus;
    if (scheduledAt) status = 'scheduled';
    else {
      // Chỉ bài công khai của Tường công ty vào hàng chờ duyệt; quyền hẹp đăng thẳng.
      const openWall = !group && visibility === 'company';
      const requireApproval = openWall && !exempt ? (await settings.get(actor.tenantId)).wallRequireApproval : false;
      status = statusOnPublish({ isWall: openWall, requireApproval, exempt });
    }

    const postId = randomUUID();
    const eventPost = {
      id: postId,
      authorId: actor.userId,
      title,
      kind,
      mentionsAll: wantsAll,
      groupId: group?.id,
      groupName: group?.name,
      requiresReadConfirmation,
      visibility,
    };
    let outbox: SocialOutboxEvent[] = [];
    if (status === 'published') outbox = await events.build(actor.tenantId, eventPost, 'direct', mentionUserIds);
    else if (status === 'pending') {
      outbox = [postPendingEvent(eventPost, await events.actorName(actor))];
    }

    await store.insert(actor.tenantId, {
      id: postId,
      authorId: actor.userId,
      kind,
      title,
      bodyHtml: body.html,
      topicId,
      groupId: group?.id,
      pinned: wantsPinned,
      mentionsAll: wantsAll,
      mentionUserIds,
      attachmentIds,
      uploaderId: actor.userId,
      status,
      scheduledAt,
      exemptFromApproval: exempt && !group,
      requiresReadConfirmation,
      visibility,
      ...(placement.authorUnitId ? { authorUnitId: placement.authorUnitId } : {}),
      ...(visibility === 'custom' ? { audience: placement.audience } : {}),
      ...(commentsDisabled ? { commentsDisabled } : {}),
      ...(groupTopicId ? { groupTopicId } : {}),
      ...(poll
        ? {
            poll: {
              id: randomUUID(),
              question: poll.question,
              allowMultiple: poll.allowMultiple,
              anonymous: poll.anonymous,
              closesAt: poll.closesAt,
              options: poll.options.map((text) => ({ id: randomUUID(), text })),
            },
          }
        : {}),
      events: outbox,
    });
    return this.get(actor, postId);
  }

  async update(actor: SocialActor, postId: string, request: UpdateSocialPostRequest): Promise<SocialPost> {
    const { store, social, directory, events, settings, access } = this.deps;
    const now = this.now();
    const row = await access.requireVisible(actor, postId);
    if (row.activityType) throw new SocialForbiddenError('Bài tự sinh từ hoạt động không sửa được.');
    const isAuthor = row.authorId.toLowerCase() === actor.userId.toLowerCase();
    const moderates = mayModerate(actor);
    const input = request ?? {};
    const currentVisibility: SocialPostVisibility = row.visibility ?? 'company';

    // Mỗi nhóm trường có chủ riêng: nội dung (tác giả, moderator), quyền xem (chỉ tác giả), bật/tắt bình luận
    // (tác giả, moderator, admin nhóm), chủ đề nhóm (tác giả, admin nhóm).
    const touchesContent = CONTENT_FIELDS.some((key) => input[key] !== undefined);
    const touchesVisibility = input.visibility !== undefined || input.audience !== undefined;
    if (touchesVisibility && !isAuthor) throw new SocialVisibilityChangeForbiddenError();
    if (!isAuthor && !moderates && !(await access.isGroupAdmin(actor, row))) throw new SocialForbiddenError();
    if (touchesContent && !isAuthor && !moderates) throw new SocialForbiddenError();
    if (input.commentsDisabled !== undefined && !(await access.mayToggleComments(actor, row))) {
      throw new SocialForbiddenError('Bạn không có quyền bật hoặc tắt bình luận của bài viết này.');
    }
    if (input.groupTopicId !== undefined && !(await access.mayChangeGroupTopic(actor, row))) {
      throw new SocialForbiddenError('Chỉ tác giả hoặc quản trị nhóm mới đổi được chủ đề của bài.');
    }

    const [relations, engagement] = await Promise.all([
      social.posts.relations(actor.tenantId, [postId], actor.userId),
      store.engagement(actor.tenantId, [postId], actor.userId),
    ]);
    const poll = engagement.polls.get(postId);

    let title = row.title;
    let bodyState = { html: row.bodyHtml, hasText: htmlToPlainText(row.bodyHtml).length > 0 };
    let topicId: string | null | undefined;
    let attachmentIds: string[] | undefined;
    let mentionUserIds: string[] | undefined;
    const patch: { -readonly [K in keyof PublishingPostPatch]?: PublishingPostPatch[K] } = {};

    if (input.title !== undefined) {
      patch.title = input.title === null ? null : (normalizeTitle(input.title) ?? null);
      title = patch.title ?? undefined;
    }
    if (input.bodyHtml !== undefined) {
      const body = normalizeBody(input.bodyHtml);
      patch.bodyHtml = body.html;
      bodyState = body;
    }
    if (input.topicId !== undefined) {
      if (row.groupId && input.topicId !== null && input.topicId !== '') {
        throw new SocialValidationError('Bài trong nhóm không có chuyên mục.');
      }
      topicId = input.topicId === null || input.topicId === '' ? null : await this.validTopic(actor, input.topicId);
      patch.topicId = topicId;
    }
    if (input.attachmentIds !== undefined) {
      attachmentIds = normalizeAttachmentIds(input.attachmentIds);
      patch.attachmentIds = attachmentIds;
    }
    if (patch.bodyHtml !== undefined || patch.attachmentIds !== undefined) {
      const attachmentCount = attachmentIds?.length ?? relations.attachments.get(postId)?.length ?? 0;
      requireContent(bodyState, attachmentCount + (poll ? 1 : 0));
    }

    if (input.mentionUserIds !== undefined) {
      mentionUserIds = await knownUserIds(directory, actor.tenantId, normalizeMentionIds(input.mentionUserIds));
    }

    if (input.scheduledAt !== undefined) {
      if (row.status !== 'scheduled') {
        throw new SocialPostStateError('Chỉ đổi được giờ hẹn của bài đang hẹn giờ đăng.');
      }
      if (!isAuthor) throw new SocialForbiddenError('Chỉ tác giả mới đổi được giờ hẹn đăng.');
      patch.scheduledAt = normalizeScheduledAt(input.scheduledAt, now);
    }

    let requiresReadConfirmation = row.requiresReadConfirmation;
    if (input.requiresReadConfirmation !== undefined) {
      const wanted = optionalBoolean(input.requiresReadConfirmation, 'Xác nhận đã đọc');
      if (wanted !== row.requiresReadConfirmation) {
        if (!wanted && (engagement.readConfirmations.get(postId)?.confirmedCount ?? 0) > 0) {
          throw new SocialReadConfirmationLockedError();
        }
        if (wanted && currentVisibility !== 'company') {
          throw new SocialVisibilityNotAllowedError('Xác nhận đã đọc chỉ dùng được với bài công khai.');
        }
        patch.requiresReadConfirmation = wanted;
        requiresReadConfirmation = wanted;
      }
    }

    if (input.poll !== undefined) {
      if (!poll) throw new SocialPollNotFoundError();
      const rawPoll = (input.poll ?? {}) as Record<string, unknown>;
      if (Object.keys(rawPoll).some((key) => key !== 'closesAt')) {
        if (poll.totalVoters > 0) throw new SocialPollLockedError();
        throw new SocialValidationError(
          'Chưa hỗ trợ sửa lựa chọn của bình chọn. Hãy xoá bài và tạo lại, hoặc chỉ đổi hạn đóng.',
        );
      }
      if ('closesAt' in rawPoll) {
        if (poll.closedAt) throw new SocialPollClosedError();
        patch.pollClosesAt = rawPoll['closesAt'] === null ? null : normalizeClosesAt(rawPoll['closesAt'], now);
      }
    }

    // Bật/tắt bình luận và chủ đề nhóm: chỉ ghi khi có đổi.
    if (input.commentsDisabled !== undefined) {
      const wanted = optionalBoolean(input.commentsDisabled, 'Tắt bình luận');
      if (wanted !== (row.commentsDisabled === true)) patch.commentsDisabled = wanted;
    }
    if (input.groupTopicId !== undefined) {
      if (!row.groupId) throw new SocialValidationError('Chủ đề nhóm chỉ dùng cho bài trong nhóm.');
      const wanted =
        input.groupTopicId === null || input.groupTopicId === ''
          ? null
          : ((await this.validGroupTopic(actor, row.groupId, input.groupTopicId)) ?? null);
      if (wanted !== (row.groupTopicId ?? null)) patch.groupTopicId = wanted;
    }

    // Đổi quyền xem (chỉ tác giả; bài đã đăng hoặc hẹn giờ; bài Tường công ty). Không tính là "đã sửa".
    const placementChange = touchesVisibility
      ? await this.planVisibilityChange(actor, row, input, requiresReadConfirmation)
      : undefined;
    if (placementChange) {
      patch.visibility = placementChange.visibility;
      patch.authorUnitId = placementChange.authorUnitId ?? null;
      patch.audience = placementChange.audience;
    }
    // Người được nhắc phải thấy được bài: với `custom` thì tự vào danh sách chia sẻ, với `unit`/`private`
    // thì người không thấy bị bỏ. Tính lại khi đổi danh sách nhắc hoặc đổi quyền xem.
    const effectiveVisibility = placementChange?.visibility ?? currentVisibility;
    if (effectiveVisibility !== 'company' && (mentionUserIds !== undefined || placementChange)) {
      const resolved = await this.resolvePlacement(actor, {
        visibility: effectiveVisibility,
        authorId: row.authorId,
        audience: placementChange?.audience ?? currentAudience(row),
        mentions: mentionUserIds ?? [...(relations.mentions.get(postId) ?? [])],
        authorUnitId: placementChange ? placementChange.authorUnitId : row.authorUnitId,
        trustedAudience: true,
      });
      mentionUserIds = resolved.mentions;
      if (effectiveVisibility === 'custom') patch.audience = resolved.audience;
    }
    if (mentionUserIds !== undefined) {
      // Danh sách nhắc tên do chính người dùng gửi thì luôn ghi; danh sách chỉ được điều chỉnh theo quyền xem
      // mới thì chỉ ghi khi có người bị bỏ.
      const existing = new Set((relations.mentions.get(postId) ?? []).map((id) => id.toLowerCase()));
      const unchanged =
        mentionUserIds.length === existing.size && mentionUserIds.every((id) => existing.has(id.toLowerCase()));
      if (input.mentionUserIds !== undefined || !unchanged) patch.mentionUserIds = mentionUserIds;
    }

    // Tác giả sửa bài bị từ chối là gửi lại: vào hàng chờ duyệt hoặc đăng luôn nếu không còn cần duyệt.
    let resubmitAs: 'pending' | 'published' | undefined;
    if (row.status === 'rejected' && isAuthor) {
      const openWall = !row.groupId && currentVisibility === 'company';
      const requireApproval = openWall && !moderates ? (await settings.get(actor.tenantId)).wallRequireApproval : false;
      resubmitAs = statusOnPublish({ isWall: openWall, requireApproval, exempt: moderates });
    }

    if (Object.keys(patch).length === 0 && !resubmitAs) return this.get(actor, postId);

    const finalMentions = mentionUserIds ?? relations.mentions.get(postId) ?? [];
    const eventPost = { ...row, title, requiresReadConfirmation };
    let outbox: SocialOutboxEvent[] = [];
    if (resubmitAs === 'published') outbox = await events.build(actor.tenantId, eventPost, 'direct', finalMentions);
    else if (resubmitAs === 'pending') outbox = [postPendingEvent(eventPost, await events.actorName(actor))];
    else if (row.status === 'published') {
      const before = new Set((relations.mentions.get(postId) ?? []).map((id) => id.toLowerCase()));
      outbox = [
        postChangedEvent(row, 'updated', actor.userId),
        ...mentionEvents({
          postId,
          authorId: actor.userId,
          authorName: await events.actorName(actor),
          mentionedUserIds: (mentionUserIds ?? []).filter((id) => !before.has(id.toLowerCase())),
        }),
      ];
    }

    await store.update(actor.tenantId, postId, {
      ...patch,
      expectedStatus: row.status,
      uploaderId: actor.userId,
      editorId: actor.userId,
      ...(resubmitAs ? { resubmitAs } : {}),
      events: outbox,
    });
    return this.get(actor, postId);
  }

  /** Xoá mềm ở mọi trạng thái. Với bài hẹn giờ, đây cũng là "huỷ hẹn". */
  async remove(actor: SocialActor, postId: string): Promise<void> {
    const row = await this.deps.access.requireVisible(actor, postId);
    if (!(await this.deps.access.mayDelete(actor, row))) throw new SocialForbiddenError();
    await this.deps.store.softDelete(
      actor.tenantId,
      postId,
      actor.userId,
      row.status === 'published' ? [postChangedEvent(row, 'deleted', actor.userId)] : [],
    );
  }

  /** Tác giả đăng ngay bài đang hẹn giờ. Vẫn qua duyệt nếu Tường công ty cần duyệt và tác giả không được miễn. */
  async publishNow(actor: SocialActor, postId: string): Promise<SocialPost> {
    const { store, groups, settings, events } = this.deps;
    const row = await this.deps.access.requireVisible(actor, postId);
    if (row.authorId.toLowerCase() !== actor.userId.toLowerCase()) throw new SocialForbiddenError();
    if (row.status !== 'scheduled') throw new SocialPostStateError('Chỉ bài đang hẹn giờ mới đăng ngay được.');
    if (row.groupId && !(await groups.isMember(actor.tenantId, row.groupId, actor.userId))) {
      throw new SocialGroupNotMemberError();
    }

    const exempt = mayModerate(actor) || isExemptScheduled(row);
    // Chỉ bài công khai của Tường công ty cần duyệt; quyền xem hẹp đăng thẳng.
    const openWall = !row.groupId && (row.visibility ?? 'company') === 'company';
    const requireApproval = openWall && !exempt ? (await settings.get(actor.tenantId)).wallRequireApproval : false;
    const to = statusOnPublish({ isWall: openWall, requireApproval, exempt });
    const outbox =
      to === 'published'
        ? await events.build(actor.tenantId, row, 'direct')
        : [postPendingEvent(row, await events.actorName(actor))];
    await store.transition(actor.tenantId, postId, { from: ['scheduled'], to, events: outbox });
    return this.get(actor, postId);
  }

  async setPinned(actor: SocialActor, postId: string, request: PinSocialPostRequest): Promise<SocialPost> {
    const row = await this.deps.access.requireVisible(actor, postId);
    if (!(await this.deps.access.mayPin(actor, row))) {
      throw new SocialForbiddenError(
        row.groupId ? 'Chỉ quản trị nhóm mới ghim được bài.' : 'Chỉ người quản lý nội dung mới ghim được bài.',
      );
    }
    if (typeof request?.pinned !== 'boolean') throw new SocialValidationError('Thiếu trạng thái ghim.');
    if (row.status !== 'published') throw new SocialPostStateError('Chỉ ghim được bài đã đăng.');
    if (request.pinned && (row.visibility ?? 'company') !== 'company') {
      throw new SocialVisibilityNotAllowedError('Chỉ ghim được bài công khai.');
    }
    await this.deps.store.setPinned(actor.tenantId, postId, request.pinned, [
      postChangedEvent(row, request.pinned ? 'pinned' : 'unpinned', actor.userId),
    ]);
    return this.get(actor, postId);
  }

  /* ---------------------------------------------------------------- nội bộ */

  private async isGroupAdmin(actor: SocialActor, groupId: string): Promise<boolean> {
    return mayManage(actor) || this.deps.groups.isAdmin(actor.tenantId, groupId, actor.userId);
  }

  /**
   * Nhóm để đăng bài: phải còn và người đăng là thành viên. Nhóm riêng tư mà người đăng không thấy
   * thì coi như không tồn tại (không lộ nhóm).
   */
  private async resolveGroup(actor: SocialActor, groupId: string): Promise<GroupAccessInfo> {
    requireUuid(groupId, 'Mã nhóm');
    const group = await this.deps.groups.getGroup(actor.tenantId, groupId);
    if (!group || group.deleted) throw new SocialPostGroupNotFoundError();
    const notMember = (): never => {
      if (group.privacy === 'private' && !mayManage(actor)) throw new SocialPostGroupNotFoundError();
      throw new SocialGroupNotMemberError();
    };
    if (this.deps.posting) {
      // Đợt 2: thành viên và quyền đăng của nhóm (`post_permission`).
      const decision = await this.deps.posting.canPost(actor.tenantId, groupId, actor.userId);
      if (decision.allowed) return group;
      if (decision.reason === 'group-missing') throw new SocialPostGroupNotFoundError();
      if (decision.reason === 'restricted') throw new SocialGroupPostNotAllowedError();
      return notMember();
    }
    if (!(await this.deps.groups.isMember(actor.tenantId, groupId, actor.userId))) return notMember();
    return group;
  }

  /** Chủ đề của nhóm (đợt 2): cần bài thuộc nhóm và chủ đề thuộc đúng nhóm đó. Rỗng là không chọn. */
  private async validGroupTopic(
    actor: SocialActor,
    groupId: string | undefined,
    topicId: string | null | undefined,
  ): Promise<string | undefined> {
    if (topicId === undefined || topicId === null || topicId === '') return undefined;
    requireUuid(topicId, 'Mã chủ đề của nhóm');
    if (!groupId) throw new SocialValidationError('Chủ đề nhóm chỉ dùng cho bài trong nhóm.');
    const found = await this.deps.posting?.topicsOfGroup(actor.tenantId, groupId, [topicId]);
    const topic = found?.get(topicId.toLowerCase());
    if (!topic) throw new SocialGroupTopicNotFoundError();
    return topic.id;
  }

  /**
   * Quyền xem đã phân giải cho MỘT bài (đợt 2): phòng ban chốt cho `unit`, danh sách chia sẻ cho `custom`,
   * và người được nhắc còn lại. Người được nhắc mà không thấy được bài thì bị bỏ (`unit`/`private`) hoặc tự
   * vào danh sách chia sẻ (`custom`). `trustedAudience`: danh sách đã kiểm ở bước trước (hoặc đọc từ DB).
   */
  private async resolvePlacement(
    actor: SocialActor,
    input: {
      readonly visibility: SocialPostVisibility;
      readonly authorId: string;
      readonly audience: PostAudience;
      readonly mentions: readonly string[];
      readonly authorUnitId?: string;
      readonly trustedAudience?: boolean;
    },
  ): Promise<ResolvedPlacement> {
    const { visibility, authorId } = input;
    if (visibility === 'company') return { visibility, audience: EMPTY_AUDIENCE, mentions: [...input.mentions] };
    const others = input.mentions.filter((id) => id.toLowerCase() !== authorId.toLowerCase());
    if (visibility === 'private') return { visibility, audience: EMPTY_AUDIENCE, mentions: [] };

    if (visibility === 'unit') {
      const authorUnitId = input.authorUnitId ?? (await this.deps.viewerScopes?.authorUnitOf(actor.tenantId, authorId));
      if (!authorUnitId) throw new SocialVisibilityUnitUnknownError();
      const scopes = others.length
        ? await this.deps.viewerScopes?.scopesOf(actor.tenantId, others)
        : new Map<string, never>();
      const seen = others.filter((id) =>
        scopes?.get(id.toLowerCase())?.unitIds.some((unitId) => unitId.toLowerCase() === authorUnitId.toLowerCase()),
      );
      return { visibility, authorUnitId, audience: EMPTY_AUDIENCE, mentions: seen };
    }

    // custom
    let audience = input.audience;
    if (!input.trustedAudience) {
      if (audienceIsEmpty(audience)) {
        throw new SocialVisibilityAudienceError('Hãy chọn ít nhất một người hoặc phòng ban để chia sẻ bài viết.');
      }
      const known = await knownUserIds(this.deps.directory, actor.tenantId, audience.userIds);
      if (known.length !== audience.userIds.length) {
        throw new SocialVisibilityAudienceError('Có người trong danh sách chia sẻ không còn trong danh bạ.');
      }
      if (audience.unitIds.length > 0) {
        const refs = await this.deps.orgs?.nodeRefs(actor.tenantId, audience.unitIds);
        if (!refs || audience.unitIds.some((id) => !refs.has(id.toLowerCase()))) {
          throw new SocialVisibilityAudienceError('Có phòng ban hoặc vị trí không còn trong sơ đồ tổ chức.');
        }
      }
    }
    const userIds = [...new Set([...audience.userIds, ...others.map((id) => id.toLowerCase())])].filter(
      (id) => id !== authorId.toLowerCase(),
    );
    if (userIds.length > SOCIAL_AUDIENCE_MAX_USERS) {
      throw new SocialVisibilityAudienceError(`Chỉ chia sẻ được tối đa ${SOCIAL_AUDIENCE_MAX_USERS} người.`);
    }
    audience = { userIds, unitIds: audience.unitIds };
    return { visibility, audience, mentions: [...input.mentions] };
  }

  /**
   * Đổi quyền xem của bài đã đăng hoặc hẹn giờ (đợt 2). Trả `undefined` khi không có gì đổi. Bài nhóm theo
   * nhóm nên chỉ chấp nhận `company`; các tính năng chỉ đi với bài công khai phải tắt trước khi thu hẹp.
   */
  private async planVisibilityChange(
    actor: SocialActor,
    row: WritablePostRow,
    input: UpdateSocialPostRequest,
    requiresReadConfirmation: boolean,
  ): Promise<{ visibility: SocialPostVisibility; authorUnitId?: string; audience: PostAudience } | undefined> {
    const current: SocialPostVisibility = row.visibility ?? 'company';
    const target = input.visibility === undefined ? current : normalizeVisibility(input.visibility);
    if (row.groupId) {
      if (target !== 'company') {
        throw new SocialVisibilityNotAllowedError('Bài trong nhóm theo quyền xem của nhóm, không chọn quyền xem riêng.');
      }
      return undefined;
    }
    const audienceGiven = target === 'custom' && input.audience !== undefined;
    if (target === current && !audienceGiven) return undefined;
    if (row.status !== 'published' && row.status !== 'scheduled') throw new SocialVisibilityChangeForbiddenError();
    assertCompanyOnlyFeatures(target, {
      announcement: row.kind === 'announcement',
      pinned: row.pinned,
      mentionsAll: row.mentionsAll,
      requiresReadConfirmation,
    });

    if (target === 'company' || target === 'private') return { visibility: target, audience: EMPTY_AUDIENCE };
    if (target === 'unit') {
      const authorUnitId = await this.deps.viewerScopes?.authorUnitOf(actor.tenantId, row.authorId);
      if (!authorUnitId) throw new SocialVisibilityUnitUnknownError();
      return { visibility: target, authorUnitId, audience: EMPTY_AUDIENCE };
    }
    // custom: danh sách mới nếu có; chưa có thì giữ danh sách hiện tại; đổi sang `custom` mà chưa có ai là lỗi.
    const audience = audienceGiven ? normalizeAudienceInput(input.audience) : currentAudience(row);
    const resolved = await this.resolvePlacement(actor, {
      visibility: 'custom',
      authorId: row.authorId,
      audience,
      mentions: [],
      trustedAudience: !audienceGiven && current === 'custom',
    });
    return { visibility: target, audience: resolved.audience };
  }

  /** Chuyên mục phải có và đang dùng; rỗng là không chọn chuyên mục. */
  private async validTopic(actor: SocialActor, topicId: string | null | undefined): Promise<string | undefined> {
    if (topicId === undefined || topicId === null || topicId === '') return undefined;
    requireUuid(topicId, 'Mã chuyên mục');
    const topic = await this.deps.social.topics.findById(actor.tenantId, topicId);
    if (!topic) throw new SocialTopicNotFoundError();
    if (!topic.isActive) throw new SocialTopicInactiveError();
    return topic.id;
  }
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new SocialValidationError(`${label} không hợp lệ.`);
  return value;
}

/** Danh sách chia sẻ hiện có của bài `custom` (đã nạp cùng bài). */
function currentAudience(row: WritablePostRow): PostAudience {
  return { userIds: row.audienceUserIds ?? [], unitIds: row.audienceUnitIds ?? [] };
}
