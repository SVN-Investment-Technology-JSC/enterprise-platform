import { CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { withinValidity } from '../domain/pricing-engine.js';
import type { PriceListRef, PricingStore } from './pricing-store.port.js';

/**
 * Chọn bảng giá thủ công ở báo giá, đơn bán, thử tính giá (`docs/crm_price_list_logic/plan.md` 4.6, 4.9). Dùng chung
 * cho mọi nơi nhận `priceListId` từ người dùng.
 */

/** Chưa chọn bảng giá mà đã có dòng hàng. */
export function priceListRequired(): CrmValidationError {
  return new CrmValidationError('PRICE_LIST_REQUIRED', 'Vui lòng chọn bảng giá trước khi thêm dòng hàng.');
}

/**
 * Kiểm bảng giá người dùng chọn: id sai dạng `INVALID_REFERENCE`; không có `PRICE_LIST_NOT_FOUND`; ngừng áp dụng hoặc
 * ngoài hiệu lực tại ngày tính giá `date` thì `PRICE_LIST_NOT_EFFECTIVE`. Trả phần đầu bảng giá.
 */
export async function requireSelectablePriceList(
  store: Pick<PricingStore, 'priceListRef'>,
  tenantId: string,
  rawId: unknown,
  date: string,
): Promise<PriceListRef> {
  if (!isUuid(rawId)) throw new CrmValidationError('INVALID_REFERENCE', 'Bảng giá không hợp lệ.');
  const ref = await store.priceListRef(tenantId, rawId.toLowerCase());
  if (!ref) throw new CrmValidationError('PRICE_LIST_NOT_FOUND', 'Bảng giá không tồn tại.');
  if (ref.status !== 'ACTIVE' || !withinValidity(date, ref.validFrom, ref.validTo)) {
    throw new CrmValidationError('PRICE_LIST_NOT_EFFECTIVE', `Bảng giá ${ref.code} không áp dụng tại ngày tính giá.`);
  }
  return ref;
}
