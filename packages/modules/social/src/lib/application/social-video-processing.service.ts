import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { SOCIAL_VIDEO_LIMITS, type SocialAttachmentPurpose } from '@enterprise-platform/contracts-social';
import { Logger } from '@nestjs/common';
import { planTranscode } from '../domain/video-transcode-plan.js';
import {
  VideoTranscodeAbortedError,
  VideoTranscodeFailedError,
  VideoTranscodeTimeoutError,
} from '../domain/video-processing.error.js';
import type {
  VideoProcessingMessage,
  VideoProcessingOutcome,
  VideoProcessor,
  VideoTranscoder,
  VideoWorkStorage,
} from './ports/video-processing.port.js';
import type { SocialVideoStore } from './social-video-store.port.js';

const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_FREE_DISK_BYTES = 1024 * 1024 * 1024;
/** Cần chỗ cho bản gốc, bản mới và tệp tạm của ffmpeg. */
const DISK_FACTOR = 2.5;
/** Dư cho chênh lệch giữa `size_bytes` đã khai và kích thước thật khi tải xuống. */
const DOWNLOAD_SLACK_BYTES = 1024 * 1024;

const MESSAGE_TRANSCODE_FAILED = 'Không chuyển mã được video. Tệp có thể bị hỏng hoặc không được hỗ trợ.';
const MESSAGE_TIMEOUT = 'Video xử lý quá lâu nên đã bị dừng. Hãy thử video ngắn hoặc nhẹ hơn.';
const MESSAGE_EXHAUSTED = 'Không xử lý được video sau nhiều lần thử.';
const MESSAGE_EMPTY_OUTPUT = 'Không chuyển mã được video: kết quả rỗng.';

type LogEvent = 'started' | 'ready' | 'failed' | 'retry' | 'discarded' | 'skipped';
type LogLevel = 'log' | 'warn';

export interface SocialVideoProcessingOptions {
  readonly store: SocialVideoStore;
  readonly storage: VideoWorkStorage;
  readonly transcoder: VideoTranscoder;
  /** Thư mục tạm; mỗi việc tạo một thư mục con và xoá khi xong. */
  readonly workDir: string;
  readonly now?: () => Date;
  /** Thời gian thuê việc; heartbeat gia hạn mỗi `leaseSeconds / 3`. Mặc định 120. */
  readonly leaseSeconds?: number;
  /** Số lần thử tối đa trước khi đánh dấu `failed`. Mặc định 3. */
  readonly maxAttempts?: number;
  /** Chỗ trống tối thiểu còn lại sau khi trừ `2,5 x size_bytes`. Mặc định 1 GiB. */
  readonly minFreeDiskBytes?: number;
  /** Nhận một dòng JSON nhật ký; mặc định ghi qua Logger của Nest. */
  readonly log?: (level: LogLevel, line: string) => void;
  /** Tạo thư mục tạm riêng cho một việc (tiêm được để test). */
  readonly makeTempDir?: (workDir: string) => Promise<string>;
  /** Số byte trống tại `path` (tiêm được để test). */
  readonly freeBytes?: (path: string) => Promise<number>;
}

interface LogFields {
  readonly tenantId: string;
  readonly attachmentId: string;
  readonly purpose: SocialAttachmentPurpose;
  readonly attempt?: number;
  readonly inputBytes?: number;
  readonly outputBytes?: number;
  readonly outputHeight?: number;
  readonly reason?: string;
}

async function defaultFreeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return Number(info.bavail) * Number(info.bsize);
}

/**
 * Xử lý một video: nhận việc, tải bản gốc, kiểm tra, chuyển mã, tải bản mới và poster, ghi kết quả, xoá bản gốc.
 * Không ném lỗi cho nhánh đã biết cách xử lý; lỗi DB khi nhận việc hoặc khi ghi trạng thái được ném lên để
 * RabbitMQ gửi lại (việc đã nhận sẽ được nhận lại sau khi hết hạn thuê).
 */
export class SocialVideoProcessingService implements VideoProcessor {
  private readonly logger = new Logger('SocialVideo');

  constructor(readonly options: SocialVideoProcessingOptions) {}

