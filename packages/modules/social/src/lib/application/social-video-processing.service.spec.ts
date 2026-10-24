import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SocialAttachmentPurpose } from '@enterprise-platform/contracts-social';
import {
  VideoTranscodeAbortedError,
  VideoTranscodeFailedError,
  VideoTranscodeTimeoutError,
} from '../domain/video-processing.error.js';
import type { TranscodePlan, VideoProbe } from '../domain/video-transcode.types.js';
import type { VideoTranscoder, VideoWorkStorage } from './ports/video-processing.port.js';
import { SocialVideoProcessingService } from './social-video-processing.service.js';
import type { AttachmentRow } from './social-store.port.js';
import type { SocialVideoStore, VideoClaim, VideoReadyResult } from './social-video-store.port.js';

const TENANT = 'tenant-1';

interface FakeRow {
  row: AttachmentRow;
  attempts: number;
  leaseUntil?: number;
  error?: string;
  deleted?: boolean;
}

/** Store trong bộ nhớ giữ đúng ngữ nghĩa claim/lease của hợp đồng. */
class FakeStore implements SocialVideoStore {
  rows = new Map<string, FakeRow>();
  nowMs = 1_000_000;
  extendCalls = 0;
  clearedSources: string[] = [];
  failedCalls: { message: string; retry: boolean; refundAttempt?: boolean }[] = [];
  readyResults: VideoReadyResult[] = [];
  /** Chạy trước khi markReady: test dùng để xoá dòng giữa chừng. */
  beforeMarkReady?: () => void;

  add(over: Partial<AttachmentRow> = {}, status: AttachmentRow['processingStatus'] = 'queued'): string {
    const id = randomUUID();
    this.rows.set(id, {
      attempts: 0,
      row: {
        id,
        uploadedBy: 'u1',
        fileName: 'clip.mov',
        contentType: 'video/quicktime',
        sizeBytes: 1000,
        storageKey: `tenants/${TENANT}/social/${id}/original`,
        completed: true,
        purpose: 'comment',
        processingStatus: status,
        ...over,
      },
    });
    return id;
  }

  status(id: string): string | undefined {
    return this.rows.get(id)?.row.processingStatus;
  }

  async completeAndQueue(): Promise<void> {
    /* không dùng */
  }
  async countInFlight(): Promise<{ user: number; tenant: number }> {
    return { user: 0, tenant: 0 };
  }
  async sumUnattachedBytes(): Promise<number> {
    return 0;
  }

  async claim(_t: string, id: string, leaseSeconds: number, maxAttempts: number): Promise<VideoClaim | undefined> {
    const entry = this.rows.get(id);
    if (!entry || entry.deleted) return undefined;
    const status = entry.row.processingStatus;
    const stale = status === 'processing' && (entry.leaseUntil ?? 0) < this.nowMs;
    if (status !== 'queued' && !stale) return undefined;
    if (entry.attempts >= maxAttempts) {
      entry.row = { ...entry.row, processingStatus: 'failed' };
      return undefined;
    }
    entry.attempts += 1;
    entry.leaseUntil = this.nowMs + leaseSeconds * 1000;
    entry.row = { ...entry.row, processingStatus: 'processing' };
    return { attachment: entry.row, attempt: entry.attempts };
  }

  async extendLease(): Promise<void> {
    this.extendCalls += 1;
  }

  async markReady(_t: string, id: string, result: VideoReadyResult): Promise<boolean> {
    this.beforeMarkReady?.();
    const entry = this.rows.get(id);
    if (!entry || entry.deleted || entry.row.processingStatus !== 'processing') return false;
    this.readyResults.push(result);
    entry.row = {
      ...entry.row,
      sourceKey: entry.row.storageKey,
      storageKey: result.storageKey,
      processingStatus: 'ready',
    };
    return true;
  }

  async markFailed(
    _t: string,
    id: string,
    message: string,
    retry: boolean,
    options?: { readonly refundAttempt?: boolean },
  ): Promise<void> {
    this.failedCalls.push({ message, retry, ...(options?.refundAttempt ? { refundAttempt: true } : {}) });
    const entry = this.rows.get(id);
    if (!entry) return;
    entry.row = { ...entry.row, processingStatus: retry ? 'queued' : 'failed' };
    if (!retry) entry.error = message;
  }

  async listSourceKeysToDelete(): Promise<readonly { id: string; sourceKey: string }[]> {
    return [];
  }
  async clearSourceKeys(_t: string, ids: readonly string[]): Promise<void> {
    this.clearedSources.push(...ids);
  }
  async requeueStale(): Promise<number> {
    return 0;
  }
}

class FakeStorage implements VideoWorkStorage {
  downloaded: string[] = [];
  uploaded: { key: string; contentType: string }[] = [];
  deleted: string[] = [];
  failDownload?: Error;
  failDelete = false;
  deleteFailsFor?: string;

