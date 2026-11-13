import { brandKeyOf, normalizeHex, resolveBrandHex, type BrandPalette } from './palette';
import { roundTo, type Paint } from './model';

/**
 * Màu chuyển sắc, lưu ngay trong chuỗi `Paint` để không phải đổi schema icon.
 *
 * Tuyến tính: `linear:<góc>[,<t0>,<t1>[,<trải>]]:<điểm màu>`, ví dụ `linear:45:#4cc3ff@0,#0263c9@1`.
 * - Góc theo độ: 0 là từ trái sang phải, 90 là từ trên xuống dưới, 45 là từ góc trên trái xuống góc dưới phải.
 * - Dải màu đặt trên một trục chạy qua tâm khung vẽ theo hướng của góc, dài vừa đủ để hai góc khung ứng với 0 và 1.
 *   `t0`, `t1` (mặc định 0 và 1) là vị trí của điểm màu đầu và cuối trên trục đó; ngoài khoảng này dải màu được kéo dài
 *   (`pad`), phản chiếu (`reflect`) hoặc lặp (`repeat`).
 *
 * Hướng tâm: `radial:<cx>,<cy>,<r>,<fx>,<fy>,<m0>,<m1>,<m2>,<m3>,<m4>,<m5>[,<trải>]:<điểm màu>`. Tâm, bán kính và tiêu điểm
 * nằm trong hệ toạ độ riêng của dải màu; ma trận m0..m5 đưa hệ đó sang toạ độ khung vẽ tính theo tỷ lệ cạnh khung (nên dải
 * màu co theo khi đổi cỡ lưới).
 *
 * Điểm màu: `<màu>@<vị trí>[~<độ đặc>]`; màu là mã hex `#rrggbb` hoặc `brand:<khoá>` (theo bảng màu thương hiệu), vị trí từ 0
 * đến 1 và tăng dần, độ đặc từ 0 đến 1 (mặc định 1).
 *
 * Dải màu gắn với khung vẽ chứ không với từng lớp hình: di chuyển lớp không làm dải màu trôi theo.
 */

export interface GradientStop {
  /** Mã hex `#rrggbb` hoặc `brand:<khoá>`. */
  readonly color: Paint;
  /** Vị trí trên dải màu, từ 0 đến 1. */
  readonly offset: number;
  /** Độ đặc của điểm màu, từ 0 đến 1; vắng mặt là 1. */
  readonly opacity?: number;
}

export type GradientSpread = 'pad' | 'reflect' | 'repeat';
export type Matrix6 = readonly [number, number, number, number, number, number];

