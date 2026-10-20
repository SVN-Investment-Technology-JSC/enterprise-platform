import {
  BRAND_COLORS,
  type ContainerShape,
  type ExportColorMode,
  type StructuredIconSpec,
} from './brand-icon.types';

const BASE_INSET = 1.25;
const MAX_PATH_LENGTH = 4000;
const PATH_DATA_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

/** Tỷ lệ hình lõi mặc định để nét vẽ nằm gọn trong từng loại khung. */
export const DEFAULT_GLYPH_SCALE: Record<ContainerShape, number> = {
  none: 1,
  squircle: 1,
  circle: 0.85,
  shield: 0.8,
  hexagon: 0.85,
  diamond: 0.7,
};

export type SvgAttrValue = string | number | { expr: string };

export interface SvgNode {
  tag: 'defs' | 'linearGradient' | 'stop' | 'path' | 'circle' | 'g';
  attrs: Record<string, SvgAttrValue>;
  children?: SvgNode[];
}

export interface IconSvgModel {
  viewBox: string;
  rootAttrs: Record<string, SvgAttrValue>;
  children: SvgNode[];
}

export interface IconRenderOptions {
  colorMode?: ExportColorMode;
  /** id của gradient; mặc định suy ra từ id icon. */
  gradientId?: string;
  /** true: id gradient lấy từ biến `gradientId` trong component sinh ra. */
  dynamicGradientId?: boolean;
}

/**
 * Chỉ cho phép ký tự hợp lệ của dữ liệu path SVG, chặn chuỗi có thể phá thuộc tính khi ghép vào markup.
 */
export function isValidPathData(d: string | undefined): boolean {
  if (d === undefined) return true;
  const trimmed = d.trim();
  if (trimmed === '') return true;
  return trimmed.length <= MAX_PATH_LENGTH && PATH_DATA_PATTERN.test(trimmed) && /^[Mm]/.test(trimmed);
}

