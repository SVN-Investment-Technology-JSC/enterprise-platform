import type { PromotionCatalogItem } from '@enterprise-platform/contracts-crm';
import {
  EMPTY_PROMOTION_FORM,
  canEditQuotePromotions,
  promotionFormError,
  promotionFormToRequest,
  promotionStateLabel,
  promotionValueLabel,
  sameIdSet,
  selectableCatalog,
} from './promotions.model';

const item = (patch: Partial<PromotionCatalogItem> = {}): PromotionCatalogItem => ({
  id: 'p1', kind: 'PROGRAM', code: 'KM1', name: 'Mua 10 tặng 1', description: null, discountType: 'PERCENT', value: 5,
  validFrom: null, validTo: null, active: true, effective: true, createdAt: '', updatedAt: '', ...patch,
});

describe('promotions.model', () => {
  it('nhãn mức giảm theo loại', () => {
    expect(promotionValueLabel(item())).toBe('5%');
    expect(promotionValueLabel(item({ discountType: 'NONE', value: 0 }))).toBe('Không giảm giá');
  });

  it('nhãn hiệu lực: tắt, hết hạn, chưa đến hạn', () => {
    expect(promotionStateLabel(item(), '2026-05-01')).toBe('Còn hiệu lực');
    expect(promotionStateLabel(item({ active: false, effective: false }), '2026-05-01')).toBe('Đã tắt');
    expect(promotionStateLabel(item({ effective: false, validTo: '2026-01-01' }), '2026-05-01')).toBe('Hết hạn');
    expect(promotionStateLabel(item({ effective: false, validFrom: '2026-06-01' }), '2026-05-01')).toBe('Chưa đến hạn');
  });

  it('kiểm form: bắt buộc mã, tên; phần trăm không quá 100; khoảng ngày hợp lệ', () => {
    const ok = { ...EMPTY_PROMOTION_FORM, code: 'km', name: 'KM', value: '10' };
    expect(promotionFormError(ok)).toBeUndefined();
    expect(promotionFormError({ ...ok, code: ' ' })).toBe('Vui lòng nhập mã.');
    expect(promotionFormError({ ...ok, name: '' })).toBe('Vui lòng nhập tên.');
    expect(promotionFormError({ ...ok, value: '150' })).toBe('Phần trăm giảm không quá 100.');
    expect(promotionFormError({ ...ok, value: '' })).toBe('Giá trị giảm phải là số không âm.');
    expect(promotionFormError({ ...ok, validFrom: '2026-02-01', validTo: '2026-01-01' })).toMatch(/Ngày bắt đầu/);
    expect(promotionFormError({ ...ok, discountType: 'NONE', value: '' })).toBeUndefined();
  });

  it('thân yêu cầu: mã in hoa, NONE đưa giá trị về 0, ngày rỗng thành null', () => {
    expect(promotionFormToRequest({ ...EMPTY_PROMOTION_FORM, code: ' km1 ', name: ' A ', discountType: 'NONE', value: '9' })).toMatchObject({
      code: 'KM1', name: 'A', value: 0, validFrom: null, validTo: null, description: null,
    });
  });

  it('danh mục chọn được: còn hiệu lực và chưa được chọn', () => {
    const rows = [item({ id: 'a' }), item({ id: 'b', effective: false }), item({ id: 'c' })];
    expect(selectableCatalog(rows, new Set(['c'])).map((row) => row.id)).toEqual(['a']);
  });

  it('so sánh tập id không xét thứ tự', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameIdSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('chỉ sửa khuyến mãi khi Nháp, phiên bản hiện tại và có quyền', () => {
    expect(canEditQuotePromotions('DRAFT', true, true)).toBe(true);
    expect(canEditQuotePromotions('APPROVED', true, true)).toBe(false);
    expect(canEditQuotePromotions('DRAFT', false, true)).toBe(false);
    expect(canEditQuotePromotions('DRAFT', true, false)).toBe(false);
  });
});
