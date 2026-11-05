import type { DiscountPolicyRule } from '@enterprise-platform/contracts-crm';
import {
  computeMargin,
  priceQuote,
  roundVnd,
  type PricingInput,
  type PricingPolicy,
  type PricingPriceList,
} from './pricing-engine.js';

/**
 * Bảng giá trị biên của engine giá theo TC-PRC trong `docs/crm/TEST.md` (dữ
 * liệu seed mục 1.3: `QA-KHO-CAP` giá chuẩn 1.000.000 đồng, VAT 10%; bậc 1–9
 * giảm 2%, 10–49 giảm 5%, từ 50 giảm 8%; trần tổng 10%).
 */
const CAP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const VIP = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const DAY = '2026-12-15';

const standardList: PricingPriceList = {
  id: 'list-standard',
  code: 'BG-CHUAN',
  isStandard: true,
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
  customerGroupIds: [],
  items: [
    { materialId: CAP, unit: 'Cái', price: 1_000_000, vatRate: 10 },
    { materialId: OTHER, unit: 'Cái', price: 500_000, vatRate: 10 },
  ],
};

function policy(overrides: Partial<PricingPolicy> & Pick<PricingPolicy, 'code'>): PricingPolicy {
  return {
    id: `policy-${overrides.code}`,
    name: overrides.code,
    priority: 100,
    stacking: 'STACK',
    exclusive: false,
    percent: null,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'ACTIVE',
    appliesToAllCustomers: true,
    rules: [],
    ...overrides,
  };
}

const tier = (minQty: number, maxQty: number | null, percent: number): DiscountPolicyRule => ({
  criterion: 'QUANTITY',
  minQty,
  maxQty,
  percent,
});

const quantityTiers = (stacking: 'STACK' | 'MAX' = 'STACK') =>
  policy({ code: 'BAC-SL', stacking, priority: 10, rules: [tier(1, 9, 2), tier(10, 49, 5), tier(50, null, 8)] });

const vip = (percent: number, stacking: 'STACK' | 'MAX' = 'STACK') =>
  policy({
    code: 'VIP',
    stacking,
    priority: 20,
    percent,
    appliesToAllCustomers: false,
    rules: [{ criterion: 'CUSTOMER_GROUP', refId: VIP }],
  });

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    date: DAY,
    customerId: CUSTOMER,
    customerGroupId: null,
    lines: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', quantity: 1, unit: 'Cái' }],
    priceLists: [standardList],
    policies: [],
    discountCapPercent: 10,
    ...overrides,
  };
}

const line = (quantity: number, materialId = CAP) => ({ materialId, materialCode: 'QA-KHO-CAP', quantity, unit: 'Cái' });

describe('roundVnd', () => {
  it.each([
    [949_999.05, 949_999],
    [0.5, 1],
    [1.5, 2],
    [2.5, 3],
    [-0.5, -1],
    [-2.5, -3],
    [1.4999, 1],
    [100.49999, 100],
    [0, 0],
  ])('%p thành %p (xa số 0)', (value, expected) => {
    expect(roundVnd(value)).toBe(expected);
  });
});

