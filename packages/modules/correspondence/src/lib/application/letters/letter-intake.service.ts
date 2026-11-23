import {
  CORRESPONDENCE_EVENTS,
  FLOW_END_NAMES,
  SENT_AS,
  letterTitle,
  type AssignHandlerRequest,
  type CreateLetterRequest,
  type DispatchLetterRequest,
  type LetterDetail,
  type UpdateLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { letterNumber, pickRegister } from '../../domain/numbering.js';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import { canAssignHandler } from '../../domain/letter-rules.js';
import { unitMembers } from '../../domain/organization.js';
import { type CorrespondenceActor } from '../ports.js';
import {
  applicableSteps,
  nextWaiting,
  defaultDue,
  withNo,
  dueText,
  requireText,
  optionalText,
  requireDate,
  optionalDate,
  requireEnum,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Tiếp nhận công văn đến, giao xử lý, sửa thông tin công văn. */
export class LetterIntake extends CorrespondenceCore {
  /** Văn thư tiếp nhận, vào sổ, cấp số đến. */
  async create(original: CorrespondenceActor, input: CreateLetterRequest): Promise<LetterDetail> {
    const actor = await this.effective(original);
    if (!actor.canRegister && !actor.isTenantAdmin) throw new CorrespondenceForbiddenError('Bạn không có quyền tiếp nhận công văn đến.');
    const [settings, catalog, registers] = await Promise.all([
      this.store.settings(actor.tenantId),
      this.catalogMap(actor.tenantId),
      this.store.registers(actor.tenantId),
    ]);
    const codes = this.classification(catalog, input);
    if (input?.personal === true && !optionalText(input.addressedUserId, 'Người nhận đích danh', 64)) {
      throw new CorrespondenceValidationError('Thư riêng phải chọn người nhận đích danh trong hệ thống.');
    }
    // Quy trình chọn riêng cho công văn: phải đang dùng, đúng luồng; công văn chạy đúng quy trình này.
    const chosenWorkflowId = await this.chosenWorkflow(actor.tenantId, 'incoming', codes, input?.workflowId);
    const autoStart =
      input?.personal === true ? undefined : await this.autoStartPlan(actor.tenantId, settings, catalog, { ...codes, chosenWorkflowId });
    const receivedOn = optionalDate(input?.receivedOn, 'Ngày đến') ?? this.today();
    // Vào sổ theo độ mật và loại văn bản (văn bản mật vào sổ mật, cấp số riêng), hay sổ văn thư chọn.
    const register = pickRegister(
      registers,
      'incoming',
      { kind: codes.kind, restricted: Boolean(catalog.get('confidentiality')?.get(codes.confidentiality)?.restricted) },
      optionalText(input?.registerId, 'Sổ đăng ký', 64),
    );
    const typeItem = catalog.get('letter_type')?.get(codes.kind);
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
        chosenWorkflowId,
      },
      {
        registerId: register.id,
        format: (seq) => letterNumber(register, typeItem, settings, { seq, year: Number(receivedOn.slice(0, 4)) }),
      },
      async (tx) => {
        const check = await this.intakeCheck(actor.tenantId, input, tx.letter);
        if (Object.keys(check).length > 0) await tx.update(check);
        await tx.history({ action: 'receive', summary: `Tiếp nhận, vào ${register.name} số ${tx.letter.incomingNo}`, actorUserId: actor.userId });
        if (autoStart) {
          await tx.replaceSteps(applicableSteps(autoStart.workflow, tx.letter));
          await tx.update({ workflowId: autoStart.workflow.id, workflowName: autoStart.workflow.name });
          const first = nextWaiting(tx, 0);
          if (first?.kind !== 'process') {
            await tx.history({ action: 'dispatch', summary: `Tự chuyển bước "${first?.name ?? FLOW_END_NAMES.incoming}"`, actorUserId: actor.userId });
          }
          await this.advance(actor, tx, 0, { units: autoStart.units, restart: true });
        }
        if (input?.personal === true) {
          // Thư riêng: văn thư không bóc bì, chuyển thẳng người nhận; người nhận xác nhận đã nhận hay trả văn thư.
          if (!tx.letter.addressedUserId) throw new CorrespondenceValidationError('Thư riêng phải chọn người nhận đích danh trong hệ thống.');
          await tx.update({ personal: true, stage: 'closing', closerIds: [tx.letter.addressedUserId] });
          await tx.history({ action: 'dispatch', summary: 'Thư riêng gửi đích danh: không bóc bì, chuyển thẳng người nhận', actorUserId: actor.userId });
        }
        if (tx.letter.addressedUserId) {
          await tx.outbox(
            this.event(CORRESPONDENCE_EVENTS.addressed, tx.letter, actor, [tx.letter.addressedUserId], {
              summary: tx.letter.personal
                ? `Thư riêng của ${tx.letter.senderOrg} gửi bạn (số đến ${tx.letter.incomingNo}), văn thư chuyển nguyên bì. Nhận thư rồi bấm "Đã nhận".`
                : `Công văn ${letterTitle(withNo(tx.letter))} của ${tx.letter.senderOrg} gửi đích danh bạn.`,
            }),
          );
        }
      },
    );
    return this.detail(actor, letter.id);
  }

  /**
   * Văn thư phân loại công văn đến và chuyển sang bước đầu của quy trình cấu hình cho loại văn
   * bản. Bước đầu là phòng ban xử lý thì văn thư chọn phòng ban (cả phòng cùng nhận, hoặc một
   * người xử lý; bắt buộc khi cấu hình đặt "phải chọn người xử lý").
   */
  async dispatch(actor: CorrespondenceActor, letterId: string, input: DispatchLetterRequest): Promise<LetterDetail> {
    const catalog = await this.catalogMap(actor.tenantId);
    const codes = this.classification(catalog, input, true);
    const dueOn = optionalDate(input?.dueOn, 'Hạn xử lý');
    const note = optionalText(input?.note, 'Ghi chú', 4000);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, { ...current, ...codes }, input?.workflowId);
    const chosen = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    await this.transition(actor, letterId, (actions) => actions.dispatch, async (tx) => {
      if (dueOn && dueOn < tx.letter.receivedOn) throw new CorrespondenceValidationError('Hạn xử lý không được trước ngày đến.');
      await tx.replaceSteps(applicableSteps(workflow, { ...tx.letter, ...codes }));
      await tx.update({
        ...codes,
        dueOn: dueOn ?? tx.letter.dueOn,
        workflowId: workflow.id,
        workflowName: workflow.name,
        ...(input?.workflowId ? { chosenWorkflowId: workflow.id } : {}),
      });
      const first = nextWaiting(tx, 0);
      if (first?.kind !== 'process') {
        await tx.history({
          action: 'dispatch',
          summary: first ? `Phân loại, chuyển bước "${first.name}"` : 'Phân loại, chuyển văn thư hoàn tất',
          note,
          actorUserId: actor.userId,
        });
      }
      await this.advance(actor, tx, 0, { units: input?.units, chosen, note, restart: true });
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
        ...(!incoming && patch.sentAs !== undefined ? { sentAs: requireEnum(patch.sentAs, SENT_AS, 'Gửi với danh nghĩa') } : {}),
        kind: this.catalogCode(catalog, 'letter_type', patch.kind, 'Loại văn bản') ?? tx.letter.kind,
        urgency: this.catalogCode(catalog, 'urgency', patch.urgency, 'Độ khẩn') ?? tx.letter.urgency,
        confidentiality: this.catalogCode(catalog, 'confidentiality', patch.confidentiality, 'Độ mật') ?? tx.letter.confidentiality,
        ...(incoming ? await this.intakeCheck(actor.tenantId, patch, tx.letter) : {}),
      });
      await tx.history({ action: 'update', summary: 'Sửa thông tin công văn', actorUserId: actor.userId });
    });
    return this.detail(actor, letterId);
  }
}
