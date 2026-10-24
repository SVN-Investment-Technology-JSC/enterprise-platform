import { mkdtemp, mkdir, rm, utimes, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PermanentMessageError, TransientConsumerError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { VideoProcessingOutcome, VideoProcessor } from '@enterprise-platform/module-social';
import { readConfig } from './config.js';
import { cleanStaleWorkDirs } from './stale-work-dirs.js';
import { createVideoMessageHandler } from './video-message-handler.js';

function envelope(payload: unknown, tenantId = 'tenant-1'): IntegrationEventEnvelope {
  return {
    id: 'e1',
    type: 'social.video.comment_requested',
    version: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    source: 'social',
    correlationId: 'c1',
    payload,
  };
}

function setup(outcome: VideoProcessingOutcome, canProcess = true) {
  const process = jest.fn<ReturnType<VideoProcessor['process']>, Parameters<VideoProcessor['process']>>(() =>
    Promise.resolve(outcome),
  );
  const controller = new AbortController();
  const handler = createVideoMessageHandler({
    processor: { process },
    canProcess: () => Promise.resolve(canProcess),
    signal: controller.signal,
  });
  return { process, controller, handler };
}

const valid = { attachmentId: 'a1', purpose: 'comment' };

describe('createVideoMessageHandler', () => {
  it.each<VideoProcessingOutcome>(['ready', 'failed', 'skipped', 'discarded'])('outcome %s: ack (không ném)', async (outcome) => {
    const { handler, process } = setup(outcome);
    await expect(handler(envelope(valid))).resolves.toBeUndefined();
    expect(process).toHaveBeenCalledWith({ tenantId: 'tenant-1', attachmentId: 'a1', purpose: 'comment' }, expect.any(AbortSignal));
  });

  it('outcome retry: ném TransientConsumerError để gửi lại có độ trễ', async () => {
    const { handler } = setup('retry');
    await expect(handler(envelope(valid))).rejects.toBeInstanceOf(TransientConsumerError);
  });

  it('retry khi đang tắt máy: không ném (broker tự giao lại tin chưa ack)', async () => {
    const { handler, controller } = setup('retry');
    controller.abort();
    await expect(handler(envelope(valid))).resolves.toBeUndefined();
  });

  it('tenant chưa bật social hoặc không hoạt động: ack, không xử lý', async () => {
    const { handler, process } = setup('ready', false);
    await expect(handler(envelope(valid))).resolves.toBeUndefined();
    expect(process).not.toHaveBeenCalled();
  });

  it.each([
    ['thiếu attachmentId', { purpose: 'comment' }],
    ['purpose lạ', { attachmentId: 'a1', purpose: 'chat' }],
    ['payload rỗng', null],
  ])('tin hỏng (%s): PermanentMessageError, không xử lý', async (_name, payload) => {
    const { handler, process } = setup('ready');
    await expect(handler(envelope(payload))).rejects.toBeInstanceOf(PermanentMessageError);
    expect(process).not.toHaveBeenCalled();
  });

  it('thiếu tenantId: PermanentMessageError', async () => {
    const { handler } = setup('ready');
    await expect(handler(envelope(valid, ''))).rejects.toBeInstanceOf(PermanentMessageError);
  });

  it('lỗi không rõ của service lan ra để consumer thử lại theo hàng chờ retry', async () => {
    const { handler, process } = setup('ready');
    process.mockRejectedValueOnce(new Error('db down'));
    await expect(handler(envelope(valid))).rejects.toThrow('db down');
  });
});

describe('readConfig', () => {
  it('mặc định và giá trị sai', () => {
    const config = readConfig({ VIDEO_WORKER_FFMPEG_THREADS: 'abc', VIDEO_WORKER_POST_CONCURRENCY: '0', VIDEO_WORKER_MIN_FREE_DISK_GB: '2.5' });
    expect(config).toMatchObject({
      ffmpegThreads: 2,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      minFreeDiskGb: 2.5,
      maxAttempts: 3,
      leaseSeconds: 120,
      commentConcurrency: 1,
      postConcurrency: 1,
    });
    expect(config.tmpDir.endsWith('video-work')).toBe(true);
  });
});

describe('cleanStaleWorkDirs', () => {
  it('chỉ xoá thư mục cũ hơn ngưỡng', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'video-worker-clean-'));
    try {
      await mkdir(path.join(root, 'old'));
      await mkdir(path.join(root, 'fresh'));
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(path.join(root, 'old'), past, past);
      expect(await cleanStaleWorkDirs(root, 60 * 60 * 1000)).toBe(1);
      expect(await readdir(root)).toEqual(['fresh']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