describe('engine giá: thứ tự áp giá', () => {
  const groupList: PricingPriceList = {
    ...standardList,
    id: 'list-dl1',
    code: 'BG-DL1',
    isStandard: false,
    customerGroupIds: [VIP],
    items: [{ materialId: CAP, unit: 'Cái', price: 950_000, vatRate: 10 }],
  };
  const contractPrice = {
    contractId: 'contract-1',
    contractCode: 'HD-01',
    materialId: CAP,
    unit: 'Cái',
    price: 900_000,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  };

  it('TC-PRC-03: có giá hợp đồng thì dùng giá hợp đồng', () => {
    const [priced] = priceQuote(
      input({ customerGroupId: VIP, priceLists: [standardList, groupList], contractPrices: [contractPrice] }),
    ).lines;
    expect(priced).toMatchObject({ listPrice: 900_000, priceSource: 'CONTRACT', priceReferenceCode: 'HD-01', vatRate: 10 });
  });

  it('TC-PRC-04: không có giá hợp đồng thì dùng bảng giá nhóm', () => {
    const [priced] = priceQuote(input({ customerGroupId: VIP, priceLists: [standardList, groupList] })).lines;
    expect(priced).toMatchObject({ listPrice: 950_000, priceSource: 'GROUP_LIST', priceReferenceCode: 'BG-DL1' });
  });

  it('TC-PRC-05: khách không thuộc nhóm có bảng giá thì dùng bảng giá chuẩn', () => {
    const [priced] = priceQuote(input({ customerGroupId: PROJECT, priceLists: [standardList, groupList] })).lines;
    expect(priced).toMatchObject({ listPrice: 1_000_000, priceSource: 'STANDARD_LIST', priceReferenceCode: 'BG-CHUAN' });
  });

  it('TC-PRC-06: giá hợp đồng đã hết hạn hôm qua thì không dùng', () => {
    const expired = { ...contractPrice, validTo: '2026-12-14' };
    const withGroup = priceQuote(
      input({ customerGroupId: VIP, priceLists: [standardList, groupList], contractPrices: [expired] }),
    ).lines[0];
    expect(withGroup).toMatchObject({ listPrice: 950_000, priceSource: 'GROUP_LIST' });
    const withoutGroup = priceQuote(input({ priceLists: [standardList], contractPrices: [expired] })).lines[0];
    expect(withoutGroup).toMatchObject({ listPrice: 1_000_000, priceSource: 'STANDARD_LIST' });
  });

  it('TC-PRC-01: bảng nhóm 01/12–31/12 áp ngày 31/12, sang 01/01 rơi về bảng chuẩn', () => {
    const december = { ...groupList, validFrom: '2026-12-01', validTo: '2026-12-31' };
    const at = (date: string) =>
      priceQuote(input({ date, customerGroupId: VIP, priceLists: [standardList, december] })).lines[0].priceSource;
    expect(at('2026-12-31')).toBe('GROUP_LIST');
    expect(at('2027-01-01')).toBe('STANDARD_LIST');
  });

  it('bảng giá ngừng áp dụng hoặc khác đơn vị tính thì bỏ qua', () => {
    const inactive = { ...groupList, status: 'INACTIVE' as const };
    expect(priceQuote(input({ customerGroupId: VIP, priceLists: [standardList, inactive] })).lines[0].priceSource).toBe(
      'STANDARD_LIST',
    );
    expect(() => priceQuote(input({ lines: [{ ...line(1), unit: 'Thùng' }] }))).toThrow(
      expect.objectContaining({ code: 'PRICE_NOT_FOUND', statusCode: 400 }),
    );
  });

  it('đơn vị tính so không phân biệt hoa thường', () => {
    expect(priceQuote(input({ lines: [{ ...line(1), unit: ' cái ' }] })).lines[0].listPrice).toBe(1_000_000);
  });
});

describe('engine giá: bậc số lượng (TC-PRC-07..11)', () => {
  it.each([
    ['TC-PRC-07', 9, 2, 8_820_000],
    ['TC-PRC-08', 10, 5, 9_500_000],
    ['TC-PRC-09', 49, 5, 46_550_000],
    ['TC-PRC-10', 50, 8, 46_000_000],
    ['bậc 1', 1, 2, 980_000],
  ])('%s: %p cái giảm %p%%, thành tiền trước VAT %p', (_case, quantity, percent, amount) => {
    const [priced] = priceQuote(input({ lines: [line(quantity)], policies: [quantityTiers()] })).lines;
    expect(priced.discountPercent).toBe(percent);
    expect(priced.lineAmount).toBe(amount);
    expect(priced.appliedPolicies).toEqual([expect.objectContaining({ code: 'BAC-SL', percent })]);
  });

  it.each([0, -1])('TC-PRC-11: số lượng %p trả 400 "Số lượng phải lớn hơn 0"', (quantity) => {
    expect(() => priceQuote(input({ lines: [line(quantity)], policies: [quantityTiers()] }))).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_QUANTITY', message: 'Số lượng phải lớn hơn 0.' }),
    );
  });

  it('số lượng nằm giữa hai bậc (9,5) thì không khớp bậc nào', () => {
    const [priced] = priceQuote(input({ lines: [line(9.5)], policies: [quantityTiers()] })).lines;
    expect(priced).toMatchObject({ discountPercent: 0, appliedPolicies: [], lineAmount: 9_500_000 });
  });
});

