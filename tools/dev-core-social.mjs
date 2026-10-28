import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runDevelopment } from './dev.mjs';

// Khởi động chỉ phân hệ Mạng xã hội (Social) cùng khung hệ thống (Core, Realtime, Worker):
//   node tools/dev-core-social.mjs
// hoặc:
//   pnpm dev:core-social
export const PROJECTS = [
  // core
  'web',
  'api',
  // social (mạng xã hội)
  'social-web',
  'social-api',
  // thông báo thời gian thực và outbox
  'realtime-api',
  'notification-worker',
  'worker',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDevelopment([
    'run-many',
    '-t',
    'dev',
    'serve',
    `--projects=${PROJECTS.join(',')}`,
    '--configuration=development',
    '--parallel=2',
    '--outputStyle=stream',
  ]);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1));
}
