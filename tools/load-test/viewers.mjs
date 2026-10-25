#!/usr/bin/env node
// Mô phỏng N người xem video đồng thời bằng fetch Range lên URL ký sẵn (MinIO), như trình phát thật.
// Ví dụ:
//   node tools/load-test/viewers.mjs --urls urls.json --mode same --clients 10 --seconds 30
//   node tools/load-test/viewers.mjs --urls urls.json --mode different --clients 20 --seconds 30 --pattern seek
//   node tools/load-test/viewers.mjs --urls urls.json --clients 5 --seconds 10 --expect-status 403   (URL hết hạn)
import { parseArgs, num, percentile } from './lib/args.mjs';
import { readFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2), ['unthrottled']);
if (!args.urls || args.urls === true) {
  console.error('Thiếu --urls urls.json (tạo bằng presign.mjs).');
  process.exit(2);
}
const mode = args.mode === 'different' ? 'different' : 'same';
const clients = num(args.clients, 10);
const seconds = num(args.seconds, 30);
const pattern = ['start', 'seek', 'tail'].includes(args.pattern) ? args.pattern : 'start';
const chunkBytes = Math.round(num(args['chunk-kb'], 1024) * 1024);
const bitrateMbps = num(args['bitrate-mbps'], 2.5);
const prebufferSeconds = num(args['prebuffer-seconds'], 5);
const uplinkMbps = num(args['uplink-mbps'], 160);
const maxTtfbMs = num(args['max-ttfb-ms'], 2000);
const maxErrorRate = num(args['max-error-rate'], 0);
const unthrottled = Boolean(args.unthrottled);
const expectStatus = args['expect-status'] ? Number(args['expect-status']) : null;

const manifest = JSON.parse(readFileSync(args.urls, 'utf8'));
const items = manifest.items.filter((i) => i.bytes > 0);
if (items.length === 0) {
  console.error('urls.json không có mục nào.');
  process.exit(2);
}
const pick = (i) => (mode === 'same' ? items[num(args.index, 0) % items.length] : items[i % items.length]);

const deadline = Date.now() + seconds * 1000;
const ttfbAll = [];
const ttfbSeek = [];
const statusCount = new Map();
const perClient = [];
let rangeRequests = 0;
let totalBytes = 0;

const bump = (code) => statusCount.set(code, (statusCount.get(code) ?? 0) + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readRange(client, item, start, endInclusive, abortSignal, isSeek) {
  const range = start < 0 ? `bytes=${start}` : `bytes=${start}-${endInclusive}`;
  const t0 = performance.now();
  rangeRequests++;
  client.requests = (client.requests ?? 0) + 1;
  let got = 0;
  try {
    const res = await fetch(item.get, { headers: { range }, signal: abortSignal });
    const expect = expectStatus ?? 206;
    bump(res.status === expect ? `${res.status}${expectStatus ? ' (đúng kỳ vọng)' : ''}` : String(res.status));
    if (res.status !== expect) {
      // Dùng 200 cho Range nghĩa là máy chủ bỏ qua Range: vẫn đọc bỏ để không treo kết nối.
      await res.body?.cancel();
      return { ok: false, bytes: 0 };
    }
    let first = true;
    if (res.body) {
      for await (const chunk of res.body) {
        if (first) {
          const ms = performance.now() - t0;
          ttfbAll.push(ms);
          if (isSeek) ttfbSeek.push(ms);
          first = false;
        }
        got += chunk.length;
      }
    }
    if (first) {
      const ms = performance.now() - t0;
      ttfbAll.push(ms);
    }
    client.bytes += got;
    totalBytes += got;
    return { ok: true, bytes: got };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: true, bytes: got, aborted: true };
    bump(`lỗi mạng: ${e?.cause?.code ?? e?.name ?? 'unknown'}`);
    return { ok: false, bytes: 0 };
  }
}

