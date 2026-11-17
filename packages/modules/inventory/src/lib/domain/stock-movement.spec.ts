import { likePattern, normalizeMovementSource, resolveMovementPaging } from './stock-movement.js';

describe('stock-movement', () => {
  it('chuẩn hoá nguồn phát sinh: trống thành manual, còn lại về chữ thường', () => {
    expect(normalizeMovementSource(undefined)).toBe('manual');
    expect(normalizeMovementSource(null)).toBe('manual');
    expect(normalizeMovementSource('   ')).toBe('manual');
    expect(normalizeMovementSource(' STOCKTAKE ')).toBe('stocktake');
    expect(normalizeMovementSource('crm_sales_order')).toBe('crm_sales_order');
  });

  it('phân trang: mặc định 50, tối đa 200, offset không âm', () => {
    expect(resolveMovementPaging(undefined, undefined)).toEqual({ limit: 50, offset: 0 });
    expect(resolveMovementPaging(20, 40)).toEqual({ limit: 20, offset: 40 });
    expect(resolveMovementPaging(5000, -3)).toEqual({ limit: 200, offset: 0 });
    expect(resolveMovementPaging(Number.NaN, Number.NaN)).toEqual({ limit: 50, offset: 0 });
  });

  it('thoát ký tự đại diện của LIKE', () => {
    expect(likePattern('VT_1%')).toBe('%VT\\_1\\%%');
  });
});
