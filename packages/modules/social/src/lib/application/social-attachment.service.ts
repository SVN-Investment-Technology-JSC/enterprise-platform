import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  SOCIAL_MAX_UNATTACHED_BYTES_PER_USER,
  SOCIAL_MULTIPART_PART_BYTES,
  SOCIAL_MULTIPART_THRESHOLD_BYTES,
  SOCIAL_PRESIGNED_URL_TTL_SECONDS,
  SOCIAL_VIDEO_EVENT_TYPES,
  SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_TENANT,
  SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_USER,
  SOCIAL_VIDEO_QUEUE_TIMEOUT_SECONDS,
  SOCIAL_VIDEO_REQUEUE_AFTER_SECONDS,
  type AbortSocialAttachmentRequest,
  type DiscardSocialAttachmentRequest,
  type SocialAttachmentStatusRequest,
  type SocialAttachmentStatusResponse,
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
import {
  isUuid,
  isVideoContentType,
  normalizeAttachmentInput,
  requireUuid,
  safeObjectName,
} from '../domain/social-rules.js';
import {
  SocialAttachmentInUseError,
  SocialAttachmentNotFoundError,
  SocialError,
  SocialForbiddenError,
  SocialRateLimitedError,
  SocialTooManyPendingUploadsError,
  SocialUnattachedBytesExceededError,
  SocialUploadMismatchError,
  SocialValidationError,
  SocialVideoTooManyProcessingError,
} from '../domain/social.error.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { StorageQuotaPort } from './ports/storage-quota.port.js';
import type { SocialActor } from './social-actor.js';
import type { AttachmentRow, OrphanAttachment, SocialStore } from './social-store.port.js';
import type { SocialVideoStore } from './social-video-store.port.js';
import { toAttachmentView } from './social-views.js';
import { UploadRateLimiter } from './upload-rate-limiter.js';

/** Tệp chưa gắn vào bài sau chừng này thì bị dọn. */
export const SOCIAL_ORPHAN_TTL_MS = 2 * 60 * 60 * 1000;
const ORPHAN_BATCH = 200;
/** Thông báo của video bị quá hạn chờ mà chưa từng được xử lý (xem `sweepVideos`). */
const VIDEO_QUEUE_TIMEOUT_MESSAGE = 'Hệ thống xử lý video chưa sẵn sàng. Hãy tải video lên lại sau.';
/** Mỗi người chỉ được có tối đa chừng này lần tải dang dở trong `PENDING_WINDOW_MS`. */
export const SOCIAL_MAX_PENDING_UPLOADS = 20;
const PENDING_WINDOW_MS = 60 * 60 * 1000;

/** Tối đa số tệp của một lần hỏi trạng thái. */
export const SOCIAL_ATTACHMENT_STATUS_MAX_IDS = 10;

type UploadLogEvent = 'initiated' | 'completed' | 'rejected' | 'aborted' | 'discarded';

interface UploadLogContext {
  readonly tenantId: string;
  readonly purpose?: string;
  readonly sizeBytes?: number;
  readonly contentType?: string;
  readonly multipart?: boolean;
  readonly reason?: string;
  readonly processingStatus?: string;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
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
 * Tệp quá 2 giờ mà chưa gắn bài là tệp mồ côi, dọn bằng `cleanupOrphans`. Đóng tab thì giao diện gọi `discard`
 * để xoá ngay; job dọn chỉ là lưới an toàn cho trường hợp yêu cầu đó không đến được.
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
    /** Hàng đợi chuyển mã video, đếm video đang xử lý và dung lượng chưa gắn; thiếu thì không áp các giới hạn video. */
    readonly videoStore?: SocialVideoStore,
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
    await this.assertVideoLimits(actor, file, context);
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
      purpose,
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

