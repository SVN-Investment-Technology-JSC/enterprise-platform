import {
  buildPriceListItems,
  newPriceRow,
  formatPercent,
  parseNumber,
  parsePastedItems,
  policyConditionLabel,
  policyPercentLabel,
  priceListScopeLabel,
  validityLabel,
  buildPricingSheet,
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
    expect(priceListScopeLabel({ isStandard: true, customerCount: 0 })).toBe('Khách chưa chọn bảng giá');
    expect(priceListScopeLabel({ isStandard: false, customerCount: 3 })).toBe('3 khách hàng');
    expect(priceListScopeLabel({ isStandard: false, customerCount: 0 })).toBe('Chưa khách nào chọn');
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

describe('buildPricingSheet', () => {
  it('xuất tiêu đề, dòng hàng dạng số và phần tổng', () => {
    const rows = buildPricingSheet({
      date: '2026-11-04',
      customerId: null,
      customerGroupId: null,
      discountCapPercent: 10,
      lines: [
        {
          index: 0,
          materialId: 'm1',
          materialCode: 'CAP',
          materialName: 'Cáp',
          category: null,
          unit: 'Cái',
          quantity: 2,
          listPrice: 1000,
          priceSource: 'PRICE_LIST',
          priceReferenceId: null,
          priceReferenceCode: 'BG1',
          appliedPolicies: [{ policyId: 'p', code: 'CS', percent: 5, exclusive: false }],
          policyPercent: 5,
          discountPercent: 5,
          cappedAt: null,
          overridden: false,
          unitPriceAfterDiscount: 950,
          grossAmount: 2000,
          discountAmount: 100,
          lineAmount: 1900,
          vatRate: 10,
          vatAmount: 190,
          lineTotal: 2090,
        },
      ],
      shipping: null,
      totals: { grossAmount: 2000, discountAmount: 100, netAmount: 1900, vatAmount: 190, totalAmount: 2090 },
    } as never);
    expect(rows[1]).toEqual(['Ngày tính giá', '04/11/2026']);
    expect(rows[4]?.[5]).toBe('Giá trước chiết khấu (giá gốc)');
    expect(rows[5]).toEqual([1, 'CAP', 'Cáp', 'Cái', 2, 1000, expect.stringContaining('BG1'), 'CS: 5%', 5, '', 950, 1900, 10, 190, 2090]);
    expect(rows.at(-1)).toEqual(['Tổng cộng', 2090]);
  });
});

describe('buildPriceListItems', () => {
  const material = (id: string, unit: string | null = 'Cái') => ({ id, code: `M-${id}`, name: `Hàng ${id}`, unit });
  const row = (id: string, price: string, vat = '10', unit: string | null = 'Cái') => ({ ...newPriceRow(material(id, unit)), price, vat });

  it('mỗi mặt hàng một dòng, đơn giá và thuế nhập số thập phân kiểu Việt Nam', () => {
    const built = buildPriceListItems([row('a', '1.250.000,5', '7,5'), row('b', '99.9', '0')]);
    expect(built).toEqual({
      ok: true,
      items: [
        { materialId: 'a', materialCode: 'M-a', materialName: 'Hàng a', unit: 'Cái', price: 1250000.5, vatRate: 7.5 },
        { materialId: 'b', materialCode: 'M-b', materialName: 'Hàng b', unit: 'Cái', price: 99.9, vatRate: 0 },
      ],
    });
  });

  it('đơn vị lấy theo Kho, đơn giá điền sẵn giá bán đề xuất, thuế suất để trống', () => {
    expect(newPriceRow(material('a', ' Hộp '))).toMatchObject({ unit: 'Hộp', vat: '', price: '' });
    expect(newPriceRow({ ...material('b'), salePrice: 500000 })).toMatchObject({ price: '500000', vat: '' });
    expect(newPriceRow({ ...material('c'), salePrice: null })).toMatchObject({ price: '' });
  });

  it('thuế suất bỏ trống thì báo lỗi, không tự lấy 10', () => {
    const built = buildPriceListItems([{ ...newPriceRow(material('a')), price: '1000' }]);
    expect(built).toMatchObject({ ok: false, invalidIds: ['a'] });
  });

  it('chặn đơn giá trống, âm, không phải số; chỉ ra mặt hàng lỗi', () => {
    for (const price of ['', '-5', 'abc']) {
      const built = buildPriceListItems([row('a', '1000'), row('b', price)]);
      expect(built).toMatchObject({ ok: false, invalidIds: ['b'] });
    }
  });

  it('chặn thuế ngoài 0..100 và đơn vị trống khi Kho chưa có đơn vị', () => {
    expect(buildPriceListItems([row('a', '1', '101')])).toMatchObject({ ok: false, invalidIds: ['a'] });
    expect(buildPriceListItems([row('a', '1', '-1')])).toMatchObject({ ok: false, invalidIds: ['a'] });
    expect(buildPriceListItems([row('a', '1', '10', null)])).toMatchObject({ ok: false, invalidIds: ['a'] });
    expect(buildPriceListItems([{ ...row('a', '1', '10', null), unit: 'Bộ' }])).toMatchObject({ ok: true });
  });

  it('không có dòng nào thì báo chọn mặt hàng', () => {
    expect(buildPriceListItems([])).toMatchObject({ ok: false, error: 'Vui lòng chọn ít nhất một mặt hàng.' });
  });
});
