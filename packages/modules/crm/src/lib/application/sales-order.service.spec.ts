import { CRM_NO_CAPABILITIES, type ContractDetail, type SalesOrderDetail, type SalesOrderLine } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import type { CreditLimitCheck, InventoryClient } from './fulfillment.port.js';
import type { PricingStore } from './pricing-store.port.js';
import { QuoteConversionService } from './quote-conversion.service.js';
import type { SalesOrderStore } from './sales-order-store.port.js';
import { SalesOrderService } from './sales-order.service.js';

const TENANT = 't1';
const CAP = '11111111-1111-4111-8111-111111111111';
const BT = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const CONTRACT = '66666666-6666-4666-8666-666666666666';
const DELIVERY = '77777777-7777-4777-8777-777777777777';
/** Bảng giá Cáp 1.000.000; bảng thứ hai Cáp 1.100.000; bảng đã tắt. */
const PL = 'a0000000-0000-4000-8000-000000000001';
const PL2 = 'a0000000-0000-4000-8000-000000000002';
const PL_OFF = 'a0000000-0000-4000-8000-000000000003';
const PRICE_LISTS = [
  { id: PL, code: 'BG', name: 'Bảng giá', status: 'ACTIVE' as const, price: 1_000_000 },
  { id: PL2, code: 'BG-110', name: 'Bảng giá 110%', status: 'ACTIVE' as const, price: 1_100_000 },
  { id: PL_OFF, code: 'BG-TAT', name: 'Bảng giá đã tắt', status: 'INACTIVE' as const, price: 900_000 },
].map((list) => ({
  id: list.id,
  code: list.code,
  name: list.name,
  listType: 'DERIVED' as const,
  status: list.status,
  validFrom: '2026-01-01',
  validTo: null,
  items: [{ materialId: CAP, unit: 'Cái', price: list.price, vatRate: 10 }],
}));

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: USER,
  displayName: 'Nhân viên',
  canWriteOrder: true,
  ...extra,
});

function line(id: string, materialId: string, code: string, kind: string, quantity: number, extra: Partial<SalesOrderLine> = {}): SalesOrderLine {
  return {
    id,
    lineNo: id === 'l1' ? 1 : 2,
    materialId,
    materialCode: code,
    materialName: code,
    unit: 'Cái',
    materialKind: kind,
    category: null,
    quantity,
    listPrice: 1,
    priceSource: 'STANDARD_LIST',
    priceReferenceCode: null,
    appliedPolicies: [],
    discountPercent: 0,
    overridden: false,
    overrideUnitPrice: null,
    overrideDiscountPercent: null,
    unitPrice: 1,
    grossAmount: 1,
    discountAmount: 0,
    vatRate: 10,
    lineAmount: 1,
    vatAmount: 0,
    lineTotal: 1,
    estUnitCost: null,
    reservedQuantity: 0,
    plannedQuantity: 0,
    deliveredQuantity: 0,
    actualCost: 0,
    serials: [],
    reservationId: null,
    reservationCode: null,
    reservationStatus: null,
    reservationSource: null,
    ...extra,
  };
}

function order(extra: Partial<SalesOrderDetail> = {}): SalesOrderDetail {
  return {
    id: ORDER,
    code: 'DH2600001',
    source: 'DIRECT',
    customerId: CUSTOMER,
    customerCode: 'KH1',
    customerName: 'Khách A',
    contractId: null,
    contractCode: null,
    quoteId: null,
    quoteCode: null,
    status: 'DRAFT',
    orderDate: '2026-10-27',
    expectedDeliveryDate: null,
    totalAmount: 11_000_000,
    ownerUserId: USER,
    late: false,
    updatedAt: '',
    warehouseCode: 'KHO-1',
    deliveryAddress: null,
    note: null,
    infoNote: null,
    infoNotedBy: null,
    infoNotedAt: null,
    priceDate: null,
    priceListId: PL,
    priceListCode: 'BG',
    priceListName: 'Bảng giá',
    priceListStatus: 'ACTIVE',
    shipping: { amount: 0, vatRate: 10 },
    totals: { grossAmount: 0, discountAmount: 0, netAmount: 0, shippingAmount: 0, vatAmount: 0, totalAmount: 11_000_000 },
    revision: 5,
    lines: [line('l1', CAP, 'QA-KHO-CAP', 'STOCK', 10), line('l2', BT, 'QA-KHO-BT', 'SERVICE', 1)],
    deliveries: [],
    reservationExpiresAt: null,
    cancelReason: null,
    closeReason: null,
    history: [],
    createdAt: '',
    ...extra,
  };
}

