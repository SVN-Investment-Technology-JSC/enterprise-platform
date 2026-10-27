import {
  averageAfterIssue,
  averageAfterReceipt,
  costAmount,
  inboundUnitCost,
  outboundUnitCost,
  roundHalfAwayFromZero,
} from './costing.js';

describe('giá vốn bình quân gia quyền tức thời (D4)', () => {
  it('TC-INV-17: nhập 10 @100.000 rồi 10 @120.000 cho bình quân 110.000', () => {
    const first = averageAfterReceipt({ quantity: 0, avgCost: 0 }, 10, 100_000);
    expect(first).toBe(100_000);
    expect(averageAfterReceipt({ quantity: 10, avgCost: first }, 10, 120_000)).toBe(110_000);
  });

  it('TC-INV-18: nhập xen xuất, xuất theo bình quân không đổi bình quân', () => {
    let balance = { quantity: 10, avgCost: averageAfterReceipt({ quantity: 0, avgCost: 0 }, 10, 100_000) };
    balance = { quantity: 6, avgCost: averageAfterIssue(balance, 4, balance.avgCost) };
    expect(balance.avgCost).toBe(100_000);
    balance = { quantity: 12, avgCost: averageAfterReceipt(balance, 6, 130_000) };
    expect(balance.avgCost).toBe(115_000);
    balance = { quantity: 16, avgCost: averageAfterReceipt(balance, 4, 90_000) };
    expect(balance.avgCost).toBe(108_750);
  });

  it('TC-INV-19: bình quân làm tròn 4 chữ số, giá trị tồn lệch không quá 1 đồng', () => {
    const average = averageAfterReceipt({ quantity: 3, avgCost: 100_000 }, 4, 100_001);
    expect(average).toBe(100_000.5714);
    expect(Math.abs(average * 7 - (3 * 100_000 + 4 * 100_001))).toBeLessThanOrEqual(1);
  });

  it.each([
    // [tồn, bình quân, số nhập, đơn giá, kỳ vọng]
    [1, 0.0001, 1, 0, 0.0001], // (0,0001 + 0) / 2 = 0,00005 làm tròn lên 0,0001
    [2, 1, 1, 0, 0.6667],
    [3, 10, 0.001, 20, 10.0033],
    [0, 999, 5, 1234.5678, 1234.5678],
    [-2, 50, 5, 70, 70], // tồn âm của dữ liệu cũ coi như 0
  ])('làm tròn nửa xa số 0: tồn %p @%p nhập %p @%p thành %p', (quantity, avgCost, inQuantity, unitCost, expected) => {
    expect(averageAfterReceipt({ quantity, avgCost }, inQuantity, unitCost)).toBe(expected);
  });

  it('TC-INV-21: thành tiền dòng xuất = số lượng × bình quân, 2 chữ số', () => {
    expect(costAmount(3, 110_000)).toBe(330_000);
    expect(costAmount(0.333, 100_000.5714)).toBe(33_300.19);
    expect(costAmount(1, 0.005)).toBe(0.01);
    expect(roundHalfAwayFromZero(-2.5, 0)).toBe(-3);
    expect(roundHalfAwayFromZero(1.00005, 4)).toBe(1.0001);
  });

  it('xuất ở giá cố định (đảo phiếu nhập) trả bình quân về như trước lần nhập', () => {
    const before = { quantity: 10, avgCost: 100_000 };
    const afterReceipt = averageAfterReceipt(before, 10, 120_000);
    expect(averageAfterIssue({ quantity: 20, avgCost: afterReceipt }, 10, 120_000)).toBe(100_000);
    // Xuất hết thì giữ bình quân cũ; giá trị âm thì về 0.
    expect(averageAfterIssue({ quantity: 5, avgCost: 10 }, 5, 99)).toBe(10);
    expect(averageAfterIssue({ quantity: 5, avgCost: 10 }, 4, 99)).toBe(0);
  });

  it('TC-INV-20: nhập trả hàng bán lấy giá vốn dòng xuất gốc, không có thì bình quân hiện tại', () => {
    const base = { docType: 'RECEIPT_SALES_RETURN' as const, entered: 999, currentAverage: 120_000, isReversal: false };
    expect(inboundUnitCost({ ...base, sourceLineCost: 110_000 })).toBe(110_000);
    expect(inboundUnitCost(base)).toBe(120_000);
    // Tồn 5 @120.000, nhập trả 1 @110.000: (600.000 + 110.000) / 6.
    expect(averageAfterReceipt({ quantity: 5, avgCost: 120_000 }, 1, 110_000)).toBe(118_333.3333);
  });

  it('đơn giá nhập theo loại chứng từ', () => {
    const base = { docType: 'RECEIPT_PURCHASE' as const, currentAverage: 50, isReversal: false };
    expect(inboundUnitCost({ ...base, entered: 70 })).toBe(70);
    expect(inboundUnitCost({ ...base, entered: 0 })).toBe(50);
    expect(inboundUnitCost({ ...base, docType: 'TRANSFER', entered: 0, transferCost: 42 })).toBe(42);
    expect(inboundUnitCost({ ...base, docType: 'ISSUE_SALES', entered: 33, isReversal: true })).toBe(33);
    expect(outboundUnitCost({ entered: 999, currentAverage: 50, isReversal: false })).toBe(50);
    expect(outboundUnitCost({ entered: 70, currentAverage: 50, isReversal: true })).toBe(70);
    expect(outboundUnitCost({ entered: 0, currentAverage: 50, isReversal: true })).toBe(50);
  });
});
