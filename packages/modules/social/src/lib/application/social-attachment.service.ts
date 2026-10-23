import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  SOCIAL_MULTIPART_PART_BYTES,
  SOCIAL_MULTIPART_THRESHOLD_BYTES,
  SOCIAL_PRESIGNED_URL_TTL_SECONDS,
  type AbortSocialAttachmentRequest,
  type RefreshSocialUploadPartsRequest,
  type RefreshSocialUploadPartsResponse,
  type CompleteSocialAttachmentRequest,
  type InitiateSocialAttachmentRequest,
  type InitiateSocialAttachmentResponse,
  type SocialAttachment,
  type SocialMultipartPart,
} from '@enterprise-platform/contracts-social';
import { FILE_SIGNATURE_HEAD_BYTES, matchesFileSignature } from '../domain/file-signature.js';
import { mayWrite } from '../domain/social-principal.js';
import { normalizeAttachmentInput, requireUuid, safeObjectName } from '../domain/social-rules.js';
import {
  SocialAttachmentNotFoundError,
  SocialError,
  SocialForbiddenError,
  SocialRateLimitedError,
  SocialTooManyPendingUploadsError,
  SocialUploadMismatchError,
  SocialValidationError,
} from '../domain/social.error.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { StorageQuotaPort } from './ports/storage-quota.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialStore } from './social-store.port.js';
import { toAttachmentView } from './social-views.js';
import { UploadRateLimiter } from './upload-rate-limiter.js';

/** Tệp chưa gắn vào bài sau chừng này thì bị dọn. */
export const SOCIAL_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const ORPHAN_BATCH = 200;
/** Mỗi người chỉ được có tối đa chừng này lần tải dang dở trong `PENDING_WINDOW_MS`. */
export const SOCIAL_MAX_PENDING_UPLOADS = 20;
const PENDING_WINDOW_MS = 60 * 60 * 1000;

type UploadLogEvent = 'initiated' | 'completed' | 'rejected' | 'aborted';

interface UploadLogContext {
  readonly tenantId: string;
  readonly purpose?: string;
  readonly sizeBytes?: number;
  readonly contentType?: string;
  readonly multipart?: boolean;
  readonly reason?: string;
}

function isMultipartSize(sizeBytes: number): boolean {
  return sizeBytes > SOCIAL_MULTIPART_THRESHOLD_BYTES;
}

function partCount(sizeBytes: number): number {
  return Math.ceil(sizeBytes / SOCIAL_MULTIPART_PART_BYTES);
}

/** Cỡ phần thứ `partNumber`: mọi phần bằng `SOCIAL_MULTIPART_PART_BYTES`, phần cuối là phần còn lại. */
function partSizeOf(sizeBytes: number, partNumber: number): number {
  const count = partCount(sizeBytes);
  return partNumber < count ? SOCIAL_MULTIPART_PART_BYTES : sizeBytes - SOCIAL_MULTIPART_PART_BYTES * (count - 1);
}