describe('engine giá: tiêu chí chính sách (TC-PRC-12..14)', () => {
  const december = policy({ code: 'T12', percent: 3, rules: [{ criterion: 'PERIOD', fromDate: '2026-12-01', toDate: '2026-12-31' }] });

  it('TC-PRC-12: chương trình tháng 12 giảm 3% áp ngày 31/12, không áp ngày 01/01', () => {
    const at = (date: string) => priceQuote(input({ date, policies: [december] })).lines[0].discountPercent;
    expect(at('2026-12-31')).toBe(3);
    expect(at('2027-01-01')).toBe(0);
  });

  it('hiệu lực của chính sách cũng tính trọn ngày cuối', () => {
    const limited = policy({ code: 'HL', percent: 3, validFrom: '2026-12-01', validTo: '2026-12-31' });
    expect(priceQuote(input({ date: '2026-12-31', policies: [limited] })).lines[0].discountPercent).toBe(3);
    expect(priceQuote(input({ date: '2027-01-01', policies: [limited] })).lines[0].discountPercent).toBe(0);
  });

  it('TC-PRC-13: nhóm VIP giảm 4% chỉ áp cho khách VIP', () => {
    const vipPolicy = vip(4);
    expect(priceQuote(input({ customerGroupId: VIP, policies: [vipPolicy] })).lines[0].discountPercent).toBe(4);
    expect(priceQuote(input({ customerGroupId: PROJECT, policies: [vipPolicy] })).lines[0].discountPercent).toBe(0);
    expect(priceQuote(input({ customerGroupId: null, policies: [vipPolicy] })).lines[0].discountPercent).toBe(0);
  });

  it('chính sách theo khách hàng cụ thể', () => {
    const own = policy({ code: 'KH', percent: 1.5, appliesToAllCustomers: false, rules: [{ criterion: 'CUSTOMER', refId: CUSTOMER }] });
    expect(priceQuote(input({ policies: [own] })).lines[0].discountPercent).toBe(1.5);
    expect(priceQuote(input({ customerId: null, policies: [own] })).lines[0].discountPercent).toBe(0);
  });

  it('TC-PRC-14: nhóm hàng "Thiết bị" giảm 2% chỉ áp dòng Thiết bị', () => {
    const devices = policy({ code: 'TB', percent: 2, rules: [{ criterion: 'MATERIAL_CATEGORY', refText: 'Thiết bị' }] });
    const result = priceQuote(
      input({
        policies: [devices],
        lines: [
          { ...line(1), category: 'thiết bị' },
          { ...line(1, OTHER), category: 'Vật tư' },
        ],
      }),
    );
    expect(result.lines.map((priced) => priced.discountPercent)).toEqual([2, 0]);
  });

  it('chính sách theo mặt hàng', () => {
    const one = policy({ code: 'MH', percent: 2, rules: [{ criterion: 'MATERIAL', refId: OTHER }] });
    const result = priceQuote(input({ policies: [one], lines: [line(1), line(1, OTHER)] }));
    expect(result.lines.map((priced) => priced.discountPercent)).toEqual([0, 2]);
  });

  it('khác chiều tiêu chí kết hợp AND, cùng chiều OR', () => {
    const combined = policy({
      code: 'AND',
      percent: 2,
      appliesToAllCustomers: false,
      rules: [
        { criterion: 'CUSTOMER_GROUP', refId: VIP },
        { criterion: 'CUSTOMER_GROUP', refId: PROJECT },
        { criterion: 'MATERIAL', refId: CAP },
      ],
    });
    const percent = (groupId: string, materialId: string) =>
      priceQuote(input({ customerGroupId: groupId, policies: [combined], lines: [line(1, materialId)] })).lines[0]
        .discountPercent;
    expect(percent(VIP, CAP)).toBe(2);
    expect(percent(PROJECT, CAP)).toBe(2);
    expect(percent(VIP, OTHER)).toBe(0);
  });

  it('chính sách ngừng áp dụng thì bỏ qua', () => {
    const off = policy({ code: 'OFF', percent: 5, status: 'INACTIVE' });
    expect(priceQuote(input({ policies: [off] })).lines[0].discountPercent).toBe(0);
  });
});

