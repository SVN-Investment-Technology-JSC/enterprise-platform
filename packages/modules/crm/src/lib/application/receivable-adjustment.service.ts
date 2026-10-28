import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_STATUSES,
  type AdjustmentActionRequest,
  type AdjustmentDirection,
  type AdjustmentListQuery,
  type CreateAdjustmentRequest,
  type CrmPage,
  type ReceivableAdjustment,
} from '@enterprise-platform/contracts-crm';
import { CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalEnum, optionalId, optionalText, requiredText, requiredVersion } from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { positiveAmount } from '../domain/receivables.js';
import { crmSeesEverything, type CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import { requireReceivableWriter } from './receivable.service.js';
import type { ReceivableStore } from './receivable-store.port.js';

const ADJUSTMENT_NOT_FOUND = 'Không tìm thấy điều chỉnh công nợ.';
const ALL: CrmDataScope = { kind: 'all' };

/**
 * Yêu cầu điều chỉnh từ nghiệp vụ khác của Bán hàng (bảo hành trả hàng, T6-06).
 * `amount` dương; `direction` mặc định giảm trừ công nợ. Gọi lặp cùng
 * `sourceType`/`sourceId` trả lại điều chỉnh đã tạo (`created = false`).
 */
export interface CreateAdjustmentCommand {
  readonly customerId: string;
  readonly orderId?: string | null;
  readonly amount: number;
  readonly reason: string;
  /** Nghiệp vụ nguồn, ví dụ `crm_warranty_case`. */
  readonly sourceType: string;
  /** Id bản ghi nguồn (unique theo `sourceType`). */
  readonly sourceId: string;
  /** Người tạo; điều chỉnh vẫn phải được người khác duyệt mới vào sổ. */
  readonly actor: Pick<CrmActor, 'tenantId' | 'userId'>;
  readonly direction?: AdjustmentDirection;
}

/**
 * Chứng từ điều chỉnh công nợ (AR-05, T5-08): giảm trừ (trả hàng, chiết khấu
 * thanh toán, xoá nợ) hoặc tăng nợ, có lý do; người duyệt là quản lý bán hàng
 * (`crm.manage` hoặc thấy toàn bộ dữ liệu) và không phải người lập. Duyệt mới ghi
 * dòng ADJUSTMENT vào sổ; dòng gốc không đổi (TC-AR-07).
 */
export class ReceivableAdjustmentService {
  constructor(
    private readonly store: ReceivableStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(actor: CrmActor, query: AdjustmentListQuery): Promise<CrmPage<ReceivableAdjustment>> {
    const scope = await this.scopes.resolve(actor);
    return this.store.listAdjustments(actor.tenantId, scope, {
      customerId: optionalId(query?.customerId, 'khách hàng') ?? undefined,
      status: optionalEnum(query?.status, ADJUSTMENT_STATUSES, 'trạng thái'),
      cursor: decodeCursor(query?.cursor),
      limit: pageLimit(query?.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<ReceivableAdjustment> {
    if (!isUuid(id)) throw new CrmNotFoundError(ADJUSTMENT_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const adjustment = await this.store.getAdjustment(actor.tenantId, scope, id);
    if (!adjustment) throw new CrmNotFoundError(ADJUSTMENT_NOT_FOUND);
    return adjustment;
  }

  /** Lập điều chỉnh Chờ duyệt từ màn công nợ: `crm.receivable.write`, khách trong phạm vi. */
  async create(actor: CrmActor, request: CreateAdjustmentRequest): Promise<ReceivableAdjustment> {
    requireReceivableWriter(actor);
    const customerId = optionalId(request?.customerId, 'khách hàng');
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng.');
    const scope = await this.scopes.resolve(actor);
    if (!(await this.store.ledger(actor.tenantId, scope, customerId, vietnamToday(this.now())))) {
      throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    }
    const direction = optionalEnum(request?.direction, ADJUSTMENT_DIRECTIONS, 'loại điều chỉnh');
    if (!direction) throw new CrmValidationError('DIRECTION_REQUIRED', 'Vui lòng chọn giảm trừ hay tăng công nợ.');
    const created = await this.store.createAdjustment(
      actor.tenantId,
      {
        customerId,
        orderId: optionalId(request?.orderId, 'đơn bán'),
        entryId: direction === 'DECREASE' ? optionalId(request?.entryId, 'khoản nợ') : null,
        direction,
        amount: positiveAmount(request?.amount, 'Số tiền điều chỉnh'),
        reason: requiredText(request?.reason, 2000, 'lý do điều chỉnh'),
        sourceType: null,
        sourceId: null,
      },
      actor.userId,
    );
    return this.get(actor, created.id);
  }

  /**
   * Cổng cho nghiệp vụ khác trong Bán hàng (bảo hành, T6-06): tạo điều chỉnh Chờ
   * duyệt, idempotent theo nguồn. Bên gọi tự kiểm quyền nghiệp vụ của mình.
   */
  async createAdjustment(command: CreateAdjustmentCommand): Promise<{ adjustment: ReceivableAdjustment; created: boolean }> {
    const customerId = optionalId(command.customerId, 'khách hàng');
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Thiếu khách hàng của điều chỉnh công nợ.');
    const sourceType = requiredText(command.sourceType, 40, 'nguồn điều chỉnh');
    const sourceId = requiredText(command.sourceId, 200, 'mã bản ghi nguồn');
    const direction = optionalEnum(command.direction, ADJUSTMENT_DIRECTIONS, 'loại điều chỉnh') ?? 'DECREASE';
    const result = await this.store.createAdjustment(
      command.actor.tenantId,
      {
        customerId,
        orderId: optionalId(command.orderId, 'đơn bán'),
        entryId: null,
        direction,
        amount: positiveAmount(command.amount, 'Số tiền điều chỉnh'),
        reason: requiredText(command.reason, 2000, 'lý do điều chỉnh'),
        sourceType,
        sourceId,
      },
      command.actor.userId,
    );
    const adjustment = await this.store.getAdjustment(command.actor.tenantId, ALL, result.id);
    if (!adjustment) throw new CrmNotFoundError(ADJUSTMENT_NOT_FOUND);
    return { adjustment, created: result.created };
  }

  /** Duyệt: quản lý bán hàng, không phải người lập (AR-05). */
  async approve(actor: CrmActor, id: string, request: AdjustmentActionRequest): Promise<ReceivableAdjustment> {
    if (!crmSeesEverything(actor)) throw new CrmForbiddenError('Chỉ quản lý bán hàng mới được duyệt điều chỉnh công nợ.');
    const current = await this.get(actor, id);
    if (current.createdBy === actor.userId) {
      throw new CrmForbiddenError('Người lập điều chỉnh không được tự duyệt.');
    }
    await this.store.approveAdjustment(actor.tenantId, id, requiredVersion(request?.revision), actor.userId, vietnamToday(this.now()));
    return this.get(actor, id);
  }

  /** Huỷ điều chỉnh Chờ duyệt: người lập hoặc quản lý bán hàng, có lý do. */
  async cancel(actor: CrmActor, id: string, request: AdjustmentActionRequest): Promise<ReceivableAdjustment> {
    const current = await this.get(actor, id);
    if (current.createdBy !== actor.userId && !crmSeesEverything(actor)) {
      throw new CrmForbiddenError('Chỉ người lập hoặc quản lý bán hàng mới huỷ được điều chỉnh.');
    }
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (!reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do huỷ điều chỉnh.');
    await this.store.cancelAdjustment(actor.tenantId, id, requiredVersion(request?.revision), reason, actor.userId);
    return this.get(actor, id);
  }
}
