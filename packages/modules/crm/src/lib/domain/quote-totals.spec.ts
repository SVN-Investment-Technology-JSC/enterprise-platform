import type { PricingTotals } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';
import { priceQuote, type PricingInput, type PricingPolicy, type PricingPriceList } from './pricing-engine.js';
import { applyQuoteAdjustments, QUOTE_AMOUNT_MAX, sumFees } from './quote-totals.js';

/** Tổng hàng 10.000.000 (đã chiết khấu theo dòng nếu có), VAT dòng 10%. */
const pricing = (overrides: Partial<PricingTotals> = {}): PricingTotals => ({
  grossAmount: 10_000_000,
  discountAmount: 0,
  netAmount: 10_000_000,
  shippingAmount: 0,
  vatAmount: 1_000_000,
  totalAmount: 11_000_000,
  ...overrides,
});

const orderOrder = { discountMode: 'ORDER', taxMode: 'ORDER' } as const;
const lineLine = { discountMode: 'LINE', taxMode: 'LINE' } as const;

describe('quote-totals: chiết khấu, thuế, phí tổng đơn (P2I-03)', () => {
  it('TC-QF-16: mẫu theo dòng, không nhập gì, không phí: trả đúng tổng của engine', () => {
    const base = pricing({ discountAmount: 500_000, netAmount: 9_500_000, vatAmount: 950_000, totalAmount: 10_450_000 });
    const result = applyQuoteAdjustments({ ...lineLine, pricing: base });
    expect(result.totals).toEqual(base);
    expect(result.feesAmount).toBe(0);
    expect(result.orderDiscount).toEqual({ percent: 0, amount: 0, inputKind: null });
  });

  it('TC-QF-06: chiết khấu tổng đơn 5% trên 10.000.000 là 500.000', () => {
    const result = applyQuoteAdjustments({
      ...orderOrder,
      pricing: pricing({ vatAmount: 0, totalAmount: 10_000_000 }),
      orderDiscount: { percent: 5 },
    });
    expect(result.orderDiscount).toEqual({ percent: 5, amount: 500_000, inputKind: 'PERCENT' });
    expect(result.totals.discountAmount).toBe(500_000);
    expect(result.totals.netAmount).toBe(9_500_000);
    expect(result.totals.totalAmount).toBe(9_500_000);
  });

  it('TC-QF-07: nhập số tiền thì phần trăm tính ngược; nhập cả hai là lỗi', () => {
    const base = pricing({ vatAmount: 0, totalAmount: 10_000_000 });
    const byAmount = applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { amount: 500_000 } });
    expect(byAmount.orderDiscount).toEqual({ percent: 5, amount: 500_000, inputKind: 'AMOUNT' });
    const odd = applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { amount: 333_333 } });
    expect(odd.orderDiscount.percent).toBe(3.3333);
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { percent: 5, amount: 500_000 } })).toThrow(
      expect.objectContaining({ code: 'ORDER_AMOUNT_CONFLICT' }),
    );
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderTax: { percent: 8, amount: 1 } })).toThrow(
      expect.objectContaining({ code: 'ORDER_AMOUNT_CONFLICT' }),
    );
  });

  it('chiết khấu tổng đơn không vượt tiền hàng; phần trăm ngoài 0 đến 100 bị từ chối', () => {
    const base = pricing({ vatAmount: 0, totalAmount: 10_000_000 });
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { amount: 10_000_001 } })).toThrow(
      expect.objectContaining({ code: 'DISCOUNT_EXCEEDS_TOTAL' }),
    );
    expect(applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { amount: 10_000_000 } }).totals.netAmount).toBe(0);
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { percent: 100.0001 } })).toThrow(CrmValidationError);
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { percent: -1 } })).toThrow(CrmValidationError);
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { amount: -1 } })).toThrow(CrmValidationError);
  });

  it('TC-QF-08: thuế tổng đơn 8% trên 9.500.000 là 760.000; theo số tiền thì phần trăm tính ngược', () => {
    const base = pricing({ netAmount: 9_500_000, discountAmount: 500_000, vatAmount: 0, totalAmount: 9_500_000 });
    const byPercent = applyQuoteAdjustments({ ...orderOrder, pricing: base, orderTax: { percent: 8 } });
    expect(byPercent.orderTax).toEqual({ percent: 8, amount: 760_000, inputKind: 'PERCENT' });
    expect(byPercent.totals.vatAmount).toBe(760_000);
    expect(byPercent.totals.totalAmount).toBe(10_260_000);
    const byAmount = applyQuoteAdjustments({ ...orderOrder, pricing: base, orderTax: { amount: 760_000 } });
    expect(byAmount.orderTax).toEqual({ percent: 8, amount: 760_000, inputKind: 'AMOUNT' });
    expect(byAmount.totals.totalAmount).toBe(10_260_000);
  });

  it('thuế tổng đơn tính sau chiết khấu tổng đơn, không gồm phí vận chuyển và phí hợp đồng', () => {
    const result = applyQuoteAdjustments({
      ...orderOrder,
      pricing: pricing({ shippingAmount: 200_000, vatAmount: 0, totalAmount: 10_200_000 }),
      orderDiscount: { percent: 5 },
      orderTax: { percent: 8 },
      fees: [{ feeType: 'Lắp đặt', amount: 100_000 }],
    });
    expect(result.totals.vatAmount).toBe(760_000);
    // 9.500.000 + vận chuyển 200.000 + thuế 760.000 + phí 100.000
    expect(result.totals.totalAmount).toBe(10_560_000);
  });

  it('không tính trùng: mẫu theo dòng không nhận chiết khấu hay thuế tổng đơn', () => {
    expect(() => applyQuoteAdjustments({ ...lineLine, pricing: pricing(), orderDiscount: { percent: 5 } })).toThrow(
      expect.objectContaining({ code: 'ORDER_DISCOUNT_NOT_ALLOWED' }),
    );
    expect(() => applyQuoteAdjustments({ ...lineLine, pricing: pricing(), orderTax: { amount: 1 } })).toThrow(
      expect.objectContaining({ code: 'ORDER_TAX_NOT_ALLOWED' }),
    );
    // Rỗng (null, undefined) không phải là nhập.
    expect(applyQuoteAdjustments({ ...lineLine, pricing: pricing(), orderDiscount: { percent: null, amount: null } }).totals).toEqual(pricing());
  });

  it('chiết khấu theo tổng đơn, thuế theo dòng: VAT dòng giảm theo tỷ lệ chiết khấu, VAT phí vận chuyển giữ', () => {
    const result = applyQuoteAdjustments({
      discountMode: 'ORDER',
      taxMode: 'LINE',
      // VAT hàng 1.000.000 + VAT vận chuyển 20.000
      pricing: pricing({ shippingAmount: 200_000, vatAmount: 1_020_000, totalAmount: 11_220_000 }),
      shippingVatAmount: 20_000,
      orderDiscount: { percent: 10 },
    });
    expect(result.totals.netAmount).toBe(9_000_000);
    expect(result.totals.vatAmount).toBe(900_000 + 20_000);
    expect(result.totals.totalAmount).toBe(9_000_000 + 200_000 + 920_000);
  });

  it('TC-QF-09: phí nhiều khoản cộng vào tổng sau thuế, đúng theo thêm, sửa, xoá', () => {
    const base = pricing();
    const none = applyQuoteAdjustments({ ...lineLine, pricing: base });
    const two = applyQuoteAdjustments({
      ...lineLine,
      pricing: base,
      fees: [
        { feeType: 'Vận chuyển', amount: 300_000 },
        { feeType: 'Lắp đặt', amount: 150_000 },
      ],
    });
    expect(two.feesAmount).toBe(450_000);
    expect(two.totals.totalAmount).toBe(none.totals.totalAmount + 450_000);
    const edited = applyQuoteAdjustments({
      ...lineLine,
      pricing: base,
      fees: [
        { feeType: 'Vận chuyển', amount: 350_000 },
        { feeType: 'Lắp đặt', amount: 150_000 },
      ],
    });
    expect(edited.totals.totalAmount).toBe(none.totals.totalAmount + 500_000);
    const removed = applyQuoteAdjustments({ ...lineLine, pricing: base, fees: [{ feeType: 'Lắp đặt', amount: 150_000 }] });
    expect(removed.totals.totalAmount).toBe(none.totals.totalAmount + 150_000);
    // Phí không chịu thuế và không đổi tiền hàng.
    expect(two.totals.vatAmount).toBe(base.vatAmount);
    expect(two.totals.netAmount).toBe(base.netAmount);
    expect(() => sumFees([{ feeType: 'x', amount: -1 }])).toThrow(CrmValidationError);
  });

  it('TC-QF-10: tiền lẻ làm tròn đến đồng, xa số 0', () => {
    const base = pricing({ netAmount: 1_000_001, grossAmount: 1_000_001, vatAmount: 0, totalAmount: 1_000_001 });
    // 1.000.001 x 5% = 50.000,05 -> 50.000; x 7,5% = 75.000,075 -> 75.000
    expect(applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { percent: 5 } }).orderDiscount.amount).toBe(50_000);
    expect(applyQuoteAdjustments({ ...orderOrder, pricing: base, orderTax: { percent: 7.5 } }).orderTax.amount).toBe(75_000);
    // 3 x 0,5% -> 0,015 -> 0 ; 100 x 0,5% = 0,5 -> 1 (xa số 0)
    const small = pricing({ netAmount: 100, grossAmount: 100, vatAmount: 0, totalAmount: 100 });
    expect(applyQuoteAdjustments({ ...orderOrder, pricing: small, orderTax: { percent: 0.5 } }).orderTax.amount).toBe(1);
    // Tiền nhập lẻ đồng: 100,5 -> 101
    expect(applyQuoteAdjustments({ ...orderOrder, pricing: small, orderTax: { amount: 100.5 } }).orderTax.amount).toBe(101);
    expect(sumFees([{ feeType: 'a', amount: 0.5 }, { feeType: 'b', amount: 0.5 }])).toBe(2);
  });

  it('TC-QF-10: số lớn gần giới hạn NUMERIC(18,2) không tràn và không sai số', () => {
    const big = 8_999_999_999_999_990;
    const base = pricing({ grossAmount: big, netAmount: big, vatAmount: 0, totalAmount: big });
    const half = applyQuoteAdjustments({ ...orderOrder, pricing: base, orderDiscount: { percent: 50 } });
    expect(half.orderDiscount.amount).toBe(4_499_999_999_999_995);
    expect(half.totals.netAmount).toBe(4_499_999_999_999_995);
    const taxBase = pricing({ grossAmount: 8e15, netAmount: 8e15, vatAmount: 0, totalAmount: 8e15 });
    const taxed = applyQuoteAdjustments({ ...orderOrder, pricing: taxBase, orderTax: { percent: 0.0001 } });
    expect(taxed.orderTax.amount).toBe(8_000_000_000);
    expect(taxed.totals.totalAmount).toBe(8_000_008_000_000_000);
    // Tổng sau thuế vượt giới hạn bị từ chối, không tràn cột.
    expect(() => applyQuoteAdjustments({ ...orderOrder, pricing: base, orderTax: { percent: 100 } })).toThrow(
      expect.objectContaining({ code: 'AMOUNT_TOO_LARGE' }),
    );
    expect(() => applyQuoteAdjustments({ ...lineLine, pricing: base, fees: [{ feeType: 'x', amount: QUOTE_AMOUNT_MAX }] })).toThrow(
      expect.objectContaining({ code: 'AMOUNT_TOO_LARGE' }),
    );
    expect(() => sumFees([{ feeType: 'x', amount: 1e17 }])).toThrow(expect.objectContaining({ code: 'AMOUNT_TOO_LARGE' }));
  });

  it('tiền hàng bằng 0: phần trăm tính ngược là 0, không chia cho 0', () => {
    const zero = pricing({ grossAmount: 0, netAmount: 0, vatAmount: 0, totalAmount: 0 });
    const result = applyQuoteAdjustments({ ...orderOrder, pricing: zero, orderDiscount: { amount: 0 }, orderTax: { amount: 0 } });
    expect(result.orderDiscount.percent).toBe(0);
    expect(result.totals.totalAmount).toBe(0);
  });
});