describe('engine giá: cộng dồn, lấy cao nhất, trần, độc quyền (TC-PRC-15..18)', () => {
  it('TC-PRC-15: bậc 5% + VIP 3% cộng dồn, trần 10% thì tổng 8% trên giá gốc', () => {
    const [priced] = priceQuote(
      input({ customerGroupId: VIP, lines: [line(10)], policies: [quantityTiers(), vip(3)] }),
    ).lines;
    expect(priced).toMatchObject({
      listPrice: 1_000_000,
      discountPercent: 8,
      cappedAt: null,
      unitPriceAfterDiscount: 920_000,
      grossAmount: 10_000_000,
      discountAmount: 800_000,
      lineAmount: 9_200_000,
      vatAmount: 920_000,
      lineTotal: 10_120_000,
    });
    expect(priced.appliedPolicies.map((applied) => [applied.code, applied.percent])).toEqual([
      ['BAC-SL', 5],
      ['VIP', 3],
    ]);
  });

  it('TC-PRC-16: bậc 5% và VIP 3% cùng nhóm lấy cao nhất thì chỉ áp 5%', () => {
    const [priced] = priceQuote(
      input({ customerGroupId: VIP, lines: [line(10)], policies: [quantityTiers('MAX'), vip(3, 'MAX')] }),
    ).lines;
    expect(priced.discountPercent).toBe(5);
    expect(priced.appliedPolicies.map((applied) => applied.code)).toEqual(['BAC-SL']);
  });

  it('STACK cộng với mức cao nhất của nhóm MAX', () => {
    const extra = policy({ code: 'MAX2', stacking: 'MAX', percent: 1 });
    const [priced] = priceQuote(
      input({ customerGroupId: VIP, lines: [line(10)], policies: [quantityTiers(), vip(3, 'MAX'), extra] }),
    ).lines;
    expect(priced.discountPercent).toBe(8);
    expect(priced.appliedPolicies.map((applied) => applied.code)).toEqual(['BAC-SL', 'VIP']);
  });

  it('TC-PRC-17: bậc 8% + VIP 4% cộng dồn bị cắt còn 10%, ghi chạm trần', () => {
    const [priced] = priceQuote(
      input({ customerGroupId: VIP, lines: [line(50)], policies: [quantityTiers(), vip(4)] }),
    ).lines;
    expect(priced).toMatchObject({
      discountPercent: 10,
      policyPercent: 10,
      cappedAt: 10,
      lineAmount: 45_000_000,
      vatAmount: 4_500_000,
      lineTotal: 49_500_000,
    });
    expect(priced.appliedPolicies.map((applied) => applied.percent)).toEqual([8, 4]);
  });

  it('tổng bằng đúng trần thì không ghi chạm trần', () => {
    const [priced] = priceQuote(input({ customerGroupId: VIP, lines: [line(50)], policies: [quantityTiers(), vip(2)] })).lines;
    expect(priced).toMatchObject({ discountPercent: 10, cappedAt: null });
  });

  it('TC-PRC-18: chính sách dự án ưu tiên 1, độc quyền, 6% loại bậc 8%', () => {
    const project = policy({
      code: 'DU-AN',
      priority: 1,
      exclusive: true,
      percent: 6,
      appliesToAllCustomers: false,
      rules: [{ criterion: 'CUSTOMER_GROUP', refId: PROJECT }],
    });
    const [priced] = priceQuote(
      input({ customerGroupId: PROJECT, lines: [line(50)], policies: [quantityTiers(), project] }),
    ).lines;
    expect(priced.discountPercent).toBe(6);
    expect(priced.appliedPolicies).toEqual([expect.objectContaining({ code: 'DU-AN', exclusive: true, percent: 6 })]);
    expect(priced.lineAmount).toBe(47_000_000);
  });

  it('hai chính sách độc quyền: chỉ chính sách ưu tiên cao nhất (số nhỏ) được áp', () => {
    const first = policy({ code: 'A', priority: 5, exclusive: true, percent: 3 });
    const second = policy({ code: 'B', priority: 2, exclusive: true, percent: 1 });
    const [priced] = priceQuote(input({ policies: [first, second] })).lines;
    expect(priced.appliedPolicies.map((applied) => applied.code)).toEqual(['B']);
    expect(priced.discountPercent).toBe(1);
  });

  it('cộng phần trăm chính xác, không sai số nhị phân (0,1 + 0,2)', () => {
    const a = policy({ code: 'A', percent: 0.1 });
    const b = policy({ code: 'B', percent: 0.2 });
    expect(priceQuote(input({ policies: [a, b] })).lines[0].discountPercent).toBe(0.3);
  });
});

