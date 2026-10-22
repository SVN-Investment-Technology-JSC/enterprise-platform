import {
  LIMITS,
  geometryBounds,
  geometryToPath,
  isPaintNone,
  mapRectMatrix,
  rectCenter,
  rotation,
  scaling,
  unionRects,
  type IconShape,
  type Matrix,
  type Rect,
} from '@enterprise-platform/shared-brand-icon';

const EPS = 1e-9;
/** Cạnh nhỏ nhất cho phép khi nhập rộng/cao, để hình không bị ép về 0. */
export const MIN_EXTENT = 0.01;

export interface Common<T> {
  /** Các lớp đang chọn có giá trị khác nhau. */
  readonly mixed: boolean;
  /** Giá trị của lớp đầu tiên (hoặc `fallback` khi chưa chọn lớp nào). */
  readonly value: T;
}

export function commonValue<T>(shapes: readonly IconShape[], pick: (shape: IconShape) => T, fallback: T): Common<T> {
  if (shapes.length === 0) return { mixed: false, value: fallback };
  const first = pick(shapes[0]);
  return { mixed: shapes.some((shape) => pick(shape) !== first), value: first };
}

export const hasVisibleStroke = (shape: IconShape): boolean => !isPaintNone(shape.stroke);
export const hasVisibleFill = (shape: IconShape): boolean => !isPaintNone(shape.fill);

/* ---------- Khung bao, đổi cỡ, xoay, lật ---------- */

/** Khung bao hình học (không tính nét viền) của một nhóm lớp; dùng cho X, Y, rộng, cao và tâm xoay. */
export function geometryRect(shapes: readonly IconShape[]): Rect | null {
  return unionRects(shapes.map((shape) => geometryBounds(shape.geometry)));
}

export type BoundsField = 'x' | 'y' | 'width' | 'height';

/**
 * Ma trận đưa khung bao `rect` về khung mới khi đổi một ô trong X, Y, rộng, cao.
 * Khoá tỷ lệ chỉ có tác dụng với rộng/cao và khi cả hai cạnh đang khác 0.
 */
export function resizeMatrix(rect: Rect, field: BoundsField, value: number, lockAspect: boolean): Matrix | null {
  if (!Number.isFinite(value)) return null;
  if ((field === 'width' || field === 'height') && value < MIN_EXTENT) return null;

  let next: Rect = { ...rect, [field]: value };
  if (lockAspect && (field === 'width' || field === 'height') && rect.width > EPS && rect.height > EPS) {
    next =
      field === 'width'
        ? { ...next, height: (rect.height * value) / rect.width }
        : { ...next, width: (rect.width * value) / rect.height };
  }
  const unchanged =
    Math.abs(next.x - rect.x) < EPS &&
    Math.abs(next.y - rect.y) < EPS &&
    Math.abs(next.width - rect.width) < EPS &&
    Math.abs(next.height - rect.height) < EPS;
  return unchanged ? null : mapRectMatrix(rect, next);
}

/** Xoay thêm `degrees` độ (dương = theo chiều kim đồng hồ) quanh tâm khung bao. */
export function rotateAboutCenter(rect: Rect, degrees: number): Matrix {
  const center = rectCenter(rect);
  return rotation(degrees, center.x, center.y);
}

/** Lật quanh tâm khung bao; `horizontal` đổi trái-phải, `vertical` đổi trên-dưới. */
export function flipAboutCenter(rect: Rect, axis: 'horizontal' | 'vertical'): Matrix {
  const center = rectCenter(rect);
  return axis === 'horizontal' ? scaling(-1, 1, center.x, center.y) : scaling(1, -1, center.x, center.y);
}

/* ---------- Bo góc ---------- */

export interface RadiusInfo {
  /** Chỉ hiện ô bo góc khi mọi lớp có thể sửa đều là hình chữ nhật. */
  readonly applicable: boolean;
  readonly mixed: boolean;
  readonly value: number;
  /** Bo tối đa: nửa cạnh ngắn nhất trong các hình chữ nhật. */
  readonly max: number;
}

export function rectRadiusInfo(shapes: readonly IconShape[]): RadiusInfo {
  const editable = shapes.filter((shape) => !shape.locked);
  const rects = editable.flatMap((shape) => (shape.geometry.type === 'rect' ? [shape.geometry] : []));
  if (rects.length === 0 || rects.length !== editable.length) return { applicable: false, mixed: false, value: 0, max: 0 };
  const max = Math.min(...rects.map((rect) => Math.min(rect.width, rect.height) / 2));
  return { applicable: true, mixed: rects.some((rect) => rect.rx !== rects[0].rx), value: rects[0].rx, max };
}

/** Bản sao các hình chữ nhật với bo góc mới (kẹp theo nửa cạnh ngắn); hình khác và hình bị khoá giữ nguyên. */
export function withRectRadius(shapes: readonly IconShape[], radius: number): IconShape[] {
  return shapes.flatMap((shape) => {
    if (shape.locked || shape.geometry.type !== 'rect') return [];
    const { geometry } = shape;
    const rx = Math.max(0, Math.min(radius, geometry.width / 2, geometry.height / 2));
    return rx === geometry.rx ? [] : [{ ...shape, geometry: { ...geometry, rx } }];
  });
}

/* ---------- Căn chỉnh ---------- */

/** Một lớp thì chỉ có thể căn theo khung vẽ; nhiều lớp mới chọn được "so với vùng chọn". */
export function alignTarget(count: number, preferCanvas: boolean): 'selection' | 'canvas' {
  if (count < 2) return 'canvas';
  return preferCanvas ? 'canvas' : 'selection';
}

/* ---------- Thao tác đường ---------- */

export interface PathActionState {
  readonly combine: boolean;
  readonly separate: boolean;
  readonly convert: boolean;
}

/** Thao tác đường nào dùng được với các lớp đang chọn (lớp bị khoá không tính). */
export function pathActionState(shapes: readonly IconShape[]): PathActionState {
  const editable = shapes.filter((shape) => !shape.locked);
  return {
    combine: editable.length >= 2,
    separate: editable.some((shape) => geometryToPath(shape.geometry).subpaths.length > 1),
    convert: editable.some((shape) => shape.geometry.type !== 'path'),
  };
}

/* ---------- Nhãn (tags) ---------- */

export const MAX_TAG_LENGTH = 24;

/** Thêm nhãn từ chữ nhập; tách theo dấu phẩy, bỏ nhãn rỗng hoặc trùng (không phân biệt hoa thường), dừng ở mức tối đa. */
export function addTags(tags: readonly string[], input: string, max: number = LIMITS.maxTags): readonly string[] {
  const next = [...tags];
  for (const part of input.split(',')) {
    const clean = part.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (!clean || next.length >= max) continue;
    if (next.some((tag) => tag.toLowerCase() === clean.toLowerCase())) continue;
    next.push(clean);
  }
  return next.length === tags.length ? tags : next;
}

export const removeTag = (tags: readonly string[], tag: string): readonly string[] => tags.filter((item) => item !== tag);
