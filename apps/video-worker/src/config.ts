import os from 'node:os';
import path from 'node:path';

export interface VideoWorkerConfig {
  readonly tmpDir: string;
  readonly ffmpegThreads: number;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly minFreeDiskGb: number;
  readonly maxAttempts: number;
  readonly leaseSeconds: number;
  readonly commentConcurrency: number;
  readonly postConcurrency: number;
}

function positiveNumber(raw: string | undefined, fallback: number, integer = true): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return integer ? Math.max(1, Math.trunc(value)) : value;
}

/** Đọc cấu hình từ biến môi trường `VIDEO_WORKER_*`; giá trị sai hoặc không dương thì dùng mặc định. */
export function readConfig(env: NodeJS.ProcessEnv): VideoWorkerConfig {
  return {
    tmpDir: env['VIDEO_WORKER_TMP_DIR']?.trim() || path.join(os.tmpdir(), 'video-work'),
    ffmpegThreads: positiveNumber(env['VIDEO_WORKER_FFMPEG_THREADS'], 2),
    ffmpegPath: env['VIDEO_WORKER_FFMPEG_PATH']?.trim() || 'ffmpeg',
    ffprobePath: env['VIDEO_WORKER_FFPROBE_PATH']?.trim() || 'ffprobe',
    minFreeDiskGb: positiveNumber(env['VIDEO_WORKER_MIN_FREE_DISK_GB'], 5, false),
    maxAttempts: positiveNumber(env['VIDEO_WORKER_MAX_ATTEMPTS'], 3),
    leaseSeconds: positiveNumber(env['VIDEO_WORKER_LEASE_SECONDS'], 120),
    commentConcurrency: positiveNumber(env['VIDEO_WORKER_COMMENT_CONCURRENCY'], 1),
    postConcurrency: positiveNumber(env['VIDEO_WORKER_POST_CONCURRENCY'], 1),
  };
}
