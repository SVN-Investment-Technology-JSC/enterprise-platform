import { isPng, createIco } from './ico.js';
import { normalizeHex, type BrandPalette, type ColorMode, DEFAULT_PALETTE } from './palette.js';
import type { IconDocument } from './model.js';
import { generateIconIndex, generateReactComponent, generateSprite, generateSvg, slugify, toComponentName } from './render.js';

/** Các nhóm tệp có thể xuất. */
export type ExportFormat = 'svg' | 'tsx' | 'sprite' | 'json' | 'favicon';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['svg', 'tsx', 'sprite', 'json', 'favicon'];

/** Vẽ một chuỗi SVG thành PNG vuông `size x size`, nền trong suốt. Truyền từ ngoài để phần này không phụ thuộc DOM. */
export type RasterizeFn = (svg: string, size: number) => Promise<Uint8Array>;

export interface ExportFile {
  /** Đường dẫn tương đối trong gói, dùng dấu `/`. */
  readonly path: string;
  readonly data: string | Uint8Array;
}

export interface ExportBundle {
  readonly files: ExportFile[];
  /** Cảnh báo bằng tiếng Việt để hiển thị cho người dùng. */
  readonly warnings: string[];
}

export interface ExportBundleOptions {
  readonly formats: readonly ExportFormat[];
  /** Áp dụng cho svg, tsx, sprite. Mặc định `currentColor`. Favicon luôn dùng màu thương hiệu. */
  readonly colorMode?: ColorMode;
  readonly palette?: BrandPalette;
  /** Thiếu thì bỏ qua mọi tệp PNG và ICO của favicon, kèm một cảnh báo. */
  readonly rasterize?: RasterizeFn;
  /** Thư mục gốc đặt trước mọi đường dẫn, ví dụ `svndts-icons`. */
  readonly rootDir?: string;
  /** Mã icon dùng cho favicon; mặc định icon đầu tiên. */
  readonly faviconDocId?: string;
  /** Màu thay cho `currentColor` trong favicon (favicon không có chữ xung quanh để lấy màu). Mặc định màu đầu bảng màu. */
  readonly faviconInk?: string;
  /** Tên hiển thị trong site.webmanifest. Mặc định `SVNDTS`. */
  readonly appName?: string;
  /** Tiền tố đường dẫn trong head.html và site.webmanifest. Mặc định `/`. */
  readonly faviconBasePath?: string;
}

/** Cạnh các ảnh PNG đưa vào favicon.ico. */
export const ICO_SIZES: readonly number[] = [16, 32, 48];

interface FaviconPng {
  readonly name: string;
  readonly size: number;
}

const FAVICON_PNGS: readonly FaviconPng[] = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

/** Mọi cạnh PNG mà bộ favicon cần vẽ, không trùng. */
export const FAVICON_RASTER_SIZES: readonly number[] = [
  ...new Set([...ICO_SIZES, ...FAVICON_PNGS.map((item) => item.size)]),
].sort((a, b) => a - b);

const FALLBACK_INK = '#2563eb';
const APPLE_ICON_SIZE = 180;
/** Tỉ lệ lề quanh icon trên nền trắng của apple-touch-icon (iOS tô nền đen cho PNG trong suốt). */
const APPLE_PADDING = 0.1;
const RESERVED_SLUGS: readonly string[] = ['index'];
const MAX_NAMED_EMPTY = 3;