export interface LinearGradient {
  readonly kind: 'linear';
  readonly angle: number;
  readonly t0: number;
  readonly t1: number;
  readonly spread: GradientSpread;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradient {
  readonly kind: 'radial';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx: number;
  readonly fy: number;
  /** Từ hệ toạ độ của dải màu sang toạ độ khung vẽ tính theo tỷ lệ cạnh khung. */
  readonly matrix: Matrix6;
  readonly spread: GradientSpread;
  readonly stops: readonly GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient;

export const LINEAR_PREFIX = 'linear:';
export const RADIAL_PREFIX = 'radial:';
/** Giữ tên cũ: tiền tố của dải màu tuyến tính. */
export const GRADIENT_PREFIX = LINEAR_PREFIX;
export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 32;
export const DEFAULT_GRADIENT_ANGLE = 45;
export const IDENTITY_MATRIX6: Matrix6 = [1, 0, 0, 1, 0, 0];

const BRAND_COLOR = /^brand:[a-z0-9][a-z0-9-]{0,31}$/;

export const isGradientPaint = (paint: Paint): boolean => paint.startsWith(LINEAR_PREFIX) || paint.startsWith(RADIAL_PREFIX);

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

interface StopInput {
  readonly color: string;
  readonly offset: number;
  readonly opacity?: number;
}

/** Điểm màu sạch: màu chuẩn hoá, vị trí kẹp 0..1 và làm tròn, sắp tăng dần. Null nếu có điểm sai hoặc số điểm ngoài khoảng cho phép. */
function cleanStops(stops: ReadonlyArray<StopInput>): GradientStop[] | null {
  if (stops.length < MIN_GRADIENT_STOPS || stops.length > MAX_GRADIENT_STOPS) return null;
  const clean: GradientStop[] = [];
  for (const stop of stops) {
    const color = normalizeStopColor(stop.color);
    if (!color || !Number.isFinite(stop.offset)) return null;
    if (stop.opacity !== undefined && !Number.isFinite(stop.opacity)) return null;
    const opacity = stop.opacity === undefined ? 1 : roundTo(clamp01(stop.opacity), 3);
    clean.push({ color, offset: roundTo(clamp01(stop.offset), 3), ...(opacity < 1 ? { opacity } : {}) });
  }
  return clean.sort((left, right) => left.offset - right.offset);
}

const formatStops = (stops: readonly GradientStop[]): string =>
  stops.map((stop) => `${stop.color}@${stop.offset}${stop.opacity !== undefined && stop.opacity < 1 ? `~${stop.opacity}` : ''}`).join(',');

const SPREADS: readonly string[] = ['pad', 'reflect', 'repeat'];
const spreadOf = (value: string | undefined): GradientSpread | null =>
  value === undefined || value === '' ? 'pad' : SPREADS.includes(value) ? (value as GradientSpread) : null;

const num = (value: number) => String(roundTo(value, 5) || 0);
const matrixNum = (value: number) => String(roundTo(value, 9) || 0);

/** Dựng chuỗi paint tuyến tính từ góc và các điểm màu; null nếu có điểm sai hoặc số điểm ngoài khoảng cho phép. */
export function formatGradient(angle: number, stops: ReadonlyArray<StopInput>): Paint | null {
  return formatGradientObject({ kind: 'linear', angle, t0: 0, t1: 1, spread: 'pad', stops: stops as readonly GradientStop[] });
}

/** Dựng chuỗi paint từ một dải màu (tuyến tính hay hướng tâm); null nếu dữ liệu sai. */
export function formatGradientObject(gradient: Gradient): Paint | null {
  const stops = cleanStops(gradient.stops);
  if (!stops) return null;
  const spread = gradient.spread === 'pad' ? '' : `,${gradient.spread}`;
  if (gradient.kind === 'linear') {
    if (!Number.isFinite(gradient.t0) || !Number.isFinite(gradient.t1)) return null;
    const range = gradient.t0 === 0 && gradient.t1 === 1 && gradient.spread === 'pad' ? '' : `,${num(gradient.t0)},${num(gradient.t1)}${spread}`;
    return `${LINEAR_PREFIX}${normalizeAngle(gradient.angle)}${range}:${formatStops(stops)}`;
  }
  const numbers = [gradient.cx, gradient.cy, gradient.r, gradient.fx, gradient.fy, ...gradient.matrix];
  if (numbers.some((value) => !Number.isFinite(value)) || gradient.r <= 0) return null;
  const text = [...numbers.slice(0, 5).map(num), ...gradient.matrix.map(matrixNum)];
  return `${RADIAL_PREFIX}${text.join(',')}${spread}:${formatStops(stops)}`;
}

function parseStops(text: string): GradientStop[] | null {
  const raw: StopInput[] = [];
  for (const part of text.split(',')) {
    const at = part.lastIndexOf('@');
    if (at <= 0) return null;
    const [offset, opacity, extra] = part.slice(at + 1).split('~');
    if (extra !== undefined) return null;
    raw.push({ color: part.slice(0, at), offset: Number(offset), ...(opacity !== undefined ? { opacity: Number(opacity) } : {}) });
  }
  return cleanStops(raw);
}

/** Đọc chuỗi paint gradient; trả null nếu sai định dạng. Kết quả đã chuẩn hoá (hex chữ thường, vị trí tăng dần). */
export function parseGradient(paint: Paint): Gradient | null {
  const kind = paint.startsWith(LINEAR_PREFIX) ? 'linear' : paint.startsWith(RADIAL_PREFIX) ? 'radial' : null;
  if (!kind) return null;
  const body = paint.slice(kind === 'linear' ? LINEAR_PREFIX.length : RADIAL_PREFIX.length);
  const split = body.indexOf(':');
  if (split <= 0) return null;
  const head = body.slice(0, split).split(',');
  const stops = parseStops(body.slice(split + 1));
  if (!stops) return null;

  if (kind === 'linear') {
    const [angle, t0, t1, spread, ...rest] = head;
    const parsedSpread = spreadOf(spread);
    const numbers = [angle, t0 ?? '0', t1 ?? '1'].map(Number);
    if ((t0 === undefined) !== (t1 === undefined)) return null;
    if (rest.length > 0 || !parsedSpread || numbers.some((value) => !Number.isFinite(value))) return null;
    return { kind: 'linear', angle: normalizeAngle(numbers[0]), t0: numbers[1], t1: numbers[2], spread: parsedSpread, stops };
  }

  if (head.length !== 11 && head.length !== 12) return null;
  const numbers = head.slice(0, 11).map(Number);
  const spread = spreadOf(head[11]);
  if (!spread || numbers.some((value) => !Number.isFinite(value)) || numbers[2] <= 0) return null;
  const [cx, cy, r, fx, fy, ...matrix] = numbers;
  return { kind: 'radial', cx, cy, r, fx, fy, matrix: matrix as unknown as Matrix6, spread, stops };
}

/** Chuẩn hoá một giá trị paint gradient để lưu; null nếu không hợp lệ. */
export function normalizeGradientPaint(value: string): Paint | null {
  const gradient = parseGradient(value);
  return gradient ? formatGradientObject(gradient) : null;
}

/** Giữ nguyên dải màu nhưng thay các điểm màu (sửa màu, vị trí, thêm bớt điểm). */
export function withStops(gradient: Gradient, stops: readonly GradientStop[]): Gradient {
  return { ...gradient, stops };
}

/**
 * Hai đầu của dải tuyến tính theo toạ độ lưới `size`, để đặt `x1 y1 x2 y2` (userSpaceOnUse). Trục đi qua tâm khung theo
 * hướng của góc và dài vừa đủ để hai góc khung đối diện ứng với 0 và 1 (góc 45 là đường chéo (0,0) tới (size,size)); `t0`, `t1`
 * là vị trí của điểm màu đầu và cuối trên trục.
 */
export function gradientAxis(angle: number, size: number, t0 = 0, t1 = 1): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (normalizeAngle(angle) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const half = ((Math.abs(cos) + Math.abs(sin)) * size) / 2;
  const centre = size / 2;
  const at = (t: number) => ({ x: centre + cos * half * (2 * t - 1), y: centre + sin * half * (2 * t - 1) });
  const from = at(t0);
  const to = at(t1);
  return {
    x1: roundTo(from.x, 5) || 0,
    y1: roundTo(from.y, 5) || 0,
    x2: roundTo(to.x, 5) || 0,
    y2: roundTo(to.y, 5) || 0,
  };
}

/** Ma trận `gradientTransform` (toạ độ lưới) của dải hướng tâm trên lưới `size`. */
export function radialGridMatrix(matrix: Matrix6, size: number): Matrix6 {
  return matrix.map((value) => roundTo(value * size, 5)) as unknown as Matrix6;
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
