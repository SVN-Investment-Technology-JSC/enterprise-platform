import { CRM_NO_CAPABILITIES, type ContractDetail } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import type { ContractStore } from './contract-store.port.js';
import { ContractService } from './contract.service.js';
import type { InventoryClient } from './fulfillment.port.js';
import type { CatalogReader } from './pricing-store.port.js';

const TENANT = 't1';
const CAP = '11111111-1111-4111-8111-111111111111';
const BT = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: USER,
  displayName: 'Pháp chế',
  canReadAll: true,
  canWriteContract: true,
  ...extra,
});

function contract(extra: Partial<ContractDetail> = {}): ContractDetail {
  return {
    id: ID,
    code: 'HD2600001',
    type: 'SALE',
    title: 'Hợp đồng A',
    customerId: CUSTOMER,
    customerCode: 'KH1',
    customerName: 'Khách A',
    status: 'DRAFT',
    validFrom: '2026-01-01',
    validTo: null,
    value: 100_000_000,
    ownerUserId: USER,
    quoteId: null,
    quoteCode: null,
    updatedAt: '',
    signedDate: null,
    warrantyMonths: null,
    warehouseCode: 'KHO-1',
    note: null,
    revision: 3,
    lines: [
      { id: 'l1', lineNo: 1, materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp', unit: 'Cái', materialKind: 'STOCK', quantity: 10, unitPrice: 1, vatRate: 10, discountPercent: 0, lineAmount: 10, note: null },
      { id: 'l2', lineNo: 2, materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Bảo trì', unit: 'Gói', materialKind: 'SERVICE', quantity: 1, unitPrice: 1, vatRate: 10, discountPercent: 0, lineAmount: 1, note: null },
    ],
    paymentTerms: [],
    reservation: null,
    orders: [],
    history: [],
    createdAt: '',
    ...extra,
  };
}

function setup(detail = contract()) {
  const store = {
    listContracts: jest.fn(),
    getContract: jest.fn().mockResolvedValue(detail),
    createContract: jest.fn().mockResolvedValue(ID),
    updateContract: jest.fn(),
    savePaymentTerms: jest.fn(),
    confirm: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn().mockResolvedValue(undefined),
    reserveAttempt: jest.fn().mockResolvedValue(1),
    bumpReserveAttempt: jest.fn().mockResolvedValue(undefined),
    hasDeliveredOrders: jest.fn().mockResolvedValue(false),
    expireDue: jest.fn(),
  } satisfies jest.Mocked<ContractStore>;
  const inventory: jest.Mocked<InventoryClient> = {
    reserve: jest.fn().mockResolvedValue({ reservationId: 'r-id', reservationCode: 'GH001', status: 'RESERVED', expiresAt: '2026-11-03T16:59:59.000Z' }),
    release: jest.fn().mockResolvedValue(undefined),
    createIssueRequest: jest.fn(),
  };
  const catalog: CatalogReader = {
    materials: async (_tenant, ids) =>
      new Map(
        [
          { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp', unit: 'Cái', category: null, kind: 'STOCK' },
          { id: BT, code: 'QA-KHO-BT', name: 'Bảo trì', unit: 'Gói', category: null, kind: 'SERVICE' },
        ]
          .filter((material) => ids.includes(material.id))
          .map((material) => [material.id, material]),
      ),
    search: async () => [],
  };
  const dispatcher = { dispatch: jest.fn().mockResolvedValue(1) };
  const service = new ContractService(
    store,
    { getCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER }) },
    catalog,
    { resolve: async () => ({ kind: 'all' }) },
    inventory,
    { reservationHoldDays: async () => 7 },
    dispatcher,
    () => new Date('2026-10-27T03:00:00Z'),
  );
  return { store, inventory, dispatcher, service };
}

describe('ContractService', () => {
  it('TC-CON-07: xác nhận giữ hàng một lần cho dòng hàng tồn kho, bỏ dòng dịch vụ, khoá crm-contract:<id>', async () => {
    const { store, inventory, service } = setup();
    await service.confirm(actor(), ID, { revision: 3 });
    expect(inventory.reserve).toHaveBeenCalledWith(TENANT, {
      idempotencyKey: `crm-contract:${ID}`,
      sourceType: 'crm_contract',
      sourceId: ID,
      expiresAt: '2026-11-03T16:59:59.000Z',
      notes: 'Hợp đồng HD2600001',
      lines: [{ materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-1', quantity: 10 }],
    });
    expect(store.confirm).toHaveBeenCalledWith(TENANT, ID, 3, expect.objectContaining({ reservationCode: 'GH001' }), USER);
  });

  it('TC-CON-08: thiếu tồn thì 409 kèm dòng thiếu, hợp đồng giữ trạng thái cũ', async () => {
    const { store, inventory, service } = setup();
    inventory.reserve.mockRejectedValue(
      new CrmError('RESERVATION_INSUFFICIENT_STOCK', 'Thiếu', 409, {
        shortages: [{ materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-1', requested: 10, available: 5 }],
      }),
    );
    await expect(service.confirm(actor(), ID, { revision: 3 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESERVATION_INSUFFICIENT_STOCK',
      details: { shortages: [{ lineNo: 1, materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-1', requested: 10, available: 5 }] },
    });
    expect(store.confirm).not.toHaveBeenCalled();
  });

  it('ghi hợp đồng lỗi sau khi Kho đã giữ: nhả lại và đổi khoá', async () => {
    const { store, inventory, service } = setup();
    store.confirm.mockRejectedValue(new CrmError('STALE_VERSION', 'cũ', 409));
    await expect(service.confirm(actor(), ID, { revision: 3 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(inventory.release).toHaveBeenCalledWith(TENANT, 'GH001');
    expect(store.bumpReserveAttempt).toHaveBeenCalledWith(TENANT, ID);
  });

  it('khoá đã dùng cho nội dung khác: đổi khoá rồi giữ lại một lần', async () => {
    const { store, inventory, service } = setup();
    inventory.reserve.mockRejectedValueOnce(new CrmError('IDEMPOTENCY_KEY_CONFLICT', 'trùng khoá', 409));
    store.reserveAttempt.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await service.confirm(actor(), ID, { revision: 3 });
    expect(inventory.reserve.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([`crm-contract:${ID}`, `crm-contract:${ID}:2`]);
  });

  it('đợt thanh toán lệch tổng hoặc thiếu kho giữ hàng thì không xác nhận', async () => {
    const terms = setup(
      contract({ paymentTerms: [{ id: 'p', seq: 1, name: 'Đợt 1', percent: 90, amount: 90_000_000, condition: 'SIGN', dueDate: null, dueDays: null, status: 'PENDING', note: null }] }),
    );
    await expect(terms.service.confirm(actor(), ID, { revision: 3 })).rejects.toMatchObject({ code: 'PAYMENT_TERMS_TOTAL' });
    const noWarehouse = setup(contract({ warehouseCode: null }));
    await expect(noWarehouse.service.confirm(actor(), ID, { revision: 3 })).rejects.toMatchObject({ code: 'WAREHOUSE_REQUIRED' });
    expect(noWarehouse.inventory.reserve).not.toHaveBeenCalled();
  });

  it('hợp đồng khung không có số lượng: xác nhận không gọi Kho', async () => {
    const { inventory, store, service } = setup(contract({ type: 'FRAMEWORK', lines: [{ ...contract().lines[0], quantity: null, lineAmount: null }] }));
    await service.confirm(actor(), ID, { revision: 3 });
    expect(inventory.reserve).not.toHaveBeenCalled();
    expect(store.confirm).toHaveBeenCalledWith(TENANT, ID, 3, null, USER);
  });

  it('không có quyền hợp đồng: 403; sai revision: 409', async () => {
    const { service } = setup();
    await expect(service.confirm(actor({ canWriteContract: false }), ID, { revision: 3 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.confirm(actor(), ID, { revision: 2 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('huỷ cần lý do, chặn khi đã có đơn giao hàng; huỷ xong gửi lệnh nhả', async () => {
    const active = setup(contract({ status: 'ACTIVE' }));
    await expect(active.service.cancel(actor(), ID, { revision: 3 })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    active.store.hasDeliveredOrders.mockResolvedValueOnce(true);
    await expect(active.service.cancel(actor(), ID, { revision: 3, reason: 'Khách huỷ' })).rejects.toMatchObject({ code: 'CONTRACT_HAS_DELIVERIES' });
    await active.service.cancel(actor(), ID, { revision: 3, reason: 'Khách huỷ' });
    expect(active.store.transition).toHaveBeenCalledWith(TENANT, ID, 3, { from: 'ACTIVE', to: 'CANCELLED', action: 'cancel', reason: 'Khách huỷ' }, USER);
    expect(active.dispatcher.dispatch).toHaveBeenCalledWith(TENANT);
  });

  it('TC-CON-01: tạo ba loại; hợp đồng mua bán bắt buộc số lượng; giá trị mặc định cộng VAT', async () => {
    const { store, service } = setup();
    for (const type of ['SALE', 'FRAMEWORK', 'PRINCIPLE'] as const) {
      await service.create(actor(), {
        type,
        customerId: CUSTOMER,
        title: `HĐ ${type}`,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        lines: [{ materialId: CAP, quantity: type === 'SALE' ? 2 : null, unitPrice: 900_000 }],
      });
    }
    expect(store.createContract.mock.calls.map(([, record]) => [record.type, record.value])).toEqual([
      ['SALE', 1_980_000],
      ['FRAMEWORK', 0],
      ['PRINCIPLE', 0],
    ]);
    await expect(
      service.create(actor(), { type: 'SALE', customerId: CUSTOMER, title: 'X', validFrom: '2026-01-01', lines: [{ materialId: CAP, unitPrice: 1 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.create(actor(), { type: 'SALE', customerId: CUSTOMER, title: 'X', validFrom: '2026-02-01', validTo: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_VALIDITY' });
  });
});
