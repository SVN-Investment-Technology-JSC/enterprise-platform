import { CrmValidationError } from './crm.error.js';

/**
 * Mã số thuế: 10 chữ số (doanh nghiệp) hoặc `10 chữ số-3 chữ số` (đơn vị phụ
 * thuộc, chi nhánh). Không nhận khoảng trắng ở giữa, chữ cái hay độ dài khác.
 */
const TAX_CODE_PATTERN = /^\d{10}(-\d{3})?$/;

export const INVALID_TAX_CODE_MESSAGE = 'Mã số thuế không đúng định dạng (10 số hoặc 10 số-3 số).';

export function isValidTaxCode(value: string): boolean {
  return TAX_CODE_PATTERN.test(value);
}

/**
 * Chuẩn hoá MST nhập vào: bỏ khoảng trắng hai đầu; rỗng thì trả `null` (khách
 * chưa có MST). Sai định dạng ném 400 tiếng Việt.
 */
export function normalizeTaxCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new CrmValidationError('INVALID_TAX_CODE', INVALID_TAX_CODE_MESSAGE);
  const value = raw.trim();
  if (!value) return null;
  if (!isValidTaxCode(value)) throw new CrmValidationError('INVALID_TAX_CODE', INVALID_TAX_CODE_MESSAGE);
  return value;
}
