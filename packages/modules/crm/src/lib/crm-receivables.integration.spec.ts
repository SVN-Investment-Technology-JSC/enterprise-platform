import { randomUUID } from 'node:crypto';
import {
  CRM_CONTRACT_RESERVATION_RELEASED,
  CRM_CUSTOMER_CREDIT_EXCEEDED,
  CRM_NO_CAPABILITIES,
  CRM_ORDER_CREDIT_APPROVAL_REDIRECTED,
  CRM_RECEIVABLE_OVERDUE,
  type SalesOrderDetail,
} from '@enterprise-platform/contracts-crm';
import { CustomerTimelineService } from './application/activity.service.js';
import { ContractService } from './application/contract.service.js';
import { CreditApprovalService, CreditLimitService } from './application/credit-limit.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import type { InventoryClient, IssueRequestInput, ReserveStockRequest, ReservedStock } from './application/fulfillment.port.js';
import { PriceListService } from './application/price-list.service.js';
import { vietnamToday } from './application/pricing.service.js';
import type { CatalogMaterial, CatalogReader } from './application/pricing-store.port.js';
import { ReceivableAdjustmentService } from './application/receivable-adjustment.service.js';
import type { FinanceClient, FinanceReceiptVoucherRequest, FinanceVoucherState } from './application/receivable-store.port.js';
import { ReceivableService } from './application/receivable.service.js';
import { SalesOrderService } from './application/sales-order.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { CrmError } from './domain/crm.error.js';
import { addDays } from './domain/receivables.js';
import { applyFinanceVoucherEvent, FINANCE_VOUCHER_POSTED, FINANCE_VOUCHER_RETURNED, FINANCE_VOUCHER_STATUS_CHANGED } from './infrastructure/finance-events.js';
import { PostgresIntegrationRequests } from './infrastructure/integration-requests.js';
import { applyStockIssued } from './infrastructure/inventory-events.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './infrastructure/postgres-contract.store.js';
import { PROCEDURE_START_MAX_ATTEMPTS } from './infrastructure/quote-procedure-links.js';
import { applyOrderCreditProcedureResult, PostgresCreditStore } from './infrastructure/postgres-credit.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresPriceListStore, PostgresPricingStore } from './infrastructure/postgres-pricing.store.js';
import { PostgresReceivableStore } from './infrastructure/postgres-receivable.store.js';
import { PostgresSalesOrderStore } from './infrastructure/postgres-sales-order.store.js';
import { insertReceivableEntry, recognizeDateTerms } from './infrastructure/receivable-recognition.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

const CAP = randomUUID();
const BT = randomUUID();
const NV = randomUUID();
const KT = randomUUID();
const QL = randomUUID();

class FakeCatalog implements CatalogReader {
  readonly known: CatalogMaterial[] = [
    { id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị', kind: 'STOCK', avgCost: 800_000, totalAvailable: 100 },
    { id: BT, code: 'QA-KHO-BT', name: 'Gói bảo trì', unit: 'Gói', category: null, kind: 'SERVICE', avgCost: null, totalAvailable: null },
  ];
  async materials(_tenantId: string, ids: readonly string[]) {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search() {
    return this.known;
  }
}

/** Kho giả: luôn đủ tồn, giữ và xuất chống lặp theo khoá. */
class FakeInventory implements InventoryClient {
  readonly reservations = new Map<string, ReservedStock>();
  readonly issues = new Map<string, { documentId: string; documentCode: string }>();
  shortage = false;
  async reserve(_tenantId: string, request: ReserveStockRequest): Promise<ReservedStock> {
    if (this.shortage) throw new CrmError('RESERVATION_INSUFFICIENT_STOCK', 'Không đủ tồn.', 409, { shortages: [] });
    const existing = this.reservations.get(request.idempotencyKey);
    if (existing) return existing;
    const created = { reservationId: randomUUID(), reservationCode: `GH${this.reservations.size + 1}`, status: 'RESERVED', expiresAt: request.expiresAt };
    this.reservations.set(request.idempotencyKey, created);
    return created;
  }
  readonly released: string[] = [];
  async release(_tenantId: string, reservationCode: string): Promise<void> {
    this.released.push(reservationCode);
  }
  async createIssueRequest(_tenantId: string, input: IssueRequestInput) {
    const existing = this.issues.get(input.idempotencyKey) ?? { documentId: randomUUID(), documentCode: `PX${this.issues.size + 1}` };
    this.issues.set(input.idempotencyKey, existing);
    return { ...existing, status: 'DRAFT' };
  }
}

/** Tài chính giả theo hợp đồng phiếu có nguồn: cùng khoá trả lại phiếu cũ; cùng lần thu khoá mới thì mở lại phiếu. */
class FakeFinance implements FinanceClient {
  readonly byRef = new Map<string, { state: FinanceVoucherState; request: FinanceReceiptVoucherRequest; keys: string[] }>();
  calls = 0;
  down = false;
  async createReceiptVoucher(_tenantId: string, request: FinanceReceiptVoucherRequest): Promise<FinanceVoucherState> {
    this.calls += 1;
    if (this.down) throw new CrmError('FINANCE_UNAVAILABLE', 'Không kết nối được Tài chính.', 503);
    const existing = this.byRef.get(request.sourceRef);
    if (existing) {
      if (!existing.keys.includes(request.idempotencyKey)) existing.keys.push(request.idempotencyKey);
      existing.request = request;
      return existing.state;
    }
    const state = { voucherId: randomUUID(), voucherCode: `PT${this.byRef.size + 1}`, status: 'DRAFT', sourceStatus: 'OPEN' };
    this.byRef.set(request.sourceRef, { state, request, keys: [request.idempotencyKey] });
    return state;
  }
  async voucherState(_tenantId: string, sourceRef: string) {
    return this.byRef.get(sourceRef)?.state ?? null;
  }
  readonly cancelled: string[] = [];
  async cancelReceiptVoucher(_tenantId: string, sourceRef: string) {
    const existing = this.byRef.get(sourceRef);
    if (!existing) return null;
    this.cancelled.push(sourceRef);
    existing.state = { ...existing.state, status: 'CANCELLED', sourceStatus: 'CLOSED' };
    return existing.state;
  }
}

integration('Bán hàng GĐ5: công nợ, thu tiền, hạn mức (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const today = vietnamToday(new Date());
  const actor = (userId: string, extra: Partial<CrmActor> = {}): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Người dùng',
    canWriteOpportunity: true,
    canWriteOrder: true,
    canWriteContract: true,
    ...extra,
  });
  const nv = actor(NV);
  const kt = actor(KT, { canWriteReceivable: true, canReadAll: true });
  const ql = actor(QL, { canManage: true, canReadAll: true, canWriteReceivable: true });

