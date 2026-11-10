import { formatNumber, pathToData } from './path-data';
import { geometryToPath } from './geometry';
import { gradientAxis, isGradientPaint, parseGradient, radialGridMatrix, stopHex } from './gradient';
import { DEFAULT_PALETTE, normalizeHex, resolvePaint, type BrandPalette, type ColorMode } from './palette';
import { isPaintNone, roundTo, type IconDocument, type IconShape } from './model';

export interface SvgNode {
  tag: 'path' | 'rect' | 'ellipse' | 'circle' | 'g' | 'symbol' | 'defs' | 'linearGradient' | 'radialGradient' | 'stop' | 'mask';
  attrs: Record<string, string>;
  children?: SvgNode[];
}

export interface IconSvgModel {
  viewBox: string;
  /** Thuộc tính đặt trên thẻ gốc; mọi lớp hình kế thừa. */
  rootAttrs: Record<string, string>;
  /** Định nghĩa dùng chung (dải màu chuyển sắc, mặt nạ); rỗng nếu icon không có. Đặt trước các lớp hình khi vẽ. */
  defs: SvgNode[];
  children: SvgNode[];
}

export interface RenderOptions {
  /** `currentColor`: mọi màu theo chữ xung quanh; `brand`: ghi cứng màu từ bảng màu. */
  colorMode?: ColorMode;
  palette?: BrandPalette;
  /** Tiền tố mã (`id`) của dải màu chuyển sắc và mặt nạ; đổi khi nhiều icon cùng nằm trong một tệp (sprite) để mã không đụng nhau. */
  idPrefix?: string;
}

const num = (value: number) => formatNumber(value);
/** Số của dải màu cần chính xác hơn toạ độ hình: sai số nhỏ ở ma trận hay trục sẽ phóng to ra cả khung. */
const fine = (value: number) => String(roundTo(value, 6) || 0);

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
 * Dải màu (`<linearGradient>` hoặc `<radialGradient>`) cho một paint gradient, đặt theo toạ độ lưới (userSpaceOnUse) nên dùng
 * được cả cho nét thẳng (khung bao có chiều cao 0). Mã suy ra từ nội dung và cỡ lưới, nên hai lớp cùng gradient dùng chung
 * một dải. `literal`: màu điểm màu là hex thật (dùng trong mặt nạ), không tra bảng màu.
 */
