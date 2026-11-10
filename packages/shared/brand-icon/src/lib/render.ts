import { formatNumber, pathToData } from './path-data';
import { geometryToPath } from './geometry';
import { gradientAxis, isGradientPaint, parseGradient, stopHex } from './gradient';
import { DEFAULT_PALETTE, resolvePaint, type BrandPalette, type ColorMode } from './palette';
import { isPaintNone, type IconDocument, type IconShape } from './model';

export interface SvgNode {
  tag: 'path' | 'rect' | 'ellipse' | 'circle' | 'g' | 'symbol' | 'defs' | 'linearGradient' | 'stop';
  attrs: Record<string, string>;
  children?: SvgNode[];
}

export interface IconSvgModel {
  viewBox: string;
  /** Thuộc tính đặt trên thẻ gốc; mọi lớp hình kế thừa. */
  rootAttrs: Record<string, string>;
  /** Định nghĩa dùng chung (dải màu chuyển sắc); rỗng nếu icon không có gradient. Đặt trước các lớp hình khi vẽ. */
  defs: SvgNode[];
  children: SvgNode[];
}

export interface RenderOptions {
  /** `currentColor`: mọi màu theo chữ xung quanh; `brand`: ghi cứng màu từ bảng màu. */
  colorMode?: ColorMode;
  palette?: BrandPalette;
  /** Tiền tố mã (`id`) của dải màu chuyển sắc; đổi khi nhiều icon cùng nằm trong một tệp (sprite) để mã không đụng nhau. */
  gradientIdPrefix?: string;
}

const num = (value: number) => formatNumber(value);

