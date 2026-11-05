import { QUOTE_CODE_PATTERN_HELP } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Mã báo giá theo mẫu cấu hình (GĐI, P2I-05). Mẫu lưu ở `crm_schema.settings` khoá `quote.code`.
 *
 * Ví dụ `{yyyymmdd}/BG//{seq}` cho `20261102/BG//383`. Không có mẫu thì mã vẫn là `BG<yy><5 chữ số>` từ
 * `quote_code_seq` (xem `formatQuoteCode`); mã cũ dạng đó luôn hợp lệ.
 */
export const QUOTE_CODE_SETTING_KEY = 'quote.code';
/** Khớp `quotes.code VARCHAR(30)`. */
export const QUOTE_CODE_MAX_LENGTH = 30;

const TOKEN = /\{(yyyymmdd|yyyy|yy|mm|dd|seq(?::[1-9])?)\}/g;
const LITERAL = /^[A-Za-z0-9/._-]*$/;
/** Mã người dùng tự nhập. */
const CODE_PATTERN = /^[A-Za-z0-9/._-]+$/;

export interface QuoteCodeDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Kiểm mẫu do quản trị nhập; trả bản đã bỏ khoảng trắng hai đầu. Rỗng là bỏ mẫu (trả `null`). */
export function normalizeQuoteCodePattern(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid('Mẫu mã báo giá không hợp lệ.');
  const pattern = value.trim();
  if (!pattern) return null;
  const literals = pattern.replace(TOKEN, '');
  if (!LITERAL.test(literals)) throw invalid(`Mẫu mã báo giá có ký tự không hợp lệ. ${QUOTE_CODE_PATTERN_HELP}`);
  const sequences = pattern.match(/\{seq(?::[1-9])?\}/g) ?? [];
  if (sequences.length !== 1) throw invalid(`Mẫu mã báo giá phải có đúng một {seq}. ${QUOTE_CODE_PATTERN_HELP}`);
  // Số thứ tự dài nhất (9 chữ số) vẫn phải vừa cột mã.
  const longest = formatQuoteCodePattern(pattern, { year: 2026, month: 12, day: 31 }, 999_999_999);
  if (longest.length > QUOTE_CODE_MAX_LENGTH) {
    throw invalid(`Mã báo giá sinh ra tối đa ${QUOTE_CODE_MAX_LENGTH} ký tự; hãy rút gọn mẫu.`);
  }
  return pattern;
}

function invalid(message: string): CrmValidationError {
  return new CrmValidationError('INVALID_QUOTE_CODE_PATTERN', message);
}

/** Đọc mẫu đã lưu; giá trị hỏng (sửa tay DB) thì coi như chưa cấu hình. */
export function parseQuoteCodePattern(value: unknown): string | null {
  try {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return normalizeQuoteCodePattern(record['pattern']);
  } catch {
    return null;
  }
}

/** Mã từ mẫu, ngày (giờ Việt Nam) và số thứ tự; số vượt độ đệm thì giữ đủ chữ số. */
export function formatQuoteCodePattern(pattern: string, date: QuoteCodeDate, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Invalid quote code sequence: ${sequence}.`);
  const two = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(date.year).padStart(4, '0');
  return pattern.replace(TOKEN, (_match, token: string) => {
    if (token === 'yyyymmdd') return `${yyyy}${two(date.month)}${two(date.day)}`;
    if (token === 'yyyy') return yyyy;
    if (token === 'yy') return two(date.year % 100);
    if (token === 'mm') return two(date.month);
    if (token === 'dd') return two(date.day);
    const width = token.includes(':') ? Number(token.split(':')[1]) : 1;
    return String(sequence).padStart(width, '0');
  });
}

/** Mã người dùng tự nhập: bỏ khoảng trắng hai đầu; rỗng trả `null` (để hệ thống sinh). */
export function normalizeManualQuoteCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CrmValidationError('INVALID_QUOTE_CODE', 'Mã báo giá không hợp lệ.');
  const code = value.trim();
  if (!code) return null;
  if (code.length > QUOTE_CODE_MAX_LENGTH || !CODE_PATTERN.test(code)) {
    throw new CrmValidationError(
      'INVALID_QUOTE_CODE',
      `Mã báo giá tối đa ${QUOTE_CODE_MAX_LENGTH} ký tự, chỉ gồm chữ không dấu, số, / . _ -.`,
    );
  }
  return code;
}
