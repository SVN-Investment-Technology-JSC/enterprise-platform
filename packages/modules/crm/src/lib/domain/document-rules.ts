import {
  CRM_ALLOWED_DOCUMENT_CONTENT_TYPES,
  CRM_DOCUMENT_AUDIENCES,
  CRM_DOCUMENT_ENTITY_TYPES,
  CRM_DOCUMENT_MAX_BYTES,
  CRM_DOCUMENT_MAX_FOLDER_DEPTH,
  type CrmDocumentAudience,
  type CrmDocumentEntityType,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Luật tài liệu CRM, thuần (không DB, không S3).
 *
 * Giới hạn file và độ sâu thư mục viết RIÊNG cho CRM, cùng giá trị với Workspace (50 MB, danh sách loại file,
 * URL ký 300 giây, thư mục sâu 5 cấp); không import code Workspace (P2-D14). Việc gom chung các hằng số và
 * hàm kiểm này với Workspace, Kho làm sau (backlog BL2-09), khi đó file này chỉ còn nối sang gói chung.
 */

const MB = 1024 * 1024;
const MAX_FILE_NAME = 255;
const MAX_NAME = 255;
const MAX_FOLDER_NAME = 200;
/** Phần đuôi tên file giữ trong `object_key` (đủ giữ phần mở rộng). */
const OBJECT_NAME_TAIL = 80;

export function isDocumentEntityType(value: unknown): value is CrmDocumentEntityType {
  return typeof value === 'string' && (CRM_DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

export function parseEntityType(value: unknown): CrmDocumentEntityType {
  if (!isDocumentEntityType(value)) {
    throw new CrmValidationError('INVALID_DOCUMENT_ENTITY', 'Loại đối tượng gắn tài liệu không hợp lệ.');
  }
  return value;
}

export function parseAudience(value: unknown): CrmDocumentAudience {
  if (typeof value !== 'string' || !(CRM_DOCUMENT_AUDIENCES as readonly string[]).includes(value)) {
    throw new CrmValidationError('INVALID_DOCUMENT_AUDIENCE', 'Đối tượng xem phải là "internal" hoặc "customer".');
  }
  return value as CrmDocumentAudience;
}

function controlCharacters(text: string): string {
  return [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  }).join('');
}

/**
 * Tên file hiển thị: bỏ ký tự điều khiển, đổi `/` và `\` thành `_`, gọn khoảng trắng. Tên rỗng hoặc dài quá
 * 255 ký tự thì từ chối (không cắt âm thầm). Tên này chỉ để hiển thị; `object_key` không bao giờ dùng nó thô.
 */
export function normalizeFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const name = controlCharacters(raw).replace(/[\\/]+/g, '_').replace(/\s+/g, ' ').trim();
  if (!name || name === '.' || name === '..') {
    throw new CrmValidationError('INVALID_FILE_NAME', 'Tên file không được để trống.');
  }
  if (name.length > MAX_FILE_NAME) {
    throw new CrmValidationError('FILE_NAME_TOO_LONG', `Tên file không được dài quá ${MAX_FILE_NAME} ký tự.`);
  }
  return name;
}

/** Tên tài liệu (hiển thị); rỗng thì lấy `fallback`. */
export function normalizeDocumentName(value: unknown, fallback: string): string {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return fallback;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID_DOCUMENT_NAME', 'Tên tài liệu không hợp lệ.');
  const name = controlCharacters(value).replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME) {
    throw new CrmValidationError('DOCUMENT_NAME_TOO_LONG', `Tên tài liệu không được dài quá ${MAX_NAME} ký tự.`);
  }
  return name;
}

export function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID_TEXT', `${label} không hợp lệ.`);
  const text = controlCharacters(value).trim();
  if (!text) return null;
  if (text.length > max) throw new CrmValidationError('TEXT_TOO_LONG', `${label} không được dài quá ${max} ký tự.`);
  return text;
}

export function requiredText(value: unknown, max: number, label: string): string {
  const text = optionalText(value, max, label);
  if (!text) throw new CrmValidationError('TEXT_REQUIRED', `${label} không được để trống.`);
  return text;
}

