import {
  deleteNode,
  docToScreen,
  flattenGeometry,
  geometryBounds,
  geometryToPath,
  hitTestShape,
  isPaintNone,
  moveNode,
  rectCenter,
  rectsIntersect,
  roundTo,
  snapMovingRect,
  snapToStep,
  unionRects,
  type BrandPalette,
  type BrandRules,
  type EllipseGeometry,
  type Geometry,
  type Guide,
  type IconDocument,
  type IconShape,
  type Matrix,
  type PathGeometry,
  type PathNode,
  type Point,
  type Rect,
  type RectGeometry,
  type ReorderMode,
  type Subpath,
  type Viewport,
} from '@enterprise-platform/shared-brand-icon';
import type { DisplayMode, EditorTool } from './tool';

/**
 * Các hàm thuần của trình thiết kế: tính toán hình học cho kéo/đổi cỡ/xoay, bắt dính, hit-test, bút, điểm neo và phím tắt.
 * Mọi hàm nhận trạng thái ban đầu của thao tác kéo (không cộng dồn sai số) nên dễ kiểm thử và không phụ thuộc React.
 */

const EPS = 1e-9;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const round4 = (value: number) => roundTo(value, 4);
const signOf = (value: number) => (value < 0 ? -1 : 1);

export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 12;
export const DEFAULT_POLYGON_SIDES = 5;

export const clampPolygonSides = (sides: number): number =>
  Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, Math.round(Number.isFinite(sides) ? sides : DEFAULT_POLYGON_SIDES)));

/** Số ra chữ có dấu phẩy thập phân, tối đa 2 chữ số lẻ. */
export const formatUnits = (value: number): string => String(roundTo(value, 2)).replace('.', ',');

/* ------------------------------------------------------------------ */
/* Đổi kích thước và xoay                                              */
/* ------------------------------------------------------------------ */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const OPPOSITE_HANDLE: Record<HandleId, HandleId> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

export const oppositeHandle = (handle: HandleId): HandleId => OPPOSITE_HANDLE[handle];

/** Vị trí của một tay cầm trên khung. */
export function handlePoint(bounds: Rect, handle: HandleId): Point {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = handle.includes('w') ? left : handle.includes('e') ? right : centerX;
  const y = handle.includes('n') ? top : handle.includes('s') ? bottom : centerY;
  return { x, y };
}

export const HANDLE_CURSORS: Record<HandleId, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const MIN_SCALE = 0.02;
const clampScale = (scale: number) => (Math.abs(scale) < MIN_SCALE ? signOf(scale) * MIN_SCALE : scale);

export interface ResizeOptions {
  /** Giữ tỷ lệ khung (Shift). */
  readonly keepRatio?: boolean;
  /** Co giãn từ tâm khung (Alt). */
  readonly fromCenter?: boolean;
}

/**
 * Ma trận co giãn khi kéo một tay cầm: điểm neo là tay cầm đối diện (hoặc tâm khung nếu `fromCenter`).
 * Tính từ khung ban đầu `origin` và vị trí con trỏ nên không tích luỹ sai số; kéo qua điểm neo sẽ lật hình.
 */
export function resizeMatrix(origin: Rect, handle: HandleId, pointer: Point, options: ResizeOptions = {}): Matrix {
  const { keepRatio = false, fromCenter = false } = options;
  const movesX = handle.includes('e') || handle.includes('w');
  const movesY = handle.includes('n') || handle.includes('s');
  const grab = handlePoint(origin, handle);
  const anchor = fromCenter ? rectCenter(origin) : handlePoint(origin, oppositeHandle(handle));

  const axisScale = (grabValue: number, anchorValue: number, pointerValue: number) => {
    const span = grabValue - anchorValue;
    return Math.abs(span) < EPS ? 1 : (pointerValue - anchorValue) / span;
  };
  let sx = movesX ? axisScale(grab.x, anchor.x, pointer.x) : 1;
  let sy = movesY ? axisScale(grab.y, anchor.y, pointer.y) : 1;

  if (keepRatio) {
    const flat = origin.width < EPS || origin.height < EPS;
    if (movesX && movesY) {
      if (!flat) {
        const uniform = Math.max(Math.abs(sx), Math.abs(sy));
        sx = signOf(sx) * uniform;
        sy = signOf(sy) * uniform;
      }
    } else if (movesX) {
      sy = Math.abs(sx);
    } else if (movesY) {
      sx = Math.abs(sy);
    }
  }

  sx = clampScale(sx);
  sy = clampScale(sy);
  return [sx, 0, 0, sy, anchor.x - sx * anchor.x, anchor.y - sy * anchor.y];
}

