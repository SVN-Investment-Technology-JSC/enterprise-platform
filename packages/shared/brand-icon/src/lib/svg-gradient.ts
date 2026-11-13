import { IDENTITY, multiply, type Matrix } from './geometry';
import {
  MAX_GRADIENT_STOPS,
  formatGradientObject,
  normalizeAngle,
  type GradientSpread,
  type GradientStop,
  type Matrix6,
} from './gradient';
import { parseColor } from './svg-color';
import { parseLength, DEFAULT_FONT_SIZE } from './svg-length';
import type { Rect } from './model';

/** Một điểm màu của dải màu SVG: màu hex thật, vị trí 0..1 và độ đặc đã nhân cả độ đặc của màu. */
export interface SourceStop {
  readonly color: string;
  readonly offset: number;
  readonly opacity: number;
}

/** Dải màu `<linearGradient>`/`<radialGradient>` đã gộp thuộc tính kế thừa qua `href`. */
export interface GradientSource {
  readonly kind: 'linear' | 'radial';
  readonly stops: readonly SourceStop[];
  readonly bbox: boolean;
  readonly transform: Matrix;
  readonly spread: GradientSpread;
  readonly x1: string | null;
  readonly y1: string | null;
  readonly x2: string | null;
  readonly y2: string | null;
  readonly cx: string | null;
  readonly cy: string | null;
  readonly r: string | null;
  readonly fx: string | null;
  readonly fy: string | null;
  readonly fr: string | null;
}

/** Hệ toạ độ mà phần trăm và toạ độ `userSpaceOnUse` của dải màu tính theo: khung nhìn gốc. */
export interface UserViewport {
  readonly width: number;
  readonly height: number;
}

export interface GradientReaders {
  /** Giá trị đã khai báo (thuộc tính, CSS, style) của một phần tử. */
  readonly declared: (element: Element) => ReadonlyMap<string, string>;
  readonly byId: ReadonlyMap<string, Element>;
  readonly parseTransform: (value: string | null | undefined) => Matrix;
  readonly warnings: string[];
}

const HREF_DEPTH = 8;
const GRADIENT_TAGS = new Set(['lineargradient', 'radialgradient']);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const tagOf = (element: Element) => element.localName.toLowerCase();

function hrefTarget(element: Element, byId: ReadonlyMap<string, Element>): Element | null {
  const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
  if (!href || !href.startsWith('#')) return null;
  return byId.get(href.slice(1)) ?? null;
}

function stopOffset(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const text = raw.trim();
  const value = parseFloat(text);
  if (!Number.isFinite(value)) return 0;
  return clamp01(text.endsWith('%') ? value / 100 : value);
}

/** Đọc dải màu, kể cả khi điểm màu và thuộc tính nằm ở dải khác được nối qua `href`. Null khi không phải dải màu. */
export function readGradient(element: Element, readers: GradientReaders): GradientSource | null {
  const tag = tagOf(element);
  if (!GRADIENT_TAGS.has(tag)) return null;

  const chain: Element[] = [];
  for (let current: Element | null = element; current && chain.length < HREF_DEPTH && !chain.includes(current); current = hrefTarget(current, readers.byId)) {
    if (GRADIENT_TAGS.has(tagOf(current))) chain.push(current);
  }
  const inherited = (name: string): string | null => {
    for (const item of chain) {
      const value = item.getAttribute(name);
      if (value !== null) return value;
    }
    return null;
  };
  /** Thuộc tính riêng của loại dải: `x1`... chỉ nhận từ dải tuyến tính, `cx`... chỉ từ dải hướng tâm. */
  const own = (name: string, kind: string): string | null => {
    for (const item of chain) {
      if (tagOf(item) !== kind) continue;
      const value = item.getAttribute(name);
      if (value !== null) return value;
    }
    return null;
  };

  const withStops = chain.find((item) => Array.from(item.children).some((child) => tagOf(child) === 'stop'));
  const stops: SourceStop[] = [];
  let previous = 0;
  for (const child of Array.from(withStops?.children ?? [])) {
    if (tagOf(child) !== 'stop') continue;
    const declared = readers.declared(child);
    const colorText = declared.get('stop-color') ?? '#000000';
    const colorKeyword = colorText.trim().toLowerCase();
    const parsed = colorKeyword === 'currentcolor' ? parseColor(declared.get('color') ?? '#000000') : parseColor(colorText);
    if (!parsed) readers.warnings.push(`Không nhận ra màu điểm chuyển sắc "${colorText}", dùng màu đen.`);
    const color = parsed ?? { hex: '#000000', alpha: 1 };
    const opacity = clamp01(parseFloat(declared.get('stop-opacity') ?? child.getAttribute('stop-opacity') ?? '1'));
    previous = Math.max(previous, stopOffset(declared.get('offset') ?? child.getAttribute('offset')));
    stops.push({ color: color.hex, offset: previous, opacity: color.alpha * (Number.isFinite(opacity) ? opacity : 1) });
  }
  if (stops.length === 0) return null;

  const spreadText = inherited('spreadMethod');
  const kind = tag === 'lineargradient' ? 'linear' : 'radial';
  return {
    kind,
    stops,
    bbox: inherited('gradientUnits') !== 'userSpaceOnUse',
    transform: readers.parseTransform(inherited('gradientTransform')),
    spread: spreadText === 'reflect' || spreadText === 'repeat' ? spreadText : 'pad',
    x1: own('x1', 'lineargradient'),
    y1: own('y1', 'lineargradient'),
    x2: own('x2', 'lineargradient'),
    y2: own('y2', 'lineargradient'),
    cx: own('cx', 'radialgradient'),
    cy: own('cy', 'radialgradient'),
    r: own('r', 'radialgradient'),
    fx: own('fx', 'radialgradient'),
    fy: own('fy', 'radialgradient'),
    fr: own('fr', 'radialgradient'),
  };
}

