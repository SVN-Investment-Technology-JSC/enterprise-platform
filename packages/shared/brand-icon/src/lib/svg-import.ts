import {
  IDENTITY,
  applyMatrix,
  geometryBounds,
  geometryToPath,
  multiply,
  rectsIntersect,
  transformGeometry,
  translation,
  unionRects,
  visualBounds,
  type Matrix,
} from './geometry';
import { formatGradientObject, parseGradient } from './gradient';
import { MAX_PATH_DATA_LENGTH, parsePathData } from './path-data';
import {
  DEFAULT_SIZE,
  DEFAULT_SHAPE_STYLE,
  createShape,
  roundTo,
  type Geometry,
  type IconShape,
  type Paint,
  type PathGeometry,
  type Point,
  type Rect,
  type ShapeMask,
} from './model';
import { Stylesheet } from './svg-css';
import { readGradient, resolveGradient, type GradientSource, type ResolvedGradient } from './svg-gradient';
import { DEFAULT_FONT_SIZE, parseLength } from './svg-length';
import { parseSvgMarkup } from './svg-parse';
import { INITIAL_STYLE, computeStyle, type LocalProps, type PaintSpec, type Style, type ViewportSize } from './svg-style';
import { parseTransformList } from './svg-transform';
import { LIMITS, normalizeMaskLayer, normalizeShape } from './validate';

export { parseTransform } from './svg-transform';

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
/** Số phần tử tối đa được duyệt (kể cả qua `<use>`), chặn tệp độc hại nhân bản lồng nhau. */
const MAX_VISITS = 200_000;
/** Độ sâu lồng nhau tối đa của phần tử (chặn tràn ngăn xếp với tệp lồng cực sâu). */
const MAX_DEPTH = 256;
const SKIPPED = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'title', 'desc', 'metadata', 'style', 'script', 'lineargradient', 'radialgradient', 'filter', 'marker', 'font', 'font-face', 'cursor', 'view']);
const ANIMATION = new Set(['animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set']);
const UNSUPPORTED: Record<string, string> = { text: 'chữ', tspan: 'chữ', textpath: 'chữ', image: 'ảnh', foreignobject: 'nội dung nhúng' };
const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINER_TAGS = new Set(['g', 'a', 'svg', 'switch', 'use']);
const EPS = 1e-6;

const tagOf = (element: Element) => element.localName.toLowerCase();
const det = (matrix: Matrix) => matrix[0] * matrix[3] - matrix[1] * matrix[2];

/** Lớp vẽ trong mặt nạ hoặc tổ hợp mặt nạ, tính theo toạ độ lưới. */
interface MaskState {
  readonly kind: 'mask' | 'clip';
  readonly layers: readonly IconShape[];
  /** Đa giác lồi của vùng cắt (chỉ có khi vùng cắt là một đa giác lồi thẳng cạnh); dùng để bỏ cắt khi hình nằm trọn bên trong. */
  readonly polygon: readonly Point[] | null;
  /** Lớp đen phủ phần ngoài vùng cắt, để giao vùng cắt này với mặt nạ khác; null nếu không dựng được. */
  readonly complement: IconShape | null;
}

interface MaskMode {
  readonly alpha: boolean;
  readonly out: IconShape[];
}

interface Context {
  readonly matrix: Matrix;
  readonly style: Style;
  readonly viewport: ViewportSize;
  /** Hộp tham chiếu `view-box` cho `transform-origin`. */
  readonly viewBox: Rect;
  readonly masks: readonly MaskState[];
  readonly stack: readonly Element[];
  /** Đang gom lớp cho nội dung `<mask>`. */
  readonly mode: MaskMode | null;
  /** Chỉ đo khung bao, không tạo hình. */
  readonly sink: Rect[] | null;
}

interface ResolvedPaint {
  readonly paint: Paint;
  readonly alpha: number;
}

interface LayerSpec {
  readonly fill: ResolvedPaint | null;
  readonly stroke: ResolvedPaint | null;
  readonly fillOpacity: number;
  readonly opacity: number;
}

interface Flags {
  unsupported: Set<string>;
  filter: boolean;
  pattern: boolean;
  markers: boolean;
  blend: boolean;
  animation: boolean;
  nonUniformStroke: boolean;
  nonScalingStroke: boolean;
  groupOpacity: boolean;
  splitOpacity: boolean;
  maskConflict: boolean;
  maskRegion: boolean;
  clipUnsupported: boolean;
  maskUnsupported: boolean;
  missingReference: boolean;
  badTransform: boolean;
  oversized: boolean;
  truncated: boolean;
  maskTruncated: boolean;
  budget: boolean;
  pathLength: boolean;
  noSize: boolean;
}

const emptyFlags = (): Flags => ({
  unsupported: new Set(),
  filter: false,
  pattern: false,
  markers: false,
  blend: false,
  animation: false,
  nonUniformStroke: false,
  nonScalingStroke: false,
  groupOpacity: false,
  splitOpacity: false,
  maskConflict: false,
  maskRegion: false,
  clipUnsupported: false,
  maskUnsupported: false,
  missingReference: false,
  badTransform: false,
  oversized: false,
  truncated: false,
  maskTruncated: false,
  budget: false,
  pathLength: false,
  noSize: false,
});

function parseViewBox(element: Element): Rect | null {
  const parts = (element.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
    ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
    : null;
}

/** Phép đưa hệ toạ độ `viewBox` vào khung nhìn rộng `width` x `height`, theo `preserveAspectRatio`. */
function viewBoxMatrix(viewBox: Rect | null, aspect: string | null, width: number, height: number): Matrix {
  if (!viewBox) return IDENTITY;
  const tokens = (aspect ?? '').trim().split(/\s+/).filter((token) => token && token !== 'defer');
  const align = tokens[0] ?? 'xMidYMid';
  if (align === 'none') {
    const sx = width / viewBox.width;
    const sy = height / viewBox.height;
    return [sx, 0, 0, sy, -viewBox.x * sx, -viewBox.y * sy];
  }
  const slice = tokens[1] === 'slice';
  const scale = slice ? Math.max(width / viewBox.width, height / viewBox.height) : Math.min(width / viewBox.width, height / viewBox.height);
  const ax = align.startsWith('xMin') ? 0 : align.startsWith('xMax') ? 1 : 0.5;
  const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  return [scale, 0, 0, scale, ax * (width - viewBox.width * scale) - viewBox.x * scale, ay * (height - viewBox.height * scale) - viewBox.y * scale];
}

/** Đọc `d` kể cả khi có lỗi ở giữa: như trình duyệt, vẽ phần đứng trước chỗ lỗi. */
function parsePathLenient(data: string): { geometry: PathGeometry | null; truncated: boolean } {
  try {
    return { geometry: parsePathData(data), truncated: false };
  } catch {
    const starts = [...data.matchAll(/[A-DF-Za-df-z]/g)].map((match) => match.index ?? 0);
    let low = 0;
    let high = starts.length - 1;
    let best: PathGeometry | null = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      try {
        best = parsePathData(data.slice(0, starts[mid]));
        low = mid + 1;
      } catch {
        high = mid - 1;
      }
    }
    return { geometry: best && best.subpaths.length > 0 ? best : null, truncated: true };
  }
}

