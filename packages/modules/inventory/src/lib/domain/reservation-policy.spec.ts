import type { CreateStockReservationRequest } from '@enterprise-platform/contracts-inventory';
import {
  assertExpiryInFuture,
  normalizeReservationRequest,
  reservationRequestHash,
} from './reservation-policy.js';

const ORDER_ID = '7b0c5f1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';

const base: CreateStockReservationRequest = {
  sourceType: 'crm_order',
  sourceId: ORDER_ID,
  idempotencyKey: `crm-order-${ORDER_ID}`,
  expiresAt: '2030-01-01T00:00:00+07:00',
  items: [
    { materialCode: 'VT-2', quantityReserved: 3, warehouseCode: 'KHO-A' },
    { materialCode: 'VT-1', quantityReserved: 1, warehouseCode: 'KHO-B' },
    { materialCode: 'VT-1', quantityReserved: 2, warehouseCode: 'KHO-A' },
  ],
};

function message(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected error');
}

describe('normalizeReservationRequest', () => {
  it('lấy nguồn làm đối tượng tham chiếu, chuẩn hoá hạn về UTC, sắp dòng theo kho rồi vật tư', () => {
    const normalized = normalizeReservationRequest(base);
    expect(normalized).toEqual({
      referenceType: 'crm_order',
      referenceId: ORDER_ID,
      sourceType: 'crm_order',
      sourceId: ORDER_ID,
      idempotencyKey: `crm-order-${ORDER_ID}`,
      expiresAt: '2029-12-31T17:00:00.000Z',
      lines: [
        { warehouseCode: 'KHO-A', materialCode: 'VT-1', quantity: 2 },
        { warehouseCode: 'KHO-A', materialCode: 'VT-2', quantity: 3 },
        { warehouseCode: 'KHO-B', materialCode: 'VT-1', quantity: 1 },
      ],
    });
  });

  it('giữ cách gọi cũ: kho ở đầu phiếu, referenceType và referenceId', () => {
    const normalized = normalizeReservationRequest({
      warehouseCode: 'KHO-A',
      referenceType: 'procedure_step',
      referenceId: ORDER_ID,
      items: [{ materialCode: 'VT-1', quantityReserved: 5 }],
    });
    expect(normalized).toMatchObject({
      referenceType: 'procedure_step',
      referenceId: ORDER_ID,
      sourceType: undefined,
      lines: [{ warehouseCode: 'KHO-A', materialCode: 'VT-1', quantity: 5 }],
    });
  });

  it('gộp hai dòng cùng kho, cùng vật tư', () => {
    const normalized = normalizeReservationRequest({
      ...base,
      items: [
        { materialCode: 'VT-1', quantityReserved: 0.1, warehouseCode: 'KHO-A' },
        { materialCode: 'VT-1', quantityReserved: 0.2, warehouseCode: 'KHO-A' },
      ],
    });
    expect(normalized.lines).toEqual([{ warehouseCode: 'KHO-A', materialCode: 'VT-1', quantity: 0.3 }]);
  });

  it.each<[string, Partial<CreateStockReservationRequest>, string]>([
    ['không có dòng', { items: [] }, 'Yêu cầu giữ vật tư phải có ít nhất một dòng.'],
    ['số lượng âm', { items: [{ materialCode: 'VT-1', quantityReserved: -1, warehouseCode: 'KHO-A' }] }, 'Dòng 1: số lượng phải là số dương.'],
    ['thiếu kho', { items: [{ materialCode: 'VT-1', quantityReserved: 1 }] }, 'Dòng 1: thiếu kho giữ hàng.'],
    ['thiếu mã vật tư', { items: [{ materialCode: ' ', quantityReserved: 1, warehouseCode: 'KHO-A' }] }, 'Dòng 1: thiếu mã vật tư.'],
    ['nguồn không phải UUID', { sourceId: 'DH-001' }, 'Mã chứng từ nguồn không hợp lệ.'],
    ['hạn sai định dạng', { expiresAt: 'ngày mai' }, 'Hạn giữ hàng phải là thời điểm ISO 8601 hợp lệ.'],
    ['không có nguồn', { sourceType: undefined, referenceType: undefined }, 'Phải ghi nguồn giữ hàng (sourceType hoặc referenceType).'],
    ['khoá quá dài', { idempotencyKey: 'k'.repeat(201) }, 'Khoá chống lặp dài tối đa 200 ký tự.'],
  ])('từ chối yêu cầu %s', (_label, patch, expected) => {
    expect(message(() => normalizeReservationRequest({ ...base, ...patch }))).toBe(expected);
  });
});

describe('reservationRequestHash', () => {
  const hash = (request: CreateStockReservationRequest) =>
    reservationRequestHash(normalizeReservationRequest(request));

  it('cùng nội dung thì cùng băm dù đổi thứ tự dòng, tách dòng, khác khoảng trắng hay múi giờ', () => {
    const reordered: CreateStockReservationRequest = {
      ...base,
      sourceType: ' crm_order ',
      expiresAt: '2029-12-31T17:00:00Z',
      items: [
        { materialCode: 'VT-1', quantityReserved: 1, warehouseCode: 'KHO-A' },
        { materialCode: 'VT-1', quantityReserved: 1, warehouseCode: 'KHO-B' },
        { materialCode: 'VT-2', quantityReserved: 3, warehouseCode: 'KHO-A' },
        { materialCode: 'VT-1', quantityReserved: 1, warehouseCode: 'KHO-A' },
      ],
    };
    expect(hash(reordered)).toBe(hash(base));
  });

  it('khoá chống lặp không nằm trong băm', () => {
    expect(hash({ ...base, idempotencyKey: 'khac' })).toBe(hash(base));
  });

  it.each<[string, Partial<CreateStockReservationRequest>]>([
    ['số lượng', { items: [{ materialCode: 'VT-1', quantityReserved: 9, warehouseCode: 'KHO-A' }] }],
    ['kho', { items: [{ materialCode: 'VT-1', quantityReserved: 2, warehouseCode: 'KHO-C' }] }],
    ['hạn giữ', { expiresAt: '2030-01-02T00:00:00Z' }],
    ['nguồn', { sourceId: '00000000-0000-4000-8000-000000000001' }],
  ])('khác %s thì khác băm', (_label, patch) => {
    expect(hash({ ...base, ...patch })).not.toBe(hash(base));
  });
});

describe('assertExpiryInFuture', () => {
  const now = new Date('2026-10-27T00:00:00Z');

  it('cho qua hạn ở tương lai và giữ hàng không hạn', () => {
    expect(() => assertExpiryInFuture('2026-10-28T00:00:00.000Z', now)).not.toThrow();
    expect(() => assertExpiryInFuture(undefined, now)).not.toThrow();
  });

  it('từ chối hạn đã qua', () => {
    expect(message(() => assertExpiryInFuture('2026-10-26T00:00:00.000Z', now))).toBe(
      'Hạn giữ hàng phải sau thời điểm hiện tại.',
    );
  });
});
