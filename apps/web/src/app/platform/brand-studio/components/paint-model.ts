import {
  brandKeyOf,
  isPaintNone,
  normalizeHex,
  resolveBrandHex,
  type BrandPalette,
  type Paint,
  type PaletteToken,
} from '@enterprise-platform/shared-brand-icon';

export type PaintKind = 'none' | 'context' | 'brand' | 'custom';

export interface PaintDescription {
  readonly kind: PaintKind;
  /** Chữ ngắn hiện trên nút chọn màu. */
  readonly label: string;
  /** Màu để vẽ ô mẫu; `null` với `none` và `currentColor`. */
  readonly hex: string | null;
  readonly token?: PaletteToken;
}

export const NONE_LABEL = 'Không';
export const CONTEXT_LABEL = 'Theo chữ';

/** Mô tả một giá trị màu để vẽ ô mẫu và nhãn. */
export function describePaint(paint: Paint, palette: BrandPalette): PaintDescription {
  if (isPaintNone(paint)) return { kind: 'none', label: NONE_LABEL, hex: null };
  if (paint === 'currentColor') return { kind: 'context', label: CONTEXT_LABEL, hex: null };

  const key = brandKeyOf(paint);
  if (key !== null) {
    const token = palette.tokens.find((item) => item.key === key);
    return token
      ? { kind: 'brand', label: token.label, hex: token.hex, token }
      : { kind: 'brand', label: `Thiếu màu ${key}`, hex: resolveBrandHex(paint, palette) };
  }

  const hex = normalizeHex(paint);
  return { kind: 'custom', label: (hex ?? paint).toUpperCase(), hex };
}

/** Giá trị cho `<input type="color">`, luôn là `#rrggbb`. */
export function colorInputValue(paint: Paint, palette: BrandPalette): string {
  return describePaint(paint, palette).hex ?? '#000000';
}

/** Đọc mã hex người dùng gõ (có hoặc không có `#`, 3 hoặc 6 chữ số); trả `#rrggbb` hoặc `null`. */
export function parseHexInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return normalizeHex(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
}

export interface AnchorRect {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PopoverPlacement {
  readonly left: number;
  readonly top: number;
  readonly placement: 'below' | 'above';
}

/**
 * Vị trí hộp chọn màu so với nút mở: mặc định bên dưới, lật lên trên nếu dưới không đủ chỗ mà trên vừa,
 * luôn nằm trong cửa sổ với khoảng chừa `margin`.
 */
export function placePopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): PopoverPlacement {
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin));
  const below = anchor.bottom + gap;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const above = anchor.top - gap - size.height;
  if (!fitsBelow && above >= margin) return { left, top: above, placement: 'above' };
  return { left, top: Math.max(margin, Math.min(below, viewport.height - size.height - margin)), placement: 'below' };
}