/** Rect góc bo elip (`rx` khác `ry`) thành đường, vì lớp hình chỉ có rect bo tròn đều. */
function roundedRectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): PathGeometry {
  const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  return parsePathData(d);
}

/** Phép biến đổi giữ nguyên rect bo tròn (co giãn đều hoặc xoay bội 90 độ có tỷ lệ đều). */
function keepsRoundedRect(matrix: Matrix): boolean {
  const [a, b, c, d] = matrix;
  const straight = Math.abs(b) < EPS && Math.abs(c) < EPS && Math.abs(Math.abs(a) - Math.abs(d)) < EPS * Math.max(1, Math.abs(a));
  const quarter = Math.abs(a) < EPS && Math.abs(d) < EPS && Math.abs(Math.abs(b) - Math.abs(c)) < EPS * Math.max(1, Math.abs(b));
  return straight || quarter;
}

const round5 = (value: number) => roundTo(value, 5) || 0;
const roundPoint = (point: Point): Point => ({ x: round5(point.x), y: round5(point.y) });

/** Làm tròn toạ độ đến 5 chữ số thập phân (0,00001 ô lưới) để bỏ nhiễu dấu phẩy động sau khi biến đổi. */
function roundGeometry(geometry: Geometry): Geometry {
  if (geometry.type === 'rect') {
    return { type: 'rect', x: round5(geometry.x), y: round5(geometry.y), width: round5(geometry.width), height: round5(geometry.height), rx: round5(geometry.rx) };
  }
  if (geometry.type === 'ellipse') return { type: 'ellipse', cx: round5(geometry.cx), cy: round5(geometry.cy), rx: round5(geometry.rx), ry: round5(geometry.ry) };
  return {
    type: 'path',
    subpaths: geometry.subpaths.map((sub) => ({
      closed: sub.closed,
      nodes: sub.nodes.map((node) => ({
        ...roundPoint(node),
        ...(node.hin ? { hin: roundPoint(node.hin) } : {}),
        ...(node.hout ? { hout: roundPoint(node.hout) } : {}),
      })),
    })),
  };
}

function bake(geometry: Geometry, matrix: Matrix): Geometry {
  if (geometry.type === 'rect' && geometry.rx > 0 && !keepsRoundedRect(matrix)) return roundGeometry(transformGeometry(geometryToPath(geometry), matrix));
  return roundGeometry(transformGeometry(geometry, matrix));
}

/** Đa giác lồi (các đỉnh) của một hình chỉ có cạnh thẳng; null với hình cong, không lồi hoặc có nhiều đường con. */
function convexPolygon(geometry: Geometry): Point[] | null {
  let points: Point[];
  if (geometry.type === 'rect') {
    if (geometry.rx > 0) return null;
    points = [
      { x: geometry.x, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
      { x: geometry.x, y: geometry.y + geometry.height },
    ];
  } else if (geometry.type === 'path') {
    if (geometry.subpaths.length !== 1) return null;
    const sub = geometry.subpaths[0];
    if (sub.nodes.some((node) => node.hin || node.hout) || sub.nodes.length < 3) return null;
    points = sub.nodes.map((node) => ({ x: node.x, y: node.y }));
  } else return null;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < EPS) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return null;
  }
  return sign === 0 ? null : points;
}

/** Hình chữ nhật `rect` nằm trọn trong đa giác lồi `polygon`. */
function polygonContains(polygon: readonly Point[], rect: Rect): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const edge = (b.x - a.x) * (polygon[(index + 2) % polygon.length].y - b.y) - (b.y - a.y) * (polygon[(index + 2) % polygon.length].x - b.x);
    if (Math.abs(edge) > EPS && sign === 0) sign = Math.sign(edge);
    for (const corner of corners) {
      const side = (b.x - a.x) * (corner.y - a.y) - (b.y - a.y) * (corner.x - a.x);
      if (sign !== 0 && side * sign < -EPS) return false;
    }
  }
  return true;
}

