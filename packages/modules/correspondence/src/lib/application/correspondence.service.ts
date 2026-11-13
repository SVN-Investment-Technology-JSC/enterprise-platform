import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  CATALOG_CODE_PATTERN,
  CATALOG_KINDS,
  CORRESPONDENCE_ATTACHMENT_MAX_BYTES,
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  LETTER_STAGES,
  OPEN_LETTER_STAGES,
  letterDeepLink,
  letterTitle,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentKind,
  type AttachmentUploadTicket,
  type ApproveStepRequest,
  type CatalogItem,
  type CatalogKind,
  type ClassifyLetterRequest,
  type CorrespondenceConfig,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceSettings,
  type CorrespondenceStatus,
  type CreateAttachmentRequest,
  type CreateLetterRequest,
  type DirectLetterRequest,
  type FlowNode,
  type LetterActions,
  type LetterAttachment,
  type LetterDetail,
  type LetterQuery,
  type LetterStage,
  type LetterSummary,
  type NoteRequest,
  type PublishLetterRequest,
  type ReasonRequest,
  type RequestRevisionRequest,
  type RespondAssignmentRequest,
  type SaveCatalogItemRequest,
  type SaveWorkflowRequest,
  type StepChoice,
  type SubmitLetterRequest,
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
  canDeleteAttachment,
  canRespondFor,
  canViewLetter,
  dossierFolderName,
  formatArchiveCode,
  formatSequenceNo,
  letterActions,
  vietnamToday,
  type LetterFacts,
  type LetterViewer,
} from '../domain/letter-rules.js';
import { membershipNodes, nodePath, unitHeads, unitMembers } from '../domain/organization.js';
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
const MAX_UNITS_PER_LETTER = 30;
/** Tên thư mục gốc của Văn thư trong kho tài liệu của Hệ dùng chung. */
export const CORRESPONDENCE_FILING_ROOT = 'Văn thư';
const INCOMING_FOLDER = 'Công văn đến';

type Catalog = ReadonlyMap<CatalogKind, ReadonlyMap<string, CatalogItem>>;
type TransitionAction = Exclude<keyof LetterActions, 'attachKinds'>;

/**
 * Văn thư: tiếp nhận công văn đến → phân loại → trình theo quy trình duyệt do tenant cấu
 * hình (các bước xem xét, bước chỉ đạo giao phòng ban, các bước duyệt văn bản phản hồi;
 * người duyệt mỗi bước theo sơ đồ tổ chức) → cấp số, phát hành → lưu trữ.
 *
 * Mỗi thao tác chuyển bước chạy trong một transaction đã khoá dòng công văn và kiểm lại
 * luật quyền trên dữ liệu vừa khoá. Sự kiện dẫn tới thông báo ghi vào outbox cùng transaction.
 */
export class CorrespondenceService {
  private readonly logger = new Logger(CorrespondenceService.name);

  constructor(
    private readonly store: CorrespondenceStore,
    private readonly files: FileStore,
    private readonly organization: OrganizationReader,
    private readonly today: () => string = () => vietnamToday(),
  ) {}

  /* ------------------------------------------------------------ đọc */

  async status(actor: CorrespondenceActor): Promise<CorrespondenceStatus> {
    return {
      tenantId: actor.tenantId,
      userId: actor.userId,
      tablesReady: await this.store.tablesReady(actor.tenantId),
      capabilities: {
        isTenantAdmin: actor.isTenantAdmin,
        canRegister: actor.canRegister,
        canPublish: actor.canPublish,
        canArchive: actor.canArchive,
        canDirect: actor.canDirect,
        canReadAll: actor.canReadAll,
        canReadConfidential: actor.canReadConfidential,
        canConfigure: actor.canConfigure,
      },
    };
  }

  /** Cấu hình động cho giao diện: sổ, danh mục, quy trình. Ai vào được phân hệ cũng đọc được. */
  async config(actor: CorrespondenceActor): Promise<CorrespondenceConfig> {
    const tablesReady = await this.store.tablesReady(actor.tenantId);
    if (!tablesReady) return { settings: DEFAULT_CORRESPONDENCE_SETTINGS, catalog: [], workflows: [] };
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
    return { units, positions, people, leaders, degraded: snapshot.degraded };
  }