describe('engine giá: làm tròn và VAT (TC-PRC-21, 22)', () => {
  const list = (price: number, vatRate = 10): PricingPriceList => ({
    ...standardList,
    items: [{ materialId: CAP, unit: 'Cái', price, vatRate }],
  });

  it('TC-PRC-21: 333.333 × 3 giảm 5% = 949.999,05 làm tròn thành 949.999 đồng', () => {
    const fivePercent = policy({ code: 'CK5', percent: 5 });
    const result = priceQuote(input({ priceLists: [list(333_333)], lines: [line(3)], policies: [fivePercent] }));
    expect(result.lines[0]).toMatchObject({
      grossAmount: 999_999,
      lineAmount: 949_999,
      discountAmount: 50_000,
      unitPriceAfterDiscount: 316_666.35,
    });
  });

  it('tổng bằng cộng các dòng đã làm tròn', () => {
    const fivePercent = policy({ code: 'CK5', percent: 5 });
    const result = priceQuote(
      input({ priceLists: [list(333_333)], lines: [line(3), line(3), line(3)], policies: [fivePercent] }),
    );
    expect(result.lines.map((priced) => priced.lineAmount)).toEqual([949_999, 949_999, 949_999]);
    expect(result.totals.netAmount).toBe(2_849_997);
    expect(result.lines.map((priced) => priced.vatAmount)).toEqual([95_000, 95_000, 95_000]);
    expect(result.totals.vatAmount).toBe(285_000);
    expect(result.totals.totalAmount).toBe(2_849_997 + 285_000);
  });

  it('0,5 đồng làm tròn lên (xa số 0)', () => {
    const result = priceQuote(input({ priceLists: [list(0.5)], lines: [line(1)] }));
    expect(result.lines[0].lineAmount).toBe(1);
  });

  it('TC-PRC-22: VAT 0/5/8/10% tính trên thành tiền sau chiết khấu, làm tròn từng dòng', () => {
    const rates = [0, 5, 8, 10];
    const lists: PricingPriceList[] = rates.map((rate, index) => ({
      ...standardList,
      id: `list-${rate}`,
      code: `BG-${rate}`,
      validFrom: `2026-0${index + 1}-01`,
      items: [{ materialId: `00000000-0000-4000-8000-00000000000${index}`, unit: 'Cái', price: 333_333, vatRate: rate }],
    }));
    const fivePercent = policy({ code: 'CK5', percent: 5 });
    const result = priceQuote(
      input({
        priceLists: lists,
        policies: [fivePercent],
        lines: rates.map((_rate, index) => line(3, `00000000-0000-4000-8000-00000000000${index}`)),
      }),
    );
    // 949.999 × 0%, 5% (47.499,95), 8% (75.999,92), 10% (94.999,9)
    expect(result.lines.map((priced) => [priced.vatRate, priced.vatAmount])).toEqual([
      [0, 0],
      [5, 47_500],
      [8, 76_000],
      [10, 95_000],
    ]);
    expect(result.totals.vatAmount).toBe(0 + 47_500 + 76_000 + 95_000);
    expect(result.totals.netAmount).toBe(949_999 * 4);
  });

  it('phí vận chuyển là dòng dịch vụ riêng, thuế suất mặc định 10%, không chiết khấu', () => {
    const result = priceQuote(
      input({ lines: [line(10)], policies: [quantityTiers()], shipping: { amount: 150_000 } }),
    );
    expect(result.shipping).toEqual({ amount: 150_000, vatRate: 10, vatAmount: 15_000, total: 165_000 });
    expect(result.totals).toEqual({
      grossAmount: 10_000_000,
      discountAmount: 500_000,
      netAmount: 9_500_000,
      shippingAmount: 150_000,
      vatAmount: 950_000 + 15_000,
      totalAmount: 9_500_000 + 150_000 + 965_000,
    });
    const zeroRated = priceQuote(input({ shipping: { amount: 100_000, vatRate: 0 } }));
    expect(zeroRated.shipping).toEqual({ amount: 100_000, vatRate: 0, vatAmount: 0, total: 100_000 });
  });
});

