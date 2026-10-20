import {
  isPaintNone,
  type EllipseGeometry,
  type Geometry,
  type IconShape,
  type PathGeometry,
  type PathNode,
  type Point,
  type Rect,
  type RectGeometry,
  type Subpath,
} from './model';

/** Ma trận biến đổi affine [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const KAPPA = 0.5522847498307936;
const EPS = 1e-9;

export function multiply(first: Matrix, second: Matrix): Matrix {
  // Kết quả = first ∘ second (áp `second` trước, rồi `first`)
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export const translation = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];

export function scaling(sx: number, sy: number, cx = 0, cy = 0): Matrix {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

export function rotation(degrees: number, cx = 0, cy = 0): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

const isZero = (value: number) => Math.abs(value) < 1e-7;

/** Phép biến đổi chỉ co giãn/lật/tịnh tiến (không xoay): rect và elip giữ nguyên dạng. */
export function isScaleOnly(matrix: Matrix): boolean {
  return isZero(matrix[1]) && isZero(matrix[2]);
}

/** Xoay bội của 90 độ (kèm co giãn): rect và elip vẫn là hình thẳng trục. */
export function isQuarterTurn(matrix: Matrix): boolean {
  return isZero(matrix[0]) && isZero(matrix[3]);
}

export function mapRectMatrix(from: Rect, to: Rect): Matrix {
  const sx = from.width < EPS ? 1 : to.width / from.width;
  const sy = from.height < EPS ? 1 : to.height / from.height;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}

const mapNodePoint = (matrix: Matrix, point: Point | undefined): Point | undefined =>
  point ? applyMatrix(matrix, point) : undefined;

function transformNode(matrix: Matrix, node: PathNode): PathNode {
  const moved = applyMatrix(matrix, node);
  const hin = mapNodePoint(matrix, node.hin);
  const hout = mapNodePoint(matrix, node.hout);
  return { x: moved.x, y: moved.y, ...(hin ? { hin } : {}), ...(hout ? { hout } : {}) };
}

export function rectToPath(rect: RectGeometry): PathGeometry {
  const { x, y, width: w, height: h } = rect;
  const r = Math.min(Math.max(rect.rx, 0), w / 2, h / 2);
  if (r < EPS) {
    return {
      type: 'path',
      subpaths: [
        {
          closed: true,
          nodes: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ],
        },
      ],
    };
  }
  const k = KAPPA * r;
  return {
    type: 'path',
    subpaths: [
      {
        closed: true,
        nodes: [
          { x: x + r, y, hin: { x: x + r - k, y } },
          { x: x + w - r, y, hout: { x: x + w - r + k, y } },
          { x: x + w, y: y + r, hin: { x: x + w, y: y + r - k } },
          { x: x + w, y: y + h - r, hout: { x: x + w, y: y + h - r + k } },
          { x: x + w - r, y: y + h, hin: { x: x + w - r + k, y: y + h } },
          { x: x + r, y: y + h, hout: { x: x + r - k, y: y + h } },
          { x, y: y + h - r, hin: { x, y: y + h - r + k } },
          { x, y: y + r, hout: { x, y: y + r - k } },
        ],
      },
    ],
  };
}

export function ellipseToPath(ellipse: EllipseGeometry): PathGeometry {
  const { cx, cy, rx, ry } = ellipse;
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return {
    type: 'path',
    subpaths: [
      {
        closed: true,
        nodes: [
          { x: cx, y: cy - ry, hin: { x: cx - kx, y: cy - ry }, hout: { x: cx + kx, y: cy - ry } },
          { x: cx + rx, y: cy, hin: { x: cx + rx, y: cy - ky }, hout: { x: cx + rx, y: cy + ky } },
          { x: cx, y: cy + ry, hin: { x: cx + kx, y: cy + ry }, hout: { x: cx - kx, y: cy + ry } },
          { x: cx - rx, y: cy, hin: { x: cx - rx, y: cy + ky }, hout: { x: cx - rx, y: cy - ky } },
        ],
      },
    ],
  };
}

export function geometryToPath(geometry: Geometry): PathGeometry {
  switch (geometry.type) {
    case 'path':
      return geometry;
    case 'rect':
      return rectToPath(geometry);
    default:
      return ellipseToPath(geometry);
  }
}