function gradientNode(paint: string, size: number, palette: BrandPalette, prefix: string, literal = false): { id: string; node: SvgNode } | null {
  const gradient = parseGradient(paint);
  if (!gradient) return null;
  const stops = gradient.stops.map((stop) => ({ color: literal ? stop.color : stopHex(stop.color, palette), offset: stop.offset, opacity: stop.opacity ?? 1 }));
  const attrs: Record<string, string> = { gradientUnits: 'userSpaceOnUse' };
  if (gradient.kind === 'linear') {
    const axis = gradientAxis(gradient.angle, size, gradient.t0, gradient.t1);
    Object.assign(attrs, { x1: fine(axis.x1), y1: fine(axis.y1), x2: fine(axis.x2), y2: fine(axis.y2) });
  } else {
    Object.assign(attrs, { cx: fine(gradient.cx), cy: fine(gradient.cy), r: fine(gradient.r) });
    if (gradient.fx !== gradient.cx || gradient.fy !== gradient.cy) Object.assign(attrs, { fx: fine(gradient.fx), fy: fine(gradient.fy) });
    const matrix = radialGridMatrix(gradient.matrix, size);
    const identity = matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index]);
    if (!identity) attrs.gradientTransform = `matrix(${matrix.map(fine).join(' ')})`;
  }
  if (gradient.spread !== 'pad') attrs.spreadMethod = gradient.spread;
  const stopNodes = stops.map((stop): SvgNode => ({
    tag: 'stop',
    attrs: { offset: fine(stop.offset), 'stop-color': stop.color, ...(stop.opacity < 1 ? { 'stop-opacity': num(stop.opacity) } : {}) },
  }));
  const id = `${prefix}-${hashText(`${gradient.kind}|${num(size)}|${JSON.stringify(attrs)}|${JSON.stringify(stopNodes.map((stop) => stop.attrs))}`)}`;
  return { id, node: { tag: gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient', attrs: { id, ...attrs }, children: stopNodes } };
}

/** Nét đứt và giới hạn mũi nhọn của một lớp có nét. */
function strokeExtras(node: SvgNode, shape: IconShape): void {
  if (shape.strokeDasharray && shape.strokeDasharray.length > 0) {
    node.attrs['stroke-dasharray'] = shape.strokeDasharray.map(num).join(' ');
    if (shape.strokeDashoffset) node.attrs['stroke-dashoffset'] = num(shape.strokeDashoffset);
  }
  if (shape.strokeMiterlimit !== undefined && shape.strokeMiterlimit !== 4) node.attrs['stroke-miterlimit'] = num(shape.strokeMiterlimit);
}

/** Một hình trong mặt nạ: mọi thuộc tính đều ghi rõ trên chính nó vì mặt nạ thừa kế từ thẻ gốc (fill, stroke...). */
function maskLayerNode(layer: IconShape, paint: (value: string) => string): SvgNode {
  const node = geometryNode(layer);
  node.attrs.fill = layer.fill === 'none' ? 'none' : paint(layer.fill);
  if (layer.fill !== 'none') {
    if (layer.fillOpacity < 1) node.attrs['fill-opacity'] = num(layer.fillOpacity);
    if (layer.fillRule === 'evenodd') node.attrs['fill-rule'] = 'evenodd';
  }
  if (layer.stroke === 'none') {
    node.attrs.stroke = 'none';
  } else {
    node.attrs.stroke = paint(layer.stroke);
    node.attrs['stroke-width'] = num(layer.strokeWidth);
    node.attrs['stroke-linecap'] = layer.linecap;
    node.attrs['stroke-linejoin'] = layer.linejoin;
    strokeExtras(node, layer);
  }
  if (layer.opacity < 1) node.attrs.opacity = num(layer.opacity);
  return node;
}

/**
 * `<mask>` của một lớp, tính theo toạ độ lưới (userSpaceOnUse) và phủ rộng quá khung để không cắt nét ở mép. Màu trong
 * mặt nạ là độ sáng thật nên không đổi theo chế độ màu. Mã suy ra từ nội dung, nên hai lớp cùng mặt nạ dùng chung một thẻ.
 * `register` ghi nhận các dải màu mà hình trong mặt nạ dùng (mặt nạ mờ dần).
 */
function maskNode(
  shape: IconShape,
  size: number,
  palette: BrandPalette,
  prefix: string,
  register: (id: string, node: SvgNode) => void,
  holes: readonly IconShape[] = [],
): { id: string; node: SvgNode } | null {
  const layers = shape.mask?.layers ?? [];
  if (layers.length === 0 && holes.length === 0) return null;
  const paint = (value: string): string => {
    if (!isGradientPaint(value)) return value;
    const built = gradientNode(value, size, palette, `${prefix}-grad`, true);
    if (!built) return '#000000';
    register(built.id, built.node);
    return `url(#${built.id})`;
  };
  // nền trắng (hiện hết) nếu lớp không có mặt nạ riêng, rồi các lỗ khoét đen chồng lên trên
  const base =
    layers.length > 0
      ? layers.map((layer) => maskLayerNode(layer, paint))
      : [{ tag: 'rect', attrs: { x: num(-size), y: num(-size), width: num(size * 3), height: num(size * 3), fill: '#ffffff', stroke: 'none' } } as SvgNode];
  const cuts = holes.map((hole) => {
    const cut = maskLayerNode(
      { ...hole, fill: isPaintNone(hole.fill) ? 'none' : '#000000', stroke: isPaintNone(hole.stroke) ? 'none' : '#000000', mask: undefined },
      paint,
    );
    const own = maskNode(hole, size, palette, prefix, register);
    if (own) {
      register(own.id, own.node);
      cut.attrs.mask = `url(#${own.id})`;
    }
    return cut;
  });
  const children = [...base, ...cuts];
  const id = `${prefix}-mask-${hashText(`${num(size)}|${JSON.stringify(children.map((child) => [child.tag, child.attrs]))}`)}`;
  const node: SvgNode = {
    tag: 'mask',
    attrs: { id, maskUnits: 'userSpaceOnUse', x: num(-size), y: num(-size), width: num(size * 3), height: num(size * 3) },
    children,
  };
  return { id, node };
}

/** Lớp chỉ vẽ bằng màu trắng thuần (tô và/hoặc nét), không dải màu. */
function drawsOnlyWhite(shape: IconShape): boolean {
  const paints = [shape.fill, shape.stroke].filter((paint) => !isPaintNone(paint));
  return paints.length > 0 && paints.every((paint) => normalizeHex(paint) === '#ffffff');
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
  const allShapes = doc.shapes.filter((shape) => !shape.hidden);
  // Chế độ một màu: lớp toàn trắng nằm trên lớp có màu là phần khoét (chi tiết trắng trên nền màu); nếu cũng vẽ bằng
  // currentColor thì chi tiết trùng màu với nền và biến mất.
  const knockouts = new Set<IconShape>();
  if (mode === 'currentColor') {
    let hasInk = false;
    for (const shape of allShapes) {
      if (drawsOnlyWhite(shape) && hasInk) knockouts.add(shape);
      else hasInk = true;
    }
  }
  const shapes = allShapes.filter((shape) => !knockouts.has(shape));
  const gridSize = Number.isFinite(doc.size) && doc.size > 0 ? doc.size : 24;
  const idPrefix = options.idPrefix ?? 'svndts';
  const defs = new Map<string, SvgNode>();
  // Gradient chỉ giữ ở chế độ `brand`; chế độ `currentColor` là một màu theo chữ nên gradient thành `currentColor`.
  const resolve = (paint: string): string => {
    if (isGradientPaint(paint) && mode === 'brand') {
      const built = gradientNode(paint, gridSize, palette, `${idPrefix}-grad`);
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
      strokeExtras(node, shape);
    }
    if (shape.opacity < 1) node.attrs.opacity = num(shape.opacity);
    const holes = knockouts.size > 0 ? allShapes.slice(allShapes.indexOf(shape) + 1).filter((later) => knockouts.has(later)) : [];
    const mask = maskNode(shape, gridSize, palette, idPrefix, (id, definition) => defs.set(id, definition), holes);
    if (mask) {
      defs.set(mask.id, mask.node);
      node.attrs.mask = `url(#${mask.id})`;
    }
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
    const model = buildIconModel(doc, { ...options, idPrefix: id });
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
