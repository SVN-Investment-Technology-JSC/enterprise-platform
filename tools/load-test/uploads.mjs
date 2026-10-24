#!/usr/bin/env node
// Đo tầng kho object (MinIO): C client đồng thời PUT (hoặc multipart 8 MiB x 3 song song) tệp ngẫu nhiên lên URL ký sẵn.
// Không đo API. Dọn tmp-test/ sau khi chạy.
// Ví dụ:
//   node tools/load-test/uploads.mjs --size-mb 20 --clients 3
//   node tools/load-test/uploads.mjs --size-mb 300 --clients 10 --multipart
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { parseArgs, num, percentile } from './lib/args.mjs';
import { deletePrefix, loadS3Config, presign } from './lib/s3.mjs';

const args = parseArgs(process.argv.slice(2), ['multipart', 'keep']);
const sizeMb = num(args['size-mb'], 20);
const clients = num(args.clients, 3);
const multipart = Boolean(args.multipart);
const PART = 8 * 1024 * 1024;
const PARALLEL = num(args['part-parallel'], 3);
const maxErrorRate = num(args['max-error-rate'], 0);
const size = Math.round(sizeMb * 1024 * 1024);
const cfg = loadS3Config();
const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const prefix = `tmp-test/uploads-${runId}/`;

let peakRss = process.memoryUsage().rss;
const rssTimer = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);

const block = randomBytes(1024 * 1024); // 1 MiB ngẫu nhiên, lặp lại khi stream (đủ để MinIO không nén được bằng thủ thuật số 0)
function* bodyChunks(total) {
  let left = total;
  let n = 0;
  while (left > 0) {
    const len = Math.min(block.length, left);
    const b = Buffer.from(block.subarray(0, len));
    b.writeUInt32LE(n++, 0); // đổi 4 byte đầu để các khối khác nhau
    yield b;
    left -= len;
  }
}

async function putSingle(key) {
  const res = await fetch(presign(cfg, 'PUT', key), {
    method: 'PUT',
    headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
    body: Readable.toWeb(Readable.from(bodyChunks(size))),
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`PUT ${res.status}`);
}

async function putMultipart(key) {
  const init = await fetch(presign(cfg, 'POST', key, { query: { uploads: '' } }), { method: 'POST' });
  const xml = await init.text();
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
  if (!init.ok || !uploadId) throw new Error(`khởi tạo multipart ${init.status}`);
  const partCount = Math.max(1, Math.ceil(size / PART));
  const etags = new Array(partCount);
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, partCount) }, async () => {
        while (next < partCount) {
          const idx = next++;
          const len = idx === partCount - 1 ? size - PART * idx : PART;
          const buf = Buffer.alloc(len);
          for (let o = 0; o < len; o += block.length) block.copy(buf, o, 0, Math.min(block.length, len - o));
          buf.writeUInt32LE(idx + 1, 0);
          const res = await fetch(presign(cfg, 'PUT', key, { query: { partNumber: idx + 1, uploadId } }), { method: 'PUT', body: buf });
          if (!res.ok) throw new Error(`part ${idx + 1} -> ${res.status}`);
          etags[idx] = res.headers.get('etag');
        }
      }),
    );
    const body = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const done = await fetch(presign(cfg, 'POST', key, { query: { uploadId } }), { method: 'POST', body });
    const doneXml = await done.text();
    if (!done.ok || /<Error>/.test(doneXml)) throw new Error(`hoàn tất multipart ${done.status}`);
  } catch (e) {
    await fetch(presign(cfg, 'DELETE', key, { query: { uploadId } }), { method: 'DELETE' }).catch(() => {});
    throw e;
  }
}

const results = [];
const errors = new Map();
const t0 = performance.now();
await Promise.all(
  Array.from({ length: clients }, async (_, i) => {
    const key = `${prefix}file-${i}.bin`;
    const s = performance.now();
    try {
      await (multipart ? putMultipart(key) : putSingle(key));
      results.push((performance.now() - s) / 1000);
    } catch (e) {
      const k = String(e.message ?? e);
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
  }),
);
const wall = (performance.now() - t0) / 1000;
clearInterval(rssTimer);
peakRss = Math.max(peakRss, process.memoryUsage().rss);

const sorted = results.sort((a, b) => a - b);
const okBytes = sorted.length * size;
console.log(`\n=== uploads: ${clients} client x ${sizeMb} MiB, ${multipart ? `multipart ${PART / 1048576} MiB x ${PARALLEL} song song` : 'PUT một lần'} ===`);
console.log(`Thành công ${sorted.length}/${clients}, tổng thời gian ${wall.toFixed(2)}s`);
if (sorted.length) {
  console.log(`Thời gian mỗi tệp (s): p50=${percentile(sorted, 50).toFixed(2)}  p95=${percentile(sorted, 95).toFixed(2)}  max=${sorted.at(-1).toFixed(2)}`);
  console.log(`Thông lượng tổng: ${(okBytes / 1048576 / wall).toFixed(1)} MiB/s = ${((okBytes * 8) / 1e6 / wall).toFixed(0)} Mbit/s; mỗi luồng ${((size / 1048576) / (sorted.reduce((a, b) => a + b, 0) / sorted.length)).toFixed(1)} MiB/s`);
}
console.log(`RSS đỉnh của tiến trình Node: ${(peakRss / 1048576).toFixed(0)} MiB`);
for (const [k, n] of errors) console.log(`Lỗi: ${k} x${n}`);

if (!args.keep) console.log(`Đã dọn ${await deletePrefix(cfg, prefix)} đối tượng dưới ${prefix}`);
const rate = errors.size === 0 ? 0 : [...errors.values()].reduce((a, b) => a + b, 0) / clients;
if (rate > maxErrorRate) {
  console.log('KHÔNG ĐẠT: có lỗi tải lên');
  process.exit(1);
}
console.log('ĐẠT');
