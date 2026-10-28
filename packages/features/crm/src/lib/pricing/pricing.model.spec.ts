import {
  formatPercent,
  parseNumber,
  parsePastedItems,
  policyConditionLabel,
  policyPercentLabel,
  priceListScopeLabel,
  validityLabel,
} from './pricing.model';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseNumber', () => {
  it.each([
    ['1.000.000', 1_000_000],
    ['1,000,000', 1_000_000],
    ['1000000', 1_000_000],
    ['250000,5', 250_000.5],
    ['250000.5', 250_000.5],
    ['1.234.567,89', 1_234_567.89],
    [' 10 % ', 10],
    ['', undefined],
    ['abc', undefined],
  ])('%p thành %p', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parsePastedItems', () => {
  it('đọc dòng Tab, bỏ dòng tiêu đề, thuế suất mặc định 10', () => {
    const text = [
      'Id\tMã\tTên\tĐVT\tĐơn giá\tVAT',
      `${ID}\tQA-KHO-CAP\tCáp đồng\tCái\t1.000.000\t8`,
      `${ID.toUpperCase()};QA-KHO-CAP;Cáp đồng;Thùng;12.000.000`,
    ].join('\n');
    expect(parsePastedItems(text)).toEqual({
      items: [
        { materialId: ID, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 8 },
        { materialId: ID, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Thùng', price: 12_000_000, vatRate: 10 },
      ],
      errors: [],
    });
  });

  it('báo lỗi theo số dòng', () => {
    const text = [`${ID}\tA\tB\tCái\t-5`, 'không phải id\tA', `${ID}\tA\t\tCái\t1`, `${ID}\tA\tB\tCái\t1\t120`].join('\n');
    expect(parsePastedItems(text).errors).toEqual([
      'Dòng 1: đơn giá không hợp lệ.',
      'Dòng 2: cột đầu phải là id mặt hàng.',
      'Dòng 3: thiếu mã, tên hoặc đơn vị tính.',
      'Dòng 4: thuế suất không hợp lệ.',
    ]);
  });
});

describe('nhãn', () => {
  it('hiệu lực, phạm vi bảng giá, phần trăm', () => {
    expect(validityLabel('2026-12-01', '2026-12-31')).toBe('01/12/2026 – 31/12/2026');
    expect(validityLabel('2026-12-01', null)).toBe('Từ 01/12/2026');
    expect(priceListScopeLabel({ isStandard: true, customerGroups: [] })).toBe('Bảng giá chuẩn (mọi khách)');
    expect(priceListScopeLabel({ isStandard: false, customerGroups: [{ id: ID, code: 'VIP', name: 'Khách VIP' }] })).toBe(
      'Khách VIP',
    );
    expect(formatPercent(2.5)).toBe('2,5%');
  });

  it('chính sách bậc và điều kiện', () => {
    const tiers = {
      percent: null,
      appliesToAllCustomers: true,
      rules: [
        { criterion: 'QUANTITY' as const, minQty: 1, maxQty: 9, percent: 2 },
        { criterion: 'QUANTITY' as const, minQty: 50, maxQty: null, percent: 8 },
        { criterion: 'MATERIAL_CATEGORY' as const, refText: 'Thiết bị' },
      ],
    };
    expect(policyPercentLabel(tiers)).toBe('1–9: 2%; từ 50: 8%');
    expect(policyConditionLabel(tiers)).toBe('Mọi khách hàng · Nhóm hàng: Thiết bị');
  });
});
