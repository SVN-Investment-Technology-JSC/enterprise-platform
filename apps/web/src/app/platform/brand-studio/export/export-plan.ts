import {
  buildExportBundle,
  createZip,
  EXPORT_FORMATS,
  slugify,
  type BrandPalette,
  type ColorMode,
  type ExportFile,
  type ExportFormat,
  type IconDocument,
  type RasterizeFn,
} from '@enterprise-platform/shared-brand-icon';
import { svgToPng } from './rasterize';

/** Phần thuần của hộp thoại xuất: chọn gì, sẽ tạo tệp nào, dung lượng ước tính và chạy xuất thật. */

export interface FormatMeta {
  readonly id: ExportFormat;
  readonly label: string;
  /** Gợi ý ngắn hiện ở tooltip. */
  readonly hint: string;
}

export const FORMAT_META: readonly FormatMeta[] = [
  { id: 'svg', label: 'SVG', hint: 'Mỗi icon một tệp .svg' },
  { id: 'tsx', label: 'React TSX', hint: 'Component .tsx cho từng icon, kèm index.ts' },
  { id: 'sprite', label: 'Sprite', hint: 'Một tệp sprite.svg gộp mọi icon' },
  { id: 'json', label: 'JSON', hint: 'Sao lưu thư viện, nhập lại được' },
  { id: 'favicon', label: 'Favicon', hint: 'ICO, PNG, manifest và đoạn HTML cho thẻ head' },
];

export interface ExportChoice {
  readonly formats: readonly ExportFormat[];
  readonly colorMode: ColorMode;
  /** Icon dùng cho favicon; bỏ trống hoặc không có trong danh sách thì lấy icon đầu. */
  readonly faviconDocId?: string;
}

export const DEFAULT_CHOICE: ExportChoice = { formats: ['svg'], colorMode: 'currentColor' };

/** Bật hoặc tắt một định dạng, giữ thứ tự cố định như danh sách chuẩn. */
export function toggleFormat(formats: readonly ExportFormat[], id: ExportFormat): ExportFormat[] {
  const next = new Set(formats);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return EXPORT_FORMATS.filter((format) => next.has(format));
}

/** Chế độ màu chỉ có nghĩa với SVG, TSX và sprite; JSON giữ nguyên màu gốc, favicon luôn dùng màu thương hiệu. */
export function usesColorMode(formats: readonly ExportFormat[]): boolean {
  return formats.some((format) => format === 'svg' || format === 'tsx' || format === 'sprite');
}

export function resolveFaviconDocId(docs: readonly IconDocument[], wanted: string | undefined): string {
  return docs.find((doc) => doc.id === wanted)?.id ?? docs[0]?.id ?? '';
}

/** Dung lượng PNG ước tính của icon đơn giản; chỉ để hiện "~", không dùng để tạo tệp. */
export function estimatePngBytes(size: number): number {
  return Math.max(64, Math.round(120 + size * size * 0.02));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bộ vẽ giả cho bước xem trước: trả "PNG" có chữ ký đúng và độ dài ước tính, nên bộ dựng gói chạy y như thật mà không cần canvas. */
export const estimateRasterize: RasterizeFn = async (_svg, size) => {
  const bytes = new Uint8Array(estimatePngBytes(size));
  bytes.set(PNG_SIGNATURE);
  return bytes;
};

/** Số byte khi mã hoá UTF-8, không cần TextEncoder. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

/** Cắt danh sách dài để không dựng hàng nghìn dòng. */
export function limitList<T>(items: readonly T[], max: number): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, max), hidden: Math.max(0, items.length - max) };
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  svg: 'image/svg+xml',
  json: 'application/json',
  tsx: 'text/plain;charset=utf-8',
  ts: 'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
  png: 'image/png',
  ico: 'image/x-icon',
  webmanifest: 'application/manifest+json',
  zip: 'application/zip',
};

