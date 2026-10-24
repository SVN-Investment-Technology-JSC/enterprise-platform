import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import {
  parseFfprobeOutput,
  VideoTranscodeAbortedError,
  VideoTranscodeFailedError,
  VideoTranscodeTimeoutError,
  type TranscodePlan,
  type VideoProbe,
  type VideoTranscodeFiles,
  type VideoTranscoder,
} from '@enterprise-platform/module-social';

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface FfmpegTranscoderOptions {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  /** Số luồng ffmpeg; bỏ qua nếu kế hoạch đã có `-threads`. */
  readonly threads?: number;
  /** Mức ưu tiên (nice) của tiến trình ffmpeg; 0 hoặc bỏ trống là không đổi. */
  readonly niceness?: number;
  readonly probeTimeoutMs?: number;
  /** Chỉ để test. */
  readonly spawn?: SpawnFn;
}

const PROBE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const STDERR_TAIL_BYTES = 4 * 1024;
const DEFAULT_PROBE_TIMEOUT_MS = 60_000;
const DEFAULT_NICENESS = 10;

interface RunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxStdoutBytes: number;
  readonly niceness?: number;
}

interface RunResult {
  readonly stdout: Buffer;
  readonly stderrTail: string;
}

/** Chạy ffprobe và ffmpeg bằng `child_process.spawn` (không qua shell). Mọi tham số ffmpeg do `TranscodePlan` quyết định. */
export class FfmpegTranscoder implements VideoTranscoder {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly threads: number;
  private readonly niceness: number;
  private readonly probeTimeoutMs: number;
  private readonly spawnFn: SpawnFn;

  constructor(options: FfmpegTranscoderOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.threads = Math.max(1, Math.trunc(options.threads ?? 2));
    this.niceness = options.niceness ?? DEFAULT_NICENESS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.spawnFn = options.spawn ?? nodeSpawn;
  }

  async probe(inputPath: string, signal?: AbortSignal): Promise<VideoProbe> {
    const result = await this.run(
      this.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', inputPath],
      { timeoutMs: this.probeTimeoutMs, signal, maxStdoutBytes: PROBE_MAX_OUTPUT_BYTES },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.toString('utf8'));
    } catch {
      throw new VideoTranscodeFailedError('ffprobe trả về dữ liệu không phải JSON.');
    }
    return parseFfprobeOutput(parsed);
  }

  async transcode(plan: TranscodePlan, files: VideoTranscodeFiles, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + plan.timeoutMs;
    const videoArgs = withThreads([...plan.videoArgs(files)], this.threads);
    await this.run(this.ffmpegPath, videoArgs, {
      timeoutMs: plan.timeoutMs,
      signal,
      maxStdoutBytes: 0,
      niceness: this.niceness,
    });
    // Poster dùng nốt phần thời gian còn lại của kế hoạch (tối thiểu vài giây để không thất bại vì làm tròn).
    await this.run(this.ffmpegPath, [...plan.posterArgs(files)], {
      timeoutMs: Math.max(5_000, deadline - Date.now()),
      signal,
      maxStdoutBytes: 0,
      niceness: this.niceness,
    });
    await requireNonEmptyFile(files.outputPath, 'video');
    await requireNonEmptyFile(files.posterPath, 'poster');
  }

  private run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new VideoTranscodeAbortedError());
        return;
      }
      let child: ChildProcess;
      try {
        child = this.spawnFn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (error) {
        reject(new VideoTranscodeFailedError(`Không chạy được ${command}: ${describe(error)}`));
        return;
      }
      if (options.niceness && child.pid !== undefined) lowerPriority(child.pid, options.niceness);

      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrTail = '';
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let abortReason: 'aborted' | 'timeout' | 'output' | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve({ stdout: Buffer.concat(stdoutChunks), stderrTail });
      };
      const kill = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* tiến trình đã thoát */
        }
      };
      // Giết trước, báo lỗi khi tiến trình đã đóng để không để lại tiến trình mồ côi.
      const onAbort = () => {
        abortReason = 'aborted';
        kill();
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          abortReason = 'timeout';
          kill();
        }, options.timeoutMs);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        // ffmpeg không có đầu ra chuẩn đáng giữ (maxStdoutBytes = 0): bỏ qua.
        if (options.maxStdoutBytes === 0) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > options.maxStdoutBytes) {
          abortReason = 'output';
          kill();
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
      });
      child.once('error', (error) => {
        finish(new VideoTranscodeFailedError(`Không chạy được ${command}: ${describe(error)}`));
      });
      child.once('close', (code, exitSignal) => {
        if (abortReason === 'aborted') return finish(new VideoTranscodeAbortedError());
        if (abortReason === 'timeout') return finish(new VideoTranscodeTimeoutError());
        if (abortReason === 'output') {
          return finish(new VideoTranscodeFailedError(`${command} in ra quá nhiều dữ liệu.`));
        }
        if (code !== 0) {
          const detail = stderrTail.trim() || (exitSignal ? `tín hiệu ${exitSignal}` : 'không có thông báo');
          return finish(new VideoTranscodeFailedError(`${command} thoát với mã ${String(code)}: ${detail}`, code ?? undefined));
        }
        finish();
      });
    });
  }
}

/** Đặt `-threads N` ngay trước tham số đầu ra (phần tử cuối), trừ khi kế hoạch đã có. */
function withThreads(args: string[], threads: number): string[] {
  if (args.includes('-threads') || args.length === 0) return args;
  return [...args.slice(0, -1), '-threads', String(threads), args[args.length - 1]];
}

function lowerPriority(pid: number, niceness: number): void {
  try {
    os.setPriority(pid, niceness);
  } catch {
    /* hệ điều hành không cho đổi (ví dụ container hạn chế): chạy ở mức mặc định */
  }
}

async function requireNonEmptyFile(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isFile() && info.size > 0) return;
  } catch {
    /* rơi xuống lỗi bên dưới */
  }
  throw new VideoTranscodeFailedError(`ffmpeg không tạo ra tệp ${label} hợp lệ.`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