  async downloadToFile(key: string, filePath: string): Promise<{ sizeBytes: number }> {
    if (this.failDownload) throw this.failDownload;
    this.downloaded.push(key);
    await writeFile(filePath, 'source');
    return { sizeBytes: 6 };
  }
  async uploadFromFile(key: string, _filePath: string, contentType: string): Promise<{ sizeBytes: number }> {
    this.uploaded.push({ key, contentType });
    return { sizeBytes: 321 };
  }
  async objectMetadata(): Promise<{ sizeBytes: number; contentType: string }> {
    return { sizeBytes: 1, contentType: 'x' };
  }
  async deleteObjects(keys: readonly string[]): Promise<{ failed: readonly string[] }> {
    if (this.failDelete) throw new Error('kho không xoá được');
    this.deleted.push(...keys);
    return { failed: this.deleteFailsFor && keys.includes(this.deleteFailsFor) ? [this.deleteFailsFor] : [] };
  }
}

const PROBE: VideoProbe = {
  formatNames: ['mov', 'mp4'],
  durationMs: 12_000,
  hasVideoStream: true,
  hasAudioStream: true,
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1920,
  height: 1080,
};

class FakeTranscoder implements VideoTranscoder {
  probeResult: VideoProbe = PROBE;
  transcodeError?: Error;
  writeOutput = true;
  onTranscode?: (signal?: AbortSignal) => Promise<void>;
  plans: TranscodePlan[] = [];
  lastDir?: string;

  async probe(): Promise<VideoProbe> {
    return this.probeResult;
  }
  async transcode(
    plan: TranscodePlan,
    files: { inputPath: string; outputPath: string; posterPath: string },
    signal?: AbortSignal,
  ): Promise<void> {
    this.plans.push(plan);
    this.lastDir = join(files.outputPath, '..');
    await this.onTranscode?.(signal);
    if (this.transcodeError) throw this.transcodeError;
    if (this.writeOutput) {
      await writeFile(files.outputPath, 'mp4-data');
      await writeFile(files.posterPath, 'jpg-data');
    }
  }
}

