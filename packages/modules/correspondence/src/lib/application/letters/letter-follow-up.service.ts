import {
  CORRESPONDENCE_EVENTS,
  REMIND_COOLDOWN_MINUTES,
  REMIND_REASONS,
  REMIND_REASON_LABELS,
  LETTER_STAGE_LABELS,
  isOpenStage,
  letterTitle,
  type CommentRequest,
  type RemindRequest,
  type LetterDetail,
} from '@enterprise-platform/contracts-correspondence';
import {
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import { supportPending, letterActions } from '../../domain/letter-rules.js';
import { unitHeads, unitMembers } from '../../domain/organization.js';
import { type CorrespondenceActor } from '../ports.js';
import {
  MAX_MENTIONS,
  ROUTE_PERMISSIONS,
  blockingAssignments,
  withNo,
  participants,
  dueText,
  requireText,
  requireEnum,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Đôn đốc và trao đổi theo bước. */
export class LetterFollowUp extends CorrespondenceCore {
  /**
   * Đôn đốc: văn thư / bộ phận tổng hợp (người có quyền xem báo cáo) nhắc người đang phải xử lý
   * công văn: người được giao bước duyệt, phòng ban còn chưa gửi kết quả, văn thư, người soạn.
   */
  async remind(actor: CorrespondenceActor, letterId: string, input: RemindRequest): Promise<LetterDetail> {
    const reason = requireEnum(input?.reason, REMIND_REASONS, 'Lý do đôn đốc');
    const note = requireText(input?.note, 'Lời nhắn đôn đốc', 1000);
    const wanted = Array.isArray(input?.assignmentIds) && input.assignmentIds.length > 0 ? new Set(input.assignmentIds.map(String)) : undefined;
    const [snapshot, history, viewer] = await Promise.all([
      this.organization.snapshot(actor.tenantId),
      this.store.history(actor.tenantId, letterId).catch(() => []),
      this.viewer(actor),
    ]);
    await this.inLetter(actor, letterId, async (tx, letterFacts) => {
      const waitingUserIds = await this.nextStepPeople(actor.tenantId, tx.letter, tx.steps, tx.assignments);
      if (!letterActions(viewer, { ...letterFacts, waitingUserIds }).remind) {
        if (!isOpenStage(tx.letter.stage) || tx.letter.stage === 'received') throw new LetterStageConflictError();
        throw new CorrespondenceForbiddenError('Chỉ văn thư, bộ phận tổng hợp hay người đang chờ bước này xong đôn đốc được.');
      }
      const active = tx.steps.find((item) => item.status === 'active');
      // Không nhắc dồn dập: cùng người, cùng bước, trong khoảng chờ.
      const since = Math.max(Date.now() - REMIND_COOLDOWN_MINUTES * 60_000, active?.activatedAt ? Date.parse(active.activatedAt) : 0);
      const recent = history.find((item) => item.action === 'remind' && item.actorUserId === actor.userId && Date.parse(item.at) > since);
      if (recent) {
        throw new CorrespondenceValidationError(
          `Bạn vừa đôn đốc bước này lúc ${new Date(recent.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}; đôn đốc lại sau ${REMIND_COOLDOWN_MINUTES} phút.`,
        );
      }
      let recipients: string[] = [];
      let notifyPermissions: string[] = [];
      let reminded = '';
      if (tx.letter.stage === 'processing') {
        // Các phòng chưa gửi kết quả (phòng chủ trì đang chờ phối hợp thì nhắc phòng phối hợp); chọn được phòng cần nhắc.
        const pending = blockingAssignments(tx.assignments, active).filter((item) => item.status === 'pending' && supportPending(tx, item).length === 0);
        const targets = wanted ? pending.filter((item) => wanted.has(item.id)) : pending;
        if (targets.length === 0 || (wanted && targets.length !== wanted.size)) {
          throw new CorrespondenceValidationError('Chọn phòng cần nhắc trong số phòng đang phải xử lý.');
        }
        recipients = targets.flatMap((item) =>
          item.handlerUserId ? [item.handlerUserId] : [...unitHeads(snapshot, item.unitId), ...unitMembers(snapshot, item.unitId).map((member) => member.userId)],
        );
        reminded = targets.map((item) => item.unitName).join(', ');
      } else if (tx.letter.stage === 'reviewing' || (tx.letter.stage === 'checking' && active?.approver)) {
        recipients = [...(active?.assigneeUserIds ?? [])];
      } else if (tx.letter.stage === 'drafting') {
        recipients = tx.letter.authorUserId ? [tx.letter.authorUserId] : [];
      } else if ((tx.letter.stage === 'closing' || tx.letter.stage === 'publishing') && tx.letter.closerIds?.length) {
        recipients = [...tx.letter.closerIds];
      } else {
        const permission = tx.letter.stage === 'publishing' ? ROUTE_PERMISSIONS.publish : tx.letter.stage === 'closing' ? ROUTE_PERMISSIONS.archive : ROUTE_PERMISSIONS.register;
        const clerks = await this.clerkTargets(actor.tenantId, permission);
        recipients = clerks.recipients;
        notifyPermissions = clerks.notifyPermissions;
      }
      recipients = [...new Set(recipients)].filter((userId) => userId !== actor.userId);
      const stepName = active?.name ?? LETTER_STAGE_LABELS[tx.letter.stage];
      const tag = reason === 'urgent' ? '[GẤP] ' : reason === 'late' ? '[CHẬM TRỄ] ' : '';
      await tx.history({
        action: 'remind',
        summary: `Đôn đốc bước "${stepName}" (${REMIND_REASON_LABELS[reason].toLowerCase()})${reminded ? `: ${reminded}` : ''}`,
        note,
        actorUserId: actor.userId,
      });
      await tx.outbox(
        this.event(CORRESPONDENCE_EVENTS.reminded, tx.letter, actor, recipients, {
          summary: `${tag}${actor.displayName} đôn đốc công văn ${letterTitle(withNo(tx.letter))}, bước "${stepName}". Lý do: ${REMIND_REASON_LABELS[reason].toLowerCase()}. ${note}${dueText(tx.letter.dueOn)}`,
          stepName,
          reason,
          notifyPermissions,
        }),
      );
    });
    return this.detail(actor, letterId);
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
}
