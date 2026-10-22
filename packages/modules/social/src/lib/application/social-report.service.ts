import { randomUUID } from 'node:crypto';
import {
  SOCIAL_EVENT_TYPES,
  SOCIAL_GROUP_PAGE_SIZE,
  SOCIAL_NOTIFY_RECIPIENT_MAX,
  type CreateSocialReportRequest,
  type ResolveSocialReportRequest,
  type SocialReport,
  type SocialReportCreatedPayload,
  type SocialReportListQuery,
  type SocialReportPage,
  type SocialReportTargetSummary,
} from '@enterprise-platform/contracts-social';
import {
  isGlobalGroupAdmin,
  isPreviewOnly,
  normalizeGroupLimit,
  normalizeOptionalReportTargetType,
  normalizeReportNote,
  normalizeReportReason,
  normalizeReportStatus,
  normalizeReportTargetType,
  normalizeResolveStatus,
} from '../domain/social-group-rules.js';
import {
  SocialGroupNotFoundError,
  SocialReportHandledError,
  SocialReportNotFoundError,
} from '../domain/social-group.error.js';
import { mayModerate } from '../domain/social-principal.js';
import { decodeCursor, encodeCursor, isUuid } from '../domain/social-rules.js';
import {
  SocialCommentNotFoundError,
  SocialForbiddenError,
  SocialPostNotFoundError,
  SocialValidationError,
} from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ReportTargetResolverPort } from './ports/report-target.port.js';
import type { SocialActor } from './social-actor.js';
import { actorNameOf, lookupGroupUsers } from './social-group-support.js';
import type { GroupOutboxEvent, SocialGroupStore } from './social-group-store.port.js';
import type { SocialGroupService } from './social-group.service.js';
import type { ReportQueue, ReportRow, SocialReportStore } from './social-report-store.port.js';

/**
 * Báo cáo nhóm/bài/bình luận và hàng đợi xử lý.
 *
 * Định tuyến (theo `group_id` và quyền riêng tư của nhóm chứa đối tượng):
 * - Tường công ty: hàng đợi moderator.
 * - Nhóm công khai: hàng đợi moderator VÀ hàng đợi admin nhóm (ai xử lý trước thì xong).
 * - Nhóm riêng tư: chỉ hàng đợi admin nhóm (kèm quản trị toàn hệ thống). Moderator không thấy.
 *
 * Mỗi người một báo cáo mở cho mỗi đối tượng; không báo cáo bài/bình luận của chính mình. Xử lý
 * (`resolved`/`dismissed`) không tự xoá nội dung: người xử lý dùng route xoá có sẵn.
 */
export class SocialReportService {
  constructor(
    private readonly reports: SocialReportStore,
    private readonly groupStore: SocialGroupStore,
    private readonly directory: OrganizationDirectory,
    private readonly resolver: ReportTargetResolverPort,
    private readonly groups: SocialGroupService,
  ) {}

  /* ------------------------------------------------------------------ tạo */