async function runClient(i) {
  const item = pick(i);
  const client = { index: i, name: item.name, bytes: 0 };
  perClient.push(client);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(0, deadline - Date.now()));
  const bytesPerSec = (bitrateMbps * 1e6) / 8;
  const startedAt = Date.now();
  let consumed = 0; // byte đã "phát" tính từ đầu phiên (dùng cho điều tiết)
  const throttle = async () => {
    if (unthrottled) return;
    // Phát đúng tốc độ, trừ phần đệm ban đầu (trình phát thật đọc trước vài giây).
    const dueMs = (consumed / bytesPerSec - prebufferSeconds) * 1000;
    const wait = startedAt + dueMs - Date.now();
    if (wait > 0) await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
  };
  const size = item.bytes;
  // Dàn lệch thời điểm bắt đầu 0..500 ms như người dùng thật.
  await sleep((i * 37) % 500);
  let seekIdx = 0;
  let pos = 0;
  while (Date.now() < deadline) {
    // Ca URL hết hạn: mỗi client chỉ cần thử một lần để ghi nhận mã trả về.
    if (expectStatus && client.requests > 0) break;
    if (pattern === 'tail') {
      await readRange(client, item, -chunkBytes, 0, ac.signal, false);
      await sleep(Math.min(200, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (pattern === 'seek' && pos === 0 && seekIdx >= 0) {
      // Nhảy tới 25/50/75% rồi đọc 3 đoạn trước khi nhảy tiếp.
      const frac = [0.25, 0.5, 0.75][seekIdx++ % 3];
      pos = Math.floor((size * frac) / chunkBytes) * chunkBytes;
      const r = await readRange(client, item, pos, Math.min(size - 1, pos + chunkBytes - 1), ac.signal, true);
      if (!r.ok) break;
      consumed += r.bytes;
      pos += chunkBytes;
      for (let k = 0; k < 2 && pos < size && Date.now() < deadline; k++) {
        await throttle();
        const r2 = await readRange(client, item, pos, Math.min(size - 1, pos + chunkBytes - 1), ac.signal, false);
        if (!r2.ok) return finish();
        consumed += r2.bytes;
        pos += chunkBytes;
      }
      pos = 0;
      await throttle();
      continue;
    }
    // start: đọc tuần tự từ đầu; hết tệp thì phát lại từ đầu.
    if (pos >= size) pos = 0;
    const r = await readRange(client, item, pos, Math.min(size - 1, pos + chunkBytes - 1), ac.signal, false);
    if (!r.ok) break;
    consumed += r.bytes;
    pos += chunkBytes;
    await throttle();
  }
  return finish();
  function finish() {
    clearTimeout(timer);
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: clients }, (_, i) => runClient(i)));
const elapsed = (Date.now() - t0) / 1000;

const sorted = [...ttfbAll].sort((a, b) => a - b);
const sortedSeek = [...ttfbSeek].sort((a, b) => a - b);
const MiB = 1048576;
const fmt = (n) => n.toFixed(1);
const totalMBps = totalBytes / MiB / elapsed;
const totalMbit = (totalBytes * 8) / 1e6 / elapsed;

console.log(`\n=== viewers: ${clients} client, mode=${mode}, pattern=${pattern}, ${fmt(elapsed)}s, chunk ${chunkBytes / 1024} KiB, ${unthrottled ? 'không điều tiết' : `${bitrateMbps} Mbps/luồng`} ===`);
console.log('Thời gian tới byte đầu (ms)');
console.log(`  mọi yêu cầu : p50=${fmt(percentile(sorted, 50))}  p95=${fmt(percentile(sorted, 95))}  max=${fmt(sorted.at(-1) ?? 0)}  (n=${sorted.length})`);
if (sortedSeek.length) {
  console.log(`  sau khi tua : p50=${fmt(percentile(sortedSeek, 50))}  p95=${fmt(percentile(sortedSeek, 95))}  max=${fmt(sortedSeek.at(-1))}  (n=${sortedSeek.length})`);
}
console.log('Thông lượng');
console.log(`  tổng        : ${totalMBps.toFixed(2)} MiB/s = ${totalMbit.toFixed(1)} Mbit/s`);
console.log(`  mỗi luồng   : ${(totalMBps / clients).toFixed(2)} MiB/s = ${(totalMbit / clients).toFixed(2)} Mbit/s`);
console.log(`  số yêu cầu Range: ${rangeRequests}`);
console.log('Mã trả về');
for (const [code, n] of [...statusCount.entries()].sort()) console.log(`  ${code}: ${n}`);

const n720 = Math.floor(uplinkMbps / 2.5);
const n1080 = Math.floor(uplinkMbps / 4);
console.log(
  `\nTóm tắt: đường ra ${uplinkMbps} Mbps chịu được tối đa ~${n720} luồng 720p (2,5 Mbps) hoặc ~${n1080} luồng 1080p (4 Mbps); ` +
    `nếu chừa 20% dự phòng: ~${Math.floor(n720 * 0.8)} / ~${Math.floor(n1080 * 0.8)}.`,
);
if (!unthrottled && totalMbit > uplinkMbps) {
  console.log(`Lưu ý: thông lượng đo (${totalMbit.toFixed(0)} Mbit/s) vượt đường ra khai báo; đây là đo trên mạng nội bộ máy dev, không phải băng thông VPS.`);
}

const okCodes = new Set(statusCount.keys());
let totalReq = 0;
let badReq = 0;
for (const [code, n] of statusCount) {
  totalReq += n;
  const good = expectStatus ? code.startsWith(`${expectStatus} `) : code === '206';
  if (!good) badReq += n;
}
const errorRate = totalReq === 0 ? 1 : badReq / totalReq;
const p95 = percentile(sorted, 95);
let failed = false;
if (errorRate > maxErrorRate) {
  console.log(`KHÔNG ĐẠT: tỉ lệ lỗi ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`);
  failed = true;
}
if (!expectStatus && p95 > maxTtfbMs) {
  console.log(`KHÔNG ĐẠT: p95 thời gian tới byte đầu ${fmt(p95)} ms > ${maxTtfbMs} ms`);
  failed = true;
}
void okCodes;
if (!failed) console.log('ĐẠT');
process.exitCode = failed ? 1 : 0;
