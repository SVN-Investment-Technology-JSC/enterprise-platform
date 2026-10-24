import { SOCIAL_VIDEO_LIMITS, SOCIAL_VIDEO_MAX_PROCESSING_SECONDS } from '@enterprise-platform/contracts-social';
import { planTranscode } from './video-transcode-plan.js';
import type { TranscodePlan, VideoProbe } from './video-transcode.types.js';

const baseProbe: VideoProbe = {
  formatNames: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
  durationMs: 10_000,
  hasVideoStream: true,
  hasAudioStream: true,
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1920,
  height: 1080,
  frameRate: 30,
};
const probe = (extra: Partial<VideoProbe> = {}): VideoProbe => ({ ...baseProbe, ...extra });

function planOf(p: VideoProbe, purpose: 'comment' | 'post' = 'comment'): TranscodePlan {
  const result = planTranscode(p, purpose);
  if (!result.ok) throw new Error(`bị từ chối: ${result.reason}`);
  return result.plan;
}
const files = { inputPath: '/tmp/in.mov', outputPath: '/tmp/out.mp4', posterPath: '/tmp/poster.jpg' };
const size = (p: TranscodePlan) => [p.outputWidth, p.outputHeight];
function arg(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}

describe('planTranscode - từ chối', () => {
  const rejected = (p: VideoProbe, purpose: 'comment' | 'post' = 'comment') => {
    const r = planTranscode(p, purpose);
    if (r.ok) throw new Error('lẽ ra phải bị từ chối');
    expect(r.message).toMatch(/\S/);
    return r.reason;
  };

  it('không đọc được', () => {
    expect(rejected(probe({ formatNames: [], hasVideoStream: false, width: 0, height: 0, durationMs: 0 }))).toBe('unreadable');
  });
  it('định dạng không cho phép', () => {
    expect(rejected(probe({ formatNames: ['avi'] }))).toBe('unsupported_format');
    expect(rejected(probe({ formatNames: ['gif'] }))).toBe('unsupported_format');
  });
  it('nhận matroska, webm, mov', () => {
    for (const name of ['matroska', 'webm', 'mov', 'mp4', '3gp', 'm4a']) {
      expect(planTranscode(probe({ formatNames: [name] }), 'comment').ok).toBe(true);
    }
  });
  it('không có luồng hình (chỉ có tiếng)', () => {
    expect(rejected(probe({ hasVideoStream: false, width: 0, height: 0 }))).toBe('no_video_stream');
  });
  it('thời lượng 0', () => {
    expect(rejected(probe({ durationMs: 0 }))).toBe('zero_duration');
    expect(rejected(probe({ durationMs: Number.NaN }))).toBe('zero_duration');
  });
  it('ranh giới thời lượng: đúng trần, +1 s được, +2 s bị từ chối', () => {
    const max = SOCIAL_VIDEO_LIMITS.comment.maxSeconds * 1000;
    expect(planTranscode(probe({ durationMs: max }), 'comment').ok).toBe(true);
    expect(planTranscode(probe({ durationMs: max + 1000 }), 'comment').ok).toBe(true);
    expect(rejected(probe({ durationMs: max + 1001 }))).toBe('too_long');
    expect(rejected(probe({ durationMs: max + 2000 }))).toBe('too_long');
  });
  it('trần thời lượng theo mục đích: 200 s qua bài nhưng không qua bình luận', () => {
    expect(planTranscode(probe({ durationMs: 200_000 }), 'post').ok).toBe(true);
    expect(rejected(probe({ durationMs: 200_000 }), 'comment')).toBe('too_long');
    expect(rejected(probe({ durationMs: 602_000 }), 'post')).toBe('too_long');
  });
  it('kích thước quá lớn (8K) hoặc không hợp lệ', () => {
    expect(rejected(probe({ width: 7680, height: 4320 }))).toBe('too_large_dimensions');
    expect(rejected(probe({ width: 1080, height: 4097 }))).toBe('too_large_dimensions');
    expect(planTranscode(probe({ width: 4096, height: 2160 }), 'post').ok).toBe(true);
    expect(rejected(probe({ width: 0, height: 0 }))).toBe('too_large_dimensions');
    expect(rejected(probe({ width: Number.NaN, height: 100 }))).toBe('too_large_dimensions');
  });
  it('kích thước nhỏ hơn 16 px', () => {
    expect(rejected(probe({ width: 15, height: 200 }))).toBe('too_large_dimensions');
    expect(planTranscode(probe({ width: 16, height: 16 }), 'comment').ok).toBe(true);
  });
});