  async create(actor: SocialActor, request: CreateSocialReportRequest): Promise<SocialReport> {
    const input = request ?? ({} as CreateSocialReportRequest);
    const targetType = normalizeReportTargetType(input.targetType);
    const reason = normalizeReportReason(input.reason);
    const reporterName = await actorNameOf(this.directory, actor);
    const reportId = randomUUID();

    let targetId: string;
    let groupId: string | undefined;
    let groupName: string | undefined;
    let groupPrivacy: 'public' | 'private' | undefined;
    let postId: string | undefined;
    let summary: SocialReportTargetSummary | undefined;

    if (targetType === 'group') {
      if (!isUuid(input.targetId)) throw new SocialGroupNotFoundError();
      const group = await this.groups.requireGroup(actor, input.targetId);
      if (isPreviewOnly({ privacy: group.privacy, isMember: group.myRole !== undefined, globalAdmin: isGlobalGroupAdmin(actor) })) {
        throw new SocialGroupNotFoundError();
      }
      if (group.myRole === 'admin') {
        throw new SocialValidationError('Bạn là quản trị viên của nhóm này nên không thể báo cáo nhóm.');
      }
      targetId = group.id;
      groupId = group.id;
      groupName = group.name;
      groupPrivacy = group.privacy;
      summary = { label: group.name };
    } else {
      if (!isUuid(input.targetId)) {
        throw targetType === 'post' ? new SocialPostNotFoundError() : new SocialCommentNotFoundError();
      }
      const resolved = await this.resolver.resolveForReporter(actor, targetType, input.targetId.toLowerCase());
      if (!resolved) throw targetType === 'post' ? new SocialPostNotFoundError() : new SocialCommentNotFoundError();
      if (resolved.authorId.toLowerCase() === actor.userId.toLowerCase()) {
        throw new SocialValidationError(
          targetType === 'post'
            ? 'Bạn không thể báo cáo bài viết của chính mình.'
            : 'Bạn không thể báo cáo bình luận của chính mình.',
        );
      }
      targetId = resolved.targetId;
      postId = resolved.postId;
      groupId = resolved.groupId;
      groupPrivacy = resolved.groupPrivacy;
      summary = resolved.summary;
      if (groupId) groupName = (await this.groupStore.groups.refs(actor.tenantId, [groupId]))[0]?.name;
    }

    // Thông báo của hệ thống không đọc được bảng nhóm, nên người nhận (admin nhóm) đi kèm trong sự kiện.
    const recipientUserIds = groupId
      ? (await this.groupStore.members.listAdminIds(actor.tenantId, groupId))
          .filter((id) => id.toLowerCase() !== actor.userId.toLowerCase())
          .slice(0, SOCIAL_NOTIFY_RECIPIENT_MAX)
      : undefined;
    const payload: SocialReportCreatedPayload & { actorUserId: string } = {
      reportId,
      targetType,
      targetId,
      reporterId: actor.userId,
      reporterName,
      ...(groupId ? { groupId } : {}),
      ...(groupName ? { groupName } : {}),
      ...(recipientUserIds ? { recipientUserIds } : {}),
      ...(groupPrivacy ? { groupPrivacy } : {}),
      actorUserId: actor.userId,
    };
    const event: GroupOutboxEvent = {
      type: SOCIAL_EVENT_TYPES.reportCreated,
      aggregateType: 'social-report',
      aggregateId: reportId,
      payload: { ...payload },
    };
    await this.reports.insert(actor.tenantId, {
      id: reportId,
      targetType,
      targetId,
      ...(groupId ? { groupId } : {}),
      ...(postId ? { postId } : {}),
      reporterId: actor.userId,
      reason,
      events: [event],
    });

    return {
      id: reportId,
      targetType,
      targetId,
      status: 'open',
      reason,
      reporter: { id: actor.userId, name: reporterName },
      createdAt: new Date().toISOString(),
      ...(groupId && groupName ? { group: { id: groupId, name: groupName } } : {}),
      ...(summary ? { target: summary } : {}),
    };
  }

  /* ------------------------------------------------- hàng đợi moderator */

  async listForModerators(actor: SocialActor, query: SocialReportListQuery = {}): Promise<SocialReportPage> {
    this.requireModerator(actor);
    return this.page(actor, { kind: 'moderator' }, query);
  }

  async resolveAsModerator(
    actor: SocialActor,
    reportId: string,
    request: ResolveSocialReportRequest,
  ): Promise<SocialReport> {
    this.requireModerator(actor);
    const row = await this.findReport(actor, reportId);
    // Báo cáo của nhóm riêng tư (hoặc nhóm đã xoá) không thuộc hàng đợi moderator: coi như không có.
    if (!inModeratorQueue(row)) throw new SocialReportNotFoundError();
    return this.handle(actor, row, request);
  }

  /* ------------------------------------------------- hàng đợi admin nhóm */

  async listForGroup(actor: SocialActor, groupId: string, query: SocialReportListQuery = {}): Promise<SocialReportPage> {
    const group = await this.groups.requireManageable(actor, groupId);
    return this.page(actor, { kind: 'group', groupId: group.id }, query);
  }

  async resolveForGroup(
    actor: SocialActor,
    groupId: string,
    reportId: string,
    request: ResolveSocialReportRequest,
  ): Promise<SocialReport> {
    const group = await this.groups.requireManageable(actor, groupId);
    const row = await this.findReport(actor, reportId);
    if (row.groupId !== group.id) throw new SocialReportNotFoundError();
    return this.handle(actor, row, request);
  }

  /* -------------------------------------------------------------- nội bộ */

  private requireModerator(actor: SocialActor): void {
    if (!mayModerate(actor)) {
      throw new SocialForbiddenError('Chỉ người kiểm duyệt mới xem và xử lý được hàng đợi báo cáo.');
    }
  }