/** Kết quả đổi dải màu: paint gradient của Studio, hoặc một màu đơn (dải suy biến), hoặc không vẽ gì. */
export type ResolvedGradient =
  | { readonly type: 'gradient'; readonly paint: string }
  | { readonly type: 'solid'; readonly color: string; readonly alpha: number }
  | { readonly type: 'none' };

export interface GradientPlacement {
  /** Từ toạ độ cục bộ của phần tử sang toạ độ lưới. */
  readonly own: Matrix;
  /** Khung bao hình học của phần tử (toạ độ cục bộ), dùng khi dải tính theo khung bao. */
  readonly bounds: Rect;
  readonly size: number;
  readonly viewport: UserViewport;
}

const last = <T,>(items: readonly T[]): T => items[items.length - 1];

/** Giảm số điểm màu về giới hạn của Studio bằng cách lấy mẫu đều (giữ điểm đầu và cuối). */
function limitStops(stops: readonly SourceStop[], warnings: string[]): readonly SourceStop[] {
  if (stops.length <= MAX_GRADIENT_STOPS) return stops;
  warnings.push(`Dải màu có hơn ${MAX_GRADIENT_STOPS} điểm màu; Studio lấy mẫu lại còn ${MAX_GRADIENT_STOPS} điểm nên màu có thể lệch nhẹ.`);
  return Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) => stops[Math.round((index * (stops.length - 1)) / (MAX_GRADIENT_STOPS - 1))]);
}

function toStops(stops: readonly SourceStop[]): GradientStop[] {
  return stops.map((stop) => ({ color: stop.color, offset: stop.offset, ...(stop.opacity < 1 ? { opacity: stop.opacity } : {}) }));
}

/**
 * Đổi dải màu SVG thành paint của Studio, đúng cả khi dải bị biến đổi (xoay, nghiêng, co giãn lệch trục qua
 * `gradientTransform`, `transform` của phần tử hoặc khung bao không vuông).
 *
 * Tuyến tính: mọi phép biến đổi affine đều ra một hàm vị trí `t(P) = u·P + c` trên toạ độ lưới; hướng của `u` là góc của dải,
 * còn độ lớn và độ lệch của nó quyết định `t0`, `t1` (vị trí của điểm màu đầu và cuối trên trục chuẩn). Hướng tâm: ghi nguyên
 * tâm, bán kính, tiêu điểm cùng ma trận đưa sang toạ độ lưới, nên chính xác kể cả khi elip hoá.
 */
