import { PROCEDURE_HOST_ATTRIBUTES, groupHostAttributesByKind, hostAttributeSourceLabel, lookupHostAttribute } from '@enterprise-platform/contracts-procedure-engine';

describe('procedure-host-attributes', () => {
  it('tra mã không phân biệt hoa thường', () => {
    expect(lookupHostAttribute(' So_Ngay_Nghi ')?.fieldLabel).toBe('số ngày nghỉ');
  });
  it('mã lạ hoặc rỗng trả undefined', () => {
    expect(lookupHostAttribute('gia_tri_bao_gia')).toBeUndefined();
    expect(lookupHostAttribute('')).toBeUndefined();
    expect(lookupHostAttribute(undefined)).toBeUndefined();
    expect(hostAttributeSourceLabel('khac')).toBeUndefined();
  });
  it('tạo nhãn nguồn', () => {
    expect(hostAttributeSourceLabel('so_tien')).toBe('Lấy từ đơn HRM: số tiền');
  });
  it('mã không trùng và đủ 21 mã', () => {
    expect(new Set(PROCEDURE_HOST_ATTRIBUTES.map((i) => i.code)).size).toBe(PROCEDURE_HOST_ATTRIBUTES.length);
    expect(PROCEDURE_HOST_ATTRIBUTES).toHaveLength(21);
  });
  it('gom nhóm theo loại đơn', () => {
    const groups = groupHostAttributesByKind();
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(PROCEDURE_HOST_ATTRIBUTES.length);
    expect(groups[0].kind).toBe('leave');
  });
});
