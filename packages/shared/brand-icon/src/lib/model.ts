/**
 * Mô hình tài liệu icon: một icon gồm nhiều lớp hình, mỗi lớp tự chọn nét, tô đặc, độ mờ.
 * Toạ độ nằm trong lưới `size x size` (mặc định 24x24).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Màu: 'none', 'currentColor', 'brand:<khoá bảng màu>' hoặc mã hex '#rrggbb'. */
export type Paint = string;

/**
 * Điểm neo của đường cong. `hin`/`hout` là toạ độ tuyệt đối của tay cầm Bezier vào/ra;
 * vắng mặt nghĩa là đoạn đó đi thẳng tới điểm neo.
 */
export interface PathNode {
  readonly x: number;
  readonly y: number;
  readonly hin?: Point;
  readonly hout?: Point;
}

export interface Subpath {
  readonly nodes: readonly PathNode[];
  readonly closed: boolean;
}

export interface PathGeometry {
  readonly type: 'path';
  readonly subpaths: readonly Subpath[];
}

export interface RectGeometry {
  readonly type: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
}

export interface EllipseGeometry {
  readonly type: 'ellipse';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export type Geometry = PathGeometry | RectGeometry | EllipseGeometry;

export type LineCap = 'round' | 'butt' | 'square';
export type LineJoin = 'round' | 'miter' | 'bevel';
export type FillRule = 'nonzero' | 'evenodd';

export interface IconShape {
  readonly id: string;
  readonly name: string;
  readonly geometry: Geometry;
  readonly fill: Paint;
  readonly fillOpacity: number;
  readonly stroke: Paint;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly linecap: LineCap;
  readonly linejoin: LineJoin;
  readonly fillRule: FillRule;
  readonly hidden: boolean;
  readonly locked: boolean;
}

export type IconCategory = 'brand' | 'module' | 'system' | 'custom';
export type IconStatus = 'draft' | 'published';

export interface IconDocument {
  readonly schema: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: IconCategory;
  readonly tags: readonly string[];
  readonly status: IconStatus;
  /** Cạnh lưới vẽ; viewBox là `0 0 size size`. */
  readonly size: number;
  readonly shapes: readonly IconShape[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DEFAULT_SIZE = 24;
export const ICON_SIZES: readonly number[] = [16, 20, 24, 32, 48];
export const DEFAULT_STROKE_WIDTH = 1.75;
export const CATEGORIES: readonly IconCategory[] = ['brand', 'module', 'system', 'custom'];

export const CATEGORY_LABELS: Record<IconCategory, string> = {
  brand: 'Thương hiệu',
  module: 'Phân hệ',
  system: 'Hệ thống',
  custom: 'Tùy biến',
};

let idCounter = 0;

/** Mã ngắn không trùng trong một phiên; đủ cho id lớp hình và icon cục bộ. */
export function newId(prefix = 'id'): string {
  idCounter += 1;
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export const DEFAULT_SHAPE_STYLE = {
  fill: 'none',
  fillOpacity: 1,
  stroke: 'currentColor',
  strokeWidth: DEFAULT_STROKE_WIDTH,
  opacity: 1,
  linecap: 'round',
  linejoin: 'round',
  fillRule: 'nonzero',
  hidden: false,
  locked: false,
} as const satisfies Omit<IconShape, 'id' | 'name' | 'geometry'>;

export function createShape(
  geometry: Geometry,
  overrides: Partial<Omit<IconShape, 'geometry'>> = {},
): IconShape {
  return {
    id: newId('shape'),
    name: defaultShapeName(geometry),
    geometry,
    ...DEFAULT_SHAPE_STYLE,
    ...overrides,
  };
}

export function defaultShapeName(geometry: Geometry): string {
  switch (geometry.type) {
    case 'rect':
      return 'Chữ nhật';
    case 'ellipse':
      return geometry.rx === geometry.ry ? 'Hình tròn' : 'Elip';
    default:
      return 'Đường';
  }
}

export function createDocument(overrides: Partial<IconDocument> = {}): IconDocument {
  const now = new Date().toISOString();
  return {
    schema: 1,
    id: newId('icon'),
    name: 'Icon mới',
    description: '',
    category: 'custom',
    tags: [],
    status: 'draft',
    size: DEFAULT_SIZE,
    shapes: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export const roundTo = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function isPaintNone(paint: Paint): boolean {
  return paint === 'none' || paint === '';
}

export function findShape(doc: IconDocument, id: string): IconShape | undefined {
  return doc.shapes.find((shape) => shape.id === id);
}
