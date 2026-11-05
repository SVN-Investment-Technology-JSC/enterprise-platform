import {
  PROMOTION_DISCOUNT_TYPES,
  PROMOTION_KINDS,
  type PromotionCatalogItem,
  type PromotionDiscountType,
  type PromotionKind,
  type QuotePromotionSnapshot,
  type SavePromotionCatalogRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';
import { optionalDate, optionalText, requiredText } from './fields.js';

/** Khuyến mãi của báo giá (P2I-11): hàm thuần, không DB. Khuyến mãi không đổi tổng báo giá. */

export interface PromotionRecord {
  readonly kind: PromotionKind;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly discountType: PromotionDiscountType;
  readonly value: number;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly active: boolean;
}

/** Hàng danh mục như store đọc ra (chưa có `effective`, vì cần ngày hôm nay). */
export type PromotionCatalogRow = Omit<PromotionCatalogItem, 'effective'>;

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
const VALUE_MAX = 1e12;

/** Đang bật và hôm nay (`yyyy-mm-dd`, giờ Việt Nam) nằm trong thời hạn. */
export function isPromotionEffective(row: Pick<PromotionCatalogRow, 'active' | 'validFrom' | 'validTo'>, today: string): boolean {
  if (!row.active) return false;
  if (row.validFrom && today < row.validFrom) return false;
  if (row.validTo && today > row.validTo) return false;
  return true;
}

export function withEffective(row: PromotionCatalogRow, today: string): PromotionCatalogItem {
  return { ...row, effective: isPromotionEffective(row, today) };
}

/** Lý do không chọn được một khuyến mãi (để báo cho người dùng), hoặc `null` khi chọn được. */
export function promotionUnavailableReason(row: PromotionCatalogRow, today: string): string | null {
  if (!row.active) return `"${row.name}" đã bị vô hiệu hoá, không chọn được.`;
  if (row.validFrom && today < row.validFrom) return `"${row.name}" chưa đến ngày hiệu lực (${row.validFrom}).`;
  if (row.validTo && today > row.validTo) return `"${row.name}" đã hết hiệu lực (${row.validTo}).`;
  return null;
}

export function promotionSnapshot(row: PromotionCatalogRow): QuotePromotionSnapshot {
  return {
    catalogId: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    discountType: row.discountType,
    value: row.value,
  };
}

/** Chuẩn hoá thân tạo, sửa danh mục; khi sửa, trường bỏ trống giữ giá trị của `current`. */
export function promotionRecord(request: SavePromotionCatalogRequest | undefined, current?: PromotionCatalogRow): PromotionRecord {
  const kind = PROMOTION_KINDS.find((candidate) => candidate === (request?.kind ?? current?.kind));
  if (!kind) throw new CrmValidationError('PROMOTION_KIND_INVALID', 'Vui lòng chọn loại: chương trình khuyến mãi hoặc chính sách chiết khấu.');
  if (current && kind !== current.kind) {
    throw new CrmValidationError('PROMOTION_KIND_LOCKED', 'Không đổi được loại của mục đã tạo; hãy tạo mục mới và vô hiệu hoá mục này.');
  }
  const code = requiredText(request?.code ?? current?.code, 50, 'mã').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new CrmValidationError('PROMOTION_CODE_INVALID', 'Mã chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.');
  }
  const discountType = PROMOTION_DISCOUNT_TYPES.find((candidate) => candidate === (request?.discountType ?? current?.discountType ?? 'NONE'));
  if (!discountType) throw new CrmValidationError('PROMOTION_DISCOUNT_INVALID', 'Loại chiết khấu phải là phần trăm, số tiền hoặc không có.');
  let value = 0;
  if (discountType !== 'NONE') {
    const raw = request?.value ?? current?.value;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > VALUE_MAX) {
      throw new CrmValidationError('PROMOTION_VALUE_INVALID', 'Giá trị chiết khấu phải là số lớn hơn 0.');
    }
    if (discountType === 'PERCENT' && raw > 100) {
      throw new CrmValidationError('PROMOTION_VALUE_INVALID', 'Chiết khấu phần trăm không quá 100.');
    }
    value = Math.round(raw * 10_000) / 10_000;
  }
  const validFrom = request?.validFrom === undefined ? (current?.validFrom ?? null) : optionalDate(request.validFrom, 'ngày bắt đầu hiệu lực');
  const validTo = request?.validTo === undefined ? (current?.validTo ?? null) : optionalDate(request.validTo, 'ngày hết hiệu lực');
  if (validFrom && validTo && validTo < validFrom) {
    throw new CrmValidationError('PROMOTION_PERIOD_INVALID', 'Ngày hết hiệu lực phải sau hoặc bằng ngày bắt đầu.');
  }
  if (request?.active !== undefined && typeof request.active !== 'boolean') {
    throw new CrmValidationError('INVALID', 'Giá trị bật, tắt không hợp lệ.');
  }
  return {
    kind,
    code,
    name: requiredText(request?.name ?? current?.name, 200, 'tên'),
    description: request?.description === undefined ? (current?.description ?? null) : optionalText(request.description, 1000, 'mô tả'),
    discountType,
    value,
    validFrom,
    validTo,
    active: request?.active ?? current?.active ?? true,
  };
}