  const inventory = new FakeInventory();
  const finance = new FakeFinance();
  let receivableStore: PostgresReceivableStore;
  let creditStore: PostgresCreditStore;
  let orders: SalesOrderService;
  let contracts: ContractService;
  let receivables: ReceivableService;
  let adjustments: ReceivableAdjustmentService;
  let credit: CreditApprovalService;
  let customers: CustomerService;
  let timeline: CustomerTimelineService;
  let dispatcher: PostgresIntegrationRequests;
  const procedureStarts: string[] = [];

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const customerStore = new PostgresCustomerStore(handle.database);
    const contractStore = new PostgresContractStore(handle.database);
    const settings = new PostgresSalesSettingsStore(handle.database);
    receivableStore = new PostgresReceivableStore(handle.database);
    creditStore = new PostgresCreditStore(handle.database);
    dispatcher = new PostgresIntegrationRequests(handle.database, inventory, finance);
    const catalog = new FakeCatalog();
    orders = new SalesOrderService(
      new PostgresSalesOrderStore(handle.database, receivableStore),
      contractStore,
      customerStore,
      new PostgresPricingStore(handle.database),
      catalog,
      scopes,
      inventory,
      settings,
      new CreditLimitService(creditStore, { start: async (_tenant, linkId) => void procedureStarts.push(linkId) }),
      dispatcher,
    );
    contracts = new ContractService(contractStore, customerStore, catalog, scopes, inventory, settings, dispatcher);
    receivables = new ReceivableService(receivableStore, scopes, dispatcher);
    adjustments = new ReceivableAdjustmentService(receivableStore, scopes);
    credit = new CreditApprovalService(creditStore, orders);
    customers = new CustomerService(customerStore, scopes);
    timeline = new CustomerTimelineService(new PostgresTimelineStore(handle.database), customerStore, scopes);

