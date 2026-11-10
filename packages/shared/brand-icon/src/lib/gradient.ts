import { brandKeyOf, normalizeHex, resolveBrandHex, type BrandPalette } from './palette';
import { roundTo, type Paint } from './model';

/**
 * Màu chuyển sắc tuyến tính, lưu ngay trong chuỗi `Paint` để không phải đổi schema icon:
 * `linear:<góc>:<màu>@<vị trí>,<màu>@<vị trí>...`, ví dụ `linear:45:#4cc3ff@0,#0263c9@1`.
 *
 * - Góc theo độ: 0 là từ trái sang phải, 90 là từ trên xuống dưới, 45 là từ góc trên trái xuống góc dưới phải.
 * - Màu mỗi điểm là mã hex `#rrggbb` hoặc `brand:<khoá>` (theo bảng màu thương hiệu).
 * - Vị trí từ 0 đến 1, tăng dần.
 * - Dải màu trải trên cả khung vẽ (từ góc này sang góc kia theo hướng của góc), không theo từng lớp hình.
 */

export interface GradientStop {
  /** Mã hex `#rrggbb` hoặc `brand:<khoá>`. */
  readonly color: Paint;
  /** Vị trí trên dải màu, từ 0 đến 1. */
  readonly offset: number;
}

export interface LinearGradient {
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

export const GRADIENT_PREFIX = 'linear:';
export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 8;
export const DEFAULT_GRADIENT_ANGLE = 45;

const BRAND_COLOR = /^brand:[a-z0-9][a-z0-9-]{0,31}$/;

export const isGradientPaint = (paint: Paint): boolean => paint.startsWith(GRADIENT_PREFIX);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Góc về khoảng [0, 360), làm tròn 2 chữ số thập phân. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_GRADIENT_ANGLE;
  const wrapped = ((angle % 360) + 360) % 360;
  return roundTo(wrapped, 2) % 360;
}

function normalizeStopColor(value: string): string | null {
  const text = value.trim();
  if (BRAND_COLOR.test(text)) return text;
  return normalizeHex(text);
}

/** Điểm màu sạch: màu chuẩn hoá, vị trí kẹp 0..1 và làm tròn, sắp tăng dần. Null nếu có điểm sai hoặc số điểm ngoài 2..8. */
function cleanStops(stops: ReadonlyArray<{ color: string; offset: number }>): GradientStop[] | null {
  if (stops.length < MIN_GRADIENT_STOPS || stops.length > MAX_GRADIENT_STOPS) return null;
  const clean: GradientStop[] = [];
  for (const stop of stops) {
    const color = normalizeStopColor(stop.color);
    if (!color || !Number.isFinite(stop.offset)) return null;
    clean.push({ color, offset: roundTo(clamp01(stop.offset), 3) });
  }
  return clean.sort((left, right) => left.offset - right.offset);
}

/** Dựng chuỗi paint từ góc và các điểm màu; trả null nếu có điểm sai hoặc số điểm ngoài 2..8. */
export function formatGradient(angle: number, stops: ReadonlyArray<{ color: string; offset: number }>): Paint | null {
  const clean = cleanStops(stops);
  if (!clean) return null;
  return `${GRADIENT_PREFIX}${normalizeAngle(angle)}:${clean.map((stop) => `${stop.color}@${stop.offset}`).join(',')}`;
}

/** Đọc chuỗi paint gradient; trả null nếu sai định dạng. Kết quả đã chuẩn hoá (hex chữ thường, vị trí tăng dần). */
export function parseGradient(paint: Paint): LinearGradient | null {
  if (!isGradientPaint(paint)) return null;
  const body = paint.slice(GRADIENT_PREFIX.length);
  const split = body.indexOf(':');
  if (split <= 0) return null;
  const angle = Number(body.slice(0, split));
  if (!Number.isFinite(angle)) return null;
  const raw: Array<{ color: string; offset: number }> = [];
  for (const part of body.slice(split + 1).split(',')) {
    const at = part.lastIndexOf('@');
    if (at <= 0) return null;
    raw.push({ color: part.slice(0, at), offset: Number(part.slice(at + 1)) });
  }
  const stops = cleanStops(raw);
  return stops ? { angle: normalizeAngle(angle), stops } : null;
}