export function mimeOf(path: string): string {
  const extension = baseName(path).split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** Tên gói zip (không có đuôi), cũng là thư mục gốc bên trong gói. */
export function archiveBaseName(docs: readonly IconDocument[], formats: readonly ExportFormat[]): string {
  if (formats.length === 1 && formats[0] === 'favicon') return 'svndts-favicon';
  if (docs.length === 1) return `svndts-${slugify(docs[0].name)}`;
  return 'svndts-icons';
}

const ZIP_ENTRY_OVERHEAD = 30 + 46;
const ZIP_END_RECORD = 22;

export interface PlannedFile {
  readonly path: string;
  readonly bytes: number;
  /** true với tệp nhị phân (PNG, ICO): dung lượng chỉ là ước tính. */
  readonly estimated: boolean;
}

export interface ExportPlan {
  readonly files: readonly PlannedFile[];
  /** Tổng dung lượng các tệp (ước tính nếu có PNG). */
  readonly totalBytes: number;
  /** Một tệp thì tải thẳng, nhiều tệp thì đóng zip. */
  readonly asZip: boolean;
  /** Tên tệp sẽ tải về. */
  readonly downloadName: string;
  /** Dung lượng tệp tải về (đã tính phần đầu của zip). */
  readonly downloadBytes: number;
  readonly warnings: readonly string[];
}

function describeFile(file: ExportFile): PlannedFile {
  return typeof file.data === 'string'
    ? { path: file.path, bytes: utf8Length(file.data), estimated: false }
    : { path: file.path, bytes: file.data.length, estimated: true };
}

/** Danh sách tệp sẽ tạo, không vẽ ảnh thật (dùng bộ vẽ giả); nhanh đủ để chạy lại mỗi lần đổi lựa chọn. */
export async function planExport(
  docs: readonly IconDocument[],
  palette: BrandPalette,
  choice: ExportChoice,
): Promise<ExportPlan> {
  const bundle = await buildExportBundle(docs, {
    formats: choice.formats,
    colorMode: choice.colorMode,
    palette,
    rasterize: estimateRasterize,
    faviconDocId: resolveFaviconDocId(docs, choice.faviconDocId),
  });
  const files = bundle.files.map(describeFile);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const asZip = files.length > 1;
  const zipName = `${archiveBaseName(docs, choice.formats)}.zip`;
  const root = zipName.slice(0, -'.zip'.length);
  const overhead = files.reduce((sum, file) => sum + ZIP_ENTRY_OVERHEAD + 2 * utf8Length(`${root}/${file.path}`), ZIP_END_RECORD);
  return {
    files,
    totalBytes,
    asZip,
    downloadName: asZip ? zipName : files.length === 1 ? baseName(files[0].path) : zipName,
    downloadBytes: asZip ? totalBytes + overhead : totalBytes,
    warnings: bundle.warnings,
  };
}

export interface ExportResult {
  readonly filename: string;
  readonly mime: string;
  readonly data: string | Uint8Array;
  readonly fileCount: number;
  readonly warnings: readonly string[];
}

/**
 * Xuất thật: vẽ PNG bằng `rasterize` (mặc định là canvas của trình duyệt), rồi trả một tệp để tải thẳng
 * hoặc một gói zip có thư mục gốc.
 */
export async function runExport(
  docs: readonly IconDocument[],
  palette: BrandPalette,
  choice: ExportChoice,
  rasterize: RasterizeFn = svgToPng,
): Promise<ExportResult> {
  const bundle = await buildExportBundle(docs, {
    formats: choice.formats,
    colorMode: choice.colorMode,
    palette,
    rasterize,
    faviconDocId: resolveFaviconDocId(docs, choice.faviconDocId),
  });
  if (bundle.files.length === 0) throw new Error(bundle.warnings[0] ?? 'Không có tệp nào để xuất.');

  if (bundle.files.length === 1) {
    const [file] = bundle.files;
    return { filename: baseName(file.path), mime: mimeOf(file.path), data: file.data, fileCount: 1, warnings: bundle.warnings };
  }
  const root = archiveBaseName(docs, choice.formats);
  const zip = createZip(bundle.files.map((file) => ({ path: `${root}/${file.path}`, data: file.data })));
  return { filename: `${root}.zip`, mime: mimeOf('x.zip'), data: zip, fileCount: bundle.files.length, warnings: bundle.warnings };
}
