import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Biến môi trường: danh sách máy chủ kho ngoài được phép, cách nhau bằng dấu phẩy. */
export const ALLOWED_HOSTS_ENV = 'SHARED_EXTERNAL_STORAGE_ALLOWED_HOSTS';

/**
 * Máy chủ ERP gửi yêu cầu tới địa chỉ kho do quản trị tenant nhập, và ở chế độ
 * `proxy` còn trả nội dung về cho trình duyệt. Không chặn thì một tenant trỏ kho
 * vào dịch vụ nội bộ của nền tảng (DB, MinIO, API nội bộ) để dò hay đọc (SSRF).
 *
 * - Có danh sách cho phép (`SHARED_EXTERNAL_STORAGE_ALLOWED_HOSTS`): chỉ máy chủ
 *   khớp danh sách, `http` hay `https` đều được (đường hầm VPN/Tailscale đã mã hoá).
 *   Mỗi mục là tên máy (`nas.congty.vn`), đuôi tên (`*.congty.vn`), IP hoặc dải CIDR
 *   (`100.64.0.0/10`).
 * - Không có danh sách: chỉ địa chỉ công khai qua `https`; chặn IP và tên máy trỏ
 *   vào mạng riêng, loopback, link-local, CGNAT, và tên máy không có dấu chấm
 *   (tên dịch vụ Docker như `minio`, `tenant-db`).
 */
export interface EndpointPolicy {
  /** Lỗi hiển thị cho người dùng; `undefined` là hợp lệ. */
  check(endpoint: string): Promise<string | undefined>;
}

interface AllowEntry {
  readonly host?: string;
  readonly suffix?: string;
  readonly network?: BlockList;
}

const PRIVATE_V4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const PRIVATE_V6: readonly [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

function privateRanges(): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of PRIVATE_V4) list.addSubnet(address, prefix, 'ipv4');
  for (const [address, prefix] of PRIVATE_V6) list.addSubnet(address, prefix, 'ipv6');
  return list;
}

function parseAllowList(raw: string | undefined): AllowEntry[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item): AllowEntry => {
      const [address, prefix] = item.split('/');
      const family = address ? isIP(address) : 0;
      if (family) {
        const network = new BlockList();
        const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix);
        network.addSubnet(address!, bits, family === 4 ? 'ipv4' : 'ipv6');
        return { network };
      }
      if (item.startsWith('*.')) return { suffix: item.slice(1) };
      return { host: item };
    });
}

function familyOf(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

/** Tên máy trong URL: bỏ ngoặc vuông của IPv6. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Lỗi cú pháp chung cho mọi chế độ: chỉ `http(s)://máy[:cổng]`, không kèm tài khoản hay đường dẫn. */
export function endpointSyntaxProblem(endpoint: string, label = 'Địa chỉ kho'): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return `${label} không phải URL hợp lệ (ví dụ http://100.64.1.2:9000).`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${label} phải bắt đầu bằng http:// hoặc https://.`;
  if (url.username || url.password) return `${label} không được kèm tài khoản; nhập access key ở ô riêng.`;
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return `${label} chỉ gồm giao thức, máy chủ và cổng, không kèm đường dẫn.`;
  }
  return undefined;
}

export function endpointPolicy(
  options: { allowList?: string; resolve?: (host: string) => Promise<string[]> } = {},
): EndpointPolicy {
  const allow = parseAllowList(options.allowList ?? process.env[ALLOWED_HOSTS_ENV]);
  const blocked = privateRanges();
  const resolve =
    options.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map((entry) => entry.address));

  const allowed = (host: string): boolean =>
    allow.some((entry) =>
      entry.network
        ? isIP(host) !== 0 && entry.network.check(host, familyOf(host))
        : entry.suffix
          ? host.endsWith(entry.suffix)
          : entry.host === host,
    );

  return {
    async check(endpoint) {
      const syntax = endpointSyntaxProblem(endpoint);
      if (syntax) return syntax;
      const url = new URL(endpoint);
      const host = hostOf(url);

      if (allow.length > 0) {
        return allowed(host)
          ? undefined
          : `Máy chủ ${host} không nằm trong danh sách kho được phép của hệ thống (${ALLOWED_HOSTS_ENV}). Liên hệ quản trị nền tảng.`;
      }

      if (url.protocol !== 'https:') {
        return 'Kho ở mạng công khai phải dùng https://. Kho trong mạng nội bộ cần quản trị nền tảng thêm vào danh sách cho phép.';
      }
      if (isIP(host)) {
        return blocked.check(host, familyOf(host))
          ? `Địa chỉ ${host} thuộc mạng nội bộ; cần quản trị nền tảng thêm vào danh sách cho phép.`
          : undefined;
      }
      if (!host.includes('.') || host === 'localhost' || /\.(local|internal|localhost)$/.test(host)) {
        return `Tên máy ${host} là tên nội bộ; nhập tên miền đầy đủ của kho.`;
      }
      let addresses: string[];
      try {
        addresses = await resolve(host);
      } catch {
        return `Không phân giải được tên miền ${host}.`;
      }
      if (addresses.length === 0 || addresses.some((address) => blocked.check(address, familyOf(address)))) {
        return `Tên miền ${host} trỏ vào mạng nội bộ; cần quản trị nền tảng thêm vào danh sách cho phép.`;
      }
      return undefined;
    },
  };
}
