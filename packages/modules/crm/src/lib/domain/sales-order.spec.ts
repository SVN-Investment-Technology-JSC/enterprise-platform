import { SALES_ORDER_STATUSES, type SalesOrderStatus } from '@enterprise-platform/contracts-crm';
import {
  assertOrderTransition,
  canOrderTransition,
  formatDeliveryCode,
  formatOrderCode,
  isDeliveryLate,
  orderStatusAfterDelivery,
  reservationExpiry,
  contractReservationExpiry,
  reservationIdempotencyKey,
} from './sales-order.js';

/** Các cặp hợp lệ theo mục 5.4 kế hoạch. */
const VALID: readonly [SalesOrderStatus, SalesOrderStatus][] = [
  ['DRAFT', 'CONFIRMED'],
  ['DRAFT', 'CREDIT_PENDING'],
  ['CREDIT_PENDING', 'CONFIRMED'],
  ['CREDIT_PENDING', 'DRAFT'],
  ['CONFIRMED', 'DELIVERING'],
  ['DELIVERING', 'PARTIAL'],
  ['PARTIAL', 'DELIVERING'],
  ['DELIVERING', 'DELIVERED'],
  ['PARTIAL', 'DELIVERED'],
  ['DELIVERED', 'DONE'],
  ['DRAFT', 'CANCELLED'],
  ['CREDIT_PENDING', 'CANCELLED'],
  ['CONFIRMED', 'CANCELLED'],
  ['DELIVERING', 'CANCELLED'],
  ['PARTIAL', 'CANCELLED'],
];

describe('máy trạng thái đơn bán', () => {
  const pairs = SALES_ORDER_STATUSES.flatMap((from) => SALES_ORDER_STATUSES.map((to) => [from, to] as const));

  it.each(VALID)('TC-SM-06: %s → %s hợp lệ', (from, to) => {
    expect(canOrderTransition(from, to)).toBe(true);
    expect(() => assertOrderTransition(from, to)).not.toThrow();
  });

  it.each(pairs.filter(([from, to]) => !VALID.some(([a, b]) => a === from && b === to)))('%s → %s không hợp lệ (409)', (from, to) => {
    expect(canOrderTransition(from, to)).toBe(false);
    expect(() => assertOrderTransition(from, to)).toThrow(expect.objectContaining({ statusCode: 409 }));
  });

  it('TC-SM-07: Hoàn tất → Huỷ, Đã giao đủ → Huỷ, Nháp → Đang giao trả 409 tiếng Việt', () => {
    expect(() => assertOrderTransition('DONE', 'CANCELLED')).toThrow('Đơn đã ở trạng thái "Hoàn tất", không huỷ được.');
    expect(() => assertOrderTransition('DELIVERED', 'CANCELLED')).toThrow(expect.objectContaining({ code: 'ORDER_NOT_CANCELLABLE' }));
    expect(() => assertOrderTransition('DRAFT', 'DELIVERING')).toThrow('Không thể chuyển đơn bán từ "Nháp" sang "Đang giao".');
  });
});

describe('trạng thái sau khi Kho ghi sổ xuất (T4-12)', () => {
  const progress = (allDelivered: boolean, anyDelivered: boolean, openRequests = false) => ({ allDelivered, anyDelivered, openRequests });

  it('TC-SM-08: xuất một phần thì Đã giao một phần, xuất đủ thì Đã giao đủ', () => {
    expect(orderStatusAfterDelivery('DELIVERING', progress(false, true, true))).toBe('PARTIAL');
    expect(orderStatusAfterDelivery('PARTIAL', progress(true, true))).toBe('DELIVERED');
    expect(orderStatusAfterDelivery('DELIVERING', progress(true, true))).toBe('DELIVERED');
  });

  it('chứng từ đảo lùi trạng thái: còn yêu cầu xuất thì Đang giao, không thì Đã xác nhận', () => {
    expect(orderStatusAfterDelivery('DELIVERED', progress(false, true))).toBe('PARTIAL');
    expect(orderStatusAfterDelivery('PARTIAL', progress(false, false, true))).toBe('DELIVERING');
    expect(orderStatusAfterDelivery('DELIVERED', progress(false, false))).toBe('CONFIRMED');
  });

  it('đơn đã huỷ, hoàn tất, nháp giữ nguyên trạng thái', () => {
    for (const status of ['CANCELLED', 'DONE', 'DRAFT', 'CREDIT_PENDING'] as const) {
      expect(orderStatusAfterDelivery(status, progress(true, true))).toBe(status);
    }
  });
});

describe('hạn giữ hàng (Q12) và khoá chống lặp', () => {
  const now = new Date('2026-10-27T03:00:00Z');

  it('mặc định hết ngày hôm nay + holdDays (giờ Việt Nam)', () => {
    expect(reservationExpiry({ today: '2026-10-27', now, holdDays: 7, plannedDate: null })).toBe('2026-11-03T16:59:59.000Z');
  });

  it('có ngày giao dự kiến: hết ngày giao + 2 ngày; ngày đó đã qua thì về mặc định', () => {
    expect(reservationExpiry({ today: '2026-10-27', now, holdDays: 7, plannedDate: '2026-11-20' })).toBe('2026-11-22T16:59:59.000Z');
    expect(reservationExpiry({ today: '2026-10-27', now, holdDays: 7, plannedDate: '2026-10-01' })).toBe('2026-11-03T16:59:59.000Z');
  });

  it('TC-CON-07: giữ hàng của hợp đồng tới hết ngày kết thúc hợp đồng; không có ngày kết thúc thì theo holdDays', () => {
    expect(contractReservationExpiry({ validTo: '2027-03-31', today: '2026-10-27', now, holdDays: 7 })).toBe('2027-03-31T16:59:59.000Z');
    expect(contractReservationExpiry({ validTo: null, today: '2026-10-27', now, holdDays: 7 })).toBe('2026-11-03T16:59:59.000Z');
  });

  it('khoá crm-order:<id>; lần giữ sau khi phải nhả thêm số lần', () => {
    expect(reservationIdempotencyKey('crm-order', 'o1', 1)).toBe('crm-order:o1');
    expect(reservationIdempotencyKey('crm-contract', 'k1', 3)).toBe('crm-contract:k1:3');
  });

  it('mã đơn, mã đợt; đợt trễ khi chưa xuất mà quá ngày dự kiến (TC-ORD-08, TC-ORD-09)', () => {
    expect(formatOrderCode(2026, 12)).toBe('DH2600012');
    expect(formatDeliveryCode('DH2600012', 2)).toBe('DH2600012-02');
    expect(isDeliveryLate({ status: 'REQUESTED', plannedDate: '2026-10-26' }, '2026-10-27')).toBe(true);
    expect(isDeliveryLate({ status: 'PLANNED', plannedDate: '2026-10-27' }, '2026-10-27')).toBe(false);
    expect(isDeliveryLate({ status: 'ISSUED', plannedDate: '2026-10-01' }, '2026-10-27')).toBe(false);
  });
});
