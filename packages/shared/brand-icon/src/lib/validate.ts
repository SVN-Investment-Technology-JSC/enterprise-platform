import { documentFromLegacySpec } from './legacy.js';
import type { LegacyIconSpec } from './legacy-data.js';
import {
  CATEGORIES,
  newId,
  type Geometry,
  type IconCategory,
  type IconDocument,
  type IconShape,
  type IconStatus,
  type LineCap,
  type LineJoin,
  type PathNode,
  type Point,
  type Subpath,
} from './model.js';
import { HEX_PATTERN, normalizeHex } from './palette.js';

export const LIMITS = {
  maxShapes: 200,
  maxSubpaths: 64,
  maxNodes: 2000,
  maxIcons: 500,
  maxTags: 12,
  coordinate: 1000,
} as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const BRAND_PAINT = /^brand:[a-z0-9][a-z0-9-]{0,31}$/;

const pick = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const coordinate = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMITS.coordinate ? value : null;

const text = (value: unknown, maxLength: number): string =>
  typeof value === 'string'
    ? [...value]
        .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
        .join('')
        .trim()
        .slice(0, maxLength)
    : '';

function normalizePaintValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  if (value === 'none' || value === 'currentColor') return value;
  if (BRAND_PAINT.test(value)) return value;
  if (HEX_PATTERN.test(value)) return normalizeHex(value) ?? fallback;
  return fallback;
}

function normalizePoint(value: unknown): Point | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const x = coordinate((value as Record<string, unknown>).x);
  const y = coordinate((value as Record<string, unknown>).y);
  return x === null || y === null ? null : { x, y };
}

function normalizeNode(value: unknown): PathNode | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const x = coordinate(raw.x);
  const y = coordinate(raw.y);
  if (x === null || y === null) return null;
  const hin = normalizePoint(raw.hin);
  const hout = normalizePoint(raw.hout);
  if (hin === null || hout === null) return null;
  return { x, y, ...(hin ? { hin } : {}), ...(hout ? { hout } : {}) };
}

function normalizeGeometry(value: unknown): Geometry | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.type === 'rect') {
    const x = coordinate(raw.x);
    const y = coordinate(raw.y);
    const width = coordinate(raw.width);
    const height = coordinate(raw.height);
    if (x === null || y === null || width === null || height === null || width < 0 || height < 0) return null;
    return { type: 'rect', x, y, width, height, rx: pick(raw.rx, 0, Math.min(width, height) / 2, 0) };
  }
  if (raw.type === 'ellipse') {
    const cx = coordinate(raw.cx);
    const cy = coordinate(raw.cy);
    const rx = coordinate(raw.rx);
    const ry = coordinate(raw.ry);
    if (cx === null || cy === null || rx === null || ry === null || rx < 0 || ry < 0) return null;
    return { type: 'ellipse', cx, cy, rx, ry };
  }
  if (raw.type === 'path' && Array.isArray(raw.subpaths) && raw.subpaths.length <= LIMITS.maxSubpaths) {
    let total = 0;
    const subpaths: Subpath[] = [];
    for (const item of raw.subpaths) {
      if (typeof item !== 'object' || item === null || !Array.isArray((item as { nodes?: unknown }).nodes)) return null;
      const nodesRaw = (item as { nodes: unknown[] }).nodes;
      total += nodesRaw.length;
      if (total > LIMITS.maxNodes) return null;
      const nodes: PathNode[] = [];
      for (const node of nodesRaw) {
        const clean = normalizeNode(node);
        if (!clean) return null;
        nodes.push(clean);
      }
      subpaths.push({ nodes, closed: (item as { closed?: unknown }).closed === true });
    }
    return { type: 'path', subpaths };
  }
  return null;
}

