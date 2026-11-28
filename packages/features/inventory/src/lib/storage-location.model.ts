import {
  STORAGE_LOCATION_SEPARATOR,
  type MaterialStorageLocation,
  type StorageLocationInput,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';

/**
 * Vị trí lưu trữ của mặt hàng theo kho: chuỗi tự do, tùy chọn. Form chia ô theo tên cấp của kho (không giới hạn số
 * cấp), nhưng dữ liệu cuối cùng luôn là một chuỗi `locationText`; số ô và tên ô chỉ là cách nhập.
 */

/** Mẫu gợi ý (nút "Dùng mẫu gợi ý") khi tenant chưa khai tên cấp. */
export const SUGGESTED_LOCATION_LEVELS: readonly string[] = ['Khu vực', 'Dãy', 'Kệ', 'Tầng', 'Ô chứa'];

/** Tên cấp có hiệu lực của kho: ghi đè của kho nếu có, không thì mẫu của tenant. Rỗng là nhập thành một chuỗi. */
export function effectiveLevels(
  warehouse: Pick<Warehouse, 'locationLevels'>,
  templateLevels: readonly string[] = [],
): readonly string[] {
  return warehouse.locationLevels ?? templateLevels;
}

export function describeLevels(levels: readonly string[]): string {
  return levels.length === 0 ? 'Không chia cấp' : levels.join(STORAGE_LOCATION_SEPARATOR);
}

/** Tách chuỗi theo `/` hoặc `>`; dấu khác (gạch ngang, dấu chấm) không tách vì có thể là một mã như `A-03-02`. */
export function splitLocationText(text: string): string[] {
  return text
    .split(/[/>]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
}

/** Một dòng đang sửa trong form. `parts` dùng khi kho chia cấp, `text` khi kho nhập một chuỗi. */
export interface LocationDraft {
  readonly key: string;
  readonly parts: readonly string[];
  readonly text: string;
  readonly isPrimary: boolean;
  readonly note: string;
}

let draftCounter = 0;
export function newDraftKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

/** Dòng trống: số ô bằng số cấp của kho. */
export function emptyDraft(levels: readonly string[], isPrimary = false): LocationDraft {
  return { key: newDraftKey(), parts: levels.map(() => ''), text: '', isPrimary, note: '' };
}

/**
 * Dựng dòng sửa từ dữ liệu đã lưu. Kho chia cấp: lấy `segments` (hoặc tách chuỗi), đệm cho đủ số ô; chuỗi nhiều phần
 * hơn số cấp thì giữ thêm ô để không mất dữ liệu.
 */
export function toDraft(location: MaterialStorageLocation, levels: readonly string[]): LocationDraft {
  const stored = location.segments && location.segments.length > 0 ? [...location.segments] : splitLocationText(location.locationText);
  const parts =
    levels.length === 0
      ? []
      : stored.length === 0
        ? levels.map(() => '')
        : [...stored, ...Array.from({ length: Math.max(0, levels.length - stored.length) }, () => '')];
  return {
    key: location.id,
    parts,
    text: location.locationText,
    isPrimary: location.isPrimary,
    note: location.note ?? '',
  };
}

/** Chuỗi vị trí của một dòng: ghép các ô đã điền (kho chia cấp) hoặc lấy ô chuỗi (kho không chia cấp). */
export function draftText(draft: LocationDraft, levels: readonly string[]): string {
  if (levels.length === 0) return draft.text.replace(/\s+/g, ' ').trim();
  return draft.parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join(STORAGE_LOCATION_SEPARATOR);
}

/** Yêu cầu gửi lên server: bỏ dòng trống; luôn có đúng một dòng chính nếu danh sách không rỗng (server cũng đảm bảo). */
export function toInputs(drafts: readonly LocationDraft[], levels: readonly string[]): StorageLocationInput[] {
  return drafts
    .map((draft) => ({ draft, text: draftText(draft, levels) }))
    .filter((entry) => entry.text.length > 0)
    .map(({ draft, text }) => ({
      locationText: text,
      segments:
        levels.length > 0
          ? draft.parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part.length > 0)
          : undefined,
      isPrimary: draft.isPrimary,
      note: draft.note.trim() || undefined,
    }));
}

/** So sánh nội dung để biết form đã đổi chưa (bỏ qua khóa dòng). */
export function draftsSignature(drafts: readonly LocationDraft[], levels: readonly string[]): string {
  const inputs = toInputs(drafts, levels);
  const primaryIndex = Math.max(0, inputs.findIndex((input) => input.isPrimary));
  return JSON.stringify(inputs.map((input, index) => [input.locationText, index === primaryIndex, input.note ?? '']));
}

/** Tóm tắt vị trí chính của từng kho, ví dụ `KHO-A: Khu A / Kệ 3; KHO-B: Dãy 1`. */
export function summarizePrimary(locations: readonly MaterialStorageLocation[]): string {
  const primary = locations.filter((location) => location.isPrimary);
  return primary.map((location) => `${location.warehouseCode}: ${location.locationText}`).join('; ');
}
