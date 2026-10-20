import { isValidPathData } from './brand-icon-generator';
import {
  BRAND_COLORS,
  SVNDTS_ICON_PRESETS,
  type BrandColorKey,
  type ContainerFill,
  type ContainerShape,
  type StructuredIconSpec,
} from './brand-icon.types';

const SHAPES: readonly ContainerShape[] = ['none', 'squircle', 'shield', 'hexagon', 'circle', 'diamond'];
const FILLS: readonly ContainerFill[] = ['none', 'solid', 'gradient'];
const CATEGORIES: readonly StructuredIconSpec['category'][] = ['brand', 'module', 'custom'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_ICONS = 500;

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function pickText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * Ép dữ liệu thô (từ localStorage hay file JSON nạp vào) về đúng kiểu; trả null nếu không dùng được.
 */
export function normalizeIconSpec(raw: unknown): StructuredIconSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;

  if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) return null;
  const name = pickText(item.name, 80);
  if (!name) return null;
  if (typeof item.glyphPath !== 'string' || !isValidPathData(item.glyphPath)) return null;

  const category = CATEGORIES.includes(item.category as StructuredIconSpec['category'])
    ? (item.category as StructuredIconSpec['category'])
    : 'custom';
  const secondaryPath =
    typeof item.secondaryPath === 'string' && item.secondaryPath.trim() !== '' && isValidPathData(item.secondaryPath)
      ? item.secondaryPath.trim()
      : undefined;
  const glyphScale =
    typeof item.glyphScale === 'number' && item.glyphScale >= 0.4 && item.glyphScale <= 1.2
      ? item.glyphScale
      : undefined;

  const spec: StructuredIconSpec = {
    id: item.id,
    name,
    category,
    description: pickText(item.description, 300),
    viewBoxSize: 24,
    containerShape: SHAPES.includes(item.containerShape as ContainerShape)
      ? (item.containerShape as ContainerShape)
      : 'squircle',
    containerFill: FILLS.includes(item.containerFill as ContainerFill)
      ? (item.containerFill as ContainerFill)
      : 'none',
    strokeWidth: pickNumber(item.strokeWidth, 0.5, 4, 1.75),
    colorTone: (item.colorTone as string) in BRAND_COLORS ? (item.colorTone as BrandColorKey) : 'sapphire',
    cornerRadius: pickNumber(item.cornerRadius, 0, 12, 4),
    accentDot: item.accentDot === true,
    glyphPath: item.glyphPath.trim(),
    isCustom: item.isCustom === true || category === 'custom',
  };
  if (secondaryPath) spec.secondaryPath = secondaryPath;
  if (glyphScale !== undefined) spec.glyphScale = glyphScale;
  return spec;
}

export interface ParsedIconLibrary {
  icons: StructuredIconSpec[];
  skipped: number;
}

/**
 * Đọc mảng icon thô, bỏ mục sai định dạng và mục trùng id (giữ mục đầu tiên).
 */
export function normalizeIconList(raw: unknown): ParsedIconLibrary {
  if (!Array.isArray(raw)) throw new Error('Thư viện icon phải là một mảng JSON.');
  const seen = new Set<string>();
  const icons: StructuredIconSpec[] = [];
  let skipped = 0;
  for (const entry of raw.slice(0, MAX_ICONS)) {
    const spec = normalizeIconSpec(entry);
    if (!spec || seen.has(spec.id)) {
      skipped += 1;
      continue;
    }
    seen.add(spec.id);
    icons.push(spec);
  }
  skipped += Math.max(0, raw.length - MAX_ICONS);
  return { icons, skipped };
}

export function parseIconLibrary(text: string): ParsedIconLibrary {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  return normalizeIconList(data);
}

/**
 * Icon mẫu mới thêm vào code luôn xuất hiện, kể cả khi người dùng đã lưu thư viện từ trước.
 */
export function mergeWithPresets(icons: StructuredIconSpec[]): StructuredIconSpec[] {
  const present = new Set(icons.map((icon) => icon.id));
  const missing = SVNDTS_ICON_PRESETS.filter((preset) => !present.has(preset.id)).map((preset) => ({ ...preset }));
  return [...icons, ...missing];
}