describe('SocialVideoProcessingService', () => {
  let workDir: string;
  let store: FakeStore;
  let storage: FakeStorage;
  let transcoder: FakeTranscoder;
  let logs: { level: string; line: string }[];

  const service = (over: Partial<ConstructorParameters<typeof SocialVideoProcessingService>[0]> = {}) =>
    new SocialVideoProcessingService({
      store,
      storage,
      transcoder,
      workDir,
      now: () => new Date(store.nowMs),
      minFreeDiskBytes: 0,
      freeBytes: async () => 10 ** 12,
      log: (level, line) => logs.push({ level, line }),
      ...over,
    });
  const message = (id: string, purpose: SocialAttachmentPurpose = 'comment') => ({
    tenantId: TENANT,
    attachmentId: id,
    purpose,
  });
  const events = () => logs.map((entry) => JSON.parse(entry.line) as Record<string, unknown>);

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'social-video-spec-'));
    store = new FakeStore();
    storage = new FakeStorage();
    transcoder = new FakeTranscoder();
    logs = [];
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('chuyển mã thành công: tải lên video và poster, ghi ready, xoá bản gốc', async () => {
    const id = store.add();
    const original = store.rows.get(id)!.row.storageKey;

    await expect(service().process(message(id))).resolves.toBe('ready');

    expect(storage.uploaded).toEqual([
      { key: `tenants/${TENANT}/social/${id}/video.mp4`, contentType: 'video/mp4' },
      { key: `tenants/${TENANT}/social/${id}/poster.jpg`, contentType: 'image/jpeg' },
    ]);
    expect(store.status(id)).toBe('ready');
    expect(store.readyResults[0]).toMatchObject({
      storageKey: `tenants/${TENANT}/social/${id}/video.mp4`,
      posterKey: `tenants/${TENANT}/social/${id}/poster.jpg`,
      sizeBytes: 321,
      contentType: 'video/mp4',
      durationMs: 12_000,
      height: 720,
    });
    expect(storage.deleted).toEqual([original]);
    expect(store.clearedSources).toEqual([id]);
    expect(await readdir(workDir)).toEqual([]);
    const log = events().at(-1)!;
    expect(log).toMatchObject({
      event: 'social.video.ready',
      tenantId: TENANT,
      attachmentId: id,
      purpose: 'comment',
      attempt: 1,
      outcome: 'ready',
      inputBytes: 1000,
      outputBytes: 321,
      outputHeight: 720,
    });
    expect(JSON.stringify(log)).not.toContain('clip.mov');
  });

  it('video bài viết dùng trần 1080p', async () => {
    const id = store.add({ purpose: 'post' });
    await service().process(message(id, 'post'));
    expect(store.readyResults[0]?.height).toBe(1080);
  });

  it('bị từ chối bởi kế hoạch: failed, xoá bản gốc ngay, không chuyển mã', async () => {
    const id = store.add();
    const original = store.rows.get(id)!.row.storageKey;
    transcoder.probeResult = { ...PROBE, hasVideoStream: false };

    await expect(service().process(message(id))).resolves.toBe('failed');

    expect(store.status(id)).toBe('failed');
    expect(store.failedCalls).toHaveLength(1);
    expect(store.failedCalls[0]?.retry).toBe(false);
    expect(store.failedCalls[0]?.message).toMatch(/video/i);
    expect(storage.deleted).toEqual([original]);
    expect(transcoder.plans).toHaveLength(0);
    expect(events().at(-1)).toMatchObject({ event: 'social.video.failed', outcome: 'failed', reason: 'no_video_stream' });
    expect(await readdir(workDir)).toEqual([]);
  });

  it('ffmpeg báo tệp hỏng: failed không thử lại, thông báo tiếng Việt, xoá bản gốc', async () => {
    const id = store.add();
    transcoder.transcodeError = new VideoTranscodeFailedError('ffmpeg exit 1', 1);

    await expect(service().process(message(id))).resolves.toBe('failed');

    expect(store.failedCalls).toEqual([
      { message: 'Không chuyển mã được video. Tệp có thể bị hỏng hoặc không được hỗ trợ.', retry: false },
    ]);
    expect(storage.deleted).toEqual([`tenants/${TENANT}/social/${id}/original`]);
    expect(await readdir(workDir)).toEqual([]);
  });

  it('timeout: failed với thông báo quá lâu', async () => {
    const id = store.add();
    transcoder.transcodeError = new VideoTranscodeTimeoutError();

    await expect(service().process(message(id))).resolves.toBe('failed');

    expect(store.failedCalls[0]).toMatchObject({ retry: false });
    expect(store.failedCalls[0]?.message).toContain('quá lâu');
    expect(events().at(-1)).toMatchObject({ reason: 'timeout' });
  });

  it('worker tắt (signal của người gọi huỷ): retry khi còn lần thử, về queued', async () => {
    const id = store.add();
    const controller = new AbortController();
    transcoder.onTranscode = async () => {
      controller.abort();
      throw new VideoTranscodeAbortedError();
    };

    await expect(service().process(message(id), controller.signal)).resolves.toBe('retry');

    expect(store.status(id)).toBe('queued');
    expect(store.failedCalls[0]).toMatchObject({ retry: true, refundAttempt: true });
    expect(storage.deleted).toEqual([]);
    expect(await readdir(workDir)).toEqual([]);
    expect(events().at(-1)).toMatchObject({ event: 'social.video.retry', outcome: 'retry', reason: 'aborted' });
  });

  it('lỗi kho khi tải xuống: retry; hết lần thử thì failed và xoá bản gốc', async () => {
    const id = store.add();
    storage.failDownload = new Error('mạng đứt');
    const svc = service({ maxAttempts: 2 });

    await expect(svc.process(message(id))).resolves.toBe('retry');
    expect(store.status(id)).toBe('queued');
    expect(storage.deleted).toEqual([]);

    await expect(svc.process(message(id))).resolves.toBe('failed');
    expect(store.status(id)).toBe('failed');
    expect(store.failedCalls.at(-1)).toEqual({ message: 'Không xử lý được video sau nhiều lần thử.', retry: false });
    expect(storage.deleted).toEqual([`tenants/${TENANT}/social/${id}/original`]);
  });

  it('đĩa thiếu chỗ: retry mà không tải gì về, và dọn thư mục tạm', async () => {
    const id = store.add({ sizeBytes: 1000 });
    const svc = service({ freeBytes: async () => 2000, minFreeDiskBytes: 600 }); // cần 2,5 x 1000 + 600

    await expect(svc.process(message(id))).resolves.toBe('retry');

    expect(storage.downloaded).toEqual([]);
    expect(store.failedCalls).toEqual([{ message: expect.any(String), retry: true, refundAttempt: true }]);
    expect(store.status(id)).toBe('queued');
    expect(events().at(-1)).toMatchObject({ reason: 'low_disk' });
    expect(await readdir(workDir)).toEqual([]);
  });

  it('đĩa vừa đủ thì chạy', async () => {
    const id = store.add({ sizeBytes: 1000 });
    const svc = service({ freeBytes: async () => 3100, minFreeDiskBytes: 600 });
    await expect(svc.process(message(id))).resolves.toBe('ready');
  });

  it('dòng bị xoá giữa chừng: discarded, xoá video, poster và bản gốc', async () => {
    const id = store.add();
    const original = store.rows.get(id)!.row.storageKey;
    store.beforeMarkReady = () => {
      store.rows.get(id)!.deleted = true;
    };

    await expect(service().process(message(id))).resolves.toBe('discarded');

    expect(storage.deleted).toEqual(
      expect.arrayContaining([
        `tenants/${TENANT}/social/${id}/video.mp4`,
        `tenants/${TENANT}/social/${id}/poster.jpg`,
        original,
      ]),
    );
    expect(store.clearedSources).toEqual([]);
    expect(events().at(-1)).toMatchObject({ event: 'social.video.discarded', outcome: 'discarded' });
    expect(await readdir(workDir)).toEqual([]);
  });

  it('xoá bản gốc thất bại vẫn ready, giữ source_key cho job dọn', async () => {
    const id = store.add();
    storage.deleteFailsFor = store.rows.get(id)!.row.storageKey;

    await expect(service().process(message(id))).resolves.toBe('ready');
    expect(store.clearedSources).toEqual([]);

    const other = store.add();
    storage.deleteFailsFor = undefined;
    storage.failDelete = true;
    await expect(service().process(message(other))).resolves.toBe('ready');
    expect(store.clearedSources).toEqual([]);
  });

  it('đầu ra rỗng hoặc không có: failed', async () => {
    const id = store.add();
    transcoder.writeOutput = false;

    await expect(service().process(message(id))).resolves.toBe('failed');
    expect(storage.uploaded).toEqual([]);
    expect(store.status(id)).toBe('failed');
  });

  it('hai tiến trình cùng một id: chỉ một chạy', async () => {
    const id = store.add();
    const svc = service();
    const results = await Promise.all([svc.process(message(id)), svc.process(message(id))]);
    expect(results.sort()).toEqual(['ready', 'skipped']);
    expect(storage.uploaded).toHaveLength(2);
  });

  it('đã ready, đã failed hoặc không tồn tại: skipped', async () => {
    const ready = store.add({}, 'ready');
    const failed = store.add({}, 'failed');
    const svc = service();
    await expect(svc.process(message(ready))).resolves.toBe('skipped');
    await expect(svc.process(message(failed))).resolves.toBe('skipped');
    await expect(svc.process(message(randomUUID()))).resolves.toBe('skipped');
    expect(storage.downloaded).toEqual([]);
    expect(events().every((entry) => entry.event === 'social.video.skipped')).toBe(true);
  });

  it('worker chết giữa chừng: việc được nhận lại sau khi hết hạn thuê', async () => {
    const id = store.add();
    // Worker 1 nhận rồi chết (không gọi gì thêm).
    const first = await store.claim(TENANT, id, 120, 3);
    expect(first?.attempt).toBe(1);

    // Còn hạn thuê: không ai nhận được.
    await expect(service().process(message(id))).resolves.toBe('skipped');

    store.nowMs += 121_000;
    await expect(service().process(message(id))).resolves.toBe('ready');
    expect(events().find((entry) => entry.event === 'social.video.started')).toMatchObject({ attempt: 2 });
  });

  it('worker chết quá số lần thử: failed, không chạy', async () => {
    const id = store.add();
    for (let i = 0; i < 3; i += 1) {
      await store.claim(TENANT, id, 120, 3);
      store.nowMs += 121_000;
    }
    await expect(service().process(message(id))).resolves.toBe('skipped');
    expect(store.status(id)).toBe('failed');
    expect(transcoder.plans).toHaveLength(0);
  });

  it('heartbeat gia hạn thuê trong khi chuyển mã chạy lâu', async () => {
    const id = store.add();
    transcoder.onTranscode = () => new Promise((resolve) => setTimeout(resolve, 120));
    // leaseSeconds 0.09 -> heartbeat mỗi 30 ms.
    await service({ leaseSeconds: 0.09 }).process(message(id));
    expect(store.extendCalls).toBeGreaterThanOrEqual(2);
  });

  it('lỗi gia hạn thuê không làm hỏng việc', async () => {
    const id = store.add();
    store.extendLease = async () => {
      throw new Error('db chập chờn');
    };
    transcoder.onTranscode = () => new Promise((resolve) => setTimeout(resolve, 100));
    await expect(service({ leaseSeconds: 0.09 }).process(message(id))).resolves.toBe('ready');
  });

  it('luôn dọn thư mục tạm kể cả khi lỗi bất ngờ', async () => {
    const id = store.add();
    const made: string[] = [];
    const svc = service({
      makeTempDir: async (dir) => {
        const path = await mkdtemp(join(dir, 'job-'));
        made.push(path);
        return path;
      },
    });
    transcoder.transcodeError = new Error('boom');
    await svc.process(message(id));
    expect(made).toHaveLength(1);
    expect(await readdir(workDir)).toEqual([]);
  });
});
