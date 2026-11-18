import type { DiscountPolicyRule } from '@enterprise-platform/contracts-crm';
import {
  computeMargin,
  priceQuote,
  ratioPrice,
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
const M4 = '66666666-6666-4666-8666-666666666664';
const M5 = '66666666-6666-4666-8666-666666666665';
const M8 = '66666666-6666-4666-8666-666666666668';
const DAY = '2026-12-15';

const standardList: PricingPriceList = {
  id: 'list-standard',
  code: 'BG-CHUAN',
  isStandard: true,
  validFrom: '2026-01-01',
  validTo: null,
  status: 'ACTIVE',
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
    priceListId: 'list-standard',
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

describe('engine giá: thứ tự áp giá (A1, bảng giá chọn thủ công)', () => {
  const chosenList: PricingPriceList = {
    ...standardList,
    id: 'list-dl1',
    code: 'BG-DL1',
    isStandard: false,
    validFrom: '2026-12-01',
    validTo: '2026-12-31',
    items: [
      { materialId: CAP, unit: 'Cái', price: 950_000, vatRate: 8 },
      { materialId: M4, unit: 'Cái', price: null, vatRate: 8 },
      { materialId: M5, unit: 'Cái', price: 0, vatRate: 10 },
      { materialId: M8, unit: 'Kg', price: 99_999.99, vatRate: 10 },
    ],
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
  const chosen = (overrides: Partial<PricingInput> = {}) =>
    input({ priceListId: 'list-dl1', priceLists: [standardList, chosenList], ...overrides });

  it('A1.1: có giá hợp đồng còn hiệu lực thì dùng giá hợp đồng; thuế suất theo dòng bảng đã chọn', () => {
    const [priced] = priceQuote(chosen({ contractPrices: [contractPrice] })).lines;
    expect(priced).toMatchObject({ listPrice: 900_000, priceSource: 'CONTRACT', priceReferenceCode: 'HD-01', vatRate: 8 });
  });

  it('A1.2: hợp đồng hết hiệu lực thì lấy bảng đã chọn', () => {
    const expired = { ...contractPrice, validTo: '2026-12-14' };
    expect(priceQuote(chosen({ contractPrices: [expired] })).lines[0]).toMatchObject({ listPrice: 950_000, priceSource: 'GROUP_LIST' });
  });

  it('A1.3: hợp đồng khác đơn vị thì bỏ qua hợp đồng', () => {
    const boxes = { ...contractPrice, unit: 'Hộp' };
    expect(priceQuote(chosen({ contractPrices: [boxes] })).lines[0]).toMatchObject({ priceSource: 'GROUP_LIST' });
  });

  it('A1.4: không có hợp đồng thì giá bảng đã chọn, nguồn GROUP_LIST, mã tham chiếu là mã bảng', () => {
    expect(priceQuote(chosen()).lines[0]).toMatchObject({
      listPrice: 950_000,
      priceSource: 'GROUP_LIST',
      priceReferenceId: 'list-dl1',
      priceReferenceCode: 'BG-DL1',
      vatRate: 8,
    });
  });

  it('A1.5: đơn vị khác hoa thường, thừa khoảng trắng vẫn khớp', () => {
    expect(priceQuote(chosen({ lines: [{ ...line(1), unit: ' cái ' }] })).lines[0].listPrice).toBe(950_000);
  });

  it('A1.6: bảng đã chọn thiếu mặt hàng thì PRICE_NOT_FOUND, không lấy bảng chuẩn cũ', () => {
    expect(() => priceQuote(chosen({ lines: [line(1, OTHER)] }))).toThrow(
      expect.objectContaining({ code: 'PRICE_NOT_FOUND', statusCode: 400, details: { line: 1 } }),
    );
  });

  it('A1.7: chưa chọn bảng giá thì PRICE_NOT_FOUND cho dòng không ghi đè đơn giá', () => {
    expect(() => priceQuote(chosen({ priceListId: null }))).toThrow(expect.objectContaining({ code: 'PRICE_NOT_FOUND' }));
    const [manual] = priceQuote(chosen({ priceListId: null, lines: [{ ...line(1), override: { unitPrice: 5 } }] })).lines;
    expect(manual).toMatchObject({ priceSource: 'MANUAL', listPrice: 5, vatRate: 10 });
  });

  it('A1.8: bảng đã chọn ngừng áp dụng thì PRICE_NOT_FOUND', () => {
    const inactive = { ...chosenList, status: 'INACTIVE' as const };
    expect(() => priceQuote(chosen({ priceLists: [standardList, inactive] }))).toThrow(
      expect.objectContaining({ code: 'PRICE_NOT_FOUND' }),
    );
  });

  it('A1.9, A1.10: hiệu lực tính trọn ngày; ngoài hiệu lực thì PRICE_NOT_FOUND', () => {
    const at = (date: string) => () => priceQuote(chosen({ date }));
    expect(at('2026-12-01')().lines[0].priceSource).toBe('GROUP_LIST');
    expect(at('2026-12-31')().lines[0].priceSource).toBe('GROUP_LIST');
    expect(at('2026-11-30')).toThrow(expect.objectContaining({ code: 'PRICE_NOT_FOUND' }));
    expect(at('2027-01-01')).toThrow(expect.objectContaining({ code: 'PRICE_NOT_FOUND' }));
  });

  it('A1.11: dòng giá rỗng, không ghi đè: PRICE_NOT_FOUND "chưa nhập giá ở Kho" kèm số dòng', () => {
    expect(() => priceQuote(chosen({ lines: [line(1), { ...line(1, M4), materialCode: 'M4' }] }))).toThrow(
      expect.objectContaining({
        code: 'PRICE_NOT_FOUND',
        message: 'Mặt hàng M4 chưa nhập giá ở Kho; vui lòng nhập đơn giá ghi đè.',
        details: { line: 2 },
      }),
    );
  });

  it('A1.12: dòng giá rỗng, ghi đè đơn giá thì dùng đơn giá ghi đè và thuế suất của dòng (8%)', () => {
    const [priced] = priceQuote(chosen({ lines: [{ ...line(2, M4), override: { unitPrice: 100_000 } }] })).lines;
    expect(priced).toMatchObject({ priceSource: 'MANUAL', listPrice: 100_000, lineAmount: 200_000, vatRate: 8, vatAmount: 16_000 });
  });

  it('A1.13: dòng giá rỗng, chỉ ghi đè phần trăm chiết khấu thì PRICE_NOT_FOUND', () => {
    expect(() => priceQuote(chosen({ lines: [{ ...line(1, M4), override: { discountPercent: 5 } }] }))).toThrow(
      expect.objectContaining({ code: 'PRICE_NOT_FOUND' }),
    );
  });

  it('A1.14: giá 0 hợp lệ, thành tiền 0', () => {
    const [priced] = priceQuote(chosen({ lines: [line(3, M5)], policies: [quantityTiers()] })).lines;
    expect(priced).toMatchObject({ priceSource: 'GROUP_LIST', listPrice: 0, lineAmount: 0, vatAmount: 0 });
  });

  it('A1.15: giá có phần lẻ, số lượng 3 chữ số thập phân làm tròn đến đồng', () => {
    const [priced] = priceQuote(chosen({ lines: [{ ...line(1.234, M8), unit: 'kg' }] })).lines;
    // 99.999,99 × 1,234 = 123.399,98766 → 123.400
    expect(priced).toMatchObject({ listPrice: 99_999.99, grossAmount: 123_400, lineAmount: 123_400 });
  });

  it('A1.18: nhóm khách vẫn khớp chính sách CUSTOMER_GROUP khi bảng giá chọn thủ công', () => {
    expect(priceQuote(chosen({ customerGroupId: VIP, policies: [vip(4)] })).lines[0]).toMatchObject({
      priceSource: 'GROUP_LIST',
      discountPercent: 4,
    });
  });

  it('bảng giá khác bảng đã chọn không áp, dù là bảng chuẩn cũ', () => {
    expect(() => priceQuote(input({ priceListId: 'list-khac' }))).toThrow(expect.objectContaining({ code: 'PRICE_NOT_FOUND' }));
  });
});

describe('ratioPrice (A2)', () => {
  it.each([
    ['A2.1', 12_345, 105, 12_962],
    ['A2.2', 10_001, 95, 9_501],
    ['A2.3', 1_001, 50, 501],
    ['A2.4', 99_999.99, 100, 100_000],
    ['A2.5', 0, 150, 0],
    ['A2.7', 1, 0.01, 0],
    ['A2.8', 3, 33.33, 1],
    ['A2.9', 1_005, 100, 1_005],
    ['A2.9 thập phân', 1.005, 100, 1],
    ['tỷ lệ lẻ', 12_345, 99.5, 12_283],
  ])('%s: %p × %p%% = %p', (_case, base, ratio, expected) => {
    expect(ratioPrice(base, ratio)).toBe(expected);
  });

  it('A2.6: giá rỗng thì rỗng', () => {
    expect(ratioPrice(null, 105)).toBeNull();
  });

  it('A2.10: vượt đơn giá tối đa thì PRICE_OUT_OF_RANGE', () => {
    expect(() => ratioPrice(9_000_000_000_000, 200)).toThrow(
      expect.objectContaining({ code: 'PRICE_OUT_OF_RANGE', message: 'Giá sau tỷ lệ vượt giới hạn.' }),
    );
    expect(ratioPrice(10_000_000_000_000, 100)).toBe(10_000_000_000_000);
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
    const lists: PricingPriceList[] = [
      {
        ...standardList,
        items: rates.map((rate, index) => ({
          materialId: `00000000-0000-4000-8000-00000000000${index}`,
          unit: 'Cái',
          price: 333_333,
          vatRate: rate,
        })),
      },
    ];
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
