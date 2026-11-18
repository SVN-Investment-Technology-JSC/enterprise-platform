import type { CrmCatalogMaterial, QuoteLineError, QuoteLineInput } from '@enterprise-platform/contracts-crm';
import { parseNumber } from '../pricing/pricing.model';

/**
 * Logic thuần của hộp thoại "Thêm dòng báo giá" chọn nhiều mặt hàng: tập đã chọn
 * giữ xuyên suốt khi đổi từ khoá tìm, mỗi mặt hàng có số lượng riêng.
 */

export interface PickedMaterial {
  readonly material: CrmCatalogMaterial;
  /** Số lượng đang gõ (chuỗi, để giữ nguyên chữ người dùng nhập). */
  readonly quantity: string;
  /** Đơn giá ghi đè đang gõ; rỗng là lấy theo bảng giá (bắt buộc với mặt hàng "Chưa nhập giá ở Kho"). */
  readonly overridePrice?: string;
}

/** Tập đã chọn theo id mặt hàng; Map giữ thứ tự chọn. */
export type PickedMap = ReadonlyMap<string, PickedMaterial>;

export const DEFAULT_PICK_QUANTITY = '1';

/** Bật hoặc bỏ chọn các mặt hàng; mặt hàng đã chọn giữ số lượng đang gõ. */
export function setPicked(picked: PickedMap, materials: readonly CrmCatalogMaterial[], on: boolean): PickedMap {
  const next = new Map(picked);
  for (const material of materials) {
    if (!on) next.delete(material.id);
    else if (!next.has(material.id)) next.set(material.id, { material, quantity: DEFAULT_PICK_QUANTITY });
  }
  return next;
}

export function setPickedQuantity(picked: PickedMap, id: string, quantity: string): PickedMap {
  const current = picked.get(id);
  if (!current) return picked;
  return new Map(picked).set(id, { ...current, quantity });
}

export function setPickedOverridePrice(picked: PickedMap, id: string, overridePrice: string): PickedMap {
  const current = picked.get(id);
  if (!current) return picked;
  return new Map(picked).set(id, { ...current, overridePrice });
}

/** Nhãn nút chính: "Thêm N dòng"; "Vẫn thêm N dòng" khi đang xác nhận trùng. */
export function addLinesLabel(count: number, confirmingDuplicates = false): string {
  if (count <= 0) return 'Thêm dòng';
  return `${confirmingDuplicates ? 'Vẫn thêm' : 'Thêm'} ${count} dòng`;
}

/** Các mặt hàng đã chọn mà báo giá đã có. */
export function duplicatePicks(picked: PickedMap, existingMaterialIds: ReadonlySet<string>): PickedMaterial[] {
  return [...picked.values()].filter((entry) => existingMaterialIds.has(entry.material.id));
}

export function duplicateWarning(duplicates: readonly PickedMaterial[]): string {
  const names = duplicates.map((entry) => entry.material.code).join(', ');
  return `${duplicates.length} mặt hàng đã có trong báo giá (${names}). Bấm "Vẫn thêm" để thêm dòng mới cho các mặt hàng này.`;
}

export type BuildLinesResult =
  | { readonly ok: true; readonly lines: QuoteLineInput[] }
  | { readonly ok: false; readonly error: string; readonly invalidIds: readonly string[] };

/** Dựng thân yêu cầu; một số lượng không hợp lệ thì không dựng dòng nào. */
export function buildLines(picked: PickedMap): BuildLinesResult {
  if (picked.size === 0) return { ok: false, error: 'Vui lòng chọn ít nhất một mặt hàng.', invalidIds: [] };
  const lines: QuoteLineInput[] = [];
  const invalidIds: string[] = [];
  let error = '';
  for (const [id, entry] of picked) {
    const quantity = parseNumber(entry.quantity);
    const priceText = entry.overridePrice?.trim() ?? '';
    const overrideUnitPrice = priceText ? parseNumber(priceText) : undefined;
    if (quantity === undefined || quantity <= 0) {
      invalidIds.push(id);
      error ||= 'Số lượng phải lớn hơn 0.';
    } else if (priceText && (overrideUnitPrice === undefined || overrideUnitPrice < 0)) {
      invalidIds.push(id);
      error ||= 'Đơn giá ghi đè phải là số không âm.';
    } else {
      lines.push(overrideUnitPrice === undefined ? { materialId: id, quantity } : { materialId: id, quantity, overrideUnitPrice });
    }
  }
  if (invalidIds.length) return { ok: false, error, invalidIds };
  return { ok: true, lines };
}

/** Lỗi theo dòng trong thân lỗi 400 `LINES_INVALID` (rỗng nếu không phải loại lỗi này). */
export function lineErrorsOf(cause: unknown): QuoteLineError[] {
  const errors = (cause as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (entry): entry is QuoteLineError =>
      typeof entry === 'object' && entry !== null && typeof (entry as QuoteLineError).line === 'number' && typeof (entry as QuoteLineError).message === 'string',
  );
}

/** Câu hiển thị lỗi theo dòng: "Dòng 2 (QA-01): ...". */
export function describeLineErrors(errors: readonly QuoteLineError[], picked: PickedMap): string[] {
  const order = [...picked.values()];
  return errors.map((entry) => {
    const material = order[entry.line - 1]?.material;
    return `Dòng ${entry.line}${material ? ` (${material.code})` : ''}: ${entry.message}`;
  });
}

/** Gợi ý cách xử lý khi có dòng chưa có giá bán (`PRICE_NOT_FOUND`); không có lỗi loại này thì không gợi ý. */
export function lineErrorsHint(errors: readonly QuoteLineError[]): string | undefined {
  return errors.some((entry) => entry.code === 'PRICE_NOT_FOUND')
    ? 'Mặt hàng chưa có giá trong bảng giá đã chọn (hoặc chưa nhập giá ở Kho). Nhập "Đơn giá ghi đè" cho dòng đó, chọn bảng giá khác, nhờ quản trị bán hàng cập nhật ở Cài đặt > Bảng giá, hoặc bỏ mặt hàng đó khỏi lần thêm này.'
    : undefined;
}