export function transformGeometry(geometry: Geometry, matrix: Matrix): Geometry {
  const [a, b, c, d] = matrix;
  if (geometry.type === 'path') {
    return {
      type: 'path',
      subpaths: geometry.subpaths.map((sub) => ({
        closed: sub.closed,
        nodes: sub.nodes.map((node) => transformNode(matrix, node)),
      })),
    };
  }

  if (geometry.type === 'rect' && (isScaleOnly(matrix) || isQuarterTurn(matrix))) {
    const p1 = applyMatrix(matrix, { x: geometry.x, y: geometry.y });
    const p2 = applyMatrix(matrix, { x: geometry.x + geometry.width, y: geometry.y + geometry.height });
    const scale = (Math.hypot(a, b) + Math.hypot(c, d)) / 2;
    return {
      type: 'rect',
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
      rx: geometry.rx * scale,
    };
  }

  if (geometry.type === 'ellipse' && (isScaleOnly(matrix) || isQuarterTurn(matrix))) {
    const center = applyMatrix(matrix, { x: geometry.cx, y: geometry.cy });
    return {
      type: 'ellipse',
      cx: center.x,
      cy: center.y,
      rx: Math.abs(a) * geometry.rx + Math.abs(c) * geometry.ry,
      ry: Math.abs(b) * geometry.rx + Math.abs(d) * geometry.ry,
    };
  }

  return transformGeometry(geometryToPath(geometry), matrix);
}

export function transformShape(shape: IconShape, matrix: Matrix): IconShape {
  return { ...shape, geometry: transformGeometry(shape.geometry, matrix) };
}

export const translateShape = (shape: IconShape, dx: number, dy: number): IconShape =>
  transformShape(shape, translation(dx, dy));

/* ---------- Khung bao ---------- */

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // Đạo hàm của Bezier bậc ba theo một trục là đa thức bậc hai
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const result: number[] = [];
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) result.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      result.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return result.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

function segmentPoints(from: PathNode, to: PathNode): [Point, Point, Point, Point] {
  return [from, from.hout ?? from, to.hin ?? to, to];
}

function subpathSegments(sub: Subpath): Array<[PathNode, PathNode]> {
  const segments: Array<[PathNode, PathNode]> = [];
  for (let index = 1; index < sub.nodes.length; index += 1) segments.push([sub.nodes[index - 1], sub.nodes[index]]);
  if (sub.closed && sub.nodes.length > 1) segments.push([sub.nodes[sub.nodes.length - 1], sub.nodes[0]]);
  return segments;
}

