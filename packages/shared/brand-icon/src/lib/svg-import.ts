import { IDENTITY, multiply, rotation, scaling, translation, transformGeometry, type Matrix } from './geometry.js';
import { normalizeHex } from './palette.js';
import { MAX_PATH_DATA_LENGTH, parsePathData } from './path-data.js';
import {
  DEFAULT_SIZE,
  DEFAULT_SHAPE_STYLE,
  createShape,
  roundTo,
  type FillRule,
  type Geometry,
  type IconShape,
  type LineCap,
  type LineJoin,
  type Paint,
} from './model.js';

export interface SvgImportResult {
  readonly shapes: IconShape[];
  readonly warnings: string[];
  /** Độ dày nét phổ biến nhất trong SVG gốc, đã quy đổi theo lưới đích. */
  readonly dominantStrokeWidth: number | null;
}

export interface SvgImportOptions {
  /** Cạnh lưới đích, mặc định 24. */
  readonly size?: number;
  /** Ép mọi lớp có nét về một độ dày (đồng bộ với quy chuẩn). */
  readonly strokeWidth?: number;
}

const MAX_SHAPES = 200;
const SKIPPED = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'title', 'desc', 'metadata', 'style', 'script', 'lineargradient', 'radialgradient', 'filter', 'marker']);
const UNSUPPORTED = new Set(['text', 'image', 'use', 'foreignobject']);

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  pink: '#ffc0cb',
  cyan: '#00ffff',
  navy: '#000080',
  teal: '#008080',
};

interface Style {
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  linecap: LineCap;
  linejoin: LineJoin;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: FillRule;
}

