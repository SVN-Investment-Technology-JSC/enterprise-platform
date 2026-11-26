import {
  LINKABLE_RESOLVE_MAX_IDS,
  type LinkableCandidate,
  type LinkableField,
  type LinkableKind,
  type LinkableObject,
  type LinkablePrefill,
  type LinkableRef,
} from '@enterprise-platform/contracts-integration';
import { EXTERNAL_TIMEOUT_SECONDS } from '@enterprise-platform/contracts-workspace';
import {
  LinkableProviderError,
  type LinkableProvider,
  type LinkableProviderRegistry,
  type LinkableViewer,
} from '../application/related-object.port.js';

type Fetcher = typeof fetch;

/** Danh sách loại ít đổi: giữ 60 giây cho mỗi người xem, khoá có `userId` vì mỗi người thấy khác nhau. */
const KINDS_CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

/**
 * Gọi `/v1/linkable/*` của một module qua API công khai của chính module đó, dưới danh nghĩa người xem.
 *
 * Ba ràng buộc:
 * 1. Timeout 3 giây: module kia chậm thì Workspace không chậm theo.
 * 2. Không tin dữ liệu trả về: lọc từng phần tử sai hình dạng, chỉ nhận đường dẫn mở hồ sơ nội bộ `/modules/`, chỉ nhận
 *    loại thuộc đúng module này. Một module lỗi không làm hỏng cả danh sách.
 * 3. Phân biệt lý do lỗi (module không dùng, không có quyền, không trả lời) để giao diện báo đúng.
 */
export class HttpLinkableProvider implements LinkableProvider {
  private readonly kindsCache = new Map<string, { expiresAt: number; kinds: readonly LinkableKind[] }>();

  constructor(
    readonly moduleKey: string,
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async kinds(viewer: LinkableViewer): Promise<readonly LinkableKind[]> {
    const key = `${viewer.tenantId}:${viewer.userId}`;
    const cached = this.kindsCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.kinds;

    const body = await this.get(viewer, '/v1/linkable/kinds');
    const kinds = arrayOf(body, 'kinds').flatMap((entry) => {
      const kind = sanitizeKind(entry, this.moduleKey);
      return kind ? [kind] : [];
    });
    this.remember(key, kinds);
    return kinds;
  }

  async search(viewer: LinkableViewer, kind: string, q: string, limit: number): Promise<readonly LinkableCandidate[]> {
    const params = new URLSearchParams({ kind, q, limit: String(limit) });
    const body = await this.get(viewer, `/v1/linkable/search?${params.toString()}`);
    return arrayOf(body, 'items').flatMap((entry) => {
      const item = sanitizeCandidate(entry, kind);
      return item ? [item] : [];
    });
  }

  async resolve(viewer: LinkableViewer, kind: string, ids: readonly string[]): Promise<readonly LinkableObject[]> {
    const results: LinkableObject[] = [];
    for (let start = 0; start < ids.length; start += LINKABLE_RESOLVE_MAX_IDS) {
      const chunk = ids.slice(start, start + LINKABLE_RESOLVE_MAX_IDS);
      const params = new URLSearchParams({ kind, ids: chunk.join(',') });
      const body = await this.get(viewer, `/v1/linkable/resolve?${params.toString()}`);
      const wanted = new Set(chunk);
      for (const entry of arrayOf(body, 'items')) {
        const item = sanitizeObject(entry, kind);
        if (item && wanted.has(item.id)) results.push(item);
      }
    }
    return results;
  }

  private async get(viewer: LinkableViewer, path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: {
          authorization: `Bearer ${viewer.accessToken}`,
          'x-tenant-id': viewer.tenantId,
          accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_SECONDS * 1000),
      });
    } catch {
      throw new LinkableProviderError('unreachable', `${this.moduleKey} không trả lời.`);
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new LinkableProviderError('unreachable', `${this.moduleKey} trả dữ liệu không đọc được.`);
      }
    }
    // Module chưa có route này (bản cũ, hoặc module không công bố đối tượng nào): coi như không dùng được.
    if (response.status === 404) throw new LinkableProviderError('module_unavailable');
    if (response.status === 401 || response.status === 403) {
      const body = (await response.json().catch(() => undefined)) as { code?: unknown } | undefined;
      throw new LinkableProviderError(body?.code === 'MODULE_NOT_ENTITLED' ? 'module_unavailable' : 'forbidden');
    }
    throw new LinkableProviderError('unreachable', `${this.moduleKey} trả về ${response.status}.`);
  }

  private remember(key: string, kinds: readonly LinkableKind[]): void {
    if (this.kindsCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.kindsCache.keys().next().value;
      if (oldest !== undefined) this.kindsCache.delete(oldest);
    }
    this.kindsCache.delete(key);
    this.kindsCache.set(key, { expiresAt: this.now() + KINDS_CACHE_MS, kinds });
  }
}

/**
 * Các module Workspace hỏi đối tượng liên kết. Thêm một module là thêm một dòng ở đây (kèm biến môi trường địa chỉ API của
 * nó); module chưa công bố hoặc công ty không dùng thì tự bị ẩn, không lỗi.
 */
