import {
  CREDIT_LIMIT_MODES,
  RECEIPT_METHODS,
  RECEIPT_STATUSES,
  type CreateReceiptRequest,
  type CrmPage,
  type CustomerAgingRow,
  type CustomerLedger,
  type ReceiptActionRequest,
  type ReceiptDetail,
  type ReceiptListQuery,
  type ReceiptMethod,
  type ReceiptSummary,
  type ReceivableAgingQuery,
  type ReceivableSettings,
  type ResendReceiptRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, normalizeSearch, optionalDate, optionalEnum, optionalId, optionalText, requiredVersion } from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { normalizeAllocations, positiveAmount } from '../domain/receivables.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { IntegrationDispatcher } from './fulfillment.port.js';
import { vietnamToday } from './pricing.service.js';
import type { ReceivableStore } from './receivable-store.port.js';

const RECEIPT_NOT_FOUND = 'Không tìm thấy lần thu.';

/** Thu tiền, phân bổ, gửi lại lần thu: `crm.receivable.write`. */
export function requireReceivableWriter(actor: CrmActor): void {
  if (!actor.canWriteReceivable) throw new CrmForbiddenError('Bạn không có quyền thu tiền, điều chỉnh công nợ.');
}

/**
 * Sổ công nợ, tuổi nợ, lần thu tiền và phân bổ (T5-06, T5-09, T5-11, T5-12).
 *
 * - Xem: `crm.read` trong phạm vi dữ liệu (người phụ trách khách hàng).
 * - Ghi nhận thu tiền: `crm.receivable.write`; phân bổ vào một hay nhiều khoản
 *   nợ, tổng phân bổ không vượt số thu, mỗi khoản không vượt số còn nợ (khoá
 *   `FOR UPDATE`). Lần thu chờ Tài chính tạo phiếu thu nháp (khoá chống lặp
 *   `crm-receipt:<id>`); phân bổ chỉ có hiệu lực khi phiếu được ghi sổ (Q10).
 * - Không có thao tác sửa số dư hay dòng sổ (TC-AR-08): sai thì điều chỉnh.
 */
export class ReceivableService {
  constructor(
    private readonly store: ReceivableStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly dispatcher: IntegrationDispatcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  async aging(actor: CrmActor, query: ReceivableAgingQuery): Promise<CrmPage<CustomerAgingRow>> {
    const scope = await this.scopes.resolve(actor);
    const limit = Number(query?.limit);
    return this.store.agingReport(actor.tenantId, scope, {
      q: normalizeSearch(query?.q),
      ownerUserId: optionalId(query?.ownerUserId, 'người phụ trách') ?? undefined,
      overdue: query?.overdue === true || query?.overdue === 'true',
      today: this.today(),
      limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200,
    });
  }

  async ledger(actor: CrmActor, customerId: string): Promise<CustomerLedger> {
    if (!isUuid(customerId)) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    const scope = await this.scopes.resolve(actor);
    const ledger = await this.store.ledger(actor.tenantId, scope, customerId, this.today());
    if (!ledger) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    return ledger;
  }

  async listReceipts(actor: CrmActor, query: ReceiptListQuery): Promise<CrmPage<ReceiptSummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.store.listReceipts(actor.tenantId, scope, {
      customerId: optionalId(query?.customerId, 'khách hàng') ?? undefined,
      status: optionalEnum(query?.status, RECEIPT_STATUSES, 'trạng thái'),
      cursor: decodeCursor(query?.cursor),
      limit: pageLimit(query?.limit),
    });
  }

  async getReceipt(actor: CrmActor, id: string): Promise<ReceiptDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(RECEIPT_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const receipt = await this.store.getReceipt(actor.tenantId, scope, id);
    if (!receipt) throw new CrmNotFoundError(RECEIPT_NOT_FOUND);
    return receipt;
  }

  /** Ghi nhận thu tiền và phân bổ (T5-06, TC-AR-03, TC-AR-04); gửi Tài chính ngay sau commit. */
  async createReceipt(actor: CrmActor, request: CreateReceiptRequest): Promise<ReceiptDetail> {
    requireReceivableWriter(actor);
    const customerId = optionalId(request?.customerId, 'khách hàng');
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng.');
    // Khách phải nằm trong phạm vi dữ liệu của người thu.
    await this.ledger(actor, customerId);
    const amount = positiveAmount(request?.amount, 'Số tiền thu');
    const id = await this.store.createReceipt(
      actor.tenantId,
      {
        customerId,
        amount,
        method: receiptMethod(request?.method),
        receiptDate: optionalDate(request?.receiptDate, 'ngày thu') ?? this.today(),
        note: optionalText(request?.note, 2000, 'ghi chú'),
        allocations: normalizeAllocations(request?.allocations, amount),
        actorName: actor.displayName,
      },
      actor.userId,
    );
    await this.dispatcher.dispatch(actor.tenantId).catch(() => undefined);
    return this.getReceipt(actor, id);
  }

