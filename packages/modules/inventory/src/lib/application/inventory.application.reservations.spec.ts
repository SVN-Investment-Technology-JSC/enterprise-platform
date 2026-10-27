import type { CreateStockReservationRequest, Reservation } from '@enterprise-platform/contracts-inventory';
import { reservationRequestHash, normalizeReservationRequest } from '../domain/reservation-policy.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { CreateReservationInput, InventoryStore } from './inventory-store.port.js';
import type { StockDocumentStore } from './stock-document-store.port.js';

const actor: InventoryActor = {
  tenantId: 'tenant',
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Bán hàng',
  canManage: false,
  canWriteTransactions: true,
};

const request: CreateStockReservationRequest = {
  sourceType: 'crm_order',
  sourceId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: 'crm-order-1',
  expiresAt: '2099-01-01T00:00:00Z',
  items: [{ materialCode: 'VT-1', quantityReserved: 2, warehouseCode: 'KHO-A' }],
};

const reservation = { id: 'r1', reservationCode: 'RES-1', status: 'RESERVED' } as Reservation;

function setup(existing: { reservation: Reservation; requestHash?: string } | null) {
  const created: CreateReservationInput[] = [];
  const store = {
    reservation: {
      findByIdempotencyKey: jest.fn(async () => existing),
      create: jest.fn(async (_tenantId: string, input: CreateReservationInput) => {
        created.push(input);
        return reservation;
      }),
    },
  } as unknown as InventoryStore;
  return { app: new InventoryApplication(store, {} as StockDocumentStore), created, store };
}

async function rejection(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; code: string };
  }
  throw new Error('expected rejection');
}

describe('Giữ hàng có khoá chống lặp (T1-11)', () => {
  const hash = reservationRequestHash(normalizeReservationRequest(request));

  it('khoá mới: tạo giữ hàng, truyền nguồn, khoá và băm xuống store', async () => {
    const { app, created } = setup(null);
    await expect(app.createStockReservation(actor, request)).resolves.toBe(reservation);
    expect(created).toEqual([
      {
        referenceType: 'crm_order',
        referenceId: request.sourceId,
        sourceType: 'crm_order',
        sourceId: request.sourceId,
        idempotencyKey: 'crm-order-1',
        requestHash: hash,
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdBy: actor.userId,
        items: [{ warehouseCode: 'KHO-A', materialCode: 'VT-1', quantityReserved: 2 }],
      },
    ]);
  });

  it('cùng khoá, cùng nội dung: trả giữ hàng cũ, không tạo thêm, kể cả khi hạn đã qua', async () => {
    const existing = { ...reservation, reservationCode: 'RES-OLD' };
    const { app, created } = setup({ reservation: existing, requestHash: hash });
    await expect(app.createStockReservation(actor, request)).resolves.toBe(existing);
    expect(created).toEqual([]);
  });

  it('cùng khoá, khác nội dung: 409, không tạo thêm', async () => {
    const { app, created } = setup({ reservation, requestHash: hash });
    const error = await rejection(
      app.createStockReservation(actor, {
        ...request,
        items: [{ materialCode: 'VT-1', quantityReserved: 3, warehouseCode: 'KHO-A' }],
      }),
    );
    expect([error.statusCode, error.code]).toEqual([409, 'IDEMPOTENCY_KEY_CONFLICT']);
    expect(created).toEqual([]);
  });

  it('giữ hàng mới với hạn đã qua: 400', async () => {
    const { app } = setup(null);
    const error = await rejection(
      app.createStockReservation(actor, { ...request, expiresAt: '2000-01-01T00:00:00Z' }),
    );
    expect([error.statusCode, error.code]).toEqual([400, 'INVALID_RESERVATION']);
  });

  it('không có quyền ghi phát sinh: từ chối trước khi chạm store', async () => {
    const { app, store } = setup(null);
    await expect(
      app.createStockReservation({ ...actor, canWriteTransactions: false }, request),
    ).rejects.toThrow('Bạn không có quyền ghi phát sinh tồn kho.');
    expect(store.reservation.findByIdempotencyKey).not.toHaveBeenCalled();
  });
});
