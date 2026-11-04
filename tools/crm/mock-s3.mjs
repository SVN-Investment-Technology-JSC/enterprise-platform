// Máy chủ S3 giả CHỈ để kiểm thử local khi không dựng được MinIO (ví dụ không kéo được image).
// Hỗ trợ đủ cho kho tài liệu CRM: PUT object, HEAD object, GET object, DELETE object (URL ký sẵn).
// KHÔNG kiểm chữ ký, không kiểm hạn URL (X-Amz-Expires), không phân quyền: không dùng ngoài máy dev.
//   node tools/crm/mock-s3.mjs [--port=9010] [--dir=<thư mục lưu>]
// Địa chỉ phải khớp S3_INTERNAL_ENDPOINT/S3_PUBLIC_ENDPOINT trong .env (mặc định http://localhost:9010).
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '9010' }, dir: { type: 'string', default: join(tmpdir(), 'mock-s3') } } });
const root = resolve(values.dir);
mkdirSync(root, { recursive: true });

const pathOf = (url) => {
  const { pathname } = new URL(url, 'http://localhost');
  const target = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!target.startsWith(root + '/')) return null; // chặn ../
  return target;
};

createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': req.headers.origin ?? '*',
    'access-control-allow-methods': 'GET,PUT,HEAD,DELETE,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'ETag,Content-Length',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const file = pathOf(req.url ?? '/');
  if (!file) return res.writeHead(400, cors).end();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      if (req.method === 'PUT') {
        mkdirSync(dirname(file), { recursive: true });
        const body = Buffer.concat(chunks);
        writeFileSync(file, body);
        writeFileSync(`${file}.type`, String(req.headers['content-type'] ?? 'application/octet-stream'));
        return res.writeHead(200, { ...cors, etag: '"mock"' }).end();
      }
      if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404, { ...cors, 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
      if (req.method === 'DELETE') {
        rmSync(file, { force: true });
        rmSync(`${file}.type`, { force: true });
        return res.writeHead(204, cors).end();
      }
      const size = statSync(file).size;
      const type = existsSync(`${file}.type`) ? readFileSync(`${file}.type`, 'utf8') : 'application/octet-stream';
      const headers = { ...cors, 'content-length': size, 'content-type': type, etag: '"mock"', 'last-modified': new Date().toUTCString() };
      if (req.method === 'HEAD') return res.writeHead(200, headers).end();
      if (req.method === 'GET') return res.writeHead(200, headers).end(readFileSync(file));
      return res.writeHead(405, cors).end();
    } catch (error) {
      return res.writeHead(500, cors).end(String(error));
    }
  });
}).listen(Number(values.port), () => console.log(`mock-s3 http://localhost:${values.port} -> ${root}`));