describe('planTranscode - độ phân giải đầu ra', () => {
  it('1080p -> 720p cho bình luận, giữ 1080p cho bài', () => {
    expect(size(planOf(probe(), 'comment'))).toEqual([1280, 720]);
    expect(size(planOf(probe(), 'post'))).toEqual([1920, 1080]);
  });
  it('4K -> 1080p (bài) và 720p (bình luận)', () => {
    const p = probe({ width: 3840, height: 2160 });
    expect(size(planOf(p, 'post'))).toEqual([1920, 1080]);
    expect(size(planOf(p, 'comment'))).toEqual([1280, 720]);
  });
  it('không phóng to: 480p và 360x640 dọc giữ nguyên', () => {
    expect(size(planOf(probe({ width: 854, height: 480 })))).toEqual([854, 480]);
    expect(size(planOf(probe({ width: 360, height: 640 })))).toEqual([360, 640]);
    expect(size(planOf(probe({ width: 640, height: 360 }), 'post'))).toEqual([640, 360]);
  });
  it('kích thước lẻ làm tròn xuống số chẵn', () => {
    expect(size(planOf(probe({ width: 853, height: 479 })))).toEqual([852, 478]);
    expect(size(planOf(probe({ width: 1281, height: 721 })))).toEqual([1278, 720]);
  });
  it('video dọc (đã xoay trong probe) tính theo cạnh ngắn, cùng số điểm ảnh với video ngang', () => {
    expect(size(planOf(probe({ width: 1080, height: 1920 }), 'comment'))).toEqual([720, 1280]);
    expect(size(planOf(probe({ width: 1080, height: 1920 }), 'post'))).toEqual([1080, 1920]);
    expect(size(planOf(probe({ width: 2160, height: 3840 }), 'post'))).toEqual([1080, 1920]);
  });
  it('mọi chiều là số chẵn và >= 16, kể cả tỉ lệ cực đoan', () => {
    const p = planOf(probe({ width: 4096, height: 16 }), 'comment');
    expect(p.outputWidth % 2).toBe(0);
    expect(p.outputHeight % 2).toBe(0);
    expect(p.outputHeight).toBeGreaterThanOrEqual(16);
    const q = planOf(probe({ width: 16, height: 4096 }), 'comment');
    expect(q.outputWidth).toBe(16);
    expect(q.outputHeight).toBe(4096);
  });
});

describe('planTranscode - tham số ffmpeg', () => {
  it('videoArgs: giới hạn giao thức trước -i, một luồng hình + một luồng tiếng, không chứa -threads', () => {
    const args = planOf(probe()).videoArgs(files);
    expect(args.slice(0, 4)).toEqual(['-y', '-hide_banner', '-nostdin', '-loglevel']);
    expect(args.indexOf('-protocol_whitelist')).toBeLessThan(args.indexOf('-i'));
    expect(arg(args, '-protocol_whitelist')).toBe('file');
    expect(arg(args, '-i')).toBe(files.inputPath);
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0?');
    expect(args).toEqual(expect.arrayContaining(['-sn', '-dn']));
    expect(arg(args, '-c:v')).toBe('libx264');
    expect(arg(args, '-pix_fmt')).toBe('yuv420p');
    expect(arg(args, '-maxrate')).toBe('2500k');
    expect(arg(args, '-bufsize')).toBe('5000k');
    expect(arg(args, '-movflags')).toBe('+faststart');
    expect(arg(args, '-f')).toBe('mp4');
    expect(args[args.length - 1]).toBe(files.outputPath);
    expect(args).not.toContain('-threads');
    expect(arg(planOf(probe(), 'post').videoArgs(files), '-maxrate')).toBe('4000k');
  });
  it('bộ lọc scale đúng kích thước; không có fps khi nguồn <= 30', () => {
    const args = planOf(probe({ frameRate: 29.97 })).videoArgs(files);
    expect(arg(args, '-vf')).toBe('scale=1280:720');
  });
  it('nguồn 60 fps thì thêm fps=30; thiếu frameRate thì không thêm', () => {
    expect(arg(planOf(probe({ frameRate: 60 })).videoArgs(files), '-vf')).toBe('fps=30,scale=1280:720');
    expect(arg(planOf(probe({ frameRate: undefined })).videoArgs(files), '-vf')).toBe('scale=1280:720');
  });
  it('có âm thanh: aac 128k stereo', () => {
    const args = planOf(probe()).videoArgs(files);
    expect(arg(args, '-c:a')).toBe('aac');
    expect(arg(args, '-b:a')).toBe('128k');
    expect(arg(args, '-ac')).toBe('2');
    expect(args).not.toContain('-an');
  });
  it('không có âm thanh: -an và không map tiếng', () => {
    const args = planOf(probe({ hasAudioStream: false, audioCodec: undefined })).videoArgs(files);
    expect(args).toContain('-an');
    expect(args).not.toContain('0:a:0?');
    expect(args).not.toContain('-c:a');
  });
  it('posterArgs: cắt ở 1 s, hoặc nửa thời lượng nếu video ngắn', () => {
    const long = planOf(probe({ durationMs: 10_000 })).posterArgs(files);
    expect(arg(long, '-ss')).toBe('1.000');
    expect(long.indexOf('-protocol_whitelist')).toBeLessThan(long.indexOf('-i'));
    expect(arg(long, '-frames:v')).toBe('1');
    expect(arg(long, '-q:v')).toBe('3');
    expect(long[long.length - 1]).toBe(files.posterPath);
    expect(arg(long, '-vf')).toContain('1280');
    const short = planOf(probe({ durationMs: 1200 })).posterArgs(files);
    expect(arg(short, '-ss')).toBe('0.600');
  });
});

describe('planTranscode - timeout', () => {
  it('tối thiểu 120 s, tăng theo thời lượng, trần theo cấu hình', () => {
    expect(planOf(probe({ durationMs: 1000 })).timeoutMs).toBe(123_000);
    expect(planOf(probe({ durationMs: 60_000 }), 'post').timeoutMs).toBe(300_000);
    expect(planOf(probe({ durationMs: 600_000 }), 'post').timeoutMs).toBe(SOCIAL_VIDEO_MAX_PROCESSING_SECONDS * 1000);
  });
});
