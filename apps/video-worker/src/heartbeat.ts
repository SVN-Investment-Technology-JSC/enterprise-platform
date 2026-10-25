import { rmSync, writeFileSync } from 'node:fs';

export const HEARTBEAT_INTERVAL_MS = 15_000;

export interface HeartbeatOptions {
  readonly file: string;
  /** Chỉ ghi khi trả về true (consumer đã sẵn sàng và chưa tắt máy). */
  readonly isHealthy: () => boolean;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly writeFile?: (file: string, content: string) => void;
  readonly removeFile?: (file: string) => void;
  readonly setInterval?: (callback: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly warn?: (message: string) => void;
}

/**
 * Ghi tệp heartbeat ngay và định kỳ; HEALTHCHECK của container đọc mtime của tệp này.
 * Trả hàm dừng: ngừng ghi và xoá tệp để bản chạy kế tiếp không đọc nhầm.
 */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const now = options.now ?? Date.now;
  const write = options.writeFile ?? ((file, content) => writeFileSync(file, content));
  const remove =
    options.removeFile ??
    ((file) => {
      rmSync(file, { force: true });
    });
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
      if (!warned) {
        warned = true;
        warn(
          JSON.stringify({
            event: 'social.video_worker.heartbeat_write_failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
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
      /* tệp không xoá được thì mtime cũ cũng khiến HEALTHCHECK báo không khoẻ */
    }
  };
}
