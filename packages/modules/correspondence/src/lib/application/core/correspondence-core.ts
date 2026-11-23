import {
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  ENVELOPE_STATUSES,
  MAX_DELEGATIONS,
  activeDelegations,
  CORRESPONDENCE_EVENTS,
  DEFAULT_CORRESPONDENCE_SETTINGS,
  FLOW_END_NAMES,
  LETTER_STAGES,
  conditionSet,
  matchesCondition,
  LETTER_STAGE_LABELS,
  MAX_CLERKS,
  REVOKE_KIND_LABELS,
  isOpenStage,
  letterDeepLink,
  stepTypeOf,
  letterTitle,
  type ApproverRule,
  type AssignmentRole,
  type CatalogItem,
  type CatalogKind,
  type CorrespondenceSettings,
  type Delegation,
  type IntakeCheck,
  type DispatchUnit,
  type LetterDetail,
  type LetterDirection,
  type LetterSummary,
  type Workflow,
} from '@enterprise-platform/contracts-correspondence';
import { Logger } from '@nestjs/common';
import { chooseCandidates, normalizeRule, resolveAssignees, type ApproverContext } from '../../domain/approvers.js';
import { letterNumber, pickRegister } from '../../domain/numbering.js';
import {
  AttachmentNotFoundError,
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import {
  canAssignHandler,
  canDeleteAttachment,
  canRespondFor,
  supportPending,
  canViewLetter,
  formatArchiveCode,
  letterActions,
  vietnamToday,
  type LetterFacts,
  type LetterViewer,
} from '../../domain/letter-rules.js';
import {
  headedUnits,
  memberUnits,
  unitHeads,
  unitMembers,
  type OrganizationSnapshot,
} from '../../domain/organization.js';
import {
  type AssignmentRecord,
  type AttachmentRecord,
  type CorrespondenceActor,
  type CorrespondenceStore,
  type FileStore,
  type LetterPatch,
  type LetterRecord,
  type LetterTransaction,
  type OrganizationReader,
  type OutboxEvent,
  type StepRecord,
} from '../ports.js';
import {
  MAX_UNITS_PER_LETTER,
  PLANNING_STAGES,
  ROUTE_PERMISSIONS,
  type Catalog,
  type Row,
  type Loaded,
  type AdvanceInput,
  type FlowStep,
  conditionWeight,
  applicableSteps,
  txRow,
  facts,
  handlingUnits,
  canAddVersion,
  sortedSteps,
  nextWaiting,
  firstActive,
  displayNo,
  withNo,
  fixedPeople,
  stepPeople,
  lastSubmittedAt,
  revokeNode,
  flowOf,
  summaryOf,
  attachmentView,
  participants,
  archiveNote,
  dueText,
  optionalText,
  requireDate,
  optionalDate,
  requireEnum,
} from './letter-helpers.js';

/**
 * Lõi của Văn thư: phụ thuộc (kho dữ liệu, kho tệp, sơ đồ tổ chức, ngày hiện tại) và các bước
 * dùng chung cho mọi nghiệp vụ: khoá công văn trong transaction, chuyển bước, kích hoạt bước,
 * đóng công văn, chọn quy trình, quyền xem, dựng bản tóm tắt, ghi sự kiện thông báo.
 *
 * Mỗi nhóm nghiệp vụ (`../letters/*.service.ts`) kế thừa lớp này; `detail` nằm ở đây vì mọi thao
 * tác trả về chi tiết công văn sau khi làm xong. Tách nguyên văn từ `CorrespondenceService` cũ,
 * không đổi logic.
 */
export abstract class CorrespondenceCore {
  protected readonly logger = new Logger('CorrespondenceService');

  constructor(
    protected readonly store: CorrespondenceStore,
    protected readonly files: FileStore,
    protected readonly organization: OrganizationReader,
    protected readonly today: () => string = () => vietnamToday(),
  ) {}

  async detail(actor: CorrespondenceActor, letterId: string): Promise<LetterDetail> {
    const viewer = await this.viewer(actor);
    const letter = await this.store.findLetter(actor.tenantId, letterId);
    if (!letter) throw new LetterNotFoundError();
    const [catalog, steps, assignments, attachments, comments, history, organization, leaders, settings, workflows] = await Promise.all([
      this.catalogMap(actor.tenantId),
      this.store.steps(actor.tenantId, letterId),
      this.store.assignments(actor.tenantId, letterId),
      this.store.attachments(actor.tenantId, letterId),
      this.store.comments(actor.tenantId, letterId),
      this.store.history(actor.tenantId, letterId),
      this.organization.snapshot(actor.tenantId),
      this.store.leaders(actor.tenantId),
      this.settingsOrDefault(actor.tenantId),
      this.store.workflows(actor.tenantId).catch(() => [] as Workflow[]),
    ]);
    const row: Row = { ...letter, steps, assignments, mentionedUserIds: comments.flatMap((item) => item.mentionedUserIds) };
    const letterFacts = facts(row, catalog);
    if (!canViewLetter(viewer, letterFacts)) throw new LetterNotFoundError();

    // Còn ở ô đầu thì vẽ theo quy trình sẽ áp dụng; đã chuyển bước thì theo các bước đã chép.
    const planned = PLANNING_STAGES.includes(letter.stage)
      ? await this.pickWorkflow(actor.tenantId, letter).catch(() => undefined)
      : undefined;
    const workflow = planned ?? workflows.find((item) => item.id === letter.workflowId);
    const flowSteps: FlowStep[] = planned
      ? applicableSteps(planned, letter).map((step, index) => ({
          seq: index + 1,
          name: step.name,
          kind: stepTypeOf(step),
          approver: step.approver,
          status: 'waiting',
          assigneeUserIds: [],
        }))
      : steps;
    const context: ApproverContext = {
      organization,
      leaders,
      handlingUnitIds: handlingUnits(letter, assignments),
    };
    const expected = new Map(
      flowSteps
        .filter((step) => step.kind === 'approve' && step.approver && (step.status === 'waiting' || step.status === 'skipped'))
        .map((step) => [step.seq, step.chosenUserId ? [step.chosenUserId] : resolveAssignees(step.approver as ApproverRule, context)]),
    );

    const related = letter.relatedLetterId ? await this.store.findLetter(actor.tenantId, letter.relatedLetterId) : undefined;
    const names = await this.store.userNames(actor.tenantId, [
      letter.receivedBy,
      ...(letter.authorUserId ? [letter.authorUserId] : []),
      ...steps.flatMap((step) => [...step.assigneeUserIds, ...(step.approvedBy ?? []), ...(step.actedBy ? [step.actedBy] : [])]),
      ...[...expected.values()].flat(),
      ...assignments.flatMap((item) => [item.submittedBy, item.handlerUserId].filter((id): id is string => Boolean(id))),
      ...attachments.map((item) => item.uploadedBy),
      ...comments.flatMap((item) => [item.authorId, ...item.mentionedUserIds]),
      ...history.map((item) => item.actorUserId).filter((id): id is string => Boolean(id)),
      ...settings.clerkUserIds,
      ...(letter.revokeRequestedBy ? [letter.revokeRequestedBy] : []),
      ...(letter.revokeApproverIds ?? []),
      ...(letter.addressedUserId ? [letter.addressedUserId] : []),
      ...(letter.closerIds ?? []),
      ...(letter.directive?.by ? [letter.directive.by] : []),
      ...(letter.directive?.units ?? []).map((unit) => unit.handlerUserId).filter((id): id is string => Boolean(id)),
    ]);
    const nameOf = (userId: string) => names.get(userId) ?? 'Người dùng';
    const byId = new Map(assignments.map((item) => [item.id, item]));
    const actions = letterActions(viewer, {
      ...letterFacts,
      waitingUserIds: await this.nextStepPeople(actor.tenantId, letter, steps, assignments),
    });
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
      envelopeStatus: letter.envelopeStatus,
      sealed: letter.sealed,
      pageCount: letter.pageCount,
      copyCount: letter.copyCount,
      addressedTo: letter.addressedTo,
      addressedUserId: letter.addressedUserId,
      addressedUserName: letter.addressedUserId ? names.get(letter.addressedUserId) : undefined,
      personal: letter.personal || undefined,
      chosenWorkflowId: letter.chosenWorkflowId,
      directive: letter.directive
        ? {
            ...letter.directive,
            byName: letter.directive.by ? names.get(letter.directive.by) : undefined,
            units: letter.directive.units.map((unit) => ({
              ...unit,
              handlerName: unit.handlerUserId ? names.get(unit.handlerUserId) : undefined,
            })),
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
        type: step.kind,
        approver: step.approver,
        directs: step.directs,
        mode: step.mode,
        ...(step.units?.length ? { units: step.units, lockUnits: step.lockUnits || undefined } : {}),
        ...(step.mode === 'all'
          ? {
              approvedBy: (step.approvedBy ?? []).map((userId) => ({ userId, name: names.get(userId) })),
              requiredCount: (step.requiredUserIds?.length ? step.requiredUserIds : step.assigneeUserIds).length,
            }
          : {}),
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
          kind: step.kind,
          status: step.status,
          at: step.status === 'done' ? (step.actedAt ?? (step.kind === 'process' ? lastSubmittedAt(assignments) : undefined)) : undefined,
          people: stepPeople(step, {
            nameOf,
            assignments,
            clerkUserIds: settings.clerkUserIds,
            expected: expected.get(step.seq) ?? [],
            direction: letter.direction,
          }),
        })),
        fixedPeople(letter, nameOf, history, letter.closerIds && letter.closerIds.length > 0 ? letter.closerIds : settings.clerkUserIds),
        revokeNode(letter, history, nameOf),
        { start: workflow?.startName, end: workflow?.endName },
      ),
      assignments: assignments.map((item) => ({
        id: item.id,
        unitId: item.unitId,
        unitName: item.unitName,
        role: item.role,
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
        waitingFor: supportPending({ steps, assignments }, item).map((other) => other.unitName),
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
   * Người được giao bước kế tiếp (đang chờ bước hiện tại xong): bước duyệt / kiểm tra có người riêng thì giải
   * theo luật của bước; hết bước thì người làm ô cuối đã cấu hình. Không giải được thì không ai.
   */
  protected async nextStepPeople(
    tenantId: string,
    letter: LetterRecord,
    steps: readonly StepRecord[],
    assignments: readonly AssignmentRecord[],
  ): Promise<string[]> {
    if (!isOpenStage(letter.stage) || letter.stage === 'received' || letter.stage === 'drafting') return [];
    const active = steps.find((item) => item.status === 'active');
    if (!active) return [];
    const next = sortedSteps(steps).find((item) => item.seq > active.seq && item.status === 'waiting');
    if (!next) return [...(letter.closerIds ?? [])];
    if (next.kind === 'process' || !next.approver) return [];
    try {
      return resolveAssignees(next.approver, await this.approverContext(tenantId, letter, assignments, next.chosenUserId));
    } catch {
      return [];
    }
  }

  /** Ủy quyền duyệt: người dùng đang hoạt động, khác nhau, khoảng ngày hợp lệ. */
  protected async delegationList(tenantId: string, raw: unknown): Promise<Delegation[]> {
    const items = Array.isArray(raw) ? raw : [];
    if (items.length > MAX_DELEGATIONS) throw new CorrespondenceValidationError(`Tối đa ${MAX_DELEGATIONS} ủy quyền.`);
    if (items.length === 0) return [];
    const people = new Set((await this.store.people(tenantId)).map((person) => person.userId));
    return items.map((entry, index) => {
      const value = (entry ?? {}) as Record<string, unknown>;
      const fromUserId = String(value['fromUserId'] ?? '').trim();
      const toUserId = String(value['toUserId'] ?? '').trim();
      const label = `Ủy quyền ${index + 1}`;
      if (!people.has(fromUserId) || !people.has(toUserId)) throw new CorrespondenceValidationError(`${label}: chọn người ủy quyền và người được ủy quyền đang hoạt động.`);
      if (fromUserId === toUserId) throw new CorrespondenceValidationError(`${label}: người được ủy quyền phải khác người ủy quyền.`);
      const fromDate = requireDate(value['fromDate'], `${label}: từ ngày`);
      const toDate = requireDate(value['toDate'], `${label}: đến ngày`);
      if (toDate < fromDate) throw new CorrespondenceValidationError(`${label}: đến ngày phải sau từ ngày.`);
      const note = optionalText(value['note'], `${label}: ghi chú`, 500);
      return { fromUserId, toUserId, fromDate, toDate, ...(note ? { note } : {}) };
    });
  }

  /** Người làm văn thư: người dùng đang hoạt động của tenant, không trùng, tối đa MAX_CLERKS. */
  protected async clerkList(tenantId: string, raw: unknown): Promise<string[]> {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map((item) => String(item ?? '').trim()).filter(Boolean))];
    if (ids.length > MAX_CLERKS) throw new CorrespondenceValidationError(`Chỉ định tối đa ${MAX_CLERKS} người làm văn thư.`);
    if (ids.length === 0) return [];
    const active = new Set((await this.store.people(tenantId)).map((person) => person.userId));
    if (ids.some((id) => !active.has(id))) throw new CorrespondenceValidationError('Người làm văn thư được chọn không còn hoạt động.');
    return ids;
  }

  /** Phân loại sơ bộ lúc tiếp nhận: chỉ ghi trường có trong yêu cầu. */
  protected async intakeCheck(tenantId: string, input: IntakeCheck | undefined, letter: LetterRecord): Promise<LetterPatch> {
    const value = input ?? {};
    const patch: { -readonly [K in keyof LetterPatch]: LetterPatch[K] } = {};
    if (value.envelopeStatus !== undefined) {
      patch.envelopeStatus = value.envelopeStatus ? requireEnum(value.envelopeStatus, ENVELOPE_STATUSES, 'Tình trạng bì') : undefined;
    }
    if (value.sealed !== undefined) patch.sealed = value.sealed === true;
    const count = (raw: unknown, label: string, max: number) => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 0 || number > max) throw new CorrespondenceValidationError(`${label} là số từ 0 đến ${max}.`);
      return number;
    };
    if (value.pageCount !== undefined) patch.pageCount = count(value.pageCount, 'Số tờ', 10000);
    if (value.copyCount !== undefined) patch.copyCount = count(value.copyCount, 'Số bản', 1000);
    if (value.addressedTo !== undefined) patch.addressedTo = optionalText(value.addressedTo, 'Gửi đích danh', 255);
    if (value.addressedUserId !== undefined) {
      const userId = optionalText(value.addressedUserId, 'Người nhận đích danh', 64);
      if (userId && !(await this.store.people(tenantId)).some((person) => person.userId === userId)) {
        throw new CorrespondenceValidationError('Người nhận đích danh không còn hoạt động.');
      }
      patch.addressedUserId = userId;
    }
    void letter;
    return patch;
  }

  /**
   * Quy trình bật "tự chuyển bước đầu khi vào sổ" và chuyển được ngay (không cần người chọn): bước
   * đầu là phòng ban xử lý thì giao phòng ban gợi ý của loại văn bản (cấu hình không bắt chọn người
   * xử lý); bước duyệt để người trình chọn người thì không tự chuyển. Không được thì văn thư chuyển tay.
   */
  protected async autoStartPlan(
    tenantId: string,
    settings: CorrespondenceSettings,
    catalog: Catalog,
    codes: Pick<LetterRecord, 'kind' | 'urgency' | 'confidentiality' | 'chosenWorkflowId'>,
  ): Promise<{ readonly workflow: Workflow; readonly units?: readonly DispatchUnit[] } | undefined> {
    const kind = codes.kind;
    const workflow = await this.pickWorkflow(tenantId, { direction: 'incoming', ...codes }).catch(() => undefined);
    if (!workflow?.autoStart) return undefined;
    const steps = applicableSteps(workflow, codes).map((step) => ({ ...step, type: stepTypeOf(step) }));
    const first = steps[0];
    const firstApproval = first?.type === 'process' ? steps[1] : first;
    if (firstApproval?.type === 'approve' && firstApproval.approver?.type === 'choose') return undefined;
    if (first?.type !== 'process') return { workflow };
    // Bước đầu có phòng ban cố định: giao đúng các phòng đó.
    if (first.units?.length) return { workflow, units: first.units };
    if (settings.dispatchMode === 'handler') return undefined;
    const snapshot = await this.organization.snapshot(tenantId);
    const units = (catalog.get('letter_type')?.get(kind)?.defaultUnitIds ?? []).filter((unitId) =>
      snapshot.nodes.some((node) => node.id === unitId && node.kind === 'unit') && unitMembers(snapshot, unitId).length > 0,
    );
    if (units.length === 0) return undefined;
    return { workflow, units: units.map((unitId, index) => ({ unitId, role: index === 0 ? ('lead' as const) : ('support' as const) })) };
  }

  /** Thêm người được ủy quyền (đang hiệu lực hôm nay) của những người được giao. */
  protected async withDelegates(tenantId: string, assignees: readonly string[]): Promise<string[]> {
    const settings = await this.settingsOrDefault(tenantId);
    const delegates = activeDelegations(settings.delegations, this.today())
      .filter((item) => assignees.includes(item.fromUserId))
      .map((item) => item.toUserId);
    return [...new Set([...assignees, ...delegates])];
  }

  /** Người làm ô cuối: luật như bước duyệt, trừ "để người trình chọn" (không ai chọn lúc đó). */
  protected endActorRule(raw: unknown): ApproverRule {
    const rule = normalizeRule(raw, 'Ô cuối');
    if (rule.type === 'choose') throw new CorrespondenceValidationError('Ô cuối không dùng được luật "để người trình chọn"; chọn người, chức danh hay trưởng đơn vị cụ thể.');
    return rule;
  }

  protected requireConfigure(actor: CorrespondenceActor): void {
    if (!actor.canConfigure && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền cấu hình văn thư.');
  }

  /** Khoá công văn, kiểm người xem thấy được, rồi chạy `work`. */
  protected async inLetter<T>(
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
  protected async transition<T>(
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
          (step) =>
            (step.kind ?? 'approve') === 'approve' &&
            step.status !== 'active' &&
            (step.actedBy === viewer.userId || step.assigneeUserIds.includes(viewer.userId)),
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
  protected async finalApprovers(actor: CorrespondenceActor, tx: LetterTransaction): Promise<string[]> {
    const last = [...tx.steps]
      .filter((step) => step.status === 'done' && step.kind === 'approve')
      .sort((left, right) => right.seq - left.seq)[0];
    if (!last) return [];
    const rule = last.approver;
    const pick = last.chosenUserId ?? (rule?.type === 'choose' ? last.actedBy : undefined);
    const resolved = await this.approverContext(actor.tenantId, tx.letter, tx.assignments, pick)
      .then((context) => (rule ? resolveAssignees(rule, context) : []))
      .catch(() => [] as string[]);
    if (resolved.length > 0) return this.withDelegates(actor.tenantId, resolved);
    return last.actedBy ? [last.actedBy] : [...new Set(last.assigneeUserIds)];
  }

  /**
   * Sang bước chờ kế tiếp sau `fromSeq` (0 là bước đầu); hết bước thì chờ văn thư hoàn tất / ban
   * hành. `restart`: chuyển từ ô đầu, phòng ban còn treo của lượt trước được bỏ.
   */
  protected async advance(actor: CorrespondenceActor, tx: LetterTransaction, fromSeq: number, input: AdvanceInput): Promise<void> {
    const next = nextWaiting(tx, fromSeq);
    if (next) await this.activate(actor, tx, next, input);
    else await this.finishApprovals(actor, tx);
  }

  /**
   * Ô cuối: công văn đến hoàn tất, công văn đi đánh số đi và ban hành; cấp số hồ sơ lưu trữ nếu
   * quy trình bật lưu trữ. Dùng cho người làm ô cuối bấm, và cho quy trình tự hoàn tất.
   */
  protected async closeLetter(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    input: {
      readonly note?: string;
      readonly recipient?: string;
      readonly publishedOn?: string;
      readonly deliveryMethod?: string;
      readonly auto?: boolean;
      readonly registerId?: string;
      readonly signerUserId?: string;
      readonly signerName?: string;
      readonly signerTitle?: string;
      readonly copyCount?: number;
      readonly internalUnitIds?: readonly string[];
    },
  ): Promise<LetterRecord> {
    const [settings, workflows] = await Promise.all([this.store.settings(actor.tenantId), this.store.workflows(actor.tenantId)]);
    const workflow = workflows.find((item) => item.id === tx.letter.workflowId);
    const archivedOn = this.today();
    // Thư riêng chuyển người nhận không lập hồ sơ lưu trữ.
    const archiveCode = workflow?.archive === false || tx.letter.personal ? undefined : await this.archiveCode(tx, settings, archivedOn);
    const kept = archiveCode ? `; lưu trữ hồ sơ số ${archiveCode}` : '';
    const how = input.auto ? 'Tự động: ' : '';
    if (tx.letter.direction === 'incoming') {
      const updated = await tx.update({ stage: 'archived', archiveCode, archivedOn: archiveCode ? archivedOn : undefined, completionNote: input.note });
      await tx.history({
        action: 'complete',
        summary: tx.letter.personal ? 'Người nhận đích danh đã nhận thư' : `${how}Hoàn tất${kept}`,
        note: input.note,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.completed, updated, actor, participants(tx), {
          summary: `Công văn ${letterTitle(withNo(updated))} đã hoàn tất${archiveCode ? `, lưu trữ số ${archiveCode}` : ''}.`,
          archiveCode: archiveCode ?? null,
        }),
      );
      return updated;
    }
    const recipient = input.recipient ?? tx.letter.recipient ?? '';
    const publishedOn = input.publishedOn ?? archivedOn;
    // Số đi theo sổ đăng ký (văn bản mật vào sổ mật) và mẫu số của loại văn bản / của sổ.
    const [registers, catalog, snapshot] = await Promise.all([
      this.store.registers(actor.tenantId),
      this.catalogMap(actor.tenantId),
      this.organization.snapshot(actor.tenantId),
    ]);
    // Phát hành nội bộ: phòng nhận được xem (nhận để biết) và được báo. Kiểm trước khi cấp số.
    const internal = (input.internalUnitIds ?? []).map((unitId) => {
      const unit = snapshot.nodes.find((node) => node.id === unitId && node.kind === 'unit');
      if (!unit) throw new CorrespondenceValidationError('Phòng nhận nội bộ không có trong sơ đồ tổ chức.');
      return { unitId, unitName: unit.name, role: 'info' as const };
    });
    const register = pickRegister(
      registers,
      'outgoing',
      { kind: tx.letter.kind, restricted: Boolean(catalog.get('confidentiality')?.get(tx.letter.confidentiality)?.restricted) },
      input.registerId,
    );
    const year = Number(publishedOn.slice(0, 4));
    const outgoingNo = letterNumber(register, catalog.get('letter_type')?.get(tx.letter.kind), settings, {
      seq: await tx.nextRegisterNumber(register.id, year),
      year,
      unitId: tx.letter.authorUnitId,
      unitName: tx.letter.authorUnitName,
    });
    // Người ký: người được chọn, không thì người duyệt bước duyệt cuối; chức vụ theo sơ đồ tổ chức nếu không ghi.
    const lastApprover = [...tx.steps].reverse().find((step) => step.kind === 'approve' && step.status === 'done' && step.actedBy)?.actedBy;
    const signerUserId = input.signerUserId ?? (input.signerName ? undefined : lastApprover);
    const signerName =
      input.signerName ?? (signerUserId ? (await this.store.userNames(actor.tenantId, [signerUserId])).get(signerUserId) : undefined);
    const signerTitle =
      input.signerTitle ?? (signerUserId ? snapshot.members.find((member) => member.userId === signerUserId)?.positionName : undefined);
    if (internal.length > 0) await tx.assign(internal);
    const updated = await tx.update({
      stage: 'archived',
      outgoingNo,
      registerId: register.id,
      signerUserId,
      signerName,
      signerTitle,
      ...(input.copyCount !== undefined ? { copyCount: input.copyCount } : {}),
      publishedOn,
      recipient,
      deliveryMethod: input.deliveryMethod,
      deliveryStatus: 'sent',
      deliveryNote: input.note,
      archiveCode,
      archivedOn: archiveCode ? archivedOn : undefined,
    });
    await tx.history({
      action: 'publish',
      summary: `${how}Đánh số ${outgoingNo} (${register.name}), ban hành gửi ${recipient}${
        internal.length > 0 ? `; nội bộ: ${internal.map((unit) => unit.unitName).join(', ')}` : ''
      }${input.deliveryMethod ? ` (${input.deliveryMethod})` : ''}${kept}`,
      note: input.note,
      actorUserId: actor.userId,
    });
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.published, updated, actor, [...participants(tx), ...internal.flatMap((unit) => [...unitHeads(snapshot, unit.unitId), ...unitMembers(snapshot, unit.unitId).map((member) => member.userId)])], {
        summary: `Công văn đi ${outgoingNo} (${updated.subject}) đã ban hành, gửi ${recipient}.`,
        outgoingNo,
      }),
    );
    return updated;
  }

  /** Duyệt xong: công văn đến chờ văn thư hoàn tất, công văn đi chờ văn thư ban hành. */
  protected async finishApprovals(actor: CorrespondenceActor, tx: LetterTransaction): Promise<void> {
    const incoming = tx.letter.direction === 'incoming';
    const workflow = (await this.store.workflows(actor.tenantId)).find((item) => item.id === tx.letter.workflowId);
    if (workflow?.autoEnd) {
      // Quy trình tự hoàn tất / tự ban hành khi xong bước cuối.
      const closed = await this.closeLetter(actor, tx, { auto: true });
      await this.recordArchive(actor, closed);
      return;
    }
    // Người làm ô cuối theo cấu hình; không cấu hình (hay không giải được người) thì văn thư.
    const closers = workflow?.endActor
      ? await this.approverContext(actor.tenantId, tx.letter, tx.assignments)
          .then((context) => resolveAssignees(workflow.endActor as ApproverRule, context))
          .then((ids) => this.withDelegates(actor.tenantId, ids))
          .catch(() => [] as string[])
      : [];
    const clerks = closers.length > 0 ? { recipients: closers, notifyPermissions: [] as string[] } : await this.clerkTargets(actor.tenantId, incoming ? ROUTE_PERMISSIONS.archive : ROUTE_PERMISSIONS.publish);
    const end = workflow?.endName || FLOW_END_NAMES[tx.letter.direction];
    const letter = await tx.update({ stage: incoming ? 'closing' : 'publishing', closerIds: closers });
    const owner = incoming ? [letter.receivedBy] : letter.authorUserId ? [letter.authorUserId] : [];
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.approved, letter, actor, [...owner, ...clerks.recipients], {
        summary: `${incoming ? 'Công văn' : 'Công văn đi'} ${letterTitle(withNo(letter))} đã qua đủ các bước; chờ "${end}".`,
        notifyPermissions: clerks.notifyPermissions,
      }),
    );
  }

  /**
   * Bắt đầu một bước, theo loại:
   * - duyệt: giải người duyệt theo sơ đồ tổ chức (luật `choose` cần người đã chọn);
   * - văn thư kiểm tra: người làm văn thư được chỉ định (không chỉ định thì người có quyền);
   * - phòng ban xử lý: phòng ban do người làm bước liền trước chọn (`input.units`); bước duyệt
   *   ngay sau để người trình chọn người thì chọn luôn lúc này.
   * Báo người được giao, trừ khi nơi gọi đã báo qua sự kiện khác.
   */
  protected async activate(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    step: StepRecord,
    input: AdvanceInput,
    options: { readonly notify?: boolean } = {},
  ): Promise<void> {
    if (step.kind === 'process') return this.activateProcess(actor, tx, step, input, options);
    // Bước kiểm tra không giao người riêng: người làm văn thư.
    if (step.kind === 'check' && !step.approver) {
      const settings = await this.settingsOrDefault(actor.tenantId);
      await tx.updateStep(step.id, {
        status: 'active',
        activate: true,
        assigneeUserIds: settings.clerkUserIds,
        actedBy: null,
        decision: null,
        note: null,
      });
      const letter = await tx.update({ stage: 'checking' });
      if (options.notify === false) return;
      const clerks = await this.clerkTargets(actor.tenantId, ROUTE_PERMISSIONS.register);
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.sentToClerk, letter, actor, clerks.recipients, {
          summary: `${step.name}: ${letter.direction === 'incoming' ? 'công văn đến' : 'công văn đi'} ${letterTitle(withNo(letter))} chờ văn thư kiểm tra.`,
          stepName: step.name,
          notifyPermissions: clerks.notifyPermissions,
        }),
      );
      return;
    }
    const rule = step.approver;
    if (!rule) throw new CorrespondenceValidationError(`Bước "${step.name}" chưa có cách xác định người duyệt. Kiểm cấu hình quy trình.`);
    const pick = step.chosenUserId ?? input.chosen;
    if (rule.type === 'choose' && !pick) throw new CorrespondenceValidationError(`Chọn người cho bước "${step.name}".`);
    const context = await this.approverContext(actor.tenantId, tx.letter, tx.assignments, pick);
    const assignees = await this.withDelegates(actor.tenantId, resolveAssignees(rule, context));
    if (assignees.length === 0) {
      throw new CorrespondenceValidationError(
        rule.type === 'choose'
          ? `Người được chọn không thuộc nhóm của bước "${step.name}".`
          : `Bước "${step.name}" chưa xác định được người duyệt theo sơ đồ tổ chức. Kiểm cấu hình quy trình hoặc sơ đồ tổ chức.`,
      );
    }
    await tx.updateStep(step.id, {
      status: 'active',
      activate: true,
      assigneeUserIds: assignees,
      // Tất cả cùng duyệt: những người theo luật của bước (người được ủy quyền duyệt thay họ).
      requiredUserIds: step.mode === 'all' ? resolveAssignees(rule, context) : [],
      approvedBy: [],
      chosenUserId: pick ?? null,
      actedBy: null,
      decision: null,
      note: null,
    });
    const letter = await tx.update({ stage: step.kind === 'check' ? 'checking' : 'reviewing' });
    if (options.notify === false) return;
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.stepAssigned, letter, actor, assignees, {
        summary: `${step.name}: ${letter.direction === 'incoming' ? 'công văn đến' : 'công văn đi'} ${letterTitle(withNo(letter))}.${dueText(letter.dueOn)}`,
        stepName: step.name,
      }),
    );
  }

  /** Bước phòng ban xử lý: giao các phòng ban được chọn (phòng đã giao lượt trước thì sang lượt mới). */
  protected async activateProcess(
    actor: CorrespondenceActor,
    tx: LetterTransaction,
    step: StepRecord,
    input: AdvanceInput,
    options: { readonly notify?: boolean },
  ): Promise<void> {
    // Phòng ban khoá theo cấu hình bước thì luôn giao đúng các phòng đó. Không thì phòng được chọn; không chọn lại
    // thì theo bút phê của bước chỉ đạo (văn thư phân phối theo bút phê), rồi phòng ban cố định của bước.
    const chosenUnits = step.lockUnits && step.units?.length
      ? step.units
      : Array.isArray(input.units) && input.units.length > 0
        ? input.units
        : tx.letter.directive?.units?.length
          ? tx.letter.directive.units
          : (step.units ?? []);
    if (chosenUnits.length === 0) {
      throw new CorrespondenceValidationError(`Chọn phòng ban xử lý cho bước "${step.name}".`);
    }
    const [settings, snapshot] = await Promise.all([this.store.settings(actor.tenantId), this.organization.snapshot(actor.tenantId)]);
    const units = this.dispatchUnits(snapshot, settings, chosenUnits);
    if (!units.some((unit) => unit.role !== 'info')) {
      throw new CorrespondenceValidationError(`Bước "${step.name}": chọn ít nhất một phòng chủ trì hoặc phối hợp, không chỉ phòng nhận để biết.`);
    }
    const dueOn = optionalDate(input.dueOn, 'Thời hạn hoàn thành') ?? (input.units ? undefined : tx.letter.directive?.dueOn);
    if (dueOn && dueOn < tx.letter.receivedOn) throw new CorrespondenceValidationError('Thời hạn hoàn thành không được trước ngày đến.');
    await this.preselect(actor.tenantId, tx, step.seq, input.chosen, units.map((unit) => unit.unitId));
    const keep = new Set(units.map((unit) => unit.unitId));
    // Phòng còn treo mà lần này không được chọn (giao lại từ ô đầu) thì bỏ, để không chặn bước sau.
    const dropped = tx.assignments.filter((item) => !keep.has(item.unitId) && (input.restart || item.status === 'pending'));
    if (dropped.length > 0) await tx.removeAssignments(dropped.map((item) => item.id));
    await tx.assign(units.map(({ unitId, unitName, handlerUserId, role }) => ({ unitId, unitName, handlerUserId, role })));
    await tx.updateStep(step.id, { status: 'active', activate: true, assigneeUserIds: [], actedBy: null, decision: null, note: null });
    const letter = await tx.update({
      stage: 'processing',
      instruction: input.note ?? tx.letter.directive?.note ?? tx.letter.instruction,
      ...(dueOn ? { dueOn } : {}),
    });
    await tx.history({
      action: 'dispatch',
      summary: `${step.name}: giao ${units
        .map((unit) => `${unit.unitName}${unit.handlerName ? ` – ${unit.handlerName}` : ''} (${ASSIGNMENT_ROLE_LABELS[unit.role].toLowerCase()})`)
        .join(', ')}`,
      note: input.note,
      actorUserId: actor.userId,
    });
    if (options.notify === false) return;
    await tx.outbox(
      this.event(CORRESPONDENCE_EVENTS.assigned, letter, actor, units.flatMap((unit) => unit.recipients), {
        summary: `Công văn ${letterTitle(withNo(letter))} được giao xử lý (${step.name}).${input.note ? ` ${input.note}` : ''}${dueText(letter.dueOn)}`,
        unitNames: units.map((unit) => unit.unitName),
      }),
    );
  }

  /**
   * Bước duyệt ngay sau bước phòng ban xử lý mà để người trình chọn người: chọn ngay lúc giao
   * phòng ban (phòng ban gửi đủ kết quả là tự chuyển bước), kiểm thuộc nhóm.
   */
  protected async preselect(
    tenantId: string,
    tx: LetterTransaction,
    afterSeq: number,
    chosen: string | undefined,
    handlingUnitIds: readonly string[],
  ): Promise<void> {
    const following = nextWaiting(tx, afterSeq);
    if (!following || following.kind !== 'approve' || following.approver?.type !== 'choose' || following.chosenUserId) return;
    if (!chosen) throw new CorrespondenceValidationError(`Chọn người cho bước "${following.name}".`);
    const context = await this.approverContext(tenantId, tx.letter, handlingUnitIds.map((unitId) => ({ unitId })), chosen);
    if (!chooseCandidates(following.approver, context).some((candidate) => candidate.userId === chosen)) {
      throw new CorrespondenceValidationError(`Người được chọn không thuộc nhóm của bước "${following.name}".`);
    }
    await tx.updateStep(following.id, { chosenUserId: chosen });
  }

  /** Các bước sau `afterSeq` (không có thì mọi bước) về chưa tới, giữ người đã chọn, để chạy lại. */
  protected async resetSteps(tx: LetterTransaction, afterSeq = 0): Promise<void> {
    for (const step of tx.steps.filter(
      (item) => item.seq > afterSeq && (item.status !== 'waiting' || item.assigneeUserIds.length > 0 || (item.approvedBy?.length ?? 0) > 0),
    )) {
      await tx.updateStep(step.id, { status: 'waiting', assigneeUserIds: [], approvedBy: [] });
    }
  }

  protected async archiveCode(tx: LetterTransaction, settings: CorrespondenceSettings, on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return formatArchiveCode(settings.archivePrefix, year, await tx.nextNumber('archive', year));
  }

  /** Ghi số lưu trữ lên thư mục hồ sơ bên Hệ dùng chung; không được thì hồ sơ vẫn đã lưu. */
  protected async recordArchive(actor: CorrespondenceActor, letter: LetterRecord): Promise<void> {
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

  protected async approverContext(
    tenantId: string,
    letter: Pick<LetterRecord, 'direction' | 'authorUnitId'>,
    assignments: readonly Pick<AssignmentRecord, 'unitId'>[],
    chosenUserId?: string,
  ): Promise<ApproverContext> {
    const [organization, leaders] = await Promise.all([this.organization.snapshot(tenantId), this.store.leaders(tenantId)]);
    return { organization, leaders, handlingUnitIds: handlingUnits(letter, assignments), chosenUserId };
  }

  /** Quy trình theo cấu hình: được chỉ định, của loại văn bản, hay mặc định của luồng; phải đang dùng và đúng luồng. */
  protected async pickWorkflow(
    tenantId: string,
    letter: Pick<LetterRecord, 'direction' | 'kind'> & Partial<Pick<LetterRecord, 'urgency' | 'confidentiality' | 'chosenWorkflowId'>>,
    workflowId?: string,
  ): Promise<Workflow> {
    const [workflows, catalog] = await Promise.all([this.store.workflows(tenantId), this.catalogMap(tenantId)]);
    const type = catalog.get('letter_type')?.get(letter.kind);
    const typeWorkflow = letter.direction === 'incoming' ? type?.workflowId : type?.outgoingWorkflowId;
    const usable = workflows.filter((item) => item.isActive && item.direction === letter.direction);
    // Quy trình được chỉ định (lúc chuyển bước, hay chọn riêng cho công văn lúc tạo) thì đúng quy trình đó.
    const requested = (typeof workflowId === 'string' ? workflowId.trim() : '') || letter.chosenWorkflowId || '';
    if (requested && !usable.some((item) => item.id === requested)) {
      throw new CorrespondenceValidationError('Quy trình đã chọn cho công văn này không còn dùng hay không đúng luồng; chọn quy trình khác.');
    }
    // Quy trình có điều kiện khớp công văn chọn trước; nhiều quy trình khớp thì quy trình đặt nhiều điều kiện hơn.
    const classified = { kind: letter.kind, urgency: letter.urgency ?? '', confidentiality: letter.confidentiality ?? '' };
    const conditional = usable
      .filter((item) => conditionSet(item.conditions) && matchesCondition(item.conditions, classified))
      .sort((left, right) => conditionWeight(right.conditions) - conditionWeight(left.conditions))[0];
    const wanted =
      requested ||
      conditional?.id ||
      (usable.some((item) => item.id === typeWorkflow) ? typeWorkflow : undefined) ||
      usable.find((item) => item.isDefault)?.id;
    const workflow = usable.find((item) => item.id === wanted);
    if (!workflow) {
      throw new CorrespondenceValidationError(
        `Chưa có quy trình duyệt đang dùng cho ${letter.direction === 'incoming' ? 'công văn đến' : 'công văn đi'}. Vào Cấu hình để đặt quy trình mặc định.`,
      );
    }
    return workflow;
  }

  /** Quy trình chọn riêng lúc tạo công văn: trống là tự chọn; có thì phải là quy trình đang dùng của luồng. */
  protected async chosenWorkflow(
    tenantId: string,
    direction: LetterDirection,
    codes: Pick<LetterRecord, 'kind' | 'urgency' | 'confidentiality'>,
    raw: unknown,
  ): Promise<string | undefined> {
    const wanted = optionalText(raw, 'Quy trình', 64);
    if (!wanted) return undefined;
    return (await this.pickWorkflow(tenantId, { direction, ...codes }, wanted)).id;
  }

  /** Phòng ban khi giao: có trong sơ đồ, người xử lý thuộc phòng; người nhận thông báo theo cách giao. */
  protected dispatchUnits(snapshot: OrganizationSnapshot, settings: CorrespondenceSettings, raw: unknown) {
    const seen = new Set<string>();
    const entries = (Array.isArray(raw) ? raw : [])
      .map((entry) => (entry ?? {}) as { unitId?: unknown; handlerUserId?: unknown; role?: unknown })
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
      if (entry.role !== undefined && entry.role !== null && !(ASSIGNMENT_ROLES as readonly unknown[]).includes(entry.role)) {
        throw new CorrespondenceValidationError(`Vai trò của ${node.name} không hợp lệ.`);
      }
      return {
        unitId,
        unitName: node.name,
        role: entry.role === 'support' || entry.role === 'info' ? (entry.role as AssignmentRole) : ('lead' as const),
        handlerUserId: handler?.userId,
        handlerName: handler?.name,
        recipients: handler ? [handler.userId] : members.map((member) => member.userId),
      };
    });
  }

  protected classification(
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

  protected async loadRow(tenantId: string, letterId: string): Promise<Loaded> {
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

  protected async visibleAttachment(actor: CorrespondenceActor, letterId: string, attachmentId: string): Promise<AttachmentRecord> {
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
  protected settingsOrDefault(tenantId: string): Promise<CorrespondenceSettings> {
    return this.store
      .settings(tenantId)
      .then((settings) => ({
        ...settings,
        clerkUserIds: Array.isArray(settings.clerkUserIds) ? settings.clerkUserIds : [],
        delegations: Array.isArray(settings.delegations) ? settings.delegations : [],
      }))
      .catch(() => DEFAULT_CORRESPONDENCE_SETTINGS);
  }

  /**
   * Người được chỉ định làm văn thư trong cấu hình làm được việc của văn thư trong phân hệ
   * (tiếp nhận, soạn, kiểm tra, ban hành, lưu trữ, xem công văn không mật) dù chưa được cấp
   * quyền đó trong Phân quyền. Người cấu hình văn thư mới đặt được danh sách này.
   */
  protected async effective(actor: CorrespondenceActor, known?: CorrespondenceSettings): Promise<CorrespondenceActor> {
    const settings = known ?? (await this.settingsOrDefault(actor.tenantId));
    if (!settings.clerkUserIds.includes(actor.userId)) return actor;
    return { ...actor, canRegister: true, canCreateOutgoing: true, canPublish: true, canArchive: true, canReadAll: true };
  }

  /** Báo việc của văn thư: người làm văn thư được chỉ định, chưa chỉ định thì mọi người giữ quyền. */
  protected async clerkTargets(tenantId: string, permission: string): Promise<{ recipients: string[]; notifyPermissions: string[] }> {
    const settings = await this.settingsOrDefault(tenantId);
    return settings.clerkUserIds.length > 0
      ? { recipients: [...settings.clerkUserIds], notifyPermissions: [] }
      : { recipients: [], notifyPermissions: [permission] };
  }

  protected async viewer(original: CorrespondenceActor): Promise<LetterViewer> {
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
      unitIds: memberUnits(snapshot, actor.userId),
      headUnitIds: headedUnits(snapshot, actor.userId),
      clerkOnDuty: settings.clerkUserIds.length === 0 || settings.clerkUserIds.includes(actor.userId),
      // Văn thư hay bộ phận tổng hợp (xem báo cáo) theo dõi, đôn đốc.
      canTrack: actor.canRegister || actor.canReadReports || admin,
    };
  }

  protected visibility(viewer: LetterViewer) {
    if (viewer.isTenantAdmin || (viewer.canReadAll && viewer.canReadConfidential)) return undefined;
    return { userId: viewer.userId, unitIds: [...viewer.unitIds], readAll: viewer.canReadAll, readConfidential: viewer.canReadConfidential };
  }

  protected async catalogMap(tenantId: string): Promise<Catalog> {
    const map = new Map<CatalogKind, Map<string, CatalogItem>>();
    for (const item of await this.store.catalog(tenantId)) {
      if (!map.has(item.kind)) map.set(item.kind, new Map());
      map.get(item.kind)?.set(item.code, item);
    }
    return map;
  }

  protected catalogCode(catalog: Catalog, kind: CatalogKind, value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const code = String(value);
    const item = catalog.get(kind)?.get(code);
    if (!item || !item.isActive) throw new CorrespondenceValidationError(`${label} "${code.slice(0, 40)}" không có hoặc đã ngừng dùng.`);
    return code;
  }

  protected async summaries(actor: CorrespondenceActor, viewer: LetterViewer, catalog: Catalog, rows: readonly Row[]): Promise<LetterSummary[]> {
    const names = await this.store.userNames(
      actor.tenantId,
      rows.flatMap((row) => [
        row.receivedBy,
        ...(row.authorUserId ? [row.authorUserId] : []),
        ...(row.addressedUserId ? [row.addressedUserId] : []),
        ...row.assignments.flatMap((assignment) => [assignment.handlerUserId, assignment.submittedBy].filter((id): id is string => Boolean(id))),
        ...(row.steps.find((step) => step.status === 'active')?.assigneeUserIds ?? []),
      ]),
    );
    return rows.map((row) => summaryOf(row, catalog, viewer, names));
  }

  protected event(
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
