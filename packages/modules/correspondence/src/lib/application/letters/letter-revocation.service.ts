import {
  CORRESPONDENCE_EVENTS,
  REVOKE_KINDS,
  REVOKE_KIND_LABELS,
  letterTitle,
  type DecideRevokeRequest,
  type LetterDetail,
  type ReasonRequest,
  type RequestRevokeRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceValidationError } from '../../domain/correspondence.error.js';
import { type CorrespondenceActor } from '../ports.js';
import {
  ROUTE_PERMISSIONS,
  withNo,
  CLEARED_REVOKE,
  participants,
  requireText,
  optionalText,
  requireEnum,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Huỷ, thu hồi công văn đã lưu trữ, xoá. */
export class LetterRevocation extends CorrespondenceCore {
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
}