export function sanitizePathData(d: string | undefined): string {
  if (d === undefined || !isValidPathData(d)) return '';
  return d.trim();
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/**
 * Khoảng chừa quanh khung để nét viền không bị cắt ở mép viewBox.
 */
export function getContainerInset(strokeWidth = 0): number {
  return Math.max(BASE_INSET, strokeWidth / 2 + 0.25);
}

/**
 * Tạo SVG path chính xác theo hình học cho khung chứa (Container Shape)
 */
export function getContainerPath(
  shape: ContainerShape,
  size = 24,
  radius = 4,
  strokeWidth = 0,
): string {
  if (shape === 'none') return '';

  const padding = getContainerInset(strokeWidth);
  const min = padding;
  const max = size - padding;
  const mid = size / 2;
  const r = Math.min(Math.max(radius, 2), (size - padding * 2) / 2);

  switch (shape) {
    case 'squircle':
      return `M ${min + r} ${min} H ${max - r} A ${r} ${r} 0 0 1 ${max} ${min + r} V ${max - r} A ${r} ${r} 0 0 1 ${max - r} ${max} H ${min + r} A ${r} ${r} 0 0 1 ${min} ${max - r} V ${min + r} A ${r} ${r} 0 0 1 ${min + r} ${min} Z`;

    case 'shield':
      // Hình khiên bảo mật doanh nghiệp đối xứng
      return `M ${mid} ${min} L ${max - 1} ${min + 3.5} V ${mid} C ${max - 1} ${max - 2} ${mid} ${max} ${mid} ${max} C ${mid} ${max} ${min + 1} ${max - 2} ${min + 1} ${mid} V ${min + 3.5} Z`;

    case 'hexagon': {
      // Lục giác vát cạnh kỹ thuật
      const dy = (max - min) / 4;
      return `M ${mid} ${min} L ${max} ${min + dy} V ${max - dy} L ${mid} ${max} L ${min} ${max - dy} V ${min + dy} Z`;
    }

    case 'circle': {
      const cr = (size - padding * 2) / 2;
      return `M ${mid - cr} ${mid} A ${cr} ${cr} 0 1 0 ${mid + cr} ${mid} A ${cr} ${cr} 0 1 0 ${mid - cr} ${mid} Z`;
    }

    case 'diamond':
      return `M ${mid} ${min} L ${max} ${mid} L ${mid} ${max} L ${min} ${mid} Z`;

    default:
      return '';
  }
}

/**
 * Vị trí điểm nhấn: góc trên bên phải của khung, luôn nằm trong hoặc trên đường viền.
 */
export function getAccentPosition(
  shape: ContainerShape,
  size = 24,
  strokeWidth = 0,
): { cx: number; cy: number } {
  const inset = getContainerInset(strokeWidth);
  const min = inset;
  const max = size - inset;
  const mid = size / 2;

  if (shape === 'none' || shape === 'squircle') return { cx: size - 3.5, cy: 3.5 };

  let edge: { x: number; y: number };
  switch (shape) {
    case 'circle': {
      const cr = (size - inset * 2) / 2;
      edge = { x: mid + cr * Math.SQRT1_2, y: mid - cr * Math.SQRT1_2 };
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
  // Kéo nhẹ vào trong để chấm không lòi ra ngoài viền
  const pull = 0.12;
  return {
    cx: Math.round((edge.x + (mid - edge.x) * pull) * 100) / 100,
    cy: Math.round((edge.y + (mid - edge.y) * pull) * 100) / 100,
  };
}

export function resolveGlyphScale(spec: Pick<StructuredIconSpec, 'containerShape' | 'glyphScale'>): number {
  if (typeof spec.glyphScale === 'number' && spec.glyphScale >= 0.4 && spec.glyphScale <= 1.2) {
    return spec.glyphScale;
  }
  return DEFAULT_GLYPH_SCALE[spec.containerShape] ?? 1;
}

function needsGradient(spec: StructuredIconSpec): boolean {
  return spec.containerFill === 'gradient' && spec.containerShape !== 'none';
}

/**
 * Dựng cây phần tử SVG từ thông số icon. Canvas, danh sách, SVG xuất và TSX xuất đều dùng chung cây này
 * nên hình thấy trên màn hình luôn khớp với mã xuất ra.
 */
export function buildIconModel(spec: StructuredIconSpec, options: IconRenderOptions = {}): IconSvgModel {
  const brand = options.colorMode === 'brand';
  const color = BRAND_COLORS[spec.colorTone] ?? BRAND_COLORS.sapphire;
  const ink = brand ? color.primary : 'currentColor';
  const inkSoft = brand ? color.border : 'currentColor';

  const size = clampNumber(spec.viewBoxSize, 8, 128, 24);
  const strokeWidth = clampNumber(spec.strokeWidth, 0.5, 4, 1.75);
  const radius = clampNumber(spec.cornerRadius, 0, 12, 4);
  const mid = size / 2;

  const children: SvgNode[] = [];
  const containerPath = getContainerPath(spec.containerShape, size, radius, strokeWidth);

  const gradientId = options.gradientId ?? `svndts-grad-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const gradientIdValue: SvgAttrValue = options.dynamicGradientId ? { expr: 'gradientId' } : gradientId;
  const gradientRef: SvgAttrValue = options.dynamicGradientId
    ? { expr: '`url(#${gradientId})`' }
    : `url(#${gradientId})`;

  if (needsGradient(spec)) {
    children.push({
      tag: 'defs',
      attrs: {},
      children: [
        {
          tag: 'linearGradient',
          attrs: { id: gradientIdValue, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
          children: [
            { tag: 'stop', attrs: { offset: '0%', 'stop-color': ink, 'stop-opacity': '0.25' } },
            {
              tag: 'stop',
              attrs: { offset: '100%', 'stop-color': brand ? color.secondary : 'currentColor', 'stop-opacity': '0.05' },
            },
          ],
        },
      ],
    });
  }

  if (containerPath) {
    const attrs: Record<string, SvgAttrValue> = { d: containerPath };
    if (spec.containerFill === 'solid') {
      attrs.fill = ink;
      attrs['fill-opacity'] = '0.12';
    } else if (needsGradient(spec)) {
      attrs.fill = gradientRef;
    }
    children.push({ tag: 'path', attrs });
  }

  const glyphD = sanitizePathData(spec.glyphPath);
  const secondaryD = sanitizePathData(spec.secondaryPath);
  const glyphNodes: SvgNode[] = [];
  if (glyphD) glyphNodes.push({ tag: 'path', attrs: { d: glyphD } });
  if (secondaryD) glyphNodes.push({ tag: 'path', attrs: { d: secondaryD, stroke: inkSoft, opacity: '0.6' } });

  const scale = resolveGlyphScale(spec);
  if (glyphNodes.length > 0) {
    if (scale === 1) {
      children.push(...glyphNodes);
    } else {
      // Bù độ dày nét để sau khi co, nét vẫn đúng độ dày đã chọn
      children.push({
        tag: 'g',
        attrs: {
          transform: `translate(${formatNumber(mid)} ${formatNumber(mid)}) scale(${formatNumber(scale)}) translate(${formatNumber(-mid)} ${formatNumber(-mid)})`,
          'stroke-width': formatNumber(strokeWidth / scale),
        },
        children: glyphNodes,
      });
    }
  }

  if (spec.accentDot) {
    const { cx, cy } = getAccentPosition(spec.containerShape, size, strokeWidth);
    children.push({
      tag: 'circle',
      attrs: { cx: formatNumber(cx), cy: formatNumber(cy), r: '1.5', fill: ink, stroke: 'none' },
    });
  }

  return {
    viewBox: `0 0 ${formatNumber(size)} ${formatNumber(size)}`,
    rootAttrs: {
      fill: 'none',
      stroke: ink,
      'stroke-width': formatNumber(strokeWidth),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    children,
  };
}

export function toCamelAttr(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function attrsToString(attrs: Record<string, SvgAttrValue>, camel: boolean): string {
  return Object.entries(attrs)
    .map(([name, value]) => {
      const key = camel ? toCamelAttr(name) : name;
      if (typeof value === 'object') return `${key}={${value.expr}}`;
      return `${key}="${escapeAttr(String(value))}"`;
    })
    .join(' ');
}

function serializeNode(node: SvgNode, depth: number, camel: boolean): string {
  const pad = '  '.repeat(depth);
  const attrs = attrsToString(node.attrs, camel);
  const open = attrs ? `${node.tag} ${attrs}` : node.tag;
  if (!node.children || node.children.length === 0) return `${pad}<${open} />`;
  const inner = node.children.map((child) => serializeNode(child, depth + 1, camel)).join('\n');
  return `${pad}<${open}>\n${inner}\n${pad}</${node.tag}>`;
}

function sanitizeComment(text: string): string {
  return text.replace(/[<>]/g, '').replace(/-{2,}/g, '-').trim();
}

/**
 * Sinh chuỗi SVG sạch 100%, tuân thủ triết lý Structured SVG (không metadata thừa)
 */
export function generateCleanSvg(spec: StructuredIconSpec, options: IconRenderOptions = {}): string {
  const model = buildIconModel(spec, options);
  const rootAttrs = attrsToString(model.rootAttrs, false);
  const body = model.children.map((child) => serializeNode(child, 1, false)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${model.viewBox}" ${rootAttrs}>
  <!-- SVNDTS Structured SVG - ${sanitizeComment(spec.name)} -->
${body}
</svg>`;
}

/**
 * Tên component PascalCase ASCII; bỏ dấu tiếng Việt thay vì làm rơi chữ có dấu.
 */
export function toComponentName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  const words = ascii
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let base = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || 'Brand';
  if (/^[0-9]/.test(base)) base = `Icon${base}`;
  return base.endsWith('Icon') ? base : `${base}Icon`;
}

/**
 * Sinh mã nguồn React Component TSX sẵn sàng nhúng vào @enterprise-platform/shared-ui
 */
export function generateReactComponent(spec: StructuredIconSpec, options: IconRenderOptions = {}): string {
  const componentName = toComponentName(spec.name);
  const usesGradient = needsGradient(spec);
  const model = buildIconModel(spec, { ...options, dynamicGradientId: usesGradient });

  const rootAttrs = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="${model.viewBox}"`,
    attrsToString(model.rootAttrs, true),
    'aria-hidden="true"',
    'className={className}',
    '{...rest}',
  ].join('\n      ');
  const body = model.children.map((child) => serializeNode(child, 3, true)).join('\n');
  const gradientLine = usesGradient
    ? "\n  const gradientId = `svndts-${useId().replace(/:/g, '')}`;"
    : '';
  const reactImport = usesGradient ? "import { useId, type SVGProps } from 'react';" : "import type { SVGProps } from 'react';";
  const doc = (text: string) => sanitizeComment(text).replace(/\*\//g, '* /');

  return `${reactImport}

/**
 * ${doc(spec.name)}
 * ${doc(spec.description)}
 * Chuẩn nhận diện thương hiệu SVNDTS (Structured SVG)
 */
export function ${componentName}(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;${gradientLine}
  return (
    <svg
      ${rootAttrs}
    >
${body}
    </svg>
  );
}
`;
}

/**
 * Tải file SVG trực tiếp trên trình duyệt
 */
export function downloadSvgFile(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
