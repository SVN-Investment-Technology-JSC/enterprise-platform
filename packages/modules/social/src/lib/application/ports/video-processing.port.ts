import type { SocialAttachmentPurpose } from '@enterprise-platform/contracts-social';
import type {
  TranscodePlan,
  VideoProbe,
  VideoTranscodeFiles,
} from '../../domain/video-transcode.types.js';

export type {
  TranscodePlan,
  TranscodePlanResult,
  VideoProbe,
  VideoRejectReason,
  VideoTranscodeFiles,
} from '../../domain/video-transcode.types.js';

/** Chạy ffprobe/ffmpeg thật; hiện thực nằm ở `apps/video-worker`, test dùng bản giả. */
export interface VideoTranscoder {
  probe(inputPath: string, signal?: AbortSignal): Promise<VideoProbe>;
  /**
   * Chạy ffmpeg theo `plan`, ghi `outputPath` và `posterPath`. Ném `VideoTranscodeFailedError` (tệp hỏng),
   * `VideoTranscodeTimeoutError` (quá `plan.timeoutMs`) hoặc `VideoTranscodeAbortedError` (bị huỷ).
   */
  transcode(plan: TranscodePlan, files: VideoTranscodeFiles, signal?: AbortSignal): Promise<void>;
}

/** Phần kho object mà worker cần cho tệp lớn: tải xuống đĩa và tải lên từ đĩa, không đưa cả tệp vào RAM. */
export interface VideoWorkStorage {
  downloadToFile(
    key: string,
    filePath: string,
    options?: { readonly maxBytes?: number; readonly signal?: AbortSignal },
  ): Promise<{ readonly sizeBytes: number }>;
  uploadFromFile(
    key: string,
    filePath: string,
    contentType: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly sizeBytes: number }>;
  objectMetadata(key: string): Promise<{ readonly sizeBytes: number; readonly contentType: string }>;
  deleteObjects(keys: readonly string[]): Promise<{ readonly failed: readonly string[] }>;
}

/** Tin nhắn từ hàng đợi RabbitMQ (envelope có `tenantId`, payload có `attachmentId` và `purpose`). */
export interface VideoProcessingMessage {
  readonly tenantId: string;
  readonly attachmentId: string;
  readonly purpose: SocialAttachmentPurpose;
}

/**
 * - `ready`: đã chuyển mã xong.
 * - `failed`: không chuyển mã được, đã đánh dấu `failed` (không thử lại).
 * - `retry`: lỗi tạm thời, người gọi ném lỗi tạm thời để RabbitMQ gửi lại.
 * - `skipped`: không có gì để làm (đã xong, đã xoá, hoặc worker khác đang làm).
 * - `discarded`: dòng bị xoá giữa chừng; kết quả đã bị bỏ và tệp tạo ra đã xoá.
 */
export type VideoProcessingOutcome = 'ready' | 'failed' | 'retry' | 'skipped' | 'discarded';

export interface VideoProcessor {
  process(message: VideoProcessingMessage, signal?: AbortSignal): Promise<VideoProcessingOutcome>;
}
