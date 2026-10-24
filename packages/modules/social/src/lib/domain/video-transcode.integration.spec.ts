import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOCIAL_VIDEO_LIMITS } from '@enterprise-platform/contracts-social';
import { parseFfprobeOutput } from './video-probe.js';
import { planTranscode } from './video-transcode-plan.js';

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const describeIfFfmpeg = hasFfmpeg ? describe : describe.skip;

function run(cmd: string, args: readonly string[]) {
  const r = spawnSync(cmd, [...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} lỗi: ${r.stderr}`);
  return r.stdout;
}
function ffprobe(path: string): unknown {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]));
}

/** `moov` phải đứng trước `mdat` (faststart). */
function isFaststart(path: string): boolean {
  const buf = readFileSync(path);
  const moov = buf.indexOf('moov');
  const mdat = buf.indexOf('mdat');
  return moov > 0 && mdat > 0 && moov < mdat;
}

describeIfFfmpeg('chuyển mã video bằng ffmpeg thật', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'social-video-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const lavfi = (w: number, h: number, extra: string[] = []) => [
    '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=30:duration=2`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', ...extra,
  ];

  function transcode(name: string, purpose: 'comment' | 'post') {
    const input = join(dir, name);
    const probe = parseFfprobeOutput(ffprobe(input));
    const result = planTranscode(probe, purpose);
    if (!result.ok) throw new Error(`bị từ chối: ${result.message}`);
    const outputPath = join(dir, `${name}.out.mp4`);
    const posterPath = join(dir, `${name}.poster.jpg`);
    run('ffmpeg', result.plan.videoArgs({ inputPath: input, outputPath }));
    run('ffmpeg', result.plan.posterArgs({ inputPath: input, posterPath }));
    return { plan: result.plan, outputPath, posterPath, out: parseFfprobeOutput(ffprobe(outputPath)) };
  }

  it('ngang 1920x1080 -> 1280x720 h264/aac, faststart, poster JPEG', () => {
    run('ffmpeg', ['-y', '-loglevel', 'error', ...lavfi(1920, 1080), join(dir, 'wide.mp4')]);
    const { plan, out, outputPath, posterPath } = transcode('wide.mp4', 'comment');
    expect([out.width, out.height]).toEqual([plan.outputWidth, plan.outputHeight]);
    expect([out.width, out.height]).toEqual([1280, 720]);
    expect(out.videoCodec).toBe('h264');
    expect(out.audioCodec).toBe('aac');
    expect(out.height).toBeLessThanOrEqual(SOCIAL_VIDEO_LIMITS.comment.maxHeight);
    expect(isFaststart(outputPath)).toBe(true);
    const poster = readFileSync(posterPath);
    expect(poster.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(parseFfprobeOutput(ffprobe(posterPath)).width).toBe(1280);
  });

  it('video dọc có metadata xoay ra đúng chiều (720x1280)', () => {
    // 1920x1080 lưu ngang nhưng gắn displaymatrix xoay 90 độ -> hiển thị 1080x1920.
    run('ffmpeg', ['-y', '-loglevel', 'error', ...lavfi(1920, 1080), join(dir, 'norot.mp4')]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-display_rotation:v:0', '90', '-i', join(dir, 'norot.mp4'), '-c', 'copy', join(dir, 'rot.mp4')]);
    const { out, plan } = transcode('rot.mp4', 'comment');
    expect([plan.outputWidth, plan.outputHeight]).toEqual([720, 1280]);
    expect([out.width, out.height]).toEqual([720, 1280]);
  });

  it('nguồn có kích thước lẻ, không phóng to, không âm thanh', () => {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=426x240:rate=60:duration=2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', join(dir, 'small.mp4')]);
    const { out } = transcode('small.mp4', 'post');
    expect([out.width, out.height]).toEqual([426, 240]);
    expect(out.hasAudioStream).toBe(false);
    expect(out.frameRate).toBeLessThanOrEqual(30.1);
  });

  it('tệp chỉ có tiếng bị từ chối no_video_stream', () => {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', join(dir, 'audio.m4a')]);
    const result = planTranscode(parseFfprobeOutput(ffprobe(join(dir, 'audio.m4a'))), 'comment');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_video_stream');
  });
});