/** Chuẩn hoá một giá trị paint gradient để lưu; null nếu không hợp lệ. */
export function normalizeGradientPaint(value: string): Paint | null {
  const gradient = parseGradient(value);
  return gradient ? formatGradient(gradient.angle, gradient.stops) : null;
}

/**
 * Hai đầu của dải màu theo toạ độ lưới `size`, để đặt `x1 y1 x2 y2` (userSpaceOnUse). Dải đi qua tâm khung theo hướng góc
 * và dài vừa đủ để hai góc khung đối diện ứng với 0 và 1: góc 45 cho đúng đường chéo (0,0) tới (size,size).
 */
export function gradientAxis(angle: number, size: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (normalizeAngle(angle) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const half = ((Math.abs(cos) + Math.abs(sin)) * size) / 2;
  const centre = size / 2;
  return {
    x1: roundTo(centre - cos * half, 3) || 0,
    y1: roundTo(centre - sin * half, 3) || 0,
    x2: roundTo(centre + cos * half, 3) || 0,
    y2: roundTo(centre + sin * half, 3) || 0,
  };
}

/** Màu hex thật của một điểm màu theo bảng màu; khoá lạ ra đen. */
export function stopHex(color: Paint, palette: BrandPalette): string {
  return resolveBrandHex(color, palette) ?? '#000000';
}

/** Mọi màu (hex hoặc `brand:<khoá>`) mà một paint dùng: một màu với paint đơn, mọi điểm màu với gradient. */
export function paintColors(paint: Paint): string[] {
  const gradient = parseGradient(paint);
  if (gradient) return gradient.stops.map((stop) => stop.color);
  return paint === 'none' || paint === '' || paint === 'currentColor' ? [] : [paint];
}

/** Các khoá bảng màu thương hiệu mà một paint đang dùng (kể cả trong điểm màu của gradient). */
export function paintBrandKeys(paint: Paint): string[] {
  return paintColors(paint)
    .map((color) => brandKeyOf(color))
    .filter((key): key is string => key !== null);
}

const toChannels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = (channels: readonly number[]): string =>
  `#${channels.map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;

/** Trộn hai màu hex `#rrggbb`: `amount` 0 ra màu đầu, 1 ra màu sau. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = toChannels(from);
  const b = toChannels(to);
  return toHex(a.map((value, index) => value + (b[index] - value) * clamp01(amount)));
}

/** Màu hex tại vị trí `t` của dải màu (điểm màu đã sắp tăng dần; ngoài hai đầu giữ màu đầu/cuối). */
export function colorAtOffset(stops: ReadonlyArray<{ color: string; offset: number }>, t: number): string {
  if (stops.length === 0) return '#000000';
  if (t <= stops[0].offset) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= last.offset) return last.color;
  for (let index = 1; index < stops.length; index += 1) {
    const next = stops[index];
    if (t <= next.offset) {
      const prev = stops[index - 1];
      const span = next.offset - prev.offset;
      return span <= 1e-9 ? next.color : mixHex(prev.color, next.color, (t - prev.offset) / span);
    }
  }
  return last.color;
}

/** Gradient 2 điểm mặc định xuất phát từ một màu hex: màu đó sang bản đậm hơn, chéo 45 độ. */
export function defaultGradientFrom(startColor: string, endColor?: string): Paint {
  const start = normalizeHex(startColor) ?? '#2563eb';
  const end = endColor && normalizeHex(endColor) ? (normalizeHex(endColor) as string) : mixHex(start, '#000000', 0.35);
  return formatGradient(DEFAULT_GRADIENT_ANGLE, [
    { color: start, offset: 0 },
    { color: end, offset: 1 },
  ]) as Paint;
}