/** Khung kết quả khi áp ma trận lên khung gốc; dùng để hiện kích thước lúc kéo. */
export function mapRectByMatrix(rect: Rect, matrix: Matrix): Rect {
  const [a, b, c, d, e, f] = matrix;
  const map = (x: number, y: number): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  const corners = [map(rect.x, rect.y), map(rect.x + rect.width, rect.y), map(rect.x, rect.y + rect.height), map(rect.x + rect.width, rect.y + rect.height)];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Góc xoay (độ, trong (-180, 180]) từ lúc bấm tới hiện tại quanh `center`; `snap` làm tròn theo bước 15 độ. */
export function rotationDelta(center: Point, start: Point, pointer: Point, snap: boolean, stepDegrees = 15): number {
  const first = Math.atan2(start.y - center.y, start.x - center.x);
  const second = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let degrees = toDegrees(second - first);
  degrees = ((((degrees + 180) % 360) + 360) % 360) - 180;
  if (snap) degrees = Math.round(degrees / stepDegrees) * stepDegrees;
  return Object.is(degrees, -0) ? 0 : degrees;
}

/** Điểm cùng khoảng cách tới `origin` nhưng góc làm tròn theo bội của `stepDegrees`. */
export function constrainAngle(origin: Point, point: Point, stepDegrees: number): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return point;
  const angle = toRadians(Math.round(toDegrees(Math.atan2(dy, dx)) / stepDegrees) * stepDegrees);
  return { x: round4(origin.x + Math.cos(angle) * length), y: round4(origin.y + Math.sin(angle) * length) };
}

/* ------------------------------------------------------------------ */
/* Khung chọn, tay cầm (toạ độ màn hình)                                */
/* ------------------------------------------------------------------ */

export interface HandleSlot {
  readonly id: HandleId;
  readonly x: number;
  readonly y: number;
}

export interface SelectionLayout {
  /** Khung chọn theo toạ độ màn hình. */
  readonly frame: Rect;
  readonly handles: readonly HandleSlot[];
  readonly rotate: Point | null;
}

export interface SelectionLayoutOptions {
  /** Có tay cầm đổi cỡ và xoay hay không (khung chỉ để xem thì tắt). */
  readonly resizable: boolean;
  /** Cạnh ngắn hơn số pixel này thì ẩn tay cầm giữa cạnh. */
  readonly minEdgePx?: number;
  readonly rotateOffsetPx?: number;
}

/** Bố cục tay cầm quanh khung chọn; dùng chung cho vẽ và hit-test để hai bên luôn khớp. */
export function selectionLayout(bounds: Rect, view: Viewport, options: SelectionLayoutOptions): SelectionLayout {
  const topLeft = docToScreen(view, { x: bounds.x, y: bounds.y });
  const frame: Rect = { x: topLeft.x, y: topLeft.y, width: bounds.width * view.zoom, height: bounds.height * view.zoom };
  if (!options.resizable) return { frame, handles: [], rotate: null };

  const minEdge = options.minEdgePx ?? 28;
  const handles = HANDLE_IDS.filter((id) => {
    if (id.length === 2) return true;
    return id === 'n' || id === 's' ? frame.width >= minEdge : frame.height >= minEdge;
  }).map((id): HandleSlot => {
    const point = handlePoint(frame, id);
    return { id, x: point.x, y: point.y };
  });
  const offset = options.rotateOffsetPx ?? 22;
  return { frame, handles, rotate: { x: frame.x + frame.width / 2, y: frame.y - offset } };
}

export type HandleHit = { readonly type: 'resize'; readonly handle: HandleId } | { readonly type: 'rotate' };