/**
 * Tệp đính kèm, tải lên hai bước như Hệ dùng chung: máy chủ không nhận byte của
 * tệp, chỉ ghi siêu dữ liệu và ký URL cho trình duyệt tự `PUT` lên kho.
 *
 * 1. `initiate`: kiểm kiểu và cỡ, tạo dòng chưa hoàn tất, trả URL ký sẵn (ghim
 *    đúng số byte đã khai). Tệp lớn hơn ngưỡng nhiều phần thì trả URL từng phần.
 * 2. `complete`: (tệp nhiều phần: ghép các phần) kiểm object có trong kho, đúng
 *    cỡ và đúng chữ ký, rồi đánh dấu hoàn tất; object sai bị xoá ngay.
 * 3. `abort`: người dùng huỷ lần tải chưa xong; xoá phần/object và dòng.
 * 4. Tệp được gắn vào bài khi tạo/sửa bài kèm `attachmentIds`.
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
    /** Giới hạn tần suất `initiate`; mặc định 30 lần/phút/người và 300 lần/phút/tenant. */
    private readonly rateLimiter: UploadRateLimiter = new UploadRateLimiter(),
  ) {}

  async initiate(
    actor: SocialActor,
    request: InitiateSocialAttachmentRequest,
  ): Promise<InitiateSocialAttachmentResponse> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    try {
      this.rateLimiter.consume(actor.tenantId, actor.userId);
    } catch (error) {
      if (error instanceof SocialRateLimitedError) {
        this.log('rejected', { tenantId: actor.tenantId, reason: 'rate_limited' });
      }
      throw error;
    }
    const purpose = request?.purpose ?? 'post';
    if (purpose !== 'post' && purpose !== 'comment') throw new SocialValidationError('Nơi gắn tệp không hợp lệ.');
    const file = normalizeAttachmentInput(request ?? {}, purpose);
    const multipart = isMultipartSize(file.sizeBytes);
    const context: UploadLogContext = {
      tenantId: actor.tenantId,
      purpose,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      multipart,
    };

    const since = new Date(this.now().getTime() - PENDING_WINDOW_MS).toISOString();
    const pending = await this.store.attachments.countPending(actor.tenantId, actor.userId, since);
    if (pending >= SOCIAL_MAX_PENDING_UPLOADS) {
      this.log('rejected', { ...context, reason: 'too_many_pending' });
      throw new SocialTooManyPendingUploadsError();
    }
    // Vượt hạn mức thì dừng trước khi tạo dòng và ký URL.
    try {
      await this.quota?.ensureCapacity(actor.tenantId, file.sizeBytes);
    } catch (error) {
      this.log('rejected', { ...context, reason: 'quota_exceeded' });
      throw error;
    }
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
    let uploadId: string | undefined;
    try {
      if (multipart) {
        uploadId = await this.storage.createMultipartUpload(storageKey, file.contentType);
        const parts = await this.signParts(storageKey, uploadId, file.sizeBytes);
        this.log('initiated', context);
        return {
          attachmentId,
          uploadUrl: '',
          expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
          multipart: { uploadId, parts },
        };
      }
      const uploadUrl = await this.storage.createUploadUrl({
        key: storageKey,
        contentType: file.contentType,
        expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
        sizeBytes: file.sizeBytes,
      });
      this.log('initiated', context);
      return { attachmentId, uploadUrl, expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS };
    } catch (error) {
      // Không ký được URL thì dòng vừa tạo vô ích: gỡ ngay thay vì chờ job dọn.
      if (uploadId) await this.storage.abortMultipartUpload(storageKey, uploadId).catch(() => undefined);
      await this.store.attachments.deleteByIds(actor.tenantId, [attachmentId]).catch(() => undefined);
      throw error;
    }
  }

  private signParts(storageKey: string, uploadId: string, sizeBytes: number): Promise<SocialMultipartPart[]> {
    return Promise.all(
      Array.from({ length: partCount(sizeBytes) }, async (_unused, index) => {
        const partNumber = index + 1;
        const partSize = partSizeOf(sizeBytes, partNumber);
        return {
          partNumber,
          sizeBytes: partSize,
          url: await this.storage.createUploadPartUrl({
            key: storageKey,
            uploadId,
            partNumber,
            sizeBytes: partSize,
            expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
          }),
        };
      }),
    );
  }

  /** Chỉ người tải mới hoàn tất được. Gọi lại khi đã hoàn tất thì trả lại kết quả cũ. */
  async complete(
    actor: SocialActor,
    attachmentId: string,
    request?: CompleteSocialAttachmentRequest,
  ): Promise<SocialAttachment> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    requireUuid(attachmentId, 'Mã tệp');
    const row = await this.store.attachments.findById(actor.tenantId, attachmentId);
    // Tệp của người khác coi như không có, để không lộ id.
    if (!row || row.uploadedBy !== actor.userId) throw new SocialAttachmentNotFoundError();
    if (row.completed) return toAttachmentView(this.storage, row);

    const multipart = isMultipartSize(row.sizeBytes);
    const context: UploadLogContext = {
      tenantId: actor.tenantId,
      sizeBytes: row.sizeBytes,
      contentType: row.contentType,
      multipart,
    };
    if (multipart) await this.assembleParts(row.storageKey, row.sizeBytes, request?.uploadId, context);

    let uploadedBytes: number;
    try {
      uploadedBytes = (await this.storage.objectMetadata(row.storageKey)).sizeBytes;
    } catch {
      throw this.reject(
        context,
        'not_uploaded',
        new SocialUploadMismatchError('Tệp chưa được tải lên. Hãy tải lại tệp.'),
      );
    }
    if (uploadedBytes !== row.sizeBytes) {
      // Object sai cỡ không dùng được: xoá ngay cả object lẫn dòng, không chờ job dọn.
      await this.discardUpload(actor.tenantId, row.id, row.storageKey);
      throw this.reject(
        context,
        'size_mismatch',
        new SocialUploadMismatchError('Dung lượng tệp tải lên không khớp với khai báo. Hãy tải lại tệp.'),
      );
    }
    if (this.storage.readHead && matchesFileSignature(row.contentType, new Uint8Array()) !== undefined) {
      let head: Uint8Array;
      try {
        head = await this.storage.readHead(row.storageKey, FILE_SIGNATURE_HEAD_BYTES);
      } catch {
        throw this.reject(
          context,
          'unreadable',
          new SocialUploadMismatchError('Không đọc được tệp đã tải lên. Hãy tải lại tệp.'),
        );
      }
      if (matchesFileSignature(row.contentType, head) === false) {
        await this.discardUpload(actor.tenantId, row.id, row.storageKey);
        throw this.reject(
          context,
          'signature_mismatch',
          new SocialUploadMismatchError('Nội dung tệp không đúng định dạng đã khai báo. Hãy chọn đúng tệp.'),
        );
      }
    }
    await this.store.attachments.markCompleted(actor.tenantId, attachmentId, uploadedBytes);
    this.log('completed', context);
    return toAttachmentView(this.storage, { ...row, completed: true });
  }

  /**
   * Ghép các phần đã tải thành một object. ETag lấy từ `listParts` của kho
   * (client không phải gửi, nên không phụ thuộc CORS). Thiếu hay sai cỡ phần thì
   * báo lỗi mà không xoá gì, để client tải lại phần đó rồi gọi lại.
   */
  private async assembleParts(
    storageKey: string,
    sizeBytes: number,
    uploadId: string | undefined,
    context: UploadLogContext,
  ): Promise<void> {
    if (!uploadId) throw new SocialValidationError('Thiếu mã phiên tải nhiều phần (uploadId).');
    let listed: Awaited<ReturnType<AttachmentStorage['listParts']>>;
    try {
      listed = await this.storage.listParts(storageKey, uploadId);
    } catch {
      // Phiên đã ghép ở lần gọi trước (rồi mất kết nối): object đã có thì đi tiếp các bước kiểm.
      try {
        await this.storage.objectMetadata(storageKey);
        return;
      } catch {
        throw this.reject(
          context,
          'not_uploaded',
          new SocialUploadMismatchError('Tệp chưa được tải lên. Hãy tải lại tệp.'),
        );
      }
    }
    const count = partCount(sizeBytes);
    const byNumber = new Map(listed.map((part) => [part.partNumber, part]));
    for (let partNumber = 1; partNumber <= count; partNumber += 1) {
      const part = byNumber.get(partNumber);
      if (!part) {
        throw this.reject(
          context,
          'missing_part',
          new SocialUploadMismatchError('Tệp chưa tải đủ các phần. Hãy tải lại các phần còn thiếu.'),
        );
      }
      if (part.sizeBytes !== partSizeOf(sizeBytes, partNumber)) {
        throw this.reject(
          context,
          'part_size_mismatch',
          new SocialUploadMismatchError('Một phần của tệp có dung lượng không đúng. Hãy tải lại tệp.'),
        );
      }
    }
    if (listed.length > count) {
      throw this.reject(
        context,
        'part_size_mismatch',
        new SocialUploadMismatchError('Tệp có thừa phần so với khai báo. Hãy tải lại tệp.'),
      );
    }
    await this.storage.completeMultipartUpload(
      storageKey,
      uploadId,
      listed.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    );
  }

  /**
   * Huỷ lần tải chưa hoàn tất: huỷ phiên nhiều phần (nếu có), xoá object và dòng.
   * Chỉ chủ tệp; tệp đã mất thì coi như xong.
   */
  /**
   * Ký lại URL cho vài phần của lần tải nhiều phần đang dang dở. Chỉ chủ tệp, chỉ khi chưa hoàn tất; mỗi lần
   * tối đa 10 phần và số phần phải nằm trong tệp.
   */
  async refreshParts(
    actor: SocialActor,
    attachmentId: string,
    request: RefreshSocialUploadPartsRequest,
  ): Promise<RefreshSocialUploadPartsResponse> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    requireUuid(attachmentId, 'Mã tệp');
    const row = await this.store.attachments.findById(actor.tenantId, attachmentId);
    if (!row || row.uploadedBy !== actor.userId) throw new SocialAttachmentNotFoundError();
    if (row.completed) {
      throw new SocialError('ATTACHMENT_ALREADY_COMPLETED', 'Tệp đã tải xong, không cần ký lại.', 409);
    }
    if (!isMultipartSize(row.sizeBytes)) throw new SocialValidationError('Tệp này không tải theo từng phần.');
    const uploadId = request?.uploadId;
    if (typeof uploadId !== 'string' || !uploadId) throw new SocialValidationError('Thiếu mã phiên tải lên.');
    const count = partCount(row.sizeBytes);
    const numbers = [...new Set(request.partNumbers ?? [])];
    if (
      numbers.length === 0 ||
      numbers.length > 10 ||
      numbers.some((value) => !Number.isInteger(value) || value < 1 || value > count)
    ) {
      throw new SocialValidationError('Số phần không hợp lệ.');
    }
    const parts = await Promise.all(
      numbers.map(async (partNumber) => {
        const sizeBytes = partSizeOf(row.sizeBytes, partNumber);
        return {
          partNumber,
          sizeBytes,
          url: await this.storage.createUploadPartUrl({
            key: row.storageKey,
            uploadId,
            partNumber,
            sizeBytes,
            expiresInSeconds: SOCIAL_PRESIGNED_URL_TTL_SECONDS,
          }),
        };
      }),
    );
    return { parts };
  }

  async abort(actor: SocialActor, attachmentId: string, request?: AbortSocialAttachmentRequest): Promise<void> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    requireUuid(attachmentId, 'Mã tệp');
    const row = await this.store.attachments.findById(actor.tenantId, attachmentId);
    if (!row) return;
    if (row.uploadedBy !== actor.userId) throw new SocialAttachmentNotFoundError();
    if (row.completed) {
      throw new SocialError('ATTACHMENT_ALREADY_COMPLETED', 'Tệp đã tải xong, không thể huỷ.', 409);
    }
    if (request?.uploadId) await this.storage.abortMultipartUpload(row.storageKey, request.uploadId);
    await this.discardUpload(actor.tenantId, row.id, row.storageKey);
    this.log('aborted', {
      tenantId: actor.tenantId,
      sizeBytes: row.sizeBytes,
      contentType: row.contentType,
      multipart: isMultipartSize(row.sizeBytes),
    });
  }

  /** Nhật ký một dòng JSON; không ghi tên tệp hay thông tin cá nhân. */
  private log(event: UploadLogEvent, context: UploadLogContext): void {
    const line = JSON.stringify({ event: `social.upload.${event}`, ...context });
    if (event === 'rejected') this.logger.warn(line);
    else this.logger.log(line);
  }

  private reject<TError extends Error>(context: UploadLogContext, reason: string, error: TError): TError {
    this.log('rejected', { ...context, reason });
    return error;
  }

  /** Xoá object rồi dòng của tệp bị từ chối; kho từ chối xoá thì giữ dòng cho job dọn mồ côi thử lại. */
  private async discardUpload(tenantId: string, id: string, storageKey: string): Promise<void> {
    try {
      const { failed } = await this.storage.deleteObjects([storageKey]);
      if (failed.length > 0) return;
    } catch (error) {
      this.logger.warn(`Không xoá được tệp bị từ chối của tenant ${tenantId}: ${String(error)}`);
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
