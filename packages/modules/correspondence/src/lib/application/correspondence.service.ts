import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  CORRESPONDENCE_ATTACHMENT_MAX_BYTES,
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  LETTER_CONFIDENTIALITIES,
  LETTER_KINDS,
  LETTER_STAGES,
  LETTER_URGENCIES,
  OPEN_LETTER_STAGES,
  letterDeepLink,
  letterTitle,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentKind,
  type AttachmentUploadTicket,
  type ClassifyLetterRequest,
  type CorrespondenceDirectory,
  type CorrespondenceOverview,
  type CorrespondenceSettings,
  type CorrespondenceStatus,
  type CreateAttachmentRequest,
  type CreateLetterRequest,
  type DirectLetterRequest,
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
  type SubmitLetterRequest,
  type UpdateLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { Logger } from '@nestjs/common';
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
import {
  FileStoreMissingError,
  isClerk,
  membershipNodes,
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
} from './ports.js';

/** Danh sách tối đa từng này dòng; tìm kiếm để thu hẹp. */
const LIST_LIMIT = 500;
const OVERVIEW_LIMIT = 2000;
const MAX_UNITS_PER_LETTER = 30;
/** Tên thư mục gốc của Văn thư trong kho tài liệu của Hệ dùng chung. */
export const CORRESPONDENCE_FILING_ROOT = 'Văn thư';
const INCOMING_FOLDER = 'Công văn đến';

