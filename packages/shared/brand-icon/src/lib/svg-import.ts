import { IDENTITY, applyMatrix, geometryBounds, multiply, rotation, scaling, translation, transformGeometry, type Matrix } from './geometry';
import { MAX_GRADIENT_STOPS, colorAtOffset, formatGradient, normalizeAngle } from './gradient';
import { normalizeHex } from './palette';
import { MAX_PATH_DATA_LENGTH, parsePathData } from './path-data';
import { LIMITS, normalizeShape } from './validate';
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
  type Rect,
} from './model';

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

const MAX_SHAPES = LIMITS.maxShapes;
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

/** Tiền tố đánh dấu paint còn là tham chiếu `url(#id)` chưa đổi thành gradient. */
const URL_PAINT = 'url#';
const GRADIENT_WARNING = 'SVG dùng màu chuyển sắc hoặc hoa văn mà Studio không đọc được; thay bằng một màu đơn.';

function unsupportedPaint(warnings: string[]): Paint {
  warnings.push(GRADIENT_WARNING);
  return 'currentColor';
}

function parsePaint(value: string, warnings: string[]): Paint {
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === 'transparent') return 'none';
  if (text === 'currentcolor' || text === 'inherit') return 'currentColor';
  if (text === 'black') return 'currentColor';
  if (text.startsWith('url(')) {
    // tham chiếu tới dải màu: để nguyên, đổi thành gradient (hoặc một màu đơn) khi biết lớp hình và phép biến đổi của nó
    const reference = value.trim().match(/^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/i);
    return reference ? `${URL_PAINT}${reference[2]}` : unsupportedPaint(warnings);
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/);
  if (rgb) {
    const channel = (part: string) => {
      const value = part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part);
      return Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
    };
    const hex = `#${[rgb[1], rgb[2], rgb[3]].map((part) => channel(part).toString(16).padStart(2, '0')).join('')}`;
    return hex === '#000000' ? 'currentColor' : hex;
  }
  // #rgba và #rrggbbaa: bỏ kênh trong suốt, giữ màu
  const withAlpha = text.match(/^#(?:([0-9a-f]{3})[0-9a-f]|([0-9a-f]{6})[0-9a-f]{2})$/);
  const hex = normalizeHex(withAlpha ? `#${withAlpha[1] ?? withAlpha[2]}` : text);
  if (hex) return hex === '#000000' ? 'currentColor' : hex;
  if (NAMED_COLORS[text]) return NAMED_COLORS[text];
  warnings.push(`Không nhận ra màu "${value}", dùng màu theo ngữ cảnh.`);
  return 'currentColor';
}

