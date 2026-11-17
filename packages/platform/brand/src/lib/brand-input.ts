import {
  BRAND_ICON_ID_PATTERN,
  BRAND_ICON_STATUSES,
  BRAND_NOTE_MAX_LENGTH,
  BRAND_SVG_MODES,
  isBuiltInSlotId,
  isIconSlotId,
  isValidSlotId,
  normalizeDocument,
  normalizePalette,
  normalizeRules,
  type BrandIconStatus,
  type BrandStandardsPayload,
  type BrandSvgMode,
  type IconDocument,
  type IconSlotId,
} from '@enterprise-platform/shared-brand-icon';
import { brandErrors } from './brand.errors.js';
import type { CustomSlotInput } from './brand-store.js';

/** Số màu tối đa của bảng màu (khớp giới hạn của `normalizePalette`). */
const MAX_PALETTE_TOKENS = 64;
/** Số phiên bản lớn nhất nhận từ client; chặn số quá lớn trước khi dựng khoá hay truy vấn. */
const MAX_VERSION = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function assertIconId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !BRAND_ICON_ID_PATTERN.test(id)) {
    throw brandErrors.requestInvalid(
      'Mã icon không hợp lệ (chữ, số, gạch ngang hoặc gạch dưới, tối đa 64 ký tự).',
    );
  }
}

export function assertSlotId(slot: unknown): asserts slot is IconSlotId {
  if (typeof slot !== 'string' || !isIconSlotId(slot)) {
    throw brandErrors.slotNotFound();
  }
}

/**
 * Kiểm tra và làm sạch tài liệu icon từ client. Máy chủ chỉ nhận mô hình có cấu trúc (không nhận SVG thô):
 * `normalizeDocument` ép kiểu, giới hạn số lớp, toạ độ, màu; trả null thì từ chối.
 */
export function parseDocument(value: unknown): IconDocument {
  if (!isRecord(value)) throw brandErrors.iconInvalid('Thiếu nội dung icon.');
  if (typeof value.id !== 'string' || !BRAND_ICON_ID_PATTERN.test(value.id)) {
    throw brandErrors.iconInvalid(
      'Mã icon không hợp lệ (chữ, số, gạch ngang hoặc gạch dưới, tối đa 64 ký tự).',
    );
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    throw brandErrors.iconInvalid('Icon chưa có tên.');
  }
  let document: IconDocument | null;
  try {
    document = normalizeDocument(value);
  } catch {
    document = null;
  }
  if (!document) {
    throw brandErrors.iconInvalid(
      'Nội dung icon không hợp lệ. Hãy kiểm tra tên, danh sách lớp hình và toạ độ.',
    );
  }
  return document;
}

/** Ghi chú phiên bản: bỏ ký tự điều khiển, cắt theo độ dài tối đa; rỗng thì là null. */
export function cleanNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw brandErrors.requestInvalid('Ghi chú phiên bản phải là chuỗi.');
  const cleaned = [...value]
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, BRAND_NOTE_MAX_LENGTH);
  return cleaned === '' ? null : cleaned;
}

/** Số phiên bản nguyên dương (hoặc từ 0 khi `allowZero`); sai kiểu hay vượt giới hạn thì báo lỗi yêu cầu. */
export function parseVersionNumber(
  value: unknown,
  field: string,
  allowZero = false,
): number {
  const number =
    typeof value === 'string' && /^\d{1,7}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < (allowZero ? 0 : 1) ||
    number > MAX_VERSION
  ) {
    throw brandErrors.requestInvalid(
      `Giá trị "${field}" phải là số nguyên ${allowZero ? 'từ 0' : 'dương'}.`,
    );
  }
  return number;
}

export function parseOptionalVersion(
  value: unknown,
  field: string,
): number | null {
  return value === undefined || value === ''
    ? null
    : parseVersionNumber(value, field);
}

export function parseSvgMode(value: unknown): BrandSvgMode {
  if (value === undefined || value === '') return 'brand';
  if (
    typeof value === 'string' &&
    (BRAND_SVG_MODES as readonly string[]).includes(value)
  )
    return value as BrandSvgMode;
  throw brandErrors.requestInvalid('Chế độ SVG phải là "brand" hoặc "mono".');
}

/** `status=draft,published`; vắng mặt hoặc rỗng nghĩa là mọi trạng thái. */
export function parseStatuses(
  value: unknown,
): readonly BrandIconStatus[] | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string')
    throw brandErrors.requestInvalid('Bộ lọc trạng thái không hợp lệ.');
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const invalid = parts.filter(
    (part) => !(BRAND_ICON_STATUSES as readonly string[]).includes(part),
  );
  if (invalid.length > 0) {
    throw brandErrors.requestInvalid(
      'Trạng thái phải là draft, published hoặc archived.',
    );
  }
  return parts.length > 0
    ? [...new Set(parts as BrandIconStatus[])]
    : undefined;
}