const BASE_STYLE: Style = {
  fill: 'currentColor',
  stroke: 'none',
  strokeWidth: 1,
  linecap: 'butt',
  linejoin: 'miter',
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  fillRule: 'nonzero',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function numberOf(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseTransform(value: string | null | undefined): Matrix {
  if (!value) return IDENTITY;
  let result: Matrix = IDENTITY;
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(pattern)) {
    const args = (match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let next: Matrix = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) next = args as unknown as Matrix;
        break;
      case 'translate':
        next = translation(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        next = scaling(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        next = rotation(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
        break;
      case 'skewX':
        next = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        next = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    result = multiply(result, next);
  }
  return result;
}

function parsePaint(value: string, warnings: string[]): Paint {
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === 'transparent') return 'none';
  if (text === 'currentcolor' || text === 'inherit') return 'currentColor';
  if (text === 'black') return 'currentColor';
  if (text.startsWith('url(')) {
    warnings.push('SVG dùng màu chuyển sắc hoặc hoa văn; Studio thay bằng một màu đơn.');
    return 'currentColor';
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) {
    const hex = `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`;
    return hex === '#000000' ? 'currentColor' : hex;
  }
  const hex = normalizeHex(text);
  if (hex) return hex === '#000000' ? 'currentColor' : hex;
  if (NAMED_COLORS[text]) return NAMED_COLORS[text];
  warnings.push(`Không nhận ra màu "${value}", dùng màu theo ngữ cảnh.`);
  return 'currentColor';
}

function readStyle(element: Element, parent: Style, warnings: string[]): Style {
  const values = new Map<string, string>();
  for (const name of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule']) {
    const attribute = element.getAttribute(name);
    if (attribute !== null) values.set(name, attribute);
  }
  const inline = element.getAttribute('style');
  if (inline) {
    for (const declaration of inline.split(';')) {
      const [key, ...rest] = declaration.split(':');
      if (key && rest.length > 0) values.set(key.trim().toLowerCase(), rest.join(':').trim());
    }
  }

  const style: Style = { ...parent, opacity: 1 };
  // `opacity` không kế thừa nhưng nhân dồn qua các nhóm
  style.opacity = parent.opacity * clamp01(numberOf(values.get('opacity'), 1));
  const fill = values.get('fill');
  if (fill !== undefined) style.fill = parsePaint(fill, warnings);
  const stroke = values.get('stroke');
  if (stroke !== undefined) style.stroke = parsePaint(stroke, warnings);
  style.strokeWidth = numberOf(values.get('stroke-width'), parent.strokeWidth);
  const cap = values.get('stroke-linecap');
  if (cap === 'round' || cap === 'butt' || cap === 'square') style.linecap = cap;
  const join = values.get('stroke-linejoin');
  if (join === 'round' || join === 'miter' || join === 'bevel') style.linejoin = join;
  style.fillOpacity = clamp01(numberOf(values.get('fill-opacity'), parent.fillOpacity));
  style.strokeOpacity = clamp01(numberOf(values.get('stroke-opacity'), parent.strokeOpacity));
  const rule = values.get('fill-rule');
  if (rule === 'evenodd' || rule === 'nonzero') style.fillRule = rule;
  return style;
}

function elementGeometry(element: Element, warnings: string[]): Geometry | null {
  const tag = element.localName.toLowerCase();
  const get = (name: string) => numberOf(element.getAttribute(name), 0);
  switch (tag) {
    case 'path': {
      const data = element.getAttribute('d') ?? '';
      if (data.length > MAX_PATH_DATA_LENGTH) {
        warnings.push('Một đường quá dài nên bị bỏ qua.');
        return null;
      }
      try {
        const geometry = parsePathData(data);
        return geometry.subpaths.length > 0 ? geometry : null;
      } catch {
        warnings.push('Một đường có dữ liệu không hợp lệ nên bị bỏ qua.');
        return null;
      }
    }
    case 'rect': {
      const width = get('width');
      const height = get('height');
      if (width <= 0 || height <= 0) return null;
      const hasRx = element.hasAttribute('rx');
      const hasRy = element.hasAttribute('ry');
      const rx = hasRx ? get('rx') : hasRy ? get('ry') : 0;
      return { type: 'rect', x: get('x'), y: get('y'), width, height, rx: Math.max(0, Math.min(rx, width / 2, height / 2)) };
    }
    case 'circle': {
      const r = get('r');
      return r > 0 ? { type: 'ellipse', cx: get('cx'), cy: get('cy'), rx: r, ry: r } : null;
    }
    case 'ellipse': {
      const rx = get('rx');
      const ry = get('ry');
      return rx > 0 && ry > 0 ? { type: 'ellipse', cx: get('cx'), cy: get('cy'), rx, ry } : null;
    }
    case 'line':
      return {
        type: 'path',
        subpaths: [{ closed: false, nodes: [{ x: get('x1'), y: get('y1') }, { x: get('x2'), y: get('y2') }] }],
      };
    case 'polyline':
    case 'polygon': {
      const values = (element.getAttribute('points')?.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      const nodes = [];
      for (let index = 0; index + 1 < values.length; index += 2) nodes.push({ x: values[index], y: values[index + 1] });
      return nodes.length >= 2 ? { type: 'path', subpaths: [{ closed: tag === 'polygon', nodes }] } : null;
    }
    default:
      return null;
  }
}

/**
 * Nhập SVG (nguyên thẻ `<svg>` hoặc vài phần tử rời) thành các lớp hình có thể chỉnh sửa. Giữ nét, tô đặc, màu,
 * độ mờ, `transform` và `viewBox`. Chỉ đọc cấu trúc, không chèn SVG vào trang.
 */
export function importSvg(markup: string, options: SvgImportOptions = {}): SvgImportResult {
  if (typeof DOMParser === 'undefined') throw new Error('Trình duyệt không hỗ trợ đọc SVG.');
  const size = options.size ?? DEFAULT_SIZE;
  const source = /<svg[\s>]/i.test(markup) ? markup : `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('Mã SVG không hợp lệ. Hãy dán nguyên đoạn từ <svg> đến </svg>.');

  const root = parsed.documentElement;
  const warnings: string[] = [];
  const shapes: IconShape[] = [];
  const strokeWidths: number[] = [];
  let unsupportedSeen = false;

  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
  const viewWidth = hasBox ? box[2] : numberOf(root.getAttribute('width'), size);
  const viewHeight = hasBox ? box[3] : numberOf(root.getAttribute('height'), size);
  const fit = size / Math.max(viewWidth, viewHeight, 1e-6);
  const base: Matrix = hasBox
    ? [fit, 0, 0, fit, (size - viewWidth * fit) / 2 - box[0] * fit, (size - viewHeight * fit) / 2 - box[1] * fit]
    : [fit, 0, 0, fit, 0, 0];
  if (Math.abs(fit - 1) > 1e-6) warnings.push(`Đã co SVG gốc ${roundTo(viewWidth, 2)}x${roundTo(viewHeight, 2)} về lưới ${size}x${size}.`);

  const visit = (element: Element, matrix: Matrix, parentStyle: Style) => {
    if (shapes.length >= MAX_SHAPES) return;
    const tag = element.localName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (UNSUPPORTED.has(tag)) {
      unsupportedSeen = true;
      return;
    }
    const style = readStyle(element, parentStyle, warnings);
    const own = multiply(matrix, parseTransform(element.getAttribute('transform')));

    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const child of Array.from(element.children)) visit(child, own, style);
      return;
    }

    const geometry = elementGeometry(element, warnings);
    if (!geometry) return;
    const scale = Math.sqrt(Math.abs(own[0] * own[3] - own[1] * own[2]));
    const hasStroke = style.stroke !== 'none';
    const hasFill = style.fill !== 'none';
    if (!hasStroke && !hasFill) return;

    const strokeWidth = options.strokeWidth ?? roundTo(style.strokeWidth * scale, 3);
    if (hasStroke) strokeWidths.push(strokeWidth);
    const label = element.getAttribute('id');
    shapes.push(
      createShape(transformGeometry(geometry, own), {
        ...(label ? { name: label.slice(0, 40) } : {}),
        fill: style.fill,
        fillOpacity: style.fillOpacity,
        stroke: style.stroke,
        strokeWidth: hasStroke ? strokeWidth : DEFAULT_SHAPE_STYLE.strokeWidth,
        opacity: roundTo(style.opacity * (hasFill ? 1 : style.strokeOpacity), 3),
        linecap: style.linecap,
        linejoin: style.linejoin,
        fillRule: style.fillRule,
      }),
    );
  };

  visit(root, base, BASE_STYLE);
  if (shapes.length >= MAX_SHAPES) warnings.push(`Chỉ nhập ${MAX_SHAPES} hình đầu tiên.`);
  if (unsupportedSeen) warnings.push('SVG có chữ, ảnh hoặc phần tử <use>, các phần này không được nhập.');
  if (shapes.length === 0) throw new Error('Không tìm thấy hình nào (path, rect, circle, line...) trong SVG.');

  const counts = new Map<number, number>();
  for (const width of strokeWidths) counts.set(width, (counts.get(width) ?? 0) + 1);
  let dominant: number | null = null;
  let best = 0;
  for (const [width, count] of counts) {
    if (count > best) {
      dominant = width;
      best = count;
    }
  }
  return { shapes, warnings: [...new Set(warnings)], dominantStrokeWidth: dominant };
}

/** Nhận biết nội dung dán vào là mã SVG thay vì chuỗi `d`. */
export function looksLikeSvgMarkup(text: string): boolean {
  return /^\s*<(?:\?xml|!--|svg|g|path|circle|ellipse|rect|line|polyline|polygon)\b/i.test(text);
}
