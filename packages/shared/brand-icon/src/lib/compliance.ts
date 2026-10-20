import { geometryBounds, visualBounds } from './geometry.js';
import { brandKeyOf, normalizeHex, type BrandPalette } from './palette.js';
import { isPaintNone, type Geometry, type IconDocument, type IconShape } from './model.js';

export interface BrandRules {
  /** Độ dày nét được phép (đơn vị lưới). */
  readonly allowedStrokeWidths: readonly number[];
  /** Khoảng chừa tối thiểu từ mép nét ngoài cùng tới mép lưới. */
  readonly safePadding: number;
  /** Bước bắt dính và bước kiểm tra lệch lưới. */
  readonly snapStep: number;
  /** Chỉ cho phép màu nằm trong bảng màu thương hiệu. */
  readonly requirePaletteColors: boolean;
  /** Kích thước tối thiểu của một chi tiết, để còn nhìn thấy ở cỡ 16px. */
  readonly minFeature: number;
  readonly maxShapes: number;
}

export const DEFAULT_RULES: BrandRules = {
  allowedStrokeWidths: [1.5, 1.75, 2],
  safePadding: 0.25,
  snapStep: 0.5,
  requirePaletteColors: true,
  minFeature: 0.75,
  maxShapes: 12,
};

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ComplianceIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly shapeId?: string;
}

const TOLERANCE = 0.011;
const formatStep = (value: number) => String(value).replace('.', ',');

function geometryValues(geometry: Geometry): number[] {
  if (geometry.type === 'rect') return [geometry.x, geometry.y, geometry.width, geometry.height];
  if (geometry.type === 'ellipse') return [geometry.cx, geometry.cy, geometry.rx, geometry.ry];
  return geometry.subpaths.flatMap((sub) => sub.nodes.flatMap((node) => [node.x, node.y]));
}

const offGrid = (value: number, step: number) => {
  const remainder = Math.abs(value / step - Math.round(value / step)) * step;
  return remainder > TOLERANCE;
};

function paintOutsidePalette(paint: string, palette: BrandPalette): boolean {
  if (isPaintNone(paint) || paint === 'currentColor') return false;
  const key = brandKeyOf(paint);
  if (key !== null) return !palette.tokens.some((token) => token.key === key);
  const hex = normalizeHex(paint);
  return hex === null || !palette.tokens.some((token) => token.hex.toLowerCase() === hex);
}

function shapeIssues(shape: IconShape, doc: IconDocument, rules: BrandRules, palette: BrandPalette): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const label = shape.name;

  if (!isPaintNone(shape.stroke) && !rules.allowedStrokeWidths.some((width) => Math.abs(width - shape.strokeWidth) < TOLERANCE)) {
    issues.push({
      code: 'STROKE_WIDTH',
      severity: 'warning',
      shapeId: shape.id,
      message: `"${label}": nét ${shape.strokeWidth} không thuộc bộ cho phép (${rules.allowedStrokeWidths.join(', ')}).`,
    });
  }

  const bounds = visualBounds(shape);
  const pad = rules.safePadding;
  if (
    bounds.x < pad - TOLERANCE ||
    bounds.y < pad - TOLERANCE ||
    bounds.x + bounds.width > doc.size - pad + TOLERANCE ||
    bounds.y + bounds.height > doc.size - pad + TOLERANCE
  ) {
    issues.push({
      code: 'SAFE_AREA',
      severity: 'warning',
      shapeId: shape.id,
      message: `"${label}" chạm hoặc vượt vùng an toàn (chừa ${pad} quanh mép lưới).`,
    });
  }

  const box = geometryBounds(shape.geometry);
  if (box.width < rules.minFeature && box.height < rules.minFeature) {
    issues.push({
      code: 'MIN_FEATURE',
      severity: 'warning',
      shapeId: shape.id,
      message: `"${label}" quá nhỏ (dưới ${rules.minFeature}), khó nhìn thấy ở cỡ 16px.`,
    });
  }

  const stray = geometryValues(shape.geometry).filter((value) => offGrid(value, rules.snapStep)).length;
  if (stray > 0) {
    issues.push({
      code: 'OFF_GRID',
      severity: 'info',
      shapeId: shape.id,
      message: `"${label}": ${stray} toạ độ lệch lưới ${formatStep(rules.snapStep)}.`,
    });
  }

  if (rules.requirePaletteColors && (paintOutsidePalette(shape.stroke, palette) || paintOutsidePalette(shape.fill, palette))) {
    issues.push({
      code: 'PALETTE',
      severity: 'warning',
      shapeId: shape.id,
      message: `"${label}" dùng màu ngoài bảng màu thương hiệu.`,
    });
  }
  return issues;
}

/** Kiểm tra icon theo quy chuẩn thương hiệu; kết quả xếp lỗi trước, cảnh báo, rồi gợi ý. */
export function checkCompliance(doc: IconDocument, palette: BrandPalette, rules: BrandRules = DEFAULT_RULES): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const visible = doc.shapes.filter((shape) => !shape.hidden);

  if (!doc.name.trim()) issues.push({ code: 'NAME', severity: 'error', message: 'Icon chưa có tên.' });
  if (visible.length === 0) issues.push({ code: 'EMPTY', severity: 'error', message: 'Icon chưa có hình nào hiển thị.' });
  if (visible.length > rules.maxShapes) {
    issues.push({
      code: 'TOO_MANY_SHAPES',
      severity: 'warning',
      message: `Icon có ${visible.length} lớp, nhiều hơn mức gợi ý ${rules.maxShapes}; nên gộp bớt để gọn và dễ đọc.`,
    });
  }

  const widths = new Set(visible.filter((shape) => !isPaintNone(shape.stroke)).map((shape) => shape.strokeWidth));
  if (widths.size > 1) {
    issues.push({ code: 'MIXED_STROKE', severity: 'info', message: `Icon dùng ${widths.size} độ dày nét khác nhau; nên thống nhất một độ dày.` });
  }

  for (const shape of visible) issues.push(...shapeIssues(shape, doc, rules, palette));

  const rank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function normalizeRules(raw: unknown): BrandRules {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_RULES;
  const item = raw as Record<string, unknown>;
  const widths = Array.isArray(item.allowedStrokeWidths)
    ? [...new Set(item.allowedStrokeWidths.filter((width): width is number => typeof width === 'number' && width >= 0.25 && width <= 6))]
        .sort((a, b) => a - b)
        .slice(0, 10)
    : [];
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    allowedStrokeWidths: widths.length > 0 ? widths : DEFAULT_RULES.allowedStrokeWidths,
    safePadding: number(item.safePadding, 0, 6, DEFAULT_RULES.safePadding),
    snapStep: number(item.snapStep, 0.05, 4, DEFAULT_RULES.snapStep),
    requirePaletteColors: item.requirePaletteColors === false ? false : true,
    minFeature: number(item.minFeature, 0, 6, DEFAULT_RULES.minFeature),
    maxShapes: Math.round(number(item.maxShapes, 1, 100, DEFAULT_RULES.maxShapes)),
  };
}