export function geometryBounds(geometry: Geometry): Rect {
  if (geometry.type === 'rect') {
    return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  if (geometry.type === 'ellipse') {
    return { x: geometry.cx - geometry.rx, y: geometry.cy - geometry.ry, width: geometry.rx * 2, height: geometry.ry * 2 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const sub of geometry.subpaths) {
    for (const node of sub.nodes) include(node.x, node.y);
    for (const [from, to] of subpathSegments(sub)) {
      if (!from.hout && !to.hin) continue;
      const [p0, p1, p2, p3] = segmentPoints(from, to);
      for (const t of cubicExtrema(p0.x, p1.x, p2.x, p3.x)) include(cubicAt(p0.x, p1.x, p2.x, p3.x, t), cubicAt(p0.y, p1.y, p2.y, p3.y, t));
      for (const t of cubicExtrema(p0.y, p1.y, p2.y, p3.y)) include(cubicAt(p0.x, p1.x, p2.x, p3.x, t), cubicAt(p0.y, p1.y, p2.y, p3.y, t));
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Khung bao tính cả nét viền (xấp xỉ: mở rộng nửa độ dày nét mỗi phía). */
export function visualBounds(shape: IconShape): Rect {
  const box = geometryBounds(shape.geometry);
  const half = isPaintNone(shape.stroke) ? 0 : shape.strokeWidth / 2;
  return { x: box.x - half, y: box.y - half, width: box.width + half * 2, height: box.height + half * 2 };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

export const rectCenter = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/* ---------- Làm phẳng và nhấp chọn ---------- */

export interface Polyline {
  readonly points: Point[];
  readonly closed: boolean;
}

function flattenSegment(from: PathNode, to: PathNode, out: Point[]) {
  if (!from.hout && !to.hin) {
    out.push({ x: to.x, y: to.y });
    return;
  }
  const [p0, p1, p2, p3] = segmentPoints(from, to);
  const length = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.min(40, Math.max(6, Math.ceil(length / 0.4)));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    out.push({ x: cubicAt(p0.x, p1.x, p2.x, p3.x, t), y: cubicAt(p0.y, p1.y, p2.y, p3.y, t) });
  }
}

export function flattenGeometry(geometry: Geometry): Polyline[] {
  const path = geometryToPath(geometry);
  return path.subpaths
    .filter((sub) => sub.nodes.length > 0)
    .map((sub) => {
      const points: Point[] = [{ x: sub.nodes[0].x, y: sub.nodes[0].y }];
      for (const [from, to] of subpathSegments(sub)) flattenSegment(from, to, points);
      return { points, closed: sub.closed };
    });
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared < EPS ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function windingNumber(point: Point, polygon: readonly Point[]): number {
  let winding = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y) {
      if (b.y > point.y && cross > 0) winding += 1;
    } else if (b.y <= point.y && cross < 0) {
      winding -= 1;
    }
  }
  return winding;
}

/** Số lần tia ngang từ `point` cắt đa giác; dùng cho quy tắc evenodd (chẵn lẻ), khác số vòng quấn của nonzero. */
function crossingCount(point: Point, polygon: readonly Point[]): number {
  let count = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (a.y <= point.y !== b.y <= point.y) {
      const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < x) count += 1;
    }
  }
  return count;
}

export function hitTestShape(shape: IconShape, point: Point, tolerance: number): boolean {
  const lines = flattenGeometry(shape.geometry);
  const strokeVisible = !isPaintNone(shape.stroke);
  const fillVisible = !isPaintNone(shape.fill);

  if (strokeVisible || !fillVisible) {
    const reach = (strokeVisible ? shape.strokeWidth / 2 : 0) + tolerance;
    for (const line of lines) {
      const count = line.closed ? line.points.length : line.points.length - 1;
      for (let index = 0; index < count; index += 1) {
        if (distanceToSegment(point, line.points[index], line.points[(index + 1) % line.points.length]) <= reach) return true;
      }
      if (line.points.length === 1 && Math.hypot(point.x - line.points[0].x, point.y - line.points[0].y) <= reach) return true;
    }
  }

  if (fillVisible) {
    if (shape.fillRule === 'evenodd') {
      let crossings = 0;
      for (const line of lines) if (line.points.length > 2) crossings += crossingCount(point, line.points);
      return crossings % 2 === 1;
    }
    let total = 0;
    for (const line of lines) if (line.points.length > 2) total += windingNumber(point, line.points);
    return total !== 0;
  }
  return false;
}

/* ---------- Thao tác điểm neo ---------- */

export interface NodeRef {
  readonly shapeId: string;
  readonly sub: number;
  readonly index: number;
}

export type HandleKind = 'hin' | 'hout';

const replaceSubpath = (path: PathGeometry, sub: number, next: Subpath | null): PathGeometry => ({
  type: 'path',
  subpaths: path.subpaths.flatMap((item, index) => (index === sub ? (next ? [next] : []) : [item])),
});

const replaceNode = (sub: Subpath, index: number, node: PathNode): Subpath => ({
  closed: sub.closed,
  nodes: sub.nodes.map((item, position) => (position === index ? node : item)),
});

export function moveNode(path: PathGeometry, sub: number, index: number, dx: number, dy: number): PathGeometry {
  const subpath = path.subpaths[sub];
  const node = subpath?.nodes[index];
  if (!subpath || !node) return path;
  const shift = (point: Point | undefined) => (point ? { x: point.x + dx, y: point.y + dy } : undefined);
  const hin = shift(node.hin);
  const hout = shift(node.hout);
  return replaceSubpath(
    path,
    sub,
    replaceNode(subpath, index, { x: node.x + dx, y: node.y + dy, ...(hin ? { hin } : {}), ...(hout ? { hout } : {}) }),
  );
}

export function setNodePosition(path: PathGeometry, sub: number, index: number, x: number, y: number): PathGeometry {
  const node = path.subpaths[sub]?.nodes[index];
  if (!node) return path;
  return moveNode(path, sub, index, x - node.x, y - node.y);
}

export type HandleMirror = 'none' | 'collinear' | 'symmetric';

/** Đặt tay cầm; `collinear` giữ tay cầm đối diện thẳng hàng (giữ độ dài), `symmetric` đối xứng hoàn toàn. */
export function setHandle(
  path: PathGeometry,
  sub: number,
  index: number,
  kind: HandleKind,
  point: Point,
  mirror: HandleMirror = 'none',
): PathGeometry {
  const subpath = path.subpaths[sub];
  const node = subpath?.nodes[index];
  if (!subpath || !node) return path;
  const other: HandleKind = kind === 'hin' ? 'hout' : 'hin';
  let next: PathNode = { ...node, [kind]: point };

  if (mirror !== 'none') {
    const dx = point.x - node.x;
    const dy = point.y - node.y;
    const length = Math.hypot(dx, dy);
    const existing = node[other];
    const targetLength = mirror === 'symmetric' || !existing ? length : Math.hypot(existing.x - node.x, existing.y - node.y);
    if (length > EPS) {
      next = { ...next, [other]: { x: node.x - (dx / length) * targetLength, y: node.y - (dy / length) * targetLength } };
    }
  }
  return replaceSubpath(path, sub, replaceNode(subpath, index, next));
}

function neighbour(sub: Subpath, index: number, step: number): PathNode | undefined {
  const target = index + step;
  if (target >= 0 && target < sub.nodes.length) return sub.nodes[target];
  if (sub.closed && sub.nodes.length > 1) return sub.nodes[(target + sub.nodes.length) % sub.nodes.length];
  return undefined;
}

export function nodeIsSmooth(node: PathNode): boolean {
  return Boolean(node.hin || node.hout);
}

/** Đổi điểm neo giữa góc nhọn (không tay cầm) và trơn (tay cầm tự tính theo hai điểm lân cận). */
export function toggleNodeSmooth(path: PathGeometry, sub: number, index: number): PathGeometry {
  const subpath = path.subpaths[sub];
  const node = subpath?.nodes[index];
  if (!subpath || !node) return path;
  if (nodeIsSmooth(node)) return replaceSubpath(path, sub, replaceNode(subpath, index, { x: node.x, y: node.y }));

  const prev = neighbour(subpath, index, -1);
  const next = neighbour(subpath, index, 1);
  const from = prev ?? node;
  const to = next ?? node;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < EPS) return path;
  const ux = dx / length;
  const uy = dy / length;
  const back = prev ? Math.hypot(node.x - prev.x, node.y - prev.y) / 3 : 0;
  const forward = next ? Math.hypot(next.x - node.x, next.y - node.y) / 3 : 0;
  const smooth: PathNode = {
    x: node.x,
    y: node.y,
    ...(prev ? { hin: { x: node.x - ux * back, y: node.y - uy * back } } : {}),
    ...(next ? { hout: { x: node.x + ux * forward, y: node.y + uy * forward } } : {}),
  };
  return replaceSubpath(path, sub, replaceNode(subpath, index, smooth));
}

export function deleteNode(path: PathGeometry, sub: number, index: number): PathGeometry {
  const subpath = path.subpaths[sub];
  if (!subpath?.nodes[index]) return path;
  const nodes = subpath.nodes.filter((_, position) => position !== index);
  if (nodes.length < 2) return replaceSubpath(path, sub, null);
  return replaceSubpath(path, sub, { closed: subpath.closed && nodes.length > 2, nodes });
}

export function toggleSubpathClosed(path: PathGeometry, sub: number): PathGeometry {
  const subpath = path.subpaths[sub];
  if (!subpath || subpath.nodes.length < 3) return path;
  return replaceSubpath(path, sub, { ...subpath, closed: !subpath.closed });
}

function splitCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number) {
  const lerp = (a: Point, b: Point): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const f = lerp(d, e);
  return { a, d, f, e, c };
}

