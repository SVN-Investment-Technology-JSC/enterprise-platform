/**
 * Cấu hình `trust proxy` của Express từ biến `TRUST_PROXY` (ISS-BE-010).
 *
 * Sau gateway nginx (và Coolify), `request.ip` là IP của proxy nếu không bật `trust proxy`, nên mọi người dùng chung
 * một bộ đếm giới hạn đăng nhập. Đặt `TRUST_PROXY` bằng số lớp proxy đứng trước API (ví dụ `1` hoặc `2`), hoặc danh
 * sách IP/dải mạng của proxy (`loopback, 10.0.0.0/8`). Không đặt thì trả `undefined`: giữ mặc định của Express là không
 * tin `X-Forwarded-For`, để khi chạy API trực tiếp không có proxy thì client không giả được IP bằng header.
 */
export function trustProxyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean | number | string | undefined {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** Chuẩn hoá IP để làm khoá đếm: bỏ tiền tố IPv4-mapped `::ffff:`, chữ thường, bỏ khoảng trắng. */
export function normalizeClientIp(ip: string | undefined | null): string {
  const value = ip?.trim().toLowerCase();
  if (!value) return 'unknown';
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : value;
}
