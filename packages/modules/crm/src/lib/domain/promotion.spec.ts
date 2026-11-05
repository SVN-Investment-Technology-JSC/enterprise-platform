import { isPromotionEffective, promotionRecord, promotionUnavailableReason, promotionSnapshot, withEffective } from './promotion.js';
import type { PromotionCatalogRow } from './promotion.js';

const row = (patch: Partial<PromotionCatalogRow> = {}): PromotionCatalogRow => ({
  id: 'id-1',
  kind: 'PROGRAM',
  code: 'KM1',
  name: 'Khuyến mãi 1',
  description: null,
  discountType: 'PERCENT',
  value: 5,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

describe('khuyến mãi (miền)', () => {
  it('hiệu lực theo ngày và cờ bật', () => {
    expect(isPromotionEffective(row(), '2026-06-01')).toBe(true);
    expect(isPromotionEffective(row(), '2025-12-31')).toBe(false);
    expect(isPromotionEffective(row(), '2027-01-01')).toBe(false);
    expect(isPromotionEffective(row({ active: false }), '2026-06-01')).toBe(false);
    expect(isPromotionEffective(row({ validFrom: null, validTo: null }), '2030-01-01')).toBe(true);
    expect(withEffective(row(), '2026-06-01').effective).toBe(true);
  });

  it('nêu lý do không chọn được bằng tiếng Việt', () => {
    expect(promotionUnavailableReason(row(), '2026-06-01')).toBeNull();
    expect(promotionUnavailableReason(row({ validTo: '2026-05-31' }), '2026-06-01')).toContain('hết hiệu lực');
    expect(promotionUnavailableReason(row({ active: false }), '2026-06-01')).toContain('vô hiệu hoá');
    expect(promotionUnavailableReason(row({ validFrom: '2026-07-01' }), '2026-06-01')).toContain('chưa đến ngày');
  });

  it('chụp đủ trường cần giữ trên phiên bản', () => {
    expect(promotionSnapshot(row())).toEqual({ catalogId: 'id-1', kind: 'PROGRAM', code: 'KM1', name: 'Khuyến mãi 1', discountType: 'PERCENT', value: 5 });
  });

  it('chuẩn hoá bản ghi: mã in hoa, NONE ép giá trị 0, kiểm phần trăm và thời hạn', () => {
    const created = promotionRecord({ kind: 'DISCOUNT_POLICY', code: ' ck-vip ', name: 'Chiết khấu VIP', discountType: 'NONE', value: 9 });
    expect(created).toMatchObject({ code: 'CK-VIP', value: 0, active: true, kind: 'DISCOUNT_POLICY' });
    expect(() => promotionRecord({ kind: 'PROGRAM', code: 'A', name: 'A', discountType: 'PERCENT', value: 101 })).toThrow('không quá 100');
    expect(() => promotionRecord({ kind: 'PROGRAM', code: 'A', name: 'A', discountType: 'AMOUNT' })).toThrow('lớn hơn 0');
    expect(() => promotionRecord({ kind: 'PROGRAM', code: 'có dấu', name: 'A' })).toThrow('chữ không dấu');
    expect(() => promotionRecord({ kind: 'PROGRAM', code: 'A', name: 'A', validFrom: '2026-02-01', validTo: '2026-01-01' })).toThrow('sau hoặc bằng');
    expect(() => promotionRecord({}, undefined)).toThrow('Vui lòng chọn loại');
  });

  it('sửa giữ trường bỏ trống và không đổi loại', () => {
    const updated = promotionRecord({ name: 'Tên mới' }, row());
    expect(updated).toMatchObject({ name: 'Tên mới', code: 'KM1', value: 5, validTo: '2026-12-31' });
    expect(() => promotionRecord({ kind: 'DISCOUNT_POLICY' }, row())).toThrow('Không đổi được loại');
    expect(promotionRecord({ validTo: null }, row()).validTo).toBeNull();
  });
});