/** Tay cầm nằm dưới con trỏ (toạ độ màn hình); tay cầm xoay được ưu tiên, sau đó tay cầm gần nhất. */
export function hitSelectionHandle(layout: SelectionLayout, point: Point, radius = 7): HandleHit | null {
  if (layout.rotate && Math.hypot(point.x - layout.rotate.x, point.y - layout.rotate.y) <= radius + 2) return { type: 'rotate' };
  let best: HandleSlot | null = null;
  let bestDistance = Infinity;
  for (const slot of layout.handles) {
    const distance = Math.hypot(point.x - slot.x, point.y - slot.y);
    if (distance <= radius && distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best ? { type: 'resize', handle: best.id } : null;
}

/* ------------------------------------------------------------------ */
/* Lớp có thể sửa, khung bao, hit-test                                  */
/* ------------------------------------------------------------------ */

/** Lớp đang chọn mà sửa được trên canvas (hiện và không khoá). */
export function editableSelection(doc: IconDocument, ids: readonly string[]): IconShape[] {
  const wanted = new Set(ids);
  return doc.shapes.filter((shape) => wanted.has(shape.id) && !shape.hidden && !shape.locked);
}

/** Khung bao theo đường tâm của hình (không tính độ dày nét); khung này bám lưới nên dễ căn trên lưới. */
export function geometryUnion(shapes: readonly IconShape[]): Rect | null {
  return unionRects(shapes.map((shape) => geometryBounds(shape.geometry)));
}

const inflate = (rect: Rect, amount: number): Rect => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const insideRect = (rect: Rect, point: Point) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

/** Đoạn thẳng a-b có cắt hình chữ nhật không (Liang-Barsky). */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q >= 0;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return false;
      if (ratio < t1) t1 = ratio;
    }
    return true;
  };
  return (
    clip(-dx, a.x - rect.x) &&
    clip(dx, rect.x + rect.width - a.x) &&
    clip(-dy, a.y - rect.y) &&
    clip(dy, rect.y + rect.height - a.y)
  );
}

/** Hình có chạm khung chọn (marquee) không: nét/đường đi qua khung, hoặc khung nằm trong vùng tô. */
export function shapeIntersectsRect(shape: IconShape, rect: Rect): boolean {
  const grow = isPaintNone(shape.stroke) ? 0 : shape.strokeWidth / 2;
  const box = inflate(rect, grow);
  if (!rectsIntersect(geometryBounds(shape.geometry), box)) return false;

  for (const line of flattenGeometry(shape.geometry)) {
    if (line.points.some((point) => insideRect(box, point))) return true;
    const count = line.closed ? line.points.length : line.points.length - 1;
    for (let index = 0; index < count; index += 1) {
      if (segmentIntersectsRect(line.points[index], line.points[(index + 1) % line.points.length], box)) return true;
    }
  }

  if (!isPaintNone(shape.fill)) {
    const probes: Point[] = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      rectCenter(rect),
    ];
    if (probes.some((probe) => hitTestShape(shape, probe, 0))) return true;
  }
  return false;
}

/** Lớp trên cùng tại điểm; bỏ qua lớp ẩn và lớp khoá. */
export function hitTestTopShape(doc: IconDocument, point: Point, tolerance: number): string | null {
  for (let index = doc.shapes.length - 1; index >= 0; index -= 1) {
    const shape = doc.shapes[index];
    if (shape.hidden || shape.locked) continue;
    if (hitTestShape(shape, point, tolerance)) return shape.id;
  }
  return null;
}

/** Mã các lớp (hiện, không khoá) chạm khung chọn, theo thứ tự lớp. */
export function shapesInMarquee(doc: IconDocument, rect: Rect): string[] {
  return doc.shapes.filter((shape) => !shape.hidden && !shape.locked && shapeIntersectsRect(shape, rect)).map((shape) => shape.id);
}

/** Hợp danh sách chọn gốc với kết quả quét, giữ thứ tự và bỏ trùng. */
export function mergeSelection(base: readonly string[], picked: readonly string[]): string[] {
  return [...base, ...picked.filter((id) => !base.includes(id))];
}

/* ------------------------------------------------------------------ */
/* Bắt dính                                                             */
/* ------------------------------------------------------------------ */

export interface SnapTargets {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** Các đường cạnh/tâm của hình khác cùng cạnh/tâm khung vẽ để bắt dính điểm. */
export function snapTargetsFromRects(rects: readonly Rect[], canvasSize: number): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const rect of [...rects, { x: 0, y: 0, width: canvasSize, height: canvasSize }]) {
    xs.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height);
  }
  return { xs, ys };
}

export interface PointSnapOptions {
  /** Bước lưới; 0 thì không bắt dính lưới. */
  readonly step: number;
  /** Ngưỡng bắt dính vào đường cạnh/tâm, theo đơn vị lưới. */
  readonly threshold: number;
  readonly objects: boolean;
  /** Tắt hoàn toàn (giữ Alt). */
  readonly disabled?: boolean;
}