  async process(message: VideoProcessingMessage, signal?: AbortSignal): Promise<VideoProcessingOutcome> {
    const { tenantId, attachmentId, purpose } = message;
    const { store } = this.options;
    const leaseSeconds = this.options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const started = this.clock();
    const base = { tenantId, attachmentId, purpose };

    const claim = await store.claim(tenantId, attachmentId, leaseSeconds, maxAttempts);
    if (!claim) {
      this.log('skipped', 'skipped', started, { ...base, reason: 'not_claimed' });
      return 'skipped';
    }
    const { attachment, attempt } = claim;
    const fields: LogFields = { ...base, attempt, inputBytes: attachment.sizeBytes };
    this.log('started', undefined, started, fields);

    const makeTempDir = this.options.makeTempDir ?? ((dir: string) => mkdtemp(join(dir, 'video-')));
    let dir: string | undefined;
    const heartbeat = setInterval(() => {
      store.extendLease(tenantId, attachmentId, leaseSeconds).catch(() => undefined);
    }, (leaseSeconds * 1000) / 3);
    heartbeat.unref();
    const created: string[] = [];
    try {
      dir = await makeTempDir(this.options.workDir);
      return await this.run(message, claim, dir, started, created, signal);
    } catch (error) {
      return await this.handleError(error, fields, attachment.storageKey, started, created, maxAttempts);
    } finally {
      clearInterval(heartbeat);
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async run(
    message: VideoProcessingMessage,
    claim: NonNullable<Awaited<ReturnType<SocialVideoStore['claim']>>>,
    dir: string,
    started: number,
    created: string[],
    signal: AbortSignal | undefined,
  ): Promise<VideoProcessingOutcome> {
    const { store, storage, transcoder } = this.options;
    const { tenantId, attachmentId, purpose } = message;
    const { attachment, attempt } = claim;
    const fields: LogFields = { tenantId, attachmentId, purpose, attempt, inputBytes: attachment.sizeBytes };

    // Thiếu chỗ là lỗi tạm thời của máy này, không phải lỗi của tệp: trả về hàng đợi và hoàn lại lượt thử vừa tính,
    // để máy đầy không làm tệp hết lượt thử rồi `failed` oan. RabbitMQ gửi lại sau khoảng trễ.
    const free = await (this.options.freeBytes ?? defaultFreeBytes)(dir);
    const needed = DISK_FACTOR * attachment.sizeBytes + (this.options.minFreeDiskBytes ?? DEFAULT_MIN_FREE_DISK_BYTES);
    if (free < needed) {
      await store.markFailed(tenantId, attachmentId, 'Máy xử lý video thiếu dung lượng đĩa.', true, {
        refundAttempt: true,
      });
      this.log('retry', 'retry', started, { ...fields, reason: 'low_disk' });
      return 'retry';
    }

    const inputPath = join(dir, 'input');
    const outputPath = join(dir, 'output.mp4');
    const posterPath = join(dir, 'poster.jpg');

    await storage.downloadToFile(attachment.storageKey, inputPath, {
      maxBytes: SOCIAL_VIDEO_LIMITS[purpose].maxBytes + DOWNLOAD_SLACK_BYTES,
      ...(signal ? { signal } : {}),
    });

    const probe = await transcoder.probe(inputPath, signal);
    const planned = planTranscode(probe, purpose);
    if (!planned.ok) {
      await store.markFailed(tenantId, attachmentId, planned.message, false);
      await this.deleteQuietly([attachment.storageKey]);
      this.log('failed', 'failed', started, { ...fields, reason: planned.reason });
      return 'failed';
    }
    const { plan } = planned;

    const timeout = AbortSignal.timeout(plan.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      await transcoder.transcode(plan, { inputPath, outputPath, posterPath }, combined);
    } catch (error) {
      // Hết giờ do `timeoutMs` của kế hoạch (không phải worker tắt) thì là timeout dù transcoder báo là bị huỷ.
      if (error instanceof VideoTranscodeAbortedError && timeout.aborted && !signal?.aborted) {
        throw new VideoTranscodeTimeoutError();
      }
      throw error;
    }

    const [outputInfo, posterInfo] = await Promise.all([
      stat(outputPath).catch(() => undefined),
      stat(posterPath).catch(() => undefined),
    ]);
    if (!outputInfo || outputInfo.size <= 0 || !posterInfo || posterInfo.size <= 0) {
      throw new VideoTranscodeFailedError(MESSAGE_EMPTY_OUTPUT);
    }

    const base = `tenants/${tenantId}/social/${attachmentId}`;
    const videoKey = `${base}/video.mp4`;
    const posterKey = `${base}/poster.jpg`;
    const uploadOptions = signal ? { signal } : undefined;
    created.push(videoKey);
    const video = await storage.uploadFromFile(videoKey, outputPath, 'video/mp4', uploadOptions);
    created.push(posterKey);
    await storage.uploadFromFile(posterKey, posterPath, 'image/jpeg', uploadOptions);

    const written = await store.markReady(tenantId, attachmentId, {
      storageKey: videoKey,
      sizeBytes: video.sizeBytes,
      contentType: 'video/mp4',
      posterKey,
      durationMs: probe.durationMs,
      width: plan.outputWidth,
      height: plan.outputHeight,
    });
    if (!written) {
      // Người dùng đóng tab hoặc huỷ giữa chừng: không ai còn giữ tệp nào, xoá hết để không mồ côi.
      await this.deleteQuietly([videoKey, posterKey, attachment.storageKey]);
      created.length = 0;
      this.log('discarded', 'discarded', started, { ...fields, reason: 'row_deleted' });
      return 'discarded';
    }
    created.length = 0;

    // Xoá bản gốc ngay; hỏng thì để `source_key` cho job dọn thử lại, kết quả vẫn hợp lệ.
    try {
      const { failed } = await storage.deleteObjects([attachment.storageKey]);
      if (failed.length === 0) await store.clearSourceKeys(tenantId, [attachmentId]);
    } catch {
      /* giữ source_key cho job dọn */
    }
    this.log('ready', 'ready', started, {
      ...fields,
      outputBytes: video.sizeBytes,
      outputHeight: plan.outputHeight,
    });
    return 'ready';
  }

  private async handleError(
    error: unknown,
    fields: LogFields,
    sourceKey: string,
    started: number,
    created: readonly string[],
    maxAttempts: number,
  ): Promise<VideoProcessingOutcome> {
    const { store } = this.options;
    const { tenantId, attachmentId } = fields;
    const attempt = fields.attempt ?? maxAttempts;
    // Tệp đã tải lên dở dang không còn ai nhận; bản sau sẽ ghi đè cùng khoá, nhưng dòng có thể bị xoá trước đó.
    if (created.length > 0) await this.deleteQuietly(created);

    if (error instanceof VideoTranscodeFailedError) {
      await store.markFailed(tenantId, attachmentId, MESSAGE_TRANSCODE_FAILED, false);
      await this.deleteQuietly([sourceKey]);
      this.log('failed', 'failed', started, { ...fields, reason: 'transcode_failed' });
      return 'failed';
    }
    if (error instanceof VideoTranscodeTimeoutError) {
      await store.markFailed(tenantId, attachmentId, MESSAGE_TIMEOUT, false);
      await this.deleteQuietly([sourceKey]);
      this.log('failed', 'failed', started, { ...fields, reason: 'timeout' });
      return 'failed';
    }

    const reason = error instanceof VideoTranscodeAbortedError ? 'aborted' : 'error';
    if (reason === 'aborted') {
      // Worker đang tắt (deploy, restart): không phải lỗi của tệp, nên trả lại lượt thử để nhiều lần khởi động lại
      // liên tiếp không làm video `failed` oan.
      await store.markFailed(tenantId, attachmentId, MESSAGE_EXHAUSTED, true, { refundAttempt: true });
      this.log('retry', 'retry', started, { ...fields, reason });
      return 'retry';
    }
    if (attempt < maxAttempts) {
      await store.markFailed(tenantId, attachmentId, MESSAGE_EXHAUSTED, true);
      this.log('retry', 'retry', started, { ...fields, reason });
      return 'retry';
    }
    await store.markFailed(tenantId, attachmentId, MESSAGE_EXHAUSTED, false);
    await this.deleteQuietly([sourceKey]);
    this.log('failed', 'failed', started, { ...fields, reason: 'attempts_exhausted' });
    return 'failed';
  }

  /** Xoá object, bỏ qua lỗi: việc dọn không được làm hỏng kết quả chính. */
  private async deleteQuietly(keys: readonly string[]): Promise<void> {
    try {
      await this.options.storage.deleteObjects(keys);
    } catch {
      /* job dọn tệp mồ côi sẽ thử lại */
    }
  }

  private clock(): number {
    return (this.options.now?.() ?? new Date()).getTime();
  }

  private log(event: LogEvent, outcome: VideoProcessingOutcome | undefined, started: number, fields: LogFields): void {
    const line = JSON.stringify({
      event: `social.video.${event}`,
      ...fields,
      ...(outcome ? { outcome, durationMs: this.clock() - started } : {}),
    });
    const level: LogLevel = event === 'failed' || event === 'retry' ? 'warn' : 'log';
    if (this.options.log) this.options.log(level, line);
    else if (level === 'warn') this.logger.warn(line);
    else this.logger.log(line);
  }
}
