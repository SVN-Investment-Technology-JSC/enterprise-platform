import type { FillRule, LineCap, LineJoin } from './model';
import { parseColor } from './svg-color';
import { DEFAULT_FONT_SIZE, parseLength, parseLengthList } from './svg-length';

/** Paint của SVG đã đọc: không vẽ, một màu (hex hoặc theo chữ), hoặc tham chiếu `url(#id)` kèm màu dự phòng. */
export type PaintSpec =
  | { readonly type: 'none' }
  | { readonly type: 'color'; readonly color: string; readonly alpha: number }
  | { readonly type: 'url'; readonly id: string; readonly fallback: PaintSpec | null };

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Kiểu đã tính của một phần tử: phần thừa kế được truyền xuống con, độ đặc nhân dồn qua các nhóm. */
export interface Style {
  readonly fill: PaintSpec;
  readonly stroke: PaintSpec;
  /** Giá trị thuộc tính `color` nếu có phần tử nào khai báo; null thì `currentColor` giữ nguyên là "màu theo chữ". */
  readonly color: { readonly hex: string; readonly alpha: number } | null;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly linecap: LineCap;
  readonly linejoin: LineJoin;
  readonly miterlimit: number;
  readonly dasharray: readonly number[] | null;
  readonly dashoffset: number;
  readonly fillRule: FillRule;
  readonly clipRule: FillRule;
  readonly visible: boolean;
  /** Nét vẽ trước phần tô (`paint-order: stroke`). */
  readonly strokeFirst: boolean;
  readonly fontSize: number;
  readonly vars: ReadonlyMap<string, string>;
  /** Độ đặc dồn từ phần tử này lên các nhóm cha. */
  readonly opacity: number;
}

/** Thuộc tính không thừa kế của phần tử. */
export interface LocalProps {
  readonly display: boolean;
  readonly mask: string | null;
  readonly clipPath: string | null;
  readonly filter: string | null;
  readonly blend: string | null;
  readonly nonScaling: boolean;
  readonly transform: string | null;
  readonly transformOrigin: string | null;
  readonly transformBox: string | null;
  readonly overflowVisible: boolean;
  readonly markers: boolean;
}

export const INITIAL_STYLE: Style = {
  fill: { type: 'color', color: '#000000', alpha: 1 },
  stroke: { type: 'none' },
  color: null,
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: 1,
  linecap: 'butt',
  linejoin: 'miter',
  miterlimit: 4,
  dasharray: null,
  dashoffset: 0,
  fillRule: 'nonzero',
  clipRule: 'nonzero',
  visible: true,
  strokeFirst: false,
  fontSize: DEFAULT_FONT_SIZE,
  vars: new Map(),
  opacity: 1,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Thay `var(--tên, dự phòng)` bằng giá trị biến; null khi có biến không xác định và không có dự phòng. */
function substituteVars(value: string, vars: ReadonlyMap<string, string>, depth = 0): string | null {
  if (!value.includes('var(')) return value;
  if (depth > 8) return null;
  let result = '';
  let index = 0;
  while (index < value.length) {
    const at = value.indexOf('var(', index);
    if (at < 0) {
      result += value.slice(index);
      break;
    }
    result += value.slice(index, at);
    let level = 1;
    let end = at + 4;
    while (end < value.length && level > 0) {
      if (value[end] === '(') level += 1;
      else if (value[end] === ')') level -= 1;
      end += 1;
    }
    const inner = value.slice(at + 4, end - 1);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    const found = vars.get(name) ?? fallback;
    if (found === null || found === undefined) return null;
    const resolved = substituteVars(found, vars, depth + 1);
    if (resolved === null) return null;
    result += resolved;
    index = end;
  }
  return result;
}

const URL_REFERENCE = /^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)\s*(.*)$/i;

/** Đọc giá trị `fill`/`stroke`; null khi không đọc được (khai báo bị bỏ qua như trong trình duyệt). */
export function parsePaintSpec(value: string): PaintSpec | null {
  const text = value.trim();
  const lower = text.toLowerCase();
  if (lower === 'none') return { type: 'none' };
  if (lower === 'currentcolor') return { type: 'color', color: 'currentColor', alpha: 1 };
  const reference = URL_REFERENCE.exec(text);
  if (reference) {
    const rest = reference[3].trim();
    return { type: 'url', id: reference[2], fallback: rest ? parsePaintSpec(rest) : null };
  }
  if (lower.startsWith('url(')) {
    // tham chiếu tới tệp ngoài (không có `#id` cục bộ): không đọc được, chỉ còn màu dự phòng
    const close = text.indexOf(')');
    const rest = close > 0 ? text.slice(close + 1).trim() : '';
    return { type: 'url', id: '\u0000', fallback: rest ? parsePaintSpec(rest) : null };
  }
  const color = parseColor(text);
  return color ? { type: 'color', color: color.hex, alpha: color.alpha } : null;
}

