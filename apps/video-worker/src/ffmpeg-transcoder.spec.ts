import { spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  planTranscode,
  VideoTranscodeAbortedError,
  VideoTranscodeFailedError,
  VideoTranscodeTimeoutError,
  type TranscodePlan,
} from '@enterprise-platform/module-social';
import { FfmpegTranscoder } from './ffmpeg-transcoder.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = undefined;
  killed = false;
  kill(): boolean {
    this.killed = true;
    // ffmpeg bị SIGKILL: tiến trình đóng với mã null.
    queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  }
  exit(code: number): void {
    queueMicrotask(() => this.emit('close', code, null));
  }
}

function fakeSpawn(child: FakeChild) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const spawn = (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const files = { inputPath: 'in.mov', outputPath: 'out.mp4', posterPath: 'poster.jpg' };

function plan(overrides: Partial<TranscodePlan> = {}): TranscodePlan {
  return {
    outputWidth: 2,
    outputHeight: 2,
    timeoutMs: 60_000,
    videoArgs: (f) => ['-y', '-i', f.inputPath, '-c:v', 'libx264', f.outputPath],
    posterArgs: (f) => ['-y', '-i', f.inputPath, f.posterPath],
    ...overrides,
  };
}

describe('FfmpegTranscoder (child_process giả)', () => {
  it('chèn -threads ngay trước tham số đầu ra và không dùng shell', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const transcoder = new FfmpegTranscoder({ spawn, threads: 3, niceness: 0 });
    const run = transcoder.transcode(plan(), files).catch((error: unknown) => error);
    child.stderr.write('x');
    child.exit(1);
    await run;
    expect(calls[0].command).toBe('ffmpeg');
    expect(calls[0].args).toEqual(['-y', '-i', 'in.mov', '-c:v', 'libx264', '-threads', '3', 'out.mp4']);
  });

  it('giữ nguyên -threads nếu kế hoạch đã có', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const transcoder = new FfmpegTranscoder({ spawn, threads: 3, niceness: 0 });
    const run = transcoder
      .transcode(plan({ videoArgs: (f) => ['-threads', '1', '-i', f.inputPath, f.outputPath] }), files)
      .catch((error: unknown) => error);
    child.exit(1);
    await run;
    expect(calls[0].args).toEqual(['-threads', '1', '-i', 'in.mov', 'out.mp4']);
  });

  it('thoát khác 0: VideoTranscodeFailedError kèm exitCode và đuôi stderr', async () => {
    const child = new FakeChild();
    const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
    const run = transcoder.transcode(plan(), files);
    child.stderr.write('Invalid data found when processing input');
    child.exit(69);
    await expect(run).rejects.toMatchObject({
      name: 'VideoTranscodeFailedError',
      exitCode: 69,
      message: expect.stringContaining('Invalid data found'),
    });
    await expect(run).rejects.toBeInstanceOf(VideoTranscodeFailedError);
  });

  it('giữ stderr tối đa vài KB', async () => {
    const child = new FakeChild();
    const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
    const run = transcoder.transcode(plan(), files);
    child.stderr.write('a'.repeat(50_000));
    child.exit(1);
    const error = (await run.catch((e: unknown) => e)) as Error;
    expect(error.message.length).toBeLessThan(6_000);
  });

  it('quá timeoutMs: giết tiến trình và ném VideoTranscodeTimeoutError', async () => {
    jest.useFakeTimers();
    try {
      const child = new FakeChild();
      const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
      const run = transcoder.transcode(plan({ timeoutMs: 1_000 }), files);
      const settled = run.catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(child.killed).toBe(true);
      expect(await settled).toBeInstanceOf(VideoTranscodeTimeoutError);
    } finally {
      jest.useRealTimers();
    }
  });

  it('signal bị huỷ: giết tiến trình và ném VideoTranscodeAbortedError', async () => {
    const child = new FakeChild();
    const controller = new AbortController();
    const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
    const run = transcoder.transcode(plan(), files, controller.signal);
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(VideoTranscodeAbortedError);
    expect(child.killed).toBe(true);
  });

  it('signal đã huỷ từ trước: không spawn', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const controller = new AbortController();
    controller.abort();
    const transcoder = new FfmpegTranscoder({ spawn, niceness: 0 });
    await expect(transcoder.transcode(plan(), files, controller.signal)).rejects.toBeInstanceOf(
      VideoTranscodeAbortedError,
    );
    expect(calls).toHaveLength(0);
  });

  it('không chạy được chương trình (lỗi spawn): VideoTranscodeFailedError', async () => {
    const child = new FakeChild();
    const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
    const run = transcoder.probe('in.mov');
    child.emit('error', new Error('spawn ffprobe ENOENT'));
    await expect(run).rejects.toBeInstanceOf(VideoTranscodeFailedError);
  });

  it('probe: đầu ra quá lớn bị cắt và coi là lỗi', async () => {
    const child = new FakeChild();
    const transcoder = new FfmpegTranscoder({ spawn: fakeSpawn(child).spawn, niceness: 0 });
    const run = transcoder.probe('in.mov');
    child.stdout.write(Buffer.alloc(5 * 1024 * 1024));
    await expect(run).rejects.toBeInstanceOf(VideoTranscodeFailedError);
    expect(child.killed).toBe(true);
  });

  it('chạy lệnh poster sau lệnh chuyển mã và báo lỗi nếu tệp ra không tồn tại', async () => {
    const child = new FakeChild();
    const calls: (readonly string[])[] = [];
    const spawn = (_command: string, args: readonly string[]) => {
      calls.push(args);
      queueMicrotask(() => child.emit('close', 0, null));
      return child as unknown as ChildProcess;
    };
    const transcoder = new FfmpegTranscoder({ spawn, niceness: 0 });
    await expect(transcoder.transcode(plan(), files)).rejects.toBeInstanceOf(VideoTranscodeFailedError);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['-y', '-i', 'in.mov', 'poster.jpg']);
  });
});

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { windowsHide: true }).status === 0;