/** Dựng điểm neo, bỏ tay cầm trùng điểm neo (tay cầm suy biến không có tác dụng và làm nút bị coi là "trơn"). */
function buildNode(x: number, y: number, hin: Point | undefined, hout: Point | undefined): PathNode {
  const useful = (handle: Point | undefined): handle is Point =>
    handle !== undefined && (Math.abs(handle.x - x) > EPS || Math.abs(handle.y - y) > EPS);
  return { x, y, ...(useful(hin) ? { hin } : {}), ...(useful(hout) ? { hout } : {}) };
}

/**
 * Chèn điểm neo vào đoạn `segment` (đoạn thứ n nối node n với node n+1; với đường kín, đoạn cuối nối node cuối về node đầu)
 * tại tham số `t`, giữ nguyên hình dạng. Chỉ số đoạn không tồn tại thì trả về nguyên đường.
 */
export function insertNode(path: PathGeometry, sub: number, segment: number, t: number): PathGeometry {
  const subpath = path.subpaths[sub];
  if (!subpath) return path;
  const count = subpath.nodes.length;
  const lastSegment = subpath.closed ? count - 1 : count - 2;
  if (count < 2 || !Number.isInteger(segment) || segment < 0 || segment > lastSegment) return path;
  const from = subpath.nodes[segment];
  const toIndex = (segment + 1) % count;
  const to = subpath.nodes[toIndex];

  let inserted: PathNode;
  let nextFrom: PathNode = from;
  let nextTo: PathNode = to;
  if (from.hout || to.hin) {
    const [p0, p1, p2, p3] = segmentPoints(from, to);
    const { a, d, f, e, c } = splitCubic(p0, p1, p2, p3, t);
    inserted = buildNode(f.x, f.y, d, e);
    nextFrom = buildNode(from.x, from.y, from.hin, a);
    nextTo = buildNode(to.x, to.y, c, to.hout);
  } else {
    inserted = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }

  const nodes = subpath.nodes.map((node, position) => {
    if (position === segment) return nextFrom;
    if (position === toIndex) return nextTo;
    return node;
  });
  nodes.splice(segment + 1, 0, inserted);
  return replaceSubpath(path, sub, { closed: subpath.closed, nodes });
}

