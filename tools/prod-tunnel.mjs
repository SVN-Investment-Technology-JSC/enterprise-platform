// Mở SSH tunnel tới prod, tự lấy IP container hiện tại (IP đổi sau mỗi lần redeploy).
// Dùng: pnpm prod:tunnel [--host=<user>@<máy chủ>] [--dry-run]
// Địa chỉ máy chủ KHÔNG ghi trong mã nguồn: đặt PROD_TUNNEL_HOST=<user>@<máy chủ> trong .env (git bỏ qua) hoặc truyền --host=.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';


// Cổng local khớp với .env: PLATFORM_DATABASE_URL, TENANT_DATABASE_*, RABBITMQ_URL, VALKEY_URL.
export const FORWARDS = [
  { role: 'platform-db', local: 55432, remotePort: 5432 },
  { role: 'tenant-db', local: 55436, remotePort: 5432 },
  { role: 'rabbitmq', local: 5672, remotePort: 5672 },
  { role: 'valkey', local: 56379, remotePort: 6379 },
];

const REMOTE_COMMAND =
  "docker ps -q | xargs -r docker inspect -f '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'";

/** Parse output của `docker inspect -f '{{.Name}} {{IPs}}'`, mỗi dòng "/ten-container 10.0.x.y". */
export function parseContainers(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([name, ip]) => name?.startsWith('/') && /^\d+\.\d+\.\d+\.\d+$/.test(ip ?? ''))
    .map(([name, ip]) => ({ name: name.slice(1), ip }));
}

/** Container của stack ERP có tên "<role>-<id coolify>-<yyyymmddThhmmss>"; nhiều bản thì lấy bản mới nhất. */
export function pickTargets(containers) {
  const targets = {};
  const warnings = [];
  for (const { role } of FORWARDS) {
    const pattern = new RegExp(`^${role}-[a-z0-9]+-(\\d{8}T\\d{6})$`);
    const matches = containers
      .map((c) => ({ ...c, stamp: pattern.exec(c.name)?.[1] }))
      .filter((c) => c.stamp)
      .sort((a, b) => b.stamp.localeCompare(a.stamp));
    if (!matches.length) throw new Error(`Không tìm thấy container đang chạy cho "${role}" trên server.`);
    if (matches.length > 1) {
      warnings.push(`${role}: có ${matches.length} container (${matches.map((m) => m.name).join(', ')}), dùng bản mới nhất.`);
    }
    targets[role] = matches[0];
  }
  return { targets, warnings };
}

export function buildTunnelArgs(host, targets) {
  const args = ['-N', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes'];
  for (const { role, local, remotePort } of FORWARDS) {
    args.push('-L', `${local}:${targets[role].ip}:${remotePort}`);
  }
  args.push(host);
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '..', '.env'));
  } catch {
    /* không có .env thì dùng biến môi trường hiện có */
  }
  const host = argv.find((a) => a.startsWith('--host='))?.slice('--host='.length) ?? process.env.PROD_TUNNEL_HOST;
  if (!host) {
    console.error('Thiếu máy chủ: đặt PROD_TUNNEL_HOST=<user>@<máy chủ> trong .env hoặc truyền --host=<user>@<máy chủ>.');
    process.exit(1);
  }
  const dryRun = argv.includes('--dry-run');

  console.log(`[1/2] Lấy IP container trên ${host} (nhập mật khẩu SSH nếu được hỏi)...`);
  const lookup = spawnSync('ssh', ['-o', 'ConnectTimeout=15', host, REMOTE_COMMAND], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (lookup.error || lookup.status !== 0) {
    console.error(lookup.error?.message ?? `ssh thoát với mã ${lookup.status}.`);
    process.exit(lookup.status ?? 1);
  }

  let picked;
  try {
    picked = pickTargets(parseContainers(lookup.stdout));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  picked.warnings.forEach((w) => console.warn(`Cảnh báo: ${w}`));
  for (const { role, local, remotePort } of FORWARDS) {
    const t = picked.targets[role];
    console.log(`  localhost:${local} -> ${t.ip}:${remotePort}  (${t.name})`);
  }

  const args = buildTunnelArgs(host, picked.targets);
  if (dryRun) {
    console.log(`ssh ${args.join(' ')}`);
    return;
  }
  console.log('[2/2] Mở tunnel (nhập mật khẩu lần nữa nếu chưa dùng SSH key). Giữ cửa sổ này mở, Ctrl+C để đóng.');
  const tunnel = spawn('ssh', args, { stdio: 'inherit' });
  tunnel.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : 1)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