describe('engine giá theo chế độ của mẫu (P2I-03)', () => {
  const MATERIAL = '11111111-1111-4111-8111-111111111111';
  const list: PricingPriceList = {
    id: 'l',
    code: 'BG',
    isStandard: true,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'ACTIVE',
    customerGroupIds: [],
    items: [{ materialId: MATERIAL, unit: 'Cái', price: 1_000_000, vatRate: 10 }],
  };
  const policy: PricingPolicy = {
    id: 'p',
    code: 'CK5',
    name: 'Giảm 5%',
    priority: 1,
    stacking: 'STACK',
    exclusive: false,
    percent: 5,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'ACTIVE',
    appliesToAllCustomers: true,
    rules: [],
  };
  const input = (extra: Partial<PricingInput> = {}): PricingInput => ({
    date: '2026-12-15',
    customerId: null,
    customerGroupId: null,
    lines: [{ materialId: MATERIAL, quantity: 10, unit: 'Cái' }],
    priceLists: [list],
    policies: [policy],
    discountCapPercent: 10,
    shipping: { amount: 200_000, vatRate: 10 },
    ...extra,
  });

  it('TC-QF-16: mẫu theo dòng (rõ ràng hay mặc định) cho kết quả y hệt phase 1', () => {
    const phase1 = priceQuote(input());
    expect(priceQuote(input({ discountMode: 'LINE', taxMode: 'LINE' }))).toEqual(phase1);
    expect(phase1.totals.discountAmount).toBe(500_000);
    expect(phase1.totals.vatAmount).toBe(950_000 + 20_000);
    const adjusted = applyQuoteAdjustments({ ...lineLine, pricing: phase1.totals, shippingVatAmount: phase1.shipping?.vatAmount });
    expect(adjusted.totals).toEqual(phase1.totals);
  });

  it('mẫu theo tổng đơn: bỏ chiết khấu và VAT theo dòng (kể cả VAT phí vận chuyển) để áp ở tổng đơn', () => {
    const priced = priceQuote(input({ discountMode: 'ORDER', taxMode: 'ORDER' }));
    expect(priced.lines[0].discountPercent).toBe(0);
    expect(priced.lines[0].appliedPolicies).toEqual([]);
    expect(priced.lines[0].vatRate).toBe(0);
    expect(priced.totals).toMatchObject({ grossAmount: 10_000_000, discountAmount: 0, netAmount: 10_000_000, vatAmount: 0, totalAmount: 10_200_000 });
    const adjusted = applyQuoteAdjustments({
      ...orderOrder,
      pricing: priced.totals,
      orderDiscount: { percent: 5 },
      orderTax: { percent: 10 },
    });
    // 10.000.000 - 5% = 9.500.000; thuế 10% = 950.000; + vận chuyển 200.000 (không VAT)
    expect(adjusted.totals.totalAmount).toBe(9_500_000 + 950_000 + 200_000);
  });

  it('mẫu theo tổng đơn không cho ghi đè phần trăm chiết khấu theo dòng; ghi đè đơn giá vẫn được', () => {
    expect(() =>
      priceQuote(
        input({ discountMode: 'ORDER', lines: [{ materialId: MATERIAL, quantity: 1, unit: 'Cái', override: { discountPercent: 3 } }] }),
      ),
    ).toThrow(expect.objectContaining({ code: 'LINE_DISCOUNT_NOT_ALLOWED' }));
    const priced = priceQuote(
      input({ discountMode: 'ORDER', lines: [{ materialId: MATERIAL, quantity: 1, unit: 'Cái', override: { unitPrice: 900_000 } }] }),
    );
    expect(priced.lines[0].lineAmount).toBe(900_000);
  });
});
