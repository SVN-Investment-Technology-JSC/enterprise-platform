import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  SOCIAL_PRESIGNED_URL_TTL_SECONDS,
  type InitiateSocialAttachmentRequest,
  type InitiateSocialAttachmentResponse,
  type SocialAttachment,
} from '@enterprise-platform/contracts-social';
import { FILE_SIGNATURE_HEAD_BYTES, matchesFileSignature } from '../domain/file-signature.js';
import { mayWrite } from '../domain/social-principal.js';
import { normalizeAttachmentInput, requireUuid, safeObjectName } from '../domain/social-rules.js';
import {
  SocialAttachmentNotFoundError,
  SocialForbiddenError,
  SocialUploadMismatchError,
  SocialValidationError,
} from '../domain/social.error.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { StorageQuotaPort } from './ports/storage-quota.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialStore } from './social-store.port.js';
import { toAttachmentView } from './social-views.js';

/** Tệp chưa gắn vào bài sau chừng này thì bị dọn. */
export const SOCIAL_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const ORPHAN_BATCH = 200;

/**
 * Tệp đính kèm, tải lên hai bước như Hệ dùng chung: máy chủ không nhận byte của
 * tệp, chỉ ghi siêu dữ liệu và ký URL cho trình duyệt tự `PUT` lên kho.
 *
 * 1. `initiate`: kiểm kiểu và cỡ, tạo dòng chưa hoàn tất, trả URL ký sẵn.
 * 2. `complete`: kiểm object có trong kho và đúng cỡ, rồi đánh dấu hoàn tất.
 * 3. Tệp được gắn vào bài khi tạo/sửa bài kèm `attachmentIds`.
 *
 * Tệp quá 24 giờ mà chưa gắn bài là tệp mồ côi, dọn bằng `cleanupOrphans`.
 */
export class SocialAttachmentService {
  private readonly logger = new Logger(SocialAttachmentService.name);

  constructor(
    private readonly store: SocialStore,
    private readonly storage: AttachmentStorage,
    private readonly now: () => Date = () => new Date(),
    /** Kiểm hạn mức dung lượng của tenant trước khi ký URL; thiếu thì không kiểm. Lỗi hạ tầng thì cổng tự cho qua. */
    private readonly quota?: StorageQuotaPort,
  ) {}

  async initiate(
    actor: SocialActor,
    request: InitiateSocialAttachmentRequest,
  ): Promise<InitiateSocialAttachmentResponse> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    const purpose = request?.purpose ?? 'post';
    if (purpose !== 'post' && purpose !== 'comment') throw new SocialValidationError('Nơi gắn tệp không hợp lệ.');
    const file = normalizeAttachmentInput(request ?? {}, purpose);
    // Vượt hạn mức thì dừng trước khi tạo dòng và ký URL.
    await this.quota?.ensureCapacity(actor.tenantId, file.sizeBytes);
    const attachmentId = randomUUID();
    const storageKey = `tenants/${actor.tenantId}/social/${attachmentId}/${safeObjectName(file.fileName)}`;

    await this.store.attachments.insert(actor.tenantId, {
      id: attachmentId,
      uploadedBy: actor.userId,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      storageKey,
    });
    return {
      attachmentId,
      uploadUrl: await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
      }),
      expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
    };
  }

  /** Chỉ người tải mới hoàn tất được. Gọi lại khi đã hoàn tất thì trả lại kết quả cũ. */
  async complete(actor: SocialActor, attachmentId: string): Promise<SocialAttachment> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    requireUuid(attachmentId, 'Mã tệp');
    const row = await this.store.attachments.findById(actor.tenantId, attachmentId);
    // Tệp của người khác coi như không có, để không lộ id.
    if (!row || row.uploadedBy !== actor.userId) throw new SocialAttachmentNotFoundError();
    if (row.completed) return toAttachmentView(this.storage, row);

    let uploadedBytes: number;
    try {
      uploadedBytes = (await this.storage.objectMetadata(row.storageKey)).sizeBytes;
    } catch {
      throw new SocialUploadMismatchError('Tệp chưa được tải lên. Hãy tải lại tệp.');
    }
    if (uploadedBytes !== row.sizeBytes) {
      throw new SocialUploadMismatchError('Dung lượng tệp tải lên không khớp với khai báo. Hãy tải lại tệp.');
    }
    if (this.storage.readHead && matchesFileSignature(row.contentType, new Uint8Array()) !== undefined) {
      let head: Uint8Array;
      try {
        head = await this.storage.readHead(row.storageKey, FILE_SIGNATURE_HEAD_BYTES);
      } catch {
        throw new SocialUploadMismatchError('Không đọc được tệp đã tải lên. Hãy tải lại tệp.');
      }
      if (matchesFileSignature(row.contentType, head) === false) {
        await this.discardUpload(actor.tenantId, row.id, row.storageKey);
        throw new SocialUploadMismatchError('Nội dung tệp không đúng định dạng đã khai báo. Hãy chọn đúng tệp.');
      }
    }
    await this.store.attachments.markCompleted(actor.tenantId, attachmentId, uploadedBytes);
    return toAttachmentView(this.storage, { ...row, completed: true });
  }

  /** Xoá object rồi dòng của tệp bị từ chối; kho từ chối xoá thì giữ dòng cho job dọn mồ côi thử lại. */
  private async discardUpload(tenantId: string, id: string, storageKey: string): Promise<void> {
    try {
      const { failed } = await this.storage.deleteObjects([storageKey]);
      if (failed.length > 0) return;
    } catch (error) {
      this.logger.warn(`Không xoá được tệp sai định dạng của tenant ${tenantId}: ${String(error)}`);
      return;
    }
    await this.store.attachments.deleteByIds(tenantId, [id]);
  }

  /**
   * Dọn tệp mồ côi (chưa gắn bài, tạo quá 24 giờ trước) của một tenant: xoá
   * object rồi xoá dòng. Object kho từ chối xoá thì giữ dòng để lần sau thử
   * lại. Dành cho worker gọi định kỳ; trả số tệp đã dọn.
   */
  async cleanupOrphans(tenantId: string): Promise<number> {
    const olderThan = new Date(this.now().getTime() - SOCIAL_ORPHAN_TTL_MS).toISOString();
    let removed = 0;
    for (;;) {
      const orphans = await this.store.attachments.listOrphans(tenantId, olderThan, ORPHAN_BATCH);
      if (orphans.length === 0) break;
      const { failed } = await this.storage.deleteObjects(orphans.map((orphan) => orphan.storageKey));
      const stuck = new Set(failed);
      const deletable = orphans.filter((orphan) => !stuck.has(orphan.storageKey));
      if (stuck.size > 0) {
        this.logger.warn(`Không xoá được ${stuck.size} object mồ côi của tenant ${tenantId}; sẽ thử lại.`);
      }
      if (deletable.length > 0) {
        await this.store.attachments.deleteByIds(
          tenantId,
          deletable.map((orphan) => orphan.id),
        );
        removed += deletable.length;
      }
      // Nếu cả lô bị kho từ chối thì dừng, tránh lặp vô hạn trên cùng lô.
      if (deletable.length === 0 || orphans.length < ORPHAN_BATCH) break;
    }
    return removed;
  }
}
