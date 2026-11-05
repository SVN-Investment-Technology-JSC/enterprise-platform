import {
  QUOTE_ADJUSTMENT_MODES,
  QUOTE_ADJUSTMENT_MODE_LABELS,
  type QuoteAdjustmentMode,
} from '@enterprise-platform/contracts-crm';

/** Giải thích hai chế độ chiết khấu, thuế của mẫu báo giá (Q-P2-8). */
export const ADJUSTMENT_MODE_HELP: Readonly<
  Record<QuoteAdjustmentMode, string>
> = {
  LINE: 'Theo dòng: chiết khấu hoặc thuế tính trên từng dòng hàng rồi cộng lại.',
  ORDER:
    'Theo tổng đơn: nhập một lần cho cả báo giá, tính trên tổng tiền hàng; dòng hàng không tính thêm nên không bị tính trùng.',
};

export const adjustmentModeOptions = QUOTE_ADJUSTMENT_MODES.map((mode) => ({
  value: mode,
  label: QUOTE_ADJUSTMENT_MODE_LABELS[mode],
}));

/** Các token dùng được trong mẫu mã, kèm ý nghĩa (hiện ở hộp hướng dẫn). */
export const QUOTE_CODE_TOKENS: readonly { token: string; meaning: string }[] =
  [
    { token: '{yyyymmdd}', meaning: 'Ngày lập đủ năm, tháng, ngày (20261102)' },
    { token: '{yyyy}', meaning: 'Năm 4 chữ số (2026)' },
    { token: '{yy}', meaning: 'Năm 2 chữ số (26)' },
    { token: '{mm}', meaning: 'Tháng 2 chữ số (11)' },
    { token: '{dd}', meaning: 'Ngày 2 chữ số (02)' },
    { token: '{seq}', meaning: 'Số thứ tự tự tăng, bắt buộc có đúng một' },
    {
      token: '{seq:N}',
      meaning: 'Số thứ tự đệm số 0 đủ N chữ số, ví dụ {seq:4} cho 0383',
    },
  ];

const TOKEN_RE = /\{([a-z]+)(?::(\d{1,2}))?\}/g;
const LITERAL_RE = /^[A-Za-z0-9/._-]*$/;

/** Lỗi nhập mẫu mã (tiếng Việt) hoặc undefined nếu hợp lệ; mẫu rỗng nghĩa là dùng mã mặc định. */
export function quoteCodePatternError(pattern: string): string | undefined {
  const value = pattern.trim();
  if (!value) return undefined;
  if (value.length > 60) return 'Mẫu mã tối đa 60 ký tự.';
  let seqCount = 0;
  for (const match of value.matchAll(TOKEN_RE)) {
    const [, name, width] = match;
    if (name === 'seq') {
      seqCount += 1;
      if (width !== undefined && (Number(width) < 1 || Number(width) > 12))
        return 'Số chữ số của {seq:N} phải từ 1 đến 12.';
    } else if (
      !['yyyymmdd', 'yyyy', 'yy', 'mm', 'dd'].includes(name) ||
      width !== undefined
    ) {
      return `Token {${name}} không hợp lệ.`;
    }
  }
  if (seqCount !== 1) return 'Mẫu mã phải có đúng một {seq}.';
  if (!LITERAL_RE.test(value.replace(TOKEN_RE, '')))
    return 'Phần chữ chỉ gồm chữ không dấu, số và các ký tự / . _ -.';
  return undefined;
}

/** Mã minh hoạ ở máy người dùng; số thứ tự chỉ là ví dụ, mã thật do server cấp. */
export function previewQuoteCode(
  pattern: string,
  now: Date = new Date(),
  seq = 383,
): string | undefined {
  if (!pattern.trim() || quoteCodePatternError(pattern)) return undefined;
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return pattern
    .trim()
    .replace(TOKEN_RE, (_all, name: string, width?: string) => {
      if (name === 'yyyymmdd') return `${yyyy}${mm}${dd}`;
      if (name === 'yyyy') return yyyy;
      if (name === 'yy') return yyyy.slice(2);
      if (name === 'mm') return mm;
      if (name === 'dd') return dd;
      return String(seq).padStart(width ? Number(width) : 0, '0');
    });
}

/** Lỗi nhập mẫu hoặc loại báo giá. */
export function quoteFormNameError(
  name: string,
  sortOrder: string,
  label: 'mẫu' | 'loại',
): string | undefined {
  if (!name.trim()) return `Vui lòng nhập tên ${label} báo giá.`;
  if (sortOrder.trim() !== '' && !/^\d{1,6}$/.test(sortOrder.trim()))
    return 'Thứ tự phải là số nguyên không âm.';
  return undefined;
}

/** Mặc định đứng đầu, rồi đang dùng, rồi theo thứ tự và tên. */
export function sortQuoteForms<
  T extends {
    isDefault: boolean;
    active: boolean;
    sortOrder: number;
    name: string;
  },
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(b.active) - Number(a.active) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, 'vi'),
  );
}

/** Lựa chọn của trường danh sách: mỗi dòng một giá trị, bỏ dòng trống và trùng. */
export function parseFieldOptions(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

/** Lỗi nhập một trường tuỳ biến. */
export function customFieldError(input: {
  name: string;
  fieldType: string;
  optionsText: string;
  sortOrder: string;
}): string | undefined {
  if (!input.name.trim()) return 'Vui lòng nhập tên trường.';
  if (input.sortOrder.trim() !== '' && !/^\d{1,6}$/.test(input.sortOrder.trim()))
    return 'Thứ tự phải là số nguyên không âm.';
  if (input.fieldType === 'SELECT') {
    const options = parseFieldOptions(input.optionsText);
    if (!options.length) return 'Trường danh sách cần ít nhất một lựa chọn.';
    if (options.length > 100) return 'Tối đa 100 lựa chọn.';
  }
  return undefined;
}
