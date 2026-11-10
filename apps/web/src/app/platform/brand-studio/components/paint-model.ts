import {
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  DEFAULT_GRADIENT_ANGLE,
  brandKeyOf,
  colorAtOffset,
  formatGradient,
  isGradientPaint,
  isPaintNone,
  mixHex,
  normalizeAngle,
  normalizeHex,
  parseGradient,
  resolveBrandHex,
  stopHex,
  type BrandPalette,
  type LinearGradient,
  type Paint,
  type PaletteToken,
} from '@enterprise-platform/shared-brand-icon';

export type PaintKind = 'none' | 'context' | 'brand' | 'custom' | 'gradient';

export interface PaintDescription {
  readonly kind: PaintKind;
  /** Chữ ngắn hiện trên nút chọn màu. */
  readonly label: string;
  /** Màu để vẽ ô mẫu; `null` với `none`, `currentColor` và gradient. */
  readonly hex: string | null;
  readonly token?: PaletteToken;
  /** Có khi `kind` là `gradient`. */
  readonly gradient?: LinearGradient;
}

export const NONE_LABEL = 'Không';
export const CONTEXT_LABEL = 'Theo chữ';
export const GRADIENT_LABEL = 'Chuyển sắc';

/** Mô tả một giá trị màu để vẽ ô mẫu và nhãn. */
export function describePaint(paint: Paint, palette: BrandPalette): PaintDescription {
  if (isPaintNone(paint)) return { kind: 'none', label: NONE_LABEL, hex: null };
  if (paint === 'currentColor') return { kind: 'context', label: CONTEXT_LABEL, hex: null };
  if (isGradientPaint(paint)) {
    const gradient = parseGradient(paint);
    return gradient
      ? { kind: 'gradient', label: GRADIENT_LABEL, hex: null, gradient }
      : { kind: 'custom', label: 'Màu không hợp lệ', hex: null };
  }

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

/** Chuỗi CSS `linear-gradient(...)` để vẽ ô mẫu và thanh xem trước; góc của Studio 0 là sang phải, CSS 90deg là sang phải. */
export function gradientCss(gradient: LinearGradient, palette: BrandPalette): string {
  const stops = gradient.stops.map((stop) => `${stopHex(stop.color, palette)} ${Math.round(stop.offset * 1000) / 10}%`);
  return `linear-gradient(${normalizeAngle(gradient.angle + 90)}deg, ${stops.join(', ')})`;
}

/** Chuyển một màu bất kỳ thành gradient 2 điểm: màu hiện tại sang bản đậm hơn của nó (không có màu thì lấy màu đầu bảng). */
export function toGradient(paint: Paint, palette: BrandPalette): Paint {
  if (isGradientPaint(paint) && parseGradient(paint)) return paint;
  const usable = !isPaintNone(paint) && paint !== 'currentColor' && resolveBrandHex(paint, palette) !== null;
  const start: Paint = usable ? paint : palette.tokens[0] ? `brand:${palette.tokens[0].key}` : '#2563eb';
  const startHex = stopHex(start, palette);
  return (
    formatGradient(DEFAULT_GRADIENT_ANGLE, [
      { color: start, offset: 0 },
      { color: mixHex(startHex, '#000000', 0.35), offset: 1 },
    ]) ?? paint
  );
}

type GradientEdit = (gradient: LinearGradient) => LinearGradient | null;

function editGradient(paint: Paint, edit: GradientEdit): Paint {
  const gradient = parseGradient(paint);
  if (!gradient) return paint;
  const next = edit(gradient);
  return next ? (formatGradient(next.angle, next.stops) ?? paint) : paint;
}

export const setGradientAngle = (paint: Paint, angle: number): Paint =>
  editGradient(paint, (gradient) => (Number.isFinite(angle) ? { ...gradient, angle: normalizeAngle(angle) } : null));

export const setStopColor = (paint: Paint, index: number, color: Paint): Paint =>
  editGradient(paint, (gradient) =>
    index < 0 || index >= gradient.stops.length
      ? null
      : { ...gradient, stops: gradient.stops.map((stop, at) => (at === index ? { ...stop, color } : stop)) },
  );

/** Đổi vị trí một điểm màu; kẹp giữa hai điểm kề bên để thứ tự không đổi (nên chỉ số điểm đang chọn vẫn đúng). */
export const setStopOffset = (paint: Paint, index: number, offset: number): Paint =>
  editGradient(paint, (gradient) => {
    if (index < 0 || index >= gradient.stops.length || !Number.isFinite(offset)) return null;
    const low = index > 0 ? gradient.stops[index - 1].offset : 0;
    const high = index < gradient.stops.length - 1 ? gradient.stops[index + 1].offset : 1;
    const clamped = Math.min(high, Math.max(low, offset));
    return { ...gradient, stops: gradient.stops.map((stop, at) => (at === index ? { ...stop, offset: clamped } : stop)) };
  });

/** Thêm một điểm màu vào giữa khoảng trống rộng nhất, màu lấy theo dải hiện tại. Trả về chỉ số điểm mới. */
export function addGradientStop(paint: Paint, palette: BrandPalette): { paint: Paint; index: number } | null {
  const gradient = parseGradient(paint);
  if (!gradient || gradient.stops.length >= MAX_GRADIENT_STOPS) return null;
  const resolved = gradient.stops.map((stop) => ({ color: stopHex(stop.color, palette), offset: stop.offset }));
  let at = 1;
  let widest = -1;
  for (let index = 1; index < resolved.length; index += 1) {
    const gap = resolved[index].offset - resolved[index - 1].offset;
    if (gap > widest) {
      widest = gap;
      at = index;
    }
  }
  const offset = (resolved[at].offset + resolved[at - 1].offset) / 2;
  const stops = [...gradient.stops];
  stops.splice(at, 0, { color: colorAtOffset(resolved, offset), offset });
  const next = formatGradient(gradient.angle, stops);
  return next ? { paint: next, index: at } : null;
}

export function removeGradientStop(paint: Paint, index: number): Paint {
  return editGradient(paint, (gradient) =>
    gradient.stops.length <= MIN_GRADIENT_STOPS || index < 0 || index >= gradient.stops.length
      ? null
      : { ...gradient, stops: gradient.stops.filter((_, at) => at !== index) },
  );
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
