import {
  OPPORTUNITY_STAGES,
  type ChangeOpportunityStageRequest,
  type CreateOpportunityRequest,
  type CrmPage,
  type OpportunityBoard,
  type OpportunityDetail,
  type OpportunityListQuery,
  type OpportunitySummary,
  type UpdateOpportunityRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import {
  isUuid,
  normalizeSearch,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalMoney,
  optionalText,
  requiredText,
  requiredVersion,
} from '../domain/fields.js';
import { assertStageTransition, isOpenStage, isOpportunityStage, normalizeProbability } from '../domain/opportunity.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { assertOwnerInScope, requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import type { CustomerStore, OpportunityRecord, OpportunityStore } from './sales-store.port.js';

const OPPORTUNITY_NOT_FOUND = 'Không tìm thấy cơ hội.';
/** Số thẻ tối đa mỗi cột kanban. */
export const OPPORTUNITY_BOARD_PER_STAGE = 50;

/**
 * Cơ hội và máy trạng thái giai đoạn (`domain/opportunity.ts`).
 *
 * Mỗi lần chuyển ghi `opportunity_stage_history` và `audit_log` trong cùng
 * transaction (store). Đàm phán → Thắng hiện chỉ cần đúng giai đoạn; điều kiện
 * "có báo giá Khách chấp nhận" thêm ở GĐ3 khi có bảng báo giá (T3-14 và máy
 * trạng thái báo giá), kiểm ở `changeStage` trước khi gọi store.
 */
export class OpportunityService {
  constructor(
    private readonly opportunities: OpportunityStore,
    private readonly customers: CustomerStore,
    private readonly scopes: CrmDataScopeService,
  ) {}

  async list(actor: CrmActor, query: OpportunityListQuery): Promise<CrmPage<OpportunitySummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.opportunities.listOpportunities(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      stage: optionalEnum(query.stage, OPPORTUNITY_STAGES, 'giai đoạn'),
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async board(actor: CrmActor, query: { ownerUserId?: unknown; q?: unknown }): Promise<OpportunityBoard> {
    const scope = await this.scopes.resolve(actor);
    return this.opportunities.board(
      actor.tenantId,
      scope,
      {
        ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
        q: normalizeSearch(query.q),
      },
      OPPORTUNITY_BOARD_PER_STAGE,
    );
  }

  async get(actor: CrmActor, id: string): Promise<OpportunityDetail> {
    const scope = await this.scopes.resolve(actor);
    return this.require(actor.tenantId, scope, id);
  }

  async create(actor: CrmActor, request: CreateOpportunityRequest): Promise<OpportunityDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const customerId = optionalId(request.customerId, 'khách hàng');
    if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng.');
    // Khách ngoài phạm vi: như không có.
    const customer = await this.customers.getCustomer(actor.tenantId, scope, customerId);
    if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    const record = opportunityRecord(request, actor.userId);
    assertOwnerInScope(scope, record.ownerUserId);
    const id = await this.opportunities.createOpportunity(actor.tenantId, customerId, record, actor.userId);
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async update(actor: CrmActor, id: string, request: UpdateOpportunityRequest): Promise<OpportunityDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    if (!isOpenStage(current.stage)) {
      throw new CrmConflictError('OPPORTUNITY_CLOSED', 'Cơ hội đã đóng (Thắng hoặc Thua), không sửa được.');
    }
    const record = opportunityRecord(
      {
        name: request.name ?? current.name,
        probability: request.probability ?? current.probability,
        expectedValue: request.expectedValue === undefined ? current.expectedValue : request.expectedValue,
        expectedCloseDate:
          request.expectedCloseDate === undefined ? current.expectedCloseDate : request.expectedCloseDate,
        need: request.need === undefined ? current.need : request.need,
        budget: request.budget === undefined ? current.budget : request.budget,
        ownerUserId: request.ownerUserId ?? current.ownerUserId,
      },
      current.ownerUserId,
    );
    if (record.ownerUserId !== current.ownerUserId) assertOwnerInScope(scope, record.ownerUserId);
    await this.opportunities.updateOpportunity(
      actor.tenantId,
      id,
      record,
      requiredVersion(request.version),
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async changeStage(
    actor: CrmActor,
    id: string,
    request: ChangeOpportunityStageRequest,
  ): Promise<OpportunityDetail> {
    requireSalesWriter(actor);
    if (!isOpportunityStage(request.stage)) {
      throw new CrmValidationError('INVALID_STAGE', 'Giai đoạn không hợp lệ.');
    }
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    const reason = assertStageTransition(current.stage, request.stage, request.reason);
    await this.opportunities.changeStage(
      actor.tenantId,
      id,
      {
        from: current.stage,
        to: request.stage,
        reason,
        expectedVersion: request.version === undefined ? undefined : requiredVersion(request.version),
      },
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  private async require(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    const opportunity = await this.opportunities.getOpportunity(tenantId, scope, id);
    if (!opportunity) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    return opportunity;
  }
}

export function opportunityRecord(
  request: {
    name?: unknown;
    probability?: unknown;
    expectedValue?: unknown;
    expectedCloseDate?: unknown;
    need?: unknown;
    budget?: unknown;
    ownerUserId?: unknown;
  },
  defaultOwner: string,
): OpportunityRecord {
  return {
    name: requiredText(request.name, 300, 'tên cơ hội'),
    probability: normalizeProbability(request.probability),
    expectedValue: optionalMoney(request.expectedValue, 'giá trị dự kiến'),
    expectedCloseDate: optionalDate(request.expectedCloseDate, 'ngày chốt dự kiến'),
    need: optionalText(request.need, 4000, 'nhu cầu'),
    budget: optionalMoney(request.budget, 'ngân sách'),
    ownerUserId: optionalId(request.ownerUserId, 'người phụ trách') ?? defaultOwner,
  };
}
