// Gateway dev cổng 8080 không cần Docker: thay nginx của infrastructure/nginx/nginx.conf bằng một reverse proxy Node.
// Dùng: pnpm dev:gateway   (đặt DEV_GATEWAY_PORT để đổi cổng, mặc định 8080)
// Định tuyến giống nginx: /api/auth và /api/platform -> 3333, /api/realtime và /realtime/socket.io -> 3338,
// /api/procedure|maintenance|inventory|workspace -> 3334|3335|3336|3337, /modules/<module> -> web của module, còn lại -> web chính 3002.
// /api/hrm do chính hrm-web (3008) chuyển tiếp sang hrm-api (3339) qua next.config.js.
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const HOST = '127.0.0.1';
export const ROUTES = [
  ['/api/realtime/', 3338],
  ['/realtime/socket.io', 3338],
  ['/api/procedure/', 3334],
  ['/api/maintenance/', 3335],
  ['/api/inventory/', 3336],
  ['/api/workspace/', 3337],
  ['/api/auth/', 3333],
  ['/api/platform/', 3333],
  ['/modules/procedure', 3003],
  ['/modules/maintenance', 3004],
  ['/modules/inventory', 3005],
  ['/modules/hrm', 3008],
  ['/modules/workspace', 3006],
];
const DEFAULT_PORT = 3002;

/** Cổng đích của một đường dẫn: khớp tiền tố dài nhất theo ranh giới đoạn (như `location ^~` và `location =` của nginx). */
export function targetPort(url) {
  const path = (url ?? '/').split('?')[0];
  for (const [prefix, port] of ROUTES) {
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (path === bare || path.startsWith(`${bare}/`)) return port;
  }
  return DEFAULT_PORT;
}

function unavailable(res, port) {
  if (res.headersSent) return res.end();
  res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '10' });
  res.end(JSON.stringify({ statusCode: 503, message: `Dịch vụ cổng ${port} chưa chạy hoặc đang khởi động.` }));
}

export function createGateway() {
  const server = http.createServer((req, res) => {
    const port = targetPort(req.url);
    const upstream = http.request(
      { host: HOST, port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-host': req.headers.host ?? '' } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => unavailable(res, port));
    req.pipe(upstream);
  });
  // WebSocket (HMR của Next, socket.io realtime): nối thẳng hai đầu.
  server.on('upgrade', (req, socket, head) => {
    const port = targetPort(req.url);
    const upstream = net.connect(port, HOST, () => {
      const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEV_GATEWAY_PORT ?? 8080);
  createGateway().listen(port, () => {
    console.log(`Gateway dev: http://localhost:${port}  (web 3002, hrm-web 3008, platform-api 3333)`);
  });
}
