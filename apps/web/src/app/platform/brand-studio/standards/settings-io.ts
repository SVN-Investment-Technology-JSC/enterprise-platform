import {
  DEFAULT_PALETTE,
  normalizePalette,
  normalizeRules,
  type BrandPalette,
  type BrandRules,
} from '@enterprise-platform/shared-brand-icon';

export const SETTINGS_VERSION = 1;

export interface ParsedSettings {
  readonly palette?: BrandPalette;
  readonly rules?: BrandRules;
  /** Số màu trong tệp bị bỏ vì sai mã hoặc trùng khoá. */
  readonly skippedColors: number;
}

/** Cài đặt xuất ra tệp: bảng màu và quy chuẩn, kèm số phiên bản để đổi định dạng về sau. */
export function serializeSettings(palette: BrandPalette, rules: BrandRules): string {
  return JSON.stringify({ version: SETTINGS_VERSION, palette, rules }, null, 2);
}

export function settingsFileName(): string {
  return 'svndts-brand-settings.json';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Đọc tệp cài đặt. Nhận `{ palette, rules }`; cũng nhận tệp chỉ có bảng màu (`{ tokens }`) hoặc chỉ có quy chuẩn.
 * Mọi giá trị đi qua normalizePalette/normalizeRules nên luôn đúng kiểu và nằm trong giới hạn. Lỗi trả bằng Error tiếng Việt.
 */
export function parseSettings(text: string): ParsedSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Tệp không phải JSON hợp lệ.');
  }
  if (!isObject(data)) throw new Error('Tệp không phải cài đặt Brand Studio.');

  const rawPalette = 'palette' in data ? data.palette : 'tokens' in data ? data : undefined;
  const rawRules = 'rules' in data ? data.rules : 'allowedStrokeWidths' in data ? data : undefined;
  if (rawPalette === undefined && rawRules === undefined) throw new Error('Tệp không có bảng màu hay quy chuẩn.');

  let palette: BrandPalette | undefined;
  let skippedColors = 0;
  if (rawPalette !== undefined) {
    const normalized = normalizePalette(rawPalette);
    // normalizePalette trả đúng hằng DEFAULT_PALETTE khi dữ liệu không dùng được; bảng màu hợp lệ luôn là đối tượng mới.
    if (normalized === DEFAULT_PALETTE) throw new Error('Bảng màu trong tệp không hợp lệ.');
    palette = normalized;
    const listed = isObject(rawPalette) && Array.isArray(rawPalette.tokens) ? rawPalette.tokens.length : normalized.tokens.length;
    skippedColors = Math.max(0, listed - normalized.tokens.length);
  }

  let rules: BrandRules | undefined;
  if (rawRules !== undefined) {
    if (!isObject(rawRules)) throw new Error('Quy chuẩn trong tệp không hợp lệ.');
    rules = normalizeRules(rawRules);
  }
  return { palette, rules, skippedColors };
}