const REFERENCE = /url\(\s*['"]?#([^'")\s]+)/i;
const refId = (value: string): string | null => REFERENCE.exec(value)?.[1] ?? null;

class Importer {
  private readonly root: Element;
  private readonly size: number;
  private readonly options: SvgImportOptions;
  private readonly sheet: Stylesheet;
  private readonly byId = new Map<string, Element>();
  private readonly gradients = new Map<string, GradientSource | null>();
  private readonly warnings: string[] = [];
  private readonly flags = emptyFlags();
  private readonly shapes: IconShape[] = [];
  private readonly strokeWidths: number[] = [];
  private visits = MAX_VISITS;
  private depth = 0;

  constructor(markup: string, options: SvgImportOptions) {
    this.root = parseSvgMarkup(markup);
    this.options = options;
    this.size = options.size ?? DEFAULT_SIZE;
    this.sheet = new Stylesheet(this.root);
    if (this.root.getAttribute('id')) this.byId.set(this.root.getAttribute('id') as string, this.root);
    for (const element of Array.from(this.root.querySelectorAll('[id]'))) {
      const id = element.getAttribute('id');
      if (id && !this.byId.has(id)) this.byId.set(id, element);
    }
  }

  run(): SvgImportResult {
    const size = this.size;
    const root = this.root;
    const box = parseViewBox(root);
    const lengthOf = (name: string): number | null => {
      const raw = root.getAttribute(name);
      if (raw === null || raw.trim().endsWith('%')) return null;
      const value = parseLength(raw, { fontSize: DEFAULT_FONT_SIZE, percentBase: 0 });
      return value !== null && value > 0 ? value : null;
    };
    let width = lengthOf('width');
    let height = lengthOf('height');
    if (box) {
      if (width === null && height === null) {
        width = box.width;
        height = box.height;
      } else if (width === null) width = (height as number) * (box.width / box.height);
      else if (height === null) height = width * (box.height / box.width);
    } else if (width === null || height === null) {
      this.flags.noSize = width === null && height === null;
      width = width ?? height ?? size;
      height = height ?? width;
    }
    const viewportWidth = width as number;
    const viewportHeight = height as number;

    const fit = size / Math.max(viewportWidth, viewportHeight, 1e-6);
    const toGrid: Matrix = [fit, 0, 0, fit, (size - viewportWidth * fit) / 2, (size - viewportHeight * fit) / 2];
    const base = multiply(toGrid, viewBoxMatrix(box, root.getAttribute('preserveAspectRatio'), viewportWidth, viewportHeight));
    if (Math.abs(fit - 1) > EPS) this.warnings.push(`Đã co SVG gốc ${roundTo(viewportWidth, 2)}x${roundTo(viewportHeight, 2)} về lưới ${size}x${size}.`);

    if (root.querySelector('animate, animateTransform, animateMotion, animateColor, set')) this.flags.animation = true;
    const masks: MaskState[] = [];
    if (Math.abs(viewportWidth - viewportHeight) > EPS) masks.push(this.rectClip({ x: 0, y: 0, width: viewportWidth, height: viewportHeight }, toGrid));

    const userBox: Rect = box ?? { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
    this.visit(root, {
      matrix: base,
      style: INITIAL_STYLE,
      viewport: { width: userBox.width, height: userBox.height },
      viewBox: userBox,
      masks,
      stack: [],
      mode: null,
      sink: null,
    });
    return this.finish();
  }

  private finish(): SvgImportResult {
    const flags = this.flags;
    const warn = (condition: boolean, text: string) => {
      if (condition) this.warnings.push(text);
    };
    warn(flags.noSize, 'SVG không có viewBox hoặc kích thước; coi như lưới đích.');
    warn(flags.truncated, `Chỉ nhập ${MAX_SHAPES} hình đầu tiên.`);
    warn(flags.budget, 'SVG có quá nhiều phần tử (hoặc lặp <use> lồng nhau); phần còn lại bị bỏ qua.');
    warn(flags.oversized, 'Có hình quá lớn hoặc quá phức tạp (vượt giới hạn toạ độ hay số điểm) nên bị bỏ qua.');
    warn(flags.unsupported.size > 0, `SVG có ${[...flags.unsupported].join(', ')} mà Studio không nhập được; phần đó bị bỏ qua (hãy chuyển chữ thành đường nét trước khi xuất).`);
    warn(flags.filter, 'SVG dùng bộ lọc (filter: đổ bóng, làm mờ...) mà Studio không hỗ trợ; hình được nhập không có hiệu ứng đó.');
    warn(flags.pattern, 'SVG dùng hoa văn lặp (pattern) mà Studio không đọc được; thay bằng một màu đơn.');
    warn(flags.markers, 'SVG dùng đầu mũi tên/điểm đánh dấu (marker) mà Studio không nhập; phần đó bị bỏ qua.');
    warn(flags.blend, 'SVG dùng chế độ hoà trộn (mix-blend-mode) mà Studio không hỗ trợ; hình được nhập theo chế độ thường.');
    warn(flags.animation, 'SVG có hiệu ứng chuyển động (animate, @keyframes); Studio chỉ nhập hình tĩnh ban đầu.');
    warn(flags.nonUniformStroke, 'Có nét bị co giãn lệch trục hoặc nghiêng; Studio dùng độ dày nét trung bình nên nét có thể lệch nhẹ.');
    warn(flags.nonScalingStroke, 'SVG dùng nét không co giãn (non-scaling-stroke); Studio co nét theo hình như thường.');
    warn(flags.groupOpacity, 'Nhóm có độ mờ chung mà các hình chồng lên nhau; Studio áp độ mờ cho từng hình nên chỗ chồng có thể đậm hơn gốc.');
    warn(flags.splitOpacity, 'Hình có cả tô và nét với độ mờ riêng; chỗ nét đè lên phần tô có thể lệch nhẹ so với gốc.');
    warn(flags.maskConflict, 'Có phần tử chịu nhiều mặt nạ/vùng cắt chồng nhau không giao được; Studio chỉ giữ một.');
    warn(flags.maskRegion, 'Vùng của mặt nạ hoặc khung của <svg> lồng cắt bớt hình; phần cắt đó không được áp dụng chính xác.');
    warn(flags.clipUnsupported, 'SVG có vùng cắt (clip-path) dạng hình CSS hoặc không đọc được; phần cắt đó bị bỏ qua.');
    warn(flags.maskUnsupported, 'SVG có mặt nạ không đọc được; phần che bằng mặt nạ đó bị bỏ qua.');
    warn(flags.missingReference, 'SVG tham chiếu tới mặt nạ, màu hay phần tử không có trong tệp; phần đó được nhập như không có tham chiếu.');
    warn(flags.badTransform, 'Có phép biến đổi (transform) dùng đơn vị mà Studio không đọc được; phần đó bị bỏ qua.');
    warn(flags.maskTruncated, `Một mặt nạ có hơn ${LIMITS.maxMaskLayers} hình; chỉ giữ ${LIMITS.maxMaskLayers} hình đầu.`);
    warn(flags.pathLength, 'SVG dùng pathLength cho nét đứt; Studio dùng độ dài thật của đường.');
    for (const name of this.sheet.skipped) {
      if (name === 'keyframes' || name === 'media' || name === 'supports' || name === 'container') {
        this.warnings.push(
          name === 'keyframes' ? 'SVG có hoạt hình CSS (@keyframes); Studio chỉ nhập hình tĩnh.' : `SVG có luật CSS @${name} mà Studio không áp dụng; kiểu bên trong bị bỏ qua.`,
        );
      }
    }
    if (this.shapes.length === 0) {
      throw new Error(
        flags.budget
          ? 'SVG lồng nhau quá sâu hoặc có quá nhiều phần tử nên không nhập được.'
          : flags.unsupported.size > 0
          ? `SVG chỉ có ${[...flags.unsupported].join(', ')} mà Studio không nhập được${flags.unsupported.has('chữ') ? '. Hãy chuyển chữ thành đường nét (outline) trước khi xuất SVG' : ''}.`
          : 'Không tìm thấy hình nào (path, rect, circle, line...) trong SVG.',
      );
    }

    const counts = new Map<number, number>();
    for (const width of this.strokeWidths) counts.set(width, (counts.get(width) ?? 0) + 1);
    let dominant: number | null = null;
    let best = 0;
    for (const [width, count] of counts) {
      if (count > best) {
        dominant = width;
        best = count;
      }
    }
    return { shapes: this.shapes, warnings: [...new Set(this.warnings)], dominantStrokeWidth: dominant };
  }

  /* ---------- duyệt cây ---------- */

  private lengthContext(ctx: Context, style: Style, axis: 'x' | 'y' | 'r') {
    const base = axis === 'x' ? ctx.viewport.width : axis === 'y' ? ctx.viewport.height : Math.hypot(ctx.viewport.width, ctx.viewport.height) / Math.SQRT2;
    return { fontSize: style.fontSize, percentBase: base };
  }

  private length(element: Element, name: string, ctx: Context, style: Style, axis: 'x' | 'y' | 'r', fallback = 0): number {
    return parseLength(element.getAttribute(name), this.lengthContext(ctx, style, axis)) ?? fallback;
  }

  private transformOf(element: Element, local: LocalProps, ctx: Context, style: Style): Matrix {
    if (!local.transform) return IDENTITY;
    const { matrix, bad } = parseTransformList(local.transform);
    if (bad) this.flags.badTransform = true;
    if (!local.transformOrigin) return matrix;

    const tokens = local.transformOrigin.trim().split(/\s+/);
    const useBox = local.transformBox === 'fill-box' || local.transformBox === 'stroke-box' || local.transformBox === 'border-box' || local.transformBox === 'content-box';
    const box = (useBox ? this.localBounds(element, ctx) : null) ?? ctx.viewBox;
    const coordinate = (token: string | undefined, axis: 'x' | 'y', fallback: number): number => {
      if (token === undefined) return fallback;
      const lower = token.toLowerCase();
      const start = axis === 'x' ? box.x : box.y;
      const span = axis === 'x' ? box.width : box.height;
      if (lower === 'left' || lower === 'top') return start;
      if (lower === 'right' || lower === 'bottom') return start + span;
      if (lower === 'center') return start + span / 2;
      const value = parseLength(token, { fontSize: style.fontSize, percentBase: span });
      return value === null ? fallback : start + value;
    };
    let first = tokens[0];
    let second = tokens[1];
    if (first && (first.toLowerCase() === 'top' || first.toLowerCase() === 'bottom') && second) [first, second] = [second, first];
    const ox = coordinate(first, 'x', box.x);
    const oy = coordinate(second ?? (first && ['top', 'bottom'].includes(first.toLowerCase()) ? 'center' : undefined), 'y', box.y + box.height / 2);
    return multiply(multiply(translation(ox, oy), matrix), translation(-ox, -oy));
  }

  private visit(element: Element, ctx: Context): void {
    if (this.depth >= MAX_DEPTH) {
      this.flags.budget = true;
      return;
    }
    this.depth += 1;
    try {
      this.visitNode(element, ctx);
    } finally {
      this.depth -= 1;
    }
  }

  private visitNode(element: Element, ctx: Context): void {
    if (this.flags.truncated) return;
    if (this.visits <= 0) {
      this.flags.budget = true;
      return;
    }
    this.visits -= 1;
    const tag = tagOf(element);
    if (SKIPPED.has(tag)) return;
    if (ANIMATION.has(tag)) {
      this.flags.animation = true;
      return;
    }
    const unsupported = UNSUPPORTED[tag];
    if (unsupported) {
      this.flags.unsupported.add(unsupported);
      return;
    }

    const { style, local } = computeStyle(this.sheet.declared(element), ctx.style, ctx.viewport, this.warnings);
    if (!local.display) return;
    if (local.filter) this.flags.filter = true;
    if (local.blend) this.flags.blend = true;
    const own = multiply(ctx.matrix, this.transformOf(element, local, ctx, style));

    let masks = ctx.masks;
    if (!ctx.sink && (local.clipPath || local.mask)) {
      const built = this.buildMasks(element, own, local, style, ctx);
      if (built === 'hidden') return;
      if (built.length > 0) masks = [...masks, ...built];
    }

    if (CONTAINER_TAGS.has(tag)) {
      this.visitContainer(element, tag, own, style, local, { ...ctx, style, masks }, ctx.style.opacity);
      return;
    }
    if (!SHAPE_TAGS.has(tag)) return;

    const geometry = this.geometryOf(element, tag, style, ctx);
    if (!geometry) return;
    if (ctx.sink) {
      ctx.sink.push(geometryBounds(transformGeometry(geometry, own)));
      return;
    }
    if (local.markers && tag !== 'rect' && tag !== 'circle' && tag !== 'ellipse') this.flags.markers = true;
    if (local.nonScaling) this.flags.nonScalingStroke = true;
    if (style.dasharray && element.hasAttribute('pathLength')) this.flags.pathLength = true;
    this.emit(element, geometry, own, style, { ...ctx, masks });
  }

  private visitChildren(element: Element, ctx: Context): void {
    for (const child of Array.from(element.children)) this.visit(child, ctx);
  }

  private visitContainer(element: Element, tag: string, own: Matrix, style: Style, local: LocalProps, ctx: Context, parentOpacity: number): void {
    const startIndex = this.shapes.length;
    const inner: Context = { ...ctx, matrix: own, style };

    if (tag === 'g' || tag === 'a') this.visitChildren(element, inner);
    else if (tag === 'switch') {
      const first = Array.from(element.children).find((child) => !['title', 'desc', 'metadata'].includes(tagOf(child)));
      if (first) this.visit(first, inner);
    } else if (tag === 'svg') this.visitViewport(element, element, own, style, local, inner, null);
    else this.visitUse(element, own, style, inner);

    if (!ctx.sink && !ctx.mode && element !== this.root) this.checkGroupOpacity(startIndex, style.opacity, parentOpacity);
  }

  /** Nhóm có độ mờ riêng nhưng con chồng lên nhau: áp độ mờ từng hình sẽ khác gốc ở chỗ chồng. */
  private checkGroupOpacity(startIndex: number, accumulated: number, parentOpacity: number): void {
    // chỉ xét độ mờ riêng của nhóm này: nhóm cha đã tự kiểm tra phần của nó
    if (accumulated >= parentOpacity - 1e-6 || this.shapes.length - startIndex < 2) return;
    const slice = this.shapes.slice(startIndex, startIndex + 60);
    for (let first = 0; first < slice.length; first += 1) {
      for (let second = first + 1; second < slice.length; second += 1) {
        if (rectsIntersect(visualBounds(slice[first]), visualBounds(slice[second]))) {
          this.flags.groupOpacity = true;
          return;
        }
      }
    }
  }

  /** Thẻ `<svg>` hoặc `<symbol>` mở khung nhìn mới: toạ độ, `viewBox`, `preserveAspectRatio` và cắt phần tràn. */
  private visitViewport(
    element: Element,
    source: Element,
    own: Matrix,
    style: Style,
    local: LocalProps,
    ctx: Context,
    override: { width: number | null; height: number | null } | null,
  ): void {
    if (element === this.root && source === this.root) {
      this.visitChildren(element, ctx);
      return;
    }
    const x = source.tagName.toLowerCase() === 'symbol' ? 0 : this.length(source, 'x', ctx, style, 'x');
    const y = source.tagName.toLowerCase() === 'symbol' ? 0 : this.length(source, 'y', ctx, style, 'y');
    const width = override?.width ?? this.length(source, 'width', ctx, style, 'x', ctx.viewport.width);
    const height = override?.height ?? this.length(source, 'height', ctx, style, 'y', ctx.viewport.height);
    if (width <= 0 || height <= 0) return;
    const box = parseViewBox(source);
    const matrix = multiply(own, multiply(translation(x, y), viewBoxMatrix(box, source.getAttribute('preserveAspectRatio'), width, height)));
    const masks = [...ctx.masks];
    if (!ctx.sink && !local.overflowVisible) masks.push(this.rectClip({ x: 0, y: 0, width, height }, multiply(own, translation(x, y))));
    const viewBox = box ?? { x: 0, y: 0, width, height };
    this.visitChildren(source, { ...ctx, matrix, masks, viewport: { width: viewBox.width, height: viewBox.height }, viewBox });
  }

  private visitUse(element: Element, own: Matrix, style: Style, ctx: Context): void {
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
    const target = href && href.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
    if (!target) {
      this.flags.missingReference = true;
      return;
    }
    if (ctx.stack.includes(target) || target === element) return;
    const x = this.length(element, 'x', ctx, style, 'x');
    const y = this.length(element, 'y', ctx, style, 'y');
    const placed = multiply(own, translation(x, y));
    const stack = [...ctx.stack, target];
    const targetTag = tagOf(target);

    if (targetTag === 'symbol' || targetTag === 'svg') {
      const computed = computeStyle(this.sheet.declared(target), style, ctx.viewport, this.warnings);
      const hasWidth = element.hasAttribute('width');
      const hasHeight = element.hasAttribute('height');
      const override = {
        width: hasWidth ? this.length(element, 'width', ctx, style, 'x') : null,
        height: hasHeight ? this.length(element, 'height', ctx, style, 'y') : null,
      };
      this.visitViewport(target, target, placed, computed.style, computed.local, { ...ctx, style: computed.style, stack }, override);
      return;
    }
    this.visit(target, { ...ctx, matrix: placed, style, stack });
  }

  /* ---------- khung bao ---------- */

  /** Khung bao hình học của phần tử trong toạ độ cục bộ của nó (chưa tính `transform` của chính nó). */
  private localBounds(element: Element, ctx: Context): Rect | null {
    const tag = tagOf(element);
    const sub: Context = { ...ctx, matrix: IDENTITY, masks: [], mode: null, sink: [] };
    if (SHAPE_TAGS.has(tag)) {
      const { style } = computeStyle(this.sheet.declared(element), ctx.style, ctx.viewport, []);
      const geometry = this.geometryOf(element, tag, style, ctx, false);
      return geometry ? geometryBounds(geometry) : null;
    }
    const { style, local } = computeStyle(this.sheet.declared(element), ctx.style, ctx.viewport, []);
    const inner: Context = { ...sub, style };
    if (tag === 'use') this.visitUse(element, IDENTITY, style, inner);
    else if (tag === 'svg') this.visitViewport(element, element, IDENTITY, style, local, inner, null);
    else this.visitChildren(element, inner);
    return sub.sink ? unionRects(sub.sink) : null;
  }

  /* ---------- hình học ---------- */

  private geometryOf(element: Element, tag: string, style: Style, ctx: Context, report = true): Geometry | null {
    const at = (name: string, axis: 'x' | 'y' | 'r', fallback = 0) => this.length(element, name, ctx, style, axis, fallback);
    switch (tag) {
      case 'path': {
        const data = element.getAttribute('d') ?? '';
        if (data.length > MAX_PATH_DATA_LENGTH) {
          if (report) this.flags.oversized = true;
          return null;
        }
        const { geometry, truncated } = parsePathLenient(data);
        if (truncated && report) this.warnings.push('Một đường có dữ liệu sai ở giữa; chỉ nhập phần đứng trước chỗ sai (như trình duyệt vẽ).');
        // chỉ toàn điểm `M` lẻ loi thì không vẽ gì
        const drawn = geometry?.subpaths.some((sub) => sub.nodes.length >= 2 || sub.closed) ?? false;
        return geometry && drawn ? geometry : null;
      }
      case 'rect': {
        const width = at('width', 'x');
        const height = at('height', 'y');
        if (width <= 0 || height <= 0) return null;
        const x = at('x', 'x');
        const y = at('y', 'y');
        const rawRx = element.hasAttribute('rx') ? at('rx', 'x', -1) : -1;
        const rawRy = element.hasAttribute('ry') ? at('ry', 'y', -1) : -1;
        let rx = rawRx >= 0 ? rawRx : rawRy >= 0 ? rawRy : 0;
        let ry = rawRy >= 0 ? rawRy : rawRx >= 0 ? rawRx : 0;
        rx = Math.min(rx, width / 2);
        ry = Math.min(ry, height / 2);
        if (rx <= EPS || ry <= EPS) return { type: 'rect', x, y, width, height, rx: 0 };
        if (Math.abs(rx - ry) < 1e-9) return { type: 'rect', x, y, width, height, rx };
        return roundedRectPath(x, y, width, height, rx, ry);
      }
      case 'circle': {
        const r = at('r', 'r');
        return r > 0 ? { type: 'ellipse', cx: at('cx', 'x'), cy: at('cy', 'y'), rx: r, ry: r } : null;
      }
      case 'ellipse': {
        const rawRx = element.hasAttribute('rx') ? at('rx', 'x', -1) : -1;
        const rawRy = element.hasAttribute('ry') ? at('ry', 'y', -1) : -1;
        const rx = rawRx >= 0 ? rawRx : rawRy;
        const ry = rawRy >= 0 ? rawRy : rawRx;
        return rx > 0 && ry > 0 ? { type: 'ellipse', cx: at('cx', 'x'), cy: at('cy', 'y'), rx, ry } : null;
      }
      case 'line':
        return {
          type: 'path',
          subpaths: [{ closed: false, nodes: [{ x: at('x1', 'x'), y: at('y1', 'y') }, { x: at('x2', 'x'), y: at('y2', 'y') }] }],
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

  /* ---------- paint ---------- */

  private gradientSource(id: string): GradientSource | null {
    if (this.gradients.has(id)) return this.gradients.get(id) ?? null;
    const target = this.byId.get(id);
    const source = target
      ? readGradient(target, {
          declared: (element) => this.sheet.declared(element),
          byId: this.byId,
          parseTransform: (value) => {
            const { matrix, bad } = parseTransformList(value);
            if (bad) this.flags.badTransform = true;
            return matrix;
          },
          warnings: this.warnings,
        })
      : null;
    this.gradients.set(id, source);
    return source;
  }

  /** Trắng hoá màu của dải màu (mặt nạ `alpha`): chỉ giữ độ đặc. */
  private whiten(paint: Paint): Paint {
    const gradient = parseGradient(paint);
    if (!gradient) return '#ffffff';
    return formatGradientObject({ ...gradient, stops: gradient.stops.map((stop) => ({ ...stop, color: '#ffffff' })) }) ?? '#ffffff';
  }

  private resolvePaint(spec: PaintSpec, own: Matrix, bounds: Rect, style: Style, ctx: Context): ResolvedPaint | null {
    const mode = ctx.mode;
    switch (spec.type) {
      case 'none':
        return null;
      case 'color': {
        let hex = spec.color;
        let alpha = spec.alpha;
        if (hex === 'currentColor') {
          if (style.color) {
            hex = style.color.hex;
            alpha *= style.color.alpha;
          } else if (mode) hex = '#000000';
        }
        if (alpha <= 0.0005) return null;
        if (mode?.alpha) return { paint: '#ffffff', alpha };
        if (!mode && hex === '#000000') return { paint: 'currentColor', alpha };
        return { paint: hex, alpha };
      }
      default: {
        const target = this.byId.get(spec.id);
        const fallback = () => (spec.fallback ? this.resolvePaint(spec.fallback, own, bounds, style, ctx) : null);
        if (!target) {
          if (!spec.fallback) this.flags.missingReference = true;
          return fallback();
        }
        const tag = tagOf(target);
        if (tag === 'pattern') {
          this.flags.pattern = true;
          return fallback() ?? (mode ? { paint: '#808080', alpha: 1 } : { paint: 'currentColor', alpha: 1 });
        }
        const source = this.gradientSource(spec.id);
        if (!source) return fallback();
        const resolved: ResolvedGradient = resolveGradient(source, { own, bounds, size: this.size, viewport: ctx.viewport }, this.warnings);
        if (resolved.type === 'none') return null;
        if (resolved.type === 'solid') {
          if (resolved.alpha <= 0.0005) return null;
          if (mode?.alpha) return { paint: '#ffffff', alpha: resolved.alpha };
          return { paint: !mode && resolved.color === '#000000' ? 'currentColor' : resolved.color, alpha: resolved.alpha };
        }
        return { paint: mode?.alpha ? this.whiten(resolved.paint) : resolved.paint, alpha: 1 };
      }
    }
  }

  /* ---------- tạo hình ---------- */

  private emit(element: Element, geometry: Geometry, own: Matrix, style: Style, ctx: Context): void {
    if (!style.visible) return;
    const mode = ctx.mode;
    const scale = Math.sqrt(Math.abs(det(own)));
    const bounds = geometryBounds(geometry);

    const fill = this.resolvePaint(style.fill, own, bounds, style, ctx);
    let stroke = style.stroke.type !== 'none' && style.strokeWidth * scale > EPS ? this.resolvePaint(style.stroke, own, bounds, style, ctx) : null;
    if (!fill && !stroke) return;

    if (stroke) {
      const sx = Math.hypot(own[0], own[1]);
      const sy = Math.hypot(own[2], own[3]);
      const skew = Math.abs(own[0] * own[2] + own[1] * own[3]) / Math.max(sx * sy, EPS);
      if (Math.abs(sx - sy) / Math.max(sx, sy, EPS) > 0.01 || skew > 0.01) this.flags.nonUniformStroke = true;
    } else stroke = null;

    const fillAlpha = style.fillOpacity * (fill?.alpha ?? 1);
    const strokeAlpha = style.strokeOpacity * (stroke?.alpha ?? 1);
    const opacity = style.opacity;
    const layers: LayerSpec[] = [];
    if (fill && stroke) {
      if (strokeAlpha > 0.999 && !style.strokeFirst) layers.push({ fill, stroke, fillOpacity: fillAlpha, opacity });
      else {
        const fillLayer: LayerSpec = { fill, stroke: null, fillOpacity: fillAlpha, opacity };
        const strokeLayer: LayerSpec = { fill: null, stroke, fillOpacity: style.fillOpacity, opacity: opacity * strokeAlpha };
        layers.push(...(style.strokeFirst ? [strokeLayer, fillLayer] : [fillLayer, strokeLayer]));
        if (opacity < 0.999) this.flags.splitOpacity = true;
      }
    } else if (fill) layers.push({ fill, stroke: null, fillOpacity: fillAlpha, opacity });
    else layers.push({ fill: null, stroke, fillOpacity: style.fillOpacity, opacity: opacity * strokeAlpha });

    const baked = bake(geometry, own);
    const label = element.getAttribute('id');
    const strokeWidth = !mode && this.options.strokeWidth !== undefined ? this.options.strokeWidth : roundTo(style.strokeWidth * scale, 4);
    const dashes = style.dasharray?.map((value) => roundTo(value * scale, 4));

    for (const layer of layers) {
      if (this.flags.truncated) return;
      const hasStroke = layer.stroke !== null;
      const candidate = createShape(baked, {
        ...(label && !mode ? { name: label.slice(0, 40) } : {}),
        fill: layer.fill ? layer.fill.paint : 'none',
        fillOpacity: roundTo(layer.fillOpacity, 4),
        stroke: layer.stroke ? layer.stroke.paint : 'none',
        strokeWidth: hasStroke ? strokeWidth : DEFAULT_SHAPE_STYLE.strokeWidth,
        opacity: roundTo(layer.opacity, 4),
        linecap: style.linecap,
        linejoin: style.linejoin,
        fillRule: style.fillRule,
        ...(hasStroke && dashes ? { strokeDasharray: dashes, ...(style.dashoffset ? { strokeDashoffset: roundTo(style.dashoffset * scale, 4) } : {}) } : {}),
        ...(hasStroke && style.miterlimit !== 4 ? { strokeMiterlimit: style.miterlimit } : {}),
      });

      if (mode) {
        this.pushMaskLayer(candidate, mode);
        continue;
      }
      const mask = this.composeMask(ctx.masks, this.coverBounds(candidate));
      if (mask === 'hidden') continue;
      const shape = normalizeShape(mask ? { ...candidate, mask } : candidate);
      if (!shape) {
        this.flags.oversized = true;
        continue;
      }
      if (this.shapes.length >= MAX_SHAPES) {
        this.flags.truncated = true;
        return;
      }
      if (hasStroke) this.strokeWidths.push(shape.strokeWidth);
      this.shapes.push(shape);
    }
  }

  /** Khung bao của hình dùng để xét có nằm trọn trong vùng cắt hay không: tính dư phần nét nối nhọn và đầu vuông. */
  private coverBounds(shape: IconShape): Rect {
    const box = geometryBounds(shape.geometry);
    if (shape.stroke === 'none') return box;
    const geometry = shape.geometry;
    const hasCorners =
      geometry.type === 'rect' ? geometry.rx === 0 : geometry.type === 'path' && geometry.subpaths.some((sub) => (sub.closed ? sub.nodes.length : sub.nodes.length - 1) > 1);
    const open = geometry.type === 'path' && geometry.subpaths.some((sub) => !sub.closed);
    const join = hasCorners && shape.linejoin === 'miter' ? Math.max(2, Math.min(shape.strokeMiterlimit ?? 4, 6)) : 1;
    const cap = open && shape.linecap === 'square' ? 1.5 : 1;
    const extra = (shape.strokeWidth / 2) * Math.max(join, cap);
    return { x: box.x - extra, y: box.y - extra, width: box.width + extra * 2, height: box.height + extra * 2 };
  }

  private pushMaskLayer(candidate: IconShape, mode: MaskMode): void {
    const layer = normalizeMaskLayer(candidate);
    if (!layer) {
      this.flags.oversized = true;
      return;
    }
    // Hình đen đặc dưới cùng (nền "ẩn hết" quen thuộc của mặt nạ) không tác dụng vì chưa có gì bên dưới để che: bỏ cho gọn.
    const plainBlack = layer.fill === '#000000' && layer.stroke === 'none' && layer.opacity >= 1 && layer.fillOpacity >= 1;
    if (mode.out.length === 0 && plainBlack) return;
    if (mode.out.length >= LIMITS.maxMaskLayers) {
      this.flags.maskTruncated = true;
      return;
    }
    mode.out.push(layer);
  }

  /* ---------- mặt nạ và vùng cắt ---------- */

  private rectClip(rect: Rect, matrix: Matrix): MaskState {
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((point) => applyMatrix(matrix, point));
    const geometry: Geometry = { type: 'path', subpaths: [{ closed: true, nodes: corners }] };
    return this.clipState([this.whiteLayer(geometry, 'nonzero')].filter((layer): layer is IconShape => layer !== null), geometry);
  }

  private whiteLayer(geometry: Geometry, fillRule: 'nonzero' | 'evenodd'): IconShape | null {
    return normalizeMaskLayer(createShape(geometry, { fill: '#ffffff', stroke: 'none', fillRule }));
  }

  private clipState(layers: readonly IconShape[], single: Geometry | null): MaskState {
    const polygon = single ? convexPolygon(single) : null;
    return { kind: 'clip', layers, polygon, complement: single ? this.complementOf(single) : null };
  }

  /** Lớp đen phủ mọi chỗ ngoài `geometry` (khung ngoài khoét đi hình), để giao vùng cắt với mặt nạ khác. */
  private complementOf(geometry: Geometry): IconShape | null {
    const path = geometryToPath(geometry);
    const reach = this.size * 4;
    const outer = {
      closed: true,
      nodes: [
        { x: -reach, y: -reach },
        { x: reach, y: -reach },
        { x: reach, y: reach },
        { x: -reach, y: reach },
      ],
    };
    return normalizeMaskLayer(createShape({ type: 'path', subpaths: [outer, ...path.subpaths] }, { fill: '#000000', stroke: 'none', fillRule: 'evenodd' }));
  }

  /**
   * Gộp các mặt nạ/vùng cắt áp lên một hình thành một mặt nạ duy nhất: bỏ vùng cắt mà hình nằm trọn bên trong; còn lại thì lấy
   * một mặt nạ làm gốc rồi chồng lớp đen phủ phần ngoài của mỗi vùng cắt còn lại (giao chính xác). 'hidden': hình bị che hết.
   */
  private composeMask(states: readonly MaskState[], bounds: Rect): ShapeMask | 'hidden' | null {
    const needed = states.filter((state) => !(state.kind === 'clip' && state.polygon && polygonContains(state.polygon, bounds)));
    if (needed.length === 0) return null;
    // nhiều mặt nạ độ sáng không giao được: giữ cái trong cùng (gần phần tử nhất), nó mang ý nghĩa cục bộ hơn
    const base = [...needed].reverse().find((state) => state.kind === 'mask') ?? needed[0];
    const layers = [...base.layers];
    for (const other of needed) {
      if (other === base) continue;
      if (other.kind === 'clip' && other.complement) layers.push(other.complement);
      else this.flags.maskConflict = true;
    }
    if (layers.length === 0) return 'hidden';
    if (layers.length > LIMITS.maxMaskLayers) {
      this.flags.maskTruncated = true;
      return { layers: layers.slice(0, LIMITS.maxMaskLayers) };
    }
    return { layers };
  }

  /** Dựng các mặt nạ/vùng cắt mà phần tử tham chiếu. 'hidden': phần tử không hiện gì. */
  private buildMasks(element: Element, own: Matrix, local: LocalProps, style: Style, ctx: Context): MaskState[] | 'hidden' {
    if (ctx.mode) {
      this.flags.maskConflict = true;
      return [];
    }
    const out: MaskState[] = [];
    const bboxOf = () => this.localBounds(element, ctx);
    if (local.clipPath) {
      const id = refId(local.clipPath);
      if (!id) this.flags.clipUnsupported = true;
      else {
        const clip = this.buildClip(id, own, style, ctx, bboxOf);
        if (clip === 'hidden') return 'hidden';
        if (clip) out.push(clip);
      }
    }
    if (local.mask) {
      const id = refId(local.mask);
      if (!id) this.flags.maskUnsupported = true;
      else {
        const built = this.buildMask(id, own, style, ctx, bboxOf);
        if (built === 'hidden') return 'hidden';
        out.push(...built);
      }
    }
    return out;
  }

  private buildClip(id: string, own: Matrix, style: Style, ctx: Context, bboxOf: () => Rect | null): MaskState | 'hidden' | null {
    const target = this.byId.get(id);
    if (!target || tagOf(target) !== 'clippath') {
      this.flags.missingReference = true;
      return null;
    }
    const declared = this.sheet.declared(target);
    if (declared.get('clip-path')) this.flags.maskConflict = true;
    let matrix = multiply(own, parseTransformList(target.getAttribute('transform') ?? declared.get('transform')).matrix);
    if ((target.getAttribute('clipPathUnits') ?? '').trim() === 'objectBoundingBox') {
      const box = bboxOf();
      if (!box || box.width <= EPS || box.height <= EPS) return 'hidden';
      matrix = multiply(matrix, [box.width, 0, 0, box.height, box.x, box.y]);
    }
    const base = computeStyle(declared, INITIAL_STYLE, ctx.viewport, this.warnings).style;
    const layers: IconShape[] = [];
    const add = (child: Element, childMatrix: Matrix, parentStyle: Style, depth: number) => {
      const tag = tagOf(child);
      if (UNSUPPORTED[tag]) {
        this.flags.unsupported.add(UNSUPPORTED[tag]);
        return;
      }
      if (tag === 'use' && depth < 4) {
        const href = child.getAttribute('href') ?? child.getAttribute('xlink:href');
        const referenced = href && href.startsWith('#') ? this.byId.get(href.slice(1)) : undefined;
        if (!referenced || referenced === child) return;
        const computedUse = computeStyle(this.sheet.declared(child), parentStyle, ctx.viewport, this.warnings);
        const x = this.length(child, 'x', ctx, computedUse.style, 'x');
        const y = this.length(child, 'y', ctx, computedUse.style, 'y');
        const useMatrix = multiply(childMatrix, multiply(parseTransformList(computedUse.local.transform).matrix, translation(x, y)));
        add(referenced, useMatrix, computedUse.style, depth + 1);
        return;
      }
      if (!SHAPE_TAGS.has(tag)) return;
      const computed = computeStyle(this.sheet.declared(child), parentStyle, ctx.viewport, this.warnings);
      if (!computed.local.display || !computed.style.visible) return;
      if (computed.local.clipPath) this.flags.maskConflict = true;
      const geometry = this.geometryOf(child, tag, computed.style, ctx);
      if (!geometry) return;
      const full = multiply(childMatrix, parseTransformList(computed.local.transform).matrix);
      const layer = this.whiteLayer(bake(geometry, full), computed.style.clipRule);
      if (layer) layers.push(layer);
    };
    for (const child of Array.from(target.children)) add(child, matrix, base, 0);
    if (layers.length === 0) return 'hidden';
    const single = layers.length === 1 ? layers[0].geometry : null;
    const state = this.clipState(layers.slice(0, LIMITS.maxMaskLayers), single);
    return state;
  }

  private buildMask(id: string, own: Matrix, style: Style, ctx: Context, bboxOf: () => Rect | null): MaskState[] | 'hidden' {
    const target = this.byId.get(id);
    if (!target || tagOf(target) !== 'mask') {
      this.flags.missingReference = true;
      return [];
    }
    const declared = this.sheet.declared(target);
    const regionBox = (target.getAttribute('maskUnits') ?? '').trim() !== 'userSpaceOnUse';
    const contentBox = (target.getAttribute('maskContentUnits') ?? '').trim() === 'objectBoundingBox';
    let box: Rect | null = null;
    if (regionBox || contentBox) {
      box = bboxOf();
      if (!box || box.width <= EPS || box.height <= EPS) return 'hidden';
    }

    const alpha = (declared.get('mask-type') ?? '').trim().toLowerCase() === 'alpha';
    const content = contentBox && box ? multiply(own, [box.width, 0, 0, box.height, box.x, box.y]) : own;
    const out: IconShape[] = [];
    const base = computeStyle(declared, INITIAL_STYLE, ctx.viewport, this.warnings).style;
    const inner: Context = { ...ctx, matrix: content, style: base, masks: [], mode: { alpha, out }, sink: null, stack: ctx.stack };
    for (const child of Array.from(target.children)) this.visit(child, inner);
    if (out.length === 0) return 'hidden';

    // vùng của mặt nạ (mặc định: khung bao nới 10% mỗi phía) cắt bớt mọi thứ ngoài nó
    const fraction = (name: string, fallbackText: string, axis: 'x' | 'y'): number => {
      const text = target.getAttribute(name) ?? fallbackText;
      if (regionBox) {
        const value = parseFloat(text);
        if (!Number.isFinite(value)) return 0;
        return text.trim().endsWith('%') ? value / 100 : value;
      }
      return parseLength(text, this.lengthContext(ctx, style, axis)) ?? 0;
    };
    const rx = fraction('x', '-10%', 'x');
    const ry = fraction('y', '-10%', 'y');
    const rw = fraction('width', '120%', 'x');
    const rh = fraction('height', '120%', 'y');
    const region: Rect = regionBox && box ? { x: box.x + rx * box.width, y: box.y + ry * box.height, width: rw * box.width, height: rh * box.height } : { x: rx, y: ry, width: rw, height: rh };
    const states: MaskState[] = [{ kind: 'mask', layers: out, polygon: null, complement: null }];
    if (region.width > 0 && region.height > 0) states.push(this.rectClip(region, own));
    return states;
  }
}

/**
 * Nhập SVG (nguyên thẻ `<svg>` hoặc vài phần tử rời) thành các lớp hình có thể chỉnh sửa, sao cho hình trong Studio khớp với
 * SVG gốc: CSS trong `<style>`, `<use>`/`<symbol>`/`<svg>` lồng nhau, `viewBox` + `preserveAspectRatio`, mọi đơn vị độ dài, màu
 * có độ đặc, gradient (tuyến tính, hướng tâm, biến đổi tuỳ ý), `clipPath`, `mask`, nét đứt, thứ tự vẽ nét/tô. Thứ không biểu
 * diễn được (chữ, ảnh, bộ lọc...) được báo trong `warnings` thay vì bỏ lặng lẽ. Chỉ đọc cấu trúc, không chèn SVG vào trang.
 */
export function importSvg(markup: string, options: SvgImportOptions = {}): SvgImportResult {
  return new Importer(markup, options).run();
}

/** Nhận biết nội dung dán vào là mã SVG thay vì chuỗi `d`. */
export function looksLikeSvgMarkup(text: string): boolean {
  return /^\s*(?:\uFEFF)?<(?:\?xml|!--|!doctype|svg|g|path|circle|ellipse|rect|line|polyline|polygon|use|defs)\b/i.test(text);
}

