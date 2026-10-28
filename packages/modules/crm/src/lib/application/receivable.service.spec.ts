import { CRM_NO_CAPABILITIES, type OrderCreditRequest, type ReceivableAdjustment } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import { CreditApprovalService, CreditLimitService } from './credit-limit.service.js';
import type { CrmActor } from './crm-actor.js';
import { ReceivableAdjustmentService } from './receivable-adjustment.service.js';
import type { CreditStore, ReceivableStore } from './receivable-store.port.js';
import { ReceivableService } from './receivable.service.js';

const TENANT = 'tenant-1';
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const RECEIPT = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const ADJUSTMENT = '55555555-5555-4555-8555-555555555555';

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: 'kt-1',
  displayName: 'Kế toán',
  canWriteReceivable: true,
  ...extra,
});

function fakeStore(): jest.Mocked<ReceivableStore> {
  return {
    agingReport: jest.fn(),
    ledger: jest.fn().mockResolvedValue({ customerId: CUSTOMER }),
    listReceipts: jest.fn(),
    getReceipt: jest.fn().mockResolvedValue({ id: RECEIPT, amount: 4_000_000, method: 'CASH', receiptDate: '2026-10-27', note: null, allocations: [] }),
    createReceipt: jest.fn().mockResolvedValue(RECEIPT),
    resendReceipt: jest.fn(),
    cancelReceipt: jest.fn(),
    listAdjustments: jest.fn(),
    getAdjustment: jest.fn(),
    createAdjustment: jest.fn().mockResolvedValue({ id: ADJUSTMENT, created: true }),
    approveAdjustment: jest.fn(),
    cancelAdjustment: jest.fn(),
    settings: jest.fn().mockResolvedValue({ recognitionMode: 'ON_DELIVERY', creditLimitMode: 'APPROVAL', alertUserIds: [] }),
    saveSettings: jest.fn(),
    triggerPaymentTerm: jest.fn(),
  };
}

const scopes = { resolve: async () => ({ kind: 'all' as const }) };

describe('ReceivableService', () => {
  it('ghi nhận thu tiền: kiểm phân bổ, lưu, gửi Tài chính ngay', async () => {
    const store = fakeStore();
    const dispatcher = { dispatch: jest.fn().mockResolvedValue(1) };
    const service = new ReceivableService(store, scopes, dispatcher, () => new Date('2026-10-27T03:00:00Z'));
    await service.createReceipt(actor(), {
      customerId: CUSTOMER,
      amount: 4_000_000,
      method: 'CASH',
      allocations: [{ entryId: ENTRY, amount: 3_000_000 }],
    });
    expect(store.createReceipt).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ amount: 4_000_000, receiptDate: '2026-10-27', allocations: [{ entryId: ENTRY, amount: 3_000_000 }] }),
      'kt-1',
    );
    expect(dispatcher.dispatch).toHaveBeenCalledWith(TENANT);
  });

  it('Tài chính không phản hồi (TC-INT-08): lần thu vẫn ghi, lỗi gửi không làm hỏng thao tác', async () => {
    const store = fakeStore();
    const dispatcher = { dispatch: jest.fn().mockRejectedValue(new CrmError('FINANCE_UNAVAILABLE', 'x', 503)) };
    const service = new ReceivableService(store, scopes, dispatcher);
    await expect(service.createReceipt(actor(), { customerId: CUSTOMER, amount: 1, method: 'CASH', allocations: [] })).resolves.toBeTruthy();
  });

  it('không có quyền thu tiền thì 403; phân bổ vượt số thu thì 400 trước khi ghi', async () => {
    const store = fakeStore();
    const service = new ReceivableService(store, scopes, { dispatch: jest.fn() });
    await expect(service.createReceipt(actor({ canWriteReceivable: false }), { customerId: CUSTOMER, amount: 1, method: 'CASH', allocations: [] })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.createReceipt(actor(), { customerId: CUSTOMER, amount: 1_000_000, method: 'CASH', allocations: [{ entryId: ENTRY, amount: 1_200_000 }] }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'ALLOCATION_EXCEEDS_RECEIPT' });
    expect(store.createReceipt).not.toHaveBeenCalled();
  });

  it('cấu hình chỉ quản trị bán hàng được lưu; người nhận phải là id hợp lệ', async () => {
    const store = fakeStore();
    const service = new ReceivableService(store, scopes, { dispatch: jest.fn() });
    await expect(service.saveSettings(actor(), { creditLimitMode: 'BLOCK' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.saveSettings(actor({ canManage: true }), { alertUserIds: ['x'] })).rejects.toMatchObject({ statusCode: 400 });
    await service.saveSettings(actor({ canManage: true }), { creditLimitMode: 'BLOCK', alertUserIds: [CUSTOMER] });
    expect(store.saveSettings).toHaveBeenCalledWith(TENANT, { recognitionMode: 'ON_DELIVERY', creditLimitMode: 'BLOCK', alertUserIds: [CUSTOMER] }, 'kt-1');
  });
});

