import { allocateOrderAdjustments, allocateProportionally, type AllocationLine } from './quote-allocation.js';

const line = (lineAmount: number, vatAmount = 0, discountAmount = 0): AllocationLine => ({
  quantity: 1,
  grossAmount: lineAmount + discountAmount,
  discountAmount,
  lineAmount,
  vatAmount,
});

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('phân bổ chiết khấu, thuế tổng đơn xuống dòng (P2I-09)', () => {
  it('allocateProportionally: tổng các phần đúng bằng tổng cần chia, phần dư dồn về cuối', () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([33n, 34n, 33n]);
    const shares = allocateProportionally(10n, [1n, 1n, 1n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(10n);
    expect(allocateProportionally(5n, [0n, 0n])).toEqual([0n, 5n]);
    expect(allocateProportionally(0n, [3n, 4n])).toEqual([0n, 0n]);
    expect(allocateProportionally(7n, [])).toEqual([]);
  });

  it('mẫu theo dòng: dòng giữ nguyên như phase 1', () => {
    const lines = [line(9_700_000, 970_000, 300_000), line(1_000_000, 100_000)];
    const result = allocateOrderAdjustments({ lines, discountMode: 'LINE', taxMode: 'LINE', orderDiscountTotal: 0, orderTaxTotal: 0 });
    expect(result.map((entry) => [entry.quantity, entry.grossAmount, entry.discountAmount, entry.lineAmount, entry.vatAmount])).toEqual(
      lines.map((entry) => [entry.quantity, entry.grossAmount, entry.discountAmount, entry.lineAmount, entry.vatAmount]),
    );
    expect(result.every((entry) => entry.orderDiscountShare === 0)).toBe(true);
  });

  it('ORDER/ORDER: tổng thành tiền = tiền hàng sau chiết khấu, tổng thuế = thuế tổng đơn, đến đồng', () => {
    // 3 dòng 3.333.333 đ (không chia hết), chiết khấu 10% = 1.000.000, thuế 8% trên phần còn lại.
    const lines = [line(3_333_333), line(3_333_333), line(3_333_334)];
    const goods = 10_000_000;
    const discount = 1_000_000;
    const tax = Math.round(((goods - discount) * 8) / 100);
    const result = allocateOrderAdjustments({ lines, discountMode: 'ORDER', taxMode: 'ORDER', orderDiscountTotal: discount, orderTaxTotal: tax });
    expect(sum(result.map((entry) => entry.lineAmount))).toBe(goods - discount);
    expect(sum(result.map((entry) => entry.orderDiscountShare))).toBe(discount);
    expect(sum(result.map((entry) => entry.vatAmount))).toBe(tax);
    expect(result.every((entry) => Number.isInteger(entry.lineAmount) && Number.isInteger(entry.vatAmount))).toBe(true);
    // discountAmount của dòng tăng đúng phần chiết khấu được chia.
    expect(sum(result.map((entry) => entry.discountAmount))).toBe(discount);
  });

  it('ORDER chiết khấu, thuế theo dòng: thuế hàng giảm theo tỷ lệ chiết khấu như tổng báo giá', () => {
    const lines = [line(6_000_000, 600_000), line(4_000_000, 200_000)];
    const result = allocateOrderAdjustments({ lines, discountMode: 'ORDER', taxMode: 'LINE', orderDiscountTotal: 1_000_000, orderTaxTotal: 0 });
    // Thuế hàng 800.000 giảm theo 9.000.000 / 10.000.000 = 720.000.
    expect(sum(result.map((entry) => entry.vatAmount))).toBe(720_000);
    expect(sum(result.map((entry) => entry.lineAmount))).toBe(9_000_000);
  });

  it('ORDER chiết khấu bằng 0: dòng không đổi; chiết khấu bằng tổng hàng: dòng về 0', () => {
    const lines = [line(5_000, 500), line(7_000, 700)];
    const none = allocateOrderAdjustments({ lines, discountMode: 'ORDER', taxMode: 'LINE', orderDiscountTotal: 0, orderTaxTotal: 0 });
    expect(none.map((entry) => [entry.lineAmount, entry.vatAmount])).toEqual([[5_000, 500], [7_000, 700]]);
    const all = allocateOrderAdjustments({ lines, discountMode: 'ORDER', taxMode: 'LINE', orderDiscountTotal: 12_000, orderTaxTotal: 0 });
    expect(all.map((entry) => [entry.lineAmount, entry.vatAmount])).toEqual([[0, 0], [0, 0]]);
  });

  it('ORDER thuế khi mọi dòng bằng 0: dồn thuế vào dòng cuối, không mất đồng nào', () => {
    const result = allocateOrderAdjustments({ lines: [line(0), line(0)], discountMode: 'LINE', taxMode: 'ORDER', orderDiscountTotal: 0, orderTaxTotal: 50 });
    expect(result.map((entry) => entry.vatAmount)).toEqual([0, 50]);
  });

  it('số lớn gần giới hạn không sinh sai số nhị phân', () => {
    const lines = [line(4_500_000_000_000_001), line(4_499_999_999_999_999)];
    const result = allocateOrderAdjustments({ lines, discountMode: 'ORDER', taxMode: 'ORDER', orderDiscountTotal: 900_000_000_000_001, orderTaxTotal: 720_000_000_000_001 });
    expect(sum(result.map((entry) => entry.orderDiscountShare))).toBe(900_000_000_000_001);
    expect(sum(result.map((entry) => entry.vatAmount))).toBe(720_000_000_000_001);
  });
});