export function normalizeShape(value: unknown): IconShape | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const geometry = normalizeGeometry(raw.geometry);
  if (!geometry) return null;
  const caps: readonly LineCap[] = ['round', 'butt', 'square'];
  const joins: readonly LineJoin[] = ['round', 'miter', 'bevel'];
  return {
    id: typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : newId('shape'),
    name: text(raw.name, 40) || 'Hình',
    geometry,
    fill: normalizePaintValue(raw.fill, 'none'),
    fillOpacity: pick(raw.fillOpacity, 0, 1, 1),
    stroke: normalizePaintValue(raw.stroke, 'currentColor'),
    strokeWidth: pick(raw.strokeWidth, 0.25, 6, 1.75),
    opacity: pick(raw.opacity, 0, 1, 1),
    linecap: caps.includes(raw.linecap as LineCap) ? (raw.linecap as LineCap) : 'round',
    linejoin: joins.includes(raw.linejoin as LineJoin) ? (raw.linejoin as LineJoin) : 'round',
    fillRule: raw.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    hidden: raw.hidden === true,
    locked: raw.locked === true,
  };
}

function looksLegacy(value: Record<string, unknown>): boolean {
  return typeof value.glyphPath === 'string' && typeof value.containerShape === 'string' && !Array.isArray(value.shapes);
}

/**
 * Ép dữ liệu thô (localStorage, tệp JSON nạp vào, thân yêu cầu API) về đúng kiểu và giới hạn; trả null nếu không dùng được.
 * Nhận cả icon kiểu cũ (một khung + một nét chính) và chuyển sang mô hình nhiều lớp.
 */
export function normalizeDocument(value: unknown): IconDocument | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (looksLegacy(raw)) {
    try {
      const spec = raw as unknown as LegacyIconSpec;
      if (typeof spec.name !== 'string' || typeof spec.id !== 'string') return null;
      return normalizeDocument(documentFromLegacySpec({ ...spec, description: typeof spec.description === 'string' ? spec.description : '' }));
    } catch {
      return null;
    }
  }

  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id) || !Array.isArray(raw.shapes)) return null;
  const name = text(raw.name, 80);
  if (!name) return null;
  if (raw.shapes.length > LIMITS.maxShapes) return null;

  const shapes: IconShape[] = [];
  const seen = new Set<string>();
  for (const item of raw.shapes) {
    const shape = normalizeShape(item);
    if (!shape) return null;
    const unique = seen.has(shape.id) ? { ...shape, id: newId('shape') } : shape;
    seen.add(unique.id);
    shapes.push(unique);
  }

  const now = new Date().toISOString();
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((tag) => text(tag, 24)).filter(Boolean))].slice(0, LIMITS.maxTags)
    : [];
  const date = (candidate: unknown) => (typeof candidate === 'string' && !Number.isNaN(Date.parse(candidate)) ? candidate : now);
  return {
    schema: 1,
    id: raw.id,
    name,
    description: text(raw.description, 300),
    category: (CATEGORIES as readonly string[]).includes(raw.category as string) ? (raw.category as IconCategory) : 'custom',
    tags,
    status: (raw.status === 'published' ? 'published' : 'draft') satisfies IconStatus,
    size: Math.round(pick(raw.size, 8, 128, 24)),
    shapes,
    createdAt: date(raw.createdAt),
    updatedAt: date(raw.updatedAt),
  };
}

export interface ParsedLibrary {
  readonly docs: IconDocument[];
  readonly skipped: number;
}

/** Đọc mảng icon thô, bỏ mục sai định dạng và mục trùng mã (giữ mục đầu tiên). */
export function normalizeLibrary(value: unknown): ParsedLibrary {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { icons?: unknown }).icons)
      ? (value as { icons: unknown[] }).icons
      : null;
  if (!list) throw new Error('Thư viện icon phải là một mảng JSON.');
  const seen = new Set<string>();
  const docs: IconDocument[] = [];
  let skipped = 0;
  for (const entry of list.slice(0, LIMITS.maxIcons)) {
    const doc = normalizeDocument(entry);
    if (!doc || seen.has(doc.id)) {
      skipped += 1;
      continue;
    }
    seen.add(doc.id);
    docs.push(doc);
  }
  skipped += Math.max(0, list.length - LIMITS.maxIcons);
  return { docs, skipped };
}

export function parseLibraryJson(textContent: string): ParsedLibrary {
  let data: unknown;
  try {
    data = JSON.parse(textContent);
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  return normalizeLibrary(data);
}
