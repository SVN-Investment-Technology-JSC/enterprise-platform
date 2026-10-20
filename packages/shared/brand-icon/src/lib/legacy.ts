import { scaling, transformGeometry } from './geometry.js';
import { LEGACY_PRESETS, type LegacyContainerShape, type LegacyIconSpec } from './legacy-data.js';
import { createShape, newId, type Geometry, type IconDocument, type IconShape } from './model.js';
import { brandPaint } from './palette.js';
import { isValidPathData, parsePathData } from './path-data.js';

export type FrameKind = Exclude<LegacyContainerShape, 'none'>;

export const FRAME_KINDS: readonly FrameKind[] = ['squircle', 'circle', 'hexagon', 'diamond', 'shield'];

export const FRAME_LABELS: Record<FrameKind, string> = {
  squircle: 'Vuông bo góc',
  circle: 'Tròn',
  hexagon: 'Lục giác',
  diamond: 'Thoi',
  shield: 'Khiên',
};

const BASE_INSET = 1.25;

/** Tỷ lệ co hình lõi mặc định để nét vẽ nằm gọn trong từng loại khung. */
const DEFAULT_GLYPH_SCALE: Record<LegacyContainerShape, number> = {
  none: 1,
  squircle: 1,
  circle: 0.85,
  shield: 0.8,
  hexagon: 0.85,
  diamond: 0.7,
};

export const frameInset = (strokeWidth = 0): number => Math.max(BASE_INSET, strokeWidth / 2 + 0.25);

/** Hình học của khung chứa, đã chừa chỗ cho nét viền để không bị cắt mép. */
export function frameGeometry(kind: FrameKind, size = 24, radius = 4, strokeWidth = 0): Geometry {
  const inset = frameInset(strokeWidth);
  const min = inset;
  const max = size - inset;
  const mid = size / 2;
  switch (kind) {
    case 'squircle':
      return {
        type: 'rect',
        x: min,
        y: min,
        width: max - min,
        height: max - min,
        rx: Math.min(Math.max(radius, 2), (size - inset * 2) / 2),
      };
    case 'circle':
      return { type: 'ellipse', cx: mid, cy: mid, rx: (size - inset * 2) / 2, ry: (size - inset * 2) / 2 };
    case 'hexagon': {
      const dy = (max - min) / 4;
      return parsePathData(`M ${mid} ${min} L ${max} ${min + dy} V ${max - dy} L ${mid} ${max} L ${min} ${max - dy} V ${min + dy} Z`);
    }
    case 'diamond':
      return parsePathData(`M ${mid} ${min} L ${max} ${mid} L ${mid} ${max} L ${min} ${mid} Z`);
    default:
      return parsePathData(
        `M ${mid} ${min} L ${max - 1} ${min + 3.5} V ${mid} C ${max - 1} ${max - 2} ${mid} ${max} ${mid} ${max} C ${mid} ${max} ${min + 1} ${max - 2} ${min + 1} ${mid} V ${min + 3.5} Z`,
      );
  }
}

export function createFrameShape(
  kind: FrameKind,
  options: { size?: number; radius?: number; strokeWidth?: number; stroke?: string; fill?: string; fillOpacity?: number } = {},
): IconShape {
  const strokeWidth = options.strokeWidth ?? 1.75;
  return createShape(frameGeometry(kind, options.size ?? 24, options.radius ?? 4, strokeWidth), {
    name: `Khung ${FRAME_LABELS[kind].toLowerCase()}`,
    stroke: options.stroke ?? 'currentColor',
    strokeWidth,
    fill: options.fill ?? 'none',
    fillOpacity: options.fillOpacity ?? 1,
  });
}

