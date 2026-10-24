#!/usr/bin/env node
// Đo tốc độ chuyển mã libx264 mẫu. Chỉ cần ffmpeg, ffprobe và Node (chạy được trong container/VPS).
// Ví dụ:
//   node tools/load-test/benchmark-ffmpeg.mjs --input tools/load-test/.fixtures/good-1080p-30s.mp4 --height 720 --threads 2 --runs 2
// Hệ số thời gian thực = thời lượng video / thời gian chạy (2,0 nghĩa là chuyển mã nhanh gấp đôi thời lượng phát).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, num } from './lib/args.mjs';

const args = parseArgs();
if (!args.input || args.input === true) {
  console.error('Thiếu --input <video>.');
  process.exit(2);
}
const input = path.resolve(args.input);
const height = num(args.height, 720);
if (![720, 1080].includes(height)) {
  console.error('--height chỉ nhận 720 hoặc 1080.');
  process.exit(2);
}
const threads = num(args.threads, 2);
const runs = num(args.runs, 2);
const maxrate = height === 1080 ? '4000k' : '2500k';
const preset = typeof args.preset === 'string' ? args.preset : 'veryfast';

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { encoding: 'utf8' });
const duration = Number(probe.stdout?.trim());
if (!Number.isFinite(duration) || duration <= 0) {
  console.error('Không đọc được thời lượng video bằng ffprobe.');
  process.exit(2);
}

const isLinux = process.platform === 'linux';
function readHwmKb(pid) {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function runOnce(i) {
  const outFile = path.join(tmpdir(), `bench-ffmpeg-${process.pid}-${i}.mp4`);
  const argv = [
    '-hide_banner', '-loglevel', 'info', '-nostats', '-benchmark', '-y',
    '-i', input,
    '-vf', `scale=-2:min(ih\\,${height})`,
    '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-maxrate', maxrate, '-bufsize', `${parseInt(maxrate, 10) * 2}k`,
    '-pix_fmt', 'yuv420p', '-threads', String(threads),
    '-c:a', 'aac', '-movflags', '+faststart',
    outFile,
  ];
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const p = spawn('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    let peakKb = 0;
    const timer = isLinux ? setInterval(() => (peakKb = Math.max(peakKb, readHwmKb(p.pid))), 100) : null;
    p.on('error', reject);
    p.on('close', (code) => {
      if (timer) clearInterval(timer);
      const sec = (performance.now() - t0) / 1000;
      if (code !== 0) return reject(new Error(`ffmpeg thoát mã ${code}: ${stderr.slice(-400)}`));
      const bytes = statSync(outFile).size;
      rmSync(outFile, { force: true });
      // -benchmark in "bench: utime=..s stime=..s rtime=..s" (và dòng maxrss trên một số bản).
      const b = /utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(stderr);
      const cpu = b ? Number(b[1]) + Number(b[2]) : null;
      const rss = /maxrss=(\d+)KiB/.exec(stderr);
      resolve({ sec, bytes, cpuSeconds: cpu, peakKb: peakKb || (rss ? Number(rss[1]) : 0) });
    });
  });
}

console.log(`Đầu vào: ${path.basename(input)} (${duration.toFixed(1)}s) -> ${height}p, preset ${preset}, crf 23, maxrate ${maxrate}, threads ${threads}, ${runs} lần`);
const rows = [];
for (let i = 0; i < runs; i++) {
  const r = await runOnce(i);
  rows.push(r);
  const mbPerMin = r.bytes / 1048576 / (duration / 60);
  console.log(
    `  lần ${i + 1}: ${r.sec.toFixed(2)}s  hệ số thời gian thực ${(duration / r.sec).toFixed(2)}x  đầu ra ${(r.bytes / 1048576).toFixed(2)} MiB (${mbPerMin.toFixed(1)} MiB/phút)` +
      (r.cpuSeconds !== null ? `  CPU ${r.cpuSeconds.toFixed(1)}s (~${(r.cpuSeconds / r.sec).toFixed(2)} nhân)` : '') +
      `  RSS đỉnh ${r.peakKb ? (r.peakKb / 1024).toFixed(0) + ' MiB' : isLinux ? 'không đọc được' : 'không đo được (Windows)'}`,
  );
}
const avgSec = rows.reduce((a, r) => a + r.sec, 0) / rows.length;
const avgBytes = rows.reduce((a, r) => a + r.bytes, 0) / rows.length;
const peak = Math.max(...rows.map((r) => r.peakKb));
console.log(
  `Trung bình: hệ số thời gian thực ${(duration / avgSec).toFixed(2)}x, ${(avgBytes / 1048576 / (duration / 60)).toFixed(1)} MiB/phút, RSS đỉnh ${peak ? (peak / 1024).toFixed(0) + ' MiB' : 'không đo được'}`,
);
const rt = duration / avgSec;
console.log(
  `Gợi ý: với ${threads} luồng, một tác vụ chuyển mã ${height}p xử lý ~${rt.toFixed(1)} giây video mỗi giây; video 180 giây mất ~${(180 / rt).toFixed(0)}s, 600 giây mất ~${(600 / rt).toFixed(0)}s.`,
);
