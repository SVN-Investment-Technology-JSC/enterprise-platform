import { assertPaymentTermsBalanced, normalizePaymentTerms, PAYMENT_TERMS_TOTAL_MESSAGE } from './payment-terms.js';

const VALUE = 100_000_000;

describe('đợt thanh toán (T4-03)', () => {
  it('TC-CON-04: 30%, 50%, 20% của 100 triệu thành 30/50/20 triệu', () => {
    const terms = normalizePaymentTerms(
      [
        { name: 'Ký hợp đồng', percent: 30, condition: 'SIGN' },
        { name: 'Giao hàng', percent: 50, condition: 'DELIVERY', dueDays: 15 },
        { name: 'Nghiệm thu', percent: 20, condition: 'ACCEPTANCE' },
      ],
      VALUE,
    );
    expect(terms.map((term) => term.amount)).toEqual([30_000_000, 50_000_000, 20_000_000]);
    expect(terms.map((term) => term.seq)).toEqual([1, 2, 3]);
    expect(terms[1]).toMatchObject({ condition: 'DELIVERY', dueDays: 15, percent: 50 });
  });

  it('điều kiện "Khi giao đủ hàng" (FULL_DELIVERY) hợp lệ; điều kiện lạ trả 400', () => {
    const terms = normalizePaymentTerms(
      [
        { name: 'Tạm ứng', percent: 30, condition: 'SIGN' },
        { name: 'Giao đủ', percent: 70, condition: 'FULL_DELIVERY', dueDays: 30 },
      ],
      VALUE,
    );
    expect(terms[1]).toMatchObject({ condition: 'FULL_DELIVERY', amount: 70_000_000, dueDays: 30 });
    expect(() => normalizePaymentTerms([{ name: 'X', percent: 100, condition: 'PARTIAL_DELIVERY' }], VALUE)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_CONDITION' }),
    );
  });

  it('TC-CON-05: tổng phần trăm 90% hoặc tổng tiền 90 triệu trả 400', () => {
    expect(() =>
      normalizePaymentTerms(
        [
          { name: 'Đợt 1', percent: 30, condition: 'SIGN' },
          { name: 'Đợt 2', percent: 60, condition: 'DELIVERY' },
        ],
        VALUE,
      ),
    ).toThrow(PAYMENT_TERMS_TOTAL_MESSAGE);
    expect(() =>
      normalizePaymentTerms([{ name: 'Một lần', amount: 90_000_000, condition: 'DATE', dueDate: '2026-12-31' }], VALUE),
    ).toThrow(expect.objectContaining({ statusCode: 400, code: 'PAYMENT_TERMS_TOTAL' }));
  });

  it('đợt phần trăm cuối nhận phần lẻ làm tròn để tổng khớp đến đồng', () => {
    const terms = normalizePaymentTerms(
      [
        { name: 'A', percent: 33.3333, condition: 'SIGN' },
        { name: 'B', percent: 33.3333, condition: 'SIGN' },
        { name: 'C', percent: 33.3334, condition: 'SIGN' },
      ],
      1_000_001,
    );
    expect(terms.reduce((sum, term) => sum + term.amount, 0)).toBe(1_000_001);
  });

  it('trộn phần trăm và số tiền: cộng số tiền đúng giá trị', () => {
    const terms = normalizePaymentTerms(
      [
        { name: 'Tạm ứng', percent: 40, condition: 'SIGN' },
        { name: 'Còn lại', amount: 60_000_000, condition: 'DATE', dueDate: '2027-01-15' },
      ],
      VALUE,
    );
    expect(terms.map((term) => term.amount)).toEqual([40_000_000, 60_000_000]);
  });

  it('mỗi đợt nhập đúng một trong phần trăm hoặc số tiền; điều kiện theo ngày phải có hạn', () => {
    expect(() => normalizePaymentTerms([{ name: 'X', percent: 50, amount: 1, condition: 'SIGN' }], VALUE)).toThrow(
      expect.objectContaining({ code: 'TERM_VALUE_REQUIRED' }),
    );
    expect(() => normalizePaymentTerms([{ name: 'X', condition: 'SIGN' }], VALUE)).toThrow(expect.objectContaining({ code: 'TERM_VALUE_REQUIRED' }));
    expect(() => normalizePaymentTerms([{ name: 'X', percent: 100, condition: 'DATE' }], VALUE)).toThrow(
      expect.objectContaining({ code: 'DUE_DATE_REQUIRED' }),
    );
    expect(() => normalizePaymentTerms([{ name: 'X', percent: 100, condition: 'LATER' as never }], VALUE)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONDITION' }),
    );
    expect(() => normalizePaymentTerms([{ name: 'X', percent: 120, condition: 'SIGN' }], VALUE)).toThrow(expect.objectContaining({ code: 'INVALID_PERCENT' }));
  });

  it('không chặt (sau khi đổi giá trị): tính lại số tiền, không kiểm tổng; xác nhận thì kiểm lại', () => {
    const terms = normalizePaymentTerms(
      [
        { name: 'A', percent: 50, condition: 'SIGN' },
        { name: 'B', amount: 50_000_000, condition: 'DELIVERY' },
      ],
      120_000_000,
      false,
    );
    expect(terms.map((term) => term.amount)).toEqual([60_000_000, 50_000_000]);
    expect(() => assertPaymentTermsBalanced(terms, 120_000_000)).toThrow(PAYMENT_TERMS_TOTAL_MESSAGE);
    expect(() => assertPaymentTermsBalanced([], 120_000_000)).not.toThrow();
    expect(() => assertPaymentTermsBalanced([{ percent: 100, amount: 120_000_000 }], 120_000_000)).not.toThrow();
  });
});
