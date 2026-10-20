import { createHash } from 'node:crypto';
import {
  BRAND_ICON_ID_PATTERN,
  generateSvg,
  type BrandPalette,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';

/** Tiền tố khoá object của Brand Studio; nằm ngoài `tenants/` nên xoá tenant không động tới. */
export const BRAND_OBJECT_PREFIX = 'platform/brand';

export interface IconObjectKeys {
  readonly spec: string;
  readonly svg: string;
  readonly monoSvg: string;
}

function assertKeyPart(id: string, version: number): void {
  // Khoá được dựng từ mã do client gửi nên chỉ nhận đúng mẫu và số nguyên dương.
  if (!BRAND_ICON_ID_PATTERN.test(id))
    throw new Error('Invalid brand icon id for an object key.');
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Invalid brand icon version for an object key.');
}

/** `platform/brand/icons/<id>/v<N>/{spec.json,icon.svg,icon.mono.svg}`. */
export function iconObjectKeys(id: string, version: number): IconObjectKeys {
  assertKeyPart(id, version);
  const base = `${BRAND_OBJECT_PREFIX}/icons/${id}/v${version}`;
  return {
    spec: `${base}/spec.json`,
    svg: `${base}/icon.svg`,
    monoSvg: `${base}/icon.mono.svg`,
  };
}

/** `platform/brand/standards/v<N>.json` (N từ 1; phiên bản 0 là mặc định, không có object). */
export function standardsObjectKey(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Invalid brand standards version for an object key.');
  return `${BRAND_OBJECT_PREFIX}/standards/v${version}.json`;
}

/** JSON ổn định: khoá đối tượng được sắp thứ tự nên cùng nội dung luôn cho cùng chuỗi. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Phần nội dung của icon dùng để so sánh và băm. `status` do máy chủ quản lý còn `createdAt`/`updatedAt`
 * đổi theo từng lần lưu, nên cả ba bị loại để lưu lại cùng một nội dung thì không thành phiên bản mới.
 */
function contentOf(doc: IconDocument): Record<string, unknown> {
  const content: Record<string, unknown> = { ...doc };
  delete content.status;
  delete content.createdAt;
  delete content.updatedAt;
  return content;
}

export function specSha256(doc: IconDocument): string {
  return sha256Hex(stableStringify(contentOf(doc)));
}

export interface IconArtifacts {
  /** Tài liệu ghi vào `spec.json`: `status` luôn `draft`, trạng thái thật nằm trong DB. */
  readonly storedDocument: IconDocument;
  readonly specJson: string;
  readonly specSha256: string;
  readonly sizeBytes: number;
  /** SVG chế độ màu thương hiệu, ghi cứng màu theo bảng màu hiện hành. */
  readonly svg: string;
  /** SVG chế độ `currentColor`. */
  readonly monoSvg: string;
}

export interface IconBuildContext {
  readonly palette: BrandPalette;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Dựng toàn bộ nội dung object của một phiên bản từ tài liệu đã chuẩn hoá; SVG luôn do máy chủ tự dựng. */
export function buildIconArtifacts(
  doc: IconDocument,
  context: IconBuildContext,
): IconArtifacts {
  const storedDocument: IconDocument = {
    ...doc,
    status: 'draft',
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
  const specJson = JSON.stringify(storedDocument);
  return {
    storedDocument,
    specJson,
    specSha256: specSha256(doc),
    sizeBytes: Buffer.byteLength(specJson, 'utf8'),
    svg: generateSvg(storedDocument, {
      colorMode: 'brand',
      palette: context.palette,
    }),
    monoSvg: generateSvg(storedDocument, { colorMode: 'currentColor' }),
  };
}