export interface NearestPoint {
  readonly sub: number;
  readonly segment: number;
  readonly t: number;
  readonly point: Point;
  readonly distance: number;
}

/** Điểm gần nhất trên đường tới `target`, dùng để thêm điểm neo khi bấm vào đoạn. */
export function nearestOnPath(path: PathGeometry, target: Point): NearestPoint | null {
  let best: NearestPoint | null = null;
  path.subpaths.forEach((sub, subIndex) => {
    subpathSegments(sub).forEach(([from, to], segment) => {
      const [p0, p1, p2, p3] = segmentPoints(from, to);
      const steps = from.hout || to.hin ? 32 : 1;
      for (let step = 0; step < steps; step += 1) {
        const t0 = step / steps;
        const t1 = (step + 1) / steps;
        const a = { x: cubicAt(p0.x, p1.x, p2.x, p3.x, t0), y: cubicAt(p0.y, p1.y, p2.y, p3.y, t0) };
        const b = { x: cubicAt(p0.x, p1.x, p2.x, p3.x, t1), y: cubicAt(p0.y, p1.y, p2.y, p3.y, t1) };
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const local = lengthSquared < EPS ? 0 : Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared));
        const point = { x: a.x + dx * local, y: a.y + dy * local };
        const distance = Math.hypot(target.x - point.x, target.y - point.y);
        if (!best || distance < best.distance) best = { sub: subIndex, segment, t: t0 + (t1 - t0) * local, point, distance };
      }
    });
  });
  return best;
}

/* ---------- Căn chỉnh và phân phối ---------- */

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignOffsets(
  items: ReadonlyArray<{ id: string; bounds: Rect }>,
  mode: AlignMode,
  reference: Rect,
): Map<string, Point> {
  const result = new Map<string, Point>();
  for (const item of items) {
    const { bounds } = item;
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = reference.x - bounds.x;
    if (mode === 'center') dx = reference.x + reference.width / 2 - (bounds.x + bounds.width / 2);
    if (mode === 'right') dx = reference.x + reference.width - (bounds.x + bounds.width);
    if (mode === 'top') dy = reference.y - bounds.y;
    if (mode === 'middle') dy = reference.y + reference.height / 2 - (bounds.y + bounds.height / 2);
    if (mode === 'bottom') dy = reference.y + reference.height - (bounds.y + bounds.height);
    result.set(item.id, { x: dx, y: dy });
  }
  return result;
}

/** Chia đều khoảng cách giữa các hình theo trục; hai hình ngoài cùng giữ nguyên. Cần từ 3 hình. */
export function distributeOffsets(
  items: ReadonlyArray<{ id: string; bounds: Rect }>,
  axis: 'horizontal' | 'vertical',
): Map<string, Point> {
  const result = new Map<string, Point>();
  if (items.length < 3) return result;
  const horizontal = axis === 'horizontal';
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  const sorted = [...items].sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = sorted[0].bounds;
  const last = sorted[sorted.length - 1].bounds;
  const total = start(last) + size(last) - start(first);
  const used = sorted.reduce((sum, item) => sum + size(item.bounds), 0);
  const gap = (total - used) / (sorted.length - 1);

  let cursor = start(first) + size(first) + gap;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const item = sorted[index];
    const delta = cursor - start(item.bounds);
    result.set(item.id, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta });
    cursor += size(item.bounds) + gap;
  }
  return result;
}