/** Phần tử bị ẩn bằng `display="none"` (thuộc tính hoặc style) không được nhập, cùng toàn bộ phần tử con. */
function isHidden(element: Element): boolean {
  if (element.getAttribute('display')?.trim().toLowerCase() === 'none') return true;
  return /(?:^|;)\s*display\s*:\s*none\b/i.test(element.getAttribute('style') ?? '');
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
  // `inherit` giữ nguyên màu của phần tử cha (khác `currentColor`, vốn là màu chữ)
  const fill = values.get('fill');
  if (fill !== undefined && fill.trim().toLowerCase() !== 'inherit') style.fill = parsePaint(fill, warnings);
  const stroke = values.get('stroke');
  if (stroke !== undefined && stroke.trim().toLowerCase() !== 'inherit') style.stroke = parsePaint(stroke, warnings);
  style.strokeWidth = Math.max(0, numberOf(values.get('stroke-width'), parent.strokeWidth));
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

interface GradientSource {
  readonly kind: 'linear' | 'radial';
  readonly stops: Array<{ color: string; offset: number }>;
  readonly units: 'user' | 'bbox';
  readonly transform: Matrix;
  readonly x1: string | null;
  readonly y1: string | null;
  readonly x2: string | null;
  readonly y2: string | null;
  /** Có điểm màu trong suốt một phần; Studio bỏ qua độ trong suốt của từng điểm màu. */
  readonly translucent: boolean;
}

const HREF_DEPTH = 6;
const GRADIENT_TAGS = new Set(['lineargradient', 'radialgradient']);

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

/** Đọc dải màu `<linearGradient>`/`<radialGradient>`, kể cả khi kế thừa điểm màu và thuộc tính qua `href`. */
function readGradient(element: Element, byId: ReadonlyMap<string, Element>, warnings: string[]): GradientSource | null {
  const tag = element.localName.toLowerCase();
  if (!GRADIENT_TAGS.has(tag)) return null;

  const chain: Element[] = [];
  for (
    let current: Element | null = element;
    current && chain.length < HREF_DEPTH && !chain.includes(current);
    current = hrefTarget(current, byId)
  ) {
    if (GRADIENT_TAGS.has(current.localName.toLowerCase())) chain.push(current);
  }
  const inherited = (name: string): string | null => {
    for (const item of chain) {
      const value = item.getAttribute(name);
      if (value !== null) return value;
    }
    return null;
  };

  const withStops = chain.find((item) => Array.from(item.children).some((child) => child.localName.toLowerCase() === 'stop'));
  const stops: Array<{ color: string; offset: number }> = [];
  let translucent = false;
  let previous = 0;
  for (const child of Array.from(withStops?.children ?? [])) {
    if (child.localName.toLowerCase() !== 'stop') continue;
    const style = new Map<string, string>();
    for (const declaration of (child.getAttribute('style') ?? '').split(';')) {
      const [key, ...rest] = declaration.split(':');
      if (key && rest.length > 0) style.set(key.trim().toLowerCase(), rest.join(':').trim());
    }
    const paint = parsePaint(style.get('stop-color') ?? child.getAttribute('stop-color') ?? '#000000', warnings);
    const opacity = numberOf(style.get('stop-opacity') ?? child.getAttribute('stop-opacity'), 1);
    if (opacity < 0.999) translucent = true;
    previous = Math.max(previous, stopOffset(style.get('offset') ?? child.getAttribute('offset')));
    stops.push({ color: paint.startsWith('#') ? paint : '#000000', offset: previous });
  }
  if (stops.length === 0) return null;

  return {
    kind: tag === 'lineargradient' ? 'linear' : 'radial',
    stops,
    units: inherited('gradientUnits') === 'userSpaceOnUse' ? 'user' : 'bbox',
    transform: parseTransform(inherited('gradientTransform')),
    x1: inherited('x1'),
    y1: inherited('y1'),
    x2: inherited('x2'),
    y2: inherited('y2'),
    translucent,
  };
}

/** Điểm màu sau khi chiếu lên trục chuẩn của Studio: cắt trong 0..1, thêm điểm ở hai đầu, giảm còn tối đa 8 điểm. */
function clipStops(
  stops: ReadonlyArray<{ color: string; offset: number }>,
  t0: number,
  t1: number,
): Array<{ color: string; offset: number }> {
  const span = t1 - t0;
  const mapped = stops.map((stop) => ({ color: stop.color, offset: t0 + span * stop.offset }));
  const inner = mapped.filter((stop) => stop.offset > 1e-4 && stop.offset < 1 - 1e-4);
  const result = [{ color: colorAtOffset(mapped, 0), offset: 0 }, ...inner, { color: colorAtOffset(mapped, 1), offset: 1 }];
  if (result.length <= MAX_GRADIENT_STOPS) return result;
  return Array.from({ length: MAX_GRADIENT_STOPS }, (_, index) => result[Math.round((index * (result.length - 1)) / (MAX_GRADIENT_STOPS - 1))]);
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
  let oversizedSeen = false;
  let truncated = false;

  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
  // width/height kiểu phần trăm không cho biết cỡ thật nên coi như không có
  const dimension = (name: string) => {
    const raw = root.getAttribute(name);
    return raw !== null && raw.trim().endsWith('%') ? size : numberOf(raw, size);
  };
  const viewWidth = hasBox ? box[2] : dimension('width');
  const viewHeight = hasBox ? box[3] : dimension('height');
  const fit = size / Math.max(viewWidth, viewHeight, 1e-6);
  const base: Matrix = hasBox
    ? [fit, 0, 0, fit, (size - viewWidth * fit) / 2 - box[0] * fit, (size - viewHeight * fit) / 2 - box[1] * fit]
    : [fit, 0, 0, fit, 0, 0];
  if (Math.abs(fit - 1) > 1e-6) warnings.push(`Đã co SVG gốc ${roundTo(viewWidth, 2)}x${roundTo(viewHeight, 2)} về lưới ${size}x${size}.`);

  const elementsById = new Map<string, Element>();
  for (const element of Array.from(root.querySelectorAll('[id]'))) {
    const id = element.getAttribute('id');
    if (id && !elementsById.has(id)) elementsById.set(id, element);
  }
  let translucentStops = false;

  /**
   * Đổi tham chiếu `url(#id)` thành gradient của Studio. Điểm đầu và cuối của dải màu được đưa về toạ độ lưới (qua
   * `transform` của lớp hình, `gradientTransform` và khung bao nếu dải tính theo khung bao), lấy hướng làm góc, rồi chiếu lên
   * trục chuẩn trải trên cả khung vẽ. Dải màu không đọc được (radial, thiếu, suy biến) thành một màu đơn kèm cảnh báo.
   */
  const resolveUrlPaint = (paint: Paint, own: Matrix, bounds: Rect): Paint => {
    if (!paint.startsWith(URL_PAINT)) return paint;
    const target = elementsById.get(paint.slice(URL_PAINT.length));
    const source = target ? readGradient(target, elementsById, warnings) : null;
    if (!source) return unsupportedPaint(warnings);
    if (source.translucent) translucentStops = true;
    const solid = (color: string): Paint => {
      warnings.push(GRADIENT_WARNING);
      return color;
    };
    if (source.kind === 'radial') return solid(colorAtOffset(source.stops, 0.5));

    const bbox = source.units === 'bbox';
    if (bbox && (bounds.width <= 1e-9 || bounds.height <= 1e-9)) return solid(colorAtOffset(source.stops, 0.5));
    const originX = hasBox ? box[0] : 0;
    const originY = hasBox ? box[1] : 0;
    const coordinate = (raw: string | null, fallback: number, axis: 'x' | 'y'): number => {
      const value = raw === null ? Number.NaN : parseFloat(raw);
      if (!Number.isFinite(value)) return fallback;
      if (!raw?.trim().endsWith('%')) return value;
      if (bbox) return value / 100;
      return axis === 'x' ? originX + (value / 100) * viewWidth : originY + (value / 100) * viewHeight;
    };
    const from = { x: coordinate(source.x1, bbox ? 0 : originX, 'x'), y: coordinate(source.y1, bbox ? 0 : originY, 'y') };
    const to = { x: coordinate(source.x2, bbox ? 1 : originX + viewWidth, 'x'), y: coordinate(source.y2, bbox ? 0 : originY, 'y') };

    const boxMatrix: Matrix = bbox ? [bounds.width, 0, 0, bounds.height, bounds.x, bounds.y] : IDENTITY;
    const total = multiply(own, multiply(boxMatrix, source.transform));
    const p1 = applyMatrix(total, from);
    const p2 = applyMatrix(total, to);
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) return solid(source.stops[source.stops.length - 1].color);

    const angle = normalizeAngle((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI);
    const cos = Math.cos((angle * Math.PI) / 180);
    const sin = Math.sin((angle * Math.PI) / 180);
    const half = ((Math.abs(cos) + Math.abs(sin)) * size) / 2;
    const project = (point: { x: number; y: number }) => ((point.x - size / 2) * cos + (point.y - size / 2) * sin) / (2 * half) + 0.5;
    return formatGradient(angle, clipStops(source.stops, project(p1), project(p2))) ?? solid(colorAtOffset(source.stops, 0.5));
  };

  const visit = (element: Element, matrix: Matrix, parentStyle: Style) => {
    if (truncated) return;
    const tag = element.localName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (UNSUPPORTED.has(tag)) {
      unsupportedSeen = true;
      return;
    }
    if (isHidden(element)) return;
    const style = readStyle(element, parentStyle, warnings);
    const own = multiply(matrix, parseTransform(element.getAttribute('transform')));

    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const child of Array.from(element.children)) visit(child, own, style);
      return;
    }

    const geometry = elementGeometry(element, warnings);
    if (!geometry) return;
    const scale = Math.sqrt(Math.abs(own[0] * own[3] - own[1] * own[2]));
    // nét dày 0 là không có nét (nếu giữ lại, bước chuẩn hoá sẽ nâng lên độ dày tối thiểu và làm hiện nét)
    const hasStroke = style.stroke !== 'none' && style.strokeWidth * scale > 1e-6;
    const hasFill = style.fill !== 'none';
    if (!hasStroke && !hasFill) return;

    const strokeWidth = options.strokeWidth ?? roundTo(style.strokeWidth * scale, 3);
    const label = element.getAttribute('id');
    const bounds = geometryBounds(geometry);
    const candidate = createShape(transformGeometry(geometry, own), {
      ...(label ? { name: label.slice(0, 40) } : {}),
      fill: resolveUrlPaint(style.fill, own, bounds),
      fillOpacity: style.fillOpacity,
      stroke: hasStroke ? resolveUrlPaint(style.stroke, own, bounds) : 'none',
      strokeWidth: hasStroke ? strokeWidth : DEFAULT_SHAPE_STYLE.strokeWidth,
      opacity: roundTo(style.opacity * (hasFill ? 1 : style.strokeOpacity), 3),
      linecap: style.linecap,
      linejoin: style.linejoin,
      fillRule: style.fillRule,
    });
    // Hình phải qua được bước chuẩn hoá của thư viện (toạ độ trong ±1000, tối đa 64 đường con và 2000 điểm neo);
    // nếu không, khi lưu rồi nạp lại cả icon sẽ bị từ chối và mất sạch.
    const shape = normalizeShape(candidate);
    if (!shape) {
      oversizedSeen = true;
      return;
    }
    if (shapes.length >= MAX_SHAPES) {
      truncated = true;
      return;
    }
    if (hasStroke) strokeWidths.push(shape.strokeWidth);
    shapes.push(shape);
  };

  visit(root, base, BASE_STYLE);
  if (truncated) warnings.push(`Chỉ nhập ${MAX_SHAPES} hình đầu tiên.`);
  if (oversizedSeen) warnings.push('Có hình quá lớn hoặc quá phức tạp (vượt giới hạn toạ độ hay số điểm) nên bị bỏ qua.');
  if (translucentStops) warnings.push('Điểm màu chuyển sắc có độ trong suốt; Studio bỏ qua độ trong suốt đó.');
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
