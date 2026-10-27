import { randomUUID } from 'node:crypto';
import {
  CONTRACT_LINES_MAX,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  DEFAULT_VAT_RATE,
  type ContractActionRequest,
  type ContractDetail,
  type ContractListQuery,
  type ContractSummary,
  type ContractType,
  type CrmPage,
  type CrmStockShortage,
  type SaveContractLineRequest,
  type SaveContractRequest,
  type SavePaymentTermsRequest,
} from '@enterprise-platform/contracts-crm';
import {
  assertContractTransition,
  contractDefaultValue,
  contractLineAmount,
  reservableContractLines,
} from '../domain/contract.js';
import { CrmConflictError, CrmError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import {
  isUuid,
  normalizeSearch,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInteger,
  optionalMoney,
  optionalText,
  requiredText,
} from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { assertPaymentTermsBalanced, normalizePaymentTerms } from '../domain/payment-terms.js';
import { reservationExpiry, reservationIdempotencyKey } from '../domain/sales-order.js';
import { assertOwnerInScope } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ContractLineRecord, ContractRecord, ContractStore, SalesSettingsStore } from './contract-store.port.js';
import {
  CRM_CONTRACT_SOURCE_TYPE,
  type IntegrationDispatcher,
  type InventoryClient,
  type ReservedStock,
} from './fulfillment.port.js';
import { boundedNumber } from './price-list.service.js';
import { vietnamToday } from './pricing.service.js';
import type { CatalogReader } from './pricing-store.port.js';
import type { CustomerStore } from './sales-store.port.js';

const CONTRACT_NOT_FOUND = 'Không tìm thấy hợp đồng.';
const AMOUNT_MAX = 1e13;
const QUANTITY_MAX = 999_999_999;
/** Kho trả giữ hàng ở các trạng thái này: dùng được. */
const LIVE_RESERVATION = new Set(['PENDING', 'RESERVED', 'PARTIALLY_ISSUED']);

export function requireContractWriter(actor: CrmActor): void {
  if (!actor.canWriteContract) throw new CrmForbiddenError('Bạn không có quyền quản lý hợp đồng.');
}

function revisionOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu số lần sửa của hợp đồng; vui lòng tải lại.');
  }
  return number;
}

/**
 * Đổi lỗi thiếu tồn của Kho thành lỗi 409 có số dòng (Q4: giữ tất cả hoặc
 * không, trả danh sách dòng thiếu để người dùng giảm số lượng hoặc chia đợt).
 */
export function shortageError(
  error: CrmError,
  lines: readonly { lineNo: number; materialCode: string }[],
  subject: string,
): CrmError {
  const raw = (error.details?.['shortages'] ?? []) as readonly Partial<CrmStockShortage>[];
  const shortages: CrmStockShortage[] = raw.map((item) => ({
    lineNo: lines.find((line) => line.materialCode === item.materialCode)?.lineNo ?? null,
    materialCode: String(item.materialCode ?? ''),
    warehouseCode: String(item.warehouseCode ?? ''),
    requested: Number(item.requested ?? 0),
    available: Number(item.available ?? 0),
  }));
  const detail = shortages
    .map((item) => `${item.lineNo ? `dòng ${item.lineNo} ` : ''}(${item.materialCode}) cần ${item.requested}, còn ${item.available}`)
    .join('; ');
  return new CrmConflictError(
    'RESERVATION_INSUFFICIENT_STOCK',
    `Không đủ tồn để giữ hàng cho ${subject}, chưa giữ dòng nào: ${detail || error.message}.`,
    { shortages },
  );
}

/**
 * Hợp đồng ba loại, giá khung, đợt thanh toán (T4-02, T4-03, T4-04).
 *
 * - Xem: `crm.read` trong phạm vi dữ liệu (người phụ trách hợp đồng).
 * - Ghi: `crm.contract.write`. Chỉ sửa được hợp đồng Nháp.
 * - Xác nhận: đợt thanh toán phải đủ 100% giá trị (nếu có đợt); giữ hàng ở Kho
 *   cho dòng hàng tồn kho có số lượng, tất cả hoặc không (Q4), khoá chống lặp
 *   `crm-contract:<id>`; dòng dịch vụ không giữ.
 * - Huỷ: chưa có đơn đã giao; nhả mọi phần đang giữ. Hoàn thành (đóng tay khi
 *   chưa có sổ công nợ), thanh lý (pháp chế xác nhận).
 */
