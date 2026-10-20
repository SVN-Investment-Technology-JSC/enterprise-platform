/**
 * Kiểu và hằng số dùng chung giữa giao diện web và API lưu trữ icon thương hiệu
 * (`/api/platform/v1/brand`). Chỉ có kiểu và hằng số, không có logic.
 */
import type { BrandRules } from './compliance';
import type { IconCategory, IconDocument } from './model';
import type { BrandPalette } from './palette';

/** Đường dẫn gốc của API; đã gồm tiền tố `api` của Platform API. */
export const BRAND_API_BASE = '/api/platform/v1/brand';

export type BrandIconStatus = 'draft' | 'published' | 'archived';
export const BRAND_ICON_STATUSES: readonly BrandIconStatus[] = [
  'draft',
  'published',
  'archived',
];

/** Cách dựng SVG: `brand` ghi cứng màu thương hiệu, `mono` dùng `currentColor`. */
export type BrandSvgMode = 'brand' | 'mono';
export const BRAND_SVG_MODES: readonly BrandSvgMode[] = ['brand', 'mono'];

/** Mã icon do client tạo; trùng với mẫu kiểm của `normalizeDocument`. */
export const BRAND_ICON_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Cỡ tối đa của tài liệu icon sau khi chuẩn hoá (byte). */
export const BRAND_SPEC_MAX_BYTES = 512 * 1024;
/** Độ dài tối đa của ghi chú phiên bản. */
export const BRAND_NOTE_MAX_LENGTH = 200;

export interface BrandIconSummary {
  readonly id: string;
  /** Mã đọc được dẫn từ tên lúc tạo; không đổi khi đổi tên. */
  readonly slug: string;
  readonly name: string;
  readonly category: IconCategory;
  readonly status: BrandIconStatus;
  readonly tags: readonly string[];
  /** Phiên bản mới nhất đã lưu (bắt đầu từ 1). */
  readonly currentVersion: number;
  /** Phiên bản đang phát hành công khai; null khi chưa phát hành. */
  readonly publishedVersion: number | null;
  /** Đã lưu phiên bản mới hơn bản đang phát hành. */
  readonly hasUnpublishedChanges: boolean;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BrandIconVersion {
  readonly version: number;
  readonly specSha256: string;
  readonly sizeBytes: number;
  /** Phiên bản bảng màu và quy chuẩn đã dùng để dựng SVG chế độ màu thương hiệu (0 = mặc định). */
  readonly standardsVersion: number;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface BrandIconDetail extends BrandIconSummary {
  /** Mới nhất trước. */
  readonly versions: readonly BrandIconVersion[];
}

export interface BrandIconListResponse {
  readonly icons: readonly BrandIconSummary[];
}

export interface CreateBrandIconRequest {
  readonly document: IconDocument;
  readonly note?: string;
}

export interface SaveBrandIconRequest {
  readonly document: IconDocument;
  /** Phiên bản mà người dùng đã mở để sửa; lệch với bản hiện hành thì bị từ chối. */
  readonly baseVersion: number;
  readonly note?: string;
}

export interface SaveBrandIconResponse {
  readonly icon: BrandIconSummary;
  readonly version: BrandIconVersion;
  /** Nội dung trùng bản hiện hành nên không tạo phiên bản mới. */
  readonly unchanged: boolean;
}

export interface BrandIconSpecResponse {
  /** Tài liệu để mở lại sửa; `status` lấy theo trạng thái hiện tại của icon. */
  readonly document: IconDocument;
  readonly version: number;
  readonly specSha256: string;
  readonly iconStatus: BrandIconStatus;
}

export interface BrandStandardsPayload {
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
}

export interface BrandStandardsResponse extends BrandStandardsPayload {
  /** 0 khi chưa lưu lần nào (đang dùng bảng màu và quy chuẩn mặc định). */
  readonly version: number;
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
}

export interface SaveBrandStandardsRequest extends BrandStandardsPayload {
  readonly baseVersion: number;
}

export interface SaveBrandStandardsResponse extends BrandStandardsResponse {
  readonly unchanged: boolean;
}

export const BRAND_ERROR_CODES = {
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  csrfInvalid: 'CSRF_INVALID',
  requestInvalid: 'BRAND_REQUEST_INVALID',
  iconInvalid: 'BRAND_ICON_INVALID',
  iconIdMismatch: 'BRAND_ICON_ID_MISMATCH',
  iconNotFound: 'BRAND_ICON_NOT_FOUND',
  iconExists: 'BRAND_ICON_EXISTS',
  iconArchived: 'BRAND_ICON_ARCHIVED',
  iconBusy: 'BRAND_ICON_BUSY',
  iconLimitReached: 'BRAND_ICON_LIMIT_REACHED',
  iconNotPublishable: 'BRAND_ICON_NOT_PUBLISHABLE',
  versionNotFound: 'BRAND_ICON_VERSION_NOT_FOUND',
  versionConflict: 'BRAND_ICON_VERSION_CONFLICT',
  standardsInvalid: 'BRAND_STANDARDS_INVALID',
  standardsConflict: 'BRAND_STANDARDS_VERSION_CONFLICT',
  payloadTooLarge: 'BRAND_PAYLOAD_TOO_LARGE',
  storageUnavailable: 'BRAND_STORAGE_UNAVAILABLE',
  storageCorrupt: 'BRAND_STORAGE_CORRUPT',
  databaseUnavailable: 'BRAND_DATABASE_UNAVAILABLE',
  internal: 'BRAND_INTERNAL_ERROR',
} as const;

export type BrandErrorCode =
  (typeof BRAND_ERROR_CODES)[keyof typeof BRAND_ERROR_CODES];

/** Thân lỗi của API: `message` là câu tiếng Việt người dùng đọc được. */
export interface BrandApiError {
  readonly statusCode: number;
  readonly code: BrandErrorCode;
  readonly message: string;
  /** Có khi lỗi là xung đột phiên bản: phiên bản hiện hành của máy chủ. */
  readonly currentVersion?: number;
}
