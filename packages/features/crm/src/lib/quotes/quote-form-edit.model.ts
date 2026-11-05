import {
  QUOTE_FEES_MAX,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type QuoteAdjustmentMode,
  type QuoteFee,
  type QuoteLinkTargetType,
  type QuoteOrderAmountInput,
  type QuoteTemplate,
} from '@enterprise-platform/contracts-crm';

/** Logic thuần của form báo giá theo mẫu (P2I-10, P2I-08, P2I-06): kiểm nhập, dựng yêu cầu gửi server. */

/** Lời tiếng Việt theo mã lỗi của server (dùng khi server không kèm câu hoàn chỉnh). */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  QUOTE_CODE_EXISTS: 'Mã báo giá đã tồn tại. Vui lòng nhập mã khác hoặc bấm "Sinh lại".',
  TEMPLATE_REQUIRED: 'Vui lòng chọn mẫu báo giá.',
  ORDER_AMOUNT_CONFLICT: 'Chỉ nhập theo phần trăm hoặc theo số tiền, không nhập cả hai.',
  ORDER_DISCOUNT_NOT_ALLOWED: 'Mẫu báo giá này tính chiết khấu theo dòng, không nhập chiết khấu tổng đơn.',
  ORDER_TAX_NOT_ALLOWED: 'Mẫu báo giá này tính thuế theo dòng, không nhập thuế tổng đơn.',
  LINE_DISCOUNT_NOT_ALLOWED: 'Mẫu báo giá này tính chiết khấu theo tổng đơn, không ghi đè % chiết khấu theo dòng.',
  CUSTOM_FIELD_REQUIRED: 'Vui lòng nhập đầy đủ các trường tuỳ biến bắt buộc.',
  CUSTOM_FIELD_INVALID: 'Giá trị trường tuỳ biến không hợp lệ.',
};

export function quoteFormErrorMessage(cause: unknown, fallback: string): string {
  const { code, message } = (cause ?? {}) as { code?: string; message?: string };
  if (typeof message === 'string' && message) return message;
  return (code && ERROR_TEXT[code]) || fallback;
}

/** Mẫu quyết định ô nào được nhập: chiết khấu, thuế tổng đơn chỉ khi mẫu có chế độ ORDER. */
export function templateModes(template: Pick<QuoteTemplate, 'discountMode' | 'taxMode'> | undefined): {
  discount: QuoteAdjustmentMode;
  tax: QuoteAdjustmentMode;
} {
  return { discount: template?.discountMode ?? 'LINE', tax: template?.taxMode ?? 'LINE' };
}

export type OrderField = 'percent' | 'amount';
export interface OrderAmountText {
  readonly percent: string;
  readonly amount: string;
}
export const EMPTY_ORDER_AMOUNT: OrderAmountText = { percent: '', amount: '' };

/** Nhập một ô thì ô kia bị xoá (loại trừ); xoá hết ô vừa nhập thì cả hai rỗng. */
export function setOrderAmountField(_current: OrderAmountText, field: OrderField, text: string): OrderAmountText {
  return field === 'percent' ? { percent: text, amount: '' } : { percent: '', amount: text };
}

/** Ô còn lại bị khoá khi một ô đã có giá trị. */
export function lockedOrderField(value: OrderAmountText): OrderField | undefined {
  if (value.percent.trim() !== '') return 'amount';
  if (value.amount.trim() !== '') return 'percent';
  return undefined;
}