function parseOpacity(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const text = value.trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return fallback;
  return clamp01(text.endsWith('%') ? number / 100 : number);
}

/** Kích thước chuẩn để quy đổi phần trăm của độ dày nét, độ dài nét đứt, bán kính (đường chéo chuẩn hoá). */
const normalizedDiagonal = (viewport: ViewportSize) => Math.hypot(viewport.width, viewport.height) / Math.SQRT2;

export interface ComputedStyle {
  readonly style: Style;
  readonly local: LocalProps;
}

/**
 * Tính kiểu của một phần tử từ các khai báo đã gộp (`Stylesheet.declared`) và kiểu của phần tử cha. Hiểu `inherit`, `initial`,
 * `unset`, biến CSS `var()` và `currentColor`.
 */
export function computeStyle(
  declared: ReadonlyMap<string, string>,
  parent: Style,
  viewport: ViewportSize,
  warnings: string[],
): ComputedStyle {
  // biến CSS thừa kế; khai báo của phần tử ghi đè
  let vars = parent.vars;
  const own = [...declared].filter(([name]) => name.startsWith('--'));
  if (own.length > 0) {
    // biến trên cùng phần tử có thể tham chiếu nhau (và tham chiếu vòng thì bị bỏ): giải theo bảng gồm cả biến thừa kế
    const raw = new Map(parent.vars);
    for (const [name, value] of own) raw.set(name, value);
    const resolvedVars = new Map(parent.vars);
    for (const [name, value] of own) {
      const resolved = substituteVars(value, raw);
      if (resolved === null) resolvedVars.delete(name);
      else resolvedVars.set(name, resolved);
    }
    vars = resolvedVars;
  }

  /** Giá trị cuối của thuộc tính sau khi thay biến; 'inherit'/'unset' (thuộc tính thừa kế) trả về null để dùng của cha. */
  const read = (name: string, inheritedProperty: boolean): string | null | undefined => {
    const raw = declared.get(name);
    if (raw === undefined) return undefined;
    const value = substituteVars(raw, vars);
    if (value === null) return undefined;
    const keyword = value.trim().toLowerCase();
    if (keyword === 'inherit' || (keyword === 'unset' && inheritedProperty)) return null;
    if (keyword === 'initial' || keyword === 'unset') return undefined;
    return value.trim();
  };

  const fontSizeRaw = read('font-size', true);
  let fontSize = parent.fontSize;
  if (fontSizeRaw) {
    const parsed = parseLength(fontSizeRaw, { fontSize: parent.fontSize, percentBase: parent.fontSize });
    if (parsed !== null && parsed >= 0) fontSize = parsed;
  } else if (fontSizeRaw === undefined && declared.has('font-size')) fontSize = DEFAULT_FONT_SIZE;

  const lengths = (percentBase: number) => ({ fontSize, percentBase });

  let color = parent.color;
  const colorRaw = read('color', true);
  if (colorRaw) {
    const parsed = parseColor(colorRaw);
    if (parsed) color = parsed;
  }

  const paintOf = (name: 'fill' | 'stroke', fallback: PaintSpec): PaintSpec => {
    const raw = read(name, true);
    if (raw === null) return fallback;
    if (raw === undefined) return declared.has(name) ? INITIAL_STYLE[name] : fallback;
    const parsed = parsePaintSpec(raw);
    if (!parsed) {
      warnings.push(`Không nhận ra màu "${raw}", dùng màu theo ngữ cảnh.`);
      return fallback;
    }
    return parsed;
  };

  const numberProp = (name: string, fallback: number, parse: (text: string) => number | null): number => {
    const raw = read(name, true);
    if (raw === null || raw === undefined) return fallback;
    const parsed = parse(raw);
    return parsed === null ? fallback : parsed;
  };

  const strokeWidth = (() => {
    const raw = read('stroke-width', true);
    if (raw === null) return parent.strokeWidth;
    if (raw === undefined) return declared.has('stroke-width') ? 1 : parent.strokeWidth;
    const parsed = parseLength(raw, lengths(normalizedDiagonal(viewport)));
    return parsed !== null && parsed >= 0 ? parsed : parent.strokeWidth;
  })();

  const linecapRaw = read('stroke-linecap', true);
  const linecap: LineCap = linecapRaw === 'round' || linecapRaw === 'butt' || linecapRaw === 'square' ? linecapRaw : parent.linecap;
  const linejoinRaw = read('stroke-linejoin', true);
  const linejoin: LineJoin =
    linejoinRaw === 'round' || linejoinRaw === 'bevel' ? linejoinRaw : linejoinRaw === 'miter' || linejoinRaw === 'miter-clip' || linejoinRaw === 'arcs' ? 'miter' : parent.linejoin;

  const dashRaw = read('stroke-dasharray', true);
  let dasharray = parent.dasharray;
  if (dashRaw !== undefined && dashRaw !== null) {
    if (dashRaw.toLowerCase() === 'none') dasharray = null;
    else {
      const list = parseLengthList(dashRaw, lengths(normalizedDiagonal(viewport)));
      dasharray = list && list.every((item) => item >= 0) && list.some((item) => item > 0) ? list : null;
    }
  }
  const dashoffset = numberProp('stroke-dashoffset', parent.dashoffset, (text) => parseLength(text, lengths(normalizedDiagonal(viewport))));

  const ruleOf = (name: string, fallback: FillRule): FillRule => {
    const raw = read(name, true);
    return raw === 'evenodd' || raw === 'nonzero' ? raw : fallback;
  };

  const visibilityRaw = read('visibility', true);
  const visible = visibilityRaw === 'visible' ? true : visibilityRaw === 'hidden' || visibilityRaw === 'collapse' ? false : parent.visible;

  const paintOrderRaw = read('paint-order', true);
  let strokeFirst = parent.strokeFirst;
  if (paintOrderRaw !== undefined && paintOrderRaw !== null) {
    const tokens = paintOrderRaw.toLowerCase().split(/\s+/).filter(Boolean);
    const strokeAt = tokens.indexOf('stroke');
    const fillAt = tokens.indexOf('fill');
    strokeFirst = tokens[0] === 'normal' ? false : strokeAt >= 0 && (fillAt < 0 || strokeAt < fillAt);
  }

  const miterRaw = read('stroke-miterlimit', true);
  const miterParsed = miterRaw ? parseFloat(miterRaw) : Number.NaN;

  const opacityRaw = read('opacity', false);
  const local = (name: string): string | null => {
    const raw = read(name, false);
    return raw === undefined || raw === null || raw.toLowerCase() === 'none' ? null : raw;
  };
  const overflow = read('overflow', false)?.toLowerCase();
  const vector = read('vector-effect', false);
  const marker = ['marker-start', 'marker-mid', 'marker-end'].some((name) => {
    const raw = read(name, true);
    return raw !== undefined && raw !== null && raw.toLowerCase() !== 'none';
  });
  const blend = local('mix-blend-mode');
  const style: Style = {
    fill: paintOf('fill', parent.fill),
    stroke: paintOf('stroke', parent.stroke),
    color,
    fillOpacity: parseOpacity(read('fill-opacity', true) ?? undefined, parent.fillOpacity),
    strokeOpacity: parseOpacity(read('stroke-opacity', true) ?? undefined, parent.strokeOpacity),
    strokeWidth,
    linecap,
    linejoin,
    miterlimit: Number.isFinite(miterParsed) && miterParsed >= 1 ? miterParsed : parent.miterlimit,
    dasharray,
    dashoffset,
    fillRule: ruleOf('fill-rule', parent.fillRule),
    clipRule: ruleOf('clip-rule', parent.clipRule),
    visible,
    strokeFirst,
    fontSize,
    vars,
    opacity: parent.opacity * parseOpacity(opacityRaw ?? undefined, 1),
  };

  return {
    style,
    local: {
      display: (read('display', false) ?? '').toLowerCase() !== 'none',
      mask: local('mask'),
      clipPath: local('clip-path'),
      filter: local('filter'),
      blend: blend && blend.toLowerCase() !== 'normal' ? blend : null,
      nonScaling: (vector ?? '').toLowerCase().includes('non-scaling-stroke'),
      transform: local('transform'),
      transformOrigin: local('transform-origin'),
      transformBox: local('transform-box'),
      overflowVisible: overflow === 'visible' || overflow === 'auto',
      markers: marker,
    },
  };
}