describe('engine giá: ghi đè (PRC-04)', () => {
  it('ghi đè đơn giá 900.000 ứng với chiết khấu thực 10%, dòng đánh dấu ghi đè', () => {
    const [priced] = priceQuote(
      input({ lines: [{ ...line(10), override: { unitPrice: 900_000 } }], policies: [quantityTiers()] }),
    ).lines;
    expect(priced).toMatchObject({
      overridden: true,
      listPrice: 1_000_000,
      policyPercent: 5,
      discountPercent: 10,
      unitPriceAfterDiscount: 900_000,
      lineAmount: 9_000_000,
      discountAmount: 1_000_000,
    });
  });

  it('ghi đè phần trăm thay cho chính sách, không cắt trần', () => {
    const [priced] = priceQuote(
      input({ lines: [{ ...line(10), override: { discountPercent: 12 } }], policies: [quantityTiers()] }),
    ).lines;
    expect(priced).toMatchObject({ overridden: true, policyPercent: 5, discountPercent: 12, lineAmount: 8_800_000 });
  });

  it('chưa có giá nhưng ghi đè đơn giá thì dùng giá nhập tay', () => {
    const [priced] = priceQuote(
      input({ priceLists: [], lines: [{ ...line(2), override: { unitPrice: 250_000 } }] }),
    ).lines;
    expect(priced).toMatchObject({ priceSource: 'MANUAL', listPrice: 250_000, lineAmount: 500_000, vatRate: 10 });
  });

  it('ghi đè cả đơn giá và phần trăm trả 400', () => {
    expect(() =>
      priceQuote(input({ lines: [{ ...line(1), override: { unitPrice: 1, discountPercent: 1 } }] })),
    ).toThrow(expect.objectContaining({ code: 'OVERRIDE_CONFLICT', statusCode: 400 }));
  });

  it('không có giá và không ghi đè trả 400 kèm số dòng', () => {
    expect(() => priceQuote(input({ priceLists: [] }))).toThrow(
      expect.objectContaining({ code: 'PRICE_NOT_FOUND', details: { line: 1 } }),
    );
  });
});

describe('computeMargin (TC-PRC-23)', () => {
  it('dòng 10 cái, sau CK 950.000, giá vốn 800.000: biên 15,79%', () => {
    expect(computeMargin(9_500_000, 8_000_000)).toBe(15.79);
  });

  it('doanh thu 0 (dòng tặng) trả null, không lỗi chia 0', () => {
    expect(computeMargin(0, 800_000)).toBeNull();
    expect(computeMargin(0, 0)).toBeNull();
  });

  it.each([
    [1_000_000, 900_000, 10],
    [1_000_000, 900_100, 9.99],
    [1_000_000, 1_200_000, -20],
    [3, 2, 33.33],
  ])('doanh thu %p, giá vốn %p: biên %p%%', (revenue, cost, margin) => {
    expect(computeMargin(revenue, cost)).toBe(margin);
  });
});
