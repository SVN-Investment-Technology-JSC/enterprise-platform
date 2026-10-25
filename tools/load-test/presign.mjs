#!/usr/bin/env node
// Ký URL GET/PUT cho các khoá MinIO, tuỳ chọn tải fixtures lên trước, xuất urls.json.
// Ví dụ:
//   node tools/load-test/presign.mjs --upload tools/load-test/.fixtures --prefix tmp-test/viewers/ --include good-720p,small
//   node tools/load-test/presign.mjs --prefix tmp-test/viewers/ --ttl 5 --out urls-short.json   (URL hết hạn sau 5 giây)
//   node tools/load-test/presign.mjs --prefix tmp-test/viewers/ --cleanup                        (xoá tiền tố)
import { readdirSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, num } from './lib/args.mjs';
import { CONTENT_TYPES, deletePrefix, listKeys, loadS3Config, presign, putFile } from './lib/s3.mjs';

const args = parseArgs(process.argv.slice(2), ['cleanup', 'put']);
const prefix = typeof args.prefix === 'string' ? args.prefix : 'tmp-test/';
if (!prefix.startsWith('tmp-test/')) {
  console.error('Tiền tố phải bắt đầu bằng "tmp-test/" để không đụng dữ liệu thật.');
  process.exit(2);
}
const cfg = loadS3Config({ bucket: typeof args.bucket === 'string' ? args.bucket : undefined });
const ttl = num(args.ttl, 3600);
const outFile = typeof args.out === 'string' ? args.out : 'urls.json';

if (args.cleanup) {
  console.log(`Đã xoá ${await deletePrefix(cfg, prefix)} đối tượng dưới ${prefix}`);
  process.exit(0);
}

if (typeof args.upload === 'string') {
  const dir = path.resolve(args.upload);
  const include = typeof args.include === 'string' ? args.include.split(',') : null;
  const names = readdirSync(dir).filter((n) => CONTENT_TYPES[path.extname(n)] && statSync(path.join(dir, n)).size > 0);
  for (const name of names) {
    if (include && !include.some((s) => name.includes(s))) continue;
    const t = Date.now();
    const size = await putFile(presign(cfg, 'PUT', prefix + name), path.join(dir, name), CONTENT_TYPES[path.extname(name)]);
    console.log(`Tải lên ${name} (${(size / 1048576).toFixed(1)} MiB) ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}

// Thời lượng lấy từ manifest.json (nếu có thư mục fixtures) hoặc ffprobe.
let manifest = {};
if (typeof args.upload === 'string') {
  const m = path.join(path.resolve(args.upload), 'manifest.json');
  if (existsSync(m)) manifest = JSON.parse(readFileSync(m, 'utf8')).files ?? {};
}
const keys = (await listKeys(cfg, prefix)).filter((k) => !k.endsWith('/'));
const items = [];
for (const key of keys) {
  const name = key.slice(prefix.length);
  const get = presign(cfg, 'GET', key, { expires: ttl });
  const head = await fetch(presign(cfg, 'HEAD', key, { expires: ttl }), { method: 'HEAD' });
  const bytes = Number(head.headers.get('content-length') ?? 0);
  let durationSeconds = manifest[name]?.probed?.durationSeconds ?? null;
  if (durationSeconds === null && bytes < 200 * 1048576) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', get], { encoding: 'utf8' });
    const d = Number(r.stdout?.trim());
    durationSeconds = Number.isFinite(d) && d > 0 ? d : null;
  }
  items.push({
    key,
    name,
    bytes,
    durationSeconds,
    contentType: CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream',
    get,
    ...(args.put ? { put: presign(cfg, 'PUT', key, { expires: ttl }) } : {}),
  });
}
writeFileSync(outFile, JSON.stringify({ createdAt: new Date().toISOString(), ttlSeconds: ttl, endpoint: cfg.endpoint, bucket: cfg.bucket, items }, null, 2));
console.log(`Đã ghi ${items.length} URL (TTL ${ttl}s) -> ${outFile}`);
