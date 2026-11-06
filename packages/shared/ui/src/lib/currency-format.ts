/**
 * Định dạng tiền và số theo chuẩn Việt Nam: dấu `.` ngăn hàng nghìn, dấu `,` ngăn phần thập phân
 * (ví dụ `500.000.000,01`). Dữ liệu lưu và gửi lên server luôn là số chuẩn `500000000.01`.
 */

const CANONICAL_NUMBER = /^-?\d+(\.\d+)?$/;
const VN_GROUPED_INTEGER = /^\d{1,3}(\.\d{3})+$/;

/**
 * Đọc chuỗi người dùng gõ hoặc từ Excel thành số. Trả `null` nếu không hợp lệ.
 * - Có cả `.` và `,`: dấu xuất hiện cuối cùng là dấu thập phân.
 * - Chỉ có `,`: dấu thập phân.
 * - Chỉ có `.`: ngăn nghìn nếu đúng mẫu `1.500`, `1.234.567`; ngược lại là thập phân (`500000000.01`, `1.5`).
 * Ô Excel đã là số thì nên dùng thẳng, không đi qua hàm này.
 */
export function parseVnNumber(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  let value = text.trim();
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/[\s₫đ]|vnd/gi, '');
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  }
  if (!value || !/^[\d.,]+$/.test(value) || !/\d/.test(value)) return null;

  const hasDot = value.includes('.');
  const hasComma = value.includes(',');
  let normalized: string;
  if (hasDot && hasComma) {
    const decimalSeparator = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
    const groupSeparator = decimalSeparator === ',' ? '.' : ',';
    if (value.split(decimalSeparator).length !== 2) return null;
    normalized = value.split(groupSeparator).join('').replace(decimalSeparator, '.');
  } else if (hasComma) {
    if (value.split(',').length !== 2) return null;
    normalized = value.replace(',', '.');
  } else if (hasDot) {
    if (VN_GROUPED_INTEGER.test(value)) normalized = value.replace(/\./g, '');
    else if (value.split('.').length === 2) normalized = value;
    else return null;
  } else {
    normalized = value;
  }

  const result = Number(normalized);
  if (!Number.isFinite(result)) return null;
  if (result === 0) return 0;
  return negative ? -result : result;
}

export interface FormatCurrencyVnOptions {
  /** Thêm hậu tố đơn vị. Mặc định false (bảng thường để đơn vị ở tiêu đề cột). */
  showUnit?: boolean;
  /** Mặc định `đ`. */
  unitSymbol?: 'đ' | 'VND';
  /** Số chữ số thập phân tối đa. Mặc định 2 (khớp NUMERIC(15,2)). */
  maxDecimals?: number;
  /** true: luôn đủ số thập phân (500000000 thành "500.000.000,00"). Mặc định false. */
  fixedDecimals?: boolean;
  /** Trả về khi dữ liệu không hợp lệ. Mặc định `—`. */
  fallback?: string;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  // Chuỗi số chuẩn từ API (dấu chấm thập phân) đọc thẳng, không hiểu nhầm `250.500` là hàng nghìn.
  if (CANONICAL_NUMBER.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseVnNumber(trimmed);
}

export function formatCurrencyVn(
  value: number | string | null | undefined,
  options: FormatCurrencyVnOptions = {},
): string {
  const { showUnit = false, unitSymbol = 'đ', maxDecimals = 2, fixedDecimals = false, fallback = '—' } = options;
  const number = toNumber(value);
  if (number === null) return fallback;
  const text = new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: fixedDecimals ? maxDecimals : 0,
    maximumFractionDigits: maxDecimals,
  }).format(number);
  return showUnit ? `${text} ${unitSymbol}` : text;
}

/** Số lượng tồn, xuất, nhập có thể lẻ; tối đa 3 chữ số thập phân. Không có dữ liệu thì là `0`. */
export function formatQuantityVn(
  value: number | string | null | undefined,
  maxDecimals = 3,
  fallback = '0',
): string {
  return formatCurrencyVn(value, { maxDecimals, fallback });
}

export interface VnTypingOptions {
  readonly maxDecimals?: number;
  readonly allowNegative?: boolean;
}

export interface VnTypingResult {
  /** Chuỗi hiển thị trong ô: `500.000.000,01`. */
  readonly display: string;
  /** Giá trị chuẩn đưa ra ngoài: `500000000.01`, hoặc rỗng. */
  readonly canonical: string;
}

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Chuỗi chuẩn `500000000.01` thành chuỗi hiển thị `500.000.000,01`. */
export function canonicalToDisplay(canonical: string): string {
  if (!canonical) return '';
  const negative = canonical.startsWith('-');
  const [integer = '', decimal] = canonical.replace('-', '').split('.');
  return `${negative ? '-' : ''}${groupThousands(integer)}${decimal !== undefined ? `,${decimal}` : ''}`;
}

/**
 * Chuẩn hóa chuỗi đang gõ: bỏ ký tự lạ; `.` người dùng gõ không tính (dấu ngăn nghìn được tự chèn lại);
 * `,` là dấu thập phân. Giữ dấu `,` đang gõ dở ở cuối (`500,`).
 */
export function formatVnWhileTyping(text: string, options: VnTypingOptions = {}): VnTypingResult {
  const { maxDecimals = 2, allowNegative = false } = options;
  const negative = allowNegative && text.trimStart().startsWith('-');
  const body = text.replace(/[^\d,]/g, '');
  const commaIndex = body.indexOf(',');
  const hasComma = commaIndex >= 0 && maxDecimals > 0;
  const rawInteger = (hasComma ? body.slice(0, commaIndex) : body.replace(/,/g, '')).replace(/^0+(?=\d)/, '');
  const decimal = hasComma ? body.slice(commaIndex + 1).replace(/,/g, '').slice(0, maxDecimals) : '';
  if (!rawInteger && !hasComma) {
    return { display: negative ? '-' : '', canonical: '' };
  }
  const integer = rawInteger || '0';
  const sign = negative ? '-' : '';
  const display = `${sign}${groupThousands(integer)}${hasComma ? `,${decimal}` : ''}`;
  const canonical = `${sign}${integer}${decimal ? `.${decimal}` : ''}`;
  return { display, canonical };
}