function snapAxis(value: number, targets: readonly number[], options: PointSnapOptions): { value: number; guide: number | null } {
  if (options.objects) {
    let best: number | null = null;
    for (const target of targets) {
      if (Math.abs(target - value) <= options.threshold && (best === null || Math.abs(target - value) < Math.abs(best - value))) best = target;
    }
    if (best !== null) return { value: best, guide: best };
  }
  if (options.step > 0) return { value: round4(snapToStep(value, options.step)), guide: null };
  return { value, guide: null };
}

/** Bắt dính một điểm vào cạnh/tâm hình khác trước, rồi vào lưới. Dùng cho bút, vẽ hình và kéo điểm neo. */
export function snapPoint(point: Point, targets: SnapTargets, options: PointSnapOptions): { point: Point; guides: Guide[] } {
  if (options.disabled || (!options.objects && options.step <= 0)) return { point, guides: [] };
  const x = snapAxis(point.x, targets.xs, options);
  const y = snapAxis(point.y, targets.ys, options);
  const guides: Guide[] = [];
  if (x.guide !== null) guides.push({ axis: 'x', value: x.guide });
  if (y.guide !== null) guides.push({ axis: 'y', value: y.guide });
  return { point: { x: x.value, y: y.value }, guides };
}

export interface MoveSnapOptions {
  readonly step: number;
  readonly threshold: number;
  readonly objects: boolean;
  /** Khoá theo trục (Shift): chỉ giữ trục có độ dời lớn hơn. */
  readonly axisLock: boolean;
  /** Tạm tắt bắt dính (Alt). */
  readonly disabled: boolean;
}

export interface MoveSnapResult {
  readonly dx: number;
  readonly dy: number;
  readonly guides: readonly Guide[];
}

/** Trong các vị trí (trái/giữa/phải), vị trí nào gần lưới nhất thì lấy độ lệch của nó. */
function gridOffset(values: readonly number[], step: number): number {
  let best = 0;
  let bestAbs = Infinity;
  for (const value of values) {
    const offset = snapToStep(value, step) - value;
    if (Math.abs(offset) < bestAbs - 1e-9) {
      best = offset;
      bestAbs = Math.abs(offset);
    }
  }
  return best;
}

/**
 * Độ dời cuối cùng khi kéo cả nhóm hình: khung `origin` (lúc bấm) dời `rawDx/rawDy`, rồi bắt dính vào cạnh/tâm hình khác
 * và khung vẽ (kèm đường dóng), nếu không có thì vào lưới (lấy cạnh trái/giữa/phải gần lưới nhất, nên tâm hình tròn nằm đúng lưới).
 */
export function snapMove(
  origin: Rect,
  rawDx: number,
  rawDy: number,
  others: readonly Rect[],
  canvasSize: number,
  options: MoveSnapOptions,
): MoveSnapResult {
  let dx = rawDx;
  let dy = rawDy;
  let locked: 'x' | 'y' | null = null;
  if (options.axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      dy = 0;
      locked = 'y';
    } else {
      dx = 0;
      locked = 'x';
    }
  }

  if (!options.disabled && (options.objects || options.step > 0)) {
    const moving: Rect = { x: origin.x + dx, y: origin.y + dy, width: origin.width, height: origin.height };
    const objectSnap = options.objects
      ? snapMovingRect(moving, others, canvasSize, { step: 0, threshold: options.threshold, objects: true })
      : { dx: 0, dy: 0, guides: [] as Guide[] };
    const snapX = objectSnap.guides.some((guide) => guide.axis === 'x');
    const snapY = objectSnap.guides.some((guide) => guide.axis === 'y');
    const guides = objectSnap.guides.filter((guide) => guide.axis !== locked);

    if (locked !== 'x') {
      if (snapX) dx += objectSnap.dx;
      else if (options.step > 0) dx += gridOffset([moving.x, moving.x + moving.width / 2, moving.x + moving.width], options.step);
    }
    if (locked !== 'y') {
      if (snapY) dy += objectSnap.dy;
      else if (options.step > 0) dy += gridOffset([moving.y, moving.y + moving.height / 2, moving.y + moving.height], options.step);
    }
    return { dx: round4(dx), dy: round4(dy), guides };
  }
  return { dx: round4(dx), dy: round4(dy), guides: [] };
}

