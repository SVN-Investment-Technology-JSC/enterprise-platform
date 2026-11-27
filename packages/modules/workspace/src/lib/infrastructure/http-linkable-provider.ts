import {
  LINKABLE_RESOLVE_MAX_IDS,
  sanitizeLinkableCreateForm,
  sanitizeLinkableCreatePreview,
  sanitizeLinkableSearchFilters,
  type LinkableCandidate,
  type LinkableCreateForm,
  type LinkableCreatePreview,
  type LinkableCreateRequest,
  type LinkableField,
  type LinkableKind,
  type LinkableObject,
  type LinkablePrefill,
  type LinkableRef,
} from '@enterprise-platform/contracts-integration';
import { EXTERNAL_TIMEOUT_SECONDS } from '@enterprise-platform/contracts-workspace';
import {
  LinkableCreateRejectedError,
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
 * Tạo nhanh được chờ lâu hơn đọc (module gốc sinh mã, đọc danh mục, ghi sổ). Vẫn có trần để Workspace không treo theo;
 * hết giờ thì báo "chưa phản hồi" (hồ sơ có thể đã được tạo, người dùng tìm lại được trong ô chọn).
 */
const CREATE_TIMEOUT_MS = 10_000;
/** Lỗi của module gốc được chuyển nguyên câu chữ cho người dùng khi tạo nhanh (không phải lỗi hạ tầng). */
const CREATE_REJECTION_STATUSES = new Set([400, 403, 404, 409, 422]);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Chỉ chuyển tiếp CSRF có hình dạng token, để không bao giờ chèn được gì khác vào header hay cookie. */
const CSRF_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

interface CallOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly timeoutMs?: number;
  /** Lỗi nghiệp vụ của module gốc (400, 403, 404 có `code`, 409, 422) thành `LinkableCreateRejectedError`. */
  readonly passRejections?: boolean;
}

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

  async search(
    viewer: LinkableViewer,
    kind: string,
    q: string,
    limit: number,
    filters?: Readonly<Record<string, string>>,
  ): Promise<readonly LinkableCandidate[]> {
    // Tham số lọc đi trước, tham số chung ghi sau cùng: không lọc nào đè được `kind`, `q`, `limit`.
    const params = new URLSearchParams(sanitizeLinkableSearchFilters(filters));
    params.set('kind', kind);
    params.set('q', q);
    params.set('limit', String(limit));
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

  /**
   * Form tạo nhanh của module gốc, đã lọc hình dạng. Người dùng không được tạo loại này thì module gốc trả 403 kèm câu
   * của nó (`LinkableCreateRejectedError`), hộp thoại hiện đúng câu đó.
   */
  async createForm(viewer: LinkableViewer, kind: string): Promise<LinkableCreateForm> {
    const params = new URLSearchParams({ kind });
    const body = await this.call(viewer, `/v1/linkable/create-form?${params.toString()}`, {
      timeoutMs: CREATE_TIMEOUT_MS,
      passRejections: true,
    });
    const form = sanitizeLinkableCreateForm(body, kind);
    if (!form) throw new LinkableProviderError('unreachable', `${this.moduleKey} trả form không đọc được.`);
    return form;
  }

  /**
   * Tạo hồ sơ ở module gốc bằng chính phiên của người dùng (Bearer, CSRF): module gốc kiểm dữ liệu và quyền như khi họ
   * tạo ở màn của nó. Không bao giờ dùng service token.
   */
  async create(viewer: LinkableViewer, kind: string, request: LinkableCreateRequest): Promise<LinkableObject> {
    const params = new URLSearchParams({ kind });
    const body = await this.call(viewer, `/v1/linkable/create?${params.toString()}`, {
      method: 'POST',
      body: request,
      timeoutMs: CREATE_TIMEOUT_MS,
      passRejections: true,
    });
    const object = sanitizeObject(body, kind);
    if (!object) throw new LinkableProviderError('unreachable', `${this.moduleKey} trả hồ sơ không đọc được.`);
    return object;
  }

  /**
   * Xem trước theo giá trị một ô của form tạo nhanh (ví dụ dòng hàng sẽ nhận từ báo giá), đã lọc hình dạng. Giá trị
   * không dùng được thì module gốc trả 4xx kèm câu của nó (`LinkableCreateRejectedError`).
   */
  async createPreview(viewer: LinkableViewer, kind: string, field: string, value: string): Promise<LinkableCreatePreview> {
    const params = new URLSearchParams({ kind, field, value });
    const body = await this.call(viewer, `/v1/linkable/create-preview?${params.toString()}`, {
      timeoutMs: CREATE_TIMEOUT_MS,
      passRejections: true,
    });
    const preview = sanitizeLinkableCreatePreview(body, field, value);
    if (!preview) throw new LinkableProviderError('unreachable', `${this.moduleKey} trả bản xem trước không đọc được.`);
    return preview;
  }

  private get(viewer: LinkableViewer, path: string): Promise<unknown> {
    return this.call(viewer, path);
  }

  private async call(viewer: LinkableViewer, path: string, options: CallOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${viewer.accessToken}`,
      'x-tenant-id': viewer.tenantId,
      accept: 'application/json',
    };
    if (options.method === 'POST') {
      headers['content-type'] = 'application/json';
      // Module gốc đòi CSRF cho lệnh ghi (đối chiếu header với cookie `ep_csrf`): chuyển đúng token phiên của người dùng.
      if (viewer.csrfToken && CSRF_PATTERN.test(viewer.csrfToken)) {
        headers['x-csrf-token'] = viewer.csrfToken;
        headers['cookie'] = `ep_csrf=${viewer.csrfToken}`;
      }
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? EXTERNAL_TIMEOUT_SECONDS * 1000),
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
    // Thân lỗi chỉ đọc được một lần.
    const errorBody =
      response.status === 401 || response.status === 403 || (options.passRejections && CREATE_REJECTION_STATUSES.has(response.status))
        ? ((await response.json().catch(() => undefined)) as unknown)
        : undefined;
    if (options.passRejections && CREATE_REJECTION_STATUSES.has(response.status)) {
      const rejection = rejectionOf(response.status, errorBody);
      if (rejection) throw rejection;
    }
    // Module chưa có route này (bản cũ, hoặc module không công bố đối tượng nào): coi như không dùng được.
    if (response.status === 404) throw new LinkableProviderError('module_unavailable');
    if (response.status === 401 || response.status === 403) {
      const code = record(errorBody)?.['code'];
      throw new LinkableProviderError(code === 'MODULE_NOT_ENTITLED' ? 'module_unavailable' : 'forbidden');
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
    ...(item['create'] === true ? { create: true } : {}),
  };
}

/**
 * Lỗi nghiệp vụ của module gốc khi tạo nhanh: có `code` dạng mã máy và `message` thì chuyển tiếp (đã cắt độ dài); thiếu
 * thì không phải lỗi của module (vd route chưa có) và để nơi gọi xử lý như lỗi hạ tầng. Thẻ ngành kiểu
 * `MODULE_NOT_ENTITLED` (công ty không dùng module) không phải lời từ chối dữ liệu.
 */
export function rejectionOf(status: number, body: unknown): LinkableCreateRejectedError | undefined {
  const item = record(body);
  const code = typeof item?.['code'] === 'string' ? (item['code'] as string) : undefined;
  const message = text(item?.['message'], 500);
  if (!item || !code || !ERROR_CODE_PATTERN.test(code) || code === 'MODULE_NOT_ENTITLED' || !message) return undefined;
  const warnings = (Array.isArray(item['warnings']) ? item['warnings'] : [])
    .slice(0, 20)
    .flatMap((warning) => {
      const line = text(warning, 255);
      return line ? [line] : [];
    });
  const field = text(item['field'], 64);
  return new LinkableCreateRejectedError(status, code, message, warnings, field);
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
