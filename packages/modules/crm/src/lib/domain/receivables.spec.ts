import {
  agingBucket,
  allocateInOrder,
  assertAllocatable,
  daysOverdue,
  deliveredValue,
  deliveryReceivableAmount,
  evaluateCreditLimit,
  normalizeAllocations,
  receiptIdempotencyKey,
  summarizeAging,
  type AllocatableItem,
} from './receivables.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('tuổi nợ (TC-AR-05)', () => {
  it('đúng biên ngày 30, 31, 60, 61, 90, 91', () => {
    expect([30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual(['D0_30', 'D31_60', 'D31_60', 'D61_90', 'D61_90', 'D90_PLUS']);
  });

  it('chưa đến hạn khi hạn sau hôm nay hoặc không có hạn; đến hạn hôm nay vào nhóm 0–30', () => {
    expect(agingBucket(-1)).toBe('NOT_DUE');
    expect(agingBucket(null)).toBe('NOT_DUE');
    expect(agingBucket(0)).toBe('D0_30');
  });

  it('số ngày quá hạn tính theo lịch, qua cả tháng', () => {
    expect(daysOverdue('2026-09-27', '2026-10-27')).toBe(30);
    expect(daysOverdue('2026-10-28', '2026-10-27')).toBe(-1);
    expect(daysOverdue(null, '2026-10-27')).toBeNull();
  });

  it('cộng số còn nợ theo nhóm, bỏ khoản đã thu đủ', () => {
    const result = summarizeAging(
      [
        { dueDate: '2026-10-30', openAmount: 100 },
        { dueDate: '2026-10-27', openAmount: 200 },
        { dueDate: '2026-07-01', openAmount: 300 },
        { dueDate: '2026-07-01', openAmount: 0 },
      ],
      '2026-10-27',
    );
    expect(result.buckets).toEqual({ NOT_DUE: 100, D0_30: 200, D31_60: 0, D61_90: 0, D90_PLUS: 300 });
    expect(result.overdueAmount).toBe(300);
  });
});

describe('phân bổ lần thu (TC-AR-04)', () => {
  const items = new Map<string, AllocatableItem>([
    [A, { entryId: A, customerId: 'c1', label: 'khoản A', allocatable: 1_000_000 }],
    [B, { entryId: B, customerId: 'c2', label: 'khoản B', allocatable: 5_000_000 }],
  ]);

  it('chuẩn hoá, làm tròn đến đồng', () => {
    expect(normalizeAllocations([{ entryId: A.toUpperCase(), amount: '999999.6' }], 1_000_000)).toEqual([{ entryId: A, amount: 1_000_000 }]);
  });

  it('tổng phân bổ vượt số thu thì 400', () => {
    expect(() => normalizeAllocations([{ entryId: A, amount: 1_200_000 }], 1_000_000)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'ALLOCATION_EXCEEDS_RECEIPT' }),
    );
  });

  it('trùng khoản, số âm, thiếu khoản thì 400', () => {
    expect(() => normalizeAllocations([{ entryId: A, amount: 1 }, { entryId: A, amount: 1 }], 10)).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_ALLOCATION' }),
    );
    expect(() => normalizeAllocations([{ entryId: A, amount: -1 }], 10)).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    expect(() => normalizeAllocations([{ entryId: 'x', amount: 1 }], 10)).toThrow(expect.objectContaining({ code: 'INVALID_ALLOCATION' }));
  });

  it('phân bổ vượt số còn nợ của khoản thì 400; khoản của khách khác thì 400', () => {
    expect(() => assertAllocatable([{ entryId: A, amount: 1_500_000 }], items, 'c1')).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'ALLOCATION_EXCEEDS_OPEN' }),
    );
    expect(() => assertAllocatable([{ entryId: B, amount: 1 }], items, 'c1')).toThrow(expect.objectContaining({ code: 'ENTRY_NOT_OPEN' }));
    expect(() => assertAllocatable([{ entryId: A, amount: 1_000_000 }], items, 'c1')).not.toThrow();
  });

  it('chia theo thứ tự, trả phần thừa', () => {
    const { parts, remainder } = allocateInOrder([{ id: 1, available: 300 }, { id: 2, available: 0 }, { id: 3, available: 200 }], 450);
    expect(parts.map((part) => [part.item.id, part.amount])).toEqual([
      [1, 300],
      [3, 150],
    ]);
    expect(remainder).toBe(0);
    expect(allocateInOrder([{ available: 100 }], 150).remainder).toBe(50);
  });

  it('khoá chống lặp gửi Tài chính', () => {
    expect(receiptIdempotencyKey(A, 1)).toBe(`crm-receipt:${A}`);
    expect(receiptIdempotencyKey(A, 2)).toBe(`crm-receipt:${A}:2`);
  });
});