  /**
   * Giới hạn riêng của video (chỉ khi có `videoStore`): tổng dung lượng chưa gắn của người dùng, và số video đang
   * chờ hoặc đang chuyển mã của người dùng và của cả tenant. Đây là trần mềm: hai lần gọi đồng thời sát biên
   * có thể cùng qua, sai lệch tối đa bằng số lần gọi đồng thời.
   */
  private async assertVideoLimits(
    actor: SocialActor,
    file: { readonly sizeBytes: number; readonly contentType: string },
    context: UploadLogContext,
  ): Promise<void> {
    const videoStore = this.videoStore;
    if (!videoStore) return;
    const unattached = await videoStore.sumUnattachedBytes(actor.tenantId, actor.userId);
    if (unattached + file.sizeBytes > SOCIAL_MAX_UNATTACHED_BYTES_PER_USER) {
      throw this.reject(context, 'unattached_bytes_exceeded', new SocialUnattachedBytesExceededError());
    }
    if (isVideoContentType(file.contentType)) await this.assertVideoCapacity(actor, context);
  }

  private async assertVideoCapacity(actor: SocialActor, context: UploadLogContext): Promise<void> {
    if (!this.videoStore) return;
    const inFlight = await this.videoStore.countInFlight(actor.tenantId, actor.userId);
    if (
      inFlight.user >= SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_USER ||
      inFlight.tenant >= SOCIAL_VIDEO_MAX_IN_FLIGHT_PER_TENANT
    ) {
      throw this.reject(context, 'too_many_processing', new SocialVideoTooManyProcessingError());
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
      purpose: row.purpose,
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
    const videoStore = this.videoStore;
    if (videoStore && isVideoContentType(row.contentType)) {
      return this.completeVideo(videoStore, actor, row, uploadedBytes, context);
    }
    await this.store.attachments.markCompleted(actor.tenantId, attachmentId, uploadedBytes);
    this.log('completed', context);
    return toAttachmentView(this.storage, { ...row, completed: true });
  }

  /**
   * Video: đánh dấu đã tải xong và xếp hàng chuyển mã trong một transaction cùng sự kiện outbox. Gọi lại (kể cả
   * đồng thời) chỉ tạo một sự kiện vì `completeAndQueue` idempotent.
   */
  private async completeVideo(
    videoStore: SocialVideoStore,
    actor: SocialActor,
    row: AttachmentRow,
    uploadedBytes: number,
    context: UploadLogContext,
  ): Promise<SocialAttachment> {
    try {
      await this.assertVideoCapacity(actor, context);
    } catch (error) {
      // Lần gọi đồng thời khác của chính tệp này vừa xếp hàng xong (số đang xử lý đã tính cả nó): trả kết quả đó.
      const current = await this.store.attachments.findById(actor.tenantId, row.id);
      if (current?.completed) return toAttachmentView(this.storage, current);
      throw error;
    }
    await videoStore.completeAndQueue(actor.tenantId, row.id, uploadedBytes, {
      type: SOCIAL_VIDEO_EVENT_TYPES[row.purpose],
      aggregateType: 'social-attachment',
      aggregateId: row.id,
      payload: { attachmentId: row.id, purpose: row.purpose },
    });
    this.log('completed', { ...context, processingStatus: 'queued' });
    return toAttachmentView(this.storage, {
      ...row,
      completed: true,
      sizeBytes: uploadedBytes,
      processingStatus: 'queued',
    });
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

  /**
   * Bỏ tệp của chính mình mà chưa gắn vào bài hay bình luận, ở mọi trạng thái (đang tải, đã tải xong, đang chờ,
   * đang chuyển mã, lỗi, sẵn sàng): huỷ phiên nhiều phần nếu có, xoá object (bản chính, poster, bản gốc) và dòng.
   * Giao diện gọi khi người dùng đóng tab hay rời ô soạn thảo. Idempotent: tệp đã mất thì coi như xong. Worker đang
   * chuyển mã sẽ thấy dòng mất ở bước ghi kết quả và tự xoá tệp vừa tạo.
   */
  async discard(actor: SocialActor, attachmentId: string, request?: DiscardSocialAttachmentRequest): Promise<void> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    requireUuid(attachmentId, 'Mã tệp');
    const row = await this.store.attachments.findById(actor.tenantId, attachmentId);
    if (!row) return;
    if (row.uploadedBy !== actor.userId) throw new SocialAttachmentNotFoundError();
    if (row.postId || row.commentId) throw new SocialAttachmentInUseError();

    const context: UploadLogContext = {
      tenantId: actor.tenantId,
      purpose: row.purpose,
      sizeBytes: row.sizeBytes,
      contentType: row.contentType,
      multipart: isMultipartSize(row.sizeBytes),
      processingStatus: row.processingStatus,
    };
    if (request?.uploadId && !row.completed) {
      // Phiên đã ghép hoặc đã mất thì kho báo lỗi: không cản việc xoá phần còn lại.
      await this.storage.abortMultipartUpload(row.storageKey, request.uploadId).catch(() => undefined);
    }
    // Đọc lại ngay trước khi xoá: tệp vừa được gắn vào bài trong lúc này thì giữ nguyên.
    const latest = await this.store.attachments.findById(actor.tenantId, attachmentId);
    if (!latest) return;
    if (latest.postId || latest.commentId) throw new SocialAttachmentInUseError();
    const keys = [...new Set([latest.storageKey, latest.posterKey, latest.sourceKey].filter(isString))];
    try {
      const { failed } = await this.storage.deleteObjects(keys);
      if (failed.length > 0) {
        // Giữ dòng để job dọn mồ côi thử lại.
        this.log('rejected', { ...context, reason: 'discard_delete_failed' });
        return;
      }
    } catch (error) {
      this.logger.warn(`Không xoá được tệp bỏ dở của tenant ${actor.tenantId}: ${String(error)}`);
      return;
    }
    await this.store.attachments.deleteByIds(actor.tenantId, [attachmentId]);
    this.log('discarded', context);
  }

  /** Trạng thái xử lý của tối đa 10 tệp do chính người gọi tải lên; id lạ hoặc của người khác bị bỏ qua. */
  async status(actor: SocialActor, request: SocialAttachmentStatusRequest): Promise<SocialAttachmentStatusResponse> {
    if (!mayWrite(actor)) throw new SocialForbiddenError('Bạn không có quyền tải tệp lên.');
    const ids: unknown = request?.ids;
    if (!Array.isArray(ids)) throw new SocialValidationError('Danh sách mã tệp không hợp lệ.');
    if (ids.length > SOCIAL_ATTACHMENT_STATUS_MAX_IDS) {
      throw new SocialValidationError(`Mỗi lần chỉ hỏi tối đa ${SOCIAL_ATTACHMENT_STATUS_MAX_IDS} tệp.`);
    }
    const unique = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))];
    const rows = await Promise.all(unique.map((id) => this.store.attachments.findById(actor.tenantId, id)));
    const mine = rows.filter((row): row is AttachmentRow => row !== undefined && row.uploadedBy === actor.userId);
    return { items: await Promise.all(mine.map((row) => toAttachmentView(this.storage, row))) };
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
   * Dọn tệp mồ côi (chưa gắn bài hay bình luận, tạo quá `SOCIAL_ORPHAN_TTL_MS` trước) của một tenant: huỷ phần tải
   * dang dở (nếu có), xoá object (gồm poster và bản gốc) rồi xoá dòng. Object kho từ chối xoá thì giữ dòng để lần
   * sau thử lại. Sau đó thử lại việc xoá bản gốc còn sót sau chuyển mã. Dành cho worker gọi định kỳ; trả số tệp
   * mồ côi đã dọn.
   */
  async cleanupOrphans(tenantId: string): Promise<number> {
    const olderThan = new Date(this.now().getTime() - SOCIAL_ORPHAN_TTL_MS).toISOString();
    let removed = 0;
    for (;;) {
      const orphans = await this.store.attachments.listOrphans(tenantId, olderThan, ORPHAN_BATCH);
      if (orphans.length === 0) break;
      const keysOf = (orphan: OrphanAttachment) =>
        [orphan.storageKey, orphan.posterKey, orphan.sourceKey].filter(isString);
      await this.abortUnfinishedUploads(tenantId, orphans);
      const { failed } = await this.storage.deleteObjects(orphans.flatMap(keysOf));
      const stuck = new Set(failed);
      const deletable = orphans.filter((orphan) => !keysOf(orphan).some((key) => stuck.has(key)));
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
    await this.sweepSourceKeys(tenantId);
    return removed;
  }

  /**
   * Lưới an toàn cho đường RabbitMQ (tin nhắn vào hàng chết, hoặc `video-worker` không chạy). Video đã đăng nên
   * người xem đang thấy "đang xử lý"; không để treo mãi. Thứ tự: (a) báo lỗi video quá `SOCIAL_VIDEO_QUEUE_TIMEOUT_SECONDS`
   * mà chưa từng được nhận rồi xoá bản gốc khỏi kho (dòng vẫn ở `failed` để giao diện hiện lỗi); (b) xếp lại hàng
   * video chờ quá `SOCIAL_VIDEO_REQUEUE_AFTER_SECONDS`. Bình thường không có dòng nào quá hạn.
   */
  async sweepVideos(tenantId: string): Promise<{ requeued: number; failed: number }> {
    if (!this.videoStore) return { requeued: 0, failed: 0 };
    const stuck = await this.videoStore.failStuckQueued(
      tenantId,
      SOCIAL_VIDEO_QUEUE_TIMEOUT_SECONDS,
      ORPHAN_BATCH,
      VIDEO_QUEUE_TIMEOUT_MESSAGE,
    );
    if (stuck.length > 0) {
      try {
        const { failed } = await this.storage.deleteObjects(stuck.map((item) => item.storageKey));
        if (failed.length > 0) {
          this.logger.warn(`Không xoá được ${failed.length} bản gốc video quá hạn của tenant ${tenantId}.`);
        }
      } catch (error) {
        this.logger.warn(`Không xoá được bản gốc video quá hạn của tenant ${tenantId}: ${String(error)}`);
      }
    }
    const requeued = await this.videoStore.requeueStale(
      tenantId,
      SOCIAL_VIDEO_REQUEUE_AFTER_SECONDS,
      ORPHAN_BATCH,
    );
    if (requeued > 0 || stuck.length > 0) {
      this.logger.warn(JSON.stringify({ event: 'social.video.sweep', tenantId, requeued, failed: stuck.length }));
    }
    return { requeued, failed: stuck.length };
  }

  /** Huỷ phiên tải nhiều phần của các tệp chưa hoàn tất (phần đã tải còn chiếm chỗ trong kho cho tới khi huỷ). */
  private async abortUnfinishedUploads(tenantId: string, orphans: readonly OrphanAttachment[]): Promise<void> {
    const abort = this.storage.abortIncompleteMultipartUploads?.bind(this.storage);
    if (!abort) return;
    for (const orphan of orphans) {
      if (orphan.completed !== false) continue;
      try {
        await abort(orphan.storageKey);
      } catch (error) {
        this.logger.warn(`Không huỷ được phần tải dang dở của tenant ${tenantId}: ${String(error)}`);
      }
    }
  }

  /**
   * Xoá các bản gốc còn sót sau chuyển mã (xoá ngay lúc xong bị hỏng thì `source_key` vẫn còn). Chỉ bỏ `source_key`
   * khi kho đã xoá được; kho từ chối thì để lần sau.
   */
  private async sweepSourceKeys(tenantId: string): Promise<void> {
    if (!this.videoStore) return;
    const pending = await this.videoStore.listSourceKeysToDelete(tenantId, ORPHAN_BATCH);
    if (pending.length === 0) return;
    const { failed } = await this.storage.deleteObjects(pending.map((item) => item.sourceKey));
    const stuck = new Set(failed);
    const cleared = pending.filter((item) => !stuck.has(item.sourceKey)).map((item) => item.id);
    if (cleared.length > 0) await this.videoStore.clearSourceKeys(tenantId, cleared);
    if (stuck.size > 0) {
      this.logger.warn(`Không xoá được ${stuck.size} bản gốc video của tenant ${tenantId}; sẽ thử lại.`);
    }
  }
}
