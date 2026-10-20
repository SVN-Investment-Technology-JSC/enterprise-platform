import type { Paint } from './model.js';

export interface PaletteToken {
  /** Khoá ổn định dùng trong icon, ví dụ `sapphire`; icon lưu `brand:<key>`. */
  readonly key: string;
  readonly label: string;
  readonly hex: string;
}

export interface BrandPalette {
  readonly tokens: readonly PaletteToken[];
}

export type ColorMode = 'currentColor' | 'brand';

/** Bảng màu mặc định (chưa phải bảng màu chính thức của SVNDTS; chỉnh được ở trang Bảng màu & quy chuẩn). */
export const DEFAULT_PALETTE: BrandPalette = {
  tokens: [
    { key: 'sapphire', label: 'Xanh Sapphire', hex: '#2563eb' },
    { key: 'navy', label: 'Xanh đen', hex: '#09192e' },
    { key: 'emerald', label: 'Xanh ngọc', hex: '#10b981' },
    { key: 'amber', label: 'Vàng hổ phách', hex: '#f59e0b' },
    { key: 'crimson', label: 'Đỏ thẫm', hex: '#ef4444' },
    { key: 'violet', label: 'Tím', hex: '#8b5cf6' },
    { key: 'slate', label: 'Xám kim loại', hex: '#64748b' },
  ],
};

const BRAND_PREFIX = 'brand:';
export const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const brandPaint = (key: string): Paint => `${BRAND_PREFIX}${key}`;
export const isBrandPaint = (paint: Paint): boolean => paint.startsWith(BRAND_PREFIX);
export const brandKeyOf = (paint: Paint): string | null => (isBrandPaint(paint) ? paint.slice(BRAND_PREFIX.length) : null);

export function normalizeHex(value: string): string | null {
  const text = value.trim();
  if (!HEX_PATTERN.test(text)) return null;
  if (text.length === 4) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  return text.toLowerCase();
}

/** Màu thật của một paint trong chế độ xuất `brand`; trả null nếu paint là none hoặc currentColor. */
export function resolveBrandHex(paint: Paint, palette: BrandPalette): string | null {
  const key = brandKeyOf(paint);
  if (key !== null) return palette.tokens.find((token) => token.key === key)?.hex ?? '#000000';
  return normalizeHex(paint);
}

/** Giá trị thuộc tính SVG cho một paint theo chế độ xuất. */
export function resolvePaint(paint: Paint, mode: ColorMode, palette: BrandPalette): string {
  if (paint === 'none' || paint === '') return 'none';
  if (mode === 'currentColor') return 'currentColor';
  if (paint === 'currentColor') return 'currentColor';
  return resolveBrandHex(paint, palette) ?? 'currentColor';
}

/** Màu để hiển thị trên canvas: trong chế độ `currentColor` mọi màu có hiển thị đều lấy theo `inkColor`. */
export function displayPaint(paint: Paint, mode: ColorMode, palette: BrandPalette, inkColor: string): string {
  const resolved = resolvePaint(paint, mode, palette);
  return resolved === 'currentColor' ? inkColor : resolved;
}

export function normalizePalette(raw: unknown): BrandPalette {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { tokens?: unknown }).tokens)) {
    return DEFAULT_PALETTE;
  }
  const seen = new Set<string>();
  const tokens: PaletteToken[] = [];
  for (const entry of (raw as { tokens: unknown[] }).tokens.slice(0, 64)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    const hex = typeof item.hex === 'string' ? normalizeHex(item.hex) : null;
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(key) || !hex || seen.has(key)) continue;
    seen.add(key);
    tokens.push({ key, label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 40) : key, hex });
  }
  return tokens.length > 0 ? { tokens } : DEFAULT_PALETTE;
}