    const lists = new PriceListService(new PostgresPriceListStore(handle.database), new PendingCatalogReader());
    const list = await lists.create(ql, { code: 'BG-CHUAN', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    await lists.upsertItems(ql, list.id, {
      items: [
        { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
        { materialId: BT, materialCode: 'QA-KHO-BT', materialName: 'Gói bảo trì', unit: 'Gói', price: 500_000, vatRate: 10 },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  /** Khách mới, thời hạn thanh toán 30 ngày, hạn mức tuỳ chọn. */
  async function newCustomer(creditLimit: number | null = null): Promise<string> {
    const id = (await customers.create(nv, { name: `Công ty Công Nợ ${randomUUID().slice(0, 6)}`, ownerUserId: NV })).id;
    await handle.pool.query(`UPDATE crm_schema.customers SET payment_term_days = 30, credit_limit = $2 WHERE id = $1`, [id, creditLimit]);
    return id;
  }

  /** Khoản nợ dựng sẵn (dư nợ đầu kỳ). */
  async function debit(customerId: string, amount: number, dueDate = addDays(today, 30)): Promise<string> {
    return handle.database.transaction(tenantId, async (client) =>
      (await insertReceivableEntry(client, {
        kind: 'DEBIT',
        customerId,
        amount,
        entryDate: today,
        dueDate,
        sourceType: 'test_opening',
        sourceId: randomUUID(),
        description: 'Dư nợ đầu kỳ',
      })) as string,
    );
  }

  const openOf = async (entryId: string) =>
    Number((await handle.pool.query<{ open_amount: string }>(`SELECT open_amount FROM crm_schema.receivable_open_items WHERE id = $1`, [entryId])).rows[0].open_amount);

  const post = (receiptId: string) =>
    applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_POSTED, {
      voucherId: finance.byRef.get(receiptId)?.state.voucherId,
      voucherCode: finance.byRef.get(receiptId)?.state.voucherCode,
      postedAt: new Date().toISOString(),
      sourceModule: 'crm',
      sourceRef: receiptId,
    });

  /** Đơn trực tiếp `quantity` cáp đã xác nhận và giao đủ (một đợt). */
  async function deliveredOrder(customerId: string, quantity: number): Promise<SalesOrderDetail> {
    const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity }] });
    let order = await orders.confirm(nv, draft.id, { revision: draft.revision });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(today, 1), lines: [{ orderLineId: order.lines[0].id, quantity }] });
    order = await orders.requestIssue(nv, order.id, order.deliveries[0].id, { revision: order.revision });
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    await applyStockIssued(
      handle.database,
      tenantId,
      { documentId: issue?.documentId, documentCode: issue?.documentCode, sourceType: 'crm_delivery', sourceId: order.deliveries[0].id, lines: [{ materialId: CAP, quantity, costAmount: 0 }] },
      receivableStore,
    );
    return orders.get(nv, order.id);
  }

  it('TC-AR-01: xuất đợt 1 ghi nợ đúng giá trị gồm VAT, hạn = ngày giao + 30; nhận trùng không ghi lại; chứng từ đảo ghi bút đảo', async () => {
    const customerId = await newCustomer();
    const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 10 }] });
    let order = await orders.confirm(nv, draft.id, { revision: draft.revision });
    order = await orders.saveDelivery(nv, order.id, null, { revision: order.revision, plannedDate: addDays(today, 1), lines: [{ orderLineId: order.lines[0].id, quantity: 4 }] });
    order = await orders.requestIssue(nv, order.id, order.deliveries[0].id, { revision: order.revision });
    const issue = inventory.issues.get(`crm-delivery:${order.deliveries[0].id}`);
    const event = {
      documentId: issue?.documentId,
      documentCode: issue?.documentCode,
      sourceType: 'crm_delivery',
      sourceId: order.deliveries[0].id,
      postedAt: new Date().toISOString(),
      lines: [{ materialId: CAP, quantity: 4, costAmount: 3_200_000 }],
    };
    expect(await applyStockIssued(handle.database, tenantId, event, receivableStore)).toBe('applied');
    expect(await applyStockIssued(handle.database, tenantId, event, receivableStore)).toBe('ignored');
    const ledger = await receivables.ledger(kt, customerId);
    expect(ledger.openItems).toEqual([expect.objectContaining({ amount: 4_400_000, openAmount: 4_400_000, dueDate: addDays(today, 30), orderId: order.id })]);
    expect((await orders.get(nv, order.id)).receivable).toEqual({ debited: 4_400_000, collected: 0, adjusted: 0, outstanding: 4_400_000 });

    await applyStockIssued(handle.database, tenantId, { ...event, documentId: randomUUID(), documentCode: 'PX-DAO', reversesDocumentId: issue?.documentId }, receivableStore);
    const after = await receivables.ledger(kt, customerId);
    expect(after.balance).toBe(0);
    expect(after.entries.map((entry) => [entry.kind, entry.amount])).toEqual(expect.arrayContaining([['REVERSAL', -4_400_000], ['DEBIT', 4_400_000]]));
  });

  it('TC-AR-08: sổ chỉ ghi thêm, trigger từ chối UPDATE, DELETE', async () => {
    const customerId = await newCustomer();
    const entryId = await debit(customerId, 1_000);
    await expect(handle.pool.query(`UPDATE crm_schema.receivable_entries SET amount = 1 WHERE id = $1`, [entryId])).rejects.toThrow(/chỉ ghi thêm/);
    await expect(handle.pool.query(`DELETE FROM crm_schema.receivable_entries WHERE id = $1`, [entryId])).rejects.toThrow(/chỉ ghi thêm/);
    expect(await openOf(entryId)).toBe(1_000);
  });

  it('TC-AR-03, TC-INT-05..07: thu 4.000.000 phân bổ A 3.000.000, B 1.000.000; ghi sổ mới có hiệu lực; đảo phiếu mở lại nợ', async () => {
    const customerId = await newCustomer();
    const a = await debit(customerId, 3_000_000, addDays(today, -5));
    const b = await debit(customerId, 2_000_000);
    const receipt = await receivables.createReceipt(kt, {
      customerId,
      amount: 4_000_000,
      method: 'BANK_TRANSFER',
      allocations: [
        { entryId: a, amount: 3_000_000 },
        { entryId: b, amount: 1_000_000 },
      ],
    });
    expect(receipt).toMatchObject({ status: 'VOUCHER_DRAFT', financeVoucherCode: expect.any(String), allocatedAmount: 4_000_000 });
    const sent = finance.byRef.get(receipt.id);
    expect(sent?.keys).toEqual([`crm-receipt:${receipt.id}`]);
    expect(sent?.request).toMatchObject({ amount: 4_000_000, sourceCode: receipt.code, initiatedBy: KT });
    // Chưa ghi sổ: số còn nợ chưa đổi, phần đã phân bổ giữ chỗ.
    expect(await openOf(a)).toBe(3_000_000);
    const pending = await receivables.ledger(kt, customerId);
    expect(pending.openItems.find((item) => item.entryId === b)).toMatchObject({ pendingAmount: 1_000_000, allocatableAmount: 1_000_000 });

    expect(await post(receipt.id)).toBe('applied');
    expect(await post(receipt.id)).toBe('ignored');
    expect(await openOf(a)).toBe(0);
    expect(await openOf(b)).toBe(1_000_000);
    expect((await receivables.getReceipt(kt, receipt.id)).allocations.every((line) => line.effective)).toBe(true);

    const reversed = { voucherId: sent?.state.voucherId, status: 'REVERSED', sourceModule: 'crm', sourceRef: receipt.id };
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_STATUS_CHANGED, reversed)).toBe('applied');
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_STATUS_CHANGED, reversed)).toBe('ignored');
    // Phiếu của nguồn khác không đụng tới Bán hàng.
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_STATUS_CHANGED, { ...reversed, sourceModule: 'procedure-engine' })).toBe('ignored');
    expect(await openOf(a)).toBe(3_000_000);
    expect(await openOf(b)).toBe(2_000_000);
    expect((await receivables.getReceipt(kt, receipt.id)).status).toBe('REVERSED');
  });

  it('TC-AR-04: phân bổ vượt số còn nợ hoặc vượt số thu thì 400, không đổi số liệu', async () => {
    const customerId = await newCustomer();
    const a = await debit(customerId, 1_000_000);
    await expect(receivables.createReceipt(kt, { customerId, amount: 2_000_000, method: 'CASH', allocations: [{ entryId: a, amount: 1_500_000 }] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'ALLOCATION_EXCEEDS_OPEN',
    });
    await expect(receivables.createReceipt(kt, { customerId, amount: 1_000_000, method: 'CASH', allocations: [{ entryId: a, amount: 1_200_000 }] })).rejects.toMatchObject({
      statusCode: 400,
    });
    const count = await handle.pool.query(`SELECT count(*)::int AS n FROM crm_schema.receipts WHERE customer_id = $1`, [customerId]);
    expect(count.rows[0]).toEqual({ n: 0 });
  });

  it('TC-CONC-09: hai lần thu cùng lúc phân bổ 800.000 vào khoản còn 1.000.000: đúng một thành công, khoản không âm', async () => {
    const customerId = await newCustomer();
    const a = await debit(customerId, 1_000_000);
    const request = { customerId, amount: 800_000, method: 'CASH' as const, allocations: [{ entryId: a, amount: 800_000 }] };
    const results = await Promise.allSettled([receivables.createReceipt(kt, request), receivables.createReceipt(kt, request)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason).toMatchObject({ code: 'ALLOCATION_EXCEEDS_OPEN' });
    const done = results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<ReceivableService['createReceipt']>>> => result.status === 'fulfilled');
    await post(done?.value.id as string);
    expect(await openOf(a)).toBe(200_000);
  });

  it('TC-INT-08: Tài chính không phản hồi thì lần thu Chờ tạo phiếu; gửi lại tạo đúng một phiếu nhờ khoá chống lặp', async () => {
    const customerId = await newCustomer();
    finance.down = true;
    const receipt = await receivables.createReceipt(kt, { customerId, amount: 500_000, method: 'CASH', allocations: [] });
    expect(receipt.status).toBe('PENDING_VOUCHER');
    finance.down = false;
    await handle.pool.query(`UPDATE crm_schema.integration_requests SET lease_until = now() - interval '1 second' WHERE idempotency_key = $1`, [`crm-receipt:${receipt.id}`]);
    await dispatcher.dispatch(tenantId);
    await dispatcher.dispatch(tenantId);
    expect((await receivables.getReceipt(kt, receipt.id)).status).toBe('VOUCHER_DRAFT');
    expect(finance.byRef.get(receipt.id)?.keys).toEqual([`crm-receipt:${receipt.id}`]);
    // Không phân bổ: ghi sổ thì là tiền trả trước, dư nợ âm.
    await post(receipt.id);
    expect((await receivables.ledger(kt, customerId))).toMatchObject({ balance: -500_000, unappliedAmount: 500_000 });
  });

  it('TC-INT-07: phiếu bị trả lại thì lần thu cần sửa; sửa gửi lại cùng lần thu, khoá mới, Tài chính mở lại phiếu', async () => {
    const customerId = await newCustomer();
    const a = await debit(customerId, 1_000_000);
    const receipt = await receivables.createReceipt(kt, { customerId, amount: 900_000, method: 'CASH', allocations: [{ entryId: a, amount: 900_000 }] });
    const returned = { voucherId: finance.byRef.get(receipt.id)?.state.voucherId, reason: 'Sai số tiền', sourceModule: 'crm', sourceRef: receipt.id };
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_RETURNED, returned)).toBe('applied');
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_RETURNED, returned)).toBe('ignored');
    const current = await receivables.getReceipt(kt, receipt.id);
    expect(current).toMatchObject({ status: 'RETURNED', returnReason: 'Sai số tiền' });
    const resent = await receivables.resendReceipt(kt, receipt.id, { revision: current.revision, amount: 1_000_000, allocations: [{ entryId: a, amount: 1_000_000 }] });
    expect(resent).toMatchObject({ status: 'VOUCHER_DRAFT', amount: 1_000_000 });
    expect(finance.byRef.get(receipt.id)?.keys).toEqual([`crm-receipt:${receipt.id}`, `crm-receipt:${receipt.id}:2`]);
    await post(receipt.id);
    expect(await openOf(a)).toBe(0);
  });

  it('TC-AR-07: điều chỉnh giảm 500.000 lý do trả hàng; người lập không tự duyệt; sổ có dòng mới, dòng gốc không đổi', async () => {
    const customerId = await newCustomer();
    const a = await debit(customerId, 5_000_000);
    const draft = await adjustments.create(kt, { customerId, direction: 'DECREASE', amount: 500_000, reason: 'Trả hàng' });
    await expect(adjustments.approve(actor(KT, { canReadAll: true, canWriteReceivable: true }), draft.id, { revision: draft.revision })).rejects.toMatchObject({
      statusCode: 403,
    });
    const approved = await adjustments.approve(ql, draft.id, { revision: draft.revision });
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: QL });
    expect(await openOf(a)).toBe(4_500_000);
    const ledger = await receivables.ledger(kt, customerId);
    expect(ledger.entries.find((entry) => entry.id === a)).toMatchObject({ amount: 5_000_000 });
    expect(ledger.entries.find((entry) => entry.kind === 'ADJUSTMENT')).toMatchObject({ amount: -500_000, refEntryId: a, adjustmentCode: draft.code });
    // Giảm vượt số còn nợ thì 409, không ghi gì.
    const tooMuch = await adjustments.create(kt, { customerId, direction: 'DECREASE', amount: 4_600_000, reason: 'Thử' });
    await expect(adjustments.approve(ql, tooMuch.id, { revision: tooMuch.revision })).rejects.toMatchObject({ code: 'ADJUSTMENT_EXCEEDS_OPEN' });
    // Cổng cho bảo hành: gọi lặp cùng nguồn trả cùng điều chỉnh.
    const first = await adjustments.createAdjustment({ customerId, amount: 100_000, reason: 'Bảo hành trả hàng', sourceType: 'crm_warranty_case', sourceId: 'case-1', actor: { tenantId, userId: NV } });
    const again = await adjustments.createAdjustment({ customerId, amount: 100_000, reason: 'Bảo hành trả hàng', sourceType: 'crm_warranty_case', sourceId: 'case-1', actor: { tenantId, userId: NV } });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, adjustment: { id: first.adjustment.id, status: 'DRAFT', direction: 'DECREASE' } });
  });

  it('TC-AR-12, TC-SM-06: số còn phải thu cập nhật ngay sau ghi sổ; giao đủ và thu đủ thì tự Hoàn tất', async () => {
    const customerId = await newCustomer();
    const order = await deliveredOrder(customerId, 4);
    expect(order.status).toBe('DELIVERED');
    expect(order.receivable?.outstanding).toBe(4_400_000);
    const entry = (await receivables.ledger(kt, customerId)).openItems[0];
    const first = await receivables.createReceipt(kt, { customerId, amount: 1_000_000, method: 'CASH', allocations: [{ entryId: entry.entryId, amount: 1_000_000 }] });
    await post(first.id);
    const partly = await orders.get(nv, order.id);
    expect(partly).toMatchObject({ status: 'DELIVERED', receivable: { outstanding: 3_400_000 } });
    expect((await orders.list(nv, { customerId })).items.find((item) => item.id === order.id)?.outstanding).toBe(3_400_000);
    const rest = await receivables.createReceipt(kt, { customerId, amount: 3_400_000, method: 'CASH', allocations: [{ entryId: entry.entryId, amount: 3_400_000 }] });
    await post(rest.id);
    const done = await orders.get(nv, order.id);
    expect(done.status).toBe('DONE');
    expect(done.history.find((item) => item.action === 'auto-complete')).toBeTruthy();
  });

  it('TC-AR-09/10: dư nợ + đơn bằng hạn mức thì xác nhận; vượt 1 đồng với cấu hình chặn thì 409, không giữ hàng', async () => {
    const customerId = await newCustomer();
    await debit(customerId, 80_000_000);
    const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 2 }] });
    const total = draft.totals.totalAmount;
    await handle.pool.query(`UPDATE crm_schema.customers SET credit_limit = $2 WHERE id = $1`, [customerId, 80_000_000 + total]);
    expect((await orders.confirm(nv, draft.id, { revision: draft.revision })).status).toBe('CONFIRMED');

    await handle.pool.query(`UPDATE crm_schema.settings SET value = '{"mode": "BLOCK"}' WHERE key = 'credit.limit'`);
    try {
      const other = await newCustomer(80_000_000 + total - 1);
      await debit(other, 80_000_000);
      const blocked = await orders.create(nv, { customerId: other, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 2 }] });
      const reservationsBefore = inventory.reservations.size;
      await expect(orders.confirm(nv, blocked.id, { revision: blocked.revision })).rejects.toMatchObject({
        statusCode: 409,
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: expect.stringContaining('Vượt hạn mức công nợ'),
      });
      expect(inventory.reservations.size).toBe(reservationsBefore);
      expect((await orders.get(nv, blocked.id)).status).toBe('DRAFT');
    } finally {
      await handle.pool.query(`UPDATE crm_schema.settings SET value = '{"mode": "APPROVAL"}' WHERE key = 'credit.limit'`);
    }
  });

  it('TC-AR-11: vượt hạn mức, cấu hình duyệt: Chờ duyệt hạn mức; duyệt xong mới giữ hàng; từ chối thì về Nháp', async () => {
    const customerId = await newCustomer(1_000);
    const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 1 }] });
    const pending = await orders.confirm(nv, draft.id, { revision: draft.revision });
    expect(pending).toMatchObject({ status: 'CREDIT_PENDING', creditRequest: { status: 'PENDING', mode: 'DIRECT' } });
    expect(pending.lines[0].reservationStatus).toBeNull();
    // Người lập không tự xác nhận được đơn đang chờ duyệt; nhân viên không duyệt được.
    await expect(orders.confirm(nv, draft.id, { revision: pending.revision })).rejects.toMatchObject({ code: 'CREDIT_APPROVAL_PENDING' });
    await expect(credit.decide(nv, draft.id, true, {})).rejects.toMatchObject({ statusCode: 403 });
    const approved = await credit.decide(ql, draft.id, true, {});
    expect(approved).toMatchObject({ status: 'CONFIRMED', creditRequest: { status: 'APPROVED', decidedBy: QL } });
    expect(approved.lines[0].reservationStatus).toBe('HELD');

    const second = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 1 }] });
    await orders.confirm(nv, second.id, { revision: second.revision });
    await expect(credit.decide(ql, second.id, false, {})).rejects.toMatchObject({ statusCode: 400 });
    const rejected = await credit.decide(ql, second.id, false, { reason: 'Khách nợ nhiều' });
    expect(rejected).toMatchObject({ status: 'DRAFT', creditRequest: { status: 'REJECTED', decisionNote: 'Khách nợ nhiều' } });
  });

  it('TC-AR-11 (Quy trình): đơn đi duyệt có phiên crm_order_credit; kết quả hoàn tất thì giữ hàng, nhận trùng bỏ qua', async () => {
    const definitionId = randomUUID();
    await handle.pool.query(
      `INSERT INTO crm_schema.approval_bindings (kind, mode, procedure_definition_id, procedure_definition_name)
       VALUES ('ORDER_CREDIT', 'PROCEDURE', $1, 'Duyệt hạn mức')
       ON CONFLICT (kind) DO UPDATE SET mode = 'PROCEDURE', procedure_definition_id = $1`,
      [definitionId],
    );
    try {
      const customerId = await newCustomer(1_000);
      const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 1 }] });
      const pending = await orders.confirm(nv, draft.id, { revision: draft.revision });
      expect(pending.creditRequest).toMatchObject({ status: 'PENDING', mode: 'PROCEDURE' });
      const link = (
        await handle.pool.query<{ id: string; source_id: string; definition_id: string }>(
          `SELECT id, source_id, definition_id FROM crm_schema.procedure_links WHERE source_type = 'crm_order_credit' AND source_id = $1`,
          [pending.creditRequest?.id],
        )
      ).rows[0];
      expect(link.definition_id).toBe(definitionId);
      expect(procedureStarts).toContain(link.id);
      await expect(credit.decide(ql, draft.id, true, {})).rejects.toMatchObject({ code: 'CREDIT_VIA_PROCEDURE' });
      const payload = { sourceType: 'crm_order_credit', sourceId: link.id, status: 'completed', instanceId: randomUUID(), instanceCode: 'QT-1' };
      const outcome = await applyOrderCreditProcedureResult(handle.database, tenantId, payload);
      expect(outcome).toEqual({ orderId: draft.id, approved: true });
      expect(await applyOrderCreditProcedureResult(handle.database, tenantId, payload)).toBe('ignored');
      await credit.confirmApproved(tenantId, draft.id, null);
      expect((await orders.get(nv, draft.id)).status).toBe('CONFIRMED');
    } finally {
      await handle.pool.query(`DELETE FROM crm_schema.approval_bindings WHERE kind = 'ORDER_CREDIT'`);
    }
  });

  it('TC-CON-06, TC-AR-02: đợt "khi ký" ghi nợ khi xác nhận HĐ, đợt "khi giao" khi giao; không ghi nợ theo xuất kho; đợt theo ngày do job', async () => {
    const customerId = await newCustomer();
    const draft = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'HĐ có đợt',
      validFrom: today,
      validTo: addDays(today, 60),
      value: 10_000_000,
      warehouseCode: 'KHO-1',
      lines: [{ materialId: CAP, quantity: 5, unitPrice: 1_000_000 }],
    });
    const withTerms = await contracts.savePaymentTerms(nv, draft.id, {
      revision: draft.revision,
      terms: [
        { name: 'Ký', percent: 30, condition: 'SIGN' },
        { name: 'Giao hàng', percent: 50, condition: 'DELIVERY', dueDays: 15 },
        { name: 'Theo ngày', percent: 20, condition: 'DATE', dueDate: addDays(today, -1) },
      ],
    });
    await contracts.confirm(nv, draft.id, { revision: withTerms.revision });
    let ledger = await receivables.ledger(kt, customerId);
    expect(ledger.openItems.map((item) => [item.amount, item.dueDate])).toEqual([[3_000_000, addDays(today, 30)]]);

    const order = await orders.create(nv, { contractId: draft.id, lines: [{ materialId: CAP, quantity: 2 }] });
    let detail = await orders.confirm(nv, order.id, { revision: order.revision });
    detail = await orders.saveDelivery(nv, detail.id, null, { revision: detail.revision, plannedDate: addDays(today, 1), lines: [{ orderLineId: detail.lines[0].id, quantity: 2 }] });
    detail = await orders.requestIssue(nv, detail.id, detail.deliveries[0].id, { revision: detail.revision });
    const issue = inventory.issues.get(`crm-delivery:${detail.deliveries[0].id}`);
    await applyStockIssued(
      handle.database,
      tenantId,
      { documentId: issue?.documentId, documentCode: issue?.documentCode, sourceType: 'crm_delivery', sourceId: detail.deliveries[0].id, lines: [{ materialId: CAP, quantity: 2, costAmount: 0 }] },
      receivableStore,
    );
    ledger = await receivables.ledger(kt, customerId);
    // Không có khoản theo giá trị xuất kho (2.200.000), chỉ có đợt giao hàng 5.000.000 hạn +15 ngày.
    expect(ledger.openItems.map((item) => [item.amount, item.dueDate, item.orderId])).toEqual([
      [5_000_000, addDays(today, 15), order.id],
      [3_000_000, addDays(today, 30), null],
    ]);
    await handle.database.transaction(tenantId, (client) => recognizeDateTerms(client, today, 50));
    await handle.database.transaction(tenantId, (client) => recognizeDateTerms(client, today, 50));
    ledger = await receivables.ledger(kt, customerId);
    expect(ledger.balance).toBe(10_000_000);
    expect((await contracts.get(nv, draft.id)).paymentTerms.map((term) => term.status)).toEqual(['DUE', 'DUE', 'DUE']);
  });

  it('TC-CON-06b: 30% khi ký, 70% khi giao đủ hàng: giao một phần (kể cả giao đủ một đơn khi đơn khác chưa giao) không ghi nợ 70%, giao đủ mọi đơn đã cam kết thì ghi (đơn Nháp bỏ dở không chặn)', async () => {
    const customerId = await newCustomer();
    const draft = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'HĐ 30/70 giao đủ',
      validFrom: today,
      validTo: addDays(today, 60),
      value: 10_000_000,
      warehouseCode: 'KHO-1',
      lines: [{ materialId: CAP, quantity: 5, unitPrice: 1_000_000 }],
    });
    const withTerms = await contracts.savePaymentTerms(nv, draft.id, {
      revision: draft.revision,
      terms: [
        { name: 'Ký', percent: 30, condition: 'SIGN' },
        { name: 'Giao đủ hàng', percent: 70, condition: 'FULL_DELIVERY', dueDays: 20 },
      ],
    });
    expect(withTerms.paymentTerms.map((term) => [term.condition, term.amount])).toEqual([
      ['SIGN', 3_000_000],
      ['FULL_DELIVERY', 7_000_000],
    ]);
    await contracts.confirm(nv, draft.id, { revision: withTerms.revision });

    /** Lập đơn thuộc hợp đồng với một đợt giao mỗi số lượng trong `parts`. */
    const contractOrder = async (quantity: number, parts: number[]) => {
      let detail = await orders.create(nv, { contractId: draft.id, lines: [{ materialId: CAP, quantity }] });
      detail = await orders.confirm(nv, detail.id, { revision: detail.revision });
      for (const [index, part] of parts.entries()) {
        detail = await orders.saveDelivery(nv, detail.id, null, {
          revision: detail.revision,
          plannedDate: addDays(today, index + 1),
          lines: [{ orderLineId: detail.lines[0].id, quantity: part }],
        });
      }
      return detail;
    };
    const deliver = async (orderId: string, index: number, quantity: number) => {
      let detail = await orders.get(nv, orderId);
      const delivery = detail.deliveries[index];
      detail = await orders.requestIssue(nv, orderId, delivery.id, { revision: detail.revision });
      const issue = inventory.issues.get(`crm-delivery:${delivery.id}`);
      await applyStockIssued(
        handle.database,
        tenantId,
        { documentId: issue?.documentId, documentCode: issue?.documentCode, sourceType: 'crm_delivery', sourceId: delivery.id, lines: [{ materialId: CAP, quantity, costAmount: 0 }] },
        receivableStore,
      );
    };
    const termDebits = async () =>
      (await receivables.ledger(kt, customerId)).openItems.map((item) => item.amount).sort((a, b) => a - b);

    const first = await contractOrder(3, [3]);
    const second = await contractOrder(2, [1, 1]);
    // T8-08: đơn Nháp bị bỏ dở chưa là cam kết, không chặn đợt giao đủ.
    const abandoned = await orders.create(nv, { contractId: draft.id, lines: [{ materialId: CAP, quantity: 1 }] });
    expect(abandoned.status).toBe('DRAFT');
    expect(await termDebits()).toEqual([3_000_000]);
    // Đơn thứ nhất giao đủ nhưng đơn thứ hai chưa giao: chưa ghi nợ 70%.
    await deliver(first.id, 0, 3);
    expect((await orders.get(nv, first.id)).status).toMatch(/^(DELIVERED|DONE)$/);
    expect(await termDebits()).toEqual([3_000_000]);
    // Đơn thứ hai giao một phần: vẫn chưa.
    await deliver(second.id, 0, 1);
    expect(await termDebits()).toEqual([3_000_000]);
    expect((await contracts.get(nv, draft.id)).paymentTerms.map((term) => term.status)).toEqual(['DUE', 'PENDING']);
    // Lần giao làm mọi đơn giao đủ: ghi 7.000.000 hạn +20 ngày, đúng một lần.
    await deliver(second.id, 1, 1);
    const ledger = await receivables.ledger(kt, customerId);
    expect(ledger.openItems.map((item) => [item.amount, item.dueDate]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [3_000_000, addDays(today, 30)],
      [7_000_000, addDays(today, 20)],
    ]);
    expect(ledger.balance).toBe(10_000_000);
    expect((await contracts.get(nv, draft.id)).paymentTerms.map((term) => term.status)).toEqual(['DUE', 'DUE']);
  });

  it('TC-AR-06: job báo khoản quá hạn và khách vượt hạn mức một lần; TC-CUS-10: dòng thời gian có công nợ', async () => {
    const customerId = await newCustomer(1_000_000);
    await debit(customerId, 2_000_000, addDays(today, -1));
    await handle.pool.query(`UPDATE crm_schema.settings SET value = $1 WHERE key = 'receivable.alerts'`, [JSON.stringify({ userIds: [KT] })]);
    expect(await receivableStore.notifyAlerts(tenantId, today, 500)).toBeGreaterThanOrEqual(2);
    const events = (
      await handle.pool.query<{ event_type: string; payload: { payload: { customerId: string; recipientUserIds: string[] } } }>(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE event_type IN ($1, $2)`,
        [CRM_RECEIVABLE_OVERDUE, CRM_CUSTOMER_CREDIT_EXCEEDED],
      )
    ).rows.filter((row) => row.payload.payload.customerId === customerId);
    expect(events.map((row) => row.event_type).sort()).toEqual([CRM_CUSTOMER_CREDIT_EXCEEDED, CRM_RECEIVABLE_OVERDUE]);
    expect(events[0].payload.payload.recipientUserIds).toEqual([NV, KT]);
    await receivableStore.notifyAlerts(tenantId, today, 500);
    const again = await handle.pool.query(
      `SELECT count(*)::int AS n FROM integration_schema.outbox_events WHERE event_type IN ($1, $2) AND payload->'payload'->>'customerId' = $3`,
      [CRM_RECEIVABLE_OVERDUE, CRM_CUSTOMER_CREDIT_EXCEEDED, customerId],
    );
    expect(again.rows[0]).toEqual({ n: 2 });

    const receipt = await receivables.createReceipt(kt, { customerId, amount: 100_000, method: 'CASH', allocations: [] });
    await post(receipt.id);
    const entries = (await timeline.list(kt, customerId, {})).items.filter((entry) => entry.kind === 'receivable');
    expect(entries.map((entry) => (entry.kind === 'receivable' ? [entry.subject, entry.action] : null))).toEqual(
      expect.arrayContaining([
        ['entry', 'DEBIT'],
        ['receipt', 'create'],
        ['receipt', 'post'],
      ]),
    );
  });

  it('TC-INT-07 (T5-15): huỷ lần thu bị trả lại thì gửi lệnh huỷ phiếu nháp bên Tài chính đúng một lần', async () => {
    const customerId = await newCustomer();
    const receipt = await receivables.createReceipt(kt, { customerId, amount: 700_000, method: 'CASH', allocations: [] });
    const returned = { voucherId: finance.byRef.get(receipt.id)?.state.voucherId, reason: 'Sai ngày', sourceModule: 'crm', sourceRef: receipt.id };
    await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_RETURNED, returned);
    const current = await receivables.getReceipt(kt, receipt.id);
    const cancelled = await receivables.cancelReceipt(kt, receipt.id, { revision: current.revision, reason: 'Khách không nộp tiền' });
    expect(cancelled.status).toBe('CANCELLED');
    expect(finance.cancelled.filter((ref) => ref === receipt.id)).toHaveLength(1);
    expect(finance.byRef.get(receipt.id)?.state.status).toBe('CANCELLED');
    const request = (
      await handle.pool.query<{ status: string; payload: { reason: string } }>(
        `SELECT status, payload FROM crm_schema.integration_requests WHERE idempotency_key = $1`,
        [`crm-receipt-cancel:${receipt.id}`],
      )
    ).rows;
    expect(request).toEqual([{ status: 'SUCCEEDED', payload: expect.objectContaining({ reason: 'Khách không nộp tiền' }) }]);
    await dispatcher.dispatch(tenantId);
    expect(finance.cancelled.filter((ref) => ref === receipt.id)).toHaveLength(1);
  });

  it('TC-AR-03 (T5-16): tiền trả trước phân bổ vào khoản nợ phát sinh sau, không vượt số dư; đảo phiếu thu vẫn đúng', async () => {
    const customerId = await newCustomer();
    const receipt = await receivables.createReceipt(kt, { customerId, amount: 500_000, method: 'CASH', allocations: [] });
    await post(receipt.id);
    const unapplied = (
      await handle.pool.query<{ id: string }>(
        `SELECT id FROM crm_schema.receivable_entries WHERE receipt_id = $1 AND kind = 'CREDIT' AND ref_entry_id IS NULL`,
        [receipt.id],
      )
    ).rows[0].id;
    const a = await debit(customerId, 300_000);
    const b = await debit(customerId, 400_000);
    await expect(receivables.applyCredit(kt, unapplied, { allocations: [{ entryId: a, amount: 300_000 }, { entryId: b, amount: 300_000 }] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'CREDIT_EXCEEDS_UNAPPLIED',
    });
    await expect(receivables.applyCredit(kt, unapplied, { allocations: [{ entryId: a, amount: 400_000 }] })).rejects.toMatchObject({
      code: 'ALLOCATION_EXCEEDS_OPEN',
    });
    await expect(receivables.applyCredit(kt, a, { allocations: [{ entryId: b, amount: 1 }] })).rejects.toMatchObject({ code: 'CREDIT_NOT_UNAPPLIED' });
    await expect(receivables.applyCredit(nv, unapplied, { allocations: [{ entryId: a, amount: 1 }] })).rejects.toMatchObject({ statusCode: 403 });

    // Hai lần phân bổ cùng lúc 300.000 (còn 500.000): đúng một thành công nhờ khoá dòng.
    const results = await Promise.allSettled([
      receivables.applyCredit(kt, unapplied, { allocations: [{ entryId: a, amount: 300_000 }] }),
      receivables.applyCredit(kt, unapplied, { allocations: [{ entryId: b, amount: 300_000 }] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    let ledger = await receivables.ledger(kt, customerId);
    expect(ledger).toMatchObject({ balance: 200_000, unappliedAmount: 200_000 });
    const rest = await receivables.applyCredit(kt, unapplied, { allocations: [{ entryId: (await openOf(a)) > 0 ? a : b, amount: 200_000 }] });
    expect(rest).toMatchObject({ balance: 200_000, unappliedAmount: 0 });
    expect((await openOf(a)) + (await openOf(b))).toBe(200_000);
    expect(rest.entries.filter((entry) => entry.kind === 'CREDIT' && entry.refEntryId).length).toBe(2);

    // Phiếu thu bị đảo: mọi phần đã phân bổ mở lại, dư nợ về đúng tổng khoản nợ.
    const reversed = { voucherId: finance.byRef.get(receipt.id)?.state.voucherId, status: 'REVERSED', sourceModule: 'crm', sourceRef: receipt.id };
    expect(await applyFinanceVoucherEvent(handle.database, tenantId, FINANCE_VOUCHER_STATUS_CHANGED, reversed)).toBe('applied');
    ledger = await receivables.ledger(kt, customerId);
    expect(ledger).toMatchObject({ balance: 700_000, unappliedAmount: 0 });
    expect(await openOf(a)).toBe(300_000);
    expect(await openOf(b)).toBe(400_000);
  });

  it('TC-AR-11 (T5-17): phiên Quy trình duyệt vượt hạn mức lỗi vĩnh viễn thì chuyển duyệt trực tiếp, báo người lập', async () => {
    const definitionId = randomUUID();
    await handle.pool.query(
      `INSERT INTO crm_schema.approval_bindings (kind, mode, procedure_definition_id, procedure_definition_name)
       VALUES ('ORDER_CREDIT', 'PROCEDURE', $1, 'Duyệt hạn mức')
       ON CONFLICT (kind) DO UPDATE SET mode = 'PROCEDURE', procedure_definition_id = $1`,
      [definitionId],
    );
    try {
      const customerId = await newCustomer(1_000);
      const draft = await orders.create(nv, { customerId, warehouseCode: 'KHO-1', lines: [{ materialId: CAP, quantity: 1 }] });
      const pending = await orders.confirm(nv, draft.id, { revision: draft.revision });
      const requestId = pending.creditRequest?.id as string;
      // Còn lần thử: chưa chuyển.
      await handle.pool.query(
        `UPDATE crm_schema.procedure_links SET status = 'FAILED', attempts = 3, last_error = 'Quy trình đang không khả dụng.' WHERE source_id = $1`,
        [requestId],
      );
      expect(await credit.redirectFailedProcedures(tenantId)).toBe(0);
      await handle.pool.query(`UPDATE crm_schema.procedure_links SET attempts = $2 WHERE source_id = $1`, [requestId, PROCEDURE_START_MAX_ATTEMPTS]);
      expect(await credit.redirectFailedProcedures(tenantId)).toBe(1);
      expect(await credit.redirectFailedProcedures(tenantId)).toBe(0);
      const order = await orders.get(nv, draft.id);
      expect(order).toMatchObject({ status: 'CREDIT_PENDING', creditRequest: { id: requestId, status: 'PENDING', mode: 'DIRECT' } });
      expect(order.history[0]).toMatchObject({ action: 'credit-redirect', actorId: null });
      const events = (
        await handle.pool.query<{ payload: { payload: { recipientUserIds: string[]; creditRequestId: string } } }>(
          `SELECT payload FROM integration_schema.outbox_events WHERE event_type = $1 AND aggregate_id = $2`,
          [CRM_ORDER_CREDIT_APPROVAL_REDIRECTED, draft.id],
        )
      ).rows;
      expect(events.map((row) => row.payload.payload)).toEqual([expect.objectContaining({ recipientUserIds: [NV], creditRequestId: requestId })]);
      const link = (await handle.pool.query<{ status: string }>(`SELECT status FROM crm_schema.procedure_links WHERE source_id = $1`, [requestId])).rows[0];
      expect(link.status).toBe('CLOSED');
      // Quản lý duyệt trực tiếp được.
      expect((await credit.decide(ql, draft.id, true, {})).status).toBe('CONFIRMED');
    } finally {
      await handle.pool.query(`DELETE FROM crm_schema.approval_bindings WHERE kind = 'ORDER_CREDIT'`);
    }
  });

  it('TC-CON-07/09 (T4-17, T4-18): giữ hàng tới hết ngày kết thúc; hết hạn thì nhả phần còn lại qua lệnh gửi Kho, báo người phụ trách một lần', async () => {
    const customerId = await newCustomer();
    const validTo = addDays(today, 10);
    const draft = await contracts.create(nv, {
      type: 'SALE',
      customerId,
      title: 'HĐ giữ hàng',
      validFrom: today,
      validTo,
      value: 3_000_000,
      warehouseCode: 'KHO-1',
      lines: [{ materialId: CAP, quantity: 3, unitPrice: 1_000_000 }],
    });
    const active = await contracts.confirm(nv, draft.id, { revision: draft.revision });
    const code = active.reservation?.reservationCode as string;
    expect(inventory.reservations.get(`crm-contract:${draft.id}`)?.expiresAt).toBe(new Date(Date.parse(`${addDays(validTo, 1)}T00:00:00+07:00`) - 1000).toISOString());

    // Job chạy ngày sau ngày kết thúc.
    const store = new PostgresContractStore(handle.database);
    expect(await store.expireDue(tenantId, addDays(validTo, 1), 100)).toBeGreaterThanOrEqual(1);
    expect(await store.expireDue(tenantId, addDays(validTo, 1), 100)).toBe(0);
    const expired = await contracts.get(nv, draft.id);
    expect(expired).toMatchObject({ status: 'EXPIRED', reservation: { reservationCode: code, status: 'RELEASED' } });
    expect(expired.history.map((entry) => entry.action)).toEqual(expect.arrayContaining(['expire', 'release-reservation']));
    const requests = (
      await handle.pool.query(`SELECT operation FROM crm_schema.integration_requests WHERE idempotency_key = $1`, [`crm-release:${code}`])
    ).rows;
    expect(requests).toEqual([{ operation: 'reservation.release' }]);
    await handle.pool.query(`UPDATE crm_schema.integration_requests SET lease_until = NULL WHERE idempotency_key = $1`, [`crm-release:${code}`]);
    await dispatcher.dispatch(tenantId);
    expect(inventory.released).toContain(code);
    const events = (
      await handle.pool.query<{ payload: { payload: { recipientUserIds: string[]; reservationCode: string } } }>(
        `SELECT payload FROM integration_schema.outbox_events WHERE event_type = $1 AND aggregate_id = $2`,
        [CRM_CONTRACT_RESERVATION_RELEASED, draft.id],
      )
    ).rows;
    expect(events.map((row) => row.payload.payload)).toEqual([expect.objectContaining({ recipientUserIds: [NV], reservationCode: code })]);
  });
});
