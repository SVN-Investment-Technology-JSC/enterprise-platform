import type { CreditDecisionRequest, SalesOrderDetail } from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalText } from '../domain/fields.js';
import { evaluateCreditLimit } from '../domain/receivables.js';
import { crmSeesEverything, type CrmActor } from './crm-actor.js';
import type { CreditDecision, CreditLimitCheck } from './fulfillment.port.js';
import type { ApprovalLinks } from './quote-store.port.js';
import type { CreditStore } from './receivable-store.port.js';
import type { SalesOrderService } from './sales-order.service.js';

/**
 * Kiểm hạn mức công nợ khi xác nhận đơn (D5, T5-10, TC-AR-09 đến TC-AR-11): dư
 * nợ theo sổ + giá trị đơn > hạn mức của khách thì chặn (409) hoặc đưa đi duyệt
 * theo cấu hình `credit.limit`. Đưa đi duyệt: đơn sang Chờ duyệt hạn mức cùng
 * yêu cầu duyệt; cách duyệt Quy trình thì tạo phiên `crm_order_credit` ngay sau
 * commit (lỗi để worker thử lại).
 */
export class CreditLimitService implements CreditLimitCheck {
  constructor(
    private readonly store: CreditStore,
    private readonly links: ApprovalLinks,
  ) {}

  async evaluate(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly orderId: string;
    readonly orderAmount: number;
  }): Promise<CreditDecision> {
    const [snapshot, mode] = await Promise.all([
      this.store.snapshot(input.tenantId, input.customerId, input.orderId),
      this.store.creditLimitMode(input.tenantId),
    ]);
    return evaluateCreditLimit({
      creditLimit: snapshot.creditLimit,
      balance: snapshot.balance,
      orderAmount: input.orderAmount,
      mode,
      approvedAmount: snapshot.approvedAmount,
    });
  }

  async requestApproval(input: {
    readonly tenantId: string;
    readonly orderId: string;
    readonly revision: number;
    readonly actorId: string;
    readonly orderAmount: number;
    readonly message: string;
  }): Promise<void> {
    const { linkId } = await this.store.requestApproval(input);
    if (linkId) await this.links.start(input.tenantId, linkId).catch(() => undefined);
  }
}

/**
 * Quyết định yêu cầu duyệt vượt hạn mức (D5). Duyệt trực tiếp: người thấy toàn
 * bộ dữ liệu Bán hàng (quản lý kinh doanh); đơn đi duyệt qua Quy trình thì chỉ
 * Quy trình quyết. Duyệt xong mới giữ hàng; không giữ được hàng (thiếu tồn, hợp
 * đồng hết hiệu lực...) thì đơn về Nháp kèm lý do để người lập xử lý rồi xác
 * nhận lại (không phải duyệt lại nếu giá trị đơn không tăng).
 */
export class CreditApprovalService {
  constructor(
    private readonly store: CreditStore,
    private readonly orders: Pick<SalesOrderService, 'get' | 'confirmAfterCreditApproval'>,
  ) {}

  async decide(actor: CrmActor, orderId: string, approve: boolean, request: CreditDecisionRequest): Promise<SalesOrderDetail> {
    if (!crmSeesEverything(actor)) throw new CrmForbiddenError('Chỉ quản lý kinh doanh mới được duyệt vượt hạn mức công nợ.');
    if (!isUuid(orderId)) throw new CrmNotFoundError('Không tìm thấy đơn bán.');
    const order = await this.orders.get(actor, orderId);
    const pending = await this.store.latestRequest(actor.tenantId, orderId);
    if (order.status !== 'CREDIT_PENDING' || !pending || pending.status !== 'PENDING') {
      throw new CrmConflictError('NO_PENDING_CREDIT_REQUEST', 'Đơn không có yêu cầu duyệt vượt hạn mức đang chờ.');
    }
    if (pending.mode === 'PROCEDURE') {
      throw new CrmConflictError(
        'CREDIT_VIA_PROCEDURE',
        `Đơn đang được duyệt vượt hạn mức trên Quy trình${pending.procedureInstanceCode ? ` (hồ sơ ${pending.procedureInstanceCode})` : ''}.`,
      );
    }
    const note = optionalText(request?.reason, 2000, 'lý do');
    if (!approve && !note) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do từ chối duyệt vượt hạn mức.');
    await this.store.decide(actor.tenantId, pending.id, { approve, actorId: actor.userId, note });
    if (approve) await this.confirmApproved(actor.tenantId, orderId, actor.userId);
    return this.orders.get(actor, orderId);
  }

  /**
   * Đơn đã được duyệt: giữ hàng và xác nhận. Lỗi dữ liệu (thiếu tồn, thiếu kho,
   * hợp đồng hết hiệu lực) đưa đơn về Nháp; lỗi hạ tầng ném ra để thử lại.
   */
  async confirmApproved(tenantId: string, orderId: string, actorId: string | null): Promise<void> {
    try {
      await this.orders.confirmAfterCreditApproval(tenantId, orderId, actorId);
    } catch (error) {
      if (error instanceof CrmError && error.statusCode >= 400 && error.statusCode < 500 && error.code !== 'STALE_VERSION') {
        await this.store.returnToDraft(
          tenantId,
          orderId,
          `Đã duyệt vượt hạn mức nhưng chưa giữ được hàng: ${error.message}`,
          actorId,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Job (T5-17): phiên Quy trình duyệt vượt hạn mức lỗi vĩnh viễn thì yêu cầu
   * chuyển sang duyệt trực tiếp trong Bán hàng và báo người lập.
   */
  redirectFailedProcedures(tenantId: string, limit = 20): Promise<number> {
    return this.store.redirectFailedProcedures(tenantId, limit);
  }

  /** Job: yêu cầu đã duyệt mà đơn còn Chờ duyệt hạn mức (lần giữ hàng trước lỗi hạ tầng). */
  async retryApproved(tenantId: string, limit = 20): Promise<number> {
    const due = await this.store.approvedAwaitingConfirmation(tenantId, limit);
    for (const row of due) await this.confirmApproved(tenantId, row.orderId, null).catch(() => undefined);
    return due.length;
  }
}