export class ContractService {
  constructor(
    private readonly contracts: ContractStore,
    private readonly customers: Pick<CustomerStore, 'getCustomer'>,
    private readonly catalog: CatalogReader,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly inventory: InventoryClient,
    private readonly settings: Pick<SalesSettingsStore, 'reservationHoldDays'>,
    private readonly dispatcher: IntegrationDispatcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  async list(actor: CrmActor, query: ContractListQuery): Promise<CrmPage<ContractSummary>> {
    const scope = await this.scopes.resolve(actor);
    const within = optionalInteger(query.expiringWithinDays, 0, 3650, 'số ngày sắp hết hạn');
    const today = this.today();
    return this.contracts.listContracts(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      status: optionalEnum(query.status, CONTRACT_STATUSES, 'trạng thái'),
      type: optionalEnum(query.type, CONTRACT_TYPES, 'loại hợp đồng'),
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      expiring: within === null ? undefined : { today, until: addDays(today, within) },
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<ContractDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(CONTRACT_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const detail = await this.contracts.getContract(actor.tenantId, scope, id);
    if (!detail) throw new CrmNotFoundError(CONTRACT_NOT_FOUND);
    return detail;
  }

  async create(actor: CrmActor, request: SaveContractRequest): Promise<ContractDetail> {
    requireContractWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const customerId = optionalId(request?.customerId, 'khách hàng');
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng.');
    const customer = await this.customers.getCustomer(actor.tenantId, scope, customerId);
    if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    const type = contractType(request?.type);
    const lines = await this.buildLines(actor.tenantId, type, request?.lines ?? []);
    const record = this.record(request, type, customerId, lines, actor.userId);
    assertOwnerInScope(scope, record.ownerUserId);
    const id = await this.contracts.createContract(actor.tenantId, record, lines, actor.userId);
    return this.get(actor, id);
  }

  async update(actor: CrmActor, id: string, request: Partial<SaveContractRequest>): Promise<ContractDetail> {
    requireContractWriter(actor);
    const current = await this.get(actor, id);
    const revision = this.expect(current, request?.revision);
    if (current.status !== 'DRAFT') {
      throw new CrmConflictError('CONTRACT_NOT_EDITABLE', 'Chỉ sửa được hợp đồng ở trạng thái Nháp.');
    }
    const scope = await this.scopes.resolve(actor);
    const customerId = optionalId(request?.customerId, 'khách hàng') ?? current.customerId;
    if (customerId !== current.customerId && !(await this.customers.getCustomer(actor.tenantId, scope, customerId))) {
      throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    }
    const type = request?.type === undefined ? current.type : contractType(request.type);
    const lines =
      request?.lines === undefined
        ? current.lines.map((line) => ({ ...line }))
        : await this.buildLines(actor.tenantId, type, request.lines);
    if (request?.lines === undefined && type === 'SALE' && lines.some((line) => line.quantity === null)) {
      throw new CrmValidationError('QUANTITY_REQUIRED', 'Hợp đồng mua bán phải có số lượng ở mọi dòng.');
    }
    // Trường không gửi thì giữ giá trị đang có; đổi dòng mà không gửi giá trị thì tính lại từ dòng.
    const keep = <K extends keyof SaveContractRequest & keyof ContractDetail>(key: K) =>
      request?.[key] === undefined ? current[key] : request[key];
    const record = this.record(
      {
        title: keep('title'),
        signedDate: keep('signedDate'),
        validFrom: keep('validFrom'),
        validTo: keep('validTo'),
        value: request?.value === undefined ? (request?.lines === undefined ? current.value : null) : request.value,
        warrantyMonths: keep('warrantyMonths'),
        warehouseCode: keep('warehouseCode'),
        ownerUserId: keep('ownerUserId'),
        note: keep('note'),
      } as Partial<SaveContractRequest>,
      type,
      customerId,
      lines,
      current.ownerUserId,
    );
    assertOwnerInScope(scope, record.ownerUserId);
    // Giá trị đổi: số tiền của đợt nhập phần trăm tính lại; kiểm tổng để tới lúc xác nhận.
    const terms =
      record.value !== current.value && current.paymentTerms.length
        ? normalizePaymentTerms(
            current.paymentTerms.map((term) => ({
              name: term.name,
              percent: term.percent,
              amount: term.percent === null ? term.amount : null,
              condition: term.condition,
              dueDate: term.dueDate,
              dueDays: term.dueDays,
              note: term.note,
            })),
            record.value,
            false,
          )
        : undefined;
    await this.contracts.updateContract(
      actor.tenantId,
      id,
      revision,
      record,
      request?.lines === undefined ? undefined : lines,
      terms,
      actor.userId,
    );
    return this.get(actor, id);
  }

  async savePaymentTerms(actor: CrmActor, id: string, request: SavePaymentTermsRequest): Promise<ContractDetail> {
    requireContractWriter(actor);
    const current = await this.get(actor, id);
    const revision = this.expect(current, request?.revision);
    if (current.status !== 'DRAFT') {
      throw new CrmConflictError('CONTRACT_NOT_EDITABLE', 'Chỉ sửa đợt thanh toán của hợp đồng ở trạng thái Nháp.');
    }
    const terms = normalizePaymentTerms(request?.terms, current.value);
    await this.contracts.savePaymentTerms(actor.tenantId, id, revision, terms, actor.userId);
    return this.get(actor, id);
  }

  /** Nháp → Hiệu lực (T4-04): kiểm đợt thanh toán, giữ hàng ở Kho rồi ghi. */
  async confirm(actor: CrmActor, id: string, request: ContractActionRequest): Promise<ContractDetail> {
    requireContractWriter(actor);
    const current = await this.get(actor, id);
    const revision = this.expect(current, request?.revision);
    assertContractTransition(current.status, 'ACTIVE');
    const today = this.today();
    if (current.validTo && current.validTo < today) {
      throw new CrmConflictError('CONTRACT_EXPIRED', 'Hợp đồng đã quá ngày kết thúc; vui lòng sửa thời hạn trước khi xác nhận.');
    }
    assertPaymentTermsBalanced(current.paymentTerms, current.value);

    const reservable = reservableContractLines(current.lines);
    let reservation: ReservedStock | null = null;
    if (reservable.length) {
      if (!current.warehouseCode) {
        throw new CrmValidationError('WAREHOUSE_REQUIRED', 'Vui lòng chọn kho giữ hàng cho hợp đồng trước khi xác nhận.');
      }
      reservation = await this.reserve(actor.tenantId, current, reservable, today);
    }
    try {
      await this.contracts.confirm(actor.tenantId, id, revision, reservation, actor.userId);
    } catch (error) {
      // Ghi hợp đồng lỗi sau khi Kho đã giữ: nhả lại và đổi khoá cho lần sau.
      if (reservation) await this.compensate(actor.tenantId, id, reservation.reservationCode);
      throw error;
    }
    return this.get(actor, id);
  }

  async cancel(actor: CrmActor, id: string, request: ContractActionRequest): Promise<ContractDetail> {
    requireContractWriter(actor);
    const current = await this.get(actor, id);
    const revision = this.expect(current, request?.revision);
    assertContractTransition(current.status, 'CANCELLED');
    const reason = requiredReason(request?.reason, 'Phải ghi lý do huỷ hợp đồng.');
    if (current.status === 'ACTIVE' && (await this.contracts.hasDeliveredOrders(actor.tenantId, id))) {
      throw new CrmConflictError('CONTRACT_HAS_DELIVERIES', 'Hợp đồng đã có đơn giao hàng, không huỷ được.');
    }
    await this.contracts.transition(actor.tenantId, id, revision, { from: current.status, to: 'CANCELLED', action: 'cancel', reason }, actor.userId);
    // Nhả phần giữ ngay sau khi ghi; lỗi để job gửi lại.
    await this.dispatcher.dispatch(actor.tenantId).catch(() => undefined);
    return this.get(actor, id);
  }

  /** Hiệu lực → Hoàn thành. Chưa có sổ công nợ (GĐ5) nên đóng tay, cần lý do. */
  async complete(actor: CrmActor, id: string, request: ContractActionRequest): Promise<ContractDetail> {
    return this.close(actor, id, request, 'COMPLETED', 'complete', 'Phải ghi lý do hoàn thành hợp đồng.');
  }

  /** Hoàn thành, Hết hạn → Đã thanh lý (pháp chế xác nhận). */
  async liquidate(actor: CrmActor, id: string, request: ContractActionRequest): Promise<ContractDetail> {
    return this.close(actor, id, request, 'LIQUIDATED', 'liquidate', 'Phải ghi nội dung xác nhận thanh lý.');
  }

  private async close(
    actor: CrmActor,
    id: string,
    request: ContractActionRequest,
    to: 'COMPLETED' | 'LIQUIDATED',
    action: string,
    reasonMessage: string,
  ): Promise<ContractDetail> {
    requireContractWriter(actor);
    const current = await this.get(actor, id);
    const revision = this.expect(current, request?.revision);
    assertContractTransition(current.status, to);
    const reason = requiredReason(request?.reason, reasonMessage);
    await this.contracts.transition(actor.tenantId, id, revision, { from: current.status, to, action, reason }, actor.userId);
    return this.get(actor, id);
  }

  private async reserve(
    tenantId: string,
    contract: ContractDetail,
    lines: readonly ContractLineRecord[],
    today: string,
  ): Promise<ReservedStock> {
    const holdDays = await this.settings.reservationHoldDays(tenantId);
    const expiresAt = reservationExpiry({ today, now: this.now(), holdDays, plannedDate: null });
    for (let round = 0; round < 2; round += 1) {
      const attempt = await this.contracts.reserveAttempt(tenantId, contract.id);
      let reserved: ReservedStock;
      try {
        reserved = await this.inventory.reserve(tenantId, {
          idempotencyKey: reservationIdempotencyKey('crm-contract', contract.id, attempt),
          sourceType: CRM_CONTRACT_SOURCE_TYPE,
          sourceId: contract.id,
          expiresAt,
          notes: `Hợp đồng ${contract.code}`,
          lines: lines.map((line) => ({
            materialCode: line.materialCode,
            warehouseCode: contract.warehouseCode as string,
            quantity: line.quantity as number,
          })),
        });
      } catch (error) {
        if (error instanceof CrmError && error.code === 'RESERVATION_INSUFFICIENT_STOCK') {
          throw shortageError(error, lines, `hợp đồng ${contract.code}`);
        }
        // Khoá đã dùng cho nội dung khác (lần trước giữ rồi phải nhả): thử một lần với khoá mới.
        if (round === 0 && error instanceof CrmError && error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
          await this.contracts.bumpReserveAttempt(tenantId, contract.id);
          continue;
        }
        throw error;
      }
      if (LIVE_RESERVATION.has(reserved.status)) return reserved;
      // Khoá trả lại phần giữ đã đóng (nhả từ lần trước): đổi khoá rồi giữ lại.
      await this.contracts.bumpReserveAttempt(tenantId, contract.id);
    }
    throw new CrmConflictError('RESERVATION_RETRY', 'Không giữ được hàng ở Kho; vui lòng thử lại.');
  }

  private async compensate(tenantId: string, id: string, reservationCode: string): Promise<void> {
    await this.inventory.release(tenantId, reservationCode).catch(() => undefined);
    await this.contracts.bumpReserveAttempt(tenantId, id).catch(() => undefined);
  }

  private expect(current: ContractDetail, value: unknown): number {
    const revision = revisionOf(value);
    if (revision !== current.revision) {
      throw new CrmConflictError('STALE_VERSION', 'Hợp đồng vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');
    }
    return revision;
  }

  private record(
    request: Partial<SaveContractRequest> | undefined,
    type: ContractType,
    customerId: string,
    lines: readonly ContractLineRecord[],
    defaultOwner: string,
  ): ContractRecord {
    const validFrom = optionalDate(request?.validFrom, 'ngày hiệu lực');
    if (!validFrom) throw new CrmValidationError('VALID_FROM_REQUIRED', 'Vui lòng nhập ngày bắt đầu hiệu lực.');
    const validTo = optionalDate(request?.validTo, 'ngày kết thúc');
    if (validTo && validTo < validFrom) {
      throw new CrmValidationError('INVALID_VALIDITY', 'Ngày kết thúc phải sau ngày bắt đầu hiệu lực.');
    }
    const value = optionalMoney(request?.value, 'giá trị hợp đồng') ?? contractDefaultValue(lines);
    const warehouse = optionalText(request?.warehouseCode, 50, 'mã kho');
    return {
      type,
      customerId,
      title: requiredText(request?.title, 300, 'tên hợp đồng'),
      signedDate: optionalDate(request?.signedDate, 'ngày ký'),
      validFrom,
      validTo,
      value,
      warrantyMonths: optionalInteger(request?.warrantyMonths, 0, 600, 'số tháng bảo hành'),
      warehouseCode: warehouse ? warehouse.toUpperCase() : null,
      ownerUserId: optionalId(request?.ownerUserId, 'người phụ trách') ?? defaultOwner,
      note: optionalText(request?.note, 4000, 'ghi chú'),
    };
  }

  /** Dòng giá khung: mặt hàng phải có trong danh mục Kho; hợp đồng mua bán bắt buộc số lượng. */
  private async buildLines(tenantId: string, type: ContractType, raw: readonly SaveContractLineRequest[] | unknown): Promise<ContractLineRecord[]> {
    if (!Array.isArray(raw)) throw new CrmValidationError('INVALID_LINES', 'Danh sách dòng hợp đồng không hợp lệ.');
    if (raw.length > CONTRACT_LINES_MAX) {
      throw new CrmValidationError('TOO_MANY_LINES', `Hợp đồng tối đa ${CONTRACT_LINES_MAX} dòng.`);
    }
    const requests = raw as SaveContractLineRequest[];
    const ids = [...new Set(requests.map((line) => (isUuid(line?.materialId) ? line.materialId.toLowerCase() : '')).filter(Boolean))];
    const known = ids.length ? await this.catalog.materials(tenantId, ids) : new Map();
    const seen = new Set<string>();
    return requests.map((line, index): ContractLineRecord => {
      const fail = (message: string) => new CrmValidationError('INVALID_LINE', `Dòng ${index + 1}: ${message}`, { line: index + 1 });
      if (!isUuid(line?.materialId)) throw fail('vui lòng chọn mặt hàng.');
      const material = known.get(line.materialId.toLowerCase());
      if (!material) throw fail('mặt hàng không có trong danh mục Kho.');
      let unit: string;
      let quantity: number | null;
      let unitPrice: number;
      let vatRate: number;
      try {
        unit = line.unit ? requiredText(line.unit, 50, 'đơn vị tính') : (material.unit ?? '');
        if (!unit) throw new CrmValidationError('UNIT_REQUIRED', 'Vui lòng nhập đơn vị tính.');
        quantity =
          line.quantity === undefined || line.quantity === null || (line.quantity as unknown) === ''
            ? null
            : boundedNumber(line.quantity, 0, QUANTITY_MAX, 'số lượng', 3);
        if (quantity !== null && quantity <= 0) throw new CrmValidationError('INVALID_QUANTITY', 'Số lượng phải lớn hơn 0.');
        unitPrice = boundedNumber(line.unitPrice, 0, AMOUNT_MAX, 'giá khung', 2);
        vatRate = line.vatRate === undefined || line.vatRate === null ? DEFAULT_VAT_RATE : boundedNumber(line.vatRate, 0, 100, 'thuế suất', 2);
      } catch (error) {
        if (error instanceof CrmValidationError) throw fail(error.message.charAt(0).toLowerCase() + error.message.slice(1));
        throw error;
      }
      if (type === 'SALE' && quantity === null) throw fail('hợp đồng mua bán phải có số lượng.');
      const key = `${material.id}|${unit.toLowerCase()}`;
      if (seen.has(key)) throw fail('mặt hàng và đơn vị đã có ở dòng khác.');
      seen.add(key);
      return {
        id: randomUUID(),
        lineNo: index + 1,
        materialId: material.id,
        materialCode: material.code,
        materialName: material.name,
        unit,
        materialKind: material.kind ?? 'STOCK',
        quantity,
        unitPrice,
        vatRate,
        discountPercent: 0,
        lineAmount: contractLineAmount(quantity, unitPrice),
        note: optionalText(line.note, 1000, 'ghi chú dòng'),
      };
    });
  }
}

function contractType(value: unknown): ContractType {
  const type = optionalEnum(value, CONTRACT_TYPES, 'loại hợp đồng');
  if (!type) throw new CrmValidationError('TYPE_REQUIRED', 'Vui lòng chọn loại hợp đồng.');
  return type;
}

function requiredReason(value: unknown, message: string): string {
  const reason = optionalText(value, 2000, 'lý do');
  if (!reason) throw new CrmValidationError('REASON_REQUIRED', message);
  return reason;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

