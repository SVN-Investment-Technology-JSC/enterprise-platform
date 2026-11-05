// Dùng chung cho các bước seed Bán hàng (crm, pricing, finance, warranty): phiên theo tài khoản, tra khách theo mã,
// ngày theo giờ Việt Nam, chờ sự kiện giữa phân hệ.
import { accountEmail, adminEmail } from './config.mjs';
import { Session, sleep } from './http.mjs';

/** Phiên đăng nhập theo ký hiệu tài khoản (NV1, TN, QTBH...; `QTV` là quản trị tenant), mỗi tài khoản một lần. */
export function createSessions(config) {
  const cache = new Map();
  const userIds = new Map();
  const sessions = {
    async as(code) {
      if (!cache.has(code)) {
        const email = code === 'QTV' ? adminEmail(config) : accountEmail(config, code);
        cache.set(code, Session.login(config.platformApi, { email, password: config.password, portal: 'tenant' }));
      }
      return cache.get(code);
    },
    /** Id người dùng của tài khoản, đọc từ `GET /crm/v1/status` (không phụ thuộc hình dạng phản hồi đăng nhập). */
    async userId(code) {
      if (!userIds.has(code)) {
        const session = await sessions.as(code);
        const status = await session.get(`${config.crmApi}/v1/status`);
        if (!status?.userId) throw new Error(`Không đọc được id người dùng của ${code}.`);
        userIds.set(code, status.userId);
      }
      return userIds.get(code);
    },
  };
  return sessions;
}

export const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  throw new Error(`Không đọc được danh sách từ phản hồi: ${JSON.stringify(value).slice(0, 200)}`);
};

/** Đọc hết các trang của một danh sách phân trang keyset (`items`, `nextCursor`) của Bán hàng. */
export async function allPages(session, url, max = 2000) {
  const items = [];
  let cursor = null;
  do {
    const separator = url.includes('?') ? '&' : '?';
    const page = await session.get(`${url}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(page?.items ?? []));
    cursor = page?.nextCursor ?? null;
  } while (cursor && items.length < max);
  return items;
}

/** Khách Bán hàng theo mã, đọc bằng phiên thấy toàn bộ (QTV). */
export async function customersByCode(config, session) {
  const customers = await allPages(session, `${config.crmApi}/v1/customers`);
  return new Map(customers.map((customer) => [customer.code, customer]));
}

export async function requireCustomers(config, session, codes) {
  const byCode = await customersByCode(config, session);
  const missing = codes.filter((code) => !byCode.has(code));
  if (missing.length) throw new Error(`Chưa có khách ${missing.join(', ')}. Chạy --step=crm trước.`);
  return byCode;
}

/** Mặt hàng Kho theo mã (id, đơn vị, loại). */
export async function materialsByCode(config, session) {
  const materials = list(await session.get(`${config.inventoryApi}/v1/materials?all=true`), 'materials', 'items');
  return new Map(materials.map((material) => [material.code, material]));
}

// ---------------------------------------------------------------------------
// Ngày theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD
// ---------------------------------------------------------------------------

const VN_OFFSET_MS = 7 * 3600_000;

export function vnToday() {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Cộng tháng, ngày cuối tháng thì kẹp (31/3 - 1 tháng = 28 hoặc 29/2). */
export function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Thời điểm ISO lệch `days` ngày so với bây giờ, làm tròn về 9 giờ sáng giờ Việt Nam. */
export function vnInstant(days, hour = 9) {
  const date = addDays(vnToday(), days);
  return new Date(Date.parse(`${date}T00:00:00Z`) + hour * 3600_000 - VN_OFFSET_MS).toISOString();
}

/** Chờ đến khi `check` trả giá trị khác rỗng (ví dụ worker đã chuyển sự kiện sang Bán hàng). */
export async function waitFor(label, check, { timeoutMs = Number(process.env.SVN_SEED_EVENT_TIMEOUT_MS ?? 90_000), intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Hết thời gian chờ: ${label}. Worker (apps/worker) có đang chạy không?`);
    }
    await sleep(intervalMs);
  }
}

export const formatVnd = (amount) => `${Math.round(amount).toLocaleString('vi-VN')} đ`;
