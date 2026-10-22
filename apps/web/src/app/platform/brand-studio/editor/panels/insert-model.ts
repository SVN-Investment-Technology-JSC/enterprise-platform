import {
  FRAME_KINDS,
  GLYPH_LIBRARY,
  createFrameShape,
  createShape,
  geometryToPath,
  importSvg,
  parsePathData,
  pathToData,
  frameGeometry,
  roundTo,
  scaling,
  transformGeometry,
  type BrandRules,
  type EditorAction,
  type FrameKind,
  type GlyphTemplate,
  type IconShape,
  type PathNode,
  type SvgImportResult,
} from '@enterprise-platform/shared-brand-icon';
import { defaultStrokeWidth, isAllowedStrokeWidth } from './stroke-width';

/* ---------- Hình nhanh ---------- */

export type QuickShapeKind = 'rect' | 'ellipse' | 'line' | 'polygon' | 'star';

export const MIN_SIDES = 3;
export const MAX_SIDES = 12;
export const DEFAULT_SIDES = 5;

export const clampSides = (value: number): number => Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(value)));

/** Tỷ lệ bán kính trong của ngôi sao so với bán kính ngoài. */
const STAR_INNER_RATIO = 0.45;

const snapHalf = (value: number): number => Math.round(value * 2) / 2;

function regularNodes(count: number, size: number, radius: (index: number) => number, stepDegrees: number): PathNode[] {
  const mid = size / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((-90 + stepDegrees * index) * Math.PI) / 180;
    const r = radius(index);
    return { x: roundTo(mid + r * Math.cos(angle), 3), y: roundTo(mid + r * Math.sin(angle), 3) };
  });
}

/**
 * Hình nhanh đặt giữa lưới, chỉ có nét (không tô) và độ dày theo quy chuẩn.
 * Chữ nhật và tròn nằm trên lưới nửa đơn vị; đa giác và ngôi sao có đỉnh đầu hướng lên.
 */
export function quickShape(kind: QuickShapeKind, options: { size: number; strokeWidth: number; sides?: number }): IconShape {
  const { size, strokeWidth } = options;
  const mid = size / 2;
  const margin = snapHalf(size / 4);
  const sides = clampSides(options.sides ?? DEFAULT_SIDES);

  switch (kind) {
    case 'rect':
      return createShape({ type: 'rect', x: margin, y: margin, width: size - margin * 2, height: size - margin * 2, rx: 0 }, { strokeWidth });
    case 'ellipse':
      return createShape({ type: 'ellipse', cx: mid, cy: mid, rx: mid - margin, ry: mid - margin }, { strokeWidth });
    case 'line':
      return createShape(
        {
          type: 'path',
          subpaths: [
            {
              closed: false,
              nodes: [
                { x: margin, y: mid },
                { x: size - margin, y: mid },
              ],
            },
          ],
        },
        { name: 'Đường thẳng', strokeWidth },
      );
    case 'polygon': {
      const radius = size * 0.375;
      return createShape(
        { type: 'path', subpaths: [{ closed: true, nodes: regularNodes(sides, size, () => radius, 360 / sides) }] },
        { name: 'Đa giác', strokeWidth },
      );
    }
    default: {
      const outer = size * 0.4;
      return createShape(
        {
          type: 'path',
          subpaths: [
            {
              closed: true,
              nodes: regularNodes(sides * 2, size, (index) => (index % 2 === 0 ? outer : outer * STAR_INNER_RATIO), 180 / sides),
            },
          ],
        },
        { name: 'Ngôi sao', strokeWidth },
      );
    }
  }
}

/* ---------- Khung mẫu ---------- */

/** Chuỗi `d` của từng loại khung ở lưới 24, để vẽ ảnh nhỏ trên nút chèn. */
export const FRAME_PREVIEW_PATHS: Readonly<Record<FrameKind, string>> = Object.fromEntries(
  FRAME_KINDS.map((kind) => [kind, pathToData(geometryToPath(frameGeometry(kind, 24, 4, 1.75)))]),
) as Record<FrameKind, string>;

/**
 * Chuỗi action chèn hình xuống dưới cùng (khung nằm sau nét chính), gộp thành một bước hoàn tác và chọn các hình vừa chèn.
 */