describe('ghi nợ khi giao hàng (T5-04, Q3)', () => {
  it('giá trị gồm VAT theo tỷ lệ số lượng, làm tròn đến đồng, giao đủ đúng bằng thành tiền', () => {
    expect(deliveredValue({ quantity: 3, lineTotal: 1_000_000 }, 1)).toBe(333_333);
    expect(deliveredValue({ quantity: 3, lineTotal: 1_000_000 }, 3)).toBe(1_000_000);
  });

  it('TC-AR-01: xuất 4/10 dòng 11.000.000 gồm VAT thì ghi nợ 4.400.000', () => {
    expect(deliveryReceivableAmount([{ quantity: 10, lineTotal: 11_000_000, deliveredBefore: 0, deliveredAfter: 4 }], 0)).toBe(4_400_000);
  });

  it('giao nhiều đợt cộng lại không lệch đồng lẻ', () => {
    const line = { quantity: 3, lineTotal: 1_000_000 };
    const amounts = [
      deliveryReceivableAmount([{ ...line, deliveredBefore: 0, deliveredAfter: 1 }], 0),
      deliveryReceivableAmount([{ ...line, deliveredBefore: 1, deliveredAfter: 2 }], 0),
      deliveryReceivableAmount([{ ...line, deliveredBefore: 2, deliveredAfter: 3 }], 0),
    ];
    expect(amounts).toEqual([333_333, 333_334, 333_333]);
    expect(amounts.reduce((sum, value) => sum + value, 0)).toBe(1_000_000);
  });

  it('phí vận chuyển ghi cùng lần giao đầu, đảo khi chứng từ đảo đưa đơn về chưa giao', () => {
    expect(deliveryReceivableAmount([{ quantity: 2, lineTotal: 200, deliveredBefore: 0, deliveredAfter: 1 }], 55)).toBe(155);
    expect(deliveryReceivableAmount([{ quantity: 2, lineTotal: 200, deliveredBefore: 1, deliveredAfter: 2 }], 55)).toBe(100);
    expect(deliveryReceivableAmount([{ quantity: 2, lineTotal: 200, deliveredBefore: 1, deliveredAfter: 0 }], 55)).toBe(-155);
  });
});

describe('hạn mức công nợ (D5)', () => {
  const base = { creditLimit: 100_000_000, balance: 80_000_000, mode: 'APPROVAL' as const, approvedAmount: null };

  it('TC-AR-09: bằng đúng hạn mức thì cho qua', () => {
    expect(evaluateCreditLimit({ ...base, orderAmount: 20_000_000 })).toEqual({ outcome: 'ALLOW' });
  });

  it('TC-AR-10, TC-AR-11: vượt 1 đồng thì chặn hoặc đưa đi duyệt theo cấu hình', () => {
    expect(evaluateCreditLimit({ ...base, orderAmount: 20_000_001, mode: 'BLOCK' })).toMatchObject({ outcome: 'BLOCK' });
    const approval = evaluateCreditLimit({ ...base, orderAmount: 20_000_001 });
    expect(approval).toMatchObject({ outcome: 'APPROVAL' });
    expect((approval as { message: string }).message).toContain('Vượt hạn mức công nợ');
  });

  it('không đặt hạn mức thì không giới hạn; đã được duyệt với giá trị không nhỏ hơn thì cho qua', () => {
    expect(evaluateCreditLimit({ ...base, creditLimit: null, orderAmount: 1e12 })).toEqual({ outcome: 'ALLOW' });
    expect(evaluateCreditLimit({ ...base, orderAmount: 30_000_000, approvedAmount: 30_000_000 })).toEqual({ outcome: 'ALLOW' });
    expect(evaluateCreditLimit({ ...base, orderAmount: 30_000_001, approvedAmount: 30_000_000 })).toMatchObject({ outcome: 'APPROVAL' });
  });
});
