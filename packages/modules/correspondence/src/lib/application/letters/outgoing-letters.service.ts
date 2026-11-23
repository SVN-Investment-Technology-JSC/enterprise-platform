import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  SENT_AS,
  type CreateOutgoingRequest,
  type LetterDetail,
  type PublishLetterRequest,
  type SendLetterRequest,
  type UpdateDeliveryRequest,
} from '@enterprise-platform/contracts-correspondence';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
} from '../../domain/correspondence.error.js';
import { type CorrespondenceActor } from '../ports.js';
import {
  MAX_UNITS_PER_LETTER,
  DRAFT_SUFFIX,
  applicableSteps,
  nextWaiting,
  defaultDue,
  ownUnits,
  requireText,
  optionalText,
  optionalDate,
  requireEnum,
  parseOptional,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Công văn đi: soạn, gửi văn thư, đánh số ban hành, theo dõi gửi. */
export class OutgoingLetters extends CorrespondenceCore {
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
    const chosenWorkflowId = await this.chosenWorkflow(actor.tenantId, 'outgoing', codes, input?.workflowId);
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
        sentAs: parseOptional(input?.sentAs, SENT_AS, 'Gửi với danh nghĩa') ?? 'person',
        chosenWorkflowId,
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

  /**
   * Người soạn gửi công văn đi sang bước đầu của quy trình cấu hình cho loại văn bản (thường là
   * văn thư kiểm tra). Bước đầu là phòng ban xử lý thì người soạn chọn phòng ban.
   */
  async sendToClerk(actor: CorrespondenceActor, letterId: string, input: SendLetterRequest): Promise<LetterDetail> {
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const chosen = optionalText(input?.assigneeUserId, 'Người duyệt', 64);
    const current = await this.store.findLetter(actor.tenantId, letterId);
    if (!current) throw new LetterNotFoundError();
    const workflow = await this.pickWorkflow(actor.tenantId, current, optionalText(input?.workflowId, 'Quy trình', 64));
    await this.transition(actor, letterId, (actions) => actions.sendToClerk, async (tx) => {
      await tx.replaceSteps(applicableSteps(workflow, tx.letter));
      await tx.update({ workflowId: workflow.id, workflowName: workflow.name, ...(input?.workflowId ? { chosenWorkflowId: workflow.id } : {}) });
      const first = nextWaiting(tx, 0);
      await tx.history({
        action: 'send-to-clerk',
        summary: first ? `Gửi bước "${first.name}"` : 'Gửi văn thư ban hành',
        note,
        actorUserId: actor.userId,
      });
      await this.advance(actor, tx, 0, { units: input?.units, dueOn: input?.dueOn, chosen, note, restart: true });
    });
    return this.detail(actor, letterId);
  }

  /** Văn thư đánh số, ban hành, gửi đi và lưu trữ hồ sơ. */
  async publish(actor: CorrespondenceActor, letterId: string, input: PublishLetterRequest): Promise<LetterDetail> {
    const recipient = requireText(input?.recipient, 'Nơi nhận', 255);
    const publishedOn = optionalDate(input?.publishedOn, 'Ngày ban hành') ?? this.today();
    const deliveryMethod = optionalText(input?.deliveryMethod, 'Hình thức gửi', 120);
    const note = optionalText(input?.note, 'Ghi chú', 2000);
    const rawCopies = input?.copyCount as unknown;
    const copyCount = rawCopies === undefined || rawCopies === null || rawCopies === '' ? undefined : Number(rawCopies);
    if (copyCount !== undefined && (!Number.isInteger(copyCount) || copyCount < 1 || copyCount > 1000)) {
      throw new CorrespondenceValidationError('Số bản là số từ 1 đến 1000.');
    }
    const internalUnitIds = [...new Set((Array.isArray(input?.internalUnitIds) ? input.internalUnitIds : []).map(String).filter(Boolean))];
    if (internalUnitIds.length > MAX_UNITS_PER_LETTER) throw new CorrespondenceValidationError(`Tối đa ${MAX_UNITS_PER_LETTER} phòng nhận nội bộ.`);
    const letter = await this.transition(actor, letterId, (actions) => actions.publish, (tx) =>
      this.closeLetter(actor, tx, {
        note,
        recipient,
        publishedOn,
        deliveryMethod,
        registerId: optionalText(input?.registerId, 'Sổ đăng ký', 64),
        signerUserId: optionalText(input?.signerUserId, 'Người ký', 64),
        signerName: optionalText(input?.signerName, 'Người ký', 160),
        signerTitle: optionalText(input?.signerTitle, 'Chức vụ người ký', 160),
        copyCount,
        internalUnitIds,
      }),
    );
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
}
