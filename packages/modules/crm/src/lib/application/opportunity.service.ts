import {
  type ChangeOpportunityStageRequest,
  type CreateOpportunityRequest,
  type CrmPage,
  type MyStageTask,
  type OpportunityBoard,
  type OpportunityDetail,
  type OpportunityListQuery,
  type OpportunityStagePlan,
  type OpportunitySummary,
  type Pipeline,
  type SkipStageRequest,
  type StageRequirementCheck,
  type UpdateOpportunityRequest,
  type UpdateStageAssigneeRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import {
  isUuid,
  normalizeSearch,
  optionalDate,
  optionalId,
  optionalMoney,
  optionalText,
  requiredText,
  requiredVersion,
} from '../domain/fields.js';
import {
  allowedTransitions,
  assertRequirementsMet,
  assertStageTransition,
  evaluateRequirements,
  findStage,
  findStageById,
  firstStage,
  isOpenStage,
  normalizeProbability,
  stageRef,
  stageSideEffects,
  type RequirementContext,
} from '../domain/opportunity.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import {
  assertSkippable,
  normalizeSkipReason,
  planStages,
  skippedStageIds,
  validateCreationSkips,
  type PlannedStage,
} from '../domain/stage-plan.js';
import { assertOwnerInScope, requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import type { PipelineConfigProvider } from './pipeline-config.port.js';
import { vietnamToday } from './pricing.service.js';
import type { CustomerStore, OpportunityRecord, OpportunityStore, PeopleDirectory } from './sales-store.port.js';
import { resolveStageAssignee, type StageAssigneeRequest, type StageAssigneeResult } from './stage-assignee.resolver.js';

const OPPORTUNITY_NOT_FOUND = 'Không tìm thấy cơ hội.';
/** Số thẻ tối đa mỗi cột kanban. */
export const OPPORTUNITY_BOARD_PER_STAGE = 50;

/**
 * Chỗ cắm kiểm điều kiện DOCUMENT_TYPE (GĐ C, P2C-11): trả tập mã loại tài
 * liệu (trong `refs`) mà cơ hội đã có tài liệu còn hiệu lực. Chưa có kho tài
 * liệu thì không truyền, điều kiện DOCUMENT_TYPE chỉ vào danh sách "cần có".
 */
export interface OpportunityDocumentChecker {
  /** `refs` là MÃ loại tài liệu (`document_types.code`); trả những mã mà cơ hội đã có tài liệu còn hiệu lực. */
  presentDocumentTypes(tenantId: string, opportunityId: string, refs: readonly string[]): Promise<ReadonlySet<string>>;
  /** Tên hiển thị theo mã, để thông báo thiếu tài liệu nêu đúng tên loại (không có thì dùng mã). */
  documentTypeNames?(tenantId: string, refs: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * Cơ hội và máy trạng thái giai đoạn theo cấu hình luồng (`domain/opportunity.ts`,
 * cấu hình đọc qua `PipelineConfigProvider`, có cache ngắn theo tenant).
 *
 * Mỗi lần chuyển ghi `stage` và `stage_id`, `opportunity_stage_history`,
 * `audit_log` và sự kiện outbox trong cùng transaction (store). Điều kiện chuyển
 * vào giai đoạn (FIELD, QUOTE_APPROVED, REASON, DOCUMENT_TYPE) kiểm ở đây trước
 * khi ghi; QUOTE_APPROVED kiểm lại trong transaction để chống đua. Tác động phụ
 * (`stageSideEffects`): sang Báo giá tạo nháp báo giá nếu chưa có; sang nghĩa
 * LOST thì báo giá mở sang Khách từ chối.
 */
/** Chỗ cắm gán người theo quy tắc (`StageAssigneeResolver`); không có thì chỉ NONE và PROJECT_OWNER gán được. */
export interface StageAssigneeLookup {
  resolve(request: StageAssigneeRequest): Promise<StageAssigneeResult>;
}

/** Số việc tối đa trả cho "Việc của tôi". */
export const MY_STAGE_TASKS_LIMIT = 100;

const STAGE_CHANGE_FORBIDDEN =
  'Chỉ người đảm nhận giai đoạn hiện tại, chủ dự án hoặc quản trị bán hàng mới chuyển được giai đoạn.';

export class OpportunityService {
  constructor(
    private readonly opportunities: OpportunityStore,
    private readonly customers: CustomerStore,
    private readonly scopes: CrmDataScopeService,
    private readonly pipelineConfig: PipelineConfigProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly documents?: OpportunityDocumentChecker,
    private readonly assignees?: StageAssigneeLookup,
    private readonly people?: PeopleDirectory,
  ) {}

  /** Mọi luồng của tenant kèm giai đoạn, bước chuyển, điều kiện (cache ngắn). */
  async listPipelines(actor: CrmActor): Promise<readonly Pipeline[]> {
    return this.pipelineConfig.pipelines(actor.tenantId);
  }

  /**
   * Điều kiện chuyển vào giai đoạn `stageCode` với cơ hội này, kèm trạng thái đạt
   * hay chưa; điều kiện `required = false` chưa đạt là danh sách "cần có" (gợi ý).
   */
  async stageRequirements(actor: CrmActor, id: string, stageCode: unknown): Promise<readonly StageRequirementCheck[]> {
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    const pipeline = await this.pipelineById(actor.tenantId, current.pipeline.id);
    const code = typeof stageCode === 'string' ? stageCode.trim() : '';
    const to = findStage(pipeline, code);
    if (!to) throw new CrmValidationError('INVALID_STAGE', 'Giai đoạn không hợp lệ.');
    return this.checkRequirements(actor.tenantId, current, to, null);
  }

  async list(actor: CrmActor, query: OpportunityListQuery): Promise<CrmPage<OpportunitySummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.opportunities.listOpportunities(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      stage: optionalText(query.stage, 32, 'giai đoạn') ?? undefined,
      pipelineId: optionalId(query.pipelineId, 'luồng') ?? undefined,
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  async board(
    actor: CrmActor,
    query: { ownerUserId?: unknown; q?: unknown; pipelineId?: unknown },
  ): Promise<OpportunityBoard> {
    const scope = await this.scopes.resolve(actor);
    const pipeline = await this.selectPipeline(actor.tenantId, optionalId(query.pipelineId, 'luồng'), false);
    return this.opportunities.board(
      actor.tenantId,
      scope,
      {
        ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
        q: normalizeSearch(query.q),
      },
      OPPORTUNITY_BOARD_PER_STAGE,
      pipeline,
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
    const pipeline = await this.selectPipeline(actor.tenantId, optionalId(request.pipelineId, 'luồng'), true);
    const start = firstStage(pipeline);
    if (!start) {
      throw new CrmConflictError(
        'PIPELINE_NO_START_STAGE',
        `Luồng "${pipeline.name}" chưa có giai đoạn đầu đang bật để tạo cơ hội.`,
      );
    }
    const skips = validateCreationSkips(pipeline, start, request.skipStages);
    const plan = await this.buildPlan(actor.tenantId, pipeline, start.id, record.ownerUserId, skips);
    const id = await this.opportunities.createOpportunity(actor.tenantId, customerId, record, actor.userId, {
      pipelineId: pipeline.id,
      stageId: start.id,
      stageCode: start.code,
      plan,
      stageNames: Object.fromEntries(pipeline.stages.map((stage) => [stage.id, { code: stage.code, name: stage.name }])),
    });
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  async update(actor: CrmActor, id: string, request: UpdateOpportunityRequest): Promise<OpportunityDetail> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    if (!isOpenStage(current.stageInfo)) {
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
        estimateTotalValue:
          request.estimateTotalValue === undefined ? current.estimateTotalValue : request.estimateTotalValue,
        estimateCostValue:
          request.estimateCostValue === undefined ? current.estimateCostValue : request.estimateCostValue,
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
    const code = typeof request.stage === 'string' ? request.stage.trim() : '';
    if (!code) throw new CrmValidationError('INVALID_STAGE', 'Giai đoạn không hợp lệ.');
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    let pipeline = await this.pipelineById(actor.tenantId, current.pipeline.id);
    // Cấu hình trong cache có thể cũ (giai đoạn vừa thêm ở tiến trình khác): tải lại một lần.
    if (!findStage(pipeline, code) || !findStageById(pipeline, current.stageInfo.id)) {
      pipeline = await this.pipelineById(actor.tenantId, current.pipeline.id, true);
    }
    const from = findStageById(pipeline, current.stageInfo.id);
    if (!from) {
      throw new CrmConflictError('STAGE_CHANGED', 'Giai đoạn hiện tại không còn trong cấu hình luồng. Vui lòng tải lại.');
    }
    const to = findStage(pipeline, code);
    if (!to) throw new CrmValidationError('INVALID_STAGE', 'Giai đoạn không hợp lệ.');
    const plan = await this.opportunities.getStagePlan(actor.tenantId, id);
    this.assertCanLeaveStage(actor, current, plan);
    const reason = assertStageTransition(pipeline, from, to, request.reason, skippedStageIds(plan));
    const checks = await this.checkRequirements(actor.tenantId, current, to, reason);
    assertRequirementsMet(checks);
    const quoteRequirement = checks.find((check) => check.kind === 'QUOTE_APPROVED' && check.required);
    await this.opportunities.changeStage(
      actor.tenantId,
      id,
      {
        pipelineId: pipeline.id,
        fromStageId: from.id,
        from: from.code,
        fromSemantic: from.semantic,
        toStageId: to.id,
        to: to.code,
        toSemantic: to.semantic,
        fromSortOrder: from.sortOrder,
        toSortOrder: to.sortOrder,
        reason,
        expectedVersion: request.version === undefined ? undefined : requiredVersion(request.version),
        ...(quoteRequirement ? { requireAcceptedQuote: { message: quoteRequirement.message } } : {}),
        ...stageSideEffects(to, vietnamToday(this.now())),
      },
      actor.userId,
    );
    return this.require(actor.tenantId, { kind: 'all' }, id);
  }

  /** Kế hoạch giai đoạn của dự án (người đảm nhận, trạng thái, bỏ qua, hạn). Ngoài phạm vi: 404. */
  async stagePlan(actor: CrmActor, id: string): Promise<OpportunityStagePlan> {
    const scope = await this.scopes.resolve(actor);
    await this.require(actor.tenantId, scope, id);
    return { opportunityId: id, items: await this.opportunities.getStagePlan(actor.tenantId, id) };
  }

  /**
   * Gán hoặc ghi đè người đảm nhận một giai đoạn chưa xong của riêng dự án. Chủ dự án hoặc `crm.manage`
   * (và có quyền ghi cơ hội); người mới phải là người đang hoạt động trong tổ chức. Mọi đổi người ghi
   * `audit_log` và phát sự kiện `crm.opportunity.stage-assigned`.
   */
  async updateStageAssignee(
    actor: CrmActor,
    id: string,
    stageId: string,
    request: UpdateStageAssigneeRequest,
  ): Promise<OpportunityStagePlan> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    if (current.ownerUserId !== actor.userId && !actor.canManage) {
      throw new CrmForbiddenError('Chỉ chủ dự án hoặc quản trị bán hàng mới đổi được người đảm nhận giai đoạn.');
    }
    if (!isUuid(stageId)) throw new CrmNotFoundError('Giai đoạn không có trong kế hoạch của cơ hội.');
    const assigneeUserId = request?.assigneeUserId === undefined ? undefined : optionalId(request.assigneeUserId, 'người đảm nhận');
    if (assigneeUserId === undefined) {
      throw new CrmValidationError('ASSIGNEE_REQUIRED', 'Vui lòng chọn người đảm nhận (hoặc bỏ trống để bỏ gán).');
    }
    if (assigneeUserId && this.people) {
      const people = await this.people.people(actor.tenantId);
      if (!people.some((person) => person.userId === assigneeUserId)) {
        throw new CrmValidationError('ASSIGNEE_INVALID', 'Người đảm nhận không còn hoạt động hoặc không thuộc tổ chức.');
      }
    }
    await this.opportunities.setStageAssignee(
      actor.tenantId,
      id,
      {
        stageId,
        assigneeUserId,
        ...(request.dueDate === undefined ? {} : { dueDate: optionalDate(request.dueDate, 'hạn giai đoạn') }),
      },
      actor.userId,
    );
    return { opportunityId: id, items: await this.opportunities.getStagePlan(actor.tenantId, id) };
  }

  /**
   * Bỏ qua một giai đoạn của dự án đang chạy. Chủ dự án, người đảm nhận giai đoạn hiện tại hoặc `crm.manage`
   * (403 còn lại); không bỏ qua giai đoạn không cho bỏ qua, giai đoạn hiện tại, đã qua, Thắng, Thua (409);
   * cần lý do (400).
   */
  async skipStage(actor: CrmActor, id: string, stageId: string, request: SkipStageRequest): Promise<OpportunityStagePlan> {
    requireSalesWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const current = await this.require(actor.tenantId, scope, id);
    const plan = await this.opportunities.getStagePlan(actor.tenantId, id);
    this.assertCanLeaveStage(actor, current, plan, 'Chỉ người đảm nhận giai đoạn hiện tại, chủ dự án hoặc quản trị bán hàng mới bỏ qua được giai đoạn.');
    if (!isOpenStage(current.stageInfo)) {
      throw new CrmConflictError('OPPORTUNITY_CLOSED', 'Cơ hội đã đóng (Thắng hoặc Thua), không bỏ qua giai đoạn được.');
    }
    const item = isUuid(stageId) ? plan.find((candidate) => candidate.stage.id === stageId) : undefined;
    if (!item) throw new CrmNotFoundError('Giai đoạn không có trong kế hoạch của cơ hội.');
    assertSkippable({ name: item.stage.name, semantic: item.stage.semantic, skippable: item.skippable }, item.status);
    const reason = normalizeSkipReason(request?.reason);
    await this.opportunities.skipStage(actor.tenantId, id, { stageId, reason }, actor.userId);
    return { opportunityId: id, items: await this.opportunities.getStagePlan(actor.tenantId, id) };
  }

  /** "Việc của tôi": giai đoạn ACTIVE hoặc PENDING giao cho người gọi, ở dự án còn mở. */
  async myStageTasks(actor: CrmActor): Promise<readonly MyStageTask[]> {
    return this.opportunities.listMyStageTasks(actor.tenantId, actor.userId, MY_STAGE_TASKS_LIMIT);
  }

  /** Chủ dự án, người đảm nhận giai đoạn hiện tại hoặc `crm.manage` (đã gồm quản trị tenant) mới được. */
  private assertCanLeaveStage(
    actor: CrmActor,
    current: OpportunityDetail,
    plan: readonly { status: string; assigneeUserId: string | null }[],
    message = STAGE_CHANGE_FORBIDDEN,
  ): void {
    if (actor.canManage || actor.isTenantAdmin || current.ownerUserId === actor.userId) return;
    if (plan.some((item) => item.status === 'ACTIVE' && item.assigneeUserId === actor.userId)) return;
    throw new CrmForbiddenError(message);
  }

  /**
   * Dựng kế hoạch giai đoạn cho dự án mới: mọi giai đoạn đang bật; giai đoạn đầu ACTIVE, giai đoạn bỏ qua
   * SKIPPED, còn lại PENDING; người đảm nhận theo quy tắc của giai đoạn (không tìm được thì trống kèm cảnh báo).
   */
  private async buildPlan(
    tenantId: string,
    pipeline: Pipeline,
    startStageId: string,
    ownerUserId: string,
    skips: ReadonlyMap<string, string>,
  ): Promise<PlannedStage[]> {
    const planned: PlannedStage[] = [];
    for (const stage of planStages(pipeline)) {
      const skippedReason = skips.get(stage.id) ?? null;
      let assignee: StageAssigneeResult = { userId: null };
      if (!skippedReason && stage.assigneeRule !== 'NONE') {
        const request: StageAssigneeRequest = {
          tenantId,
          rule: stage.assigneeRule,
          param: stage.assigneeParam,
          ownerUserId,
        };
        assignee = this.assignees ? await this.assignees.resolve(request) : resolveStageAssignee(request);
      }
      planned.push({
        stageId: stage.id,
        status: skippedReason ? 'SKIPPED' : stage.id === startStageId ? 'ACTIVE' : 'PENDING',
        assigneeUserId: assignee.userId,
        assigneeWarning: assignee.warning?.message ?? null,
        skippedReason,
      });
    }
    return planned;
  }

  private async checkRequirements(
    tenantId: string,
    current: OpportunityDetail,
    to: Pipeline['stages'][number],
    reason: string | null,
  ): Promise<StageRequirementCheck[]> {
    const kinds = new Set(to.requirements.map((requirement) => requirement.kind));
    const hasAcceptedQuote = kinds.has('QUOTE_APPROVED')
      ? await this.opportunities.hasAcceptedQuote(tenantId, current.id)
      : false;
    const documentRefs = to.requirements.filter((r) => r.kind === 'DOCUMENT_TYPE').map((r) => r.ref);
    const present =
      this.documents && documentRefs.length
        ? await this.documents.presentDocumentTypes(tenantId, current.id, documentRefs)
        : undefined;
    const names =
      this.documents?.documentTypeNames && documentRefs.length
        ? await this.documents.documentTypeNames(tenantId, documentRefs)
        : undefined;
    const context: RequirementContext = {
      fields: {
        need: current.need,
        budget: current.budget,
        expectedValue: current.expectedValue,
        expectedCloseDate: current.expectedCloseDate,
      },
      reason,
      hasAcceptedQuote,
      ...(present ? { documentTypeMet: (ref: string) => present.has(ref) } : {}),
    };
    return withDocumentTypeNames(evaluateRequirements(to, context), names);
  }

  /** Luồng được chọn (rỗng thì luồng mặc định); luồng tắt không cho tạo cơ hội mới (`forCreate`). */
  private async selectPipeline(tenantId: string, pipelineId: string | null, forCreate: boolean): Promise<Pipeline> {
    const pipelines = await this.pipelineConfig.pipelines(tenantId);
    const pipeline = pipelineId
      ? pipelines.find((candidate) => candidate.id === pipelineId)
      : pipelines.find((candidate) => candidate.isDefault);
    if (!pipeline) {
      throw pipelineId
        ? new CrmValidationError('INVALID_PIPELINE', 'Luồng bán hàng không tồn tại.')
        : new CrmConflictError('PIPELINE_NOT_CONFIGURED', 'Chưa cấu hình luồng bán hàng mặc định.');
    }
    if (forCreate && !pipeline.active) {
      throw new CrmValidationError('PIPELINE_INACTIVE', `Luồng "${pipeline.name}" đã tắt, không tạo cơ hội mới được.`);
    }
    return pipeline;
  }

  private async pipelineById(tenantId: string, id: string, fresh = false): Promise<Pipeline> {
    if (fresh) this.pipelineConfig.invalidate(tenantId);
    const pipelines = await this.pipelineConfig.pipelines(tenantId);
    const found = pipelines.find((pipeline) => pipeline.id === id);
    if (found) return found;
    if (!fresh) return this.pipelineById(tenantId, id, true);
    throw new CrmConflictError('PIPELINE_NOT_FOUND', 'Luồng của cơ hội không còn trong cấu hình.');
  }

  private async withNextStages(tenantId: string, opportunity: OpportunityDetail): Promise<OpportunityDetail> {
    const pipelines = await this.pipelineConfig.pipelines(tenantId);
    const pipeline = pipelines.find((candidate) => candidate.id === opportunity.pipeline.id);
    const from = pipeline ? findStageById(pipeline, opportunity.stageInfo.id) : undefined;
    const skipped = skippedStageIds(await this.opportunities.getStagePlan(tenantId, opportunity.id));
    const nextStages = pipeline && from ? allowedTransitions(pipeline, from, skipped).map(stageRef) : [];
    return { ...opportunity, nextStages };
  }

  private async require(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    const opportunity = await this.opportunities.getOpportunity(tenantId, scope, id);
    if (!opportunity) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    return this.withNextStages(tenantId, opportunity);
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
    estimateTotalValue?: unknown;
    estimateCostValue?: unknown;
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
    estimateTotalValue: optionalMoney(request.estimateTotalValue, 'tổng giá trị dự toán'),
    estimateCostValue: optionalMoney(request.estimateCostValue, 'giá vốn dự kiến của dự toán'),
    ownerUserId: optionalId(request.ownerUserId, 'người phụ trách') ?? defaultOwner,
  };
}

/**
 * Điều kiện DOCUMENT_TYPE chưa đạt thì thông báo phải nêu TÊN loại tài liệu (không chỉ mã `ref`): thông báo
 * cấu hình sẵn đã chứa tên thì giữ nguyên, chưa có thì nối thêm tên loại thiếu.
 */
function withDocumentTypeNames(
  checks: StageRequirementCheck[],
  names: ReadonlyMap<string, string> | undefined,
): StageRequirementCheck[] {
  if (!names) return checks;
  return checks.map((check) => {
    if (check.kind !== 'DOCUMENT_TYPE' || check.met !== false) return check;
    const name = names.get(check.ref);
    if (!name || check.message.includes(name)) return check;
    return { ...check, message: `${check.message} Loại tài liệu cần có: "${name}".` };
  });
}
