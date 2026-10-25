#!/usr/bin/env node
// Sinh bộ tệp video thử bằng ffmpeg (lavfi) và manifest.json mô tả kết quả mong đợi.
// Dùng: node tools/load-test/fixtures/generate.mjs --out <thư mục> [--big] [--only <chuỗi lọc tên>]
import { spawnSync } from 'node:child_process';
import { closeSync, createWriteStream, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { parseArgs } from '../lib/args.mjs';

const args = parseArgs(process.argv.slice(2), ['big']);
if (!args.out || args.out === true) {
  console.error('Thiếu --out <thư mục>. Nên đặt ngoài repo hoặc tools/load-test/.fixtures (đã .gitignore).');
  process.exit(2);
}
const out = path.resolve(args.out);
mkdirSync(out, { recursive: true });
const only = typeof args.only === 'string' ? args.only : '';

const LIMITS = {
  comment: { maxBytes: 300 * 1024 * 1024, maxSeconds: 180, maxHeight: 720 },
  post: { maxBytes: 1024 * 1024 * 1024, maxSeconds: 600, maxHeight: 1080 },
};
const MAX_INPUT_EDGE = 4096;

function ff(argv, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg lỗi (${label}): ${r.stderr || r.error}`);
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// Chiều cao đầu ra mong đợi: không phóng to, thu theo cạnh NGẮN về trần của ngữ cảnh (quy ước bậc 720p/1080p).
const outShort = (shortSide, ctx) => Math.min(shortSide, LIMITS[ctx].maxHeight);

const items = [];
const add = (name, build, expect) => items.push({ name, build, expect });

const AUDIO = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100'];
const x264 = (crf = 32) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
const aac = ['-c:a', 'aac', '-b:a', '48k'];
const FS = ['-movflags', '+faststart'];
const src = (w, h, fps, secs) => ['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}:duration=${secs}`];
const lowBitrate = ['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20k', '-g', '250', '-pix_fmt', 'yuv420p'];

const ok = (w, h, extra = {}) => ({
  accepted: true,
  displayWidth: w,
  displayHeight: h,
  comment: { accepted: true, outputShortSide: outShort(Math.min(w, h), 'comment') },
  post: { accepted: true, outputShortSide: outShort(Math.min(w, h), 'post') },
  ...extra,
});
const reject = (reason, extra = {}) => ({
  accepted: false,
  reason,
  comment: { accepted: false, reason },
  post: { accepted: false, reason },
  ...extra,
});

add(
  'good-720p-10s.mp4',
  (f) => ff([...src(1280, 720, 25, 10), ...AUDIO, '-t', '10', ...x264(30), ...aac, ...FS, f], 'good-720p'),
  ok(1280, 720, { note: 'Giữ nguyên 720p cho cả hai ngữ cảnh.' }),
);
add(
  'good-1080p-30s.mp4',
  (f) => ff([...src(1920, 1080, 25, 30), ...AUDIO, '-t', '30', ...x264(32), ...aac, ...FS, f], 'good-1080p'),
  ok(1920, 1080, { note: 'Bình luận hạ xuống 720p, bài đăng giữ 1080p.' }),
);
add(
  'good-4k-5s.mp4',
  (f) => ff([...src(3840, 2160, 25, 5), ...AUDIO, '-t', '5', ...x264(34), ...aac, ...FS, f], 'good-4k'),
  ok(3840, 2160, { note: '4K: bài đăng hạ xuống 1080p, bình luận hạ xuống 720p.' }),
);
add(
  'small-360p-5s.mp4',
  (f) => ff([...src(640, 360, 25, 5), ...AUDIO, '-t', '5', ...x264(30), ...aac, ...FS, f], 'small-360p'),
  ok(640, 360, { note: 'Không phóng to: đầu ra vẫn 360p.' }),
);
add(
  'portrait-1080x1920-rotated.mp4',
  (f) => {
    const tmp = f + '.tmp.mp4';
    ff([...src(1920, 1080, 25, 5), ...AUDIO, '-t', '5', ...x264(32), ...aac, tmp], 'rotated-base');
    ff(['-display_rotation:v:0', '90', '-i', tmp, '-c', 'copy', ...FS, f], 'rotated-meta');
    rmSync(tmp, { force: true });
  },
  ok(1080, 1920, {
    note: 'Khung lưu 1920x1080 kèm metadata xoay 90 độ, hiển thị dọc 1080x1920. Cạnh ngắn 1080: bài đăng giữ, bình luận 720x1280. Bộ lập kế hoạch phải áp dụng xoay trước khi tính kích thước.',
  }),
);
add(
  'odd-853x479.mp4',
  (f) =>
    ff(
      [
        ...src(854, 480, 25, 5),
        ...AUDIO,
        '-t',
        '5',
        '-vf', 'format=yuv444p,crop=853:479:0:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv444p',
        ...aac,
        ...FS,
        f,
      ],
      'odd',
    ),
  ok(853, 479, {
    note: 'Kích thước lẻ 853x479 (H.264 4:4:4 vì 4:2:0 không cho cạnh lẻ): đầu ra yuv420p phải có cạnh chẵn, vd 852x478; không phóng to.',
  }),
);
add(
  'vfr-60fps.mp4',
  (f) =>
    ff(
      [
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=8',
        ...AUDIO,
        '-t', '8',
        '-vf', 'select=if(lt(mod(n\\,60)\\,30)\\,1\\,not(mod(n\\,2))),setpts=N/FRAME_RATE/TB',
        '-fps_mode', 'vfr',
        ...x264(32), ...aac, ...FS, f,
      ],
      'vfr',
    ),
  ok(1280, 720, { note: 'Tốc độ khung không cố định (60 fps xen kẽ 30 fps). Phải chuyển mã không lệch tiếng/hình.' }),
);
add(
  'no-audio.mp4',
  (f) => ff([...src(1280, 720, 25, 6), '-t', '6', ...x264(30), '-an', ...FS, f], 'no-audio'),
  ok(1280, 720, { note: 'Không có luồng tiếng; đầu ra không được lỗi vì thiếu audio.' }),
);
add(
  'hevc-iphone-like.mov',
  (f) =>
    ff(
      [
        ...src(1920, 1080, 30, 5), ...AUDIO, '-t', '5',
        '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
        '-x265-params', 'log-level=error',
        ...aac, '-f', 'mov', f,
      ],
      'hevc',
    ),
  ok(1920, 1080, { note: 'HEVC .mov như iPhone: giải mã HEVC, đầu ra H.264. Bình luận 720p, bài đăng 1080p.' }),
);
add(
  'webm-vp9.webm',
  (f) =>
    ff(
      [
        ...src(1280, 720, 25, 5), ...AUDIO, '-t', '5',
        '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p',
        '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', f,
      ],
      'webm',
    ),
  ok(1280, 720, { note: 'WebM VP9 + Opus; đầu ra mp4 H.264 + AAC.' }),
);
add(
  'hdr-10bit.mp4',
  (f) =>
    ff(
      [
        ...src(1920, 1080, 25, 5), ...AUDIO, '-t', '5',
        '-vf', 'format=yuv420p10le',
        '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
        '-x265-params', 'log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=limited',
        ...aac, ...FS, f,
      ],
      'hdr',
    ),
  ok(1920, 1080, {
    note: '10-bit HEVC bt2020/PQ. Đầu ra yuv420p 8-bit; nên tone-map để màu không bạc (không bắt buộc ở bản đầu).',
  }),
);
add(
  'audio-only.mp4',
  (f) => ff([...AUDIO, '-t', '5', ...aac, ...FS, f], 'audio-only'),
  reject('no-video-stream', { note: 'Đuôi .mp4 nhưng không có luồng hình.' }),
);
add('zero-byte.mp4', (f) => writeFileSync(f, Buffer.alloc(0)), reject('empty-file', { note: 'Tệp rỗng; có thể bị chặn từ bước xin URL tải lên.' }));
add(
  'truncated.mp4',
  (f) => {
    // Bản không faststart (moov ở cuối) rồi cắt đôi: mất moov, không đọc được siêu dữ liệu.
    const full = path.join(out, '.truncated-base.mp4');
    ff([...src(1280, 720, 25, 10), ...AUDIO, '-t', '10', ...x264(30), ...aac, full], 'truncated-base');
    const keep = Math.floor(statSync(full).size / 2);
    const fd = openSync(full, 'r');
    const buf = Buffer.alloc(keep);
    readSync(fd, buf, 0, keep, 0);
    closeSync(fd);
    writeFileSync(f, buf);
    rmSync(full, { force: true });
  },
  reject('corrupt-or-truncated', { note: 'mp4 bị cắt đôi, mất moov ở cuối.' }),
);
add(
  'zip-renamed.mp4',
  (f) => {
    // Zip tối thiểu có một tệp rỗng "a.txt", đổi đuôi .mp4: chữ ký PK, không phải ftyp.
    const name = Buffer.from('a.txt');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(name.length, 28);
    name.copy(cd, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    writeFileSync(f, Buffer.concat([local, cd, eocd]));
  },
  reject('invalid-signature', {
    note: 'Không phải mp4/webm/mov: chữ ký sai, phải bị từ chối dù Content-Type khai là video/mp4.',
  }),
);
add(
  '8k-1s.mp4',
  (f) =>
    ff([...src(7680, 4320, 25, 1), '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p', ...FS, f], '8k'),
  reject('input-resolution-too-high', { note: `Cạnh dài 7680 > ${MAX_INPUT_EDGE}.` }),
);
add(
  'too-long-comment-200s.mp4',
  (f) => ff([...src(320, 180, 5, 200), '-t', '200', ...lowBitrate, ...FS, f], 'long-comment'),
  {
    accepted: 'depends',
    displayWidth: 320,
    displayHeight: 180,
    comment: { accepted: false, reason: 'duration-exceeds-limit' },
    post: { accepted: true, outputShortSide: 180 },
    note: '200 giây > 180 giây của bình luận, nhưng hợp lệ cho bài đăng.',
  },
);
add(
  'too-long-post-650s.mp4',
  (f) => ff([...src(320, 180, 5, 650), '-t', '650', ...lowBitrate, ...FS, f], 'long-post'),
  reject('duration-exceeds-limit', { note: '650 giây > 600 giây của bài đăng (và > 180 giây của bình luận).' }),
);
add(
  'exactly-at-limit-comment-180s.mp4',
  (f) => ff([...src(320, 180, 25, 180), '-frames:v', '4500', ...lowBitrate, '-an', ...FS, f], 'limit-180'),
  ok(320, 180, { note: 'Đúng 180,000 giây (không tiếng, 4500 khung ở 25 fps): bình luận phải chấp nhận (<= trần).' }),
);
add(
  'exactly-at-limit-post-600s.mp4',
  (f) => ff([...src(320, 180, 5, 600), '-frames:v', '3000', ...lowBitrate, '-an', ...FS, f], 'limit-600'),
  {
    accepted: 'depends',
    displayWidth: 320,
    displayHeight: 180,
    comment: { accepted: false, reason: 'duration-exceeds-limit' },
    post: { accepted: true, outputShortSide: 180 },
    note: 'Đúng 600,000 giây (3000 khung ở 5 fps): bài đăng chấp nhận, bình luận từ chối.',
  },
);

if (args.big) {
  // mp4 hợp lệ (moov ở đầu) + một hộp "free" toàn số 0 ở cuối để đạt dung lượng; ffprobe vẫn đọc bình thường.
  const bigBuild = (bytes) => async (f) => {
    const base = path.join(out, '.big-base.mp4');
    ff([...src(1280, 720, 25, 10), ...AUDIO, '-t', '10', ...x264(30), ...aac, ...FS, base], 'big-base');
    const baseBuf = readFileSync(base);
    const padLen = bytes - baseBuf.length;
    if (padLen >= 2 ** 32) throw new Error('Phần đệm vượt 4 GiB, cần hộp free 64-bit');
    const header = Buffer.alloc(8);
    header.writeUInt32BE(padLen, 0);
    header.write('free', 4, 'ascii');
    const ws = createWriteStream(f);
    ws.write(baseBuf);
    ws.write(header);
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let left = padLen - 8;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      if (!ws.write(n === chunk.length ? chunk : chunk.subarray(0, n))) await once(ws, 'drain');
      left -= n;
    }
    ws.end();
    await once(ws, 'finish');
    rmSync(base, { force: true });
  };
  add('big-320mb.mp4', bigBuild(320 * 1024 * 1024), {
    accepted: 'depends',
    displayWidth: 1280,
    displayHeight: 720,
    comment: { accepted: false, reason: 'file-too-large' },
    post: { accepted: true, outputShortSide: 720 },
    note: '320 MiB > trần bình luận 300 MiB nhưng dưới trần bài đăng 1 GiB. Phần đệm là hộp free toàn số 0.',
  });
  add('big-1100mb.mp4', bigBuild(1100 * 1024 * 1024), reject('file-too-large', { note: '1100 MiB > trần 1 GiB của bài đăng. mp4 hợp lệ + hộp free đệm.' }));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  limits: { ...LIMITS, maxInputLongEdge: MAX_INPUT_EDGE },
  files: {},
};
try {
  // Chạy lại một phần (--only/--big) thì giữ các mục đã có.
  Object.assign(manifest.files, JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8')).files);
} catch {
  /* chưa có manifest */
}
const t0 = Date.now();
for (const it of items) {
  if (only && !it.name.includes(only)) continue;
  const file = path.join(out, it.name);
  const s = Date.now();
  try {
    await it.build(file);
  } catch (e) {
    console.error(`LỖI ${it.name}: ${e.message}`);
    manifest.files[it.name] = { ...it.expect, generationError: String(e.message).slice(0, 300) };
    continue;
  }
  const info = probe(file);
  const v = info?.streams?.find((x) => x.codec_type === 'video');
  manifest.files[it.name] = {
    bytes: statSync(file).size,
    probed: info
      ? {
          durationSeconds: info.format?.duration ? Number(info.format.duration) : null,
          videoCodec: v?.codec_name ?? null,
          width: v?.width ?? null,
          height: v?.height ?? null,
          pixFmt: v?.pix_fmt ?? null,
          hasAudio: info.streams.some((x) => x.codec_type === 'audio'),
          rotation: v?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? null,
          colorTransfer: v?.color_transfer ?? null,
        }
      : null,
    ...it.expect,
  };
  console.log(
    `${it.name.padEnd(38)} ${(manifest.files[it.name].bytes / 1048576).toFixed(2).padStart(9)} MiB  ${((Date.now() - s) / 1000).toFixed(1)}s`,
  );
}
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Xong ${Object.keys(manifest.files).length} tệp trong ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
