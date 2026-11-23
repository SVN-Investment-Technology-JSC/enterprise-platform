import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  CORRESPONDENCE_ATTACHMENT_MAX_BYTES,
  type AttachmentDownloadMode,
  type AttachmentDownloadTicket,
  type AttachmentUploadTicket,
  type CreateAttachmentRequest,
  type CreateAttachmentVersionRequest,
  type LetterAttachment,
} from '@enterprise-platform/contracts-correspondence';
import {
  AttachmentNotFoundError,
  CorrespondenceForbiddenError,
  CorrespondenceValidationError,
  LetterNotFoundError,
  LetterStageConflictError,
} from '../../domain/correspondence.error.js';
import { canDeleteAttachment, canViewLetter, dossierFolderName } from '../../domain/letter-rules.js';
import { FileStoreMissingError, type CorrespondenceActor } from '../ports.js';
import {
  CORRESPONDENCE_FILING_ROOT,
  FOLDER_BY_DIRECTION,
  txRow,
  facts,
  attachTarget,
  canAddVersion,
  displayNo,
  attachmentView,
  validateUpload,
  optionalText,
  requireEnum,
} from '../core/letter-helpers.js';
import { CorrespondenceCore } from '../core/correspondence-core.js';

/** Tệp đính kèm (lưu qua kho tài liệu của Hệ dùng chung). */
export class LetterAttachments extends CorrespondenceCore {
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
}
