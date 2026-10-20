import {
  BRAND_API_BASE,
  BRAND_ERROR_CODES,
  type BrandErrorCode,
  type BrandIconDetail,
  type BrandIconListResponse,
  type BrandIconSpecResponse,
  type BrandIconStatus,
  type BrandIconSummary,
  type BrandStandardsResponse,
  type BrandSvgMode,
  type CreateBrandIconRequest,
  type SaveBrandIconRequest,
  type SaveBrandIconResponse,
  type SaveBrandStandardsRequest,
  type SaveBrandStandardsResponse,
} from '@enterprise-platform/shared-brand-icon';
import { authFetch } from '@enterprise-platform/shared-ui';

/** Mã lỗi do phía trình duyệt tự đặt (máy chủ không trả lời hoặc trả thứ không đọc được). */
export type BrandClientErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'BAD_RESPONSE';

/**
 * Lỗi khi gọi API icon thương hiệu. `code` và `message` lấy từ thân lỗi của máy chủ (`message` là câu tiếng Việt
 * hiển thị được); khi máy chủ không trả thân lỗi chuẩn (nginx 502, 404 chưa có API...) thì tự dựng câu ngắn theo
 * mã HTTP.
 */
export class BrandApiError extends Error {
  readonly statusCode: number;
  readonly code: BrandErrorCode | BrandClientErrorCode;
  readonly currentVersion?: number;
  /** Lý do chưa phát hành được (422 BRAND_ICON_NOT_PUBLISHABLE). */
  readonly reasons?: readonly string[];

  constructor(init: {
    readonly statusCode: number;
    readonly code: BrandErrorCode | BrandClientErrorCode;
    readonly message: string;
    readonly currentVersion?: number;
    readonly reasons?: readonly string[];
  }) {
    super(init.message);
    this.name = 'BrandApiError';
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.currentVersion = init.currentVersion;
    this.reasons = init.reasons;
  }

  /** Lưu trên máy chủ đã có phiên bản mới hơn bản đang sửa. */
  get isVersionConflict(): boolean {
    return this.code === BRAND_ERROR_CODES.versionConflict;
  }

  get isStandardsConflict(): boolean {
    return this.code === BRAND_ERROR_CODES.standardsConflict;
  }

  /** Không tới được API (mạng, 404 chưa có API, 5xx): coi như máy chủ chưa dùng được. */
  get isUnavailable(): boolean {
    return (
      this.statusCode === 0 ||
      this.statusCode === 404 ||
      this.statusCode >= 500 ||
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT'
    );
  }