  private async findReport(actor: SocialActor, reportId: string): Promise<ReportRow> {
    if (!isUuid(reportId)) throw new SocialReportNotFoundError();
    const row = await this.reports.find(actor.tenantId, reportId.toLowerCase());
    if (!row) throw new SocialReportNotFoundError();
    return row;
  }

  private async handle(actor: SocialActor, row: ReportRow, request: ResolveSocialReportRequest): Promise<SocialReport> {
    const input = request ?? ({} as ResolveSocialReportRequest);
    const status = normalizeResolveStatus(input.status);
    const note = normalizeReportNote(input.note);
    if (row.status !== 'open') throw new SocialReportHandledError();
    const handled = await this.reports.resolve(actor.tenantId, {
      reportId: row.id,
      status,
      ...(note ? { note } : {}),
      handledBy: actor.userId,
    });
    // Người khác xử lý trước trong lúc chờ: UPDATE có điều kiện `status = 'open'` không chạm dòng nào.
    if (!handled) throw new SocialReportHandledError();
    return (await this.toViews(actor, [handled]))[0] as SocialReport;
  }

  private async page(actor: SocialActor, queue: ReportQueue, query: SocialReportListQuery): Promise<SocialReportPage> {
    const limit = normalizeGroupLimit(query.limit ?? SOCIAL_GROUP_PAGE_SIZE);
    const status = normalizeReportStatus(query.status, 'open');
    const targetType = normalizeOptionalReportTargetType(query.targetType);
    const rows = await this.reports.list(actor.tenantId, {
      queue,
      status,
      ...(targetType ? { targetType } : {}),
      limit: limit + 1,
      cursor: decodeCursor(query.cursor),
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const [items, openCount] = await Promise.all([
      this.toViews(actor, pageRows),
      this.reports.openCount(actor.tenantId, queue),
    ]);
    return {
      items,
      openCount,
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }

  /** Dựng `SocialReport`: người báo cáo/xử lý, nhóm, tóm tắt đối tượng (thiếu khi đã xoá hoặc không xem được). */
  private async toViews(actor: SocialActor, rows: readonly ReportRow[]): Promise<SocialReport[]> {
    if (rows.length === 0) return [];
    const lookup = await lookupGroupUsers(
      this.directory,
      actor.tenantId,
      rows.flatMap((row) => (row.handledBy ? [row.reporterId, row.handledBy] : [row.reporterId])),
    );
    const groupIds = [...new Set(rows.flatMap((row) => (row.groupId ? [row.groupId] : [])))];
    const groupRefs = new Map(
      (groupIds.length ? await this.groupStore.groups.refs(actor.tenantId, groupIds) : []).map((group) => [group.id, group]),
    );
    const contentTargets = rows.flatMap((row) =>
      row.targetType === 'group' ? [] : [{ targetType: row.targetType, targetId: row.targetId }],
    );
    const summaries = contentTargets.length
      ? await this.resolver.summariesForHandler(actor, contentTargets)
      : new Map<string, SocialReportTargetSummary>();

    return rows.map((row) => {
      const group = row.groupId ? groupRefs.get(row.groupId) : undefined;
      const target =
        row.targetType === 'group'
          ? group
            ? { label: group.name }
            : undefined
          : summaries.get(`${row.targetType}:${row.targetId}`);
      return {
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        status: row.status,
        reason: row.reason,
        reporter: lookup(row.reporterId),
        createdAt: new Date(row.createdAt).toISOString(),
        ...(group ? { group: { id: group.id, name: group.name } } : {}),
        ...(target ? { target } : {}),
        ...(row.handledBy ? { handledBy: lookup(row.handledBy) } : {}),
        ...(row.handledAt ? { handledAt: new Date(row.handledAt).toISOString() } : {}),
        ...(row.handleNote ? { handleNote: row.handleNote } : {}),
      };
    });
  }
}

/** Báo cáo thuộc hàng đợi moderator: Tường công ty hoặc nhóm công khai còn tồn tại. */
export function inModeratorQueue(row: Pick<ReportRow, 'groupId' | 'groupPrivacy' | 'groupDeleted'>): boolean {
  if (!row.groupId) return true;
  return row.groupPrivacy === 'public' && row.groupDeleted !== true;
}