/**
 * Bảng màu và quy chuẩn từ client. Khác với `normalizePalette` (lặng lẽ bỏ màu sai), nhập của quản trị
 * phải đúng từng màu, nên có màu bị loại là từ chối thay vì lưu một bảng màu khác với ý người nhập.
 */
export function parseStandards(input: unknown): BrandStandardsPayload {
  if (!isRecord(input))
    throw brandErrors.standardsInvalid('Thiếu nội dung bảng màu và quy chuẩn.');
  const rawPalette = input.palette;
  if (
    !isRecord(rawPalette) ||
    !Array.isArray(rawPalette.tokens) ||
    rawPalette.tokens.length === 0
  ) {
    throw brandErrors.standardsInvalid('Bảng màu cần có ít nhất một màu.');
  }
  if (rawPalette.tokens.length > MAX_PALETTE_TOKENS) {
    throw brandErrors.standardsInvalid(
      `Bảng màu tối đa ${MAX_PALETTE_TOKENS} màu.`,
    );
  }
  const palette = normalizePalette(rawPalette);
  const rawKeys = rawPalette.tokens.map((token) =>
    isRecord(token) && typeof token.key === 'string' ? token.key.trim() : null,
  );
  const intact =
    palette.tokens.length === rawKeys.length &&
    palette.tokens.every((token, index) => token.key === rawKeys[index]);
  if (!intact) {
    throw brandErrors.standardsInvalid(
      'Bảng màu có màu trùng khoá hoặc sai định dạng. Khoá gồm chữ thường, số, gạch ngang; mã màu dạng #rrggbb.',
    );
  }
  if (!isRecord(input.rules))
    throw brandErrors.standardsInvalid('Thiếu quy chuẩn thương hiệu.');
  return { palette, rules: normalizeRules(input.rules) };
}

export function parseCustomSlotInput(
  value: unknown,
  actorId?: string,
): CustomSlotInput {
  if (!isRecord(value)) {
    throw brandErrors.requestInvalid('Thiếu dữ liệu vị trí icon.');
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!isValidSlotId(id)) {
    throw brandErrors.requestInvalid(
      'Mã vị trí icon không hợp lệ (bắt đầu bằng chữ thường, gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới, từ 2-64 ký tự).',
    );
  }
  if (isBuiltInSlotId(id)) {
    throw brandErrors.slotConflict();
  }
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label) {
    throw brandErrors.requestInvalid('Tên vị trí icon không được để trống.');
  }
  const description =
    typeof value.description === 'string' ? value.description.trim() : '';
  const groupKey =
    typeof value.groupKey === 'string' && value.groupKey.trim() !== ''
      ? value.groupKey.trim()
      : 'custom';
  const colorMode =
    value.colorMode === 'mono' || value.colorMode === 'brand'
      ? (value.colorMode as BrandSvgMode)
      : 'brand';
  const recommendedSize =
    typeof value.recommendedSize === 'number' &&
    Number.isSafeInteger(value.recommendedSize) &&
    value.recommendedSize >= 8 &&
    value.recommendedSize <= 512
      ? value.recommendedSize
      : 24;

  return {
    id,
    label,
    description,
    groupKey,
    colorMode,
    recommendedSize,
    createdBy: actorId,
  };
}

type CustomSlotPatch = Partial<Omit<CustomSlotInput, 'id' | 'createdBy'>>;

export function parseCustomSlotPatch(value: unknown): CustomSlotPatch {
  if (!isRecord(value)) {
    throw brandErrors.requestInvalid('Thiếu dữ liệu cập nhật vị trí icon.');
  }
  const patch: { -readonly [K in keyof CustomSlotPatch]: CustomSlotPatch[K] } = {};
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || !value.label.trim()) {
      throw brandErrors.requestInvalid('Tên vị trí icon không được để trống.');
    }
    patch.label = value.label.trim();
  }
  if (value.description !== undefined) {
    if (typeof value.description !== 'string') {
      throw brandErrors.requestInvalid('Mô tả vị trí icon phải là chuỗi.');
    }
    patch.description = value.description.trim();
  }
  if (value.groupKey !== undefined) {
    if (typeof value.groupKey !== 'string' || !value.groupKey.trim()) {
      throw brandErrors.requestInvalid('Nhóm vị trí icon không hợp lệ.');
    }
    patch.groupKey = value.groupKey.trim();
  }
  if (value.colorMode !== undefined) {
    if (value.colorMode !== 'brand' && value.colorMode !== 'mono') {
      throw brandErrors.requestInvalid('Chế độ màu phải là "brand" hoặc "mono".');
    }
    patch.colorMode = value.colorMode;
  }
  if (value.recommendedSize !== undefined) {
    if (
      typeof value.recommendedSize !== 'number' ||
      !Number.isSafeInteger(value.recommendedSize) ||
      value.recommendedSize < 8 ||
      value.recommendedSize > 512
    ) {
      throw brandErrors.requestInvalid(
        'Kích thước khuyến nghị phải từ 8 đến 512 pixel.',
      );
    }
    patch.recommendedSize = value.recommendedSize;
  }
  return patch;
}
