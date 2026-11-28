import {
  STORAGE_LOCATION_LEVEL_NAME_MAX,
  STORAGE_LOCATION_SEPARATOR,
  STORAGE_LOCATION_TEXT_MAX,
  type StorageLocationInput,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from './inventory.error.js';

/** Vị trí lưu trữ là thông tin tùy chọn, chuỗi tự do: quy tắc ở đây chỉ chuẩn hoá và chặn dữ liệu rác, không kiểm khớp cấu trúc kho. */

const NOTE_MAX = 1000;

export interface NormalizedStorageLocation {
  readonly locationText: string;
  readonly segments?: readonly string[];
  readonly isPrimary: boolean;
  readonly note?: string;
}

/** Bỏ khoảng trắng hai đầu và gộp khoảng trắng liền nhau; giữ nguyên hoa thường và dấu như người nhập. */
export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Khóa so sánh trùng: không phân biệt hoa thường, đã gộp khoảng trắng (khớp chỉ mục duy nhất ở database). */
export function locationKey(text: string): string {
  return collapseSpaces(text).toLowerCase();
}

/** Tách chuỗi theo `/` hoặc `>`. Dấu khác (gạch ngang, dấu chấm) không tách vì có thể là một mã nguyên như `A-03-02`. */
export function splitLocationText(text: string): string[] {
  return text
    .split(/[/>]/)
    .map(collapseSpaces)
    .filter((part) => part.length > 0);
}

export function joinSegments(segments: readonly string[]): string {
  return segments.join(STORAGE_LOCATION_SEPARATOR);
}

function normalizeSegments(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(collapseSpaces)
    .filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Chuẩn hoá danh sách vị trí khai báo của một cặp (kho, mặt hàng).
 *
 * - Thiếu `locationText` thì ghép từ `segments`; cả hai trống thì bỏ dòng (không phải lỗi).
 * - Trùng (không phân biệt hoa thường) thì gộp, giữ dòng đầu; bất kỳ dòng nào trùng đánh dấu chính thì kết quả là chính.
 * - Đúng một vị trí chính nếu danh sách không rỗng: dòng được đánh dấu đầu tiên, không có thì dòng đầu tiên.
 */
export function normalizeStorageLocations(
  inputs: readonly StorageLocationInput[] | undefined,
): NormalizedStorageLocation[] {
  if (!Array.isArray(inputs)) {
    throw new InventoryError('VALIDATION', 'Danh sách vị trí không hợp lệ.');
  }
  const byKey = new Map<string, { locationText: string; segments?: string[]; isPrimary: boolean; note?: string }>();
  for (const input of inputs) {
    if (!input || typeof input !== 'object') {
      throw new InventoryError('VALIDATION', 'Danh sách vị trí không hợp lệ.');
    }
    const segments = normalizeSegments(input.segments);
    const typed = typeof input.locationText === 'string' ? collapseSpaces(input.locationText) : '';
    const locationText = typed || (segments ? joinSegments(segments) : '');
    if (!locationText) continue;
    if (locationText.length > STORAGE_LOCATION_TEXT_MAX) {
      throw new InventoryError(
        'STORAGE_LOCATION_TOO_LONG',
        `Vị trí "${locationText.slice(0, 30)}..." dài quá ${STORAGE_LOCATION_TEXT_MAX} ký tự.`,
      );
    }
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > NOTE_MAX) {
      throw new InventoryError('VALIDATION', `Ghi chú vị trí dài quá ${NOTE_MAX} ký tự.`);
    }
    const key = locationKey(locationText);
    const existing = byKey.get(key);
    if (existing) {
      existing.isPrimary = existing.isPrimary || input.isPrimary === true;
      continue;
    }
    byKey.set(key, {
      locationText,
      segments,
      isPrimary: input.isPrimary === true,
      note: note || undefined,
    });
  }
  const list = [...byKey.values()];
  const flagged = list.findIndex((entry) => entry.isPrimary);
  const primaryIndex = flagged >= 0 ? flagged : 0;
  return list.map((entry, index) => ({ ...entry, isPrimary: index === primaryIndex }));
}

/** Đọc tên cấp từ dữ liệu đã lưu hoặc payload cài đặt: bỏ phần tử không phải chuỗi hoặc rỗng, cắt tên quá dài. */
export function normalizeLevelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(collapseSpaces)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, STORAGE_LOCATION_LEVEL_NAME_MAX));
}

/** Kiểm chặt tên cấp do người dùng gửi: không phải mảng chuỗi hoặc có tên quá dài thì từ chối thay vì lặng lẽ cắt. */
export function parseLevelNames(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new InventoryError('VALIDATION', 'Danh sách tên cấp không hợp lệ.');
  }
  const names = (value as string[]).map(collapseSpaces).filter((entry) => entry.length > 0);
  const tooLong = names.find((entry) => entry.length > STORAGE_LOCATION_LEVEL_NAME_MAX);
  if (tooLong) {
    throw new InventoryError(
      'VALIDATION',
      `Tên cấp "${tooLong.slice(0, 20)}..." dài quá ${STORAGE_LOCATION_LEVEL_NAME_MAX} ký tự.`,
    );
  }
  return names;
}