function cleanRoot(rootDir: string | undefined): string {
  return (rootDir ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/');
}

interface UniqueDoc {
  /** Bản có tên đã làm duy nhất, dùng để dựng tệp. */
  readonly doc: IconDocument;
  readonly slug: string;
}

/**
 * Làm tên tệp và tên component không trùng nhau: icon trùng tên được thêm hậu tố 2, 3...
 * Xét cả hai vì tên khác nhau vẫn có thể cho cùng tên component (ví dụ "icon 1" và "1").
 */
function dedupeDocs(docs: readonly IconDocument[], warnings: string[]): UniqueDoc[] {
  const slugs = new Set<string>(RESERVED_SLUGS);
  const components = new Set<string>();
  return docs.map((doc) => {
    let candidate = doc;
    let slug = slugify(doc.name);
    let component = toComponentName(doc.name);
    if (slugs.has(slug) || components.has(component)) {
      const base = doc.name.trim().slice(0, 48);
      for (let n = 2; n <= docs.length + RESERVED_SLUGS.length + 2; n += 1) {
        candidate = { ...doc, name: `${base} ${n}` };
        slug = slugify(candidate.name);
        component = toComponentName(candidate.name);
        if (!slugs.has(slug) && !components.has(component)) break;
      }
      warnings.push(`Tên "${doc.name}" trùng với icon khác, tệp được đặt là "${slug}".`);
    }
    slugs.add(slug);
    components.add(component);
    return { doc: candidate, slug };
  });
}

function warnEmptyIcons(docs: readonly IconDocument[], warnings: string[]): void {
  const empty = docs.filter((doc) => doc.shapes.every((shape) => shape.hidden));
  if (empty.length === 0) return;
  if (empty.length <= MAX_NAMED_EMPTY) {
    for (const doc of empty) warnings.push(`Icon "${doc.name}" chưa có hình nào hiển thị.`);
  } else {
    warnings.push(`${empty.length} icon chưa có hình nào hiển thị.`);
  }
}

/** Thay `currentColor` bằng một màu cố định: favicon đứng một mình nên không có chữ xung quanh để lấy màu. */
function withInk(doc: IconDocument, ink: string): IconDocument {
  const fix = (paint: string) => (paint === 'currentColor' ? ink : paint);
  return { ...doc, shapes: doc.shapes.map((shape) => ({ ...shape, fill: fix(shape.fill), stroke: fix(shape.stroke) })) };
}

/** Đặt icon vào giữa nền trắng đặc: dùng SVG lồng, nên vẫn là vector. */
export function withWhiteBackground(svg: string, size = APPLE_ICON_SIZE, padding = APPLE_PADDING): string {
  if (!svg.startsWith('<svg ')) return svg;
  const offset = Math.round(size * padding * 100) / 100;
  const inner = Math.round((size - offset * 2) * 100) / 100;
  const nested = svg.replace('<svg ', `<svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n  <rect width="${size}" height="${size}" fill="#ffffff" />\n${nested}\n</svg>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function normalizeBase(basePath: string | undefined): string {
  const base = (basePath ?? '/').trim() || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function buildHead(base: string, has: (name: string) => boolean): string {
  const href = (name: string) => escapeAttr(`${base}${name}`);
  const lines = ['<!-- Đặt các tệp favicon vào thư mục gốc của website, rồi dán các dòng sau vào <head> -->'];
  if (has('favicon.ico')) lines.push(`<link rel="icon" href="${href('favicon.ico')}" sizes="any">`);
  lines.push(`<link rel="icon" href="${href('favicon.svg')}" type="image/svg+xml">`);
  if (has('favicon-32x32.png')) lines.push(`<link rel="icon" type="image/png" sizes="32x32" href="${href('favicon-32x32.png')}">`);
  if (has('favicon-16x16.png')) lines.push(`<link rel="icon" type="image/png" sizes="16x16" href="${href('favicon-16x16.png')}">`);
  if (has('apple-touch-icon.png')) lines.push(`<link rel="apple-touch-icon" href="${href('apple-touch-icon.png')}">`);
  if (has('site.webmanifest')) lines.push(`<link rel="manifest" href="${href('site.webmanifest')}">`);
  return `${lines.join('\n')}\n`;
}

async function rasterizeAll(
  svgFor: (size: number) => string,
  sizes: readonly number[],
  rasterize: RasterizeFn,
  warnings: string[],
): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  for (const size of sizes) {
    try {
      const png = await rasterize(svgFor(size), size);
      if (!isPng(png)) throw new Error('kết quả không phải PNG');
      out.set(size, png);
    } catch (error) {
      const reason = error instanceof Error && error.message ? `: ${error.message}` : '';
      warnings.push(`Không tạo được ảnh ${size}px${reason}`);
    }
  }
  return out;
}

async function buildFavicon(
  docs: readonly IconDocument[],
  options: ExportBundleOptions,
  palette: BrandPalette,
  warnings: string[],
): Promise<ExportFile[]> {
  const doc = docs.find((item) => item.id === options.faviconDocId) ?? docs[0];
  if (!doc) return [];
  if (options.faviconDocId && doc.id !== options.faviconDocId) {
    warnings.push('Không tìm thấy icon đã chọn cho favicon, dùng icon đầu tiên.');
  }

  const ink = normalizeHex(options.faviconInk ?? '') ?? normalizeHex(palette.tokens[0]?.hex ?? '') ?? FALLBACK_INK;
  const svg = generateSvg(withInk(doc, ink), { colorMode: 'brand', palette });
  const files: { name: string; data: string | Uint8Array }[] = [{ name: 'favicon.svg', data: `${svg}\n` }];

  if (options.rasterize) {
    const pngs = await rasterizeAll(
      (size) => (size === APPLE_ICON_SIZE ? withWhiteBackground(svg) : svg),
      FAVICON_RASTER_SIZES,
      options.rasterize,
      warnings,
    );
    const icoImages = ICO_SIZES.flatMap((size) => {
      const png = pngs.get(size);
      return png ? [{ size, png }] : [];
    });
    if (icoImages.length > 0) files.push({ name: 'favicon.ico', data: createIco(icoImages) });
    for (const item of FAVICON_PNGS) {
      const png = pngs.get(item.size);
      if (png) files.push({ name: item.name, data: png });
    }
  } else {
    warnings.push('Chưa tạo được ảnh PNG và ICO ở môi trường này, chỉ xuất favicon.svg.');
  }

  const has = (name: string) => files.some((file) => file.name === name);
  const base = normalizeBase(options.faviconBasePath);
  if (has('icon-192.png') && has('icon-512.png')) {
    const appName = options.appName?.trim() || 'SVNDTS';
    const manifest = {
      name: appName,
      short_name: appName,
      icons: [
        { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
    };
    files.push({ name: 'site.webmanifest', data: `${JSON.stringify(manifest, null, 2)}\n` });
  }
  files.push({ name: 'head.html', data: buildHead(base, has) });

  return files.map((file) => ({ path: `favicon/${file.name}`, data: file.data }));
}

/**
 * Dựng toàn bộ tệp xuất. Không chạm DOM hay mạng; việc vẽ PNG do `rasterize` truyền vào đảm nhiệm.
 * Thứ tự tệp ổn định: svg, react, sprite, json, favicon.
 */
export async function buildExportBundle(
  docs: readonly IconDocument[],
  options: ExportBundleOptions,
): Promise<ExportBundle> {
  const warnings: string[] = [];
  const palette = options.palette ?? DEFAULT_PALETTE;
  const formats = new Set(options.formats);
  const render = { colorMode: options.colorMode ?? 'currentColor', palette } as const;
  const root = cleanRoot(options.rootDir);
  const prefix = root ? `${root}/` : '';
  const files: ExportFile[] = [];

  if (docs.length === 0) {
    warnings.push('Chưa có icon nào để xuất.');
    return { files, warnings };
  }
  if (formats.size === 0) {
    warnings.push('Chưa chọn định dạng nào.');
    return { files, warnings };
  }
  if ([...formats].some((format) => format !== 'json')) warnEmptyIcons(docs, warnings);

  if (formats.has('svg') || formats.has('tsx') || formats.has('sprite')) {
    const unique = dedupeDocs(docs, warnings);
    if (formats.has('svg')) {
      for (const { doc, slug } of unique) files.push({ path: `svg/${slug}.svg`, data: `${generateSvg(doc, render)}\n` });
    }
    if (formats.has('tsx')) {
      for (const { doc, slug } of unique) files.push({ path: `react/${slug}.tsx`, data: generateReactComponent(doc, render) });
      files.push({ path: 'react/index.ts', data: generateIconIndex(unique.map((item) => item.doc)) });
    }
    if (formats.has('sprite')) {
      files.push({ path: 'sprite.svg', data: `${generateSprite(unique.map((item) => item.doc), render)}\n` });
    }
  }

  if (formats.has('json')) {
    files.push({ path: 'icons.json', data: `${JSON.stringify(docs, null, 2)}\n` });
  }

  if (formats.has('favicon')) {
    files.push(...(await buildFavicon(docs, options, palette, warnings)));
  }

  return { files: files.map((file) => ({ ...file, path: `${prefix}${file.path}` })), warnings };
}