function accentPosition(shape: LegacyContainerShape, size: number, strokeWidth: number): { cx: number; cy: number } {
  const inset = frameInset(strokeWidth);
  const min = inset;
  const max = size - inset;
  const mid = size / 2;
  if (shape === 'none' || shape === 'squircle') return { cx: size - 3.5, cy: 3.5 };

  let edge: { x: number; y: number };
  switch (shape) {
    case 'circle': {
      const radius = (size - inset * 2) / 2;
      edge = { x: mid + radius * Math.SQRT1_2, y: mid - radius * Math.SQRT1_2 };
      break;
    }
    case 'hexagon':
      edge = { x: (mid + max) / 2, y: (min + min + (max - min) / 4) / 2 };
      break;
    case 'shield':
      edge = { x: (mid + max - 1) / 2, y: (min + min + 3.5) / 2 };
      break;
    default:
      edge = { x: (mid + max) / 2, y: (min + mid) / 2 };
  }
  const pull = 0.12;
  return {
    cx: Math.round((edge.x + (mid - edge.x) * pull) * 100) / 100,
    cy: Math.round((edge.y + (mid - edge.y) * pull) * 100) / 100,
  };
}

const LEGACY_FILL_OPACITY = { solid: 0.12, gradient: 0.15 } as const;

/** Chuyển icon kiểu cũ (một khung, một nét chính, nét phụ, chấm nhấn) sang mô hình nhiều lớp. */
export function documentFromLegacySpec(spec: LegacyIconSpec, timestamp = new Date().toISOString()): IconDocument {
  const size = Number.isFinite(spec.viewBoxSize) && spec.viewBoxSize > 0 ? spec.viewBoxSize : 24;
  const strokeWidth = Number.isFinite(spec.strokeWidth) ? Math.min(4, Math.max(0.5, spec.strokeWidth)) : 1.75;
  const tone = brandPaint(spec.colorTone);
  const mid = size / 2;
  const shapes: IconShape[] = [];

  if (spec.containerShape !== 'none') {
    const fillKind = spec.containerFill === 'none' ? null : LEGACY_FILL_OPACITY[spec.containerFill];
    shapes.push({
      ...createFrameShape(spec.containerShape, { size, radius: spec.cornerRadius, strokeWidth, stroke: tone }),
      name: 'Khung',
      fill: fillKind ? tone : 'none',
      fillOpacity: fillKind ?? 1,
    });
  }

  const scale =
    typeof spec.glyphScale === 'number' && spec.glyphScale >= 0.4 && spec.glyphScale <= 1.2
      ? spec.glyphScale
      : DEFAULT_GLYPH_SCALE[spec.containerShape];
  const fit = (data: string | undefined): Geometry | null => {
    if (!data || !isValidPathData(data)) return null;
    try {
      const geometry = parsePathData(data);
      return geometry.subpaths.length > 0 ? transformGeometry(geometry, scaling(scale, scale, mid, mid)) : null;
    } catch {
      return null;
    }
  };

  const glyph = fit(spec.glyphPath);
  if (glyph) shapes.push(createShape(glyph, { name: 'Nét chính', stroke: tone, strokeWidth }));
  const secondary = fit(spec.secondaryPath);
  if (secondary) shapes.push(createShape(secondary, { name: 'Nét phụ', stroke: tone, strokeWidth, opacity: 0.6 }));

  if (spec.accentDot) {
    const { cx, cy } = accentPosition(spec.containerShape, size, strokeWidth);
    shapes.push(
      createShape({ type: 'ellipse', cx, cy, rx: 1.5, ry: 1.5 }, { name: 'Điểm nhấn', fill: tone, stroke: 'none' }),
    );
  }

  return {
    schema: 1,
    id: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(spec.id) ? spec.id : newId('icon'),
    name: spec.name.trim().slice(0, 80) || 'Icon',
    description: spec.description.trim().slice(0, 300),
    category: spec.category,
    tags: [],
    status: spec.isCustom ? 'draft' : 'published',
    size,
    shapes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const PRESET_TIMESTAMP = '2026-10-16T00:00:00.000Z';

/** Icon mẫu của SVNDTS, dựng từ dữ liệu đời đầu. */
export function createPresetDocuments(): IconDocument[] {
  return LEGACY_PRESETS.map((spec) => documentFromLegacySpec(spec, PRESET_TIMESTAMP));
}

export const PRESET_IDS: ReadonlySet<string> = new Set(LEGACY_PRESETS.map((spec) => spec.id));