/* ------------------------------------------------------------------ */
/* Vẽ hình bằng kéo                                                     */
/* ------------------------------------------------------------------ */

export interface DragShapeOptions {
  /** Shift: hình vuông / hình tròn. */
  readonly equal?: boolean;
  /** Alt: kéo từ tâm. */
  readonly fromCenter?: boolean;
}

function dragRect(start: Point, end: Point, options: DragShapeOptions): Rect {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (options.equal) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = signOf(dx) * size;
    dy = signOf(dy) * size;
  }
  if (options.fromCenter) {
    return { x: round4(start.x - Math.abs(dx)), y: round4(start.y - Math.abs(dy)), width: round4(Math.abs(dx) * 2), height: round4(Math.abs(dy) * 2) };
  }
  return { x: round4(Math.min(start.x, start.x + dx)), y: round4(Math.min(start.y, start.y + dy)), width: round4(Math.abs(dx)), height: round4(Math.abs(dy)) };
}

export function rectFromDrag(start: Point, end: Point, options: DragShapeOptions = {}): RectGeometry {
  const box = dragRect(start, end, options);
  return { type: 'rect', ...box, rx: 0 };
}

export function ellipseFromDrag(start: Point, end: Point, options: DragShapeOptions = {}): EllipseGeometry {
  const box = dragRect(start, end, options);
  return { type: 'ellipse', cx: round4(box.x + box.width / 2), cy: round4(box.y + box.height / 2), rx: round4(box.width / 2), ry: round4(box.height / 2) };
}

/** Đường thẳng hai điểm; `snapAngle` (Shift) làm tròn góc theo bội của 15 độ. */
export function lineFromDrag(start: Point, end: Point, snapAngle = false): PathGeometry {
  const target = snapAngle ? constrainAngle(start, end, 15) : end;
  return { type: 'path', subpaths: [{ closed: false, nodes: [{ x: start.x, y: start.y }, { x: target.x, y: target.y }] }] };
}

/**
 * Đa giác đều kéo từ tâm: bán kính là khoảng cách tới con trỏ, đỉnh đầu tiên hướng về con trỏ
 * (kéo thẳng lên thì đa giác dựng đứng); `snapAngle` làm tròn hướng theo bội của 15 độ.
 */
export function regularPolygon(center: Point, pointer: Point, sides: number, snapAngle = false): PathGeometry {
  const count = clampPolygonSides(sides);
  const radius = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  let base = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  if (snapAngle) base = toRadians(Math.round(toDegrees(base) / 15) * 15);
  const nodes: PathNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = base + (index * 2 * Math.PI) / count;
    nodes.push({ x: round4(center.x + Math.cos(angle) * radius), y: round4(center.y + Math.sin(angle) * radius) });
  }
  return { type: 'path', subpaths: [{ closed: true, nodes }] };
}

/** Hình kéo quá nhỏ (bấm nhầm) thì bỏ qua. */
export function isDegenerateGeometry(geometry: Geometry, minimum = 0.05): boolean {
  const box = geometryBounds(geometry);
  return Math.max(box.width, box.height) < minimum;
}

/** Nhãn kích thước hiện cạnh con trỏ khi vẽ. */
export function describeGeometry(geometry: Geometry): string {
  const box = geometryBounds(geometry);
  return `${formatUnits(box.width)} × ${formatUnits(box.height)}`;
}

export interface NewShapeStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/** Màu nét mặc định: `currentColor` hoặc sapphire (hay màu đầu bảng) tuỳ chế độ hiển thị. */
export function defaultStrokePaint(mode: DisplayMode, palette: BrandPalette): string {
  if (mode !== 'brand') return 'currentColor';
  const token = palette.tokens.find((item) => item.key === 'sapphire') ?? palette.tokens[0];
  return token ? `brand:${token.key}` : 'currentColor';
}

/** Độ dày nét mặc định: giá trị trong bộ cho phép gần 1,75 nhất. */
export function defaultStrokeWidth(rules: BrandRules, target = 1.75): number {
  let best = target;
  let bestDistance = Infinity;
  for (const width of rules.allowedStrokeWidths) {
    const distance = Math.abs(width - target);
    if (distance < bestDistance - 1e-9) {
      best = width;
      bestDistance = distance;
    }
  }
  return best;
}