describe('ReceivableAdjustmentService', () => {
  const adjustment = (createdBy: string): ReceivableAdjustment =>
    ({ id: ADJUSTMENT, createdBy, status: 'DRAFT', revision: 1 }) as ReceivableAdjustment;

  it('người lập không tự duyệt; người không thấy toàn bộ không duyệt được (AR-05)', async () => {
    const store = fakeStore();
    store.getAdjustment.mockResolvedValue(adjustment('kt-1'));
    const service = new ReceivableAdjustmentService(store, scopes);
    await expect(service.approve(actor(), ADJUSTMENT, { revision: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.approve(actor({ canManage: true }), ADJUSTMENT, { revision: 1 })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Người lập điều chỉnh không được tự duyệt.',
    });
    await service.approve(actor({ userId: 'ql-1', canReadAll: true }), ADJUSTMENT, { revision: 1 });
    expect(store.approveAdjustment).toHaveBeenCalledWith(TENANT, ADJUSTMENT, 1, 'ql-1', expect.any(String));
  });

  it('cổng cho bảo hành: mặc định giảm trừ, idempotent theo nguồn', async () => {
    const store = fakeStore();
    store.getAdjustment.mockResolvedValue(adjustment('nv-bh'));
    store.createAdjustment.mockResolvedValueOnce({ id: ADJUSTMENT, created: false });
    const service = new ReceivableAdjustmentService(store, scopes);
    const result = await service.createAdjustment({
      customerId: CUSTOMER,
      amount: 500_000,
      reason: 'Trả hàng bảo hành',
      sourceType: 'crm_warranty_case',
      sourceId: 'case-1',
      actor: { tenantId: TENANT, userId: 'nv-bh' },
    });
    expect(result.created).toBe(false);
    expect(store.createAdjustment).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ direction: 'DECREASE', amount: 500_000, sourceType: 'crm_warranty_case', sourceId: 'case-1' }),
      'nv-bh',
    );
  });
});

describe('Hạn mức công nợ', () => {
  function creditStore(): jest.Mocked<CreditStore> {
    return {
      snapshot: jest.fn().mockResolvedValue({ customerCode: 'KH1', creditLimit: 100, balance: 80, approvedAmount: null }),
      creditLimitMode: jest.fn().mockResolvedValue('APPROVAL'),
      requestApproval: jest.fn().mockResolvedValue({ requestId: 'r-1', linkId: 'l-1' }),
      latestRequest: jest.fn(),
      decide: jest.fn().mockResolvedValue('applied'),
      returnToDraft: jest.fn(),
      approvedAwaitingConfirmation: jest.fn().mockResolvedValue([]),
    };
  }

  it('vượt hạn mức theo cấu hình; gửi duyệt qua Quy trình thì tạo phiên ngay sau commit', async () => {
    const store = creditStore();
    const links = { start: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditLimitService(store, links);
    await expect(service.evaluate({ tenantId: TENANT, customerId: CUSTOMER, orderId: ORDER, orderAmount: 21 })).resolves.toMatchObject({ outcome: 'APPROVAL' });
    store.creditLimitMode.mockResolvedValue('BLOCK');
    await expect(service.evaluate({ tenantId: TENANT, customerId: CUSTOMER, orderId: ORDER, orderAmount: 21 })).resolves.toMatchObject({ outcome: 'BLOCK' });
    await service.requestApproval({ tenantId: TENANT, orderId: ORDER, revision: 2, actorId: 'nv', orderAmount: 21, message: 'm' });
    expect(links.start).toHaveBeenCalledWith(TENANT, 'l-1');
  });

  const pending: OrderCreditRequest = {
    id: 'r-1',
    status: 'PENDING',
    mode: 'DIRECT',
    orderAmount: 21,
    balance: 80,
    creditLimit: 100,
    message: null,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    procedureInstanceCode: null,
    createdAt: '',
  };

  it('duyệt trực tiếp: chỉ quản lý kinh doanh; duyệt xong giữ hàng; thiếu tồn thì đơn về Nháp', async () => {
    const store = creditStore();
    store.latestRequest.mockResolvedValue(pending);
    const orders = {
      get: jest.fn().mockResolvedValue({ id: ORDER, status: 'CREDIT_PENDING' }),
      confirmAfterCreditApproval: jest.fn().mockRejectedValue(new CrmError('RESERVATION_INSUFFICIENT_STOCK', 'Không đủ tồn.', 409)),
    };
    const service = new CreditApprovalService(store, orders);
    await expect(service.decide(actor(), ORDER, true, {})).rejects.toMatchObject({ statusCode: 403 });
    await service.decide(actor({ canReadAll: true }), ORDER, true, {});
    expect(store.decide).toHaveBeenCalledWith(TENANT, 'r-1', { approve: true, actorId: 'kt-1', note: null });
    expect(store.returnToDraft).toHaveBeenCalledWith(TENANT, ORDER, expect.stringContaining('Không đủ tồn.'), 'kt-1');
  });

  it('từ chối phải có lý do; yêu cầu đi Quy trình thì không duyệt tay', async () => {
    const store = creditStore();
    store.latestRequest.mockResolvedValue(pending);
    const orders = { get: jest.fn().mockResolvedValue({ id: ORDER, status: 'CREDIT_PENDING' }), confirmAfterCreditApproval: jest.fn() };
    const service = new CreditApprovalService(store, orders);
    await expect(service.decide(actor({ canManage: true }), ORDER, false, {})).rejects.toMatchObject({ statusCode: 400 });
    store.latestRequest.mockResolvedValue({ ...pending, mode: 'PROCEDURE', procedureInstanceCode: 'QT01' });
    await expect(service.decide(actor({ canManage: true }), ORDER, true, {})).rejects.toMatchObject({ code: 'CREDIT_VIA_PROCEDURE' });
  });

  it('lỗi hạ tầng khi giữ hàng sau duyệt thì ném ra để thử lại, không đưa đơn về Nháp', async () => {
    const store = creditStore();
    const orders = { get: jest.fn(), confirmAfterCreditApproval: jest.fn().mockRejectedValue(new CrmError('INVENTORY_UNAVAILABLE', 'x', 503)) };
    const service = new CreditApprovalService(store, orders);
    await expect(service.confirmApproved(TENANT, ORDER, null)).rejects.toMatchObject({ statusCode: 503 });
    expect(store.returnToDraft).not.toHaveBeenCalled();
  });
});