export function resolveGradient(source: GradientSource, placement: GradientPlacement, warnings: string[]): ResolvedGradient {
  const stops = limitStops(source.stops, warnings);
  if (stops.length === 0) return { type: 'none' };
  const solidLast: ResolvedGradient = { type: 'solid', color: last(stops).color, alpha: last(stops).opacity };
  if (stops.length === 1) return { type: 'solid', color: stops[0].color, alpha: stops[0].opacity };

  const { bounds, size, viewport } = placement;
  const ctx = (axisBase: number) => ({ fontSize: DEFAULT_FONT_SIZE, percentBase: axisBase });
  if (source.bbox && (bounds.width <= 1e-9 || bounds.height <= 1e-9)) return { type: 'none' };

  /** Toạ độ của dải: theo khung bao là số thuần hoặc phần trăm của 1; theo hệ người dùng là độ dài, phần trăm tính theo khung nhìn. */
  const coordinate = (raw: string | null, fallback: string, axis: 'x' | 'y' | 'r'): number => {
    const text = raw ?? fallback;
    if (source.bbox) {
      const value = parseFloat(text);
      if (!Number.isFinite(value)) return 0;
      return text.trim().endsWith('%') ? value / 100 : value;
    }
    const base = axis === 'x' ? viewport.width : axis === 'y' ? viewport.height : Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
    return parseLength(text, ctx(base)) ?? 0;
  };

  const boxMatrix: Matrix = source.bbox ? [bounds.width, 0, 0, bounds.height, bounds.x, bounds.y] : IDENTITY;
  const total = multiply(placement.own, multiply(boxMatrix, source.transform));
  const [a, b, c, d, e, f] = total;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return solidLast;

  if (source.kind === 'linear') {
    const x1 = coordinate(source.x1, '0%', 'x');
    const y1 = coordinate(source.y1, '0%', 'y');
    const x2 = coordinate(source.x2, '100%', 'x');
    const y2 = coordinate(source.y2, '0%', 'y');
    const ex = x2 - x1;
    const ey = y2 - y1;
    const lengthSquared = ex * ex + ey * ey;
    if (lengthSquared < 1e-18) return solidLast;

    // Phép ngược P → toạ độ dải: q = L·P + l, với L là nghịch đảo phần tuyến tính của `total`
    const lxx = d / det;
    const lxy = -c / det;
    const lyx = -b / det;
    const lyy = a / det;
    const lx = -(lxx * e + lxy * f);
    const ly = -(lyx * e + lyy * f);
    // t(P) = u·P + c0
    const ux = (lxx * ex + lyx * ey) / lengthSquared;
    const uy = (lxy * ex + lyy * ey) / lengthSquared;
    const c0 = ((lx - x1) * ex + (ly - y1) * ey) / lengthSquared;
    const magnitude = Math.hypot(ux, uy);
    if (magnitude < 1e-12) return solidLast;

    const angle = normalizeAngle((Math.atan2(uy, ux) * 180) / Math.PI);
    const radians = (angle * Math.PI) / 180;
    const nx = Math.cos(radians);
    const ny = Math.sin(radians);
    const half = ((Math.abs(nx) + Math.abs(ny)) * size) / 2;
    const scale = 2 * half * magnitude;
    const shift = magnitude * ((nx * size) / 2 + (ny * size) / 2 - half) + c0;
    const paint = formatGradientObject({
      kind: 'linear',
      angle,
      t0: -shift / scale,
      t1: (1 - shift) / scale,
      spread: source.spread,
      stops: toStops(stops),
    });
    return paint ? { type: 'gradient', paint } : solidLast;
  }

  const cx = coordinate(source.cx, '50%', 'x');
  const cy = coordinate(source.cy, '50%', 'y');
  const r = coordinate(source.r, '50%', 'r');
  if (r <= 1e-12) return solidLast;
  const fx = source.fx === null ? cx : coordinate(source.fx, '50%', 'x');
  const fy = source.fy === null ? cy : coordinate(source.fy, '50%', 'y');
  if (source.fr !== null && coordinate(source.fr, '0%', 'r') > 1e-9) warnings.push('Dải màu hướng tâm có bán kính tiêu điểm (fr); Studio bỏ qua giá trị đó.');
  const matrix = [a / size, b / size, c / size, d / size, e / size, f / size] as unknown as Matrix6;
  const paint = formatGradientObject({ kind: 'radial', cx, cy, r, fx, fy, matrix, spread: source.spread, stops: toStops(stops) });
  return paint ? { type: 'gradient', paint } : solidLast;
}