export function createLinkableProviderRegistry(
  env: Record<string, string | undefined> = process.env,
  fetcher?: Fetcher,
): LinkableProviderRegistry {
  const providers: LinkableProvider[] = [
    new HttpLinkableProvider('crm', env['CRM_API_URL'] ?? 'http://localhost:3344/api/crm', fetcher),
    new HttpLinkableProvider('finance', env['FINANCE_API_URL'] ?? 'http://localhost:3341/api/finance', fetcher),
    new HttpLinkableProvider('inventory', env['INVENTORY_API_URL'] ?? 'http://localhost:3336/api/inventory', fetcher),
    new HttpLinkableProvider('hrm', env['HRM_API_URL'] ?? 'http://localhost:3339/api/hrm', fetcher),
    new HttpLinkableProvider(
      'maintenance',
      env['MAINTENANCE_API_URL'] ?? 'http://localhost:3335/api/maintenance',
      fetcher,
    ),
    new HttpLinkableProvider(
      'correspondence',
      env['CORRESPONDENCE_API_URL'] ?? 'http://localhost:3345/api/correspondence',
      fetcher,
    ),
  ];
  const byKey = new Map(providers.map((provider) => [provider.moduleKey, provider]));
  return {
    all: () => providers,
    get: (moduleKey) => byKey.get(moduleKey),
  };
}

/* ------------------------------------------------------------------ Kiểm hình dạng dữ liệu nhận về */

function arrayOf(body: unknown, key: string): unknown[] {
  if (typeof body !== 'object' || body === null) return [];
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const KIND_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

function sanitizeKind(entry: unknown, moduleKey: string): LinkableKind | undefined {
  const item = record(entry);
  const key = text(item?.['key'], 64);
  const label = text(item?.['label'], 100);
  if (!item || !key || !label || !KIND_PATTERN.test(key) || !key.startsWith(`${moduleKey}.`)) return undefined;
  return {
    key,
    label,
    moduleLabel: text(item['moduleLabel'], 100) ?? moduleKey,
    prefill: item['prefill'] === true,
  };
}

function sanitizeCandidate(entry: unknown, kind: string): LinkableCandidate | undefined {
  const item = record(entry);
  const id = text(item?.['id'], 160);
  const label = text(item?.['label'], 255);
  if (!item || !id || !label || item['kind'] !== kind) return undefined;
  return {
    kind,
    id,
    code: text(item['code'], 100),
    label,
    status: text(item['status'], 64),
    hint: text(item['hint'], 255),
  };
}

/** Chỉ đường dẫn nội bộ `/modules/...`; URL tuyệt đối hay `javascript:` không bao giờ tới được màn hình người dùng. */
export function safeLaunchUrl(value: unknown): string | undefined {
  const url = text(value, 255);
  if (!url) return undefined;
  if (!/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/.test(url) || url.includes('//')) return undefined;
  return url;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeField(entry: unknown): LinkableField | undefined {
  const item = record(entry);
  const key = text(item?.['key'], 64);
  const label = text(item?.['label'], 100);
  const type = item?.['type'];
  if (!item || !key || !label) return undefined;
  const raw = item['value'];
  if (type === 'money') {
    const value = raw == null ? null : Number(raw);
    return { key, label, type, value: value == null || Number.isFinite(value) ? value : null };
  }
  if (type === 'date') {
    const value = typeof raw === 'string' && DATE_PATTERN.test(raw.slice(0, 10)) ? raw.slice(0, 10) : null;
    return { key, label, type, value };
  }
  return { key, label, type: 'text', value: raw == null ? null : String(raw).slice(0, 500) };
}

function sanitizeRef(entry: unknown): LinkableRef | undefined {
  const item = record(entry);
  const kind = text(item?.['kind'], 64);
  const id = text(item?.['id'], 160);
  const label = text(item?.['label'], 255);
  if (!item || !kind || !id || !label || !KIND_PATTERN.test(kind)) return undefined;
  return { kind, id, code: text(item['code'], 100), label };
}

function sanitizePrefill(entry: unknown): LinkablePrefill | undefined {
  const item = record(entry);
  if (!item) return undefined;
  const date = (value: unknown) =>
    typeof value === 'string' && DATE_PATTERN.test(value.slice(0, 10)) ? value.slice(0, 10) : undefined;
  const money = Number(item['contractValue']);
  const prefill: LinkablePrefill = {
    title: text(item['title'], 255),
    description: text(item['description'], 2000),
    startDate: date(item['startDate']),
    endDate: date(item['endDate']),
    contractValue: item['contractValue'] != null && Number.isFinite(money) && money >= 0 ? money : undefined,
    crmCustomerId: text(item['crmCustomerId'], 160),
  };
  return Object.values(prefill).some((value) => value !== undefined) ? prefill : undefined;
}

function sanitizeObject(entry: unknown, kind: string): LinkableObject | undefined {
  const candidate = sanitizeCandidate(entry, kind);
  const item = record(entry);
  const launchUrl = safeLaunchUrl(item?.['launchUrl']);
  if (!candidate || !item || !launchUrl) return undefined;
  const fields = (Array.isArray(item['fields']) ? item['fields'] : []).flatMap((field) => {
    const sanitized = sanitizeField(field);
    return sanitized ? [sanitized] : [];
  });
  const upstream = (Array.isArray(item['upstream']) ? item['upstream'] : []).flatMap((ref) => {
    const sanitized = sanitizeRef(ref);
    return sanitized ? [sanitized] : [];
  });
  return {
    ...candidate,
    launchUrl,
    fields: fields.slice(0, 30),
    upstream: upstream.slice(0, 10),
    prefill: sanitizePrefill(item['prefill']),
  };
}
