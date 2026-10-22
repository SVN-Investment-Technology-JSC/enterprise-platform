import { normalizeRules, type BrandRules } from '@enterprise-platform/shared-brand-icon';

export type RulesEdit = { readonly ok: true; readonly rules: BrandRules } | { readonly ok: false; readonly error: string };

export const STROKE_MIN = 0.25;
export const STROKE_MAX = 6;
/** Khớp giới hạn của normalizeRules. */
export const MAX_STROKE_WIDTHS = 10;

export type NumericRule = 'safePadding' | 'snapStep' | 'minFeature' | 'maxShapes';

export interface NumericRuleField {
  readonly key: NumericRule;
  readonly label: string;
  readonly hint: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Các quy chuẩn dạng số, theo thứ tự hiện trên màn hình; khoảng giá trị khớp normalizeRules. */
export const NUMERIC_RULES: readonly NumericRuleField[] = [
  { key: 'safePadding', label: 'Khoảng chừa an toàn', hint: 'Từ nét ngoài cùng tới mép lưới', min: 0, max: 6, step: 0.05 },
  { key: 'snapStep', label: 'Bước bắt dính', hint: 'Toạ độ nên chia hết cho bước này', min: 0.05, max: 4, step: 0.05 },
  { key: 'minFeature', label: 'Chi tiết nhỏ nhất', hint: 'Nhỏ hơn thì khó thấy ở cỡ 16px', min: 0, max: 6, step: 0.05 },
  { key: 'maxShapes', label: 'Số lớp tối đa', hint: 'Nhiều hơn sẽ được nhắc gộp bớt', min: 1, max: 100, step: 1 },
];

/** Đọc số người dùng gõ, nhận cả dấu phẩy ("1,75") lẫn dấu chấm; trả null nếu không phải số không âm. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Số hiển thị theo kiểu Việt Nam, tối đa 3 chữ số thập phân: 1.75 thành "1,75". */
export function formatDecimal(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}

export function addStrokeWidth(rules: BrandRules, value: number): RulesEdit {
  if (!Number.isFinite(value) || value < STROKE_MIN || value > STROKE_MAX) {
    return { ok: false, error: `Độ dày nét phải từ ${formatDecimal(STROKE_MIN)} đến ${formatDecimal(STROKE_MAX)}.` };
  }
  const width = Math.round(value * 100) / 100;
  if (rules.allowedStrokeWidths.some((item) => Math.abs(item - width) < 1e-9)) return { ok: false, error: 'Độ dày này đã có.' };
  if (rules.allowedStrokeWidths.length >= MAX_STROKE_WIDTHS) return { ok: false, error: `Tối đa ${MAX_STROKE_WIDTHS} độ dày.` };
  return { ok: true, rules: normalizeRules({ ...rules, allowedStrokeWidths: [...rules.allowedStrokeWidths, width] }) };
}

export function removeStrokeWidth(rules: BrandRules, value: number): RulesEdit {
  if (rules.allowedStrokeWidths.length <= 1) return { ok: false, error: 'Phải giữ ít nhất một độ dày.' };
  return {
    ok: true,
    rules: normalizeRules({ ...rules, allowedStrokeWidths: rules.allowedStrokeWidths.filter((item) => item !== value) }),
  };
}

/** Đặt một quy chuẩn dạng số; giá trị được kẹp vào khoảng cho phép (và làm tròn với số lớp tối đa). */
export function setNumericRule(rules: BrandRules, key: NumericRule, value: number): BrandRules {
  return normalizeRules({ ...rules, [key]: value });
}

export function setRequirePalette(rules: BrandRules, value: boolean): BrandRules {
  return normalizeRules({ ...rules, requirePaletteColors: value });
}