export function newShapeStyle(mode: DisplayMode, palette: BrandPalette, rules: BrandRules): NewShapeStyle {
  return { fill: 'none', stroke: defaultStrokePaint(mode, palette), strokeWidth: defaultStrokeWidth(rules) };
}

/* ------------------------------------------------------------------ */
/* Công cụ Bút                                                          */
/* ------------------------------------------------------------------ */

export interface PenDraft {
  readonly nodes: readonly PathNode[];
  /** Đang nối tiếp một đường có sẵn: khi xong thì thay đường con `sub` của hình `shapeId`. */
  readonly target: { readonly shapeId: string; readonly sub: number } | null;
}

export const penStart = (point: Point, target: PenDraft['target'] = null): PenDraft => ({
  nodes: [{ x: point.x, y: point.y }],
  target,
});

/** Thêm điểm góc (bấm). */
export const penAddNode = (draft: PenDraft, point: Point): PenDraft => ({
  ...draft,
  nodes: [...draft.nodes, { x: point.x, y: point.y }],
});

/** Bấm-kéo: kéo tay cầm ra khỏi điểm vừa đặt, tay cầm vào đối xứng, tạo điểm trơn. */
export function penDragHandle(draft: PenDraft, pointer: Point): PenDraft {
  const last = draft.nodes[draft.nodes.length - 1];
  if (!last) return draft;
  if (Math.hypot(pointer.x - last.x, pointer.y - last.y) < EPS) {
    return { ...draft, nodes: [...draft.nodes.slice(0, -1), { x: last.x, y: last.y }] };
  }
  const node: PathNode = {
    x: last.x,
    y: last.y,
    hin: { x: round4(2 * last.x - pointer.x), y: round4(2 * last.y - pointer.y) },
    hout: { x: pointer.x, y: pointer.y },
  };
  return { ...draft, nodes: [...draft.nodes.slice(0, -1), node] };
}

/** Con trỏ có đang ở gần điểm đầu (để bấm đóng đường) không; cần ít nhất 3 điểm. */
export function penNearFirst(draft: PenDraft, point: Point, tolerance: number): boolean {
  const first = draft.nodes[0];
  return Boolean(first) && draft.nodes.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= tolerance;
}

/** Kết thúc đường: bỏ điểm cuối trùng điểm trước (do nhấp đôi); ít hơn 2 điểm thì huỷ. */
export function penFinish(draft: PenDraft, closed: boolean): Subpath | null {
  const nodes = [...draft.nodes];
  const last = nodes[nodes.length - 1];
  const before = nodes[nodes.length - 2];
  if (last && before && Math.hypot(last.x - before.x, last.y - before.y) < 1e-6) nodes.pop();
  if (nodes.length < 2) return null;
  return { nodes, closed: closed && nodes.length >= 3 };
}

/** Hình xem trước: các điểm đã đặt cộng đoạn kéo giãn tới con trỏ (hoặc đóng đường nếu đang gần điểm đầu). */
export function penPreviewGeometry(draft: PenDraft, hover: Point | null, closing = false): PathGeometry {
  const nodes: PathNode[] = [...draft.nodes];
  if (closing && nodes.length >= 3) return { type: 'path', subpaths: [{ nodes, closed: true }] };
  const last = nodes[nodes.length - 1];
  if (hover && last && Math.hypot(hover.x - last.x, hover.y - last.y) > 1e-6) nodes.push({ x: hover.x, y: hover.y });
  return { type: 'path', subpaths: [{ nodes, closed: false }] };
}

export interface OpenEnd {
  readonly sub: number;
  readonly index: number;
  readonly atStart: boolean;
}