  get isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function isBrandApiError(error: unknown): error is BrandApiError {
  return error instanceof BrandApiError;
}

/** Thông điệp tiếng Việt từ một lỗi bất kỳ, dùng để hiện cho người dùng. */
export function errorMessage(error: unknown, fallback = 'Có lỗi xảy ra. Thử lại sau.'): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const REQUEST_TIMEOUT_MS = 30_000;

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

function messageForStatus(status: number): string {
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Bạn không có quyền dùng chức năng này.';
  if (status === 404) return 'Máy chủ chưa có API lưu icon.';
  if (status >= 500) return 'Máy chủ đang gặp sự cố. Thử lại sau.';
  return 'Máy chủ từ chối yêu cầu.';
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toApiError(status: number, payload: unknown): BrandApiError {
  const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const message = typeof body.message === 'string' && body.message ? body.message : messageForStatus(status);
  const code = typeof body.code === 'string' && body.code ? (body.code as BrandErrorCode) : BRAND_ERROR_CODES.internal;
  const currentVersion = typeof body.currentVersion === 'number' ? body.currentVersion : undefined;
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.filter((reason): reason is string => typeof reason === 'string')
    : undefined;
  return new BrandApiError({ statusCode: status, code, message, currentVersion, reasons });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let text: string;
  try {
    response = await authFetch(`${BRAND_API_BASE}${path}`, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new BrandApiError({ statusCode: 0, code: 'TIMEOUT', message: 'Máy chủ phản hồi quá lâu. Thử lại sau.' });
    }
    throw new BrandApiError({
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: cause instanceof Error && cause.name === 'AbortError' ? 'Yêu cầu đã bị huỷ.' : 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
    });
  } finally {
    clearTimeout(timer);
  }

  const payload = parseJson(text);
  if (!response.ok) throw toApiError(response.status, payload);
  if (payload === undefined) {
    throw new BrandApiError({ statusCode: response.status, code: 'BAD_RESPONSE', message: 'Máy chủ trả dữ liệu không đúng định dạng.' });
  }
  return payload as T;
}

const iconPath = (id: string) => `/icons/${encodeURIComponent(id)}`;

/** Danh sách tóm tắt icon; bỏ `status` thì lấy mọi trạng thái (kể cả đã lưu trữ). */
export function listIcons(options: { readonly status?: readonly BrandIconStatus[]; readonly timeoutMs?: number } = {}): Promise<BrandIconListResponse> {
  const query = options.status && options.status.length > 0 ? `?status=${encodeURIComponent(options.status.join(','))}` : '';
  return request<BrandIconListResponse>(`/icons${query}`, { timeoutMs: options.timeoutMs });
}

export function getIcon(id: string): Promise<BrandIconDetail> {
  return request<BrandIconDetail>(iconPath(id));
}

/** Tài liệu của một phiên bản; bỏ `version` thì lấy bản mới nhất. */
export function getIconSpec(id: string, version?: number): Promise<BrandIconSpecResponse> {
  const query = version === undefined ? '' : `?version=${encodeURIComponent(String(version))}`;
  return request<BrandIconSpecResponse>(`${iconPath(id)}/spec${query}`);
}

export function createIcon(input: CreateBrandIconRequest): Promise<SaveBrandIconResponse> {
  return request<SaveBrandIconResponse>('/icons', { method: 'POST', body: input });
}

/** Lưu phiên bản mới. `baseVersion` lệch bản hiện hành thì máy chủ trả 409 BRAND_ICON_VERSION_CONFLICT. */
export function saveIcon(id: string, input: SaveBrandIconRequest): Promise<SaveBrandIconResponse> {
  return request<SaveBrandIconResponse>(iconPath(id), { method: 'PUT', body: input });
}

export function publishIcon(id: string): Promise<BrandIconSummary> {
  return request<BrandIconSummary>(`${iconPath(id)}/publish`, { method: 'POST' });
}

export function unpublishIcon(id: string): Promise<BrandIconSummary> {
  return request<BrandIconSummary>(`${iconPath(id)}/unpublish`, { method: 'POST' });
}

/** Lưu trữ icon (máy chủ không xoá dữ liệu). */
export function archiveIcon(id: string): Promise<BrandIconSummary> {
  return request<BrandIconSummary>(iconPath(id), { method: 'DELETE' });
}

export function restoreIcon(id: string): Promise<BrandIconSummary> {
  return request<BrandIconSummary>(`${iconPath(id)}/restore`, { method: 'POST' });
}

export function getStandards(options: { readonly timeoutMs?: number } = {}): Promise<BrandStandardsResponse> {
  return request<BrandStandardsResponse>('/standards', { timeoutMs: options.timeoutMs });
}

export function saveStandards(input: SaveBrandStandardsRequest): Promise<SaveBrandStandardsResponse> {
  return request<SaveBrandStandardsResponse>('/standards', { method: 'PUT', body: input });
}

/** Đường dẫn ảnh SVG dựng sẵn của một phiên bản; bản đã phát hành đọc công khai, bản khác cần đăng nhập quản trị. */
export function svgUrl(id: string, version: number, mode: BrandSvgMode = 'brand'): string {
  return `${BRAND_API_BASE}${iconPath(id)}/svg?v=${encodeURIComponent(String(version))}&mode=${mode}`;
}
