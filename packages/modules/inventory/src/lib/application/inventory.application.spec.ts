import type { CreateMaterialRequest } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';

const actor: InventoryActor = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  displayName: 'Thủ kho',
  canManage: true,
  canWriteTransactions: true,
};

function build(overrides: Record<string, unknown> = {}) {
  const store = {
    material: {
      findAnyByCode: jest.fn().mockResolvedValue({ code: 'VT-1' }),
      create: jest.fn().mockResolvedValue({ code: 'VT-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    serial: {
      register: jest.fn().mockResolvedValue(1),
      listByMaterial: jest.fn().mockResolvedValue([{}]),
    },
    reservation: { create: jest.fn().mockResolvedValue({ reservationCode: 'RES-1' }) },
    settings: { get: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
  const app = new InventoryApplication(store as never);
  // Cấu hình mặc định không liên quan tới các ca kiểm thử này.
  jest
    .spyOn(app as unknown as { getSettings: () => Promise<unknown> }, 'getSettings')
    .mockResolvedValue({ 'catalog.asset': { value: { usageStates: [] } } });
  return { app, store };
}

describe('InventoryApplication validation', () => {
  it('rejects a material with an unknown category with a 400 error instead of reaching the database', async () => {
    const { app, store } = build({
      material: {
        findAnyByCode: jest.fn().mockResolvedValue(undefined),
        create: jest.fn(),
        update: jest.fn(),
      },
    });
    const request = {
      code: 'vt-1',
      name: 'Rơ-le',
      unit: 'Cái',
      category: 'NOT_A_CATEGORY',
    } as unknown as CreateMaterialRequest;

    await expect(app.createMaterial(actor, request)).rejects.toMatchObject({
      code: 'VALIDATION',
      statusCode: 400,
    });
    expect(store.material.create).not.toHaveBeenCalled();
  });

  it('rejects a reservation whose referenceId is not a UUID', async () => {
    const { app, store } = build();
    await expect(
      app.createStockReservation(actor, {
        warehouseCode: 'WH-1',
        referenceType: 'MANUAL',
        referenceId: 'not-a-uuid',
        items: [{ materialCode: 'VT-1', quantityReserved: 3 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESERVATION', statusCode: 400 });
    expect(store.reservation.create).not.toHaveBeenCalled();
  });

  it('accepts a well-formed reservation', async () => {
    const { app, store } = build();
    await app.createStockReservation(actor, {
      warehouseCode: 'WH-1',
      referenceType: 'MANUAL',
      referenceId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
      items: [{ materialCode: 'VT-1', quantityReserved: 3 }],
    });
    expect(store.reservation.create).toHaveBeenCalledTimes(1);
  });

  it('registers new serials as in stock rather than operating', async () => {
    const { app, store } = build();
    await app.registerSerials(actor, { materialCode: 'vt-1', serialNumbers: ['SN-1'] });
    expect(store.serial.register).toHaveBeenCalledWith(
      'tenant-1',
      'VT-1',
      ['SN-1'],
      'IN_STOCK',
      expect.any(String),
      undefined,
    );
  });
});
