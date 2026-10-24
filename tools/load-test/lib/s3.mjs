// Ký URL S3 (SigV4, query string) bằng node:crypto, không cần gói ngoài. Dùng path-style cho MinIO.
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const env = {};
  for (const name of ['.env.local', '.env']) {
    const file = path.resolve(here, '..', '..', '..', name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

// Thứ tự ưu tiên: biến môi trường, .env của repo, rồi mặc định dev (khớp s3-attachment-storage.ts).
export function loadS3Config(overrides = {}) {
  const file = loadDotEnv();
  const get = (k, d) => process.env[k] ?? file[k] ?? d;
  const endpoint =
    overrides.endpoint ?? get('S3_PUBLIC_ENDPOINT', get('S3_ENDPOINT', get('S3_INTERNAL_ENDPOINT', 'http://localhost:9010')));
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    region: get('S3_REGION', 'us-east-1'),
    bucket: overrides.bucket ?? get('S3_BUCKET', 'enterprise-platform'),
    accessKeyId: get('S3_ACCESS_KEY_ID', 'platform'),
    secretAccessKey: get('S3_SECRET_ACCESS_KEY', 'platform-development-secret'),
  };
}

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (k) => k.split('/').map(enc).join('/');

/** Trả về URL đã ký. query: tham số thêm (vd partNumber, uploadId, list-type). */
export function presign(cfg, method, key, { expires = 3600, query = {}, now = new Date() } = {}) {
  const url = new URL(cfg.endpoint);
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const canonicalUri = `${url.pathname.replace(/\/$/, '')}/${cfg.bucket}${key ? '/' + encPath(key) : ''}`;
  const q = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(q)
    .sort()
    .map((k) => `${enc(k)}=${enc(String(q[k]))}`)
    .join('&');
  const canonical = [method, canonicalUri, qs, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonical)].join('\n');
  const kDate = hmac('AWS4' + cfg.secretAccessKey, date);
  const kSigning = hmac(hmac(hmac(kDate, cfg.region), 's3'), 'aws4_request');
  const sig = createHmac('sha256', kSigning).update(sts).digest('hex');
  return `${url.origin}${canonicalUri}?${qs}&X-Amz-Signature=${sig}`;
}

export async function listKeys(cfg, prefix) {
  const keys = [];
  let token;
  do {
    const query = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
    const res = await fetch(presign(cfg, 'GET', '', { query }));
    const xml = await res.text();
    if (!res.ok) throw new Error(`List lỗi ${res.status}: ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]));
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    token = token ? decodeXml(token) : undefined;
  } while (token);
  return keys;
}

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export async function deleteKey(cfg, key) {
  const res = await fetch(presign(cfg, 'DELETE', key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Xoá ${key} lỗi ${res.status}`);
}

export async function deletePrefix(cfg, prefix) {
  const keys = await listKeys(cfg, prefix);
  for (const k of keys) await deleteKey(cfg, k);
  return keys.length;
}

export const CONTENT_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

/** PUT một tệp lên URL ký sẵn (stream, không nạp cả tệp vào RAM). */
export async function putFile(url, file, contentType) {
  const size = statSync(file).size;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(size) },
    body: size === 0 ? new Uint8Array(0) : Readable.toWeb(createReadStream(file)),
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`PUT lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return size;
}