(hasFfmpeg ? describe : describe.skip)('FfmpegTranscoder (ffmpeg thật)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'video-worker-spec-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function ffmpeg(args: string[]) {
    const result = spawnSync('ffmpeg', args, { windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr.toString('utf8'));
  }

  it('probe rồi transcode một video 2 giây sinh bằng lavfi', async () => {
    const input = path.join(dir, 'in.mp4');
    ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-pix_fmt', 'yuv420p', input]);
    const transcoder = new FfmpegTranscoder({ threads: 1 });

    const probe = await transcoder.probe(input);
    expect(probe.hasVideoStream).toBe(true);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.durationMs).toBeGreaterThan(1_500);

    const output = path.join(dir, 'out.mp4');
    const poster = path.join(dir, 'poster.jpg');
    await transcoder.transcode(
      plan({
        videoArgs: (f) => ['-y', '-nostdin', '-i', f.inputPath, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', f.outputPath],
        posterArgs: (f) => ['-y', '-nostdin', '-i', f.inputPath, '-frames:v', '1', f.posterPath],
      }),
      { inputPath: input, outputPath: output, posterPath: poster },
    );
    expect((await stat(output)).size).toBeGreaterThan(0);
    expect((await stat(poster)).size).toBeGreaterThan(0);
  }, 60_000);

  it('planTranscode thật: video 1280x720 có tiếng thu về tối đa 720p cho bình luận, ra H.264+AAC và poster', async () => {
    const input = path.join(dir, 'plan-in.mp4');
    ffmpeg([
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-shortest', input,
    ]);
    const transcoder = new FfmpegTranscoder({ threads: 1 });
    const probe = await transcoder.probe(input);
    const planned = planTranscode(probe, 'comment');
    if (!planned.ok) throw new Error(planned.message);
    const output = path.join(dir, 'plan-out.mp4');
    const poster = path.join(dir, 'plan-poster.jpg');
    await transcoder.transcode(planned.plan, { inputPath: input, outputPath: output, posterPath: poster });
    const result = await transcoder.probe(output);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
    expect(result.height).toBe(planned.plan.outputHeight);
    expect(result.height).toBeLessThanOrEqual(720);
    expect((await stat(poster)).size).toBeGreaterThan(0);
  }, 60_000);

  it('tệp hỏng: probe hoặc transcode ném VideoTranscodeFailedError', async () => {
    const bad = path.join(dir, 'bad.mp4');
    await writeFile(bad, Buffer.from('không phải video'));
    const transcoder = new FfmpegTranscoder({ threads: 1 });
    await expect(transcoder.probe(bad)).rejects.toBeInstanceOf(VideoTranscodeFailedError);
    await expect(
      transcoder.transcode(plan(), { inputPath: bad, outputPath: path.join(dir, 'bad-out.mp4'), posterPath: path.join(dir, 'bad.jpg') }),
    ).rejects.toBeInstanceOf(VideoTranscodeFailedError);
  }, 60_000);

  it('signal huỷ giữa chừng giết ffmpeg đang chạy', async () => {
    const input = path.join(dir, 'long.mp4');
    ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=30:size=1280x720:rate=30', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', input]);
    const controller = new AbortController();
    const transcoder = new FfmpegTranscoder({ threads: 1 });
    const run = transcoder.transcode(
      plan({
        videoArgs: (f) => ['-y', '-nostdin', '-i', f.inputPath, '-c:v', 'libx264', '-preset', 'veryslow', f.outputPath],
      }),
      { inputPath: input, outputPath: path.join(dir, 'long-out.mp4'), posterPath: path.join(dir, 'long.jpg') },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 500);
    await expect(run).rejects.toBeInstanceOf(VideoTranscodeAbortedError);
  }, 60_000);
});