  /** Lần thu bị Tài chính trả lại (hoặc từ chối): sửa rồi gửi lại, cùng phiếu được mở lại. */
  async resendReceipt(actor: CrmActor, id: string, request: ResendReceiptRequest): Promise<ReceiptDetail> {
    requireReceivableWriter(actor);
    const current = await this.getReceipt(actor, id);
    const revision = requiredVersion(request?.revision);
    const amount = request?.amount === undefined ? current.amount : positiveAmount(request.amount, 'Số tiền thu');
    const allocations =
      request?.allocations === undefined
        ? normalizeAllocations(
            current.allocations.map((line) => ({ entryId: line.entryId, amount: line.amount })),
            amount,
          )
        : normalizeAllocations(request.allocations, amount);
    await this.store.resendReceipt(
      actor.tenantId,
      id,
      revision,
      {
        amount,
        method: request?.method === undefined ? current.method : receiptMethod(request.method),
        receiptDate:
          request?.receiptDate === undefined ? current.receiptDate : (optionalDate(request.receiptDate, 'ngày thu') ?? this.today()),
        note: request?.note === undefined ? current.note : optionalText(request.note, 2000, 'ghi chú'),
        allocations,
        actorName: actor.displayName,
      },
      actor.userId,
    );
    await this.dispatcher.dispatch(actor.tenantId).catch(() => undefined);
    return this.getReceipt(actor, id);
  }

  async cancelReceipt(actor: CrmActor, id: string, request: ReceiptActionRequest): Promise<ReceiptDetail> {
    requireReceivableWriter(actor);
    await this.getReceipt(actor, id);
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (!reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do huỷ lần thu.');
    await this.store.cancelReceipt(actor.tenantId, id, requiredVersion(request?.revision), reason, actor.userId);
    return this.getReceipt(actor, id);
  }

  /** Đợt thanh toán "khi nghiệm thu" (tạm thời đến khi có nghiệm thu CON-04): ghi nhận nợ bằng tay. */
  async triggerPaymentTerm(actor: CrmActor, contractId: string, termId: string, rawDate: unknown): Promise<void> {
    if (!actor.canWriteContract && !actor.canWriteReceivable) {
      throw new CrmForbiddenError('Bạn không có quyền ghi nhận đợt thanh toán của hợp đồng.');
    }
    if (!isUuid(contractId) || !isUuid(termId)) throw new CrmNotFoundError('Không tìm thấy đợt thanh toán.');
    const date = optionalDate(rawDate, 'ngày nghiệm thu') ?? this.today();
    await this.store.triggerPaymentTerm(actor.tenantId, contractId, termId, date, actor.userId);
  }

  async settings(actor: CrmActor): Promise<ReceivableSettings> {
    return this.store.settings(actor.tenantId);
  }

  async saveSettings(actor: CrmActor, request: Partial<ReceivableSettings>): Promise<ReceivableSettings> {
    requireSalesManager(actor);
    const current = await this.store.settings(actor.tenantId);
    const raw = request?.alertUserIds;
    if (raw !== undefined && !Array.isArray(raw)) {
      throw new CrmValidationError('INVALID_RECIPIENTS', 'Danh sách người nhận cảnh báo không hợp lệ.');
    }
    const alertUserIds = raw === undefined ? current.alertUserIds : [...new Set(raw.map((id) => String(id).toLowerCase()))];
    if (alertUserIds.length > 50 || alertUserIds.some((id) => !isUuid(id))) {
      throw new CrmValidationError('INVALID_RECIPIENTS', 'Danh sách người nhận cảnh báo không hợp lệ (tối đa 50 người).');
    }
    if (request?.recognitionMode !== undefined && request.recognitionMode !== 'ON_DELIVERY') {
      throw new CrmValidationError('INVALID_VALUE', 'Điểm ghi nhận nợ không hợp lệ.');
    }
    await this.store.saveSettings(
      actor.tenantId,
      {
        recognitionMode: 'ON_DELIVERY',
        creditLimitMode: optionalEnum(request?.creditLimitMode, CREDIT_LIMIT_MODES, 'cách xử lý vượt hạn mức') ?? current.creditLimitMode,
        alertUserIds,
      },
      actor.userId,
    );
    return this.store.settings(actor.tenantId);
  }
}

function receiptMethod(value: unknown): ReceiptMethod {
  return optionalEnum(value, RECEIPT_METHODS, 'hình thức thu') ?? 'BANK_TRANSFER';
}
