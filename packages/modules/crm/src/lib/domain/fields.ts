import { CRM_SEARCH_MAX_LENGTH } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Chuẩn hoá trường nhập từ request. Request đến từ JSON nên kiểu có thể sai
 * bất kỳ: hàm nhận `unknown` và ném 400 tiếng Việt kèm tên trường.
 */

/** Chữ bắt buộc: bỏ khoảng trắng hai đầu, không rỗng, không quá `max`. */
export function requiredText(value: unknown, max: number, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CrmValidationError('REQUIRED', `Vui lòng nhập ${label}.`);
  if (text.length > max) throw new CrmValidationError('TOO_LONG', `${capitalize(label)} tối đa ${max} ký tự.`);
  return text;
}

/** Chữ không bắt buộc: rỗng thành `null`. */
export function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID', `${capitalize(label)} không hợp lệ.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new CrmValidationError('TOO_LONG', `${capitalize(label)} tối đa ${max} ký tự.`);
  return text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function optionalEmail(value: unknown): string | null {
  const text = optionalText(value, 200, 'email');
  if (text && !EMAIL_PATTERN.test(text)) throw new CrmValidationError('INVALID_EMAIL', 'Email không đúng định dạng.');
  return text;
}

/** Số tiền VND không âm, làm tròn đến đồng; rỗng thành `null`. */
export function optionalMoney(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number >= 1e16) {
    throw new CrmValidationError('INVALID_AMOUNT', `${capitalize(label)} phải là số không âm.`);
  }
  return Math.round(number);
}

/** Số nguyên trong khoảng; rỗng thành `null`. */
export function optionalInteger(value: unknown, min: number, max: number, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CrmValidationError('INVALID_NUMBER', `${capitalize(label)} phải là số nguyên từ ${min} đến ${max}.`);
  }
  return number;
}

/** Ngày dạng `YYYY-MM-DD`; rỗng thành `null`. */
export function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new CrmValidationError('INVALID_DATE', `${capitalize(label)} không hợp lệ.`);
  }
  return value;
}

/** Thời điểm ISO; rỗng thành `null`. Trả chuỗi ISO UTC. */
export function optionalInstant(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) throw new CrmValidationError('INVALID_DATE', `${capitalize(label)} không hợp lệ.`);
  return new Date(time).toISOString();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Id tham chiếu không bắt buộc (nhóm, người phụ trách...); rỗng thành `null`. */
export function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) throw new CrmValidationError('INVALID_REFERENCE', `${capitalize(label)} không hợp lệ.`);
  return value.toLowerCase();
}

/** Số phiên bản đang sửa (khoá lạc quan). */
export function requiredVersion(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu phiên bản dữ liệu đang sửa. Vui lòng tải lại.');
  }
  return number;
}

/**
 * Chuỗi tìm kiếm: bỏ khoảng trắng hai đầu; rỗng thành `undefined`; dài quá
 * `CRM_SEARCH_MAX_LENGTH` trả 400 (chặn chuỗi rất dài làm nặng truy vấn).
 */
export function normalizeSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID_SEARCH', 'Chuỗi tìm kiếm không hợp lệ.');
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > CRM_SEARCH_MAX_LENGTH) {
    throw new CrmValidationError('SEARCH_TOO_LONG', `Chuỗi tìm kiếm tối đa ${CRM_SEARCH_MAX_LENGTH} ký tự.`);
  }
  return text;
}

/** Giá trị phải thuộc danh sách cho trước; rỗng thành `undefined`. */
export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new CrmValidationError('INVALID_VALUE', `${capitalize(label)} không hợp lệ.`);
  }
  return value as T;
}

function capitalize(label: string): string {
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}