/**
 * Văn thư: tiếp nhận công văn đến → phân loại → trình lãnh đạo → lãnh đạo giao
 * phòng ban → phòng ban gửi văn bản phản hồi → lãnh đạo duyệt → văn thư cấp số
 * và phát hành → lưu trữ hồ sơ.
 *
 * Mỗi thao tác chuyển bước chạy trong một transaction đã khoá dòng công văn và
 * kiểm lại luật quyền (`letterActions`) trên dữ liệu vừa khoá, nên giao diện cũ
 * hay hai người bấm cùng lúc không làm công văn đi sai bước. Sự kiện dẫn tới
 * thông báo ghi vào outbox trong cùng transaction.
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
    const tablesReady = await this.store.tablesReady(actor.tenantId);
    return {
      tenantId: actor.tenantId,
      userId: actor.userId,
      tablesReady,
      capabilities: {
        isTenantAdmin: actor.isTenantAdmin,
        canRegister: isClerk(actor),
        canDirect: actor.canDirect,
        canManage: actor.canManage || actor.isTenantAdmin,
      },
      settings: tablesReady ? await this.store.settings(actor.tenantId) : DEFAULT_CORRESPONDENCE_SETTINGS,
    };
  }

  async directory(actor: CorrespondenceActor): Promise<CorrespondenceDirectory> {
    const [leaders, snapshot] = await Promise.all([
      this.store.leaders(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const units = snapshot.nodes
      .filter((node) => node.kind === 'unit')
      .map((node) => ({ id: node.id, name: node.name, path: unitPath(nodes, node.id) }))
      .sort((left, right) => `${left.path} ${left.name}`.localeCompare(`${right.path} ${right.name}`, 'vi'));
    return { leaders, units, degraded: snapshot.degraded };
  }

  async list(actor: CorrespondenceActor, query: LetterQuery = {}): Promise<LetterSummary[]> {
    const viewer = await this.viewer(actor);
    const box = query.box ?? 'all';
    const stage = parseOptional(query.stage, LETTER_STAGES, 'Bước xử lý');
    const rows = await this.store.listLetters(actor.tenantId, {
      visibleTo: this.visibility(viewer),
      stages: box === 'archive' ? ['archived'] : box === 'mine' ? OPEN_LETTER_STAGES : stage ? [stage] : undefined,
      onlyPublished: box === 'outgoing',
      search: query.search?.trim() || undefined,
      limit: LIST_LIMIT,
    });
    let visible = rows.filter((row) => canViewLetter(viewer, row));
    if (box === 'mine') visible = visible.filter((row) => awaitsViewer(viewer, row));
    if (box === 'outgoing') {
      visible = [...visible].sort((left, right) => (right.publishedOn ?? '').localeCompare(left.publishedOn ?? ''));
    }
    return this.summaries(actor, viewer, visible);
  }

  async overview(actor: CorrespondenceActor): Promise<CorrespondenceOverview> {
    const viewer = await this.viewer(actor);
    const visibleTo = this.visibility(viewer);
    const [rows, archived] = await Promise.all([
      this.store.listLetters(actor.tenantId, { visibleTo, stages: OPEN_LETTER_STAGES, limit: OVERVIEW_LIMIT }),
      this.store.countArchived(actor.tenantId, visibleTo),
    ]);
    const open = rows.filter((row) => canViewLetter(viewer, row));
    const today = this.today();
    const byStage: Partial<Record<LetterStage, number>> = {};
    for (const row of open) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    const urgent = [...open]
      .sort((left, right) => (left.dueOn ?? '9999-12-31').localeCompare(right.dueOn ?? '9999-12-31'))
      .slice(0, 6);
    return {
      open: open.length,
      awaitingLeader: open.filter((row) => row.stage === 'directing' || row.stage === 'reviewing').length,
      overdue: open.filter((row) => row.dueOn && row.dueOn < today).length,
      archived,
      awaitingMe: open.filter((row) => awaitsViewer(viewer, row)).length,
      byStage,
      urgent: await this.summaries(actor, viewer, urgent),
    };
  }

  async detail(actor: CorrespondenceActor, letterId: string): Promise<LetterDetail> {
    const viewer = await this.viewer(actor);
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [assignments, attachments, history] = await Promise.all([
      this.store.assignments(actor.tenantId, letterId),
      this.store.attachments(actor.tenantId, letterId),
      this.store.history(actor.tenantId, letterId),
    ]);
    const facts = { ...letter, assignments };
    if (!canViewLetter(viewer, facts)) throw new LetterNotFoundError();
    const names = await this.store.userNames(actor.tenantId, [
      letter.receivedBy,
      letter.leaderUserId,
      ...assignments.map((item) => item.submittedBy),
      ...attachments.map((item) => item.uploadedBy),
      ...history.map((item) => item.actorUserId),
    ].filter((value): value is string => Boolean(value)));
    const byId = new Map(assignments.map((item) => [item.id, item]));
    return {
      ...summaryOf(letter, facts, viewer, names),
      instruction: letter.instruction,
      approvalNote: letter.approvalNote,
      cancelReason: letter.cancelReason,
      sharedFolderId: letter.sharedFolderId,
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
        canRespond: canRespondFor(viewer, letter, item),
      })),
      attachments: attachments.map((item) =>
        attachmentView(item, names, canDeleteAttachment(viewer, facts, { ...item, assignment: item.assignmentId ? byId.get(item.assignmentId) : undefined })),
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
      actions: letterActions(viewer, facts),
    };
  }

  /* ---------------------------------------------------------- văn thư */

  async create(actor: CorrespondenceActor, input: CreateLetterRequest): Promise<LetterDetail> {
    if (!isClerk(actor)) throw new CorrespondenceForbiddenError('Chỉ văn thư tiếp nhận được công văn đến.');
    const settings = await this.store.settings(actor.tenantId);
    const receivedOn = optionalDate(input?.receivedOn, 'Ngày đến') ?? this.today();
    const dueOn =
      optionalDate(input?.dueOn, 'Hạn xử lý') ??
      (settings.defaultDueDays > 0 ? addDays(receivedOn, settings.defaultDueDays) : undefined);
    const senderDate = optionalDate(input?.senderDate, 'Ngày văn bản');
    if (dueOn && dueOn < receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
    const letter = await this.store.createLetter(
      actor.tenantId,
      {
        receivedOn,
        senderOrg: requireText(input?.senderOrg, 'Cơ quan gửi', 255),
        senderRef: optionalText(input?.senderRef, 'Số, ký hiệu văn bản', 120),
        senderDate,
        subject: requireText(input?.subject, 'Trích yếu', 1000),
        kind: parseOptional(input?.kind, LETTER_KINDS, 'Loại văn bản') ?? 'other',
        urgency: parseOptional(input?.urgency, LETTER_URGENCIES, 'Độ khẩn') ?? 'normal',
        confidentiality: parseOptional(input?.confidentiality, LETTER_CONFIDENTIALITIES, 'Độ mật') ?? 'normal',
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
        kind: parseOptional(patch.kind, LETTER_KINDS, 'Loại văn bản') ?? tx.letter.kind,
        urgency: parseOptional(patch.urgency, LETTER_URGENCIES, 'Độ khẩn') ?? tx.letter.urgency,
        confidentiality: parseOptional(patch.confidentiality, LETTER_CONFIDENTIALITIES, 'Độ mật') ?? tx.letter.confidentiality,
      });
      await tx.history({ action: 'update', summary: 'Sửa thông tin công văn', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  async classify(actor: CorrespondenceActor, letterId: string, input: ClassifyLetterRequest): Promise<LetterDetail> {
    await this.transition(actor, letterId, 'classify', async (tx) => {
      const kind = requireEnum(input?.kind, LETTER_KINDS, 'Loại văn bản');
      const urgency = requireEnum(input?.urgency, LETTER_URGENCIES, 'Độ khẩn');
      const confidentiality = parseOptional(input?.confidentiality, LETTER_CONFIDENTIALITIES, 'Độ mật') ?? tx.letter.confidentiality;
      await tx.update({ stage: 'registered', kind, urgency, confidentiality });
      await tx.history({ action: 'classify', summary: 'Phân loại, vào sổ', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }

  async submit(actor: CorrespondenceActor, letterId: string, input: SubmitLetterRequest): Promise<LetterDetail> {
    const leaderUserId = requireText(input?.leaderUserId, 'Lãnh đạo', 64);
    const leaders = await this.store.leaders(actor.tenantId);
    const leader = leaders.find((item) => item.userId === leaderUserId);
    if (!leader) {
      throw new CorrespondenceValidationError('Người được chọn không có quyền chỉ đạo công văn. Chọn lại lãnh đạo.');
    }
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    await this.transition(actor, letterId, 'submit', async (tx) => {
      const letter = await tx.update({ stage: 'directing', leaderUserId });
      await tx.history({ action: 'submit', summary: `Trình lãnh đạo ${leader.name}`, note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.submitted, letter, actor, [leaderUserId], {
          summary: `${actor.displayName} trình công văn ${letterTitle(letter)} của ${letter.senderOrg}.${dueText(letter.dueOn)}`,
        }),
      );
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

  /* ---------------------------------------------------------- lãnh đạo */

  async returnToClerk(actor: CorrespondenceActor, letterId: string, input: ReasonRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Lý do trả lại', 2000);
    await this.transition(actor, letterId, 'returnToClerk', async (tx) => {
      const letter = await tx.update({ stage: 'registered' });
      await tx.history({ action: 'return', summary: 'Trả lại văn thư', note: reason, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.returned, letter, actor, [letter.receivedBy], {
          summary: `${actor.displayName} trả lại công văn ${letterTitle(letter)}: ${reason}`,
          reason,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async direct(actor: CorrespondenceActor, letterId: string, input: DirectLetterRequest): Promise<LetterDetail> {
    const instruction = requireText(input?.instruction, 'Ý kiến chỉ đạo', 4000);
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý');
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
      if (dueOn && dueOn < tx.letter.receivedOn) {
        throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      }
      await tx.assign(units);
      const letter = await tx.update({ stage: 'processing', instruction, dueOn: dueOn ?? tx.letter.dueOn });
      await tx.history({
        action: 'direct',
        summary: `Giao ${units.map((unit) => unit.unitName).join(', ')} xử lý`,
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

  /** Lãnh đạo cho "lưu để biết": không cần phòng ban phản hồi, chuyển thẳng sang lưu trữ. */
  async closeForInfo(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến', 4000);
    await this.transition(actor, letterId, 'closeForInfo', async (tx) => {
      const letter = await tx.update({ stage: 'closing', instruction: note ?? tx.letter.instruction });
      await tx.history({ action: 'close-for-info', summary: 'Lưu để biết, không cần phản hồi', note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.archiveRequested, letter, actor, [letter.receivedBy], {
          summary: `${actor.displayName} cho lưu để biết công văn ${letterTitle(letter)}; chờ văn thư lưu trữ hồ sơ.`,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async approve(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến duyệt', 4000);
    await this.transition(actor, letterId, 'approve', async (tx) => {
      const letter = await tx.update({ stage: 'publishing', approvalNote: note });
      await tx.history({ action: 'approve', summary: 'Duyệt và ký văn bản phản hồi', note, actorUserId: actor.userId });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.approved, letter, actor, [letter.receivedBy, ...submitters(tx.assignments)], {
          summary: `Văn bản phản hồi công văn ${letterTitle(letter)} đã được duyệt; chờ văn thư cấp số và phát hành.`,
        }),
      );
    });
    return this.detail(actor, letterId);
  }

  async requestRevision(actor: CorrespondenceActor, letterId: string, input: RequestRevisionRequest): Promise<LetterDetail> {
    const reason = requireText(input?.reason, 'Nội dung cần sửa', 4000);
    await this.transition(actor, letterId, 'requestRevision', async (tx) => {
      const wanted = Array.isArray(input?.assignmentIds) && input.assignmentIds.length > 0 ? new Set(input.assignmentIds) : undefined;
      const targets = tx.assignments.filter((item) => !wanted || wanted.has(item.id));
      if (targets.length === 0 || (wanted && targets.length !== wanted.size)) {
        throw new CorrespondenceValidationError('Chọn phòng ban cần sửa trong số phòng ban đã giao.');
      }
      await tx.reopenAssignments(targets.map((item) => item.id), reason);
      const letter = await tx.update({ stage: 'processing' });
      await tx.history({
        action: 'request-revision',
        summary: `Yêu cầu ${targets.map((item) => item.unitName).join(', ')} sửa văn bản phản hồi`,
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
    await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const facts = factsOf(tx);
      if (!canViewLetter(viewer, facts)) throw new LetterNotFoundError();
      const assignment = tx.assignments.find((item) => item.id === assignmentId);
      if (!assignment) throw new CorrespondenceValidationError('Phòng ban này không được giao xử lý công văn.');
      if (tx.letter.stage !== 'processing' || assignment.status !== 'pending') throw new LetterStageConflictError();
      if (!canRespondFor(viewer, tx.letter, assignment)) {
        throw new CorrespondenceForbiddenError(`Chỉ người thuộc ${assignment.unitName} gửi được phản hồi của phòng.`);
      }
      await tx.submitAssignment(assignment.id, { note, userId: actor.userId });
      await tx.history({
        action: 'respond',
        summary: `${assignment.unitName} gửi văn bản phản hồi`,
        note,
        actorUserId: actor.userId,
      });
      const remaining = tx.assignments.filter((item) => item.id !== assignment.id && item.status === 'pending');
      if (remaining.length > 0) return;
      // Đủ phản hồi của mọi phòng ban: tự trình lại lãnh đạo.
      const letter = await tx.update({ stage: 'reviewing' });
      await tx.history({ action: 'review-requested', summary: 'Đủ phản hồi, trình lại lãnh đạo duyệt' });
      if (letter.leaderUserId) {
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.reviewRequested, letter, actor, [letter.leaderUserId], {
            summary: `Các phòng ban đã gửi đủ văn bản phản hồi công văn ${letterTitle(letter)}; chờ bạn duyệt.`,
          }),
        );
      }
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
      await tx.history({
        action: 'publish',
        summary: `Cấp số ${outgoingNo}, phát hành tới ${recipient}`,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(
          CORRESPONDENCE_EVENTS.published,
          letter,
          actor,
          [letter.leaderUserId, ...submitters(tx.assignments)].filter((id): id is string => Boolean(id)),
          {
            summary: `Đã phát hành ${outgoingNo} tới ${recipient}, trả lời công văn ${letterTitle(letter)}.`,
            outgoingNo,
          },
        ),
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
        this.event(
          CORRESPONDENCE_EVENTS.archived,
          updated,
          actor,
          [updated.leaderUserId, ...submitters(tx.assignments)].filter((id): id is string => Boolean(id)),
          { summary: `Hồ sơ công văn ${letterTitle(updated)} đã lưu trữ, số ${archiveCode}.`, archiveCode },
        ),
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

  /**
   * Chặng 1: kiểm quyền theo bước, tạo tài liệu bên Hệ dùng chung (thư mục hồ sơ
   * dựng ở lần đầu) và trả URL ký sẵn. Gọi kho xong mới ghi dòng tệp, trong một
   * transaction đã kiểm lại bước; bước đã đổi thì gỡ tài liệu vừa tạo.
   */
  async createAttachment(
    actor: CorrespondenceActor,
    letterId: string,
    input: CreateAttachmentRequest,
  ): Promise<AttachmentUploadTicket> {
    const viewer = await this.viewer(actor);
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
    const assignments = await this.store.assignments(actor.tenantId, letterId);
    const facts = { ...letter, assignments };
    if (!canViewLetter(viewer, facts)) throw new LetterNotFoundError();
    const assignment = this.attachTarget(viewer, facts, kind, input?.assignmentId);

    const request = {
      userId: actor.userId,
      rootName: CORRESPONDENCE_FILING_ROOT,
      name: `${ATTACHMENT_KIND_LABELS[kind]} - ${fileName}`.slice(0, 255),
      description: assignment ? `${assignment.unitName} · ${letter.incomingNo}` : undefined,
      sourceLabel: `Văn thư · ${letter.incomingNo}`,
      confidentiality: letter.confidentiality === 'confidential' ? ('confidential' as const) : ('internal' as const),
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
        const fresh = factsOf(tx);
        const freshAssignment = this.attachTarget(viewer, fresh, kind, input?.assignmentId);
        if (tx.letter.sharedFolderId !== filed.folderId) await tx.update({ sharedFolderId: filed.folderId });
        const created = await tx.addAttachment({
          kind,
          assignmentId: freshAssignment?.id,
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

  /** Chặng 3: trình duyệt đã `PUT` tệp xong. */
  async completeAttachment(
    actor: CorrespondenceActor,
    letterId: string,
    attachmentId: string,
    sizeBytes: unknown,
  ): Promise<LetterAttachment> {
    const { attachment } = await this.visibleAttachment(actor, letterId, attachmentId);
    if (attachment.uploadedBy !== actor.userId && !isClerk(actor)) {
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
    const documentId = await this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const facts = factsOf(tx);
      if (!canViewLetter(viewer, facts)) throw new LetterNotFoundError();
      const attachment = await this.store.findAttachment(actor.tenantId, attachmentId);
      if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
      const assignment = attachment.assignmentId ? tx.assignments.find((item) => item.id === attachment.assignmentId) : undefined;
      if (!canDeleteAttachment(viewer, facts, { ...attachment, assignment })) {
        throw new CorrespondenceForbiddenError('Bạn không gỡ được tệp này ở bước hiện tại.');
      }
      await tx.removeAttachment(attachment.id);
      await tx.history({ action: 'detach', summary: `Gỡ tệp ${attachment.fileName}`, actorUserId: actor.userId });
      return attachment.sharedDocumentId;
    });
    await this.files.trash(actor.tenantId, documentId, actor.userId).catch((error: unknown) => {
      // Dòng tệp đã gỡ khỏi hồ sơ; tài liệu còn lại bên kho thì người quản trị kho dọn sau.
      this.logger.warn(`Không chuyển được tài liệu ${documentId} vào Thùng rác: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /* ----------------------------------------------------------- cấu hình */

  async settings(actor: CorrespondenceActor): Promise<CorrespondenceSettings> {
    return this.store.settings(actor.tenantId);
  }

  async saveSettings(actor: CorrespondenceActor, input: CorrespondenceSettings): Promise<CorrespondenceSettings> {
    if (!actor.canManage && !actor.isTenantAdmin) {
      throw new CorrespondenceForbiddenError('Chỉ quản trị văn thư sửa được cấu hình sổ.');
    }
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

  /* ------------------------------------------------------------ nội bộ */

  /**
   * Khoá công văn, kiểm người xem thấy được và được làm `action` ở bước vừa khoá,
   * rồi chạy `work`. Có quyền ở bước khác thì là xung đột (người khác vừa chuyển bước).
   */
  private async transition<T>(
    actor: CorrespondenceActor,
    letterId: string,
    action: Exclude<keyof LetterActions, 'attachKinds'>,
    work: (tx: LetterTransaction) => Promise<T>,
  ): Promise<T> {
    const viewer = await this.viewer(actor);
    return this.store.withLetter(actor.tenantId, letterId, async (tx) => {
      const facts = factsOf(tx);
      if (!canViewLetter(viewer, facts)) throw new LetterNotFoundError();
      if (!letterActions(viewer, facts)[action]) {
        const anyStage = LETTER_STAGES.some((stage) => letterActions(viewer, { ...facts, stage })[action]);
        if (anyStage) throw new LetterStageConflictError();
        throw new CorrespondenceForbiddenError();
      }
      return work(tx);
    });
  }

  /** Phòng ban nhận dự thảo (chỉ với loại `draft`), sau khi kiểm loại tệp được phép ở bước này. */
  private attachTarget(
    viewer: LetterViewer,
    facts: LetterRecord & { readonly assignments: readonly AssignmentRecord[] },
    kind: AttachmentKind,
    assignmentId: string | undefined,
  ): AssignmentRecord | undefined {
    if (!letterActions(viewer, facts).attachKinds.includes(kind)) {
      throw new CorrespondenceForbiddenError(`Bạn không đính kèm được ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()} ở bước này.`);
    }
    if (kind !== 'draft') return undefined;
    const assignment = facts.assignments.find((item) => item.id === assignmentId);
    if (!assignment || !canRespondFor(viewer, facts, assignment)) {
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
    const [letter, assignments, attachment] = await Promise.all([
      this.store.findLetter(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
      this.store.findAttachment(actor.tenantId, attachmentId),
    ]);
    if (!letter || !canViewLetter(viewer, { ...letter, assignments })) throw new LetterNotFoundError();
    if (!attachment || attachment.letterId !== letterId) throw new AttachmentNotFoundError();
    return { letter, attachment };
  }

  private async viewer(actor: CorrespondenceActor): Promise<LetterViewer> {
    const snapshot = await this.organization.snapshot(actor.tenantId);
    return {
      userId: actor.userId,
      isClerk: isClerk(actor),
      isTenantAdmin: actor.isTenantAdmin,
      unitIds: membershipNodes(snapshot, actor.userId),
    };
  }

  private visibility(viewer: LetterViewer) {
    return viewer.isClerk ? undefined : { userId: viewer.userId, unitIds: [...viewer.unitIds] };
  }

  private async summaries(
    actor: CorrespondenceActor,
    viewer: LetterViewer,
    rows: readonly LetterListRow[],
  ): Promise<LetterSummary[]> {
    const names = await this.store.userNames(
      actor.tenantId,
      rows.flatMap((row) => [row.receivedBy, row.leaderUserId].filter((value): value is string => Boolean(value))),
    );
    return rows.map((row) => summaryOf(row, row, viewer, names));
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

function factsOf(tx: LetterTransaction): LetterRecord & { readonly assignments: readonly AssignmentRecord[] } {
  return { ...tx.letter, assignments: tx.assignments };
}

function summaryOf(
  letter: LetterRecord,
  facts: LetterFacts,
  viewer: LetterViewer,
  names: ReadonlyMap<string, string>,
): LetterSummary {
  const done = facts.assignments.filter((item) => item.status === 'submitted').length;
  return {
    id: letter.id,
    incomingNo: letter.incomingNo,
    receivedOn: letter.receivedOn,
    senderOrg: letter.senderOrg,
    senderRef: letter.senderRef,
    senderDate: letter.senderDate,
    subject: letter.subject,
    kind: letter.kind,
    urgency: letter.urgency,
    confidentiality: letter.confidentiality,
    dueOn: letter.dueOn,
    stage: letter.stage,
    leaderUserId: letter.leaderUserId,
    leaderName: letter.leaderUserId ? names.get(letter.leaderUserId) : undefined,
    assignmentsDone: done,
    assignmentsTotal: facts.assignments.length,
    outgoingNo: letter.outgoingNo,
    publishedOn: letter.publishedOn,
    recipient: letter.recipient,
    archiveCode: letter.archiveCode,
    archivedOn: letter.archivedOn,
    receivedBy: letter.receivedBy,
    receivedByName: names.get(letter.receivedBy),
    updatedAt: letter.updatedAt,
    awaitingMe: awaitsViewer(viewer, facts),
  };
}

function attachmentView(
  attachment: AttachmentRecord,
  names: ReadonlyMap<string, string>,
  canDelete: boolean,
): LetterAttachment {
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

function unitPath(nodes: ReadonlyMap<string, { name: string; parentId?: string }>, nodeId: string): string {
  const names: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = nodes.get(nodeId)?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node) break;
    names.unshift(node.name);
    current = node.parentId;
  }
  return names.join(' › ');
}

function archiveNote(letter: LetterRecord): string {
  const parts = [`Hồ sơ ${letter.archiveCode}`, `Số đến ${letter.incomingNo}`];
  if (letter.outgoingNo) parts.push(`Số đi ${letter.outgoingNo}`);
  parts.push(`Trích yếu: ${letter.subject}`);
  return parts.join(' · ').slice(0, 2000);
}

/** " Hạn xử lý 25/11/2026." hoặc chuỗi rỗng. */
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