/** Đầu mút của đường mở nằm gần điểm bấm (để nối tiếp bằng bút). */
export function hitOpenEnd(path: PathGeometry, point: Point, tolerance: number): OpenEnd | null {
  let best: OpenEnd | null = null;
  let bestDistance = Infinity;
  path.subpaths.forEach((sub, subIndex) => {
    if (sub.closed || sub.nodes.length === 0) return;
    const candidates: OpenEnd[] = [{ sub: subIndex, index: sub.nodes.length - 1, atStart: false }];
    if (sub.nodes.length > 1) candidates.push({ sub: subIndex, index: 0, atStart: true });
    for (const candidate of candidates) {
      const node = sub.nodes[candidate.index];
      const distance = Math.hypot(point.x - node.x, point.y - node.y);
      if (distance <= tolerance && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  });
  return best;
}

function reverseNodes(nodes: readonly PathNode[]): PathNode[] {
  return [...nodes].reverse().map((node) => ({
    x: node.x,
    y: node.y,
    ...(node.hout ? { hin: node.hout } : {}),
    ...(node.hin ? { hout: node.hin } : {}),
  }));
}

/** Bản nháp bút nối tiếp từ một đầu mút của đường mở (nếu nối từ đầu thì đảo chiều đường để điểm mới thêm vào cuối). */
export function penContinue(shapeId: string, path: PathGeometry, end: OpenEnd): PenDraft {
  const sub = path.subpaths[end.sub];
  const nodes = end.atStart ? reverseNodes(sub.nodes) : [...sub.nodes];
  return { nodes, target: { shapeId, sub: end.sub } };
}

/** Hình học sau khi thay (hoặc thêm) đường con thứ `subIndex`. */
export function penCommitGeometry(geometry: Geometry, subpath: Subpath, subIndex: number): PathGeometry {
  const path = geometryToPath(geometry);
  const subpaths = [...path.subpaths];
  if (subIndex >= 0 && subIndex < subpaths.length) subpaths[subIndex] = subpath;
  else subpaths.push(subpath);
  return { type: 'path', subpaths };
}

/* ------------------------------------------------------------------ */
/* Công cụ Điểm neo                                                     */
/* ------------------------------------------------------------------ */

export interface NodeRef {
  readonly sub: number;
  readonly index: number;
}

export type NodeHit =
  | { readonly kind: 'anchor'; readonly sub: number; readonly index: number }
  | { readonly kind: 'handle'; readonly sub: number; readonly index: number; readonly handle: 'hin' | 'hout' };

export const nodeKey = (shapeId: string, sub: number, index: number): string => `${shapeId}|${sub}|${index}`;

export function parseNodeKey(key: string): { shapeId: string; sub: number; index: number } | null {
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const index = Number(parts[parts.length - 1]);
  const sub = Number(parts[parts.length - 2]);
  if (!Number.isInteger(index) || !Number.isInteger(sub)) return null;
  return { shapeId: parts.slice(0, -2).join('|'), sub, index };
}

/**
 * Điểm neo hoặc tay cầm Bezier dưới con trỏ. Chỉ điểm neo đang chọn mới có tay cầm để bấm;
 * tay cầm gần hơn điểm neo thì thắng, tay cầm trùng điểm neo bị bỏ qua.
 */
export function hitTestNodes(
  path: PathGeometry,
  point: Point,
  tolerance: number,
  isSelected: (sub: number, index: number) => boolean,
): NodeHit | null {
  let best: NodeHit | null = null;
  let bestDistance = Infinity;
  const consider = (hit: NodeHit, target: Point) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= tolerance && distance < bestDistance) {
      best = hit;
      bestDistance = distance;
    }
  };
  path.subpaths.forEach((sub, subIndex) => {
    sub.nodes.forEach((node, index) => {
      consider({ kind: 'anchor', sub: subIndex, index }, node);
      if (!isSelected(subIndex, index)) return;
      for (const handle of ['hin', 'hout'] as const) {
        const position = node[handle];
        if (position && Math.hypot(position.x - node.x, position.y - node.y) > EPS) consider({ kind: 'handle', sub: subIndex, index, handle }, position);
      }
    });
  });
  return best;
}

/** Các điểm neo nằm trong khung chọn. */
export function nodesInRect(path: PathGeometry, rect: Rect): NodeRef[] {
  const result: NodeRef[] = [];
  path.subpaths.forEach((sub, subIndex) => {
    sub.nodes.forEach((node, index) => {
      if (insideRect(rect, node)) result.push({ sub: subIndex, index });
    });
  });
  return result;
}

/** Dời nhiều điểm neo (tay cầm đi cùng). */
export function moveNodes(path: PathGeometry, refs: readonly NodeRef[], dx: number, dy: number): PathGeometry {
  return refs.reduce((current, ref) => moveNode(current, ref.sub, ref.index, dx, dy), path);
}