function setup(detail = order(), contract?: ContractDetail) {
  const store: jest.Mocked<SalesOrderStore> = {
    listOrders: jest.fn(),
    getOrder: jest.fn().mockResolvedValue(detail),
    createOrder: jest.fn().mockResolvedValue(ORDER),
    updateDraft: jest.fn(),
    saveInfoNote: jest.fn().mockResolvedValue(undefined),
    confirm: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    reserveAttempt: jest.fn().mockResolvedValue(1),
    bumpReserveAttempt: jest.fn().mockResolvedValue(undefined),
    contractReservationUsage: jest.fn().mockResolvedValue(new Map()),
    saveDelivery: jest.fn().mockResolvedValue(DELIVERY),
    cancelDelivery: jest.fn(),
    markDeliveryRequested: jest.fn().mockResolvedValue(undefined),
    notifyLateDeliveries: jest.fn(),
  };
  const inventory: jest.Mocked<InventoryClient> = {
    reserve: jest.fn().mockResolvedValue({ reservationId: 'r-id', reservationCode: 'GH001', status: 'RESERVED', expiresAt: '2026-11-03T16:59:59.000Z' }),
    release: jest.fn().mockResolvedValue(undefined),
    createIssueRequest: jest.fn().mockResolvedValue({ documentId: 'doc-1', documentCode: 'PX001', status: 'DRAFT' }),
  };
  const credit: jest.Mocked<CreditLimitCheck> = { evaluate: jest.fn().mockResolvedValue({ outcome: 'ALLOW' }) };
  const pricing: PricingStore = {
    discountCapPercent: async () => 50,
    saveDiscountCapPercent: async () => undefined,
    priceListsForPricing: jest.fn(async (_t: string, _d: string, priceListId: string | null) => PRICE_LISTS.filter((list) => list.id === priceListId)),
    priceListRef: jest.fn(async (_t: string, id: string) => {
      const list = PRICE_LISTS.find((entry) => entry.id === id);
      return list && { id: list.id, code: list.code, name: list.name, listType: list.listType, status: list.status, validFrom: list.validFrom, validTo: list.validTo };
    }),
    policiesForPricing: async () => [],
    pricedMaterials: async () => [],
    contractPricesForPricing: jest.fn(async (_t, _d, _c, _m, contractId?: string | null) =>
      contractId ? [{ contractId, contractCode: 'HD1', materialId: CAP, unit: 'Cái', price: 900_000, vatRate: 10, validFrom: '2026-01-01', validTo: null }] : [],
    ),
  };
  const dispatcher = { dispatch: jest.fn().mockResolvedValue(0) };
  const service = new SalesOrderService(
    store,
    { getContract: jest.fn().mockResolvedValue(contract) },
    { getCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER, groupId: null }) },
    pricing,
    {
      materials: async (_t, ids) =>
        new Map(ids.includes(CAP) ? [[CAP, { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp', unit: 'Cái', category: null, kind: 'STOCK', avgCost: 800_000 }]] : []),
      search: async () => [],
    },
    { resolve: async () => ({ kind: 'all' }) },
    inventory,
    { reservationHoldDays: async () => 7, contractExpiringDays: async () => 30, save: jest.fn() },
    credit,
    dispatcher,
    () => new Date('2026-10-27T03:00:00Z'),
  );
  return { store, inventory, credit, dispatcher, service, pricing };
}

describe('SalesOrderService: xác nhận và giữ hàng (T4-09)', () => {
  it('TC-ORD-03: giữ đúng số lượng, khoá crm-order:<id>, bỏ dòng dịch vụ, ghi mã giữ hàng từng dòng', async () => {
    const { store, inventory, service } = setup();
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(inventory.reserve).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        idempotencyKey: `crm-order:${ORDER}`,
        sourceType: 'crm_order',
        sourceId: ORDER,
        expiresAt: '2026-11-03T16:59:59.000Z',
        lines: [{ materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-1', quantity: 10 }],
      }),
    );
    expect(store.confirm).toHaveBeenCalledWith(TENANT, ORDER, 5, 'DRAFT', {
      expiresAt: '2026-11-03T16:59:59.000Z',
      lines: [{ lineId: 'l1', reservationId: 'r-id', reservationCode: 'GH001', source: 'ORDER', quantity: 10 }],
    }, USER);
  });

  it('hạn giữ = ngày giao dự kiến + 2 ngày khi đơn có ngày giao (Q12)', async () => {
    const { inventory, service } = setup(order({ expectedDeliveryDate: '2026-11-20' }));
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(inventory.reserve.mock.calls[0][1].expiresAt).toBe('2026-11-22T16:59:59.000Z');
  });

  it('Q4: thiếu tồn thì 409 kèm dòng thiếu, đơn giữ Nháp', async () => {
    const { store, inventory, service } = setup();
    inventory.reserve.mockRejectedValue(
      new CrmError('RESERVATION_INSUFFICIENT_STOCK', 'Thiếu', 409, { shortages: [{ materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-1', requested: 10, available: 1 }] }),
    );
    await expect(service.confirm(actor(), ORDER, { revision: 5 })).rejects.toMatchObject({
      statusCode: 409,
      details: { shortages: [expect.objectContaining({ lineNo: 1, available: 1 })] },
    });
    expect(store.confirm).not.toHaveBeenCalled();
  });

  it('ghi đơn lỗi sau khi giữ: nhả lại, đổi khoá', async () => {
    const { store, inventory, service } = setup();
    store.confirm.mockRejectedValue(new CrmError('STALE_VERSION', 'cũ', 409));
    await expect(service.confirm(actor(), ORDER, { revision: 5 })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(inventory.release).toHaveBeenCalledWith(TENANT, 'GH001');
    expect(store.bumpReserveAttempt).toHaveBeenCalled();
  });

  it('điểm mở rộng hạn mức (T5-10): chặn thì 409; cần duyệt thì sang Chờ duyệt hạn mức, không giữ hàng', async () => {
    const blocked = setup();
    blocked.credit.evaluate.mockResolvedValue({ outcome: 'BLOCK', message: 'Vượt hạn mức công nợ.' });
    await expect(blocked.service.confirm(actor(), ORDER, { revision: 5 })).rejects.toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED' });
    const approval = setup();
    approval.credit.evaluate.mockResolvedValue({ outcome: 'APPROVAL', message: 'Cần duyệt.' });
    await approval.service.confirm(actor(), ORDER, { revision: 5 });
    expect(approval.store.transition).toHaveBeenCalledWith(TENANT, ORDER, 5, expect.objectContaining({ to: 'CREDIT_PENDING' }), USER);
    expect(approval.inventory.reserve).not.toHaveBeenCalled();
  });

  it('đơn từ hợp đồng đang giữ đủ ở cùng kho dùng phần giữ của hợp đồng, không giữ thêm', async () => {
    const contract = {
      id: CONTRACT,
      code: 'HD1',
      status: 'ACTIVE',
      validFrom: '2026-01-01',
      validTo: null,
      warehouseCode: 'KHO-1',
      reservation: { reservationId: 'rc', reservationCode: 'GHK', status: 'HELD', expiresAt: null },
      lines: [{ materialId: CAP, materialKind: 'STOCK', quantity: 15 }],
    } as unknown as ContractDetail;
    const { store, inventory, service } = setup(order({ contractId: CONTRACT, source: 'CONTRACT' }), contract);
    store.contractReservationUsage.mockResolvedValue(new Map([[CAP, 5]]));
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(inventory.reserve).not.toHaveBeenCalled();
    expect(store.confirm.mock.calls[0][4].lines).toEqual([{ lineId: 'l1', reservationId: 'rc', reservationCode: 'GHK', source: 'CONTRACT', quantity: 10 }]);
    // Phần còn lại của hợp đồng không đủ: đơn tự giữ.
    store.contractReservationUsage.mockResolvedValue(new Map([[CAP, 6]]));
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
  });

  it('TC-UAT-01 bước 10: đơn chuyển từ báo giá chưa có kho lấy kho của hợp đồng rồi dùng phần giữ của hợp đồng', async () => {
    const contract = {
      id: CONTRACT,
      code: 'HD1',
      status: 'ACTIVE',
      validFrom: '2026-01-01',
      validTo: null,
      warehouseCode: 'KHO-1',
      reservation: { reservationId: 'rc', reservationCode: 'GHK', status: 'HELD', expiresAt: null },
      lines: [{ materialId: CAP, materialKind: 'STOCK', quantity: 10 }],
    } as unknown as ContractDetail;
    const draft = order({ contractId: CONTRACT, source: 'QUOTE', warehouseCode: null });
    const { store, inventory, service } = setup(draft, contract);
    store.getOrder.mockResolvedValueOnce(draft).mockResolvedValueOnce({ ...draft, warehouseCode: 'KHO-1', revision: 6 });
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(store.updateDraft).toHaveBeenCalledWith(TENANT, ORDER, 5, expect.objectContaining({ warehouseCode: 'KHO-1' }), undefined, USER);
    expect(inventory.reserve).not.toHaveBeenCalled();
    expect(store.confirm).toHaveBeenCalledWith(TENANT, ORDER, 6, 'DRAFT', expect.objectContaining({
      lines: [{ lineId: 'l1', reservationId: 'rc', reservationCode: 'GHK', source: 'CONTRACT', quantity: 10 }],
    }), USER);
  });

  it('TC-CON-03: đơn từ hợp đồng hết hạn bị chặn', async () => {
    const contract = { id: CONTRACT, code: 'HD1', status: 'EXPIRED', validFrom: '2026-01-01', validTo: '2026-06-30' } as unknown as ContractDetail;
    const { service } = setup(order(), contract);
    await expect(service.create(actor(), { contractId: CONTRACT })).rejects.toMatchObject({ statusCode: 409, message: 'Hợp đồng đã hết hiệu lực.' });
  });

  it('TC-CON-02: đơn từ hợp đồng khung tính giá khung (nguồn Hợp đồng)', async () => {
    const contract = { id: CONTRACT, code: 'HD1', status: 'ACTIVE', validFrom: '2026-01-01', validTo: null, customerId: CUSTOMER, ownerUserId: USER, warehouseCode: null } as unknown as ContractDetail;
    const { store, service } = setup(order(), contract);
    await service.create(actor(), { contractId: CONTRACT, priceListId: PL, lines: [{ materialId: CAP, quantity: 2 }] });
    const record = store.createOrder.mock.calls[0][1];
    expect(record).toMatchObject({ source: 'CONTRACT', contractId: CONTRACT, customerId: CUSTOMER, priceListId: PL });
    expect(record.lines[0]).toMatchObject({ priceSource: 'CONTRACT', listPrice: 900_000, unitPrice: 900_000, lineAmount: 1_800_000, estUnitCost: 800_000 });
  });

  it('không có quyền đơn bán: 403', async () => {
    const { service } = setup();
    await expect(service.confirm(actor({ canWriteOrder: false }), ORDER, { revision: 5 })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('SalesOrderService: ghi chú thông tin đơn hàng (P2F-03)', () => {
  it('TC-CARE-08: cắt khoảng trắng, rỗng là xoá, gửi revision và người ghi cho store; sửa được khi đã xác nhận', async () => {
    const { store, service } = setup(order({ status: 'CONFIRMED' }));
    await service.saveInfoNote(actor(), ORDER, { revision: 5, infoNote: '  Giao giờ hành chính  ' });
    expect(store.saveInfoNote).toHaveBeenCalledWith(TENANT, ORDER, 5, 'Giao giờ hành chính', USER);
    await service.saveInfoNote(actor(), ORDER, { revision: 5, infoNote: ' ' });
    expect(store.saveInfoNote).toHaveBeenLastCalledWith(TENANT, ORDER, 5, null, USER);
  });

  it('không quyền đơn bán 403; quá 4000 ký tự 400; đơn huỷ 409; thiếu revision báo lỗi', async () => {
    const { store, service } = setup();
    await expect(service.saveInfoNote(actor({ canWriteOrder: false }), ORDER, { revision: 5, infoNote: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.saveInfoNote(actor(), ORDER, { revision: 5, infoNote: 'x'.repeat(4001) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.saveInfoNote(actor(), ORDER, { infoNote: 'x' } as never)).rejects.toBeInstanceOf(CrmError);
    const cancelled = setup(order({ status: 'CANCELLED' }));
    await expect(cancelled.service.saveInfoNote(actor(), ORDER, { revision: 5, infoNote: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    expect(store.saveInfoNote).not.toHaveBeenCalled();
    expect(cancelled.store.saveInfoNote).not.toHaveBeenCalled();
  });
});

describe('SalesOrderService: huỷ, đóng, đợt giao, yêu cầu xuất', () => {
  it('huỷ cần lý do; huỷ xong gửi ngay lệnh nhả giữ hàng', async () => {
    const { store, dispatcher, service } = setup(order({ status: 'PARTIAL' }));
    await expect(service.cancel(actor(), ORDER, { revision: 5 })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await service.cancel(actor(), ORDER, { revision: 5, reason: 'Khách đổi ý' });
    expect(store.cancel).toHaveBeenCalledWith(TENANT, ORDER, 5, 'PARTIAL', 'Khách đổi ý', USER);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(TENANT);
  });

  it('đã giao đủ không huỷ được; đóng tay cần quản lý và lý do', async () => {
    const delivered = setup(order({ status: 'DELIVERED' }));
    await expect(delivered.service.cancel(actor(), ORDER, { revision: 5, reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(delivered.service.close(actor(), ORDER, { revision: 5, reason: 'Xoá nợ' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(delivered.service.close(actor({ canReadAll: true }), ORDER, { revision: 5 })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await delivered.service.close(actor({ canReadAll: true }), ORDER, { revision: 5, reason: 'Xoá nợ bằng điều chỉnh' });
    expect(delivered.store.transition).toHaveBeenCalledWith(TENANT, ORDER, 5, expect.objectContaining({ to: 'DONE', action: 'close' }), USER);
  });

  it('TC-ORD-05: tổng các đợt vượt số lượng đơn trả 400', async () => {
    const existing = order({
      deliveries: [
        {
          id: DELIVERY, code: 'DH-01', seq: 1, plannedDate: '2026-11-01', warehouseCode: 'KHO-1', address: null, note: null, status: 'PLANNED',
          issueDocumentId: null, issueDocumentCode: null, requestedAt: null, issuedAt: null, late: false,
          lines: [{ id: 'dl1', orderLineId: 'l1', lineNo: 1, materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: '', unit: 'Cái', materialKind: 'STOCK', plannedQuantity: 4, deliveredQuantity: 0, actualCost: 0, serials: [] }],
        },
      ],
    });
    const { store, service } = setup(existing);
    await expect(
      service.saveDelivery(actor(), ORDER, null, { revision: 5, plannedDate: '2026-11-05', lines: [{ orderLineId: 'l1', quantity: 7 }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Tổng số lượng các đợt vượt số lượng đơn.' });
    await service.saveDelivery(actor(), ORDER, null, { revision: 5, plannedDate: '2026-11-05', address: 'Kho khách B', lines: [{ orderLineId: 'l1', quantity: 6 }] });
    expect(store.saveDelivery).toHaveBeenCalledWith(TENANT, ORDER, 5, null, expect.objectContaining({ warehouseCode: 'KHO-1', address: 'Kho khách B', lines: [{ orderLineId: 'l1', quantity: 6 }] }), USER);
  });

  it('TC-ORD-06/10: yêu cầu xuất chỉ gửi dòng hàng tồn kho, khoá crm-delivery:<id>, trừ vào phần đã giữ', async () => {
    const withDelivery = order({
      status: 'CONFIRMED',
      lines: [
        line('l1', CAP, 'QA-KHO-CAP', 'STOCK', 10, { reservationId: 'r-id', reservationCode: 'GH001', reservationStatus: 'HELD', reservedQuantity: 10 }),
        line('l2', BT, 'QA-KHO-BT', 'SERVICE', 1),
      ],
      deliveries: [
        {
          id: DELIVERY, code: 'DH-01', seq: 1, plannedDate: '2026-11-01', warehouseCode: 'KHO-1', address: null, note: null, status: 'PLANNED',
          issueDocumentId: null, issueDocumentCode: null, requestedAt: null, issuedAt: null, late: false,
          lines: [
            { id: 'dl1', orderLineId: 'l1', lineNo: 1, materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: '', unit: 'Cái', materialKind: 'STOCK', plannedQuantity: 4, deliveredQuantity: 0, actualCost: 0, serials: [] },
            { id: 'dl2', orderLineId: 'l2', lineNo: 2, materialId: BT, materialCode: 'QA-KHO-BT', materialName: '', unit: 'Gói', materialKind: 'SERVICE', plannedQuantity: 1, deliveredQuantity: 0, actualCost: 0, serials: [] },
          ],
        },
      ],
    });
    const { store, inventory, service } = setup(withDelivery);
    await service.requestIssue(actor(), ORDER, DELIVERY, { revision: 5 });
    expect(inventory.createIssueRequest).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      idempotencyKey: `crm-delivery:${DELIVERY}`,
      sourceType: 'crm_delivery',
      sourceId: DELIVERY,
      warehouseCode: 'KHO-1',
      lines: [{ materialCode: 'QA-KHO-CAP', quantity: 4, reservationId: 'r-id' }],
    }));
    expect(store.markDeliveryRequested).toHaveBeenCalledWith(TENANT, ORDER, 5, DELIVERY, { documentId: 'doc-1', documentCode: 'PX001' }, USER);
  });

  it('đơn chưa xác nhận không yêu cầu xuất được', async () => {
    const { service } = setup();
    await expect(service.requestIssue(actor(), ORDER, DELIVERY, { revision: 5 })).rejects.toMatchObject({ code: 'ORDER_NOT_CONFIRMED' });
  });

  it('đơn từ báo giá không đổi dòng, giá', async () => {
    const { service } = setup(order({ source: 'QUOTE' }));
    await expect(service.update(actor(), ORDER, { revision: 5, lines: [] })).rejects.toMatchObject({ code: 'ORDER_LINES_LOCKED' });
  });
});

describe('SalesOrderService: bảng giá của đơn (A7)', () => {
  const contract = {
    id: CONTRACT,
    code: 'HD1',
    status: 'ACTIVE',
    validFrom: '2026-01-01',
    validTo: null,
    customerId: CUSTOMER,
    ownerUserId: USER,
    warehouseCode: null,
  } as unknown as ContractDetail;

  it('A7.1: đơn trực tiếp có dòng, không có bảng giá: PRICE_LIST_REQUIRED, không ghi', async () => {
    const { store, service } = setup();
    await expect(service.create(actor(), { customerId: CUSTOMER, lines: [{ materialId: CAP, quantity: 1 }] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRICE_LIST_REQUIRED',
    });
    expect(store.createOrder).not.toHaveBeenCalled();
  });

  it('A7.2: đơn trực tiếp không dòng, không bảng giá: tạo được (chỉ phí vận chuyển)', async () => {
    const { store, service } = setup();
    await service.create(actor(), { customerId: CUSTOMER, shipping: { amount: 100_000 } });
    expect(store.createOrder.mock.calls[0][1]).toMatchObject({ source: 'DIRECT', priceListId: null, lines: [], totals: { totalAmount: 110_000 } });
  });

  it('đơn trực tiếp chọn bảng giá: giá theo bảng đã chọn; bảng sai, không có, đã tắt thì 400', async () => {
    const { store, service } = setup();
    await service.create(actor(), { customerId: CUSTOMER, priceListId: PL2, lines: [{ materialId: CAP, quantity: 1 }] });
    expect(store.createOrder.mock.calls[0][1]).toMatchObject({ priceListId: PL2, lines: [{ listPrice: 1_100_000, priceSource: 'GROUP_LIST' }] });
    const create = (priceListId: string) => service.create(actor(), { customerId: CUSTOMER, priceListId, lines: [{ materialId: CAP, quantity: 1 }] });
    await expect(create('x')).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    await expect(create('a0000000-0000-4000-8000-000000000099')).rejects.toMatchObject({ code: 'PRICE_LIST_NOT_FOUND' });
    await expect(create(PL_OFF)).rejects.toMatchObject({ code: 'PRICE_LIST_NOT_EFFECTIVE' });
  });

  it('A7.3, A7.4: đơn từ hợp đồng bắt buộc bảng giá; dòng có giá hợp đồng vẫn lấy giá hợp đồng', async () => {
    const { store, service } = setup(order(), contract);
    await expect(service.create(actor(), { contractId: CONTRACT, lines: [{ materialId: CAP, quantity: 1 }] })).rejects.toMatchObject({
      code: 'PRICE_LIST_REQUIRED',
    });
    await service.create(actor(), { contractId: CONTRACT, priceListId: PL2, lines: [{ materialId: CAP, quantity: 1 }] });
    expect(store.createOrder.mock.calls[0][1]).toMatchObject({ priceListId: PL2, lines: [{ priceSource: 'CONTRACT', listPrice: 900_000 }] });
  });

  it('A7.5: đơn từ báo giá giữ bảng giá của báo giá: priceListId gửi kèm bị bỏ qua, không tính lại', async () => {
    const { store, service, pricing } = setup(order({ source: 'QUOTE' }));
    await service.update(actor(), ORDER, { revision: 5, priceListId: PL2, note: 'Ghi chú' });
    expect(store.updateDraft).toHaveBeenCalledWith(
      TENANT,
      ORDER,
      5,
      expect.objectContaining({ priceListId: PL, note: 'Ghi chú', totals: order().totals }),
      undefined,
      USER,
      undefined,
    );
    expect(pricing.priceListsForPricing).not.toHaveBeenCalled();
  });

  it('A7.6: sửa đơn nháp đổi bảng giá: tính lại dòng theo bảng mới', async () => {
    const { store, service } = setup(order({ lines: [line('l1', CAP, 'QA-KHO-CAP', 'STOCK', 2)] }));
    await service.update(actor(), ORDER, { revision: 5, priceListId: PL2 });
    const [, , , header, lines] = store.updateDraft.mock.calls[0];
    expect(header).toMatchObject({ priceListId: PL2, totals: { netAmount: 2_200_000 } });
    // Không gửi dòng thì giữ dòng (chỉ ghi lại tổng).
    expect(lines).toBeUndefined();
    await expect(service.update(actor(), ORDER, { revision: 5, priceListId: null })).rejects.toMatchObject({ code: 'PRICE_LIST_REQUIRED' });
    await expect(service.update(actor(), ORDER, { revision: 5, priceListId: PL_OFF })).rejects.toMatchObject({ code: 'PRICE_LIST_NOT_EFFECTIVE' });
  });

  it('A7.7: chỉ đổi kho giữ hàng theo dòng: không tính lại giá, không đòi bảng giá', async () => {
    const { store, service, pricing } = setup(order({ priceListId: null, priceListCode: null, priceListName: null, priceListStatus: null }));
    await service.update(actor(), ORDER, { revision: 5, lineWarehouses: [{ lineId: 'l1', warehouseCode: 'kho-2' }] });
    expect(store.updateDraft).toHaveBeenCalledWith(
      TENANT,
      ORDER,
      5,
      expect.objectContaining({ priceListId: null }),
      undefined,
      USER,
      [{ lineId: 'l1', warehouseCode: 'KHO-2' }],
    );
    expect(pricing.priceListsForPricing).not.toHaveBeenCalled();
    expect(pricing.priceListRef).not.toHaveBeenCalled();
  });

  it('A7.8: đơn không còn Nháp: không đổi được bảng giá (409)', async () => {
    const { store, service } = setup(order({ status: 'CONFIRMED' }));
    await expect(service.update(actor(), ORDER, { revision: 5, priceListId: PL2 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORDER_NOT_EDITABLE',
    });
    expect(store.updateDraft).not.toHaveBeenCalled();
  });
});

describe('QuoteConversionService (TC-QUO-12)', () => {
  it('báo giá chưa khách chấp nhận trả 409; đã chấp nhận thì chuyển với đợt giao sau 7 ngày', async () => {
    const conversion = { convert: jest.fn().mockResolvedValue({ created: true }) };
    const quotes = { getQuote: jest.fn().mockResolvedValue({ status: 'PENDING', convertedAt: null }) };
    const service = new QuoteConversionService(conversion, quotes, { resolve: async () => ({ kind: 'all' }) }, () => new Date('2026-10-27T03:00:00Z'));
    await expect(service.convert(actor(), ORDER)).rejects.toMatchObject({ statusCode: 409, code: 'QUOTE_NOT_ACCEPTED' });
    quotes.getQuote.mockResolvedValue({ status: 'ACCEPTED', convertedAt: null });
    await service.convert(actor(), ORDER);
    expect(conversion.convert).toHaveBeenCalledWith(TENANT, ORDER, { today: '2026-10-27', plannedDate: '2026-11-03' }, USER);
    await expect(service.convert(actor({ canWriteOrder: false }), ORDER)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('SalesOrderService: kho giữ hàng theo từng dòng (D3-37)', () => {
  const MUC = '33333333-3333-4333-8333-333333333333';
  const twoWarehouses = (extra: Partial<SalesOrderDetail> = {}) =>
    order({
      lines: [line('l1', CAP, 'QA-KHO-CAP', 'STOCK', 10, { warehouseCode: 'KHO-2' }), { ...line('l2', MUC, 'QA-KHO-MUC', 'STOCK', 3), lineNo: 2 }],
      ...extra,
    });

  it('xác nhận giữ mỗi dòng ở kho của dòng, dòng không chọn kho theo kho mặc định', async () => {
    const { inventory, service } = setup(twoWarehouses());
    await service.confirm(actor(), ORDER, { revision: 5 });
    expect(inventory.reserve.mock.calls[0][1].lines).toEqual([
      { materialCode: 'QA-KHO-CAP', warehouseCode: 'KHO-2', quantity: 10 },
      { materialCode: 'QA-KHO-MUC', warehouseCode: 'KHO-1', quantity: 3 },
    ]);
  });

  it('không có kho mặc định: báo đúng dòng thiếu kho, không gọi Kho', async () => {
    const { inventory, service } = setup(twoWarehouses({ warehouseCode: null }));
    await expect(service.confirm(actor(), ORDER, { revision: 5 })).rejects.toMatchObject({
      code: 'WAREHOUSE_REQUIRED',
      message: expect.stringContaining('dòng 2 (QA-KHO-MUC)'),
    });
    expect(inventory.reserve).not.toHaveBeenCalled();
  });

  it('phần giữ của hợp đồng chỉ dùng cho dòng cùng kho với dòng hợp đồng', async () => {
    const contract = {
      id: CONTRACT,
      code: 'HD1',
      status: 'ACTIVE',
      validFrom: '2026-01-01',
      validTo: null,
      warehouseCode: 'KHO-1',
      reservation: { reservationId: 'rc', reservationCode: 'GHK', status: 'HELD', expiresAt: null },
      lines: [{ materialId: CAP, materialKind: 'STOCK', quantity: 15, warehouseCode: 'KHO-2' }],
    } as unknown as ContractDetail;
    const sameWarehouse = setup(order({ contractId: CONTRACT, source: 'CONTRACT', lines: [line('l1', CAP, 'QA-KHO-CAP', 'STOCK', 10, { warehouseCode: 'KHO-2' })] }), contract);
    sameWarehouse.store.contractReservationUsage.mockResolvedValue(new Map());
    await sameWarehouse.service.confirm(actor(), ORDER, { revision: 5 });
    expect(sameWarehouse.inventory.reserve).not.toHaveBeenCalled();
    const otherWarehouse = setup(order({ contractId: CONTRACT, source: 'CONTRACT' }), contract);
    otherWarehouse.store.contractReservationUsage.mockResolvedValue(new Map());
    await otherWarehouse.service.confirm(actor(), ORDER, { revision: 5 });
    expect(otherWarehouse.inventory.reserve).toHaveBeenCalledTimes(1);
  });

  it('đợt giao có hàng ở nhiều kho mà chưa chọn kho xuất: báo tách đợt theo kho', async () => {
    const confirmed = twoWarehouses({
      status: 'CONFIRMED',
      deliveries: [
        {
          id: DELIVERY, code: 'DH-01', seq: 1, plannedDate: '2026-11-01', warehouseCode: null, address: null, note: null, status: 'PLANNED',
          issueDocumentId: null, issueDocumentCode: null, requestedAt: null, issuedAt: null, late: false,
          lines: [
            { id: 'dl1', orderLineId: 'l1', lineNo: 1, materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: '', unit: 'Cái', materialKind: 'STOCK', plannedQuantity: 4, deliveredQuantity: 0, actualCost: 0, serials: [] },
            { id: 'dl2', orderLineId: 'l2', lineNo: 2, materialId: MUC, materialCode: 'QA-KHO-MUC', materialName: '', unit: 'Cái', materialKind: 'STOCK', plannedQuantity: 1, deliveredQuantity: 0, actualCost: 0, serials: [] },
          ],
        },
      ],
    });
    const { inventory, service } = setup(confirmed);
    await expect(service.requestIssue(actor(), ORDER, DELIVERY, { revision: 5 })).rejects.toMatchObject({
      code: 'WAREHOUSE_REQUIRED',
      message: expect.stringContaining('KHO-2, KHO-1'),
    });
    expect(inventory.createIssueRequest).not.toHaveBeenCalled();
  });
});