/** Loại file đã chuẩn hoá (chữ thường, bỏ tham số như `; charset=utf-8`) và có trong danh sách cho phép. */
export function normalizeContentType(value: unknown): string {
  const type = (typeof value === 'string' ? value : '').split(';')[0].trim().toLowerCase();
  if (!CRM_ALLOWED_DOCUMENT_CONTENT_TYPES.includes(type)) {
    throw new CrmValidationError('UNSUPPORTED_CONTENT_TYPE', `Không hỗ trợ loại file "${type || '(trống)'}".`);
  }
  return type;
}

/** Dung lượng khai báo: số nguyên dương, tối đa 50 MB. */
export function validateSizeBytes(value: unknown): number {
  const size = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(size) || size <= 0) {
    throw new CrmValidationError('INVALID_FILE_SIZE', 'Dung lượng file phải là số nguyên dương.');
  }
  if (size > CRM_DOCUMENT_MAX_BYTES) {
    throw new CrmValidationError(
      'FILE_TOO_LARGE',
      `File không được vượt quá ${Math.round(CRM_DOCUMENT_MAX_BYTES / MB)} MB.`,
    );
  }
  return size;
}

export interface ValidatedUploadFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** Kiểm file trước khi ký URL tải lên: tên, loại, dung lượng. */
export function validateUploadFile(fileName: unknown, contentType: unknown, sizeBytes: unknown): ValidatedUploadFile {
  return {
    fileName: normalizeFileName(fileName),
    contentType: normalizeContentType(contentType),
    sizeBytes: validateSizeBytes(sizeBytes),
  };
}

/**
 * Đoạn tên dùng trong `object_key`: bỏ dấu tiếng Việt (đ thành d), ký tự ngoài `a-zA-Z0-9._-` thành `-`,
 * gọn, giữ tối đa 80 ký tự CUỐI (để còn phần mở rộng). Không bao giờ chứa `/`; không bao giờ rỗng.
 */
export function sanitizeObjectName(fileName: string): string {
  const safe = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(-OBJECT_NAME_TAIL)
    .replace(/^[-.]+/, '');
  return safe || 'file';
}

/**
 * Khoá object trên kho lưu trữ: theo tenant, loại đối tượng, một UUID ngẫu nhiên và phiên bản; tên người dùng
 * chỉ vào qua `sanitizeObjectName`. UUID làm khoá không đoán trước và không trùng giữa hai lần tải cùng tên.
 */
export function buildObjectKey(input: {
  readonly tenantId: string;
  readonly entityType: CrmDocumentEntityType;
  readonly versionNo: number;
  readonly fileName: string;
  readonly uuid: string;
}): string {
  return `tenants/${input.tenantId}/crm/documents/${input.entityType}/${input.uuid}/v${input.versionNo}-${sanitizeObjectName(input.fileName)}`;
}

export function normalizeFolderName(value: unknown): string {
  const name = controlCharacters(typeof value === 'string' ? value : '')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) throw new CrmValidationError('INVALID_FOLDER_NAME', 'Tên thư mục không được để trống.');
  if (name.length > MAX_FOLDER_NAME) {
    throw new CrmValidationError('FOLDER_NAME_TOO_LONG', `Tên thư mục không được dài quá ${MAX_FOLDER_NAME} ký tự.`);
  }
  return name;
}

/** Độ sâu của thư mục mới: 1 ở gốc, cha cộng 1; vượt giới hạn thì từ chối. */
export function nextFolderDepth(parentDepth: number | null): number {
  const depth = (parentDepth ?? 0) + 1;
  if (depth > CRM_DOCUMENT_MAX_FOLDER_DEPTH) {
    throw new CrmValidationError(
      'FOLDER_TOO_DEEP',
      `Thư mục chỉ lồng tối đa ${CRM_DOCUMENT_MAX_FOLDER_DEPTH} cấp.`,
    );
  }
  return depth;
}

const TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Mã loại tài liệu: chữ hoa, số, gạch dưới; 2 đến 32 ký tự; bắt đầu bằng chữ. */
export function normalizeDocumentTypeCode(value: unknown): string {
  const code = (typeof value === 'string' ? value : '').trim().toUpperCase();
  if (!TYPE_CODE_PATTERN.test(code)) {
    throw new CrmValidationError(
      'INVALID_DOCUMENT_TYPE_CODE',
      'Mã loại tài liệu gồm chữ hoa, số, gạch dưới, 2 đến 32 ký tự, bắt đầu bằng chữ.',
    );
  }
  return code;
}
