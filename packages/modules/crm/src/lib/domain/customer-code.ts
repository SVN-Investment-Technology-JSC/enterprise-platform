import {
  CUSTOMER_CODE_LENGTH_MAX,
  CUSTOMER_CODE_LENGTH_MIN,
  CUSTOMER_CODE_PREFIX_MAX,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/** Quy tắc sinh mã khách hàng, lưu ở `crm_schema.settings` khoá `customer.code`. */
export interface CustomerCodeRule {
  readonly prefix: string;
  /** Số chữ số của phần số thứ tự (đệm số 0 bên trái). */
  readonly length: number;
}

export const CUSTOMER_CODE_SETTING_KEY = 'customer.code';
export const DEFAULT_CUSTOMER_CODE_RULE: CustomerCodeRule = { prefix: 'KH', length: 6 };
/** Khớp `customers.code VARCHAR(50)`. */
export const CUSTOMER_CODE_MAX_LENGTH = 50;

const PREFIX_PATTERN = /^[A-Z0-9._-]*$/;
const CODE_PATTERN = /^[A-Z0-9._-]+$/;

/** Kiểm quy tắc do quản trị bán hàng nhập; trả bản đã chuẩn hoá (tiền tố viết hoa). */
export function normalizeCustomerCodeRule(input: { prefix?: unknown; length?: unknown }): CustomerCodeRule {
  const prefix = typeof input.prefix === 'string' ? input.prefix.trim().toUpperCase() : '';
  const length = Number(input.length);
  if (prefix.length > CUSTOMER_CODE_PREFIX_MAX || !PREFIX_PATTERN.test(prefix)) {
    throw new CrmValidationError(
      'INVALID_CODE_RULE',
      `Tiền tố mã khách hàng tối đa ${CUSTOMER_CODE_PREFIX_MAX} ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.`,
    );
  }
  if (!Number.isInteger(length) || length < CUSTOMER_CODE_LENGTH_MIN || length > CUSTOMER_CODE_LENGTH_MAX) {
    throw new CrmValidationError(
      'INVALID_CODE_RULE',
      `Độ dài phần số của mã khách hàng phải từ ${CUSTOMER_CODE_LENGTH_MIN} đến ${CUSTOMER_CODE_LENGTH_MAX}.`,
    );
  }
  return { prefix, length };
}

/**
 * Đọc quy tắc đã lưu. Giá trị hỏng (sửa tay DB) thì dùng mặc định thay vì làm
 * hỏng việc tạo khách.
 */
export function parseCustomerCodeRule(value: unknown): CustomerCodeRule {
  try {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return normalizeCustomerCodeRule({ prefix: record['prefix'], length: record['length'] });
  } catch {
    return DEFAULT_CUSTOMER_CODE_RULE;
  }
}

/**
 * Mã từ số thứ tự của sequence: `KH` + `000001`. Số vượt độ dài thì giữ đủ
 * chữ số (không cắt), để không bao giờ sinh trùng.
 */
export function formatCustomerCode(rule: CustomerCodeRule, sequence: number | bigint): string {
  const digits = String(sequence);
  if (!/^\d+$/.test(digits) || digits === '0') throw new Error(`Invalid customer code sequence: ${digits}.`);
  return `${rule.prefix}${digits.padStart(rule.length, '0')}`;
}

/**
 * Mã người dùng tự nhập (khi tạo hay sửa): bỏ khoảng trắng hai đầu, viết hoa.
 * Rỗng trả `null` (để hệ thống sinh khi tạo).
 */
export function normalizeCustomerCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '\u0000';
  if (!value) return null;
  if (value.length > CUSTOMER_CODE_MAX_LENGTH || !CODE_PATTERN.test(value)) {
    throw new CrmValidationError(
      'INVALID_CUSTOMER_CODE',
      `Mã khách hàng tối đa ${CUSTOMER_CODE_MAX_LENGTH} ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.`,
    );
  }
  return value;
}