  async list(actor: CorrespondenceActor, query: LetterQuery = {}): Promise<LetterSummary[]> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const box = query.box ?? 'all';
    const stage = parseOptional(query.stage, LETTER_STAGES, 'Bước xử lý');
    const rows = await this.store.listLetters(actor.tenantId, {
      visibleTo: this.visibility(viewer),
      stages: box === 'archive' ? ['archived'] : box === 'mine' ? OPEN_LETTER_STAGES : stage ? [stage] : undefined,
      onlyPublished: box === 'outgoing',
      search: query.search?.trim() || undefined,
      limit: LIST_LIMIT,
    });
    let visible = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    if (box === 'mine') visible = visible.filter((row) => awaitsViewer(viewer, facts(row, catalog)));
    if (box === 'outgoing') {
      visible = [...visible].sort((left, right) => (right.publishedOn ?? '').localeCompare(left.publishedOn ?? ''));
    }
    return this.summaries(actor, viewer, catalog, visible);
  }

  async overview(actor: CorrespondenceActor): Promise<CorrespondenceOverview> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const visibleTo = this.visibility(viewer);
    const [rows, archived] = await Promise.all([
      this.store.listLetters(actor.tenantId, { visibleTo, stages: OPEN_LETTER_STAGES, limit: OVERVIEW_LIMIT }),
      this.store.countArchived(actor.tenantId, visibleTo),
    ]);
    const open = rows.filter((row) => canViewLetter(viewer, facts(row, catalog)));
    const today = this.today();
    const byStage: Partial<Record<LetterStage, number>> = {};
    for (const row of open) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const urgent = [...open]
      .sort((left, right) => (left.dueOn ?? '9999-12-31').localeCompare(right.dueOn ?? '9999-12-31'))
      .slice(0, 6);
    return {
      open: open.length,
      awaitingApproval: open.filter((row) => row.stage === 'reviewing' || row.stage === 'directing').length,
      overdue: open.filter((row) => row.dueOn && row.dueOn < today).length,
      archived,
      awaitingMe: open.filter((row) => awaitsViewer(viewer, facts(row, catalog))).length,
      byStage,
      urgent: await this.summaries(actor, viewer, catalog, urgent),
    };
  }

  async detail(actor: CorrespondenceActor, letterId: string): Promise<LetterDetail> {
    const viewer = await this.viewer(actor);
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [catalog, steps, assignments, attachments, history, organization] = await Promise.all([
      this.catalogMap(actor.tenantId),
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
      this.store.attachments(actor.tenantId, letterId),
      this.store.history(actor.tenantId, letterId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const row = { ...letter, steps, assignments };
    const letterFacts = facts(row, catalog);
    if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();
    const names = await this.store.userNames(actor.tenantId, [
      letter.receivedBy,
      ...steps.flatMap((step) => [...step.assigneeUserIds, step.actedBy].filter((id): id is string => Boolean(id))),
      ...assignments.map((item) => item.submittedBy).filter((id): id is string => Boolean(id)),
      ...attachments.map((item) => item.uploadedBy),
      ...history.map((item) => item.actorUserId).filter((id): id is string => Boolean(id)),
    ]);
    const byId = new Map(assignments.map((item) => [item.id, item]));
    return {
      ...summaryOf(row, catalog, viewer, names),
      workflowId: letter.workflowId,
      workflowName: letter.workflowName,
      instruction: letter.instruction,
      cancelReason: letter.cancelReason,
      sharedFolderId: letter.sharedFolderId,
      steps: steps.map((step) => ({
        id: step.id,
        seq: step.seq,
        name: step.name,
        kind: step.kind,
        approver: step.approver,
        status: step.status,
        assignees: step.assigneeUserIds.map((userId) => ({ userId, name: names.get(userId) })),
        actedBy: step.actedBy,
        actedByName: step.actedBy ? names.get(step.actedBy) : undefined,
        actedAt: step.actedAt,
        decision: step.decision,
        note: step.note,
      })),
      flow: flowOf(letter.stage, steps),
      assignments: assignments.map((item) => ({
        id: item.id,
        unitId: item.unitId,
        unitName: item.unitName,
        round: item.round,
        status: item.status,
        responseNote: item.responseNote,
        submittedBy: item.submittedBy,
        submittedByName: item.submittedBy ? names.get(item.submittedBy) : undefined,
        submittedAt: item.submittedAt,
        revisionReason: item.revisionReason,
        headNames: unitHeads(organization, item.unitId)
          .map((userId) => organization.members.find((member) => member.userId === userId)?.name)
          .filter((name): name is string => Boolean(name)),
        canRespond: canRespondFor(viewer, letter, item),
      })),
      attachments: attachments.map((item) =>
        attachmentView(
          item,
          names,
          canDeleteAttachment(viewer, letterFacts, { ...item, assignment: item.assignmentId ? byId.get(item.assignmentId) : undefined }),
        ),
      ),
      history: history.map((item) => ({
        id: item.id,
        action: item.action,
        summary: item.summary,
        note: item.note,
        actorUserId: item.actorUserId,
        actorName: item.actorUserId ? names.get(item.actorUserId) : undefined,
        at: item.at,
      })),
      actions: letterActions(viewer, letterFacts),
    };
  }

  /**
   * Ứng viên khi bước sắp bắt đầu để người thao tác chọn người duyệt: lúc trình (bước đầu
   * của `workflowId`), lúc duyệt hay chỉ đạo (bước kế tiếp). Không cần chọn thì `null`.
   */
  async stepChoice(actor: CorrespondenceActor, letterId: string, workflowId?: string): Promise<StepChoice | null> {
    const viewer = await this.viewer(actor);
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [catalog, steps, assignments] = await Promise.all([
      this.catalogMap(actor.tenantId),
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
    ]);
    if (!canViewLetter(viewer, facts({ ...letter, steps, assignments }, catalog))) throw new LetterNotFoundError();
    let target: { name: string; approver: StepRecord['approver']; chosenUserId?: string } | undefined;
    if (letter.stage === 'registered') {
      const workflow = await this.pickWorkflow(actor.tenantId, letter, workflowId);
      target = workflow.steps[0];
    } else {
      const current = steps.find((step) => step.status === 'active');
      if (current) target = steps.find((step) => step.seq > current.seq && step.status === 'waiting');
    }
    if (!target || target.approver.type !== 'choose' || ('chosenUserId' in target && target.chosenUserId)) return null;
    const context = await this.approverContext(actor.tenantId, letter, assignments);
    return { stepName: target.name, candidates: chooseCandidates(target.approver, context) };
  }

  /* ---------------------------------------------------------- văn thư */

  async create(actor: CorrespondenceActor, input: CreateLetterRequest): Promise<LetterDetail> {
    if (!actor.canRegister) throw new CorrespondenceForbiddenError('Bạn không có quyền tiếp nhận công văn đến.');
    const [settings, catalog] = await Promise.all([this.store.settings(actor.tenantId), this.catalogMap(actor.tenantId)]);
    const kind = this.catalogCode(catalog, 'letter_type', input?.kind, 'Loại văn bản') ?? firstActive(catalog, 'letter_type');
    const urgency = this.catalogCode(catalog, 'urgency', input?.urgency, 'Độ khẩn') ?? firstActive(catalog, 'urgency');
    const confidentiality =
      this.catalogCode(catalog, 'confidentiality', input?.confidentiality, 'Độ mật') ?? firstActive(catalog, 'confidentiality');
    const receivedOn = optionalDate(input?.receivedOn, 'Ngày đến') ?? this.today();
    const dueDays = catalog.get('letter_type')?.get(kind)?.defaultDueDays ?? settings.defaultDueDays;
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý') ?? (dueDays > 0 ? addDays(receivedOn, dueDays) : undefined);
    if (dueOn && dueOn < receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
    const letter = await this.store.createLetter(
      actor.tenantId,
      {
        receivedOn,
        senderOrg: requireText(input?.senderOrg, 'Cơ quan gửi', 255),
        senderRef: optionalText(input?.senderRef, 'Số, ký hiệu văn bản', 120),
        senderDate: optionalDate(input?.senderDate, 'Ngày văn bản'),
        subject: requireText(input?.subject, 'Trích yếu', 1000),
        kind,
        urgency,
        confidentiality,
        dueOn,
        receivedBy: actor.userId,
      },
      settings.incomingSuffix,
      async (tx) => {
        await tx.history({
          action: 'receive',
          summary: `Tiếp nhận, vào sổ công văn đến số ${tx.letter.incomingNo}`,
          actorUserId: actor.userId,
        });
      },
    );
    return this.detail(actor, letter.id);
  }

  async update(actor: CorrespondenceActor, letterId: string, input: UpdateLetterRequest): Promise<LetterDetail> {
    const catalog = await this.catalogMap(actor.tenantId);
    await this.transition(actor, letterId, 'edit', async (tx) => {
      const patch = input ?? {};
      const receivedOn = patch.receivedOn === undefined ? tx.letter.receivedOn : requireDate(patch.receivedOn, 'Ngày đến');
      const dueOn = patch.dueOn === undefined ? tx.letter.dueOn : optionalDate(patch.dueOn, 'Hạn xử lý');
      if (dueOn && dueOn < receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      await tx.update({
        receivedOn,
        dueOn,
        senderOrg: patch.senderOrg === undefined ? tx.letter.senderOrg : requireText(patch.senderOrg, 'Cơ quan gửi', 255),
        senderRef: patch.senderRef === undefined ? tx.letter.senderRef : optionalText(patch.senderRef, 'Số, ký hiệu văn bản', 120),
        senderDate: patch.senderDate === undefined ? tx.letter.senderDate : optionalDate(patch.senderDate, 'Ngày văn bản'),
        subject: patch.subject === undefined ? tx.letter.subject : requireText(patch.subject, 'Trích yếu', 1000),
        kind: this.catalogCode(catalog, 'letter_type', patch.kind, 'Loại văn bản') ?? tx.letter.kind,
        urgency: this.catalogCode(catalog, 'urgency', patch.urgency, 'Độ khẩn') ?? tx.letter.urgency,
        confidentiality: this.catalogCode(catalog, 'confidentiality', patch.confidentiality, 'Độ mật') ?? tx.letter.confidentiality,
      });
      await tx.history({ action: 'update', summary: 'Sửa thông tin công văn', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  async classify(actor: CorrespondenceActor, letterId: string, input: ClassifyLetterRequest): Promise<LetterDetail> {
    const catalog = await this.catalogMap(actor.tenantId);
    const kind = this.catalogCode(catalog, 'letter_type', input?.kind, 'Loại văn bản');
    const urgency = this.catalogCode(catalog, 'urgency', input?.urgency, 'Độ khẩn');
    if (!kind || !urgency) throw new CorrespondenceValidationError('Chọn loại văn bản và độ khẩn.');
    const confidentiality = this.catalogCode(catalog, 'confidentiality', input?.confidentiality, 'Độ mật');
    await this.transition(actor, letterId, 'classify', async (tx) => {
      await tx.update({ stage: 'registered', kind, urgency, confidentiality: confidentiality ?? tx.letter.confidentiality });
      await tx.history({ action: 'classify', summary: 'Phân loại, vào sổ', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  /** Trình theo quy trình: chép các bước của quy trình vào công văn rồi bắt đầu bước đầu tiên. */
  async submit(actor: CorrespondenceActor, letterId: string, input: SubmitLetterRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, current, input?.workflowId);
    const assignee = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    await this.transition(actor, letterId, 'submit', async (tx) => {
      await tx.replaceSteps(workflow.steps);
      await tx.update({ workflowId: workflow.id, workflowName: workflow.name, directorUserId: undefined });
      await tx.history({ action: 'submit', summary: `Trình theo ${workflow.name}`, note, actorUserId: actor.userId });
      const first = [...tx.steps].sort((left, right) => left.seq - right.seq)[0];
      if (!first) throw new CorrespondenceValidationError('Quy trình chưa có bước nào.');
      await this.activate(actor, tx, first, assignee);
    });
    return this.detail(actor, letterId);
  }

  async cancel(actor: CorrespondenceActor, letterId: string, input: ReasonRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Lý do huỷ', 2000);
    await this.transition(actor, letterId, 'cancel', async (tx) => {
      await tx.update({ stage: 'cancelled', cancelReason: reason });
      await tx.history({ action: 'cancel', summary: 'Huỷ công văn khỏi sổ', note: reason, actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  /* ------------------------------------------------- các bước của quy trình */

  /** Người được giao bước xem xét hay duyệt đồng ý: sang bước kế, hết bước thì chờ phát hành. */
  async approve(actor: CorrespondenceActor, letterId: string, input: ApproveStepRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến', 4000);
    const nextAssignee = optionalText(input?.nextAssigneeUserId, 'Người duyệt bước sau', 64);
    await this.transition(actor, letterId, 'approve', async (tx) => {
      const step = requireActive(tx);
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'approved', note: note ?? null });
      await tx.history({ action: 'approve', summary: `${step.name}: đồng ý`, note, actorUserId: actor.userId });
      await this.advance(actor, tx, step.seq, nextAssignee);
    });
    return this.detail(actor, letterId);
  }

  /** Trả về văn thư từ bước xem xét trước khi chỉ đạo, hoặc từ bước chỉ đạo: bỏ các bước, văn thư trình lại. */
  async returnToClerk(actor: CorrespondenceActor, letterId: string, input: ReasonRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Lý do trả lại', 2000);
    await this.transition(actor, letterId, 'returnToClerk', async (tx) => {
      const step = requireActive(tx);
      // Giữ các bước (đã trả, bỏ qua) để người trả lại vẫn xem được; văn thư trình lại thì thay bằng bước mới.
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'returned', note: reason });
      for (const rest of tx.steps.filter((item) => item.status === 'waiting')) await tx.updateStep(rest.id, { status: 'skipped' });
      const letter = await tx.update({ stage: 'registered', directorUserId: undefined });
      await tx.history({ action: 'return', summary: `${step.name}: trả lại văn thư`, note: reason, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.returned, letter, actor, [letter.receivedBy], {
          summary: `${actor.displayName} trả lại công văn ${letterTitle(letter)} ở bước "${step.name}": ${reason}`,
          reason,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async direct(actor: CorrespondenceActor, letterId: string, input: DirectLetterRequest): Promise<LetterDetail> {
    const instruction = requireText(input?.instruction, 'Ý kiến chỉ đạo', 4000);
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý');
    const nextAssignee = optionalText(input?.nextAssigneeUserId, 'Người duyệt bước sau', 64);
    const unitIds = [...new Set((Array.isArray(input?.unitIds) ? input.unitIds : []).map((id) => String(id ?? '').trim()).filter(Boolean))];
    if (unitIds.length === 0) throw new CorrespondenceValidationError('Chọn ít nhất một phòng ban để giao xử lý.');
    if (unitIds.length > MAX_UNITS_PER_LETTER) {
      throw new CorrespondenceValidationError(`Một công văn giao tối đa ${MAX_UNITS_PER_LETTER} phòng ban.`);
    }
    const snapshot = await this.organization.snapshot(actor.tenantId);
    const units = unitIds.map((unitId) => {
      const node = snapshot.nodes.find((item) => item.id === unitId && item.kind === 'unit');
      if (!node) {
        throw new CorrespondenceValidationError(
          snapshot.degraded
            ? 'Chưa đọc được sơ đồ tổ chức để kiểm phòng ban, thử lại sau ít phút.'
            : 'Phòng ban được chọn không còn trong sơ đồ tổ chức. Tải lại và chọn lại.',
        );
      }
      return { unitId: node.id, unitName: node.name };
    });
    await this.transition(actor, letterId, 'direct', async (tx) => {
      if (dueOn && dueOn < tx.letter.receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      const step = requireActive(tx);
      // Bước sau xử lý để người chỉ đạo chọn người duyệt: chọn ngay bây giờ.
      const following = nextWaiting(tx, step.seq);
      if (following?.approver.type === 'choose' && !following.chosenUserId) {
        await this.requireChoice(actor.tenantId, tx, following, nextAssignee, { directorUserId: actor.userId, unitIds });
        await tx.updateStep(following.id, { chosenUserId: nextAssignee ?? null });
      }
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'directed', note: instruction });
      await tx.assign(units);
      const letter = await tx.update({
        stage: 'processing',
        instruction,
        directorUserId: actor.userId,
        dueOn: dueOn ?? tx.letter.dueOn,
      });
      await tx.history({
        action: 'direct',
        summary: `${step.name}: giao ${units.map((unit) => unit.unitName).join(', ')} xử lý`,
        note: instruction,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.assigned, letter, actor, [], {
          summary: `Phòng của bạn được giao xử lý công văn ${letterTitle(letter)}. Chỉ đạo: ${instruction}${dueText(letter.dueOn)}`,
          assignments: unitAssignments(units.map((unit) => unit.unitId)),
          unitIds: units.map((unit) => unit.unitId),
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Ở bước chỉ đạo, cho "lưu để biết": không cần phòng ban, bỏ các bước còn lại, chờ lưu trữ. */
  async closeForInfo(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến', 4000);
    await this.transition(actor, letterId, 'closeForInfo', async (tx) => {
      const step = requireActive(tx);
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'closed', note: note ?? null });
      for (const rest of tx.steps.filter((item) => item.status === 'waiting')) await tx.updateStep(rest.id, { status: 'skipped' });
      const letter = await tx.update({ stage: 'closing', instruction: note ?? tx.letter.instruction, directorUserId: actor.userId });
      await tx.history({ action: 'close-for-info', summary: `${step.name}: lưu để biết, không cần phản hồi`, note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.archiveRequested, letter, actor, [letter.receivedBy], {
          summary: `${actor.displayName} cho lưu để biết công văn ${letterTitle(letter)}; chờ lưu trữ hồ sơ.`,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /** Ở bước duyệt sau chỉ đạo: trả phòng ban sửa dự thảo; các bước duyệt chạy lại từ đầu khi đủ phản hồi. */
  async requestRevision(actor: CorrespondenceActor, letterId: string, input: RequestRevisionRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Nội dung cần sửa', 4000);
    await this.transition(actor, letterId, 'requestRevision', async (tx) => {
      const step = requireActive(tx);
      const wanted = Array.isArray(input?.assignmentIds) && input.assignmentIds.length > 0 ? new Set(input.assignmentIds) : undefined;
      const targets = tx.assignments.filter((item) => !wanted || wanted.has(item.id));
      if (targets.length === 0 || (wanted && targets.length !== wanted.size)) {
        throw new CorrespondenceValidationError('Chọn phòng ban cần sửa trong số phòng ban đã giao.');
      }
      await tx.updateStep(step.id, { status: 'waiting', actedBy: actor.userId, decision: 'revision', note: reason, assigneeUserIds: [] });
      const directSeq = tx.steps.find((item) => item.kind === 'direct')?.seq ?? 0;
      for (const later of tx.steps.filter((item) => item.seq > directSeq && item.id !== step.id && item.status !== 'waiting')) {
        await tx.updateStep(later.id, { status: 'waiting', assigneeUserIds: [] });
      }
      await tx.reopenAssignments(targets.map((item) => item.id), reason);
      const letter = await tx.update({ stage: 'processing' });
      await tx.history({
        action: 'request-revision',
        summary: `${step.name}: yêu cầu ${targets.map((item) => item.unitName).join(', ')} sửa văn bản phản hồi`,
        note: reason,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.revisionRequested, letter, actor, submitters(targets), {
          summary: `${actor.displayName} yêu cầu sửa văn bản phản hồi công văn ${letterTitle(letter)}: ${reason}`,
          assignments: unitAssignments(targets.map((item) => item.unitId)),
          unitIds: targets.map((item) => item.unitId),
          reason,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  /* ---------------------------------------------------------- phòng ban */

  async respond(
    actor: CorrespondenceActor,
    letterId: string,
    assignmentId: string,
    input: RespondAssignmentRequest,
  ): Promise<LetterDetail> {
    const note = requireText(input?.note, 'Nội dung phản hồi', 4000);
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      if (!canViewLetter(viewer, facts(txRow(tx), catalog))) throw new LetterNotFoundError();
      const assignment = tx.assignments.find((item) => item.id === assignmentId);
      if (!assignment) throw new CorrespondenceValidationError('Phòng ban này không được giao xử lý công văn.');
      if (tx.letter.stage !== 'processing' || assignment.status !== 'pending') throw new LetterStageConflictError();
      if (!canRespondFor(viewer, tx.letter, assignment)) {
        throw new CorrespondenceForbiddenError(`Chỉ người thuộc ${assignment.unitName} gửi được phản hồi của phòng.`);
      }
      await tx.submitAssignment(assignment.id, { note, userId: actor.userId });
      await tx.history({ action: 'respond', summary: `${assignment.unitName} gửi văn bản phản hồi`, note, actorUserId: actor.userId });
      if (tx.assignments.some((item) => item.status === 'pending')) return;
      // Đủ phản hồi của mọi phòng ban: sang bước duyệt kế tiếp sau bước chỉ đạo (hệ thống tự làm).
      await tx.history({ action: 'review-requested', summary: 'Đủ phản hồi của các phòng ban' });
      const directSeq = tx.steps.find((item) => item.kind === 'direct')?.seq ?? 0;
      await this.advance(actor, tx, directSeq, undefined);
    });
    return this.detail(actor, letterId);
  }

  /* --------------------------------------------------- phát hành, lưu trữ */

  async publish(actor: CorrespondenceActor, letterId: string, input: PublishLetterRequest): Promise<LetterDetail> {
    const recipient = requireText(input?.recipient, 'Nơi nhận', 255);
    const publishedOn = optionalDate(input?.publishedOn, 'Ngày phát hành') ?? this.today();
    const settings = await this.store.settings(actor.tenantId);
    await this.transition(actor, letterId, 'publish', async (tx) => {
      const year = Number(publishedOn.slice(0, 4));
      const outgoingNo = formatSequenceNo(await tx.nextNumber('outgoing', year), settings.outgoingSuffix);
      const letter = await tx.update({ stage: 'closing', outgoingNo, publishedOn, recipient });
      await tx.history({ action: 'publish', summary: `Cấp số ${outgoingNo}, phát hành tới ${recipient}`, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.published, letter, actor, participants(tx), {
          summary: `Đã phát hành ${outgoingNo} tới ${recipient}, trả lời công văn ${letterTitle(letter)}.`,
          outgoingNo,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async archive(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const settings = await this.store.settings(actor.tenantId);
    const archivedOn = this.today();
    const letter = await this.transition(actor, letterId, 'archive', async (tx) => {
      const year = Number(archivedOn.slice(0, 4));
      const archiveCode = formatArchiveCode(settings.archivePrefix, year, await tx.nextNumber('archive', year));
      const updated = await tx.update({ stage: 'archived', archiveCode, archivedOn });
      await tx.history({ action: 'archive', summary: `Lưu trữ hồ sơ, số ${archiveCode}`, note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.archived, updated, actor, participants(tx), {
          summary: `Hồ sơ công văn ${letterTitle(updated)} đã lưu trữ, số ${archiveCode}.`,
          archiveCode,
        }),
      );
      return updated;
    });
    if (letter.sharedFolderId && letter.archiveCode) {
      // Ghi số lưu trữ lên thư mục hồ sơ bên Hệ dùng chung để tra được ở kho. Không được thì hồ sơ vẫn đã lưu.
      try {
        await this.files.updateFolder(actor.tenantId, letter.sharedFolderId, {
          docKind: 'official_letter',
          docNumber: letter.archiveCode,
          partner: letter.senderOrg,
          issuedOn: letter.senderDate ?? letter.receivedOn,
          note: archiveNote(letter),
        });
      } catch (error) {
        this.logger.warn(
          `Không ghi được số lưu trữ ${letter.archiveCode} lên thư mục hồ sơ: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return this.detail(actor, letterId);
  }

  /* ------------------------------------------------------------- tệp */

  async createAttachment(
    actor: CorrespondenceActor,
    letterId: string,
    input: CreateAttachmentRequest,
  ): Promise<AttachmentUploadTicket> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const kind = requireEnum(input?.kind, ATTACHMENT_KINDS, 'Loại tệp');
    const fileName = requireText(input?.fileName, 'Tên tệp', 255);
    const contentType = String(input?.contentType ?? '').trim() || 'application/octet-stream';
    const sizeBytes = Number(input?.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new CorrespondenceValidationError('Dung lượng tệp không hợp lệ.');
    if (sizeBytes > CORRESPONDENCE_ATTACHMENT_MAX_BYTES) {
      throw new CorrespondenceValidationError(
        `Tệp không được vượt quá ${Math.round(CORRESPONDENCE_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [steps, assignments] = await Promise.all([
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
    ]);
    const row = { ...letter, steps, assignments };
    if (!canViewLetter(viewer, facts(row, catalog))) throw new LetterNotFoundError();
    const assignment = this.attachTarget(viewer, facts(row, catalog), assignments, kind, input?.assignmentId);
    const restricted = Boolean(catalog.get('confidentiality')?.get(letter.confidentiality)?.restricted);

    const request = {
      userId: actor.userId,
      rootName: CORRESPONDENCE_FILING_ROOT,
      name: `${ATTACHMENT_KIND_LABELS[kind]} - ${fileName}`.slice(0, 255),
      description: assignment ? `${assignment.unitName} · ${letter.incomingNo}` : undefined,
      sourceLabel: `Văn thư · ${letter.incomingNo}`,
      confidentiality: restricted ? ('confidential' as const) : ('internal' as const),
      docKind: 'official_letter' as const,
      docNumber: kind === 'outgoing' ? letter.outgoingNo : kind === 'incoming' ? letter.senderRef : undefined,
      partner: kind === 'outgoing' ? letter.recipient : letter.senderOrg,
      issuedOn: kind === 'outgoing' ? letter.publishedOn : kind === 'incoming' ? letter.senderDate : undefined,
      fileName,
      contentType,
      sizeBytes: Math.round(sizeBytes),
    };
    const dossierPath = [
      { name: String(letter.year) },
      { name: INCOMING_FOLDER },
      {
        name: dossierFolderName(letter.incomingNo, letter.subject),
        docKind: 'official_letter' as const,
        docNumber: letter.incomingNo,
        partner: letter.senderOrg,
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
      // Thư mục hồ sơ đã bị xoá bên Hệ dùng chung: dựng lại theo đường dẫn.
      if (!(error instanceof FileStoreMissingError) || !letter.sharedFolderId) throw error;
      filed = await this.files.create(actor.tenantId, { ...request, path: dossierPath });
    }

    try {
      const attachment = await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
        const fresh = this.attachTarget(viewer, facts(txRow(tx), catalog), tx.assignments, kind, input?.assignmentId);
        if (tx.letter.sharedFolderId !== filed.folderId) await tx.update({ sharedFolderId: filed.folderId });
        const created = await tx.addAttachment({
          kind,
          assignmentId: fresh?.id,
          sharedDocumentId: filed.documentId,
          sharedVersionId: filed.versionId,
          fileName,
          contentType,
          uploadedBy: actor.userId,
        });
        await tx.history({
          action: 'attach',
          summary: `Đính kèm ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()}: ${fileName}`,
          actorUserId: actor.userId,
        });
        return created;
      });
      return {
        attachment: attachmentView(attachment, new Map([[actor.userId, actor.displayName]]), true),
        uploadUrl: filed.uploadUrl,
        expiresInSeconds: filed.expiresInSeconds,
      };
    } catch (error) {
      await this.files.trash(actor.tenantId, filed.documentId, actor.userId).catch(() => undefined);
      throw error;
    }
  }

  async completeAttachment(
    actor: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
    sizeBytes: unknown,
  ): Promise<LetterAttachment> {
    const { attachment } = await this.visibleAttachment(actor, letterId, attachmentId);
    if (attachment.uploadedBy !== actor.userId && !actor.canRegister) {
      throw new CorrespondenceForbiddenError('Chỉ người tải tệp lên mới báo xong được.');
    }
    const size = Number(sizeBytes);
    if (!Number.isInteger(size) || size < 0 || size > CORRESPONDENCE_ATTACHMENT_MAX_BYTES) {
      throw new CorrespondenceValidationError('Dung lượng tệp không hợp lệ.');
    }
    await this.files.complete(actor.tenantId, attachment.sharedDocumentId, attachment.sharedVersionId, size);
    await this.store.completeAttachment(actor.tenantId, attachmentId, size);
    const names = await this.store.userNames(actor.tenantId, [attachment.uploadedBy]);
    return attachmentView({ ...attachment, sizeBytes: size }, names, true);
  }

  async download(
    actor: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
    mode: AttachmentDownloadMode,
  ): Promise<AttachmentDownloadTicket> {
    const { attachment } = await this.visibleAttachment(actor, letterId, attachmentId);
    if (attachment.sizeBytes == null) throw new CorrespondenceValidationError('Tệp chưa tải lên xong, chưa mở được.');
    try {
      return await this.files.download(actor.tenantId, attachment.sharedDocumentId, actor.userId, mode);
    } catch (error) {
      if (error instanceof FileStoreMissingError) {
        throw new CorrespondenceValidationError('Tệp không còn trong kho tài liệu của Hệ dùng chung (đã bị xoá bên đó).');
      }
      throw error;
    }
  }

  async deleteAttachment(actor: CorrespondenceActor, letterId: string, attachmentId: string): Promise<void> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    const documentId = await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const letterFacts = facts(txRow(tx), catalog);
      if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();
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

  /* ----------------------------------------------------------- cấu hình */

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
    };
    await this.store.saveSettings(actor.tenantId, actor.userId, settings);
    return settings;
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
    const due = input?.defaultDueDays;
    const defaultDueDays = due === undefined || due === null || (due as unknown) === '' ? null : Number(due);
    if (defaultDueDays !== null && (!Number.isInteger(defaultDueDays) || defaultDueDays < 0 || defaultDueDays > 365)) {
      throw new CorrespondenceValidationError('Hạn xử lý mặc định là số ngày từ 0 đến 365.');
    }
    const workflowId = optionalText(input?.workflowId, 'Quy trình', 64) ?? null;
    if (workflowId && !(await this.store.workflows(actor.tenantId)).some((item) => item.id === workflowId)) {
      throw new CorrespondenceValidationError('Quy trình được chọn không còn.');
    }
    const sortOrder = Number(input?.sortOrder ?? 0);
    return this.store.saveCatalogItem(actor.tenantId, actor.userId, id, {
      kind,
      code,
      name: requireText(input?.name, 'Tên', 120),
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      isActive: input?.isActive !== false,
      defaultDueDays: kind === 'letter_type' ? defaultDueDays : null,
      workflowId: kind === 'letter_type' ? workflowId : null,
      highlight: kind === 'urgency' && input?.highlight === true,
      restricted: kind === 'confidentiality' && input?.restricted === true,
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
    const steps = normalizeSteps(input?.steps);
    const isDefault = input?.isDefault === true;
    const isActive = input?.isActive !== false;
    if (isDefault && !isActive) throw new CorrespondenceValidationError('Quy trình mặc định phải đang dùng.');
    if (id && !(await this.store.workflows(actor.tenantId)).some((item) => item.id === id)) {
      throw new CorrespondenceValidationError('Quy trình không còn, tải lại trang.');
    }
    return this.store.saveWorkflow(actor.tenantId, actor.userId, id, {
      name: requireText(input?.name, 'Tên quy trình', 160),
      description: optionalText(input?.description, 'Mô tả', 2000) ?? null,
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

  /* ------------------------------------------------------------ nội bộ */

  private requireConfigure(actor: CorrespondenceActor): void {
    if (!actor.canConfigure && !actor.isTenantAdmin) {
      throw new CorrespondenceForbiddenError('Bạn không có quyền cấu hình văn thư.');
    }
  }

  private async transition<T>(
    actor: CorrespondenceActor,
    letterId: string,
    action: TransitionAction,
    work: (tx: LetterTransaction) => Promise<T>,
  ): Promise<T> {
    const viewer = await this.viewer(actor);
    const catalog = await this.catalogMap(actor.tenantId);
    return this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const letterFacts = facts(txRow(tx), catalog);
      if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();
      if (!letterActions(viewer, letterFacts)[action]) {
        const elsewhere = LETTER_STAGES.some((stage) => letterActions(viewer, { ...letterFacts, stage })[action]);
        if (elsewhere || isStepAction(action)) throw new LetterStageConflictError();
        throw new CorrespondenceForbiddenError();
      }
      return work(tx);
    });
  }

  /**
   * Bắt đầu một bước: giải người được giao theo sơ đồ tổ chức (luật `choose` cần người đã
   * chọn), đổi giai đoạn công văn và báo người được giao.
   */
  private async activate(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    step: StepRecord,
    chosen: string | undefined,
  ): Promise<void> {
    const pick = step.chosenUserId ?? chosen;
    const context = await this.approverContext(actor.tenantId, tx.letter, tx.assignments, pick);
    if (step.approver.type === 'choose' && !pick) {
      throw new CorrespondenceValidationError(`Chọn người cho bước "${step.name}".`);
    }
    const assignees = resolveAssignees(step.approver, context);
    if (assignees.length === 0) {
      throw new CorrespondenceValidationError(
        step.approver.type === 'choose'
          ? `Người được chọn không thuộc nhóm của bước "${step.name}".`
          : `Bước "${step.name}" chưa xác định được người duyệt theo sơ đồ tổ chức. Kiểm cấu hình quy trình hoặc sơ đồ tổ chức.`,
      );
    }
    await tx.updateStep(step.id, { status: 'active', activate: true, assigneeUserIds: assignees, chosenUserId: pick ?? null, actedBy: null, decision: null });
    const letter = await tx.update({ stage: step.kind === 'direct' ? 'directing' : 'reviewing' });
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.stepAssigned, letter, actor, assignees, {
        summary: `${step.name}: công văn ${letterTitle(letter)} của ${letter.senderOrg}.${dueText(letter.dueOn)}`,
        stepName: step.name,
        stepKind: step.kind,
      }),
    );
  }

  /** Sau bước `fromSeq`: bắt đầu bước chờ kế tiếp, hết bước thì chờ phát hành. */
  private async advance(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    fromSeq: number,
    chosen: string | undefined,
  ): Promise<void> {
    const next = nextWaiting(tx, fromSeq);
    if (next) {
      await this.activate(actor, tx, next, chosen);
      return;
    }
    const letter = await tx.update({ stage: 'publishing' });
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.approved, letter, actor, [letter.receivedBy, ...submitters(tx.assignments)], {
        summary: `Công văn ${letterTitle(letter)} đã duyệt xong; chờ cấp số và phát hành.`,
      }),
    );
  }

  /** Bước luật `choose` cần người được chọn thuộc nhóm của nó. */
  private async requireChoice(
    tenantId: string,
    tx: LetterTransaction,
    step: StepRecord,
    chosen: string | undefined,
    extra: { directorUserId: string; unitIds: readonly string[] },
  ): Promise<void> {
    if (!chosen) throw new CorrespondenceValidationError(`Chọn người cho bước "${step.name}".`);
    const context = await this.approverContext(tenantId, { ...tx.letter, directorUserId: extra.directorUserId }, [], chosen);
    if (!chooseCandidates(step.approver, context).some((candidate) => candidate.userId === chosen)) {
      throw new CorrespondenceValidationError(`Người được chọn không thuộc nhóm của bước "${step.name}".`);
    }
  }

  private async approverContext(
    tenantId: string,
    letter: Pick<LetterRecord, 'directorUserId'>,
    assignments: readonly Pick<AssignmentRecord, 'unitId'>[],
    chosenUserId?: string,
  ): Promise<ApproverContext> {
    const [organization, leaders] = await Promise.all([this.organization.snapshot(tenantId), this.store.leaders(tenantId)]);
    return {
      organization,
      leaders,
      directorUserId: letter.directorUserId,
      assignedUnitIds: assignments.map((item) => item.unitId),
      chosenUserId,
    };
  }

  /** Quy trình được chọn, của loại văn bản, hoặc mặc định của tenant; phải đang dùng. */
  private async pickWorkflow(tenantId: string, letter: LetterRecord, workflowId?: string): Promise<Workflow> {
    const [workflows, catalog] = await Promise.all([this.store.workflows(tenantId), this.catalogMap(tenantId)]);
    const wanted =
      workflowId?.trim() || catalog.get('letter_type')?.get(letter.kind)?.workflowId || workflows.find((item) => item.isDefault)?.id;
    const workflow = workflows.find((item) => item.id === wanted && item.isActive);
    if (!workflow) {
      throw new CorrespondenceValidationError('Chưa có quy trình duyệt đang dùng cho công văn này. Vào Cấu hình để tạo quy trình.');
    }
    return workflow;
  }

  private attachTarget(
    viewer: LetterViewer,
    letterFacts: LetterFacts,
    assignments: readonly AssignmentRecord[],
    kind: AttachmentKind,
    assignmentId: string | undefined,
  ): AssignmentRecord | undefined {
    if (!letterActions(viewer, letterFacts).attachKinds.includes(kind)) {
      throw new CorrespondenceForbiddenError(`Bạn không đính kèm được ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()} ở bước này.`);
    }
    if (kind !== 'draft') return undefined;
    const assignment = assignments.find((item) => item.id === assignmentId);
    if (!assignment || !canRespondFor(viewer, letterFacts, assignment)) {
      throw new CorrespondenceValidationError('Chọn phòng ban gửi dự thảo trong số phòng ban bạn thuộc về.');
    }
    return assignment;
  }

  private async visibleAttachment(
    actor: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
  ): Promise<{ letter: LetterRecord; attachment: AttachmentRecord }> {
    const viewer = await this.viewer(actor);
    const [letter, steps, assignments, attachment, catalog] = await Promise.all([
      this.store.findLetter(actor.tenantId, letterId),
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
      this.store.findAttachment(actor.tenantId, attachmentId),
      this.catalogMap(actor.tenantId),
    ]);
    if (!letter || !canViewLetter(viewer, facts({ ...letter, steps, assignments }, catalog))) throw new LetterNotFoundError();
    if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
    return { letter, attachment };
  }

  private async viewer(actor: CorrespondenceActor): Promise<LetterViewer> {
    const snapshot = await this.organization.snapshot(actor.tenantId);
    return {
      userId: actor.userId,
      isTenantAdmin: actor.isTenantAdmin,
      canRegister: actor.canRegister || actor.isTenantAdmin,
      canPublish: actor.canPublish || actor.isTenantAdmin,
      canArchive: actor.canArchive || actor.isTenantAdmin,
      canReadAll: actor.canReadAll || actor.isTenantAdmin,
      canReadConfidential: actor.canReadConfidential || actor.isTenantAdmin,
      unitIds: membershipNodes(snapshot, actor.userId),
    };
  }

  private visibility(viewer: LetterViewer): NonNullable<Parameters<CorrespondenceStore['listLetters']>[1]['visibleTo']> | undefined {
    if (viewer.isTenantAdmin || (viewer.canReadAll && viewer.canReadConfidential)) return undefined;
    return {
      userId: viewer.userId,
      unitIds: [...viewer.unitIds],
      readAll: viewer.canReadAll,
      readConfidential: viewer.canReadConfidential,
    };
  }

  private async catalogMap(tenantId: string): Promise<Catalog> {
    const items = await this.store.catalog(tenantId);
    const map = new Map<CatalogKind, Map<string, CatalogItem>>();
    for (const item of items) {
      if (!map.has(item.kind)) map.set(item.kind, new Map());
      map.get(item.kind)?.set(item.code, item);
    }
    return map;
  }

  /** Mã danh mục người dùng chọn: phải có và đang dùng; bỏ trống là `undefined`. */
  private catalogCode(catalog: Catalog, kind: CatalogKind, value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const code = String(value);
    const item = catalog.get(kind)?.get(code);
    if (!item || !item.isActive) throw new CorrespondenceValidationError(`${label} "${code.slice(0, 40)}" không có hoặc đã ngừng dùng.`);
    return code;
  }

  private async summaries(
    actor: CorrespondenceActor,
    viewer: LetterViewer,
    catalog: Catalog,
    rows: readonly LetterListRow[],
  ): Promise<LetterSummary[]> {
    const names = await this.store.userNames(
      actor.tenantId,
      rows.flatMap((row) => [row.receivedBy, ...(row.steps.find((step) => step.status === 'active')?.assigneeUserIds ?? [])]),
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
        incomingNo: letter.incomingNo,
        subject: letter.subject,
        senderOrg: letter.senderOrg,
        urgency: letter.urgency,
        dueOn: letter.dueOn ?? null,
        stage: letter.stage,
        recipientUserIds: [...new Set(recipientUserIds)],
        actorUserId: actor.userId,
        actorName: actor.displayName,
        deepLink: letterDeepLink(letter.id),
        ...extra,
      },
    };
  }
}

/* ---------------------------------------------------------------- hàm thuần */

type Row = LetterRecord & {
  readonly steps: readonly Pick<StepRecord, 'seq' | 'name' | 'kind' | 'status' | 'assigneeUserIds' | 'actedBy'>[];
  readonly assignments: readonly Pick<AssignmentRecord, 'unitId' | 'status' | 'submittedBy'>[];
};

function txRow(tx: LetterTransaction): Row {
  return { ...tx.letter, steps: tx.steps, assignments: tx.assignments };
}

function facts(row: Row, catalog: Catalog): LetterFacts {
  return {
    stage: row.stage,
    receivedBy: row.receivedBy,
    restricted: Boolean(catalog.get('confidentiality')?.get(row.confidentiality)?.restricted),
    steps: row.steps,
    assignments: row.assignments,
  };
}

function isStepAction(action: TransitionAction): boolean {
  return ['approve', 'returnToClerk', 'direct', 'closeForInfo', 'requestRevision'].includes(action);
}

function requireActive(tx: LetterTransaction): StepRecord {
  const step = tx.steps.find((item) => item.status === 'active');
  if (!step) throw new LetterStageConflictError();
  return step;
}

function nextWaiting(tx: LetterTransaction, fromSeq: number): StepRecord | undefined {
  return [...tx.steps].sort((left, right) => left.seq - right.seq).find((step) => step.seq > fromSeq && step.status === 'waiting');
}

function firstActive(catalog: Catalog, kind: CatalogKind): string {
  const items = [...(catalog.get(kind)?.values() ?? [])].filter((item) => item.isActive);
  const item = items.sort((left, right) => left.sortOrder - right.sortOrder)[0];
  if (!item) throw new CorrespondenceValidationError('Danh mục chưa có mục nào đang dùng. Vào Cấu hình để thêm.');
  return item.code;
}

/** Thanh tiến trình: tiếp nhận, phân loại, các bước của quy trình (xử lý chen sau bước chỉ đạo), phát hành, lưu trữ. */
export function flowOf(stage: LetterStage, steps: readonly Pick<StepRecord, 'seq' | 'name' | 'kind' | 'status'>[]): FlowNode[] {
  const ordered = [...steps].sort((left, right) => left.seq - right.seq);
  const nodes: { label: string; key: string }[] = [
    { label: 'Tiếp nhận', key: 'received' },
    { label: 'Phân loại', key: 'registered' },
  ];
  if (ordered.length === 0) nodes.push({ label: 'Trình duyệt', key: 'workflow' });
  for (const step of ordered) {
    nodes.push({ label: step.name, key: `step-${step.seq}` });
    if (step.kind === 'direct') nodes.push({ label: 'Phòng ban xử lý', key: 'processing' });
  }
  nodes.push({ label: 'Phát hành', key: 'publishing' }, { label: 'Lưu trữ', key: 'closing' });
  if (stage === 'cancelled') return nodes.map((node) => ({ label: node.label, state: 'todo' }));
  const active = ordered.find((step) => step.status === 'active');
  const currentKey =
    stage === 'archived'
      ? undefined
      : stage === 'reviewing' || stage === 'directing'
        ? active ? `step-${active.seq}` : 'workflow'
        : stage;
  const currentIndex = currentKey === undefined ? nodes.length : nodes.findIndex((node) => node.key === currentKey);
  return nodes.map((node, index) => ({
    label: node.label,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }));
}

function summaryOf(row: Row, catalog: Catalog, viewer: LetterViewer, names: ReadonlyMap<string, string>): LetterSummary {
  const item = (kind: CatalogKind, code: string) => catalog.get(kind)?.get(code);
  const active = row.steps.find((step) => step.status === 'active');
  return {
    id: row.id,
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
    currentStepName: active?.name,
    currentAssigneeNames: (active?.assigneeUserIds ?? []).map((userId) => names.get(userId) ?? 'Người dùng'),
    assignmentsDone: row.assignments.filter((assignment) => assignment.status === 'submitted').length,
    assignmentsTotal: row.assignments.length,
    outgoingNo: row.outgoingNo,
    publishedOn: row.publishedOn,
    recipient: row.recipient,
    archiveCode: row.archiveCode,
    archivedOn: row.archivedOn,
    receivedBy: row.receivedBy,
    receivedByName: names.get(row.receivedBy),
    updatedAt: row.updatedAt,
    awaitingMe: awaitsViewer(viewer, facts(row, catalog)),
  };
}

function attachmentView(attachment: AttachmentRecord, names: ReadonlyMap<string, string>, canDelete: boolean): LetterAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    assignmentId: attachment.assignmentId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    uploadedBy: attachment.uploadedBy,
    uploadedByName: names.get(attachment.uploadedBy),
    createdAt: attachment.createdAt,
    canDelete,
  };
}

/** Phòng ban giao xử lý dưới dạng vai của Quy trình: notification-worker giải ra người phụ trách đơn vị. */
function unitAssignments(unitIds: readonly string[]) {
  return unitIds.map((unitId) => ({ subjectType: 'organization_unit', subjectId: unitId, role: 'E' }));
}

function submitters(assignments: readonly Pick<AssignmentRecord, 'submittedBy'>[]): string[] {
  return assignments.map((item) => item.submittedBy).filter((id): id is string => Boolean(id));
}

/** Người đã tham gia: người làm các bước, người gửi phản hồi, người chỉ đạo. */
function participants(tx: LetterTransaction): string[] {
  return [
    ...tx.steps.map((step) => step.actedBy).filter((id): id is string => Boolean(id)),
    ...submitters(tx.assignments),
    ...(tx.letter.directorUserId ? [tx.letter.directorUserId] : []),
  ];
}

function archiveNote(letter: LetterRecord): string {
  const parts = [`Hồ sơ ${letter.archiveCode}`, `Số đến ${letter.incomingNo}`];
  if (letter.outgoingNo) parts.push(`Số đi ${letter.outgoingNo}`);
  parts.push(`Trích yếu: ${letter.subject}`);
  return parts.join(' · ').slice(0, 2000);
}

function dueText(dueOn: string | undefined): string {
  return dueOn ? ` Hạn xử lý ${dueOn.split('-').reverse().join('/')}.` : '';
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
  if (!(allowed as readonly string[]).includes(text)) {
    throw new CorrespondenceValidationError(`${label} "${text.slice(0, 40)}" không hợp lệ.`);
  }
  return text as T;
}