export function insertBehind(shapes: readonly IconShape[]): EditorAction[] {
  return [
    { type: 'gestureStart' },
    { type: 'addShapes', shapes },
    { type: 'reorder', ids: shapes.map((shape) => shape.id), mode: 'back' },
    { type: 'gestureEnd' },
  ];
}

export function frameShape(kind: FrameKind, size: number, rules: BrandRules): IconShape {
  return createFrameShape(kind, { size, strokeWidth: defaultStrokeWidth(rules.allowedStrokeWidths) });
}

/* ---------- Thư viện hình mẫu ---------- */

export const GLYPH_GROUPS: readonly GlyphTemplate['group'][] = ['Monogram', 'Nghiệp vụ', 'Hệ thống'];

export function glyphsByGroup(): Array<{ group: GlyphTemplate['group']; items: GlyphTemplate[] }> {
  return GLYPH_GROUPS.map((group) => ({ group, items: GLYPH_LIBRARY.filter((item) => item.group === group) })).filter(
    (entry) => entry.items.length > 0,
  );
}

/** Hình mẫu (vẽ ở lưới 24) đổi thành lớp đường và co về cỡ lưới của icon; `null` nếu dữ liệu đường hỏng. */
export function glyphShape(template: GlyphTemplate, size: number, strokeWidth: number): IconShape | null {
  try {
    const parsed = parsePathData(template.path);
    if (parsed.subpaths.length === 0) return null;
    const factor = size / 24;
    const geometry = factor === 1 ? parsed : transformGeometry(parsed, scaling(factor, factor, 0, 0));
    return createShape(geometry, { name: template.name.slice(0, 40), strokeWidth });
  } catch {
    return null;
  }
}

/* ---------- Nhập SVG ---------- */

export const MAX_SVG_BYTES = 1024 * 1024;

/** Lý do không nhận tệp, hoặc `null` nếu nhận được. */
export function checkSvgFile(file: { name: string; type: string; size: number }): string | null {
  if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') return 'Chỉ nhận tệp .svg.';
  if (file.size > MAX_SVG_BYTES) return 'Tệp quá lớn (tối đa 1 MB).';
  return null;
}

export function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Không đọc được tệp.'));
    reader.readAsText(file);
  });
}

export interface SvgAnalysis {
  readonly result: SvgImportResult | null;
  readonly error: string | null;
  /** Độ dày nét chủ đạo của SVG lệch bộ độ dày cho phép: nên chuẩn hoá. */
  readonly deviates: boolean;
}

const EMPTY_ANALYSIS: SvgAnalysis = { result: null, error: null, deviates: false };

/** Đọc thử SVG để biết sẽ nhập được gì (số hình, cảnh báo, độ dày nét) trước khi chèn. */
export function analyzeSvg(source: string, size: number, rules: BrandRules): SvgAnalysis {
  if (!source.trim()) return EMPTY_ANALYSIS;
  if (source.length > MAX_SVG_BYTES) return { result: null, error: 'Mã SVG quá lớn (tối đa 1 MB).', deviates: false };
  try {
    const result = importSvg(source, { size });
    const dominant = result.dominantStrokeWidth;
    return {
      result,
      error: null,
      deviates: dominant !== null && !isAllowedStrokeWidth(dominant, rules.allowedStrokeWidths),
    };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : 'Không đọc được mã SVG.', deviates: false };
  }
}

/** Nhập SVG; `normalize` ép mọi nét về độ dày mặc định theo quy chuẩn. */
export function importForInsert(source: string, size: number, rules: BrandRules, normalize: boolean): SvgImportResult {
  return importSvg(source, normalize ? { size, strokeWidth: defaultStrokeWidth(rules.allowedStrokeWidths) } : { size });
}

/** Chỉ giữ vài cảnh báo đầu để khung nhập gọn; phần còn lại gộp thành một con số. */
export function trimWarnings(warnings: readonly string[], limit = 3): { shown: string[]; hidden: number } {
  return { shown: warnings.slice(0, limit), hidden: Math.max(0, warnings.length - limit) };
}
