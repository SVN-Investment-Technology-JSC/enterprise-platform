import { rmSync, statSync, writeFileSync } from 'node:fs';

/**
 * Nhịp tim bằng tệp cho tiến trình nền không mở cổng HTTP (worker): tiến trình ghi tệp định kỳ khi còn khoẻ,
 * HEALTHCHECK của container đọc mtime của tệp (ISS-OPS-014). Cùng cách với `apps/video-worker/src/heartbeat.ts`.
 */

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Quá 4 chu kỳ không ghi thì coi là không khoẻ. */
export const HEARTBEAT_MAX_AGE_MS = 60_000;

export interface FileHeartbeatOptions {
  readonly file: string;
  /** Chỉ ghi khi trả về true (ví dụ mọi consumer RabbitMQ còn kênh). */
  readonly isHealthy: () => boolean;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly writeFile?: (file: string, content: string) => void;
  readonly removeFile?: (file: string) => void;
  readonly setInterval?: (callback: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly warn?: (message: string) => void;
}

/** Ghi ngay và định kỳ; trả hàm dừng: ngừng ghi và xoá tệp để lần chạy sau không đọc nhầm nhịp tim cũ. */
export function startFileHeartbeat(options: FileHeartbeatOptions): () => void {
  const now = options.now ?? Date.now;
  const write = options.writeFile ?? ((file, content) => writeFileSync(file, content));
  const remove = options.removeFile ?? ((file) => rmSync(file, { force: true }));
  const schedule = options.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms));
  const cancel = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as NodeJS.Timeout));
  const warn = options.warn ?? ((message) => console.warn(message));
  let stopped = false;
  let warned = false;

  const beat = () => {
    if (stopped || !options.isHealthy()) return;
    try {
      write(options.file, String(now()));
    } catch (error) {
      if (warned) return;
      warned = true;
      warn(`Không ghi được tệp nhịp tim ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  beat();
  const handle = schedule(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  (handle as { unref?: () => void } | undefined)?.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    cancel(handle);
    try {
      remove(options.file);
    } catch {
      /* không xoá được thì mtime cũ cũng làm HEALTHCHECK báo không khoẻ */
    }
  };
}

/** Tệp nhịp tim tồn tại và được ghi trong `maxAgeMs` gần nhất. */
export function heartbeatIsFresh(
  file: string,
  maxAgeMs: number = HEARTBEAT_MAX_AGE_MS,
  now: number = Date.now(),
  stat: (file: string) => { mtimeMs: number } = statSync,
): boolean {
  try {
    return now - stat(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}
