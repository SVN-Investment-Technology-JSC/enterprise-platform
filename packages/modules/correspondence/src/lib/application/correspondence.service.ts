import {
  APPROVER_RULE_LABELS,
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  CATALOG_CODE_PATTERN,
  CATALOG_KINDS,
  CORRESPONDENCE_ATTACHMENT_MAX_BYTES,
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  DISPATCH_MODES,
  LETTER_DIRECTIONS,
  LETTER_STAGES,
  LETTER_STAGE_LABELS,
  MAX_CLERKS,
  OPEN_LETTER_STAGES,
  RETURN_TARGETS,
  REVOKE_KINDS,
  REVOKE_KIND_LABELS,
  isOpenStage,
  letterDeepLink,
  letterTitle,
  returnTargetLabel,
  type ApproveStepRequest,
  type ApproverRule,
  type AssignHandlerRequest,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentKind,
  type AttachmentUploadTicket,
  type ArchiveDossier,
  type ArchiveTree,
  type CatalogItem,
  type CatalogKind,
  type CommentRequest,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceReport,
  type CorrespondenceReportRow,
  type CorrespondenceSettings,
  type CorrespondenceStatus,
  type CreateAttachmentRequest,
  type CreateAttachmentVersionRequest,
  type CreateLetterRequest,
  type CreateOutgoingRequest,
  type DecideRevokeRequest,
  type DispatchLetterRequest,
  type FlowNode,
  type LetterHistoryEntry,
  type LetterAttachment,
  type LetterDetail,
  type LetterDirection,
  type LetterQuery,
  type LetterStage,
  type LetterStepStatus,
  type LetterSummary,
  type NoteRequest,
  type PublishLetterRequest,
  type QuickCatalogItemRequest,
  type ReasonRequest,
  type RequestRevokeRequest,
  type RespondAssignmentRequest,
  type ReturnLetterRequest,
  type SaveCatalogItemRequest,
  type SaveWorkflowRequest,
  type StepChoice,
  type SubmitLetterRequest,
  type UpdateDeliveryRequest,
  type UpdateLetterRequest,
  type Workflow,
} from '@enterprise-platform/contracts-correspondence';
import { Logger } from '@nestjs/common';
import { chooseCandidates, normalizeSteps, resolveAssignees, type ApproverContext } from '../domain/approvers.js';
import {
  AttachmentNotFoundError,
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../domain/correspondence.error.js';
import {
  addDays,
  awaitsViewer,
  canAssignHandler,
  canDeleteAttachment,
  canRespondFor,
  canViewLetter,
  dossierFolderName,
  formatArchiveCode,
  formatSequenceNo,
  letterActions,
  returnTargets,
  vietnamToday,
  type LetterFacts,
  type LetterViewer,
} from '../domain/letter-rules.js';
import { headedUnits, membershipNodes, nodePath, unitHeads, unitMembers, type OrganizationSnapshot } from '../domain/organization.js';
import {
  FileStoreMissingError,
  type AssignmentRecord,
  type AttachmentRecord,
  type CorrespondenceActor,
  type CorrespondenceStore,
  type FileStore,
  type LetterListRow,
  type LetterRecord,
  type LetterTransaction,
  type OrganizationReader,
  type OutboxEvent,
  type StepRecord,
} from './ports.js';

const LIST_LIMIT = 500;
const OVERVIEW_LIMIT = 2000;
const REPORT_LIMIT = 10000;
const MAX_UNITS_PER_LETTER = 30;
const MAX_MENTIONS = 20;
/** Tên thư mục gốc của Văn thư trong kho tài liệu của Hệ dùng chung. */
export const CORRESPONDENCE_FILING_ROOT = 'Văn thư';
const FOLDER_BY_DIRECTION: Readonly<Record<LetterDirection, string>> = { incoming: 'Công văn đến', outgoing: 'Công văn đi' };
const DRAFT_SUFFIX = 'DT';
/** Bước công văn chưa chép quy trình: thanh tiến trình vẽ theo quy trình sẽ áp dụng. */
const PLANNING_STAGES: readonly LetterStage[] = ['received', 'drafting', 'checking'];
/** "Cần tôi xử lý": các bước còn mở và đề nghị huỷ đang chờ xác nhận. */
const AWAITING_STAGES: readonly LetterStage[] = [...OPEN_LETTER_STAGES, 'revoking'];
/** Kho lưu trữ: đã lưu trữ, kể cả đang chờ xác nhận huỷ. */
const ARCHIVE_STAGES: readonly LetterStage[] = ['archived', 'revoking'];
const ROUTE_PERMISSIONS = {
  register: 'correspondence.letter.register',
  publish: 'correspondence.letter.publish',
  archive: 'correspondence.letter.archive',
} as const;

type Catalog = ReadonlyMap<CatalogKind, ReadonlyMap<string, CatalogItem>>;
type Row = LetterRecord & {
  readonly steps: LetterListRow['steps'];
  readonly assignments: LetterListRow['assignments'];
  readonly mentionedUserIds: readonly string[];
};
type Loaded = {
  readonly letter: LetterRecord;
  readonly steps: StepRecord[];
  readonly assignments: AssignmentRecord[];
  readonly row: Row;
};

/**
 * Văn thư theo hai luồng, quy trình duyệt cấu hình được:
 *
 * - Công văn đến: văn thư tiếp nhận → phân loại, chọn phòng ban (cả phòng cùng nhận hoặc một
 *   người xử lý) → phòng ban gửi kết quả → các bước duyệt của quy trình → văn thư hoàn tất,
 *   lưu trữ.
 * - Công văn đi: phòng ban soạn thảo → văn thư kiểm tra → các bước duyệt → văn thư đánh số,
 *   ban hành, lưu trữ, theo dõi gửi.
 *
 * Quy trình lấy theo cấu hình (loại văn bản, không có thì quy trình mặc định của luồng).
 * "Không đạt" ở bước nào cũng trả được về bước trước (hay nơi cấu hình cho bước đó). Mỗi thao
 * tác chạy trong một transaction đã khoá dòng công văn và kiểm lại luật quyền trên dữ liệu vừa
 * khoá; sự kiện thông báo ghi vào outbox cùng transaction.
 */
export class CorrespondenceService {
  private readonly logger = new Logger(CorrespondenceService.name);

  constructor(
    private readonly store: CorrespondenceStore,
    private readonly files: FileStore,
    private readonly organization: OrganizationReader,
    private readonly today: () => string = () => vietnamToday(),
  ) {}

  /* ================================================================ đọc */

  async status(original: CorrespondenceActor): Promise<CorrespondenceStatus> {
    const actor = await this.effective(original);
    return {
      tenantId: actor.tenantId,
      userId: actor.userId,
      tablesReady: await this.store.tablesReady(actor.tenantId),
      capabilities: {
        isTenantAdmin: actor.isTenantAdmin,
        canRegister: actor.canRegister || actor.isTenantAdmin,
        canCreateOutgoing: actor.canCreateOutgoing || actor.isTenantAdmin,
        canPublish: actor.canPublish || actor.isTenantAdmin,
        canArchive: actor.canArchive || actor.isTenantAdmin,
        canDirect: actor.canDirect,
        canReadAll: actor.canReadAll || actor.isTenantAdmin,
        canReadConfidential: actor.canReadConfidential || actor.isTenantAdmin,
        canReadReports: actor.canReadReports || actor.isTenantAdmin,
        canConfigure: actor.canConfigure || actor.isTenantAdmin,
      },
    };
  }

  async config(actor: CorrespondenceActor): Promise<CorrespondenceConfig> {
    if (!(await this.store.tablesReady(actor.tenantId))) {
      return { settings: DEFAULT_CORRESPONDENCE_SETTINGS, catalog: [], workflows: [] };
    }
    const [settings, catalog, workflows] = await Promise.all([
      this.store.settings(actor.tenantId),
      this.store.catalog(actor.tenantId),
      this.store.workflows(actor.tenantId),
    ]);
    return { settings, catalog, workflows };
  }

  /** Sơ đồ tổ chức: phòng ban kèm thành viên và trưởng đơn vị, chức danh kèm người giữ. */
  async directory(actor: CorrespondenceActor): Promise<CorrespondenceDirectory> {
    const [snapshot, people, leaders] = await Promise.all([
      this.organization.snapshot(actor.tenantId),
      this.store.people(actor.tenantId),
      this.store.leaders(actor.tenantId),
    ]);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const units = snapshot.nodes
      .filter((node) => node.kind === 'unit')
      .map((node) => ({
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        path: nodePath(snapshot, node.id),
        members: unitMembers(snapshot, node.id).map((member) => ({
          userId: member.userId,
          name: member.name,
          positionName: member.positionName,
          isHead: member.isHead,
        })),
      }))
      .sort((left, right) => `${left.path} ${left.name}`.localeCompare(`${right.path} ${right.name}`, 'vi'));
    const positions = snapshot.nodes
      .filter((node) => node.kind === 'position')
      .map((node) => ({
        id: node.id,
        name: node.name,
        unitName: node.parentId ? byId.get(node.parentId)?.name : undefined,
        holderNames: snapshot.members.filter((member) => member.nodeId === node.id).map((member) => member.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    return { units, positions, people, leaders, myUnitIds: ownUnits(snapshot, actor.userId), degraded: snapshot.degraded };
  }

  async list(actor: CorrespondenceActor, query: LetterQuery = {}): Promise<LetterSummary[]> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const box = query.box ?? 'incoming';
    const stage = parseOptional(query.stage, LETTER_STAGES, 'Bước xử lý');
    const rows = await this.store.listLetters(actor.tenantId, {
      visibleTo: this.visibility(viewer),
      direction: box === 'incoming' ? 'incoming' : box === 'outgoing' ? 'outgoing' : undefined,
      stages: box === 'archive' ? ARCHIVE_STAGES : box === 'mine' ? AWAITING_STAGES : stage ? [stage] : undefined,
      search: query.search?.trim() || undefined,
      limit: LIST_LIMIT,
    });
    let visible = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    if (box === 'mine') visible = visible.filter((row) => awaitsViewer(viewer, facts(row, catalog)));
    return this.summaries(actor, viewer, catalog, visible);
  }

  async overview(actor: CorrespondenceActor): Promise<CorrespondenceOverview> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const visibleTo = this.visibility(viewer);
    const [rows, archived] = await Promise.all([
      this.store.listLetters(actor.tenantId, { visibleTo, stages: AWAITING_STAGES, limit: OVERVIEW_LIMIT }),
      this.store.countArchived(actor.tenantId, visibleTo),
    ]);
    const visible = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    const open = visible.filter((row) => isOpenStage(row.stage));
    const today = this.today();
    const byStage: Record<LetterDirection, Partial<Record<LetterStage, number>>> = { incoming: {}, outgoing: {} };
    for (const row of open) byStage[row.direction][row.stage] = (byStage[row.direction][row.stage] ?? 0) + 1;
    const urgent = [...open]
      .sort((left, right) => (left.dueOn ?? '9999-12-31').localeCompare(right.dueOn ?? '9999-12-31'))
      .slice(0, 6);
    return {
      incomingOpen: open.filter((row) => row.direction === 'incoming').length,
      outgoingOpen: open.filter((row) => row.direction === 'outgoing').length,
      awaitingApproval: open.filter((row) => row.stage === 'reviewing').length,
      overdue: open.filter((row) => row.dueOn && row.dueOn < today).length,
      archived,
      awaitingMe: visible.filter((row) => awaitsViewer(viewer, facts(row, catalog))).length,
      byStage,
      urgent: await this.summaries(actor, viewer, catalog, urgent),
    };
  }

  async detail(actor: CorrespondenceActor, letterId: string): Promise<LetterDetail> {
    const viewer = await this.viewer(actor);
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [catalog, steps, assignments, attachments, comments, history, organization, leaders, settings] = await Promise.all([
      this.catalogMap(actor.tenantId),
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
      this.store.attachments(actor.tenantId, letterId),
      this.store.comments(actor.tenantId, letterId),
      this.store.history(actor.tenantId, letterId),
      this.organization.snapshot(actor.tenantId),
      this.store.leaders(actor.tenantId),
      this.settingsOrDefault(actor.tenantId),
    ]);
    const row: Row = { ...letter, steps, assignments, mentionedUserIds: comments.flatMap((item) => item.mentionedUserIds) };
    const letterFacts = facts(row, catalog);
    if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();

    // Chưa trình thì vẽ theo quy trình sẽ áp dụng; đã trình thì theo các bước đã chép.
    const planned = PLANNING_STAGES.includes(letter.stage)
      ? await this.pickWorkflow(actor.tenantId, letter).catch(() => undefined)
      : undefined;
    const flowSteps: FlowStep[] = planned
      ? planned.steps.map((step, index) => ({ seq: index + 1, name: step.name, approver: step.approver, status: 'waiting', assigneeUserIds: [] }))
      : steps;
    const context: ApproverContext = {
      organization,
      leaders,
      handlingUnitIds: handlingUnits(letter, assignments),
    };
    const expected = new Map(
      flowSteps
        .filter((step) => step.status === 'waiting' || step.status === 'skipped')
        .map((step) => [step.seq, step.chosenUserId ? [step.chosenUserId] : resolveAssignees(step.approver, context)]),
    );

    const related = letter.relatedLetterId ? await this.store.findLetter(actor.tenantId, letter.relatedLetterId) : undefined;
    const names = await this.store.userNames(actor.tenantId, [
      letter.receivedBy,
      ...(letter.authorUserId ? [letter.authorUserId] : []),
      ...steps.flatMap((step) => [...step.assigneeUserIds, ...(step.actedBy ? [step.actedBy] : [])]),
      ...[...expected.values()].flat(),
      ...assignments.flatMap((item) => [item.submittedBy, item.handlerUserId].filter((id): id is string => Boolean(id))),
      ...attachments.map((item) => item.uploadedBy),
      ...comments.flatMap((item) => [item.authorId, ...item.mentionedUserIds]),
      ...history.map((item) => item.actorUserId).filter((id): id is string => Boolean(id)),
      ...settings.clerkUserIds,
      ...(letter.revokeRequestedBy ? [letter.revokeRequestedBy] : []),
      ...(letter.revokeApproverIds ?? []),
    ]);
    const nameOf = (userId: string) => names.get(userId) ?? 'Người dùng';
    const byId = new Map(assignments.map((item) => [item.id, item]));
    const actions = letterActions(viewer, letterFacts);
    return {
      ...summaryOf(row, catalog, viewer, names),
      instruction: letter.instruction,
      workflowId: planned?.id ?? letter.workflowId,
      workflowName: planned?.name ?? letter.workflowName,
      relatedLetterId: letter.relatedLetterId,
      relatedLetterNo: related ? displayNo(related) : undefined,
      cancelReason: letter.cancelReason,
      revoke: letter.revokeKind
        ? {
            kind: letter.revokeKind,
            kindLabel: REVOKE_KIND_LABELS[letter.revokeKind],
            reason: letter.revokeReason ?? '',
            requestedBy: letter.revokeRequestedBy,
            requestedByName: letter.revokeRequestedBy ? names.get(letter.revokeRequestedBy) : undefined,
            requestedAt: letter.revokeRequestedAt,
            approverNames: (letter.revokeApproverIds ?? []).map(nameOf),
          }
        : undefined,
      completionNote: letter.completionNote,
      deliveryMethod: letter.deliveryMethod,
      deliveryNote: letter.deliveryNote,
      deliveredOn: letter.deliveredOn,
      sharedFolderId: letter.sharedFolderId,
      steps: steps.map((step) => ({
        id: step.id,
        seq: step.seq,
        name: step.name,
        approver: step.approver,
        status: step.status,
        assignees: step.assigneeUserIds.map((userId) => ({ userId, name: names.get(userId) })),
        actedBy: step.actedBy,
        actedByName: step.actedBy ? names.get(step.actedBy) : undefined,
        actedAt: step.actedAt,
        decision: step.decision,
        note: step.note,
      })),
      flow: flowOf(
        letter.direction,
        letter.stage,
        flowSteps.map((step) => ({
          seq: step.seq,
          name: step.name,
          status: step.status,
          at: step.status === 'done' ? step.actedAt : undefined,
          people:
            step.status === 'done' && step.actedBy
              ? nameOf(step.actedBy)
              : step.status === 'active'
                ? step.assigneeUserIds.map(nameOf).join(', ')
                : peopleLabel(expected.get(step.seq) ?? [], nameOf, step.approver, letter.direction),
        })),
        fixedPeople(letter, assignments, nameOf, history, settings.clerkUserIds),
        revokeNode(letter, history, nameOf),
      ),
      assignments: assignments.map((item) => ({
        id: item.id,
        unitId: item.unitId,
        unitName: item.unitName,
        round: item.round,
        status: item.status,
        handlerUserId: item.handlerUserId,
        handlerName: item.handlerUserId ? names.get(item.handlerUserId) : undefined,
        responseNote: item.responseNote,
        submittedBy: item.submittedBy,
        submittedByName: item.submittedBy ? names.get(item.submittedBy) : undefined,
        submittedAt: item.submittedAt,
        revisionReason: item.revisionReason,
        headNames: unitHeads(organization, item.unitId)
          .map((userId) => organization.members.find((member) => member.userId === userId)?.name)
          .filter((name): name is string => Boolean(name)),
        canAssignHandler: canAssignHandler(viewer, letter, item),
        canRespond: canRespondFor(viewer, letter, item),
      })),
      attachments: attachments.map((item) => {
        const assignment = item.assignmentId ? byId.get(item.assignmentId) : undefined;
        return attachmentView(item, names, {
          canDelete: canDeleteAttachment(viewer, letterFacts, { ...item, assignment }),
          canVersion: canAddVersion(viewer, letterFacts, item, assignment),
        });
      }),
      comments: comments.map((item) => ({
        id: item.id,
        stepLabel: item.stepName ?? LETTER_STAGE_LABELS[item.stage] ?? item.stage,
        body: item.body,
        mentions: item.mentionedUserIds.map((userId) => ({ userId, name: names.get(userId) })),
        authorId: item.authorId,
        authorName: names.get(item.authorId),
        at: item.at,
      })),
      history: history.map((item) => ({
        id: item.id,
        action: item.action,
        summary: item.summary,
        note: item.note,
        actorUserId: item.actorUserId,
        actorName: item.actorUserId ? names.get(item.actorUserId) : undefined,
        at: item.at,
      })),
      actions,
    };
  }

  /**
   * Ứng viên khi bước duyệt sắp bắt đầu để người thao tác chọn người duyệt: lúc văn thư giao
   * xử lý / trình duyệt (bước đầu của quy trình theo cấu hình), lúc duyệt (bước kế tiếp).
   * Không cần chọn thì `null`.
   */
  async stepChoice(actor: CorrespondenceActor, letterId: string, kind?: string): Promise<StepChoice | null> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const { letter, steps, assignments, row } = await this.loadRow(actor.tenantId, letterId);
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    let target: { name: string; approver: ApproverRule; chosenUserId?: string } | undefined;
    if (letter.stage === 'received' || letter.stage === 'checking') {
      const typeCode = kind && catalog.get('letter_type')?.has(kind) ? kind : letter.kind;
      target = (await this.pickWorkflow(actor.tenantId, { ...letter, kind: typeCode })).steps[0];
    } else if (letter.stage === 'reviewing') {
      const current = steps.find((step) => step.status === 'active');
      if (current) target = sortedSteps(steps).find((step) => step.seq > current.seq && step.status === 'waiting');
    }
    if (!target || target.approver.type !== 'choose' || target.chosenUserId) return null;
    const context = await this.approverContext(actor.tenantId, letter, assignments);
    return { stepName: target.name, candidates: chooseCandidates(target.approver, context) };
  }

  /** Báo cáo theo năm: số công văn đến, đi, đã xong, trễ hạn theo tháng, loại văn bản, phòng ban. */
  async report(actor: CorrespondenceActor, yearValue?: unknown): Promise<CorrespondenceReport> {
    if (!actor.canReadReports && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền xem báo cáo văn thư.');
    const year = yearValue === undefined || yearValue === '' ? Number(this.today().slice(0, 4)) : Number(yearValue);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new CorrespondenceValidationError('Năm báo cáo không hợp lệ.');
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const rows = (await this.store.listLetters(actor.tenantId, { visibleTo: this.visibility(viewer), year, limit: REPORT_LIMIT })).filter(
      (row) => row.stage !== 'cancelled' && canViewLetter(viewer, facts(row, catalog)),
    );
    const today = this.today();
    // Đang chờ duyệt huỷ vẫn là công văn đã xong cho tới khi được đồng ý huỷ.
    const done = (row: Row) => row.stage === 'archived' || row.stage === 'revoking';
    const late = (row: Row) => Boolean(row.dueOn && (done(row) ? (row.archivedOn ?? '') > row.dueOn : row.dueOn < today));
    const tally = (label: string, list: readonly Row[]): CorrespondenceReportRow => ({
      label,
      incoming: list.filter((row) => row.direction === 'incoming').length,
      outgoing: list.filter((row) => row.direction === 'outgoing').length,
      completed: list.filter(done).length,
      late: list.filter(late).length,
    });
    const groups = (key: (row: Row) => readonly string[]) => {
      const map = new Map<string, Row[]>();
      for (const row of rows) for (const label of new Set(key(row))) map.set(label, [...(map.get(label) ?? []), row]);
      return [...map.entries()]
        .map(([label, list]) => tally(label, list))
        .sort((left, right) => right.incoming + right.outgoing - (left.incoming + left.outgoing) || left.label.localeCompare(right.label, 'vi'));
    };
    return {
      year,
      totals: {
        incoming: rows.filter((row) => row.direction === 'incoming').length,
        outgoing: rows.filter((row) => row.direction === 'outgoing').length,
        completed: rows.filter(done).length,
        open: rows.filter((row) => !done(row)).length,
        late: rows.filter(late).length,
      },
      byMonth: Array.from({ length: 12 }, (_, index) =>
        tally(`Tháng ${index + 1}`, rows.filter((row) => Number(row.receivedOn.slice(5, 7)) === index + 1)),
      ),
      byType: groups((row) => [catalog.get('letter_type')?.get(row.kind)?.name ?? row.kind]),
      byUnit: groups((row) =>
        row.direction === 'incoming'
          ? row.assignments.length > 0
            ? row.assignments.map((item) => item.unitName)
            : ['Chưa giao phòng ban']
          : [row.authorUnitName ?? 'Chưa rõ phòng ban'],
      ),
    };
  }

  /**
   * Cây lưu trữ của Văn thư, cùng cấu trúc thư mục bên Hệ dùng chung (năm › công văn đến / đi ›
   * hồ sơ › tệp), để xem tài liệu ngay trong Văn thư. Chỉ gồm công văn người xem được thấy;
   * công văn đã huỷ không có trong cây.
   */
  async archiveTree(actor: CorrespondenceActor): Promise<ArchiveTree> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const rows = (await this.store.listLetters(actor.tenantId, { visibleTo: this.visibility(viewer), limit: REPORT_LIMIT })).filter(
      (row) => row.stage !== 'cancelled' && canViewLetter(viewer, facts(row, catalog)),
    );
    const files = await this.store.attachmentsOf(
      actor.tenantId,
      rows.map((row) => row.id),
    );
    const byLetter = new Map<string, (typeof files)[number][]>();
    for (const file of files) byLetter.set(file.letterId, [...(byLetter.get(file.letterId) ?? []), file]);
    const years = new Map<number, Map<LetterDirection, ArchiveDossier[]>>();
    for (const row of rows) {
      const dossier: ArchiveDossier = {
        letterId: row.id,
        direction: row.direction,
        folderName: dossierFolderName(row.incomingNo, row.subject),
        displayNo: displayNo(row),
        subject: row.subject,
        stage: row.stage,
        stageLabel: LETTER_STAGE_LABELS[row.stage] ?? row.stage,
        partner: row.direction === 'outgoing' ? row.recipient : row.senderOrg,
        archiveCode: row.archiveCode,
        archivedOn: row.archivedOn,
        receivedOn: row.receivedOn,
        files: (byLetter.get(row.id) ?? []).map((file) => ({
          id: file.id,
          fileName: file.fileName,
          kind: file.kind,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          versionNo: file.versionNo,
          createdAt: file.createdAt,
          unitName: file.unitName,
        })),
      };
      const groups = years.get(row.year) ?? new Map<LetterDirection, ArchiveDossier[]>();
      groups.set(row.direction, [...(groups.get(row.direction) ?? []), dossier]);
      years.set(row.year, groups);
    }
    return {
      rootName: CORRESPONDENCE_FILING_ROOT,
      years: [...years.entries()]
        .sort(([left], [right]) => right - left)
        .map(([year, groups]) => ({
          year,
          groups: LETTER_DIRECTIONS.filter((direction) => groups.has(direction)).map((direction) => ({
            direction,
            label: FOLDER_BY_DIRECTION[direction],
            dossiers: (groups.get(direction) ?? []).sort((left, right) => left.folderName.localeCompare(right.folderName, 'vi', { numeric: true })),
          })),
        })),
    };
  }

  /* ================================================================ công văn đến */

  /** Văn thư tiếp nhận, vào sổ, cấp số đến. */
  async create(original: CorrespondenceActor, input: CreateLetterRequest): Promise<LetterDetail> {
    const actor = await this.effective(original);
    if (!actor.canRegister && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền tiếp nhận công văn đến.');
    const [settings, catalog] = await Promise.all([this.store.settings(actor.tenantId), this.catalogMap(actor.tenantId)]);
    const codes = this.classification(catalog, input);
    const receivedOn = optionalDate(input?.receivedOn, 'Ngày đến') ?? this.today();
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý') ?? defaultDue(catalog, settings, codes.kind, receivedOn);
    if (dueOn && dueOn < receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
    const letter = await this.store.createLetter(
      actor.tenantId,
      {
        direction: 'incoming',
        stage: 'received',
        receivedOn,
        senderOrg: requireText(input?.senderOrg, 'Cơ quan gửi', 255),
        senderRef: optionalText(input?.senderRef, 'Số, ký hiệu văn bản', 120),
        senderDate: optionalDate(input?.senderDate, 'Ngày văn bản'),
        subject: requireText(input?.subject, 'Trích yếu', 1000),
        ...codes,
        dueOn,
        receivedBy: actor.userId,
      },
      { counter: 'incoming', suffix: settings.incomingSuffix },
      async (tx) => {
        await tx.history({ action: 'receive', summary: `Tiếp nhận, vào sổ công văn đến số ${tx.letter.incomingNo}`, actorUserId: actor.userId });
      },
    );
    return this.detail(actor, letter.id);
  }

  /**
   * Văn thư phân loại, chọn phòng ban xử lý và giao. Mỗi phòng: cả phòng cùng nhận, hoặc
   * một người xử lý (bắt buộc khi cấu hình đặt "phải chọn người xử lý"). Các bước duyệt sau
   * khi phòng ban xử lý xong lấy theo quy trình cấu hình cho loại văn bản.
   */
  async dispatch(actor: CorrespondenceActor, letterId: string, input: DispatchLetterRequest): Promise<LetterDetail> {
    const [settings, catalog, snapshot] = await Promise.all([
      this.store.settings(actor.tenantId),
      this.catalogMap(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const codes = this.classification(catalog, input, true);
    const units = this.dispatchUnits(snapshot, settings, input?.units);
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý');
    const note = optionalText(input?.note, 'Ghi chú', 4000);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, { ...current, kind: codes.kind }, input?.workflowId);
    const firstChoice = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    await this.transition(actor, letterId, (actions) => actions.dispatch, async (tx) => {
      if (dueOn && dueOn < tx.letter.receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      await tx.replaceSteps(workflow.steps);
      await this.preselect(actor.tenantId, tx, firstChoice, units.map((unit) => unit.unitId));
      const keep = new Set(units.map((unit) => unit.unitId));
      const dropped = tx.assignments.filter((item) => !keep.has(item.unitId));
      if (dropped.length > 0) await tx.removeAssignments(dropped.map((item) => item.id));
      await tx.assign(units.map(({ unitId, unitName, handlerUserId }) => ({ unitId, unitName, handlerUserId })));
      const letter = await tx.update({
        ...codes,
        dueOn: dueOn ?? tx.letter.dueOn,
        instruction: note,
        workflowId: workflow.id,
        workflowName: workflow.name,
        stage: 'processing',
      });
      await tx.history({
        action: 'dispatch',
        summary: `Giao ${units.map((unit) => (unit.handlerName ? `${unit.unitName} (${unit.handlerName})` : unit.unitName)).join(', ')} xử lý`,
        note,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.assigned, letter, actor, units.flatMap((unit) => unit.recipients), {
          summary: `Công văn ${letterTitle(withNo(letter))} của ${letter.senderOrg} được giao xử lý.${note ? ` ${note}` : ''}${dueText(letter.dueOn)}`,
          unitNames: units.map((unit) => unit.unitName),
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Phòng ban phân công (hay đổi) người xử lý. */
  async assignHandler(
    actor: CorrespondenceActor,
    letterId: string,
    assignmentId: string,
    input: AssignHandlerRequest,
  ): Promise<LetterDetail> {
    const handlerUserId = requireText(input?.handlerUserId, 'Người xử lý', 64);
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const viewer = await this.viewer(actor);
    const snapshot = await this.organization.snapshot(actor.tenantId);
    await this.inLetter(actor, letterId, async (tx) => {
      const assignment = tx.assignments.find((item) => item.id === assignmentId);
      if (!assignment) throw new CorrespondenceValidationError('Phòng ban này không được giao xử lý công văn.');
      if (!canAssignHandler(viewer, tx.letter, assignment)) {
        if (tx.letter.stage !== 'processing' || assignment.status !== 'pending') throw new LetterStageConflictError();
        throw new CorrespondenceForbiddenError(`Chỉ trưởng ${assignment.unitName} hay văn thư phân công được người xử lý.`);
      }
      const member = unitMembers(snapshot, assignment.unitId).find((item) => item.userId === handlerUserId);
      if (!member) throw new CorrespondenceValidationError(`Người được chọn không thuộc ${assignment.unitName}.`);
      await tx.setHandler(assignment.id, handlerUserId);
      await tx.history({ action: 'assign-handler', summary: `${assignment.unitName}: phân công ${member.name} xử lý`, note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.handlerAssigned, tx.letter, actor, [handlerUserId], {
          summary: `Bạn được phân công xử lý công văn ${letterTitle(withNo(tx.letter))} cho ${assignment.unitName}.${note ? ` ${note}` : ''}${dueText(tx.letter.dueOn)}`,
          unitName: assignment.unitName,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Phòng ban gửi kết quả; đủ kết quả của mọi phòng thì sang bước duyệt đầu tiên. */
  async respond(
    actor: CorrespondenceActor,
    letterId: string,
    assignmentId: string,
    input: RespondAssignmentRequest,
  ): Promise<LetterDetail> {
    const note = requireText(input?.note, 'Nội dung kết quả', 4000);
    const viewer = await this.viewer(actor);
    await this.inLetter(actor, letterId, async (tx) => {
      const assignment = tx.assignments.find((item) => item.id === assignmentId);
      if (!assignment) throw new CorrespondenceValidationError('Phòng ban này không được giao xử lý công văn.');
      if (tx.letter.stage !== 'processing' || assignment.status !== 'pending') throw new LetterStageConflictError();
      if (!canRespondFor(viewer, tx.letter, assignment)) {
        throw new CorrespondenceForbiddenError(
          assignment.handlerUserId
            ? 'Chỉ người được phân công, trưởng phòng hay văn thư gửi được kết quả.'
            : `Chỉ người thuộc ${assignment.unitName} gửi được kết quả của phòng.`,
        );
      }
      await tx.submitAssignment(assignment.id, { note, userId: actor.userId });
      await tx.history({ action: 'respond', summary: `${assignment.unitName} gửi kết quả xử lý`, note, actorUserId: actor.userId });
      if (!tx.assignments.some((item) => item.status === 'pending')) await this.startApprovals(actor, tx, undefined);
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư tiếp nhận kết quả, xác nhận hoàn tất và lưu trữ (cấp số hồ sơ). */
  async complete(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú hoàn tất', 4000);
    const settings = await this.store.settings(actor.tenantId);
    const archivedOn = this.today();
    const letter = await this.transition(actor, letterId, (actions) => actions.complete, async (tx) => {
      const archiveCode = await this.archiveCode(tx, settings, archivedOn);
      const updated = await tx.update({ stage: 'archived', archiveCode, archivedOn, completionNote: note });
      await tx.history({ action: 'complete', summary: `Hoàn tất, lưu trữ hồ sơ số ${archiveCode}`, note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.completed, updated, actor, participants(tx), {
          summary: `Công văn ${letterTitle(withNo(updated))} đã hoàn tất, lưu trữ số ${archiveCode}.`,
          archiveCode,
        }),
      );
      return updated;
    });
    await this.recordArchive(actor, letter);
    return this.detail(actor, letterId);
  }

  /* ================================================================ công văn đi */

  /** Phòng ban soạn công văn đi; đơn vị soạn thảo là phòng của người soạn theo sơ đồ tổ chức. */
  async createOutgoing(original: CorrespondenceActor, input: CreateOutgoingRequest): Promise<LetterDetail> {
    const actor = await this.effective(original);
    if (!actor.canCreateOutgoing && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền soạn công văn đi.');
    const [settings, catalog, snapshot] = await Promise.all([
      this.store.settings(actor.tenantId),
      this.catalogMap(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const codes = this.classification(catalog, input);
    const mine = ownUnits(snapshot, actor.userId);
    // Mặc định là phòng của người soạn; soạn thay phòng khác thì chọn phòng đó (phải có trong sơ đồ tổ chức).
    const wanted = optionalText(input?.authorUnitId, 'Phòng ban soạn thảo', 64);
    const unitId = wanted ?? mine[0];
    const unit = unitId ? snapshot.nodes.find((node) => node.id === unitId && node.kind === 'unit') : undefined;
    if (wanted && !unit) throw new CorrespondenceValidationError('Phòng ban soạn thảo không còn trong sơ đồ tổ chức.');
    const today = this.today();
    const dueOn = optionalDate(input?.dueOn, 'Hạn ban hành') ?? defaultDue(catalog, settings, codes.kind, today);
    let relatedLetterId: string | undefined;
    if (input?.relatedLetterId) {
      const related = await this.detail(actor, String(input.relatedLetterId)).catch(() => undefined);
      if (!related || related.direction !== 'incoming') {
        throw new CorrespondenceValidationError('Công văn đến được trả lời không còn hay bạn không xem được.');
      }
      relatedLetterId = related.id;
    }
    const letter = await this.store.createLetter(
      actor.tenantId,
      {
        direction: 'outgoing',
        stage: 'drafting',
        receivedOn: today,
        senderOrg: unit?.name ?? actor.displayName,
        subject: requireText(input?.subject, 'Trích yếu', 1000),
        recipient: requireText(input?.recipient, 'Nơi nhận', 255),
        ...codes,
        dueOn,
        authorUserId: actor.userId,
        authorUnitId: unit?.id,
        authorUnitName: unit?.name,
        relatedLetterId,
        receivedBy: actor.userId,
      },
      { counter: 'draft', suffix: DRAFT_SUFFIX },
      async (tx) => {
        await tx.history({ action: 'create', summary: `Soạn công văn đi, số dự thảo ${tx.letter.incomingNo}`, actorUserId: actor.userId });
      },
    );
    return this.detail(actor, letter.id);
  }

  /** Người soạn gửi văn thư kiểm tra thể thức. */
  async sendToClerk(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const clerks = await this.clerkTargets(actor.tenantId, ROUTE_PERMISSIONS.register);
    await this.transition(actor, letterId, (actions) => actions.sendToClerk, async (tx) => {
      const letter = await tx.update({ stage: 'checking' });
      await tx.history({ action: 'send-to-clerk', summary: 'Gửi văn thư kiểm tra', note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.sentToClerk, letter, actor, clerks.recipients, {
          summary: `${actor.displayName} gửi công văn đi ${letterTitle(withNo(letter))} để văn thư kiểm tra.`,
          notifyPermissions: clerks.notifyPermissions,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư xác nhận hợp lệ, trình duyệt theo quy trình cấu hình (không có bước duyệt thì chờ ban hành). */
  async submit(actor: CorrespondenceActor, letterId: string, input: SubmitLetterRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, current, input?.workflowId);
    const firstChoice = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    await this.transition(actor, letterId, (actions) => actions.submit, async (tx) => {
      await tx.replaceSteps(workflow.steps);
      await tx.update({ workflowId: workflow.id, workflowName: workflow.name });
      await tx.history({
        action: 'submit',
        summary: workflow.steps.length > 0 ? `Xác nhận hợp lệ, trình duyệt (${workflow.name})` : 'Xác nhận hợp lệ, chuyển ban hành',
        note,
        actorUserId: actor.userId,
      });
      await this.startApprovals(actor, tx, firstChoice);
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư đánh số, ban hành, gửi đi và lưu trữ hồ sơ. */
  async publish(actor: CorrespondenceActor, letterId: string, input: PublishLetterRequest): Promise<LetterDetail> {
    const recipient = requireText(input?.recipient, 'Nơi nhận', 255);
    const publishedOn = optionalDate(input?.publishedOn, 'Ngày ban hành') ?? this.today();
    const deliveryMethod = optionalText(input?.deliveryMethod, 'Hình thức gửi', 120);
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const settings = await this.store.settings(actor.tenantId);
    const letter = await this.transition(actor, letterId, (actions) => actions.publish, async (tx) => {
      const outgoingNo = formatSequenceNo(await tx.nextNumber('outgoing', Number(publishedOn.slice(0, 4))), settings.outgoingSuffix);
      const archivedOn = this.today();
      const archiveCode = await this.archiveCode(tx, settings, archivedOn);
      const updated = await tx.update({
        stage: 'archived',
        outgoingNo,
        publishedOn,
        recipient,
        deliveryMethod,
        deliveryStatus: 'sent',
        deliveryNote: note,
        archiveCode,
        archivedOn,
      });
      await tx.history({
        action: 'publish',
        summary: `Đánh số ${outgoingNo}, ban hành gửi ${recipient}${deliveryMethod ? ` (${deliveryMethod})` : ''}; lưu trữ số ${archiveCode}`,
        note,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.published, updated, actor, participants(tx), {
          summary: `Công văn đi ${outgoingNo} (${updated.subject}) đã ban hành, gửi ${recipient}.`,
          outgoingNo,
        }),
      );
      return updated;
    });
    await this.recordArchive(actor, letter);
    return this.detail(actor, letterId);
  }

  /** Theo dõi tình trạng gửi công văn đi đã ban hành. */
  async updateDelivery(actor: CorrespondenceActor, letterId: string, input: UpdateDeliveryRequest): Promise<LetterDetail> {
    const status = requireEnum(input?.status, DELIVERY_STATUSES, 'Tình trạng gửi');
    const deliveredOn = optionalDate(input?.deliveredOn, 'Ngày');
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    await this.transition(actor, letterId, (actions) => actions.updateDelivery, async (tx) => {
      await tx.update({ deliveryStatus: status, deliveredOn: deliveredOn ?? tx.letter.deliveredOn, deliveryNote: note ?? tx.letter.deliveryNote });
      await tx.history({ action: 'delivery', summary: `Tình trạng gửi: ${DELIVERY_STATUS_LABELS[status]}`, note, actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  /* ================================================================ chung */

  async update(actor: CorrespondenceActor, letterId: string, input: UpdateLetterRequest): Promise<LetterDetail> {
    const catalog = await this.catalogMap(actor.tenantId);
    await this.transition(actor, letterId, (actions) => actions.edit, async (tx) => {
      const patch = input ?? {};
      const incoming = tx.letter.direction === 'incoming';
      const receivedOn = patch.receivedOn === undefined || !incoming ? tx.letter.receivedOn : requireDate(patch.receivedOn, 'Ngày đến');
      const dueOn = patch.dueOn === undefined ? tx.letter.dueOn : optionalDate(patch.dueOn, 'Hạn xử lý');
      if (dueOn && dueOn < receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      await tx.update({
        receivedOn,
        dueOn,
        senderOrg: !incoming || patch.senderOrg === undefined ? tx.letter.senderOrg : requireText(patch.senderOrg, 'Cơ quan gửi', 255),
        senderRef: !incoming || patch.senderRef === undefined ? tx.letter.senderRef : optionalText(patch.senderRef, 'Số, ký hiệu văn bản', 120),
        senderDate: !incoming || patch.senderDate === undefined ? tx.letter.senderDate : optionalDate(patch.senderDate, 'Ngày văn bản'),
        subject: patch.subject === undefined ? tx.letter.subject : requireText(patch.subject, 'Trích yếu', 1000),
        recipient: incoming || patch.recipient === undefined ? tx.letter.recipient : requireText(patch.recipient, 'Nơi nhận', 255),
        kind: this.catalogCode(catalog, 'letter_type', patch.kind, 'Loại văn bản') ?? tx.letter.kind,
        urgency: this.catalogCode(catalog, 'urgency', patch.urgency, 'Độ khẩn') ?? tx.letter.urgency,
        confidentiality: this.catalogCode(catalog, 'confidentiality', patch.confidentiality, 'Độ mật') ?? tx.letter.confidentiality,
      });
      await tx.history({ action: 'update', summary: 'Sửa thông tin công văn', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  /** "Đạt": sang bước duyệt kế tiếp (chọn người nếu bước đó để người thao tác chọn), hết bước thì xong duyệt. */
  async approve(actor: CorrespondenceActor, letterId: string, input: ApproveStepRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến', 4000);
    const nextAssignee = optionalText(input?.nextAssigneeUserId, 'Người duyệt bước sau', 64);
    await this.transition(actor, letterId, (actions) => actions.approve, async (tx) => {
      const step = requireActive(tx);
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'approved', note: note ?? null });
      await tx.history({ action: 'approve', summary: `${step.name}: đạt`, note, actorUserId: actor.userId });
      const next = nextWaiting(tx, step.seq);
      if (next) await this.activate(actor, tx, next, nextAssignee);
      else await this.finishApprovals(actor, tx);
    });
    return this.detail(actor, letterId);
  }

  /**
   * "Không đạt" / trả lại kèm lý do: về bước trước (mặc định), về người xử lý (phòng ban hay
   * người soạn) hoặc về văn thư, tuỳ bước hiện tại và quyền của người trả.
   */
  async returnLetter(actor: CorrespondenceActor, letterId: string, input: ReturnLetterRequest): Promise<LetterDetail> {
    const target = requireEnum(input?.target, RETURN_TARGETS, 'Nơi trả về');
    const reason = requireText(input?.reason, 'Lý do', 4000);
    const viewer = await this.viewer(actor);
    const clerks = await this.clerkTargets(actor.tenantId, ROUTE_PERMISSIONS.register);
    await this.inLetter(actor, letterId, async (tx, letterFacts) => {
      const allowed = returnTargets(viewer, letterFacts);
      if (!allowed.includes(target)) {
        if (allowed.length === 0) throw new LetterStageConflictError();
        throw new CorrespondenceValidationError('Không trả về được nơi này ở bước hiện tại.');
      }
      const from = tx.letter.stage;
      const direction = tx.letter.direction;
      const active = tx.steps.find((item) => item.status === 'active');
      const fromLabel = active?.name ?? LETTER_STAGE_LABELS[from];
      if (active) {
        await tx.updateStep(active.id, { status: 'waiting', assigneeUserIds: [], actedBy: actor.userId, decision: 'returned', note: reason });
      }
      // "Bước trước": bước duyệt xong gần nhất; chưa có thì bước cố định ngay trước của luồng.
      const previous = target === 'previous-step' ? lastDoneBefore(tx, active?.seq) : undefined;
      const landing =
        target === 'previous-step' && !previous
          ? from === 'publishing' || (from === 'reviewing' && direction === 'outgoing')
            ? 'clerk'
            : 'handlers'
          : target;
      let recipients: string[] = [];
      let notifyClerks = false;
      let landed: string;
      if (previous) {
        await this.activate(actor, tx, previous, undefined, { notify: false });
        recipients = [...(tx.steps.find((item) => item.id === previous.id)?.assigneeUserIds ?? [])];
        landed = previous.name;
      } else if (landing === 'clerk') {
        await this.resetSteps(tx);
        const stage: LetterStage = direction === 'incoming' ? 'received' : 'checking';
        await tx.update({ stage });
        recipients = [...(direction === 'incoming' ? [tx.letter.receivedBy] : []), ...clerks.recipients];
        notifyClerks = direction === 'outgoing';
        landed = LETTER_STAGE_LABELS[stage];
      } else if (direction === 'incoming') {
        // Về phòng ban xử lý; các bước duyệt chạy lại từ đầu khi phòng ban gửi lại kết quả.
        await this.resetSteps(tx);
        const wanted = Array.isArray(input?.assignmentIds) && input.assignmentIds.length > 0 ? new Set(input.assignmentIds.map(String)) : undefined;
        const targets = tx.assignments.filter((item) => !wanted || wanted.has(item.id));
        if (targets.length === 0 || (wanted && targets.length !== wanted.size)) {
          throw new CorrespondenceValidationError('Chọn phòng ban phải làm lại trong số phòng ban đã giao.');
        }
        await tx.reopenAssignments(targets.map((item) => item.id), reason);
        await tx.update({ stage: 'processing' });
        recipients = targets.flatMap((item) => [item.handlerUserId, item.submittedBy].filter((id): id is string => Boolean(id)));
        landed = targets.map((item) => item.unitName).join(', ');
      } else {
        await this.resetSteps(tx);
        await tx.update({ stage: 'drafting' });
        recipients = tx.letter.authorUserId ? [tx.letter.authorUserId] : [];
        landed = returnTargetLabel('handlers', direction);
      }
      await tx.history({ action: 'return', summary: `${fromLabel}: không đạt, trả về ${landed}`, note: reason, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.returned, tx.letter, actor, recipients, {
          summary: `${actor.displayName} trả lại công văn ${letterTitle(withNo(tx.letter))} ở bước "${fromLabel}" về ${landed}: ${reason}`,
          reason,
          ...(notifyClerks ? { notifyPermissions: clerks.notifyPermissions } : {}),
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async cancel(actor: CorrespondenceActor, letterId: string, input: ReasonRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Lý do huỷ', 2000);
    await this.transition(actor, letterId, (actions) => actions.cancel, async (tx) => {
      const recipients = [...participants(tx), ...(tx.steps.find((item) => item.status === 'active')?.assigneeUserIds ?? [])];
      for (const step of tx.steps.filter((item) => item.status === 'active' || item.status === 'waiting')) {
        await tx.updateStep(step.id, { status: 'skipped' });
      }
      const letter = await tx.update({ stage: 'cancelled', cancelReason: reason });
      await tx.history({ action: 'cancel', summary: 'Huỷ công văn', note: reason, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.cancelled, letter, actor, recipients, {
          summary: `${actor.displayName} huỷ công văn ${letterTitle(withNo(letter))}: ${reason}`,
          reason,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /**
   * Văn thư đề nghị huỷ công văn đã ban hành (đi) hay đã hoàn tất (đến): thu hồi, hoặc sửa đổi,
   * thay thế. Người xác nhận là người có thẩm quyền ở bước duyệt cuối, giải lại theo cấu hình và
   * sơ đồ tổ chức hiện tại (người đã ký nếu không giải được). Quy trình không có bước duyệt thì
   * không có ai trên văn thư: huỷ ngay.
   */
  async requestRevoke(actor: CorrespondenceActor, letterId: string, input: RequestRevokeRequest): Promise<LetterDetail> {
    const kind = requireEnum(input?.kind, REVOKE_KINDS, 'Hình thức huỷ');
    const reason = requireText(input?.reason, 'Lý do', 2000);
    const kindLabel = REVOKE_KIND_LABELS[kind];
    await this.transition(actor, letterId, (actions) => actions.requestRevoke, async (tx) => {
      const approvers = await this.finalApprovers(actor, tx);
      const requested = {
        revokeKind: kind,
        revokeReason: reason,
        revokeRequestedBy: actor.userId,
        revokeRequestedAt: new Date().toISOString(),
        revokeApproverIds: approvers,
      };
      if (approvers.length === 0) {
        const letter = await tx.update({ ...requested, stage: 'cancelled', cancelReason: `${kindLabel}: ${reason}` });
        await tx.history({ action: 'cancel', summary: `Huỷ công văn (${kindLabel.toLowerCase()})`, note: reason, actorUserId: actor.userId });
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.cancelled, letter, actor, participants(tx), {
            summary: `${actor.displayName} huỷ công văn ${letterTitle(withNo(letter))} (${kindLabel.toLowerCase()}): ${reason}`,
            reason,
          }),
        );
        return;
      }
      const letter = await tx.update({ ...requested, stage: 'revoking' });
      await tx.history({ action: 'revoke-request', summary: `Đề nghị huỷ công văn (${kindLabel.toLowerCase()})`, note: reason, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.revokeRequested, letter, actor, approvers, {
          summary: `${actor.displayName} đề nghị ${kindLabel.toLowerCase()} công văn ${letterTitle(withNo(letter))}: ${reason}. Chờ bạn xác nhận huỷ.`,
          reason,
          revokeKind: kind,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Người có thẩm quyền xác nhận: đồng ý thì công văn bị huỷ; không thì giữ nguyên, về lại đã lưu trữ. */
  async decideRevoke(actor: CorrespondenceActor, letterId: string, input: DecideRevokeRequest): Promise<LetterDetail> {
    if (typeof input?.approve !== 'boolean') throw new CorrespondenceValidationError('Chọn đồng ý huỷ hay không.');
    const note = optionalText(input.note, 'Ý kiến', 2000);
    await this.transition(actor, letterId, (actions) => actions.decideRevoke, async (tx) => {
      const kindLabel = tx.letter.revokeKind ? REVOKE_KIND_LABELS[tx.letter.revokeKind] : 'Huỷ';
      const reason = tx.letter.revokeReason ?? '';
      const requester = tx.letter.revokeRequestedBy ? [tx.letter.revokeRequestedBy] : [];
      const clerks = await this.clerkTargets(
        actor.tenantId,
        tx.letter.direction === 'incoming' ? ROUTE_PERMISSIONS.archive : ROUTE_PERMISSIONS.publish,
      );
      if (input.approve) {
        const letter = await tx.update({ stage: 'cancelled', cancelReason: `${kindLabel}: ${reason}` });
        await tx.history({ action: 'revoke-approve', summary: `Đồng ý huỷ công văn (${kindLabel.toLowerCase()})`, note, actorUserId: actor.userId });
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.cancelled, letter, actor, [...participants(tx), ...requester, ...clerks.recipients], {
            summary: `${actor.displayName} đồng ý huỷ công văn ${letterTitle(withNo(letter))} (${kindLabel.toLowerCase()}): ${reason}`,
            reason,
            notifyPermissions: clerks.notifyPermissions,
          }),
        );
        return;
      }
      const letter = await tx.update({ ...CLEARED_REVOKE, stage: 'archived' });
      await tx.history({ action: 'revoke-reject', summary: 'Không đồng ý huỷ, công văn giữ nguyên', note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.revokeRejected, letter, actor, [...requester, ...clerks.recipients], {
          summary: `${actor.displayName} không đồng ý huỷ công văn ${letterTitle(withNo(letter))}${note ? `: ${note}` : ''}. Công văn giữ nguyên.`,
          note: note ?? null,
          notifyPermissions: clerks.notifyPermissions,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư rút đề nghị huỷ khi chưa được xác nhận. */
  async withdrawRevoke(actor: CorrespondenceActor, letterId: string): Promise<LetterDetail> {
    await this.transition(actor, letterId, (actions) => actions.withdrawRevoke, async (tx) => {
      const approvers = tx.letter.revokeApproverIds ?? [];
      const letter = await tx.update({ ...CLEARED_REVOKE, stage: 'archived' });
      await tx.history({ action: 'revoke-withdraw', summary: 'Rút đề nghị huỷ công văn', actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.revokeWithdrawn, letter, actor, approvers, {
          summary: `${actor.displayName} rút đề nghị huỷ công văn ${letterTitle(withNo(letter))}. Bạn không cần xác nhận nữa.`,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /**
   * Xoá công văn đã huỷ khỏi Văn thư (xoá mềm): số sổ không cấp lại, lịch sử giữ trong DB; tệp
   * của hồ sơ chuyển vào Thùng rác của Hệ dùng chung, khôi phục được ở đó.
   */
  async remove(actor: CorrespondenceActor, letterId: string): Promise<void> {
    const documentIds = await this.transition(actor, letterId, (actions) => actions.remove, async (tx) => {
      const files = await this.store.attachments(actor.tenantId, letterId);
      await tx.update({ deletedAt: new Date().toISOString(), deletedBy: actor.userId });
      await tx.history({ action: 'delete', summary: 'Xoá công văn khỏi Văn thư', actorUserId: actor.userId });
      return files.map((file) => file.sharedDocumentId);
    });
    for (const documentId of documentIds) {
      await this.files.trash(actor.tenantId, documentId, actor.userId).catch((error: unknown) => {
        this.logger.warn(`Không chuyển được tài liệu ${documentId} vào Thùng rác: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /** Trao đổi theo bước; nhắc tên (@) được người dùng của tenant, người được nhắc xem được công văn. */
  async comment(actor: CorrespondenceActor, letterId: string, input: CommentRequest): Promise<LetterDetail> {
    const body = requireText(input?.body, 'Nội dung trao đổi', 4000);
    const wanted = [...new Set((Array.isArray(input?.mentionedUserIds) ? input.mentionedUserIds : []).map(String))].filter(
      (id) => id && id !== actor.userId,
    );
    if (wanted.length > MAX_MENTIONS) throw new CorrespondenceValidationError(`Nhắc tên tối đa ${MAX_MENTIONS} người một lần.`);
    const people = wanted.length > 0 ? new Set((await this.store.people(actor.tenantId)).map((person) => person.userId)) : new Set<string>();
    const mentioned = wanted.filter((id) => people.has(id));
    await this.transition(actor, letterId, (actions) => actions.comment, async (tx) => {
      const step = tx.steps.find((item) => item.status === 'active');
      await tx.addComment({ stage: tx.letter.stage, stepName: step?.name, body, mentionedUserIds: mentioned, authorId: actor.userId });
      const excerpt = body.length > 160 ? `${body.slice(0, 157)}…` : body;
      if (mentioned.length > 0) {
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.mentioned, tx.letter, actor, mentioned, {
            summary: `${actor.displayName} nhắc bạn trong công văn ${letterTitle(withNo(tx.letter))}: ${excerpt}`,
            excerpt,
          }),
        );
      }
      const others = [...participants(tx), ...(step?.assigneeUserIds ?? [])].filter((id) => !mentioned.includes(id));
      if (others.length > 0) {
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.commented, tx.letter, actor, others, {
            summary: `${actor.displayName} trao đổi trong công văn ${letterTitle(withNo(tx.letter))}: ${excerpt}`,
            excerpt,
          }),
        );
      }
    });
    return this.detail(actor, letterId);
  }

  /* ================================================================ tệp */

  async createAttachment(actor: CorrespondenceActor, letterId: string, input: CreateAttachmentRequest): Promise<AttachmentUploadTicket> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const kind = requireEnum(input?.kind, ATTACHMENT_KINDS, 'Loại tệp');
    const file = validateUpload(input);
    const { letter, assignments, row } = await this.loadRow(actor.tenantId, letterId);
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    const assignment = attachTarget(viewer, facts(row, catalog), assignments, kind, input?.assignmentId);
    const restricted = Boolean(catalog.get('confidentiality')?.get(letter.confidentiality)?.restricted);
    const number = displayNo(letter);
    const partner = letter.direction === 'outgoing' ? letter.recipient : letter.senderOrg;
    const request = {
      userId: actor.userId,
      rootName: CORRESPONDENCE_FILING_ROOT,
      name: `${ATTACHMENT_KIND_LABELS[kind]} - ${file.fileName}`.slice(0, 255),
      description: assignment ? `${assignment.unitName} · ${number}` : undefined,
      sourceLabel: `Văn thư · ${number}`,
      confidentiality: restricted ? ('confidential' as const) : ('internal' as const),
      docKind: 'official_letter' as const,
      docNumber: kind === 'outgoing' ? letter.outgoingNo : kind === 'incoming' ? letter.senderRef : undefined,
      partner,
      issuedOn: kind === 'incoming' ? letter.senderDate : undefined,
      ...file,
    };
    const dossierPath = [
      { name: String(letter.year) },
      { name: FOLDER_BY_DIRECTION[letter.direction] },
      {
        name: dossierFolderName(letter.incomingNo, letter.subject),
        docKind: 'official_letter' as const,
        docNumber: letter.incomingNo,
        partner,
        issuedOn: letter.senderDate,
        note: `Trích yếu: ${letter.subject}`.slice(0, 2000),
      },
    ];
    let filed;
    try {
      filed = await this.files.create(
        actor.tenantId,
        letter.sharedFolderId ? { ...request, folderId: letter.sharedFolderId } : { ...request, path: dossierPath },
      );
    } catch (error) {
      if (!(error instanceof FileStoreMissingError) || !letter.sharedFolderId) throw error;
      filed = await this.files.create(actor.tenantId, { ...request, path: dossierPath });
    }
    try {
      const attachment = await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
        const fresh = attachTarget(viewer, facts(txRow(tx), catalog), tx.assignments, kind, input?.assignmentId);
        if (tx.letter.sharedFolderId !== filed.folderId) await tx.update({ sharedFolderId: filed.folderId });
        const created = await tx.addAttachment({
          kind,
          assignmentId: fresh?.id,
          sharedDocumentId: filed.documentId,
          sharedVersionId: filed.versionId,
          fileName: file.fileName,
          contentType: file.contentType,
          uploadedBy: actor.userId,
        });
        await tx.history({ action: 'attach', summary: `Đính kèm ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()}: ${file.fileName}`, actorUserId: actor.userId });
        return created;
      });
      return {
        attachment: attachmentView(attachment, new Map([[actor.userId, actor.displayName]]), { canDelete: true, canVersion: true }),
        uploadUrl: filed.uploadUrl,
        expiresInSeconds: filed.expiresInSeconds,
      };
    } catch (error) {
      await this.files.trash(actor.tenantId, filed.documentId, actor.userId).catch(() => undefined);
      throw error;
    }
  }

  /** Tải phiên bản mới của một tệp; các phiên bản cũ vẫn giữ trong kho tài liệu của Hệ dùng chung. */
  async addAttachmentVersion(
    actor: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
    input: CreateAttachmentVersionRequest,
  ): Promise<AttachmentUploadTicket> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const file = validateUpload(input);
    const changeNote = optionalText(input?.note, 'Ghi chú phiên bản', 500);
    const { assignments, row } = await this.loadRow(actor.tenantId, letterId);
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    const attachment = await this.store.findAttachment(actor.tenantId, attachmentId);
    if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
    const assignment = assignments.find((item) => item.id === attachment.assignmentId);
    if (!canAddVersion(viewer, facts(row, catalog), attachment, assignment)) {
      throw new CorrespondenceForbiddenError('Bạn không tải được phiên bản mới của tệp này ở bước hiện tại.');
    }
    const ticket = await this.files.addVersion(actor.tenantId, attachment.sharedDocumentId, { userId: actor.userId, ...file, changeNote });
    const updated = await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const lockedAssignment = tx.assignments.find((item) => item.id === attachment.assignmentId);
      if (!canAddVersion(viewer, facts(txRow(tx), catalog), attachment, lockedAssignment)) throw new LetterStageConflictError();
      const version = {
        sharedVersionId: ticket.versionId,
        versionNo: ticket.versionNo,
        fileName: file.fileName,
        contentType: file.contentType,
        uploadedBy: actor.userId,
      };
      await tx.setAttachmentVersion(attachment.id, version);
      await tx.history({
        action: 'version',
        summary: `Tải phiên bản ${ticket.versionNo} của ${attachment.fileName}`,
        note: changeNote,
        actorUserId: actor.userId,
      });
      return { ...attachment, ...version, sizeBytes: undefined };
    });
    return {
      attachment: attachmentView(updated, new Map([[actor.userId, actor.displayName]]), { canDelete: true, canVersion: true }),
      uploadUrl: ticket.uploadUrl,
      expiresInSeconds: ticket.expiresInSeconds,
    };
  }

  async completeAttachment(
    original: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
    sizeBytes: unknown,
  ): Promise<LetterAttachment> {
    const actor = await this.effective(original);
    const attachment = await this.visibleAttachment(actor, letterId, attachmentId);
    if (attachment.uploadedBy !== actor.userId && !actor.canRegister && !actor.isTenantAdmin) {
      throw new CorrespondenceForbiddenError('Chỉ người tải tệp lên mới báo xong được.');
    }
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 0 || size > CORRESPONDENCE_ATTACHMENT_MAX_BYTES) {
      throw new CorrespondenceValidationError('Dung lượng tệp không hợp lệ.');
    }
    await this.files.complete(actor.tenantId, attachment.sharedDocumentId, attachment.sharedVersionId, size);
    await this.store.completeAttachment(actor.tenantId, attachmentId, size);
    const names = await this.store.userNames(actor.tenantId, [attachment.uploadedBy]);
    return attachmentView({ ...attachment, sizeBytes: size }, names, { canDelete: true, canVersion: true });
  }

  /** URL ký sẵn để xem trước (ghi nhật ký là "xem") hay tải xuống. */
  async download(actor: CorrespondenceActor, letterId: string, attachmentId: string, mode: AttachmentDownloadMode): Promise<AttachmentDownloadTicket> {
    const attachment = await this.visibleAttachment(actor, letterId, attachmentId);
    if (attachment.sizeBytes == null) throw new CorrespondenceValidationError('Tệp chưa tải lên xong, chưa mở được.');
    try {
      return await this.files.download(actor.tenantId, attachment.sharedDocumentId, actor.userId, mode === 'preview' ? 'preview' : 'download');
    } catch (error) {
      if (error instanceof FileStoreMissingError) {
        throw new CorrespondenceValidationError('Tệp không còn trong kho tài liệu của Hệ dùng chung (đã bị xoá bên đó).');
      }
      throw error;
    }
  }

  async deleteAttachment(actor: CorrespondenceActor, letterId: string, attachmentId: string): Promise<void> {
    const viewer = await this.viewer(actor);
    const documentId = await this.inLetter(actor, letterId, async (tx, letterFacts) => {
      const attachment = await this.store.findAttachment(actor.tenantId, attachmentId);
      if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
      const assignment = attachment.assignmentId ? tx.assignments.find((item) => item.id === attachment.assignmentId) : undefined;
      if (!canDeleteAttachment(viewer, letterFacts, { ...attachment, assignment })) {
        throw new CorrespondenceForbiddenError('Bạn không gỡ được tệp này ở bước hiện tại.');
      }
      await tx.removeAttachment(attachment.id);
      await tx.history({ action: 'detach', summary: `Gỡ tệp ${attachment.fileName}`, actorUserId: actor.userId });
      return attachment.sharedDocumentId;
    });
    await this.files.trash(actor.tenantId, documentId, actor.userId).catch((error: unknown) => {
      this.logger.warn(`Không chuyển được tài liệu ${documentId} vào Thùng rác: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /* ================================================================ cấu hình */

  async saveSettings(actor: CorrespondenceActor, input: CorrespondenceSettings): Promise<CorrespondenceSettings> {
    this.requireConfigure(actor);
    const days = Number(input?.defaultDueDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new CorrespondenceValidationError('Hạn xử lý mặc định là số ngày từ 0 đến 365.');
    }
    const settings: CorrespondenceSettings = {
      incomingSuffix: requireText(input?.incomingSuffix, 'Ký hiệu số đến', 30),
      outgoingSuffix: requireText(input?.outgoingSuffix, 'Ký hiệu số đi', 30),
      archivePrefix: requireText(input?.archivePrefix, 'Tiền tố số hồ sơ', 20),
      defaultDueDays: days,
      dispatchMode: parseOptional(input?.dispatchMode, DISPATCH_MODES, 'Cách giao phòng ban') ?? 'all',
      clerkUserIds: await this.clerkList(actor.tenantId, input?.clerkUserIds),
    };
    await this.store.saveSettings(actor.tenantId, actor.userId, settings);
    return settings;
  }

  /** Người làm văn thư: người dùng đang hoạt động của tenant, không trùng, tối đa MAX_CLERKS. */
  private async clerkList(tenantId: string, raw: unknown): Promise<string[]> {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map((item) => String(item ?? '').trim()).filter(Boolean))];
    if (ids.length > MAX_CLERKS) throw new CorrespondenceValidationError(`Chỉ định tối đa ${MAX_CLERKS} người làm văn thư.`);
    if (ids.length === 0) return [];
    const active = new Set((await this.store.people(tenantId)).map((person) => person.userId));
    if (ids.some((id) => !active.has(id))) throw new CorrespondenceValidationError('Người làm văn thư được chọn không còn hoạt động.');
    return ids;
  }

  async saveCatalogItem(actor: CorrespondenceActor, id: string | undefined, input: SaveCatalogItemRequest): Promise<CatalogItem> {
    this.requireConfigure(actor);
    const kind = requireEnum(input?.kind, CATALOG_KINDS, 'Loại danh mục');
    const code = String(input?.code ?? '').trim().toLowerCase();
    if (!CATALOG_CODE_PATTERN.test(code)) {
      throw new CorrespondenceValidationError('Mã chỉ gồm chữ thường không dấu, số, gạch ngang, gạch dưới (tối đa 40 ký tự).');
    }
    const existing = id ? (await this.store.catalog(actor.tenantId)).find((item) => item.id === id) : undefined;
    if (id && !existing) throw new CorrespondenceValidationError('Mục danh mục không còn, tải lại trang.');
    if (existing && (existing.kind !== kind || (existing.inUse && existing.code !== code))) {
      throw new CorrespondenceValidationError('Mục đã có công văn dùng nên không đổi được mã hay loại.');
    }
    const due = input?.defaultDueDays as unknown;
    const defaultDueDays = due === undefined || due === null || due === '' ? null : Number(due);
    if (defaultDueDays !== null && (!Number.isInteger(defaultDueDays) || defaultDueDays < 0 || defaultDueDays > 365)) {
      throw new CorrespondenceValidationError('Hạn xử lý mặc định là số ngày từ 0 đến 365.');
    }
    const workflows = await this.store.workflows(actor.tenantId);
    const workflowFor = (value: unknown, direction: LetterDirection) => {
      const wanted = optionalText(value, 'Quy trình', 64);
      if (!wanted) return null;
      if (!workflows.some((item) => item.id === wanted && item.direction === direction)) {
        throw new CorrespondenceValidationError(`Quy trình ${direction === 'incoming' ? 'công văn đến' : 'công văn đi'} được chọn không còn.`);
      }
      return wanted;
    };
    const defaultUnitIds = [...new Set((Array.isArray(input?.defaultUnitIds) ? input.defaultUnitIds : []).map(String).filter(Boolean))];
    if (defaultUnitIds.length > MAX_UNITS_PER_LETTER) throw new CorrespondenceValidationError(`Tối đa ${MAX_UNITS_PER_LETTER} phòng ban gợi ý.`);
    const sortOrder = Number(input?.sortOrder ?? 0);
    const letterType = kind === 'letter_type';
    return this.store.saveCatalogItem(actor.tenantId, actor.userId, id, {
      kind,
      code,
      name: requireText(input?.name, 'Tên', 120),
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      isActive: input?.isActive !== false,
      defaultDueDays: letterType ? defaultDueDays : null,
      workflowId: letterType ? workflowFor(input?.workflowId, 'incoming') : null,
      outgoingWorkflowId: letterType ? workflowFor(input?.outgoingWorkflowId, 'outgoing') : null,
      defaultUnitIds: letterType ? defaultUnitIds : [],
      highlight: kind === 'urgency' && input?.highlight === true,
      restricted: kind === 'confidentiality' && input?.restricted === true,
    });
  }

  /**
   * Thêm nhanh mục danh mục lúc nhập công văn (nút "+" cạnh ô chọn): người cấu hình và văn thư
   * làm được. Chỉ cần tên; mã tự sinh từ tên, xếp cuối danh mục, các tuỳ chọn khác để mặc định
   * (sửa thêm trong Cấu hình). Tên đã có thì trả mục đó, không tạo trùng.
   */
  async quickAddCatalogItem(original: CorrespondenceActor, input: QuickCatalogItemRequest): Promise<CatalogItem> {
    const actor = await this.effective(original);
    if (!actor.canConfigure && !actor.isTenantAdmin && !actor.canRegister) {
      throw new CorrespondenceForbiddenError('Bạn không có quyền thêm danh mục văn thư.');
    }
    const kind = requireEnum(input?.kind, CATALOG_KINDS, 'Loại danh mục');
    const name = requireText(input?.name, 'Tên', 120).replace(/\s+/g, ' ');
    const items = (await this.store.catalog(actor.tenantId)).filter((item) => item.kind === kind);
    const same = items.find((item) => foldName(item.name) === foldName(name));
    if (same) {
      if (!same.isActive) throw new CorrespondenceValidationError(`"${same.name}" đã có nhưng đang ngừng dùng. Vào Cấu hình để dùng lại.`);
      return same;
    }
    const base = catalogCode(name);
    const taken = new Set(items.map((item) => item.code));
    let code = base;
    for (let index = 2; taken.has(code); index += 1) code = `${base.slice(0, 36)}-${index}`;
    return this.store.saveCatalogItem(actor.tenantId, actor.userId, undefined, {
      kind,
      code,
      name,
      sortOrder: items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10,
      isActive: true,
      defaultDueDays: null,
      workflowId: null,
      outgoingWorkflowId: null,
      defaultUnitIds: [],
      highlight: false,
      restricted: false,
    });
  }

  async deleteCatalogItem(actor: CorrespondenceActor, id: string): Promise<void> {
    this.requireConfigure(actor);
    if (!(await this.store.deleteCatalogItem(actor.tenantId, id))) {
      throw new CorrespondenceValidationError('Mục đã có công văn dùng nên không xoá được; hãy ngừng dùng.');
    }
  }

  async saveWorkflow(actor: CorrespondenceActor, id: string | undefined, input: SaveWorkflowRequest): Promise<Workflow> {
    this.requireConfigure(actor);
    const direction = requireEnum(input?.direction, LETTER_DIRECTIONS, 'Luồng công văn');
    const steps = normalizeSteps(input?.steps);
    const isDefault = input?.isDefault === true;
    const isActive = input?.isActive !== false;
    if (isDefault && !isActive) throw new CorrespondenceValidationError('Quy trình mặc định phải đang dùng.');
    const existing = id ? (await this.store.workflows(actor.tenantId)).find((item) => item.id === id) : undefined;
    if (id && !existing) throw new CorrespondenceValidationError('Quy trình không còn, tải lại trang.');
    if (existing && existing.direction !== direction) {
      throw new CorrespondenceValidationError('Không đổi được luồng của quy trình đã có; tạo quy trình mới cho luồng kia.');
    }
    if (existing?.isDefault && !isDefault) {
      throw new CorrespondenceValidationError('Đặt một quy trình khác làm mặc định trước khi bỏ cờ mặc định của quy trình này.');
    }
    return this.store.saveWorkflow(actor.tenantId, actor.userId, id, {
      name: requireText(input?.name, 'Tên quy trình', 160),
      description: optionalText(input?.description, 'Mô tả', 2000) ?? null,
      direction,
      isActive,
      isDefault,
      steps,
    });
  }

  async deleteWorkflow(actor: CorrespondenceActor, id: string): Promise<void> {
    this.requireConfigure(actor);
    const workflow = (await this.store.workflows(actor.tenantId)).find((item) => item.id === id);
    if (workflow?.isDefault) throw new CorrespondenceValidationError('Không xoá được quy trình mặc định; chọn quy trình mặc định khác trước.');
    if (!(await this.store.deleteWorkflow(actor.tenantId, id))) {
      throw new CorrespondenceValidationError('Quy trình đang gắn với loại văn bản hay công văn nên không xoá được; hãy ngừng dùng.');
    }
  }

  /* ================================================================ nội bộ */

  private requireConfigure(actor: CorrespondenceActor): void {
    if (!actor.canConfigure && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền cấu hình văn thư.');
  }

  /** Khoá công văn, kiểm người xem thấy được, rồi chạy `work`. */
  private async inLetter<T>(
    actor: CorrespondenceActor,
    letterId: string,
    work: (tx: LetterTransaction, letterFacts: LetterFacts) => Promise<T>,
  ): Promise<T> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    return this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const letterFacts = facts(txRow(tx), catalog);
      if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();
      return work(tx, letterFacts);
    });
  }

  /**
   * Như `inLetter`, thêm kiểm thao tác được phép ở bước vừa khoá. Có quyền ở bước khác thì là
   * xung đột (người khác vừa chuyển bước), không thì là không có quyền.
   */
  private async transition<T>(
    actor: CorrespondenceActor,
    letterId: string,
    allowed: (actions: ReturnType<typeof letterActions>) => boolean,
    work: (tx: LetterTransaction) => Promise<T>,
  ): Promise<T> {
    const viewer = await this.viewer(actor);
    return this.inLetter(actor, letterId, async (tx, letterFacts) => {
      if (!allowed(letterActions(viewer, letterFacts))) {
        const elsewhere = LETTER_STAGES.some(
          (stage) => stage !== letterFacts.stage && allowed(letterActions(viewer, { ...letterFacts, stage })),
        );
        // Người đã được giao một bước duyệt vừa chuyển đi (người khác cùng bước đã duyệt).
        const stepMoved = letterFacts.steps.some(
          (step) => step.status !== 'active' && (step.actedBy === viewer.userId || step.assigneeUserIds.includes(viewer.userId)),
        );
        if (elsewhere || stepMoved) throw new LetterStageConflictError();
        throw new CorrespondenceForbiddenError();
      }
      return work(tx);
    });
  }

  /**
   * Người có thẩm quyền ở bước duyệt cuối đã làm: giải lại luật của bước theo sơ đồ tổ chức hiện
   * tại (người giữ chức vụ đó bây giờ); không giải được thì người đã duyệt bước đó.
   */
  private async finalApprovers(actor: CorrespondenceActor, tx: LetterTransaction): Promise<string[]> {
    const last = [...tx.steps].filter((step) => step.status === 'done').sort((left, right) => right.seq - left.seq)[0];
    if (!last) return [];
    const pick = last.chosenUserId ?? (last.approver.type === 'choose' ? last.actedBy : undefined);
    const resolved = await this.approverContext(actor.tenantId, tx.letter, tx.assignments, pick)
      .then((context) => resolveAssignees(last.approver, context))
      .catch(() => [] as string[]);
    if (resolved.length > 0) return [...new Set(resolved)];
    return last.actedBy ? [last.actedBy] : [...new Set(last.assigneeUserIds)];
  }

  /** Bước duyệt đầu tiên; quy trình không có bước nào thì xong duyệt ngay. */
  private async startApprovals(actor: CorrespondenceActor, tx: LetterTransaction, chosen: string | undefined): Promise<void> {
    const first = nextWaiting(tx, 0);
    if (first) await this.activate(actor, tx, first, chosen);
    else await this.finishApprovals(actor, tx);
  }

  /** Duyệt xong: công văn đến chờ văn thư hoàn tất, công văn đi chờ văn thư ban hành. */
  private async finishApprovals(actor: CorrespondenceActor, tx: LetterTransaction): Promise<void> {
    const incoming = tx.letter.direction === 'incoming';
    const clerks = await this.clerkTargets(actor.tenantId, incoming ? ROUTE_PERMISSIONS.archive : ROUTE_PERMISSIONS.publish);
    const letter = await tx.update({ stage: incoming ? 'closing' : 'publishing' });
    const owner = incoming ? [letter.receivedBy] : letter.authorUserId ? [letter.authorUserId] : [];
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.approved, letter, actor, [...owner, ...clerks.recipients], {
        summary: incoming
          ? `Công văn ${letterTitle(withNo(letter))} đã xử lý, duyệt xong; chờ văn thư hoàn tất, lưu trữ.`
          : `Công văn đi ${letterTitle(withNo(letter))} đã duyệt xong; chờ văn thư đánh số, ban hành.`,
        notifyPermissions: clerks.notifyPermissions,
      }),
    );
  }

  /**
   * Bắt đầu một bước duyệt: giải người được giao theo sơ đồ tổ chức (luật `choose` cần người
   * đã chọn), báo người được giao (trừ khi nơi gọi đã báo qua sự kiện khác).
   */
  private async activate(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    step: StepRecord,
    chosen: string | undefined,
    options: { readonly notify?: boolean } = {},
  ): Promise<void> {
    const pick = step.chosenUserId ?? chosen;
    if (step.approver.type === 'choose' && !pick) throw new CorrespondenceValidationError(`Chọn người cho bước "${step.name}".`);
    const context = await this.approverContext(actor.tenantId, tx.letter, tx.assignments, pick);
    const assignees = resolveAssignees(step.approver, context);
    if (assignees.length === 0) {
      throw new CorrespondenceValidationError(
        step.approver.type === 'choose'
          ? `Người được chọn không thuộc nhóm của bước "${step.name}".`
          : `Bước "${step.name}" chưa xác định được người duyệt theo sơ đồ tổ chức. Kiểm cấu hình quy trình hoặc sơ đồ tổ chức.`,
      );
    }
    await tx.updateStep(step.id, {
      status: 'active',
      activate: true,
      assigneeUserIds: assignees,
      chosenUserId: pick ?? null,
      actedBy: null,
      decision: null,
      note: null,
    });
    const letter = await tx.update({ stage: 'reviewing' });
    if (options.notify === false) return;
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.stepAssigned, letter, actor, assignees, {
        summary: `${step.name}: ${letter.direction === 'incoming' ? 'công văn đến' : 'công văn đi'} ${letterTitle(withNo(letter))}.${dueText(letter.dueOn)}`,
        stepName: step.name,
      }),
    );
  }

  /** Người được chọn trước cho bước duyệt đầu (luật `choose`), kiểm thuộc nhóm. */
  private async preselect(tenantId: string, tx: LetterTransaction, chosen: string | undefined, handlingUnitIds: readonly string[]): Promise<void> {
    const first = nextWaiting(tx, 0);
    if (!first || first.approver.type !== 'choose') return;
    if (!chosen) throw new CorrespondenceValidationError(`Chọn người cho bước "${first.name}".`);
    const context = await this.approverContext(tenantId, tx.letter, handlingUnitIds.map((unitId) => ({ unitId })), chosen);
    if (!chooseCandidates(first.approver, context).some((candidate) => candidate.userId === chosen)) {
      throw new CorrespondenceValidationError(`Người được chọn không thuộc nhóm của bước "${first.name}".`);
    }
    await tx.updateStep(first.id, { chosenUserId: chosen });
  }

  /** Mọi bước duyệt về chưa tới (giữ người đã chọn) để chạy lại từ đầu. */
  private async resetSteps(tx: LetterTransaction): Promise<void> {
    for (const step of tx.steps.filter((item) => item.status !== 'waiting' || item.assigneeUserIds.length > 0)) {
      await tx.updateStep(step.id, { status: 'waiting', assigneeUserIds: [] });
    }
  }

  private async archiveCode(tx: LetterTransaction, settings: CorrespondenceSettings, on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return formatArchiveCode(settings.archivePrefix, year, await tx.nextNumber('archive', year));
  }

  /** Ghi số lưu trữ lên thư mục hồ sơ bên Hệ dùng chung; không được thì hồ sơ vẫn đã lưu. */
  private async recordArchive(actor: CorrespondenceActor, letter: LetterRecord): Promise<void> {
    if (!letter.sharedFolderId || !letter.archiveCode) return;
    try {
      await this.files.updateFolder(actor.tenantId, letter.sharedFolderId, {
        docKind: 'official_letter',
        docNumber: letter.archiveCode,
        partner: letter.direction === 'outgoing' ? letter.recipient : letter.senderOrg,
        issuedOn: letter.publishedOn ?? letter.senderDate ?? letter.receivedOn,
        note: archiveNote(letter),
      });
    } catch (error) {
      this.logger.warn(`Không ghi được số lưu trữ ${letter.archiveCode} lên thư mục hồ sơ: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async approverContext(
    tenantId: string,
    letter: Pick<LetterRecord, 'direction' | 'authorUnitId'>,
    assignments: readonly Pick<AssignmentRecord, 'unitId'>[],
    chosenUserId?: string,
  ): Promise<ApproverContext> {
    const [organization, leaders] = await Promise.all([this.organization.snapshot(tenantId), this.store.leaders(tenantId)]);
    return { organization, leaders, handlingUnitIds: handlingUnits(letter, assignments), chosenUserId };
  }

  /** Quy trình theo cấu hình: được chỉ định, của loại văn bản, hay mặc định của luồng; phải đang dùng và đúng luồng. */
  private async pickWorkflow(tenantId: string, letter: Pick<LetterRecord, 'direction' | 'kind'>, workflowId?: string): Promise<Workflow> {
    const [workflows, catalog] = await Promise.all([this.store.workflows(tenantId), this.catalogMap(tenantId)]);
    const type = catalog.get('letter_type')?.get(letter.kind);
    const typeWorkflow = letter.direction === 'incoming' ? type?.workflowId : type?.outgoingWorkflowId;
    const usable = workflows.filter((item) => item.isActive && item.direction === letter.direction);
    const requested = typeof workflowId === 'string' ? workflowId.trim() : '';
    const wanted =
      requested || (usable.some((item) => item.id === typeWorkflow) ? typeWorkflow : undefined) || usable.find((item) => item.isDefault)?.id;
    const workflow = usable.find((item) => item.id === wanted);
    if (!workflow) {
      throw new CorrespondenceValidationError(
        `Chưa có quy trình duyệt đang dùng cho ${letter.direction === 'incoming' ? 'công văn đến' : 'công văn đi'}. Vào Cấu hình để đặt quy trình mặc định.`,
      );
    }
    return workflow;
  }

  /** Phòng ban khi giao: có trong sơ đồ, người xử lý thuộc phòng; người nhận thông báo theo cách giao. */
  private dispatchUnits(snapshot: OrganizationSnapshot, settings: CorrespondenceSettings, raw: unknown) {
    const seen = new Set<string>();
    const entries = (Array.isArray(raw) ? raw : [])
      .map((entry) => (entry ?? {}) as { unitId?: unknown; handlerUserId?: unknown })
      .filter((entry) => {
        const id = String(entry.unitId ?? '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    if (entries.length === 0) throw new CorrespondenceValidationError('Chọn ít nhất một phòng ban xử lý.');
    if (entries.length > MAX_UNITS_PER_LETTER) throw new CorrespondenceValidationError(`Một công văn giao tối đa ${MAX_UNITS_PER_LETTER} phòng ban.`);
    return entries.map((entry) => {
      const unitId = String(entry.unitId).trim();
      const node = snapshot.nodes.find((item) => item.id === unitId && item.kind === 'unit');
      if (!node) {
        throw new CorrespondenceValidationError(
          snapshot.degraded
            ? 'Chưa đọc được sơ đồ tổ chức để kiểm phòng ban, thử lại sau ít phút.'
            : 'Phòng ban được chọn không còn trong sơ đồ tổ chức. Tải lại và chọn lại.',
        );
      }
      const members = unitMembers(snapshot, unitId);
      const handlerUserId = entry.handlerUserId ? String(entry.handlerUserId) : undefined;
      const handler = handlerUserId ? members.find((member) => member.userId === handlerUserId) : undefined;
      if (handlerUserId && !handler) throw new CorrespondenceValidationError(`Người xử lý được chọn không thuộc ${node.name}.`);
      if (!handler && settings.dispatchMode === 'handler') {
        throw new CorrespondenceValidationError(`Chọn người xử lý cho ${node.name} (cấu hình yêu cầu chọn một người xử lý cho mỗi phòng).`);
      }
      if (!handler && members.length === 0) {
        throw new CorrespondenceValidationError(`${node.name} chưa có nhân sự nào trong sơ đồ tổ chức để nhận công văn.`);
      }
      return {
        unitId,
        unitName: node.name,
        handlerUserId: handler?.userId,
        handlerName: handler?.name,
        recipients: handler ? [handler.userId] : members.map((member) => member.userId),
      };
    });
  }

  private classification(
    catalog: Catalog,
    input: { readonly kind?: unknown; readonly urgency?: unknown; readonly confidentiality?: unknown } | undefined,
    required = false,
  ) {
    const kind = this.catalogCode(catalog, 'letter_type', input?.kind, 'Loại văn bản');
    const urgency = this.catalogCode(catalog, 'urgency', input?.urgency, 'Độ khẩn');
    if (required && (!kind || !urgency)) throw new CorrespondenceValidationError('Chọn loại văn bản và độ khẩn.');
    return {
      kind: kind ?? firstActive(catalog, 'letter_type'),
      urgency: urgency ?? firstActive(catalog, 'urgency'),
      confidentiality: this.catalogCode(catalog, 'confidentiality', input?.confidentiality, 'Độ mật') ?? firstActive(catalog, 'confidentiality'),
    };
  }

  private async loadRow(tenantId: string, letterId: string): Promise<Loaded> {
    const letter = await this.store.findLetter(tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [steps, assignments, comments] = await Promise.all([
      this.store.steps(tenantId, letterId),
      this.store.assignments(tenantId, letterId),
      this.store.comments(tenantId, letterId),
    ]);
    return {
      letter,
      steps,
      assignments,
      row: { ...letter, steps, assignments, mentionedUserIds: comments.flatMap((item) => item.mentionedUserIds) },
    };
  }

  private async visibleAttachment(actor: CorrespondenceActor, letterId: string, attachmentId: string): Promise<AttachmentRecord> {
    const viewer = await this.viewer(actor);
    const [{ row }, attachment, catalog] = await Promise.all([
      this.loadRow(actor.tenantId, letterId),
      this.store.findAttachment(actor.tenantId, attachmentId),
      this.catalogMap(actor.tenantId),
    ]);
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
    return attachment;
  }

  /** Cấu hình sổ; phân hệ chưa khởi tạo xong thì cấu hình mặc định. */
  private settingsOrDefault(tenantId: string): Promise<CorrespondenceSettings> {
    return this.store
      .settings(tenantId)
      .then((settings) => ({ ...settings, clerkUserIds: Array.isArray(settings.clerkUserIds) ? settings.clerkUserIds : [] }))
      .catch(() => DEFAULT_CORRESPONDENCE_SETTINGS);
  }

  /**
   * Người được chỉ định làm văn thư trong cấu hình làm được việc của văn thư trong phân hệ
   * (tiếp nhận, soạn, kiểm tra, ban hành, lưu trữ, xem công văn không mật) dù chưa được cấp
   * quyền đó trong Phân quyền. Người cấu hình văn thư mới đặt được danh sách này.
   */
  private async effective(actor: CorrespondenceActor, known?: CorrespondenceSettings): Promise<CorrespondenceActor> {
    const settings = known ?? (await this.settingsOrDefault(actor.tenantId));
    if (!settings.clerkUserIds.includes(actor.userId)) return actor;
    return { ...actor, canRegister: true, canCreateOutgoing: true, canPublish: true, canArchive: true, canReadAll: true };
  }

  /** Báo việc của văn thư: người làm văn thư được chỉ định, chưa chỉ định thì mọi người giữ quyền. */
  private async clerkTargets(tenantId: string, permission: string): Promise<{ recipients: string[]; notifyPermissions: string[] }> {
    const settings = await this.settingsOrDefault(tenantId);
    return settings.clerkUserIds.length > 0
      ? { recipients: [...settings.clerkUserIds], notifyPermissions: [] }
      : { recipients: [], notifyPermissions: [permission] };
  }

  private async viewer(original: CorrespondenceActor): Promise<LetterViewer> {
    const [snapshot, settings] = await Promise.all([this.organization.snapshot(original.tenantId), this.settingsOrDefault(original.tenantId)]);
    const actor = await this.effective(original, settings);
    const admin = actor.isTenantAdmin;
    return {
      userId: actor.userId,
      isTenantAdmin: admin,
      canRegister: actor.canRegister || admin,
      canCreateOutgoing: actor.canCreateOutgoing || admin,
      canPublish: actor.canPublish || admin,
      canArchive: actor.canArchive || admin,
      canReadAll: actor.canReadAll || admin,
      canReadConfidential: actor.canReadConfidential || admin,
      unitIds: membershipNodes(snapshot, actor.userId),
      headUnitIds: headedUnits(snapshot, actor.userId),
      clerkOnDuty: settings.clerkUserIds.length === 0 || settings.clerkUserIds.includes(actor.userId),
    };
  }

  private visibility(viewer: LetterViewer) {
    if (viewer.isTenantAdmin || (viewer.canReadAll && viewer.canReadConfidential)) return undefined;
    return { userId: viewer.userId, unitIds: [...viewer.unitIds], readAll: viewer.canReadAll, readConfidential: viewer.canReadConfidential };
  }

  private async catalogMap(tenantId: string): Promise<Catalog> {
    const map = new Map<CatalogKind, Map<string, CatalogItem>>();
    for (const item of await this.store.catalog(tenantId)) {
      if (!map.has(item.kind)) map.set(item.kind, new Map());
      map.get(item.kind)?.set(item.code, item);
    }
    return map;
  }

  private catalogCode(catalog: Catalog, kind: CatalogKind, value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const code = String(value);
    const item = catalog.get(kind)?.get(code);
    if (!item || !item.isActive) throw new CorrespondenceValidationError(`${label} "${code.slice(0, 40)}" không có hoặc đã ngừng dùng.`);
    return code;
  }

  private async summaries(actor: CorrespondenceActor, viewer: LetterViewer, catalog: Catalog, rows: readonly Row[]): Promise<LetterSummary[]> {
    const names = await this.store.userNames(
      actor.tenantId,
      rows.flatMap((row) => [
        row.receivedBy,
        ...(row.authorUserId ? [row.authorUserId] : []),
        ...(row.steps.find((step) => step.status === 'active')?.assigneeUserIds ?? []),
      ]),
    );
    return rows.map((row) => summaryOf(row, catalog, viewer, names));
  }

  private event(
    type: string,
    letter: LetterRecord,
    actor: CorrespondenceActor,
    recipientUserIds: readonly string[],
    extra: Readonly<Record<string, unknown>> & { readonly summary: string },
  ): OutboxEvent {
    return {
      type,
      payload: {
        letterId: letter.id,
        direction: letter.direction,
        number: displayNo(letter),
        subject: letter.subject,
        dueOn: letter.dueOn ?? null,
        stage: letter.stage,
        recipientUserIds: [...new Set(recipientUserIds)].filter((id) => id !== actor.userId),
        notifyPermissions: [],
        actorUserId: actor.userId,
        actorName: actor.displayName,
        deepLink: letterDeepLink(letter.id),
        ...extra,
      },
    };
  }
}

/* ---------------------------------------------------------------- hàm thuần */

interface FlowStep {
  readonly seq: number;
  readonly name: string;
  readonly approver: ApproverRule;
  readonly status: LetterStepStatus;
  readonly assigneeUserIds: readonly string[];
  readonly chosenUserId?: string;
  readonly actedBy?: string;
  readonly actedAt?: string;
}

function txRow(tx: LetterTransaction): Row {
  return { ...tx.letter, steps: tx.steps, assignments: tx.assignments, mentionedUserIds: tx.mentionedUserIds };
}

function facts(row: Row, catalog: Catalog): LetterFacts {
  return {
    direction: row.direction,
    stage: row.stage,
    receivedBy: row.receivedBy,
    authorUserId: row.authorUserId,
    authorUnitId: row.authorUnitId,
    restricted: Boolean(catalog.get('confidentiality')?.get(row.confidentiality)?.restricted),
    steps: row.steps,
    assignments: row.assignments,
    mentionedUserIds: row.mentionedUserIds,
    revokeRequestedBy: row.revokeRequestedBy,
    revokeApproverIds: row.revokeApproverIds ?? [],
  };
}

/** Phòng ban xử lý (công văn đến) hay phòng ban soạn thảo (công văn đi): dùng cho luật "trưởng phòng ban xử lý". */
function handlingUnits(letter: Pick<LetterRecord, 'direction' | 'authorUnitId'>, assignments: readonly Pick<AssignmentRecord, 'unitId'>[]): string[] {
  if (letter.direction === 'incoming') return assignments.map((item) => item.unitId);
  return letter.authorUnitId ? [letter.authorUnitId] : [];
}

/**
 * Tệp được thêm theo loại ở bước hiện tại; kết quả xử lý của công văn đến phải gắn với một
 * phòng ban người đó gửi kết quả được.
 */
function attachTarget(
  viewer: LetterViewer,
  letterFacts: LetterFacts,
  assignments: readonly AssignmentRecord[],
  kind: AttachmentKind,
  assignmentId: string | undefined,
): AssignmentRecord | undefined {
  if (!letterActions(viewer, letterFacts).attachKinds.includes(kind)) {
    throw new CorrespondenceForbiddenError(`Bạn không đính kèm được ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()} ở bước này.`);
  }
  if (kind !== 'draft' || letterFacts.direction === 'outgoing') return undefined;
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment || !canRespondFor(viewer, letterFacts, assignment)) {
    throw new CorrespondenceValidationError('Chọn phòng ban gửi kết quả trong số phòng ban bạn xử lý.');
  }
  return assignment;
}

/** Tải phiên bản mới: như quyền đính kèm loại tệp đó ở bước hiện tại. */
function canAddVersion(
  viewer: LetterViewer,
  letterFacts: LetterFacts,
  attachment: Pick<AttachmentRecord, 'kind' | 'assignmentId'>,
  assignment: AssignmentRecord | undefined,
): boolean {
  if (!letterActions(viewer, letterFacts).attachKinds.includes(attachment.kind)) return false;
  if (attachment.kind !== 'draft' || letterFacts.direction === 'outgoing') return true;
  return Boolean(assignment && canRespondFor(viewer, letterFacts, assignment));
}

function requireActive(tx: LetterTransaction): StepRecord {
  const step = tx.steps.find((item) => item.status === 'active');
  if (!step) throw new LetterStageConflictError();
  return step;
}

function sortedSteps<T extends { readonly seq: number }>(steps: readonly T[]): T[] {
  return [...steps].sort((left, right) => left.seq - right.seq);
}

function nextWaiting(tx: LetterTransaction, fromSeq: number): StepRecord | undefined {
  return sortedSteps(tx.steps).find((step) => step.seq > fromSeq && step.status === 'waiting');
}

/** Bước duyệt đã xong ngay trước `seq` (không có `seq` thì bước xong cuối cùng). */
function lastDoneBefore(tx: LetterTransaction, seq: number | undefined): StepRecord | undefined {
  return sortedSteps(tx.steps)
    .filter((step) => step.status === 'done' && (seq === undefined || step.seq < seq))
    .at(-1);
}

function firstActive(catalog: Catalog, kind: CatalogKind): string {
  const item = [...(catalog.get(kind)?.values() ?? [])].filter((entry) => entry.isActive).sort((left, right) => left.sortOrder - right.sortOrder)[0];
  if (!item) throw new CorrespondenceValidationError('Danh mục chưa có mục nào đang dùng. Vào Cấu hình để thêm.');
  return item.code;
}

function defaultDue(catalog: Catalog, settings: CorrespondenceSettings, kind: string, from: string): string | undefined {
  const days = catalog.get('letter_type')?.get(kind)?.defaultDueDays ?? settings.defaultDueDays;
  return days > 0 ? addDays(from, days) : undefined;
}

/** Phòng ban trực tiếp của người dùng (đơn vị được bổ nhiệm, hay đơn vị cha của chức danh). */
export function ownUnits(snapshot: OrganizationSnapshot, userId: string): string[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const units: string[] = [];
  for (const member of snapshot.members) {
    if (member.userId !== userId) continue;
    const node = byId.get(member.nodeId);
    const unitId = node?.kind === 'unit' ? node.id : node?.parentId;
    if (unitId && byId.get(unitId)?.kind === 'unit' && !units.includes(unitId)) units.push(unitId);
  }
  return units;
}

function displayNo(letter: Pick<LetterRecord, 'direction' | 'incomingNo' | 'outgoingNo'>): string {
  return letter.direction === 'outgoing' ? (letter.outgoingNo ?? letter.incomingNo) : letter.incomingNo;
}

function withNo(letter: LetterRecord): LetterRecord & { readonly displayNo: string } {
  return { ...letter, displayNo: displayNo(letter) };
}

/** Người sẽ làm bước duyệt chưa tới: tên người theo sơ đồ tổ chức, không giải được thì mô tả luật. */
function peopleLabel(
  userIds: readonly string[],
  nameOf: (userId: string) => string,
  rule: ApproverRule,
  direction: LetterDirection,
): string {
  if (userIds.length > 0) return userIds.map(nameOf).join(', ');
  if (rule.type === 'choose') return rule.pool === 'leaders' ? 'Lãnh đạo được chọn khi trình' : 'Người được chọn khi trình';
  if (rule.type === 'handling_unit_heads') return direction === 'incoming' ? 'Trưởng phòng ban xử lý' : 'Trưởng phòng soạn thảo';
  return APPROVER_RULE_LABELS[rule.type];
}

/** Người, thời điểm ở các bước cố định của luồng; bước của văn thư chưa làm thì ghi người làm văn thư được chỉ định. */
function fixedPeople(
  letter: LetterRecord,
  assignments: readonly AssignmentRecord[],
  nameOf: (userId: string) => string,
  history: readonly Pick<LetterHistoryEntry, 'action' | 'actorUserId' | 'at'>[] = [],
  clerkUserIds: readonly string[] = [],
): Partial<Record<LetterStage, { readonly people?: string; readonly at?: string }>> {
  const submitted = assignments.filter((item) => item.status === 'submitted').map((item) => item.submittedAt ?? '');
  const allSubmitted = assignments.length > 0 && submitted.length === assignments.length;
  const clerks = clerkUserIds.map(nameOf).join(', ') || undefined;
  const lastBy = (action: LetterHistoryEntry['action']) => [...history].reverse().find((item) => item.action === action);
  const doneBy = (action: LetterHistoryEntry['action'], extra?: string) => {
    const entry = lastBy(action);
    return {
      people: [entry?.actorUserId ? nameOf(entry.actorUserId) : undefined, extra].filter(Boolean).join(' · ') || undefined,
      at: entry?.at,
    };
  };
  const archived = letter.stage === 'archived';
  const checked = lastBy('submit');
  return {
    received: { people: nameOf(letter.receivedBy), at: letter.createdAt },
    processing: {
      people: assignments.map((item) => (item.handlerUserId ? `${item.unitName} (${nameOf(item.handlerUserId)})` : item.unitName)).join(', ') || undefined,
      at: allSubmitted ? submitted.sort().at(-1) : undefined,
    },
    drafting: {
      people: [letter.authorUserId ? nameOf(letter.authorUserId) : undefined, letter.authorUnitName].filter(Boolean).join(' · ') || undefined,
      at: letter.createdAt,
    },
    checking: checked && letter.stage !== 'checking' ? doneBy('submit') : { people: clerks },
    closing: archived ? doneBy('complete', letter.archiveCode ? `Hồ sơ ${letter.archiveCode}` : undefined) : { people: clerks },
    publishing: archived
      ? doneBy('publish', [letter.outgoingNo ? `Số ${letter.outgoingNo}` : undefined, letter.archiveCode ? `Hồ sơ ${letter.archiveCode}` : undefined].filter(Boolean).join(', '))
      : { people: clerks },
  };
}

/** Ô "Xác nhận huỷ" khi công văn đã ban hành / hoàn tất được đề nghị huỷ. */
function revokeNode(
  letter: LetterRecord,
  history: readonly Pick<LetterHistoryEntry, 'action' | 'actorUserId' | 'at'>[],
  nameOf: (userId: string) => string,
): { readonly label: string; readonly people?: string; readonly at?: string } | undefined {
  if (!letter.revokeKind) return undefined;
  const label = letter.revokeKind === 'recall' ? 'Xác nhận thu hồi, huỷ' : 'Xác nhận huỷ để sửa đổi';
  if (letter.stage === 'cancelled') {
    const decided = [...history].reverse().find((item) => item.action === 'revoke-approve' || item.action === 'cancel');
    return { label, people: decided?.actorUserId ? nameOf(decided.actorUserId) : undefined, at: decided?.at };
  }
  return { label, people: (letter.revokeApproverIds ?? []).map(nameOf).join(', ') || undefined };
}

/**
 * Thanh tiến trình theo luồng, các bước duyệt của quy trình chen giữa; trạng thái từng ô theo
 * bước hiện tại của công văn. Bước cuối là một bước của văn thư (hoàn tất hay ban hành, rồi
 * lưu trữ luôn), không tách ô lưu trữ riêng.
 */
export function flowOf(
  direction: LetterDirection,
  stage: LetterStage,
  steps: readonly { readonly seq: number; readonly name: string; readonly status: LetterStepStatus; readonly people?: string; readonly at?: string }[],
  fixed: Partial<Record<LetterStage, { readonly people?: string; readonly at?: string }>> = {},
  revoke?: { readonly label: string; readonly people?: string; readonly at?: string },
): FlowNode[] {
  const ordered = sortedSteps(steps);
  const stageNode = (key: LetterStage, label: string): FlowNode => ({ key, label, state: 'todo', approval: false, ...fixed[key] });
  const approvals: FlowNode[] = ordered.map((step) => ({
    key: `step-${step.seq}`,
    label: step.name,
    state: 'todo',
    approval: true,
    people: step.people,
    at: step.at,
  }));
  const nodes: FlowNode[] =
    direction === 'incoming'
      ? [
          stageNode('received', 'Văn thư tiếp nhận'),
          stageNode('processing', 'Phòng ban xử lý'),
          ...approvals,
          stageNode('closing', 'Văn thư hoàn tất, lưu trữ'),
        ]
      : [
          stageNode('drafting', 'Phòng ban soạn thảo'),
          stageNode('checking', 'Văn thư kiểm tra'),
          ...approvals,
          stageNode('publishing', 'Văn thư ban hành, lưu trữ'),
        ];
  if (stage === 'archived') return nodes.map((node) => ({ ...node, state: 'done' }));
  // Công văn đã ban hành / hoàn tất rồi mới đề nghị huỷ: luồng cũ đã xong, thêm ô xác nhận huỷ.
  if (revoke && (stage === 'revoking' || stage === 'cancelled')) {
    return [
      ...nodes.map((node) => ({ ...node, state: 'done' as const })),
      {
        key: 'revoke',
        label: revoke.label,
        state: stage === 'revoking' ? 'current' : 'done',
        approval: true,
        people: revoke.people,
        at: stage === 'cancelled' ? revoke.at : undefined,
      },
    ];
  }
  if (stage === 'cancelled') {
    const done = new Set(ordered.filter((step) => step.status === 'done').map((step) => `step-${step.seq}`));
    return nodes.map((node, index) => ({ ...node, state: index === 0 || done.has(node.key) ? 'done' : 'todo' }));
  }
  const active = ordered.find((step) => step.status === 'active');
  const key = stage === 'reviewing' ? (active ? `step-${active.seq}` : undefined) : stage;
  const current = Math.max(
    0,
    nodes.findIndex((node) => node.key === key),
  );
  return nodes.map((node, index) => ({
    ...node,
    state: index < current ? 'done' : index === current ? 'current' : 'todo',
    // Ô chưa tới không ghi thời điểm (bước bị trả về còn giữ lúc xong cũ).
    at: index < current ? node.at : undefined,
  }));
}

function summaryOf(row: Row, catalog: Catalog, viewer: LetterViewer, names: ReadonlyMap<string, string>): LetterSummary {
  const item = (kind: CatalogKind, code: string) => catalog.get(kind)?.get(code);
  const active = row.steps.find((step) => step.status === 'active');
  return {
    id: row.id,
    direction: row.direction,
    displayNo: displayNo(row),
    incomingNo: row.incomingNo,
    receivedOn: row.receivedOn,
    senderOrg: row.senderOrg,
    senderRef: row.senderRef,
    senderDate: row.senderDate,
    subject: row.subject,
    kind: row.kind,
    kindName: item('letter_type', row.kind)?.name ?? row.kind,
    urgency: row.urgency,
    urgencyName: item('urgency', row.urgency)?.name ?? row.urgency,
    urgencyHighlight: Boolean(item('urgency', row.urgency)?.highlight),
    confidentiality: row.confidentiality,
    confidentialityName: item('confidentiality', row.confidentiality)?.name ?? row.confidentiality,
    restricted: Boolean(item('confidentiality', row.confidentiality)?.restricted),
    dueOn: row.dueOn,
    stage: row.stage,
    stageLabel: row.stage === 'reviewing' && active ? active.name : (LETTER_STAGE_LABELS[row.stage] ?? row.stage),
    currentStepName: active?.name,
    currentAssigneeNames: (active?.assigneeUserIds ?? []).map((userId) => names.get(userId) ?? 'Người dùng'),
    assignmentsDone: row.assignments.filter((assignment) => assignment.status === 'submitted').length,
    assignmentsTotal: row.assignments.length,
    authorUserId: row.authorUserId,
    authorName: row.authorUserId ? names.get(row.authorUserId) : undefined,
    authorUnitName: row.authorUnitName,
    outgoingNo: row.outgoingNo,
    publishedOn: row.publishedOn,
    recipient: row.recipient,
    deliveryStatus: row.deliveryStatus,
    archiveCode: row.archiveCode,
    archivedOn: row.archivedOn,
    receivedBy: row.receivedBy,
    receivedByName: names.get(row.receivedBy),
    updatedAt: row.updatedAt,
    awaitingMe: awaitsViewer(viewer, facts(row, catalog)),
  };
}

function attachmentView(
  attachment: AttachmentRecord,
  names: ReadonlyMap<string, string>,
  can: { readonly canDelete: boolean; readonly canVersion: boolean },
): LetterAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    assignmentId: attachment.assignmentId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    versionNo: attachment.versionNo,
    uploadedBy: attachment.uploadedBy,
    uploadedByName: names.get(attachment.uploadedBy),
    createdAt: attachment.createdAt,
    canDelete: can.canDelete,
    canVersion: can.canVersion,
  };
}

/** Người đã tham gia: người tiếp nhận, người soạn, người duyệt, người phòng ban gửi kết quả hay được phân công. */
/** So tên danh mục không phân biệt hoa thường, dấu cách. */
function foldName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

/** Mã danh mục sinh từ tên: bỏ dấu tiếng Việt, chữ thường, gạch ngang; "Chỉ đạo - điều hành" thành "chi-dao-dieu-hanh". */
export function catalogCode(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return code || 'muc';
}

/** Xoá dấu đề nghị huỷ khi công văn về lại đã lưu trữ. */
const CLEARED_REVOKE = {
  revokeKind: undefined,
  revokeReason: undefined,
  revokeRequestedBy: undefined,
  revokeRequestedAt: undefined,
  revokeApproverIds: [] as readonly string[],
} as const;

function participants(tx: LetterTransaction): string[] {
  return [
    tx.letter.receivedBy,
    ...(tx.letter.authorUserId ? [tx.letter.authorUserId] : []),
    ...tx.steps.flatMap((step) => [step.actedBy, ...(step.status === 'done' ? step.assigneeUserIds : [])]),
    ...tx.assignments.flatMap((item) => [item.submittedBy, item.handlerUserId]),
  ].filter((id): id is string => Boolean(id));
}

function archiveNote(letter: LetterRecord): string {
  const number = letter.direction === 'incoming' ? `Số đến ${letter.incomingNo}` : `Số đi ${letter.outgoingNo ?? letter.incomingNo}`;
  return [`Hồ sơ ${letter.archiveCode}`, number, `Trích yếu: ${letter.subject}`].join(' · ').slice(0, 2000);
}

function dueText(dueOn: string | undefined): string {
  return dueOn ? ` Hạn ${dueOn.split('-').reverse().join('/')}.` : '';
}

function validateUpload(input: { readonly fileName?: unknown; readonly contentType?: unknown; readonly sizeBytes?: unknown } | undefined) {
  const fileName = requireText(input?.fileName, 'Tên tệp', 255);
  const contentType = String(input?.contentType ?? '').trim() || 'application/octet-stream';
  const sizeBytes = Number(input?.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new CorrespondenceValidationError('Dung lượng tệp không hợp lệ.');
  if (sizeBytes > CORRESPONDENCE_ATTACHMENT_MAX_BYTES) {
    throw new CorrespondenceValidationError(`Tệp không được vượt quá ${Math.round(CORRESPONDENCE_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`);
  }
  return { fileName, contentType, sizeBytes: Math.round(sizeBytes) };
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) throw new CorrespondenceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) throw new CorrespondenceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  return text;
}

function requireDate(value: unknown, label: string): string {
  const date = optionalDate(value, label);
  if (!date) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  return date;
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new CorrespondenceValidationError(`${label} phải là ngày dạng YYYY-MM-DD.`);
  }
  return text;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const parsed = parseOptional(value, allowed, label);
  if (!parsed) throw new CorrespondenceValidationError(`${label} không được để trống.`);
  return parsed;
}

function parseOptional<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (!(allowed as readonly string[]).includes(text)) throw new CorrespondenceValidationError(`${label} "${text.slice(0, 40)}" không hợp lệ.`);
  return text as T;
}
