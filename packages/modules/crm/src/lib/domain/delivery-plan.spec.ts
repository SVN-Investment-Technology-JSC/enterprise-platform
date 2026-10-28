import { allocateIssuedLine, committedQuantity, DELIVERY_EXCEEDS_ORDER_MESSAGE, validateDeliveryLines } from './delivery-plan.js';

const LINE = '11111111-1111-4111-8111-111111111111';
const LINE2 = '22222222-2222-4222-8222-222222222222';
const orderLines = [
  { id: LINE, lineNo: 1, quantity: 10 },
  { id: LINE2, lineNo: 2, quantity: 2 },
];

describe('kế hoạch giao nhiều đợt (T4-10)', () => {
  it('TC-ORD-04: đợt 4 rồi đợt 6 của dòng 10 cái lưu được', () => {
    const first = validateDeliveryLines({ orderLines, existing: [], deliveryId: null, lines: [{ orderLineId: LINE, quantity: 4 }], deliveryCount: 0 });
    expect(first).toEqual([{ orderLineId: LINE, quantity: 4 }]);
    const existing = [{ deliveryId: 'd1', orderLineId: LINE, status: 'PLANNED' as const, plannedQuantity: 4, deliveredQuantity: 0 }];
    expect(validateDeliveryLines({ orderLines, existing, deliveryId: null, lines: [{ orderLineId: LINE, quantity: 6 }], deliveryCount: 1 })).toHaveLength(1);
  });

  it('TC-ORD-05: đợt 4 và đợt 7 vượt số lượng đơn trả 400', () => {
    const existing = [{ deliveryId: 'd1', orderLineId: LINE, status: 'PLANNED' as const, plannedQuantity: 4, deliveredQuantity: 0 }];
    expect(() => validateDeliveryLines({ orderLines, existing, deliveryId: null, lines: [{ orderLineId: LINE, quantity: 7 }], deliveryCount: 1 })).toThrow(
      DELIVERY_EXCEEDS_ORDER_MESSAGE,
    );
  });

  it('sửa đợt không tính chính nó; đợt huỷ không chiếm; đợt đã xuất chiếm số đã giao thật', () => {
    const existing = [
      { deliveryId: 'd1', orderLineId: LINE, status: 'PLANNED' as const, plannedQuantity: 8, deliveredQuantity: 0 },
      { deliveryId: 'd2', orderLineId: LINE, status: 'CANCELLED' as const, plannedQuantity: 5, deliveredQuantity: 0 },
      { deliveryId: 'd3', orderLineId: LINE, status: 'ISSUED' as const, plannedQuantity: 5, deliveredQuantity: 2 },
    ];
    expect(() => validateDeliveryLines({ orderLines, existing, deliveryId: 'd1', lines: [{ orderLineId: LINE, quantity: 8 }], deliveryCount: 3 })).not.toThrow();
    expect(committedQuantity('REVERSED', 5, 0)).toBe(0);
  });

  it('dòng không thuộc đơn, lặp dòng, số lượng không dương, không có dòng: 400', () => {
    const base = { orderLines, existing: [], deliveryId: null, deliveryCount: 0 };
    expect(() => validateDeliveryLines({ ...base, lines: [] })).toThrow(expect.objectContaining({ code: 'DELIVERY_LINES_REQUIRED' }));
    expect(() => validateDeliveryLines({ ...base, lines: [{ orderLineId: 'x', quantity: 1 }] })).toThrow(expect.objectContaining({ code: 'INVALID_DELIVERY_LINE' }));
    expect(() =>
      validateDeliveryLines({ ...base, lines: [{ orderLineId: LINE, quantity: 1 }, { orderLineId: LINE, quantity: 1 }] }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_DELIVERY_LINE' }));
    expect(() => validateDeliveryLines({ ...base, lines: [{ orderLineId: LINE2, quantity: 0 }] })).toThrow(expect.objectContaining({ code: 'INVALID_QUANTITY' }));
  });
});

describe('phân bổ kết quả xuất kho vào đợt (T4-12)', () => {
  const targets = [
    { id: 'a', materialId: 'm1', plannedQuantity: 4, deliveredQuantity: 0, serials: [] },
    { id: 'b', materialId: 'm1', plannedQuantity: 6, deliveredQuantity: 0, serials: [] },
    { id: 'c', materialId: 'm2', plannedQuantity: 1, deliveredQuantity: 0, serials: [] },
  ];

  it('lấp dần từng dòng cùng mặt hàng; giá vốn chia theo số lượng; serial theo số lượng', () => {
    const parts = allocateIssuedLine(targets, { materialId: 'm1', quantity: 5, costAmount: 4_000_000.5, serials: ['S1', 'S2', 'S3', 'S4', 'S5'] }, false);
    expect(parts).toEqual([
      { lineId: 'a', quantity: 4, cost: 3_200_000.4, serials: ['S1', 'S2', 'S3', 'S4'] },
      { lineId: 'b', quantity: 1, cost: 800_000.1, serials: ['S5'] },
    ]);
  });

  it('xuất dư dồn vào dòng cuối; mặt hàng lạ trả rỗng', () => {
    expect(allocateIssuedLine(targets, { materialId: 'm2', quantity: 3, costAmount: 30, serials: [] }, false)).toEqual([
      { lineId: 'c', quantity: 3, cost: 30, serials: [] },
    ]);
    expect(allocateIssuedLine(targets, { materialId: 'zz', quantity: 1, costAmount: 1, serials: [] }, false)).toEqual([]);
  });

  it('đảo trừ từ dòng cuối đã giao, bỏ serial ở dòng đang giữ nó', () => {
    const delivered = [
      { id: 'a', materialId: 'm1', plannedQuantity: 4, deliveredQuantity: 4, serials: ['S1', 'S2', 'S3', 'S4'] },
      { id: 'b', materialId: 'm1', plannedQuantity: 6, deliveredQuantity: 1, serials: ['S5'] },
    ];
    expect(allocateIssuedLine(delivered, { materialId: 'm1', quantity: 2, costAmount: 1_600_000, serials: ['S5', 'S4'] }, true)).toEqual([
      { lineId: 'b', quantity: -1, cost: -800_000, serials: ['S5'] },
      { lineId: 'a', quantity: -1, cost: -800_000, serials: ['S4'] },
    ]);
  });
});
