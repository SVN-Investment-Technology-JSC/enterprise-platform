import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runDevelopment } from './dev.mjs';

// Sửa danh sách này để bật/tắt dịch vụ khi cần, rồi chạy lại:
//   node tools/dev-core-hrm-pe.mjs
export const PROJECTS = [
  // core
  'web',
  'api',
  // hrm
  'hrm-web',
  'hrm-api',
  // procedure engine
  'procedure-web',
  'procedure-api',
  // inventory (nhà kho)
  'inventory-web',
  'inventory-api',
  // crm
  'crm-web',
  'crm-api',
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