function modeOf<T>(values: readonly T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function geometryNode(shape: IconShape): SvgNode {
  const { geometry } = shape;
  if (geometry.type === 'rect') {
    const attrs: Record<string, string> = {
      x: num(geometry.x),
      y: num(geometry.y),
      width: num(geometry.width),
      height: num(geometry.height),
    };
    if (geometry.rx > 0) attrs.rx = num(geometry.rx);
    return { tag: 'rect', attrs };
  }
  if (geometry.type === 'ellipse') {
    if (Math.abs(geometry.rx - geometry.ry) < 1e-6) {
      return { tag: 'circle', attrs: { cx: num(geometry.cx), cy: num(geometry.cy), r: num(geometry.rx) } };
    }
    return { tag: 'ellipse', attrs: { cx: num(geometry.cx), cy: num(geometry.cy), rx: num(geometry.rx), ry: num(geometry.ry) } };
  }
  return { tag: 'path', attrs: { d: pathToData(geometryToPath(geometry)) } };
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Dải màu `<linearGradient>` cho một paint gradient, trải trên cả khung vẽ (userSpaceOnUse) nên dùng được cả cho nét
 * thẳng (khung bao có chiều cao 0). Mã dải màu suy ra từ nội dung và cỡ lưới, nên hai lớp cùng gradient dùng chung một dải.
 */
function gradientNode(paint: string, size: number, palette: BrandPalette, prefix: string): { id: string; node: SvgNode } | null {
  const gradient = parseGradient(paint);
  if (!gradient) return null;
  const stops = gradient.stops.map((stop) => ({ color: stopHex(stop.color, palette), offset: stop.offset }));
  const axis = gradientAxis(gradient.angle, size);
  const id = `${prefix}-${hashText(`${num(size)}|${gradient.angle}|${stops.map((stop) => `${stop.color}@${stop.offset}`).join(',')}`)}`;
  const node: SvgNode = {
    tag: 'linearGradient',
    attrs: { id, gradientUnits: 'userSpaceOnUse', x1: num(axis.x1), y1: num(axis.y1), x2: num(axis.x2), y2: num(axis.y2) },
    children: stops.map((stop): SvgNode => ({ tag: 'stop', attrs: { offset: num(stop.offset), 'stop-color': stop.color } })),
  };
  return { id, node };
}

/** Thẻ `<defs>` của mô hình, hoặc null nếu không có gì để định nghĩa. */
export function defsNode(model: IconSvgModel): SvgNode | null {
  return model.defs.length > 0 ? { tag: 'defs', attrs: {}, children: model.defs } : null;
}

/**
 * Dựng cây phần tử SVG từ tài liệu. Canvas, danh sách, SVG xuất và TSX xuất đều dùng chung cây này
 * nên hình thấy trên màn hình luôn khớp với mã xuất ra.
 */
export function buildIconModel(doc: IconDocument, options: RenderOptions = {}): IconSvgModel {
  const mode = options.colorMode ?? 'currentColor';
  const palette = options.palette ?? DEFAULT_PALETTE;
  const shapes = doc.shapes.filter((shape) => !shape.hidden);
  const gridSize = Number.isFinite(doc.size) && doc.size > 0 ? doc.size : 24;
  const gradientPrefix = options.gradientIdPrefix ?? 'svndts-grad';
  const defs = new Map<string, SvgNode>();
  // Gradient chỉ giữ ở chế độ `brand`; chế độ `currentColor` là một màu theo chữ nên gradient thành `currentColor`.
  const resolve = (paint: string): string => {
    if (isGradientPaint(paint) && mode === 'brand') {
      const built = gradientNode(paint, gridSize, palette, gradientPrefix);
      if (built) {
        defs.set(built.id, built.node);
        return `url(#${built.id})`;
      }
    }
    return resolvePaint(paint, mode, palette);
  };

  const stroked = shapes.filter((shape) => !isPaintNone(shape.stroke));
  const rootStroke = modeOf(stroked.map((shape) => resolve(shape.stroke)), 'currentColor');
  const rootWidth = modeOf(stroked.map((shape) => num(shape.strokeWidth)), num(1.75));
  const rootCap = modeOf(stroked.map((shape) => shape.linecap), 'round');
  const rootJoin = modeOf(stroked.map((shape) => shape.linejoin), 'round');

  const rootAttrs: Record<string, string> = { fill: 'none' };
  if (stroked.length > 0) {
    rootAttrs.stroke = rootStroke;
    rootAttrs['stroke-width'] = rootWidth;
    rootAttrs['stroke-linecap'] = rootCap;
    rootAttrs['stroke-linejoin'] = rootJoin;
  }

  const children = shapes.map((shape): SvgNode => {
    const node = geometryNode(shape);
    const fill = resolve(shape.fill);
    if (fill !== 'none') {
      node.attrs.fill = fill;
      if (shape.fillOpacity < 1) node.attrs['fill-opacity'] = num(shape.fillOpacity);
      if (shape.fillRule === 'evenodd') node.attrs['fill-rule'] = 'evenodd';
    }

    if (isPaintNone(shape.stroke)) {
      if (stroked.length > 0) node.attrs.stroke = 'none';
    } else {
      const stroke = resolve(shape.stroke);
      if (stroke !== rootStroke) node.attrs.stroke = stroke;
      if (num(shape.strokeWidth) !== rootWidth) node.attrs['stroke-width'] = num(shape.strokeWidth);
      if (shape.linecap !== rootCap) node.attrs['stroke-linecap'] = shape.linecap;
      if (shape.linejoin !== rootJoin) node.attrs['stroke-linejoin'] = shape.linejoin;
    }
    if (shape.opacity < 1) node.attrs.opacity = num(shape.opacity);
    return node;
  });

  return { viewBox: `0 0 ${num(gridSize)} ${num(gridSize)}`, rootAttrs, defs: [...defs.values()], children };
}

export function toCamelAttr(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function attrsToString(attrs: Record<string, string>, camel: boolean): string {
  return Object.entries(attrs)
    .map(([name, value]) => `${camel ? toCamelAttr(name) : name}="${escapeAttr(value)}"`)
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

/** Nội dung bên trong thẻ gốc: `<defs>` (nếu có) rồi các lớp hình. */
function bodyOf(model: IconSvgModel, depth: number, camel: boolean): string {
  const defs = defsNode(model);
  const nodes = defs ? [defs, ...model.children] : model.children;
  return nodes.map((child) => serializeNode(child, depth, camel)).join('\n');
}

function sanitizeComment(text: string): string {
  return text.replace(/[<>]/g, '').replace(/-{2,}/g, '-').replace(/\*\//g, '* /').trim();
}

/** SVG sạch, không metadata thừa; thuộc tính chung được đưa lên thẻ gốc. */
export function generateSvg(doc: IconDocument, options: RenderOptions = {}): string {
  const model = buildIconModel(doc, options);
  const root = attrsToString(model.rootAttrs, false);
  const body = bodyOf(model, 1, false);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${model.viewBox}" ${root}>
  <!-- SVNDTS - ${sanitizeComment(doc.name)} -->
${body}
</svg>`;
}

/** Tên component PascalCase ASCII; bỏ dấu tiếng Việt thay vì làm rơi chữ có dấu. */
export function toComponentName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

/** Mã định danh dạng chữ thường nối gạch, dùng cho tên file và id symbol. */
export function slugify(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
  return ascii.replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || 'icon';
}

/** Component React sẵn sàng đặt vào `@enterprise-platform/shared-ui`. */
export function generateReactComponent(doc: IconDocument, options: RenderOptions = {}): string {
  const model = buildIconModel(doc, options);
  const rootAttrs = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="${model.viewBox}"`,
    attrsToString(model.rootAttrs, true),
    'aria-hidden="true"',
    'className={className}',
    '{...rest}',
  ].join('\n      ');
  const body = bodyOf(model, 3, true);

  return `import type { SVGProps } from 'react';

/**
 * ${sanitizeComment(doc.name)}
 * ${sanitizeComment(doc.description)}
 * Chuẩn nhận diện thương hiệu SVNDTS
 */
export function ${toComponentName(doc.name)}(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;
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

/** Một file SVG chứa nhiều `<symbol>` để dùng qua `<use href="#id">`. */
export function generateSprite(docs: readonly IconDocument[], options: RenderOptions = {}): string {
  const used = new Set<string>();
  const symbols = docs.map((doc) => {
    let id = `svndts-${slugify(doc.name)}`;
    for (let suffix = 2; used.has(id); suffix += 1) id = `svndts-${slugify(doc.name)}-${suffix}`;
    used.add(id);
    const model = buildIconModel(doc, { ...options, gradientIdPrefix: `${id}-grad` });
    const attrs = [`id="${id}"`, `viewBox="${model.viewBox}"`, attrsToString(model.rootAttrs, false)].join(' ');
    const body = bodyOf(model, 3, false);
    return `    <symbol ${attrs}>\n${body}\n    </symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n  <defs>\n${symbols.join('\n')}\n  </defs>\n</svg>`;
}

/** `index.ts` gom các component đã xuất. */
export function generateIconIndex(docs: readonly IconDocument[]): string {
  const names = docs.map((doc) => toComponentName(doc.name));
  const files = docs.map((doc) => slugify(doc.name));
  const lines = names.map((name, index) => `export { ${name} } from './${files[index]}';`);
  return `${lines.join('\n')}\n`;
}
