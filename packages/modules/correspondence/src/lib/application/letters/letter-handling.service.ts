import {
  ASSIGNMENT_ROLE_LABELS,
  activeDelegations,
  CORRESPONDENCE_EVENTS,
  FLOW_START_NAMES,
  LETTER_STAGE_LABELS,
  RETURN_TARGETS,
  letterTitle,
  returnTargetLabel,
  type ApproveStepRequest,
  type LetterDetail,
  type LetterStage,
  type NoteRequest,
  type RespondAssignmentRequest,
  type ReturnLetterRequest,
  type SubmitLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { resolveAssignees } from '../../domain/approvers.js';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import { canRespondFor, supportPending, letterActions, returnTargets } from '../../domain/letter-rules.js';
import { unitHeads, unitMembers } from '../../domain/organization.js';
import { type CorrespondenceActor, type LetterRecord } from '../ports.js';
import {
  ROUTE_PERMISSIONS,
  blockingAssignments,
  applicableSteps,
  requireActive,
  nextWaiting,
  lastDoneBefore,
  withNo,
  requireText,
  optionalText,
  optionalDate,
  requireEnum,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Xử lý và duyệt: phản hồi, văn thư kiểm tra, duyệt, trả lại, hoàn tất lưu trữ. */
export class LetterHandling extends CorrespondenceCore {
  /** Phòng ban gửi kết quả; đủ kết quả của mọi phòng thì sang bước kế tiếp của quy trình. */
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
      // Phòng chủ trì tổng hợp ý kiến phối hợp: gửi sau khi các phòng phối hợp đã gửi kết quả.
      const waiting = supportPending(tx, assignment);
      if (waiting.length > 0) {
        throw new CorrespondenceValidationError(
          `Phòng chủ trì gửi kết quả sau khi các phòng phối hợp đã gửi. Còn chờ: ${waiting.map((item) => item.unitName).join(', ')}.`,
        );
      }
      await tx.submitAssignment(assignment.id, { note, userId: actor.userId });
      await tx.history({ action: 'respond', summary: `${assignment.unitName} gửi kết quả xử lý`, note, actorUserId: actor.userId });
      // Phòng phối hợp cuối cùng vừa gửi: báo phòng chủ trì tổng hợp và gửi kết quả.
      const leads = tx.assignments.filter((item) => item.role === 'lead' && item.status === 'pending');
      if (assignment.role === 'support' && leads.length > 0 && leads.every((lead) => supportPending(tx, lead).length === 0)) {
        const snapshot = await this.organization.snapshot(actor.tenantId);
        const recipients = leads.flatMap((lead) =>
          lead.handlerUserId ? [lead.handlerUserId] : [...unitHeads(snapshot, lead.unitId), ...unitMembers(snapshot, lead.unitId).map((member) => member.userId)],
        );
        await tx.outbox(
          this.event(CORRESPONDENCE_EVENTS.assigned, tx.letter, actor, recipients, {
            summary: `Các phòng phối hợp đã gửi đủ kết quả công văn ${letterTitle(withNo(tx.letter))}: phòng chủ trì tổng hợp và gửi kết quả.`,
            unitNames: leads.map((lead) => lead.unitName),
          }),
        );
      }
      const step = tx.steps.find((item) => item.status === 'active' && item.kind === 'process');
      if (!blockingAssignments(tx.assignments, step).some((item) => item.status === 'pending')) {
        if (step) await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'approved', note: null });
        await this.advance(actor, tx, step?.seq ?? 0, {});
      }
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư tiếp nhận kết quả, xác nhận hoàn tất và lưu trữ (cấp số hồ sơ). */
  async complete(actor: CorrespondenceActor, letterId: string, input: NoteRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú hoàn tất', 4000);
    const letter = await this.transition(actor, letterId, (actions) => actions.complete, (tx) => this.closeLetter(actor, tx, { note }));
    await this.recordArchive(actor, letter);
    return this.detail(actor, letterId);
  }

  /** Văn thư kiểm tra xong ("đạt"), chuyển bước kế tiếp của quy trình. */
  async submit(actor: CorrespondenceActor, letterId: string, input: SubmitLetterRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const chosen = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, current, input?.workflowId).catch(() => undefined);
    await this.transition(actor, letterId, (actions) => actions.submit, async (tx) => {
      let step = tx.steps.find((item) => item.status === 'active');
      if (!step) {
        // Công văn chờ kiểm tra theo luồng cũ chưa chép bước: chép quy trình, bước văn thư kiểm tra đầu tiên coi như đang làm.
        if (!workflow) throw new CorrespondenceValidationError('Chưa có quy trình đang dùng cho luồng này. Vào Cấu hình để đặt quy trình mặc định.');
        await tx.replaceSteps(applicableSteps(workflow, tx.letter));
        await tx.update({ workflowId: workflow.id, workflowName: workflow.name });
        step = nextWaiting(tx, 0);
      }
      if (step && step.kind === 'check') {
        await tx.updateStep(step.id, { status: 'done', activate: step.status !== 'active', actedBy: actor.userId, decision: 'approved', note: note ?? null });
      }
      await tx.history({ action: 'submit', summary: `${step?.kind === 'check' ? step.name : 'Văn thư kiểm tra'}: đạt, chuyển tiếp`, note, actorUserId: actor.userId });
      await this.advance(actor, tx, step?.kind === 'check' ? step.seq : 0, { units: input?.units, dueOn: input?.dueOn, chosen, note });
    });
    return this.detail(actor, letterId);
  }

  /**
   * "Đạt": sang bước kế tiếp của quy trình (bước duyệt để người trình chọn thì chọn người; bước
   * phòng ban xử lý thì người duyệt chọn phòng ban, ý kiến là chỉ đạo cho phòng ban); hết bước
   * thì chờ văn thư hoàn tất / ban hành.
   */
  async approve(actor: CorrespondenceActor, letterId: string, input: ApproveStepRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ý kiến', 4000);
    const nextAssignee = optionalText(input?.nextAssigneeUserId, 'Người duyệt bước sau', 64);
    const [settings, snapshot] = await Promise.all([this.settingsOrDefault(actor.tenantId), this.organization.snapshot(actor.tenantId)]);
    await this.transition(actor, letterId, (actions) => actions.approve, async (tx) => {
      const step = requireActive(tx);
      const dueOn = optionalDate(input?.dueOn, 'Thời hạn hoàn thành');
      if (dueOn && dueOn < tx.letter.receivedOn) throw new CorrespondenceValidationError('Thời hạn hoàn thành không được trước ngày đến.');
      // Người được ủy quyền duyệt thay (không tự thuộc luật người duyệt của bước): ghi rõ duyệt thay ai.
      const delegated = activeDelegations(settings.delegations, this.today()).find(
        (item) => item.toUserId === actor.userId && step.assigneeUserIds.includes(item.fromUserId),
      );
      const own =
        delegated && step.approver
          ? resolveAssignees(step.approver, await this.approverContext(actor.tenantId, tx.letter, tx.assignments, step.chosenUserId))
          : [];
      const onBehalf = delegated && !own.includes(actor.userId) ? delegated : undefined;
      const behalfName = onBehalf ? (await this.store.userNames(actor.tenantId, [onBehalf.fromUserId])).get(onBehalf.fromUserId) : undefined;
      if (step.mode === 'all') {
        // Tất cả cùng duyệt: ghi người đã duyệt (duyệt thay thì ghi người ủy quyền); còn người chưa duyệt thì bước chờ tiếp.
        const required = step.requiredUserIds && step.requiredUserIds.length > 0 ? step.requiredUserIds : step.assigneeUserIds;
        const principal = onBehalf?.fromUserId ?? actor.userId;
        const approvedBy = [...new Set([...(step.approvedBy ?? []), principal])];
        const missing = required.filter((id) => !approvedBy.includes(id));
        if (required.includes(principal) && missing.length > 0) {
          await tx.updateStep(step.id, { approvedBy });
          const done = required.length - missing.length;
          await tx.history({
            action: 'approve',
            summary: `${step.name}: đạt (${done}/${required.length} người)${behalfName ? ` (ủy quyền của ${behalfName})` : ''}`,
            note,
            actorUserId: actor.userId,
          });
          return;
        }
        await tx.updateStep(step.id, { approvedBy });
      }
      await tx.updateStep(step.id, { status: 'done', actedBy: actor.userId, decision: 'approved', note: note ?? null });
      let directive: LetterRecord['directive'];
      if (step.directs) {
        // Bút phê: ý kiến chỉ đạo, đơn vị chủ trì / phối hợp, thời hạn; bước phòng ban xử lý sau đó giao theo bút phê.
        const units = Array.isArray(input?.units) && input.units.length > 0 ? this.dispatchUnits(snapshot, settings, input.units) : [];
        directive = {
          note,
          dueOn,
          units: units.map(({ unitId, unitName, role, handlerUserId }) => ({ unitId, unitName, role, handlerUserId })),
          stepName: step.name,
          by: actor.userId,
          at: new Date().toISOString(),
        };
        await tx.update({ directive, ...(dueOn ? { dueOn } : {}) });
      }
      await tx.history({
        action: 'approve',
        summary: `${step.name}: ${step.directs ? 'bút phê' : 'đạt'}${behalfName ? ` (ủy quyền của ${behalfName})` : ''}${
          directive && directive.units.length > 0
            ? `; giao ${directive.units.map((unit) => `${unit.unitName} (${ASSIGNMENT_ROLE_LABELS[unit.role].toLowerCase()})`).join(', ')}`
            : ''
        }`,
        note,
        actorUserId: actor.userId,
      });
      await this.advance(actor, tx, step.seq, { units: input?.units, dueOn, chosen: nextAssignee, note });
    });
    return this.detail(actor, letterId);
  }

  /**
   * "Không đạt" / trả lại kèm lý do. Về bước đã xong ngay trước (bất kể loại), về phòng ban xử lý
   * gần nhất (đến) / người soạn (đi), hay về văn thư (đến: tiếp nhận để giao lại; đi: bước văn thư
   * kiểm tra gần nhất). Các bước giữa nơi về và bước hiện tại chạy lại từ đầu.
   */
  async returnLetter(actor: CorrespondenceActor, letterId: string, input: ReturnLetterRequest): Promise<LetterDetail> {
    const target = requireEnum(input?.target, [...RETURN_TARGETS, 'step'] as const, 'Nơi trả về');
    const reason = requireText(input?.reason, 'Lý do', 4000);
    const viewer = await this.viewer(actor);
    const clerks = await this.clerkTargets(actor.tenantId, ROUTE_PERMISSIONS.register);
    await this.inLetter(actor, letterId, async (tx, letterFacts) => {
      const allowed = returnTargets(viewer, letterFacts);
      if (target === 'step' ? allowed.length === 0 : !allowed.includes(target)) {
        if (allowed.length === 0) throw new LetterStageConflictError();
        throw new CorrespondenceValidationError('Không trả về được nơi này ở bước hiện tại.');
      }
      const direction = tx.letter.direction;
      const active = tx.steps.find((item) => item.status === 'active');
      const fromLabel = active?.name ?? LETTER_STAGE_LABELS[tx.letter.stage];
      const picked =
        target === 'step' ? letterActions(viewer, letterFacts).returnSteps?.find((item) => item.seq === Number(input?.stepSeq)) : undefined;
      if (target === 'step' && !picked) throw new CorrespondenceValidationError('Chọn một bước đã xong trước bước hiện tại để trả về.');
      const landing = picked
        ? tx.steps.find((item) => item.seq === picked.seq)
        : target === 'previous-step'
          ? lastDoneBefore(tx, active?.seq)
          : target === 'handlers' && direction === 'incoming'
            ? lastDoneBefore(tx, active?.seq, 'process')
            : target === 'clerk' && direction === 'outgoing'
              ? lastDoneBefore(tx, active?.seq, 'check')
              : undefined;
      if (active) {
        await tx.updateStep(active.id, { status: 'waiting', assigneeUserIds: [], actedBy: actor.userId, decision: 'returned', note: reason });
      }
      let recipients: string[] = [];
      let notifyClerks = false;
      let landed: string;
      if (landing) {
        await this.resetSteps(tx, landing.seq);
        if (landing.kind === 'process') {
          // Về phòng ban xử lý: phòng được chọn làm lại (trống là mọi phòng), bước sau chạy lại khi gửi đủ kết quả.
          const wanted = Array.isArray(input?.assignmentIds) && input.assignmentIds.length > 0 ? new Set(input.assignmentIds.map(String)) : undefined;
          const targets = tx.assignments.filter((item) => item.role !== 'info' && (!wanted || wanted.has(item.id)));
          if (targets.length === 0 || (wanted && targets.length !== wanted.size)) {
            throw new CorrespondenceValidationError('Chọn phòng ban phải làm lại trong số phòng ban đã giao.');
          }
          await tx.reopenAssignments(targets.map((item) => item.id), reason);
          await tx.updateStep(landing.id, { status: 'active', activate: true, actedBy: null, decision: null, note: null });
          await tx.update({ stage: 'processing' });
          recipients = targets.flatMap((item) => [item.handlerUserId, item.submittedBy].filter((id): id is string => Boolean(id)));
          landed = targets.map((item) => item.unitName).join(', ');
        } else {
          await this.activate(actor, tx, landing, {}, { notify: false });
          const reactivated = tx.steps.find((item) => item.id === landing.id);
          recipients = [...(reactivated?.assigneeUserIds ?? [])];
          if (landing.kind === 'check') {
            recipients = [...recipients, ...clerks.recipients];
            notifyClerks = true;
          }
          landed = landing.name;
        }
      } else {
        // Về ô đầu: văn thư tiếp nhận giao lại (đến), người soạn sửa (đi); các bước chạy lại khi chuyển tiếp.
        // Thư riêng người nhận trả văn thư (việc chung): thành công văn thường, xử lý theo quy trình.
        await this.resetSteps(tx);
        const stage: LetterStage = direction === 'incoming' ? 'received' : 'drafting';
        await tx.update(tx.letter.personal ? { stage, personal: false, closerIds: [] } : { stage });
        if (direction === 'incoming') {
          recipients = [tx.letter.receivedBy, ...clerks.recipients];
          notifyClerks = true;
        } else {
          recipients = tx.letter.authorUserId ? [tx.letter.authorUserId] : [];
        }
        landed = direction === 'incoming' ? FLOW_START_NAMES.incoming : returnTargetLabel('handlers', direction);
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
}