/** Xoá nhiều điểm neo; đường còn dưới 2 điểm thì mất luôn. Xử lý từ cuối lên đầu để chỉ số không lệch. */
export function deleteNodes(path: PathGeometry, refs: readonly NodeRef[]): PathGeometry {
  const bySub = new Map<number, number[]>();
  for (const ref of refs) bySub.set(ref.sub, [...(bySub.get(ref.sub) ?? []), ref.index]);
  let current = path;
  for (const sub of [...bySub.keys()].sort((a, b) => b - a)) {
    const indexes = [...new Set(bySub.get(sub) ?? [])].sort((a, b) => b - a);
    for (const index of indexes) {
      const before = current.subpaths.length;
      current = deleteNode(current, sub, index);
      if (current.subpaths.length < before) break;
    }
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* Phím tắt                                                             */
/* ------------------------------------------------------------------ */

export type EditorCommand =
  | { readonly type: 'tool'; readonly tool: EditorTool }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'duplicate' }
  | { readonly type: 'delete' }
  | { readonly type: 'selectAll' }
  | { readonly type: 'escape' }
  | { readonly type: 'enter' }
  | { readonly type: 'save' }
  | { readonly type: 'reorder'; readonly mode: ReorderMode }
  | { readonly type: 'nudge'; readonly dx: -1 | 0 | 1; readonly dy: -1 | 0 | 1; readonly shift: boolean; readonly alt: boolean }
  | { readonly type: 'zoom'; readonly direction: 'in' | 'out' | 'fit' }
  | { readonly type: 'polygonSides'; readonly delta: 1 | -1 };

export interface KeyInfo {
  readonly key: string;
  /** Ctrl hoặc Cmd. */
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface KeyContext {
  readonly tool: EditorTool;
}

export const TOOL_KEYS: Record<EditorTool, string> = {
  select: 'V',
  node: 'A',
  pen: 'P',
  rect: 'R',
  ellipse: 'E',
  line: 'L',
  polygon: 'G',
  hand: 'H',
};

const KEY_TO_TOOL: Record<string, EditorTool> = Object.fromEntries(
  (Object.entries(TOOL_KEYS) as Array<[EditorTool, string]>).map(([tool, key]) => [key.toLowerCase(), tool]),
);

/** Đổi một phím bấm thành lệnh của trình thiết kế; `null` nếu không phải phím tắt. */
export function keyToCommand(input: KeyInfo, context: KeyContext): EditorCommand | null {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

  if (input.ctrl) {
    if (input.alt) return null;
    switch (key) {
      case 'z':
        return { type: input.shift ? 'redo' : 'undo' };
      case 'y':
        return { type: 'redo' };
      case 'd':
        return { type: 'duplicate' };
      case 'a':
        return { type: 'selectAll' };
      case 's':
        return { type: 'save' };
      case '[':
        return { type: 'reorder', mode: 'back' };
      case ']':
        return { type: 'reorder', mode: 'front' };
      default:
        return null;
    }
  }

  switch (key) {
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' };
    case 'Escape':
      return { type: 'escape' };
    case 'Enter':
      return { type: 'enter' };
    case '[':
      return { type: 'reorder', mode: 'backward' };
    case ']':
      return { type: 'reorder', mode: 'forward' };
    case '+':
    case '=':
      return { type: 'zoom', direction: 'in' };
    case '-':
    case '_':
      return { type: 'zoom', direction: 'out' };
    case '0':
      return { type: 'zoom', direction: 'fit' };
    case 'ArrowUp':
    case 'ArrowDown':
      if (context.tool === 'polygon') return { type: 'polygonSides', delta: key === 'ArrowUp' ? 1 : -1 };
      return { type: 'nudge', dx: 0, dy: key === 'ArrowUp' ? -1 : 1, shift: input.shift, alt: input.alt };
    case 'ArrowLeft':
    case 'ArrowRight':
      return { type: 'nudge', dx: key === 'ArrowLeft' ? -1 : 1, dy: 0, shift: input.shift, alt: input.alt };
    default:
      break;
  }

  if (!input.alt && key.length === 1 && KEY_TO_TOOL[key]) return { type: 'tool', tool: KEY_TO_TOOL[key] };
  return null;
}

/** Bước dịch bằng phím mũi tên: 1 bước lưới, Shift nhân 5, Alt xuống 0,1 (Shift+Alt là 0,5). */
export function nudgeAmount(snapStep: number, shift: boolean, alt: boolean): number {
  const base = alt ? 0.1 : snapStep > 0 ? snapStep : 1;
  return round4(shift ? base * 5 : base);
}

/** Hệ số phóng to/thu nhỏ từ độ cuộn con lăn chuột (deltaMode 1 là theo dòng, 2 là theo trang). */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.0018);
}
