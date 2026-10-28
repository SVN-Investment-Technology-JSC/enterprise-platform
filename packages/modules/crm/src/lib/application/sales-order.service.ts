import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONTRACT_EXPIRING_DAYS,
  DEFAULT_RESERVATION_HOLD_DAYS,
  SALES_ORDER_LINES_MAX,
  SALES_ORDER_STATUSES,
  type ContractDetail,
  type CreateSalesOrderRequest,
  type CrmMaterialStock,
  type CrmPage,
  type CrmWarehouseOption,
  type SalesOrderActionRequest,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderListQuery,
  type SalesOrderSummary,
  type SalesOrderTotals,
  type SalesSettings,
  type SaveDeliveryPlanRequest,
  type SaveSalesOrderLineRequest,
  type UpdateSalesOrderRequest,
} from '@enterprise-platform/contracts-crm';
import { assertContractUsableForOrder } from '../domain/contract.js';
import { CrmConflictError, CrmError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { round3, validateDeliveryLines } from '../domain/delivery-plan.js';
import {
  isUuid,
  normalizeSearch,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInteger,
  optionalText,
  requiredText,
} from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { priceQuote, type PricingLineInput } from '../domain/pricing-engine.js';
import {
  assertOrderTransition,
  canPlanDeliveries,
  canRequestIssue,
  isOrderEditable,
  issueRequestIdempotencyKey,
  reservationExpiry,
  reservationIdempotencyKey,
} from '../domain/sales-order.js';
import { assertOwnerInScope, requireSalesManager } from './crm-access.js';
import { crmSeesEverything, type CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import type { ContractStore, SalesSettingsStore } from './contract-store.port.js';
import { shortageError } from './contract.service.js';
import {
  CRM_DELIVERY_SOURCE_TYPE,
  CRM_ORDER_SOURCE_TYPE,
  type CreditLimitCheck,
  type IntegrationDispatcher,
  type InventoryClient,
  type IssueRequestResult,
  type ReservedStock,
} from './fulfillment.port.js';
import { boundedNumber } from './price-list.service.js';
import { vietnamToday } from './pricing.service.js';
import type { CatalogMaterial, CatalogReader, PricingStore } from './pricing-store.port.js';
import type {
  OrderHeaderRecord,
  OrderLineRecord,
  OrderLineReservation,
  SalesOrderStore,
} from './sales-order-store.port.js';
import type { CustomerStore } from './sales-store.port.js';

const ORDER_NOT_FOUND = 'Không tìm thấy đơn bán.';
const QUANTITY_MAX = 999_999_999;
const AMOUNT_MAX = 1e13;
const ALL: CrmDataScope = { kind: 'all' };
/** Kho trả giữ hàng ở các trạng thái này: dùng được. */
const LIVE_RESERVATION = new Set(['PENDING', 'RESERVED', 'PARTIALLY_ISSUED']);

export function requireOrderWriter(actor: CrmActor): void {
  if (!actor.canWriteOrder) throw new CrmForbiddenError('Bạn không có quyền lập, xác nhận đơn bán.');
}

/** Dòng trước khi tính giá: phần người dùng nhập cộng bản chụp danh mục. */
interface LineDraft {
  readonly id: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly materialKind: string;
  readonly category: string | null;
  readonly quantity: number;
  readonly overrideUnitPrice: number | null;
  readonly overrideDiscountPercent: number | null;
  readonly previousUnitCost: number | null;
}

function revisionOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu số lần sửa của đơn; vui lòng tải lại.');
  }
  return number;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Đơn bán, giữ hàng, kế hoạch giao, yêu cầu xuất kho (T4-08 đến T4-11, T4-13).
 *
 * - Xem: `crm.read` trong phạm vi dữ liệu (người phụ trách đơn). Ghi:
 *   `crm.order.write`. Đóng tay sang Hoàn tất: thêm quyền thấy toàn bộ (quản lý
 *   kinh doanh) và lý do (Q8).
 * - Giá: đơn trực tiếp, đơn từ hợp đồng tính bằng engine giá như báo giá (đơn
 *   từ hợp đồng lấy giá khung của chính hợp đồng); đơn từ báo giá giữ đúng dòng,
 *   giá của báo giá, không sửa dòng.
 * - Xác nhận: kiểm hạn mức công nợ (`CreditLimitCheck`, T5-10 thay bản thật);
 *   giữ hàng ở Kho, tất cả hoặc không (Q4), khoá `crm-order:<id>`, hạn theo
 *   `reservation.holdDays` hoặc ngày giao dự kiến + 2 ngày (Q12). Đơn từ hợp
 *   đồng đang giữ đủ hàng thì dùng phần giữ của hợp đồng, không giữ thêm.
 * - Đợt giao: tổng các đợt không vượt số lượng đơn; yêu cầu xuất tạo chứng từ
 *   xuất nháp ở Kho (khoá `crm-delivery:<id>`), dòng dịch vụ không gửi Kho.
 * - Huỷ: có lý do; nhả phần giữ còn lại của đơn, không đụng phần đã xuất.
 */
export class SalesOrderService {
  constructor(
    private readonly orders: SalesOrderStore,
    private readonly contracts: Pick<ContractStore, 'getContract'>,
    private readonly customers: Pick<CustomerStore, 'getCustomer'>,
    private readonly pricing: PricingStore,
    private readonly catalog: CatalogReader,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly inventory: InventoryClient,
    private readonly settings: SalesSettingsStore,
    private readonly credit: CreditLimitCheck,
    private readonly dispatcher: IntegrationDispatcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  async list(actor: CrmActor, query: SalesOrderListQuery): Promise<CrmPage<SalesOrderSummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.orders.listOrders(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      status: optionalEnum(query.status, SALES_ORDER_STATUSES, 'trạng thái'),
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      contractId: optionalId(query.contractId, 'hợp đồng') ?? undefined,
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      late: query.late === true || query.late === 'true',
      today: this.today(),
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<SalesOrderDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(ORDER_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const detail = await this.orders.getOrder(actor.tenantId, scope, id, this.today());
    if (!detail) throw new CrmNotFoundError(ORDER_NOT_FOUND);
    return detail;
  }

  // -------------------------------------------------------------------------
  // Lập, sửa
  // -------------------------------------------------------------------------

  async create(actor: CrmActor, request: CreateSalesOrderRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const today = this.today();
    const contractId = optionalId(request?.contractId, 'hợp đồng');
    let customerId = optionalId(request?.customerId, 'khách hàng');
    let contract: ContractDetail | undefined;
    let defaultOwner = actor.userId;
    if (contractId) {
      contract = await this.contracts.getContract(actor.tenantId, scope, contractId);
      if (!contract) throw new CrmNotFoundError('Không tìm thấy hợp đồng.');
      // Hợp đồng hết hạn, chưa hiệu lực, đã đóng: không sinh đơn (TC-CON-03).
      assertContractUsableForOrder(contract, today);
      if (customerId && customerId !== contract.customerId) {
        throw new CrmValidationError('CUSTOMER_MISMATCH', 'Khách hàng không khớp với hợp đồng.');
      }
      customerId = contract.customerId;
      defaultOwner = contract.ownerUserId;
    }
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng hoặc hợp đồng.');
    const customer = await this.customers.getCustomer(actor.tenantId, contract ? ALL : scope, customerId);
    if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    const ownerUserId = optionalId(request?.ownerUserId, 'người phụ trách') ?? defaultOwner;
    assertOwnerInScope(scope, ownerUserId);

    const header = this.headerInput(request, contract?.warehouseCode ?? null);
    const drafts = await this.drafts(actor.tenantId, request?.lines ?? []);
    const priced = await this.price(actor.tenantId, {
      date: header.priceDate ?? today,
      customerId,
      customerGroupId: customer.groupId,
      contractId: contract?.id ?? null,
      lines: drafts,
      shipping: header.shipping,
    });
    const id = await this.orders.createOrder(
      actor.tenantId,
      {
        ...header,
        totals: priced.totals,
        source: contract ? 'CONTRACT' : 'DIRECT',
        customerId,
        contractId: contract?.id ?? null,
        quoteId: null,
        opportunityId: null,
        ownerUserId,
        orderDate: today,
        lines: priced.lines,
      },
      actor.userId,
    );
    return this.get(actor, id);
  }

  async update(actor: CrmActor, id: string, request: UpdateSalesOrderRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, id);
    const revision = this.expect(order, request?.revision);
    if (!isOrderEditable(order.status)) {
      throw new CrmConflictError('ORDER_NOT_EDITABLE', 'Chỉ sửa được đơn ở trạng thái Nháp.');
    }
    const repricing = request?.lines !== undefined || request?.priceDate !== undefined || request?.shipping !== undefined;
    if (order.source === 'QUOTE' && repricing) {
      throw new CrmConflictError(
        'ORDER_LINES_LOCKED',
        'Đơn từ báo giá giữ đúng dòng và giá của báo giá; muốn đổi thì sửa báo giá rồi lập đơn mới.',
      );
    }
    const header = this.headerInput(
      {
        expectedDeliveryDate: request?.expectedDeliveryDate === undefined ? order.expectedDeliveryDate : request.expectedDeliveryDate,
        warehouseCode: request?.warehouseCode === undefined ? order.warehouseCode : request.warehouseCode,
        deliveryAddress: request?.deliveryAddress === undefined ? order.deliveryAddress : request.deliveryAddress,
        note: request?.note === undefined ? order.note : request.note,
        priceDate: request?.priceDate === undefined ? order.priceDate : request.priceDate,
        shipping: request?.shipping === undefined ? order.shipping : request.shipping,
      },
      null,
    );
    if (!repricing) {
      await this.orders.updateDraft(actor.tenantId, id, revision, { ...header, totals: order.totals }, undefined, actor.userId);
      return this.get(actor, id);
    }
    const drafts =
      request.lines === undefined ? order.lines.map(lineDraftOf) : await this.drafts(actor.tenantId, request.lines, order.lines);
    const customer = await this.customers.getCustomer(actor.tenantId, ALL, order.customerId);
    const priced = await this.price(actor.tenantId, {
      date: header.priceDate ?? this.today(),
      customerId: order.customerId,
      customerGroupId: customer?.groupId ?? null,
      contractId: order.contractId,
      lines: drafts,
      shipping: header.shipping,
    });
    await this.orders.updateDraft(
      actor.tenantId,
      id,
      revision,
      { ...header, totals: priced.totals },
      request.lines === undefined ? undefined : priced.lines,
      actor.userId,
    );
    return this.get(actor, id);
  }

  // -------------------------------------------------------------------------
  // Xác nhận, huỷ, đóng
  // -------------------------------------------------------------------------

  /** Nháp → Đã xác nhận (T4-09): kiểm hạn mức, giữ hàng ở Kho rồi ghi. */
  async confirm(actor: CrmActor, id: string, request: SalesOrderActionRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, id);
    const revision = this.expect(order, request?.revision);
    assertOrderTransition(order.status, 'CONFIRMED');
    if (order.status === 'CREDIT_PENDING' && this.credit.requestApproval) {
      // Có sổ công nợ (GĐ5): đơn chờ duyệt hạn mức chỉ được xác nhận qua quyết định duyệt.
      throw new CrmConflictError('CREDIT_APPROVAL_PENDING', 'Đơn đang chờ duyệt vượt hạn mức công nợ; chưa xác nhận được.');
    }
    if (!order.lines.length) throw new CrmValidationError('ORDER_EMPTY', 'Đơn chưa có dòng hàng nào.');
    const today = this.today();
    const contract = order.contractId ? await this.contracts.getContract(actor.tenantId, ALL, order.contractId) : undefined;
    if (contract) assertContractUsableForOrder(contract, today);

    // Điểm mở rộng của T5-10: vượt hạn mức thì chặn hoặc đưa đi duyệt (Chờ duyệt hạn mức).
    if (order.status === 'DRAFT') {
      const decision = await this.credit.evaluate({
        tenantId: actor.tenantId,
        customerId: order.customerId,
        orderId: order.id,
        orderAmount: order.totals.totalAmount,
      });
      if (decision.outcome === 'BLOCK') throw new CrmConflictError('CREDIT_LIMIT_EXCEEDED', decision.message);
      if (decision.outcome === 'APPROVAL') {
        if (this.credit.requestApproval) {
          await this.credit.requestApproval({
            tenantId: actor.tenantId,
            orderId: id,
            revision,
            actorId: actor.userId,
            orderAmount: order.totals.totalAmount,
            message: decision.message,
          });
        } else {
          await this.orders.transition(
            actor.tenantId,
            id,
            revision,
            { from: 'DRAFT', to: 'CREDIT_PENDING', action: 'credit-check', reason: decision.message },
            actor.userId,
          );
        }
        return this.get(actor, id);
      }
    }

    await this.reserveAndConfirm(actor.tenantId, order, revision, contract, today, actor.userId);
    return this.get(actor, id);
  }

  /**
   * Yêu cầu duyệt vượt hạn mức đã được duyệt (trực tiếp hoặc qua Quy trình, D5):
   * giữ hàng rồi Chờ duyệt hạn mức → Đã xác nhận. Đơn không còn Chờ duyệt hạn mức
   * thì bỏ qua (`false`). Không kiểm quyền người dùng: bên gọi đã kiểm người duyệt.
   */
  async confirmAfterCreditApproval(tenantId: string, orderId: string, actorId: string | null): Promise<boolean> {
    const order = await this.orders.getOrder(tenantId, ALL, orderId, this.today());
    if (!order || order.status !== 'CREDIT_PENDING') return false;
    const today = this.today();
    const contract = order.contractId ? await this.contracts.getContract(tenantId, ALL, order.contractId) : undefined;
    if (contract) assertContractUsableForOrder(contract, today);
    await this.reserveAndConfirm(tenantId, order, order.revision, contract, today, actorId ?? order.ownerUserId);
    return true;
  }

  /** Giữ hàng ở Kho (hoặc dùng phần giữ của hợp đồng) rồi ghi Đã xác nhận; ghi lỗi thì nhả phần vừa giữ. */
  private async reserveAndConfirm(
    tenantId: string,
    order: SalesOrderDetail,
    revision: number,
    contract: ContractDetail | undefined,
    today: string,
    actorId: string,
  ): Promise<void> {
    const id = order.id;
    const stock = order.lines.filter((line) => line.materialKind !== 'SERVICE');
    let reservations: OrderLineReservation[] = [];
    let expiresAt: string | null = null;
    let own: ReservedStock | null = null;
    if (stock.length) {
      if (!order.warehouseCode) {
        throw new CrmValidationError('WAREHOUSE_REQUIRED', 'Vui lòng chọn kho giữ hàng cho đơn trước khi xác nhận.');
      }
      const inherited = contract ? await this.inheritContractReservation(tenantId, order, stock, contract) : null;
      if (inherited) {
        reservations = inherited;
        expiresAt = contract?.reservation?.expiresAt ?? null;
      } else {
        own = await this.reserve(tenantId, order, stock, today);
        expiresAt = own.expiresAt;
        reservations = stock.map((line) => ({
          lineId: line.id,
          reservationId: (own as ReservedStock).reservationId,
          reservationCode: (own as ReservedStock).reservationCode,
          source: 'ORDER' as const,
          quantity: line.quantity,
        }));
      }
    }
    try {
      await this.orders.confirm(tenantId, id, revision, order.status, { expiresAt, lines: reservations }, actorId);
    } catch (error) {
      // Ghi đơn lỗi sau khi Kho đã giữ: nhả lại và đổi khoá cho lần sau.
      if (own) {
        await this.inventory.release(tenantId, own.reservationCode).catch(() => undefined);
        await this.orders.bumpReserveAttempt(tenantId, id).catch(() => undefined);
      }
      throw error;
    }
  }

  async cancel(actor: CrmActor, id: string, request: SalesOrderActionRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, id);
    const revision = this.expect(order, request?.revision);
    assertOrderTransition(order.status, 'CANCELLED');
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (!reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do huỷ đơn.');
    await this.orders.cancel(actor.tenantId, id, revision, order.status, reason, actor.userId);
    // Nhả phần giữ ngay sau khi ghi; lỗi để job gửi lại.
    await this.dispatcher.dispatch(actor.tenantId).catch(() => undefined);
    return this.get(actor, id);
  }

  /** Đã giao đủ → Hoàn tất bằng tay (Q8): quản lý kinh doanh, có lý do. */
  async close(actor: CrmActor, id: string, request: SalesOrderActionRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    if (!crmSeesEverything(actor)) {
      throw new CrmForbiddenError('Chỉ quản lý kinh doanh mới được đóng đơn bằng tay.');
    }
    const order = await this.get(actor, id);
    const revision = this.expect(order, request?.revision);
    assertOrderTransition(order.status, 'DONE');
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (!reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do đóng đơn.');
    await this.orders.transition(actor.tenantId, id, revision, { from: order.status, to: 'DONE', action: 'close', reason }, actor.userId);
    return this.get(actor, id);
  }

  // -------------------------------------------------------------------------
  // Kế hoạch giao, yêu cầu xuất
  // -------------------------------------------------------------------------

  async saveDelivery(
    actor: CrmActor,
    orderId: string,
    deliveryId: string | null,
    request: SaveDeliveryPlanRequest,
  ): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, orderId);
    const revision = this.expect(order, request?.revision);
    if (!canPlanDeliveries(order.status)) {
      throw new CrmConflictError('ORDER_NOT_PLANNABLE', 'Đơn đã giao đủ, hoàn tất hoặc đã huỷ; không lập đợt giao được.');
    }
    if (deliveryId) {
      const delivery = order.deliveries.find((entry) => entry.id === deliveryId);
      if (!delivery) throw new CrmNotFoundError('Không tìm thấy đợt giao.');
      if (delivery.status !== 'PLANNED') {
        throw new CrmConflictError('DELIVERY_LOCKED', 'Đợt giao đã yêu cầu xuất kho, không sửa được.');
      }
    }
    const plannedDate = optionalDate(request?.plannedDate, 'ngày giao dự kiến');
    if (!plannedDate) throw new CrmValidationError('PLANNED_DATE_REQUIRED', 'Vui lòng nhập ngày giao dự kiến.');
    const lines = validateDeliveryLines({
      orderLines: order.lines,
      existing: order.deliveries.flatMap((delivery) =>
        delivery.lines.map((line) => ({
          deliveryId: delivery.id,
          orderLineId: line.orderLineId,
          status: delivery.status,
          plannedQuantity: line.plannedQuantity,
          deliveredQuantity: line.deliveredQuantity,
        })),
      ),
      deliveryId,
      lines: request?.lines,
      deliveryCount: order.deliveries.length,
    });
    const warehouse = optionalText(request?.warehouseCode, 50, 'mã kho');
    await this.orders.saveDelivery(
      actor.tenantId,
      orderId,
      revision,
      deliveryId,
      {
        plannedDate,
        warehouseCode: warehouse ? warehouse.toUpperCase() : order.warehouseCode,
        address: optionalText(request?.address, 500, 'địa chỉ giao') ?? order.deliveryAddress,
        note: optionalText(request?.note, 2000, 'ghi chú'),
        lines,
      },
      actor.userId,
    );
    return this.get(actor, orderId);
  }

  async cancelDelivery(actor: CrmActor, orderId: string, deliveryId: string, request: SalesOrderActionRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, orderId);
    const revision = this.expect(order, request?.revision);
    const delivery = order.deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery) throw new CrmNotFoundError('Không tìm thấy đợt giao.');
    if (delivery.status !== 'PLANNED') {
      throw new CrmConflictError('DELIVERY_LOCKED', 'Chỉ bỏ được đợt giao chưa yêu cầu xuất kho.');
    }
    await this.orders.cancelDelivery(actor.tenantId, orderId, revision, deliveryId, actor.userId);
    return this.get(actor, orderId);
  }

  /** Đợt giao → yêu cầu xuất kho (T4-11); dòng dịch vụ không gửi Kho. */
  async requestIssue(actor: CrmActor, orderId: string, deliveryId: string, request: SalesOrderActionRequest): Promise<SalesOrderDetail> {
    requireOrderWriter(actor);
    const order = await this.get(actor, orderId);
    const revision = this.expect(order, request?.revision);
    if (!canRequestIssue(order.status)) {
      throw new CrmConflictError('ORDER_NOT_CONFIRMED', 'Đơn phải được xác nhận trước khi yêu cầu xuất kho.');
    }
    const delivery = order.deliveries.find((entry) => entry.id === deliveryId);
    if (!delivery) throw new CrmNotFoundError('Không tìm thấy đợt giao.');
    if (delivery.status !== 'PLANNED') {
      throw new CrmConflictError('DELIVERY_ALREADY_REQUESTED', 'Đợt giao đã yêu cầu xuất kho.');
    }
    const byId = new Map(order.lines.map((line) => [line.id, line]));
    const stock = delivery.lines.filter((line) => line.materialKind !== 'SERVICE');
    let document: IssueRequestResult | null = null;
    if (stock.length) {
      const warehouseCode = delivery.warehouseCode ?? order.warehouseCode;
      if (!warehouseCode) throw new CrmValidationError('WAREHOUSE_REQUIRED', 'Vui lòng chọn kho xuất cho đợt giao.');
      document = await this.inventory.createIssueRequest(actor.tenantId, {
        idempotencyKey: issueRequestIdempotencyKey(delivery.id),
        warehouseCode,
        sourceType: CRM_DELIVERY_SOURCE_TYPE,
        sourceId: delivery.id,
        documentDate: delivery.plannedDate,
        note: `Giao hàng đơn ${order.code}, đợt ${delivery.code}`,
        lines: stock.map((line) => {
          const orderLine = byId.get(line.orderLineId);
          // Trừ vào phần đã giữ khi cùng kho giữ và còn đủ phần giữ; không thì xuất từ tồn khả dụng.
          const useReservation =
            orderLine?.reservationStatus === 'HELD' &&
            !!orderLine.reservationCode &&
            warehouseCode === order.warehouseCode &&
            orderLine.reservedQuantity >= line.plannedQuantity;
          const reservationId = useReservation ? (orderLine?.reservationId ?? undefined) : undefined;
          return { materialCode: line.materialCode, quantity: line.plannedQuantity, ...(reservationId ? { reservationId } : {}) };
        }),
      });
    }
    await this.orders.markDeliveryRequested(
      actor.tenantId,
      orderId,
      revision,
      deliveryId,
      document ? { documentId: document.documentId, documentCode: document.documentCode } : null,
      actor.userId,
    );
    return this.get(actor, orderId);
  }

  /** Tồn khả dụng theo kho của các mặt hàng (chọn kho giữ hàng, kho xuất). */
  async materialStock(actor: CrmActor, rawIds: unknown): Promise<CrmMaterialStock[]> {
    const ids = String(rawIds ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => isUuid(value))
      .slice(0, 100);
    if (!ids.length) return [];
    const known = await this.catalog.materials(actor.tenantId, ids);
    return [...known.values()].map((material) => ({
      materialId: material.id,
      materialCode: material.code,
      kind: material.kind ?? null,
      totalAvailable: material.totalAvailable ?? null,
      byWarehouse: (material.availableByWarehouse ?? []).map((stock) => ({ warehouseCode: stock.warehouseCode, available: stock.available })),
    }));
  }

  /**
   * Danh sách kho của Kho để chọn kho xuất trong kế hoạch giao (T4-19):
   * `search` theo mã, tên; `codes` lấy thêm kho đang chọn (kể cả kho đã ngừng).
   */
  async warehouses(actor: CrmActor, query: { search?: unknown; codes?: unknown }): Promise<CrmWarehouseOption[]> {
    if (!this.catalog.warehouses) return [];
    const search = typeof query?.search === 'string' ? query.search.trim().slice(0, 100) : '';
    const codes = String(query?.codes ?? '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code && code.length <= 50)
      .slice(0, 50);
    return this.catalog.warehouses(actor.tenantId, { search, codes });
  }

  // -------------------------------------------------------------------------
  // Cấu hình
  // -------------------------------------------------------------------------

  async salesSettings(actor: CrmActor): Promise<SalesSettings> {
    void actor;
    const [reservationHoldDays, contractExpiringDays] = await Promise.all([
      this.settings.reservationHoldDays(actor.tenantId),
      this.settings.contractExpiringDays(actor.tenantId),
    ]);
    return { reservationHoldDays, contractExpiringDays };
  }

  async saveSalesSettings(actor: CrmActor, request: Partial<SalesSettings>): Promise<SalesSettings> {
    requireSalesManager(actor);
    const current = await this.salesSettings(actor);
    const reservationHoldDays =
      optionalInteger(request?.reservationHoldDays, 1, 365, 'số ngày giữ hàng') ?? current.reservationHoldDays ?? DEFAULT_RESERVATION_HOLD_DAYS;
    const contractExpiringDays =
      optionalInteger(request?.contractExpiringDays, 1, 365, 'số ngày báo trước khi hợp đồng hết hạn') ??
      current.contractExpiringDays ??
      DEFAULT_CONTRACT_EXPIRING_DAYS;
    await this.settings.save(actor.tenantId, { reservationHoldDays, contractExpiringDays }, actor.userId);
    return this.salesSettings(actor);
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  /**
   * Đơn từ hợp đồng đang giữ hàng ở cùng kho: dùng phần giữ của hợp đồng nếu
   * mọi dòng hàng tồn kho của đơn còn nằm trong số lượng hợp đồng chưa đơn khác
   * dùng. Không đủ thì trả `null` (đơn tự giữ hàng riêng).
   */
  private async inheritContractReservation(
    tenantId: string,
    order: SalesOrderDetail,
    stock: readonly SalesOrderLine[],
    contract: ContractDetail,
  ): Promise<OrderLineReservation[] | null> {
    const reservation = contract.reservation;
    if (!reservation || reservation.status !== 'HELD' || contract.warehouseCode !== order.warehouseCode) return null;
    const used = new Map(await this.orders.contractReservationUsage(tenantId, contract.id, order.id));
    const covered = new Map<string, number>();
    for (const line of contract.lines) {
      if (line.materialKind === 'SERVICE' || line.quantity === null) continue;
      covered.set(line.materialId, round3((covered.get(line.materialId) ?? 0) + line.quantity));
    }
    for (const line of stock) {
      const remaining = round3((covered.get(line.materialId) ?? 0) - (used.get(line.materialId) ?? 0));
      if (remaining < line.quantity) return null;
      used.set(line.materialId, round3((used.get(line.materialId) ?? 0) + line.quantity));
    }
    return stock.map((line) => ({
      lineId: line.id,
      reservationId: reservation.reservationId,
      reservationCode: reservation.reservationCode,
      source: 'CONTRACT' as const,
      quantity: line.quantity,
    }));
  }

  private async reserve(tenantId: string, order: SalesOrderDetail, stock: readonly SalesOrderLine[], today: string): Promise<ReservedStock> {
    const holdDays = await this.settings.reservationHoldDays(tenantId);
    const openDates = order.deliveries
      .filter((delivery) => delivery.status === 'PLANNED' || delivery.status === 'REQUESTED')
      .map((delivery) => delivery.plannedDate)
      .sort();
    const plannedDate = order.expectedDeliveryDate ?? openDates[openDates.length - 1] ?? null;
    const expiresAt = reservationExpiry({ today, now: this.now(), holdDays, plannedDate });
    for (let round = 0; round < 2; round += 1) {
      const attempt = await this.orders.reserveAttempt(tenantId, order.id);
      let reserved: ReservedStock;
      try {
        reserved = await this.inventory.reserve(tenantId, {
          idempotencyKey: reservationIdempotencyKey('crm-order', order.id, attempt),
          sourceType: CRM_ORDER_SOURCE_TYPE,
          sourceId: order.id,
          expiresAt,
          notes: `Đơn bán ${order.code}`,
          lines: stock.map((line) => ({
            materialCode: line.materialCode,
            warehouseCode: order.warehouseCode as string,
            quantity: line.quantity,
          })),
        });
      } catch (error) {
        if (error instanceof CrmError && error.code === 'RESERVATION_INSUFFICIENT_STOCK') {
          throw shortageError(error, stock, `đơn ${order.code}`);
        }
        if (round === 0 && error instanceof CrmError && error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
          await this.orders.bumpReserveAttempt(tenantId, order.id);
          continue;
        }
        throw error;
      }
      if (LIVE_RESERVATION.has(reserved.status)) return reserved;
      await this.orders.bumpReserveAttempt(tenantId, order.id);
    }
    throw new CrmConflictError('RESERVATION_RETRY', 'Không giữ được hàng ở Kho; vui lòng thử lại.');
  }

  private expect(order: SalesOrderDetail, value: unknown): number {
    const revision = revisionOf(value);
    if (revision !== order.revision) {
      throw new CrmConflictError('STALE_VERSION', 'Đơn bán vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');
    }
    return revision;
  }

  private headerInput(
    request: Pick<CreateSalesOrderRequest, 'expectedDeliveryDate' | 'warehouseCode' | 'deliveryAddress' | 'note' | 'priceDate' | 'shipping'> | undefined,
    defaultWarehouse: string | null,
  ): Omit<OrderHeaderRecord, 'totals'> {
    const warehouse = optionalText(request?.warehouseCode, 50, 'mã kho') ?? defaultWarehouse;
    const shipping = request?.shipping
      ? {
          amount: boundedNumber(request.shipping.amount ?? 0, 0, AMOUNT_MAX, 'phí vận chuyển', 2),
          vatRate:
            request.shipping.vatRate === undefined || request.shipping.vatRate === null
              ? 10
              : boundedNumber(request.shipping.vatRate, 0, 100, 'thuế suất phí vận chuyển', 2),
        }
      : { amount: 0, vatRate: 10 };
    return {
      expectedDeliveryDate: optionalDate(request?.expectedDeliveryDate, 'ngày giao dự kiến'),
      warehouseCode: warehouse ? warehouse.toUpperCase() : null,
      deliveryAddress: optionalText(request?.deliveryAddress, 500, 'địa chỉ giao'),
      note: optionalText(request?.note, 4000, 'ghi chú'),
      priceDate: optionalDate(request?.priceDate, 'ngày tính giá'),
      shipping,
    };
  }

  /** Dòng từ request (thay toàn bộ): mặt hàng phải có trong danh mục Kho. */
  private async drafts(
    tenantId: string,
    raw: readonly SaveSalesOrderLineRequest[] | unknown,
    previous: readonly SalesOrderLine[] = [],
  ): Promise<LineDraft[]> {
    if (!Array.isArray(raw)) throw new CrmValidationError('INVALID_LINES', 'Danh sách dòng đơn không hợp lệ.');
    if (raw.length > SALES_ORDER_LINES_MAX) {
      throw new CrmValidationError('TOO_MANY_LINES', `Mỗi đơn tối đa ${SALES_ORDER_LINES_MAX} dòng.`);
    }
    const requests = raw as SaveSalesOrderLineRequest[];
    const ids = [...new Set(requests.map((line) => (isUuid(line?.materialId) ? line.materialId.toLowerCase() : '')).filter(Boolean))];
    const known = ids.length ? await this.catalog.materials(tenantId, ids) : new Map<string, CatalogMaterial>();
    return requests.map((line, index) => {
      const fail = (message: string) => new CrmValidationError('INVALID_LINE', `Dòng ${index + 1}: ${message}`, { line: index + 1 });
      if (!isUuid(line?.materialId)) throw fail('vui lòng chọn mặt hàng.');
      const material = known.get(line.materialId.toLowerCase());
      if (!material) throw fail('mặt hàng không có trong danh mục Kho.');
      try {
        const unit = line.unit ? requiredText(line.unit, 50, 'đơn vị tính') : material.unit;
        if (!unit) throw new CrmValidationError('UNIT_REQUIRED', 'Vui lòng nhập đơn vị tính.');
        const quantity = boundedNumber(line.quantity, 0, QUANTITY_MAX, 'số lượng', 3);
        if (quantity <= 0) throw new CrmValidationError('INVALID_QUANTITY', 'Số lượng phải lớn hơn 0.');
        const read = (value: unknown, max: number, label: string, decimals: number) =>
          value === undefined || value === null || value === '' ? null : boundedNumber(value, 0, max, label, decimals);
        const overrideUnitPrice = read(line.overrideUnitPrice, AMOUNT_MAX, 'đơn giá ghi đè', 2);
        const overrideDiscountPercent = read(line.overrideDiscountPercent, 100, 'chiết khấu ghi đè', 4);
        const before = previous.find((entry) => entry.materialId === material.id);
        return {
          id: randomUUID(),
          materialId: material.id,
          materialCode: material.code,
          materialName: material.name,
          unit,
          materialKind: material.kind ?? 'STOCK',
          category: material.category,
          quantity,
          overrideUnitPrice,
          overrideDiscountPercent,
          previousUnitCost: before?.estUnitCost ?? null,
        };
      } catch (error) {
        if (error instanceof CrmValidationError) throw fail(error.message.charAt(0).toLowerCase() + error.message.slice(1));
        throw error;
      }
    });
  }

  /** Tính giá cả đơn bằng engine giá (như báo giá); đơn từ hợp đồng dùng giá khung của chính hợp đồng. */
  private async price(
    tenantId: string,
    input: {
      readonly date: string;
      readonly customerId: string;
      readonly customerGroupId: string | null;
      readonly contractId: string | null;
      readonly lines: readonly LineDraft[];
      readonly shipping: { amount: number; vatRate: number };
    },
  ): Promise<{ lines: OrderLineRecord[]; totals: SalesOrderTotals }> {
    if (!input.lines.length) {
      const shippingVat = Math.round((input.shipping.amount * input.shipping.vatRate) / 100);
      return {
        lines: [],
        totals: {
          grossAmount: 0,
          discountAmount: 0,
          netAmount: 0,
          shippingAmount: input.shipping.amount,
          vatAmount: shippingVat,
          totalAmount: input.shipping.amount + shippingVat,
        },
      };
    }
    const materialIds = [...new Set(input.lines.map((line) => line.materialId))];
    const [priceLists, policies, cap, contractPrices, known] = await Promise.all([
      this.pricing.priceListsForPricing(tenantId, input.date, input.customerGroupId, materialIds),
      this.pricing.policiesForPricing(tenantId, input.date),
      this.pricing.discountCapPercent(tenantId),
      this.pricing.contractPricesForPricing(tenantId, input.date, input.customerId, materialIds, input.contractId),
      this.catalog.materials(tenantId, materialIds).catch(() => new Map<string, CatalogMaterial>()),
    ]);
    const inputs: PricingLineInput[] = input.lines.map((line) => ({
      materialId: line.materialId,
      materialCode: line.materialCode,
      materialName: line.materialName,
      category: line.category,
      quantity: line.quantity,
      unit: line.unit,
      override: { unitPrice: line.overrideUnitPrice, discountPercent: line.overrideDiscountPercent },
    }));
    const priced = priceQuote({
      date: input.date,
      customerId: input.customerId,
      customerGroupId: input.customerGroupId,
      lines: inputs,
      priceLists,
      policies,
      contractPrices,
      discountCapPercent: cap,
      shipping: input.shipping.amount > 0 ? input.shipping : null,
    });
    const lines = priced.lines.map((pricedLine, index): OrderLineRecord => {
      const line = input.lines[index];
      const material = known.get(line.materialId);
      return {
        id: line.id,
        lineNo: index + 1,
        materialId: line.materialId,
        materialCode: line.materialCode,
        materialName: line.materialName,
        unit: pricedLine.unit,
        materialKind: line.materialKind,
        category: pricedLine.category,
        quantity: pricedLine.quantity,
        listPrice: pricedLine.listPrice,
        priceSource: pricedLine.priceSource,
        priceReferenceId: pricedLine.priceReferenceId,
        priceReferenceCode: pricedLine.priceReferenceCode,
        appliedPolicies: pricedLine.appliedPolicies,
        discountPercent: pricedLine.discountPercent,
        overridden: pricedLine.overridden,
        overrideUnitPrice: line.overrideUnitPrice,
        overrideDiscountPercent: line.overrideDiscountPercent,
        unitPrice: pricedLine.unitPriceAfterDiscount,
        grossAmount: pricedLine.grossAmount,
        discountAmount: pricedLine.discountAmount,
        vatRate: pricedLine.vatRate,
        lineAmount: pricedLine.lineAmount,
        vatAmount: pricedLine.vatAmount,
        lineTotal: pricedLine.lineTotal,
        estUnitCost: material ? (material.avgCost ?? null) : line.previousUnitCost,
      };
    });
    return { lines, totals: priced.totals };
  }
}

function lineDraftOf(line: SalesOrderLine): LineDraft {
  return {
    id: line.id,
    materialId: line.materialId,
    materialCode: line.materialCode,
    materialName: line.materialName,
    unit: line.unit,
    materialKind: line.materialKind,
    category: line.category,
    quantity: line.quantity,
    overrideUnitPrice: line.overrideUnitPrice,
    overrideDiscountPercent: line.overrideDiscountPercent,
    previousUnitCost: line.estUnitCost,
  };
}

/** Ngày giao mặc định của đợt sinh khi chuyển báo giá. */
export function defaultPlannedDate(today: string, leadDays: number): string {
  return addDays(today, leadDays);
}
