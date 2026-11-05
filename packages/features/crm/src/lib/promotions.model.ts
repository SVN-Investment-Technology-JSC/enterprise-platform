import {
  PROMOTION_KIND_LABELS,
  type PromotionCatalogItem,
  type PromotionDiscountType,
  type PromotionKind,
  type QuotePromotionSnapshot,
  type SavePromotionCatalogRequest,
} from '@enterprise-platform/contracts-crm';
import { formatMoney } from './sales.model';

export const PROMOTION_DISCOUNT_LABELS: Readonly<
  Record<PromotionDiscountType, string>
> = {
  PERCENT: 'Theo phần trăm',
  AMOUNT: 'Theo số tiền',
  NONE: 'Không giảm giá (chỉ thông tin)',
};

export const PROMOTION_NOT_DEDUCTED_NOTE =
  'Khuyến mãi chỉ là thông tin kèm theo, không tự trừ vào tổng báo giá.';

/** Giá trị giảm để hiển thị: "10%", "500.000" hoặc "Không giảm giá". */
export function promotionValueLabel(
  item: Pick<PromotionCatalogItem, 'discountType' | 'value'>,
): string {
  if (item.discountType === 'PERCENT') return `${item.value}%`;
  if (item.discountType === 'AMOUNT') return formatMoney(item.value);
  return 'Không giảm giá';
}

export function snapshotLabel(item: QuotePromotionSnapshot): string {
  const value = promotionValueLabel(item);
  return item.discountType === 'NONE'
    ? `${item.code} - ${item.name}`
    : `${item.code} - ${item.name} (${value})`;
}

/** Hiệu lực dạng chữ: "Còn hiệu lực", "Đã tắt", "Hết hạn" hoặc "Chưa đến hạn". */
export function promotionStateLabel(
  item: Pick<
    PromotionCatalogItem,
    'active' | 'effective' | 'validFrom' | 'validTo'
  >,
  today: string,
): string {
  if (!item.active) return 'Đã tắt';
  if (item.effective) return 'Còn hiệu lực';
  if (item.validTo && item.validTo < today) return 'Hết hạn';
  if (item.validFrom && item.validFrom > today) return 'Chưa đến hạn';
  return 'Không hiệu lực';
}

export function promotionValidityLabel(
  item: Pick<PromotionCatalogItem, 'validFrom' | 'validTo'>,
): string {
  if (!item.validFrom && !item.validTo) return 'Không giới hạn';
  return `${item.validFrom ?? '...'} đến ${item.validTo ?? '...'}`;
}

export interface PromotionFormValues {
  readonly kind: PromotionKind;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly discountType: PromotionDiscountType;
  readonly value: string;
  readonly validFrom: string;
  readonly validTo: string;
}

export const EMPTY_PROMOTION_FORM: PromotionFormValues = {
  kind: 'PROGRAM',
  code: '',
  name: '',
  description: '',
  discountType: 'PERCENT',
  value: '',
  validFrom: '',
  validTo: '',
};

export function promotionToForm(
  item: PromotionCatalogItem,
): PromotionFormValues {
  return {
    kind: item.kind,
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    discountType: item.discountType,
    value: item.discountType === 'NONE' ? '' : String(item.value),
    validFrom: item.validFrom ?? '',
    validTo: item.validTo ?? '',
  };
}

/** Lỗi nhập liệu (tiếng Việt) hoặc undefined nếu hợp lệ; server kiểm lại. */
export function promotionFormError(
  form: PromotionFormValues,
): string | undefined {
  if (!form.code.trim()) return 'Vui lòng nhập mã.';
  if (!form.name.trim()) return 'Vui lòng nhập tên.';
  if (form.discountType !== 'NONE') {
    const value = Number(form.value);
    if (form.value.trim() === '' || !Number.isFinite(value) || value < 0)
      return 'Giá trị giảm phải là số không âm.';
    if (form.discountType === 'PERCENT' && value > 100)
      return 'Phần trăm giảm không quá 100.';
  }
  if (form.validFrom && form.validTo && form.validFrom > form.validTo)
    return 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  return undefined;
}

export function promotionFormToRequest(
  form: PromotionFormValues,
): SavePromotionCatalogRequest {
  return {
    kind: form.kind,
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    discountType: form.discountType,
    value: form.discountType === 'NONE' ? 0 : Number(form.value),
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
  };
}

/** Danh mục còn hiệu lực chưa được chọn: nguồn cho ô thêm khuyến mãi vào dự án. */
export function selectableCatalog(
  catalog: readonly PromotionCatalogItem[],
  takenCatalogIds: ReadonlySet<string>,
): PromotionCatalogItem[] {
  return catalog.filter(
    (item) => item.effective && !takenCatalogIds.has(item.id),
  );
}

export function promotionOption(item: PromotionCatalogItem) {
  return {
    value: item.id,
    label: item.name,
    badge: item.code,
    description: `${PROMOTION_KIND_LABELS[item.kind]} · ${promotionValueLabel(item)}`,
  };
}

/** Phiên bản báo giá chỉ sửa được khuyến mãi khi đang Nháp. */
export function canEditQuotePromotions(
  status: string,
  isCurrent: boolean,
  canWrite: boolean,
): boolean {
  return canWrite && isCurrent && status === 'DRAFT';
}

/** Hôm nay dạng `yyyy-mm-dd` (giờ máy người dùng); chỉ để gắn nhãn hiệu lực, server quyết định `effective`. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Hai danh sách id có cùng tập phần tử (không xét thứ tự). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && new Set(a).size === new Set([...a, ...b]).size
  );
}

export const QUOTE_PROMOTIONS_NO_PROJECT =
  'Báo giá chưa thuộc dự án nào nên chưa chọn được khuyến mãi. Hãy gắn báo giá vào một dự án bán hàng; khuyến mãi được thiết lập riêng theo từng dự án.';