/** Chấp nhận `1.000,5`, `1000.5` và `1,5` (dấu phẩy thập phân kiểu Việt). */
export function parseDecimal(text: string): number | undefined {
  const raw = text.trim().replace(/\s/g, '');
  if (!raw) return undefined;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = /^\d{1,3}(,\d{3}){2,}$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.');
  } else {
    normalized = (raw.match(/\./g) ?? []).length > 1 ? raw.replace(/\./g, '') : raw;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** `null` là xoá; lỗi nếu số sai hoặc nhập cả hai ô. */
export function buildOrderAmount(
  value: OrderAmountText,
  label: 'chiết khấu' | 'thuế',
): { ok: true; value: QuoteOrderAmountInput | null } | { ok: false; error: string } {
  const hasPercent = value.percent.trim() !== '';
  const hasAmount = value.amount.trim() !== '';
  if (hasPercent && hasAmount) return { ok: false, error: `Chỉ nhập ${label} theo phần trăm hoặc theo số tiền, không nhập cả hai.` };
  if (!hasPercent && !hasAmount) return { ok: true, value: null };
  if (hasPercent) {
    const percent = parseDecimal(value.percent);
    if (percent === undefined || percent < 0 || percent > 100) return { ok: false, error: `Phần trăm ${label} phải từ 0 đến 100.` };
    return { ok: true, value: { percent } };
  }
  const amount = parseDecimal(value.amount);
  if (amount === undefined || amount < 0) return { ok: false, error: `Số tiền ${label} phải là số không âm.` };
  return { ok: true, value: { amount } };
}

/** Điền ô nhập từ kết quả server: giữ kiểu người dùng đã nhập. */
export function orderAmountText(
  value: { percent: number; amount: number; inputKind: 'PERCENT' | 'AMOUNT' | null } | undefined,
): OrderAmountText {
  if (!value || value.inputKind === null) return EMPTY_ORDER_AMOUNT;
  return value.inputKind === 'PERCENT' ? { percent: String(value.percent), amount: '' } : { percent: '', amount: String(value.amount) };
}

// Khoản phí trên cả hợp đồng
export interface FeeRow {
  readonly key: string;
  readonly feeType: string;
  readonly amount: string;
}

let feeSeq = 0;
export const newFeeRow = (feeType = '', amount = ''): FeeRow => ({ key: `fee-${(feeSeq += 1)}`, feeType, amount });
export const feeRowsOf = (fees: readonly QuoteFee[]): FeeRow[] => fees.map((fee) => newFeeRow(fee.feeType, String(fee.amount)));

export function buildFees(rows: readonly FeeRow[]): { ok: true; fees: QuoteFee[] } | { ok: false; error: string } {
  const fees: QuoteFee[] = [];
  for (const row of rows) {
    if (!row.feeType.trim() && !row.amount.trim()) continue;
    const amount = parseDecimal(row.amount);
    if (amount === undefined || amount < 0) return { ok: false, error: 'Số tiền của khoản phí phải là số không âm.' };
    fees.push({ feeType: row.feeType.trim(), amount });
  }
  if (fees.length > QUOTE_FEES_MAX) return { ok: false, error: `Tối đa ${QUOTE_FEES_MAX} khoản phí.` };
  return { ok: true, fees };
}

// Trường tuỳ biến
export type CustomFieldTexts = Readonly<Record<string, string>>;

export const activeFields = (definitions: readonly CustomFieldDefinition[]): CustomFieldDefinition[] =>
  definitions.filter((field) => field.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));

export function customFieldTexts(values: Readonly<Record<string, CustomFieldValue>> | undefined): CustomFieldTexts {
  return Object.fromEntries(Object.entries(values ?? {}).map(([id, value]) => [id, String(value)]));
}

/** Tên các trường bắt buộc còn trống. */
export function missingRequiredFields(definitions: readonly CustomFieldDefinition[], texts: CustomFieldTexts): string[] {
  return activeFields(definitions)
    .filter((field) => field.required && !(texts[field.id] ?? '').trim())
    .map((field) => field.name);
}

export const requiredFieldsMessage = (names: readonly string[]): string =>
  names.length === 1
    ? `Vui lòng nhập trường "${names[0]}".`
    : `Vui lòng nhập các trường bắt buộc: ${names.map((name) => `"${name}"`).join(', ')}.`;

/** Gửi mọi trường đang dùng: rỗng là `null` (xoá); số lỗi trả về tên trường. */
export function buildCustomFields(
  definitions: readonly CustomFieldDefinition[],
  texts: CustomFieldTexts,
): { ok: true; values: Record<string, CustomFieldValue | null> } | { ok: false; error: string } {
  const values: Record<string, CustomFieldValue | null> = {};
  for (const field of activeFields(definitions)) {
    const text = (texts[field.id] ?? '').trim();
    if (!text) values[field.id] = null;
    else if (field.fieldType === 'NUMBER') {
      const value = parseDecimal(text);
      if (value === undefined) return { ok: false, error: `Trường "${field.name}" phải là số.` };
      values[field.id] = value;
    } else if (field.fieldType === 'SELECT' && !field.options.includes(text)) {
      return { ok: false, error: `Giá trị của trường "${field.name}" không nằm trong danh sách lựa chọn.` };
    } else values[field.id] = text;
  }
  return { ok: true, values };
}

/** Lỗi nhập phần Thông tin chung. */
export function generalInfoError(input: { name: string; code: string; requireCode: boolean }): string | undefined {
  if (!input.name.trim()) return 'Vui lòng nhập tên báo giá.';
  if (input.requireCode && !input.code.trim()) return 'Vui lòng nhập mã báo giá hoặc bấm "Sinh lại".';
  return undefined;
}

/** Liên kết trùng đã có: tránh gửi lên server rồi mới báo lỗi. */
export function hasLink(
  links: readonly { targetType: QuoteLinkTargetType; targetId: string }[],
  targetType: QuoteLinkTargetType,
  targetId: string,
): boolean {
  return links.some((link) => link.targetType === targetType && link.targetId === targetId);
}
