import type { AttachmentRow, SocialOutboxEvent } from './social-store.port.js';

/** Token DI của store xử lý video. */
export const SOCIAL_VIDEO_STORE = Symbol('SOCIAL_VIDEO_STORE');

/** Việc đã nhận: dòng tệp và lần thử hiện tại (1 là lần đầu). */
export interface VideoClaim {
  readonly attachment: AttachmentRow;
  readonly attempt: number;
}

/** Kết quả chuyển mã thành công; `storageKey` mới thay khoá cũ, khoá cũ chuyển sang `source_key` chờ xoá. */
export interface VideoReadyResult {
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly contentType: 'video/mp4';
  readonly posterKey: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Cổng dữ liệu của hàng đợi chuyển mã video. Trạng thái nằm trong dòng `attachments`
 * (`processing_status`); sự kiện yêu cầu ghi vào outbox cùng transaction với việc xếp hàng
 * (skill erp-events). Mọi phương thức nhận `tenantId` đầu tiên.
 */
export interface SocialVideoStore {
  /**
   * Đánh dấu tệp đã tải xong (`completed_at`, `size_bytes`) và xếp hàng chuyển mã (`queued`) trong MỘT transaction
   * cùng `event`. Gọi lại khi đã xếp hàng (hoặc đã xong) thì không làm gì thêm: không ghi sự kiện thứ hai.
   */
  completeAndQueue(tenantId: string, attachmentId: string, sizeBytes: number, event: SocialOutboxEvent): Promise<void>;

  /** Số video đang `queued` hoặc `processing`: của người tải và của cả tenant. */
  countInFlight(tenantId: string, uploaderId: string): Promise<{ readonly user: number; readonly tenant: number }>;

  /** Tổng dung lượng tệp chưa gắn vào bài hay bình luận của người dùng (đang tải, hoặc đã tải xong mà chưa gửi). */
  sumUnattachedBytes(tenantId: string, uploaderId: string): Promise<number>;

  /**
   * Nhận việc: chuyển `queued` (hoặc `processing` đã quá hạn thuê) sang `processing`, tăng số lần thử và đặt hạn
   * thuê `leaseSeconds`. `undefined` khi không nhận được: dòng đã xoá, đã xong, đang có worker khác làm, hoặc đã
   * hết `maxAttempts` lần thử (khi đó dòng được đánh dấu `failed`).
   */
  claim(
    tenantId: string,
    attachmentId: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<VideoClaim | undefined>;

  /** Gia hạn thuê khi chuyển mã chạy lâu. */
  extendLease(tenantId: string, attachmentId: string, leaseSeconds: number): Promise<void>;

  /**
   * Ghi kết quả: `ready`, khoá mới, dung lượng mới, poster, thời lượng, kích thước; khoá cũ sang `source_key`.
   * Trả `false` khi dòng đã bị xoá hoặc không còn `processing`: người gọi phải xoá tệp vừa tạo, không để mồ côi.
   */
  markReady(tenantId: string, attachmentId: string, result: VideoReadyResult): Promise<boolean>;

  /**
   * Thất bại. `retry` thì quay về `queued` (còn lần thử); ngược lại `failed` kèm `message` tiếng Việt cho người dùng.
   * `refundAttempt` (chỉ có nghĩa khi `retry`): trả lại lượt thử vừa tính ở `claim`, dùng khi lỗi là của máy xử lý
   * (ví dụ thiếu đĩa) chứ không phải của tệp, để tệp không bị `failed` oan vì máy đầy.
   */
  markFailed(
    tenantId: string,
    attachmentId: string,
    message: string,
    retry: boolean,
    options?: { readonly refundAttempt?: boolean },
  ): Promise<void>;

  /** Bản gốc còn chờ xoá: dòng `ready` mà `source_key` còn. */
  listSourceKeysToDelete(
    tenantId: string,
    limit: number,
  ): Promise<readonly { readonly id: string; readonly sourceKey: string }[]>;

  /** Bỏ `source_key` sau khi đã xoá bản gốc. */
  clearSourceKeys(tenantId: string, ids: readonly string[]): Promise<void>;

  /**
   * Xếp lại hàng cho video bị kẹt: tin nhắn có thể đã vào hàng chết (lỗi tạm thời kéo dài, ví dụ máy xử lý đầy đĩa)
   * trong khi dòng vẫn `queued`, hoặc worker chết giữa chừng làm dòng `processing` hết hạn thuê. Chọn tối đa
   * `limit` dòng `queued` đã hoàn tất tải quá `staleAfterSeconds` (mà chưa bị giữ lại) hoặc `processing` đã hết
   * hạn thuê, ghi lại sự kiện yêu cầu vào outbox cùng transaction; dòng `queued` được giữ `staleAfterSeconds` để
   * không bị xếp lại liên tục. Gửi trùng là vô hại vì `claim` chỉ cho một worker nhận. Trả số dòng đã xếp lại.
   */
  requeueStale(tenantId: string, staleAfterSeconds: number, limit: number): Promise<number>;
}
