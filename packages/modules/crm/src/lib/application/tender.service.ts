import {
  type OpportunityDetail,
  type Pipeline,
  type RecordTenderResultRequest,
  type SaveTenderPartnerRequest,
  type TenderContractDraft,
  type TenderDecisionRequest,
  type TenderProfile,
  type TenderVersionRequest,
  type CreateTenderProfileRequest,
  type UpdateTenderProfileRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalText, requiredVersion } from '../domain/fields.js';
import { computeNearestSuperiorUserIds } from '../domain/reporting-line.js';
import {
  assertTenderPlanReady,
  assertTenderPlanSubmittable,
  normalizeNewTenderProfile,
  normalizeTenderPartner,
  normalizeTenderProfilePatch,
  normalizeTenderResult,
  tenderPlanImpact,
  TENDER_PARTNER_MAX,
} from '../domain/tender.js';
import { requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { ReportingLineReader } from './organization-scope.port.js';
import type { PipelineConfigProvider } from './pipeline-config.port.js';
import type { ApprovalLinks, QuoteSettingsStore } from './quote-store.port.js';
import type { ChangeStageOptions } from './opportunity.service.js';
import type { OpportunityStore } from './sales-store.port.js';
import type { TenderProfileRecord, TenderStore } from './tender-store.port.js';

const NOT_FOUND = 'Không tìm thấy cơ hội.';

/** Phần `OpportunityService` mà hồ sơ thầu dùng để đổi giai đoạn (cổng hẹp). */
export interface TenderStageChanger {
  changeStage(
    actor: CrmActor,
    id: string,
    request: { stage: string; reason?: string | null },
    options?: ChangeStageOptions,
  ): Promise<OpportunityDetail>;
}

/**
 * Hồ sơ thầu của cơ hội luồng Chào thầu (GĐ E): tạo, sửa, đối tác liên danh, duyệt phương án chào thầu và ghi
 * kết quả.
 *
 * - Chỉ cơ hội thuộc luồng profile `TENDER` có hồ sơ (409 với luồng khác); mỗi cơ hội đúng một hồ sơ.
 * - Phạm vi dữ liệu theo cơ hội (`getOpportunity` đã lọc, kể cả người được gán giai đoạn): ngoài phạm vi 404.
 *   Ghi cần `crm.opportunity.write`; duyệt cần `crm.quote.approve` và không tự duyệt phương án mình trình.
 * - Duyệt phương án áp dụng cả hai nhánh có và không có liên danh; cách duyệt theo `approval_bindings` loại
 *   `TENDER_PLAN` (trực tiếp hoặc qua Quy trình). Không duyệt thì trả về sửa, mỗi lần trình là một vòng mới.
 * - Kết quả thầu đi qua máy trạng thái của luồng (`TenderStageChanger`), nên điều kiện chuyển giai đoạn vẫn
 *   áp dụng; ghi kết quả và đổi giai đoạn cùng một transaction.
 */
export class TenderService {
  constructor(
    private readonly store: TenderStore,
    private readonly opportunities: Pick<OpportunityStore, 'getOpportunity'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly pipelineConfig: PipelineConfigProvider,
    private readonly stages: TenderStageChanger,
    private readonly settings: Pick<QuoteSettingsStore, 'binding'>,
    private readonly links: ApprovalLinks,
    private readonly reportingLines: ReportingLineReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hồ sơ thầu của cơ hội; `null` khi chưa có (hoặc cơ hội không thuộc luồng thầu). Ngoài phạm vi: 404. */
  async get(actor: CrmActor, opportunityId: string): Promise<TenderProfile | null> {
    const opportunity = await this.requireOpportunity(actor, opportunityId);
    const profile = await this.store.findByOpportunity(actor.tenantId, opportunity.id);
    return profile ? this.toDetail(actor, opportunity, profile) : null;
  }

  async create(actor: CrmActor, opportunityId: string, request: CreateTenderProfileRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const opportunity = await this.requireOpportunity(actor, opportunityId);
    await this.assertTenderPipeline(actor.tenantId, opportunity);
    this.assertOpen(opportunity);
    const fields = normalizeNewTenderProfile(request, this.now());
    if (await this.store.findByOpportunity(actor.tenantId, opportunity.id)) throw this.exists();
    await this.store.create(actor.tenantId, opportunity.id, fields, actor.userId);
    return this.reload(actor, opportunity);
  }

  async update(actor: CrmActor, opportunityId: string, request: UpdateTenderProfileRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requireProfile(actor, opportunityId);
    this.assertOpen(opportunity);
    const expected = requiredVersion(request?.version);
    const patch = normalizeTenderProfilePatch(request, profile.submissionDeadline, this.now());
    const planTouched =
      (patch.scenario !== undefined && patch.scenario !== profile.scenario) ||
      (patch.hasJointVenture !== undefined && patch.hasJointVenture !== profile.hasJointVenture);
    if (patch.hasJointVenture === false && profile.hasJointVenture && profile.partners.length) {
      throw new CrmConflictError('PARTNERS_EXIST', 'Hãy xoá danh sách đối tác liên danh trước khi bỏ chọn liên danh.');
    }
    const resetApproval = planTouched ? tenderPlanImpact(profile.planStatus).resetsApproval : false;
    await this.store.update(actor.tenantId, profile.id, expected, patch, actor.userId, resetApproval);
    return this.reload(actor, opportunity);
  }

  // -------------------------------------------------------------------------
  // Đối tác liên danh (danh sách đơn giản)
  // -------------------------------------------------------------------------

  async addPartner(actor: CrmActor, opportunityId: string, request: SaveTenderPartnerRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requirePartnerEditable(actor, opportunityId);
    const partner = normalizeTenderPartner(request);
    if (profile.partners.length >= TENDER_PARTNER_MAX) {
      throw new CrmConflictError('TOO_MANY_PARTNERS', `Danh sách liên danh tối đa ${TENDER_PARTNER_MAX} đối tác.`);
    }
    const { resetsApproval } = tenderPlanImpact(profile.planStatus);
    await this.store.addPartner(actor.tenantId, profile.id, profile.version, partner, actor.userId, resetsApproval);
    return this.reload(actor, opportunity);
  }

  async updatePartner(actor: CrmActor, opportunityId: string, partnerId: string, request: SaveTenderPartnerRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requirePartnerEditable(actor, opportunityId);
    this.requirePartner(profile, partnerId);
    const partner = normalizeTenderPartner(request);
    const { resetsApproval } = tenderPlanImpact(profile.planStatus);
    await this.store.updatePartner(actor.tenantId, profile.id, partnerId, profile.version, partner, actor.userId, resetsApproval);
    return this.reload(actor, opportunity);
  }

  async removePartner(actor: CrmActor, opportunityId: string, partnerId: string): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requirePartnerEditable(actor, opportunityId);
    this.requirePartner(profile, partnerId);
    const { resetsApproval } = tenderPlanImpact(profile.planStatus);
    await this.store.removePartner(actor.tenantId, profile.id, partnerId, profile.version, actor.userId, resetsApproval);
    return this.reload(actor, opportunity);
  }

  // -------------------------------------------------------------------------
  // Duyệt phương án chào thầu
  // -------------------------------------------------------------------------

  /** Trình duyệt phương án (đang soạn hoặc bị trả về sửa): mỗi lần trình là một vòng mới. */
  async submitPlan(actor: CrmActor, opportunityId: string, request: TenderVersionRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requireProfile(actor, opportunityId);
    this.assertOpen(opportunity);
    const expected = requiredVersion(request?.version);
    if (expected !== profile.version) throw this.stale();
    assertTenderPlanSubmittable(profile.planStatus);
    assertTenderPlanReady(profile, profile.partners.length);
    const binding = await this.settings.binding(actor.tenantId, 'TENDER_PLAN');
    const viaProcedure = binding.mode === 'PROCEDURE' && !!binding.procedureDefinitionId;
    const recipients = viaProcedure ? [] : await this.superiors(actor.tenantId, actor.userId);
    const { linkId } = await this.store.submitPlan(actor.tenantId, {
      profileId: profile.id,
      expectedVersion: expected,
      actorId: actor.userId,
      procedure: viaProcedure
        ? {
            definitionId: binding.procedureDefinitionId as string,
            title: `Duyệt phương án chào thầu ${profile.packageName} - ${opportunity.customerName ?? opportunity.name}`.slice(0, 255),
          }
        : null,
      recipientUserIds: recipients,
    });
    // Tạo phiên Quy trình ngay sau khi commit; lỗi đã ghi vào liên kết và worker thử lại.
    if (linkId) await this.links.start(actor.tenantId, linkId).catch(() => undefined);
    return this.reload(actor, opportunity);
  }

  approvePlan(actor: CrmActor, opportunityId: string, request: TenderDecisionRequest): Promise<TenderProfile> {
    return this.decide(actor, opportunityId, request, 'APPROVED');
  }

  /** Không duyệt: trả về sửa (cần lý do); người trình sửa rồi trình lại thành vòng mới, lịch sử các vòng được giữ. */
  rejectPlan(actor: CrmActor, opportunityId: string, request: TenderDecisionRequest): Promise<TenderProfile> {
    return this.decide(actor, opportunityId, request, 'REJECTED');
  }

  // -------------------------------------------------------------------------
  // Kết quả thầu
  // -------------------------------------------------------------------------

  /**
   * Ghi kết quả thầu cùng lần chuyển cơ hội sang giai đoạn Trúng (nghĩa WON) hoặc Trượt (nghĩa LOST) của luồng.
   * Trúng: ghi giá trúng, đặt giá trị cơ hội bằng giá trúng và trả gợi ý lập hợp đồng. Trượt: bắt buộc lý do,
   * cơ hội kết thúc, ghi đơn vị trúng; không có gợi ý chăm sóc.
   */
  async recordResult(actor: CrmActor, opportunityId: string, request: RecordTenderResultRequest): Promise<TenderProfile> {
    requireSalesWriter(actor);
    const { opportunity, profile } = await this.requireProfile(actor, opportunityId);
    this.assertOpen(opportunity);
    const expected = requiredVersion(request?.version);
    if (expected !== profile.version) throw this.stale();
    const input = normalizeTenderResult(request);
    const pipeline = await this.pipelineOf(actor.tenantId, opportunity);
    const target = pipeline.stages.find((stage) => stage.active && stage.semantic === input.result);
    if (!target) {
      throw new CrmConflictError('RESULT_STAGE_MISSING', `Luồng "${pipeline.name}" chưa có giai đoạn ${input.result === 'WON' ? 'Trúng' : 'Trượt'} đang bật.`);
    }
    await this.stages.changeStage(
      actor,
      opportunity.id,
      { stage: target.code, reason: input.reason },
      {
        pendingTenderFields: input.winningPrice ? { winningPrice: input.winningPrice } : {},
        inTransaction: (client) =>
          this.store.writeResult(client, actor.tenantId, {
            profileId: profile.id,
            expectedVersion: expected,
            result: input.result,
            winningPrice: input.winningPrice,
            winnerName: input.winnerName,
            lostReason: input.reason,
            actorId: actor.userId,
          }),
      },
    );
    return this.reload(actor, opportunity);
  }

  // -------------------------------------------------------------------------

  private async decide(
    actor: CrmActor,
    opportunityId: string,
    request: TenderDecisionRequest,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<TenderProfile> {
    if (!actor.canApproveQuote) throw new CrmForbiddenError('Bạn không có quyền duyệt phương án chào thầu.');
    const { opportunity, profile } = await this.requireProfile(actor, opportunityId);
    const expected = requiredVersion(request?.version);
    if (expected !== profile.version) throw this.stale();
    if (profile.planStatus !== 'PENDING') {
      throw new CrmConflictError('PLAN_NOT_PENDING', 'Phương án chào thầu không ở trạng thái chờ duyệt.');
    }
    if (profile.planSubmittedBy === actor.userId) {
      throw new CrmForbiddenError('Không được tự duyệt phương án chào thầu do mình trình.');
    }
    // Đang duyệt qua Quy trình: kết quả đến từ Quy trình. Chỉ duyệt tay khi Quy trình không tạo được phiên.
    const link = await this.store.currentRoundLink(actor.tenantId, profile.id);
    if (link && !(link.status === 'FAILED' && !link.instanceId) && link.status !== 'CLOSED') {
      throw new CrmConflictError('PLAN_IN_PROCEDURE', 'Phương án đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.');
    }
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (decision === 'REJECTED' && !reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do không duyệt.');
    await this.store.decidePlan(actor.tenantId, { profileId: profile.id, expectedVersion: expected, decision, reason, actorId: actor.userId });
    return this.reload(actor, opportunity);
  }

  private stale(): CrmConflictError {
    return new CrmConflictError('STALE_VERSION', 'Hồ sơ thầu vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');
  }

  private exists(): CrmConflictError {
    return new CrmConflictError('TENDER_PROFILE_EXISTS', 'Cơ hội này đã có hồ sơ thầu (mỗi cơ hội chỉ có một hồ sơ).');
  }

  private assertOpen(opportunity: OpportunityDetail): void {
    if (opportunity.stageInfo.semantic !== 'OPEN') {
      throw new CrmConflictError('OPPORTUNITY_CLOSED', 'Cơ hội đã đóng (Trúng hoặc Trượt), không sửa hồ sơ thầu được.');
    }
  }

  private requirePartner(profile: TenderProfileRecord, partnerId: string): void {
    if (!isUuid(partnerId) || !profile.partners.some((partner) => partner.id === partnerId)) {
      throw new CrmNotFoundError('Không tìm thấy đối tác liên danh.');
    }
  }

  private async requirePartnerEditable(actor: CrmActor, opportunityId: string) {
    const found = await this.requireProfile(actor, opportunityId);
    this.assertOpen(found.opportunity);
    if (!found.profile.hasJointVenture) {
      throw new CrmConflictError('NO_JOINT_VENTURE', 'Hồ sơ này không có liên danh; hãy chọn "Có liên danh" trước khi thêm đối tác.');
    }
    return found;
  }

  private async requireOpportunity(actor: CrmActor, opportunityId: string): Promise<OpportunityDetail> {
    if (!isUuid(opportunityId)) throw new CrmNotFoundError(NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const opportunity = await this.opportunities.getOpportunity(actor.tenantId, scope, opportunityId);
    if (!opportunity) throw new CrmNotFoundError(NOT_FOUND);
    return opportunity;
  }

  private async requireProfile(actor: CrmActor, opportunityId: string) {
    const opportunity = await this.requireOpportunity(actor, opportunityId);
    const profile = await this.store.findByOpportunity(actor.tenantId, opportunity.id);
    if (!profile) throw new CrmNotFoundError('Cơ hội này chưa có hồ sơ thầu.');
    return { opportunity, profile };
  }

  private async pipelineOf(tenantId: string, opportunity: OpportunityDetail): Promise<Pipeline> {
    let pipelines = await this.pipelineConfig.pipelines(tenantId);
    let pipeline = pipelines.find((candidate) => candidate.id === opportunity.pipeline.id);
    if (!pipeline) {
      this.pipelineConfig.invalidate(tenantId);
      pipelines = await this.pipelineConfig.pipelines(tenantId);
      pipeline = pipelines.find((candidate) => candidate.id === opportunity.pipeline.id);
    }
    if (!pipeline) throw new CrmConflictError('PIPELINE_NOT_FOUND', 'Luồng của cơ hội không còn trong cấu hình.');
    return pipeline;
  }

  private async assertTenderPipeline(tenantId: string, opportunity: OpportunityDetail): Promise<void> {
    const pipeline = await this.pipelineOf(tenantId, opportunity);
    if (pipeline.profile !== 'TENDER') {
      throw new CrmConflictError('NOT_TENDER_PIPELINE', `Chỉ cơ hội thuộc luồng Chào thầu mới có hồ sơ thầu (cơ hội này thuộc luồng "${pipeline.name}").`);
    }
  }

  private async reload(actor: CrmActor, opportunity: OpportunityDetail): Promise<TenderProfile> {
    const profile = await this.store.findByOpportunity(actor.tenantId, opportunity.id);
    if (!profile) throw new CrmNotFoundError('Không tìm thấy hồ sơ thầu.');
    // Giai đoạn có thể vừa đổi (ghi kết quả): đọc lại cơ hội để `editable` đúng.
    const scope = await this.scopes.resolve(actor);
    const fresh = (await this.opportunities.getOpportunity(actor.tenantId, scope, opportunity.id)) ?? opportunity;
    return this.toDetail(actor, fresh, profile);
  }

  private async superiors(tenantId: string, userId: string): Promise<string[]> {
    try {
      return computeNearestSuperiorUserIds(await this.reportingLines.snapshot(tenantId), userId);
    } catch {
      return [];
    }
  }

  private toDetail(_actor: CrmActor, opportunity: OpportunityDetail, profile: TenderProfileRecord): TenderProfile {
    const rounds = profile.rounds;
    const current = rounds.find((round) => round.roundNo === profile.planRoundNo);
    const contractDraft: TenderContractDraft | null =
      profile.result === 'WON' && profile.winningPrice
        ? {
            type: 'SALE',
            customerId: opportunity.customerId,
            title: `Hợp đồng ${profile.packageName}`.slice(0, 300),
            value: profile.winningPrice,
            validFrom: vietnamToday(this.now()),
            ownerUserId: opportunity.ownerUserId,
          }
        : null;
    return {
      id: profile.id,
      opportunityId: profile.opportunityId,
      packageName: profile.packageName,
      inviterName: profile.inviterName,
      packageCode: profile.packageCode,
      submissionDeadline: profile.submissionDeadline,
      submissionMethod: profile.submissionMethod,
      submitterUserId: profile.submitterUserId,
      submittedAt: profile.submittedAt,
      hasJointVenture: profile.hasJointVenture,
      scenario: profile.scenario,
      plan: {
        status: profile.planStatus,
        roundNo: profile.planRoundNo,
        submittedAt: profile.planSubmittedAt,
        submittedBy: profile.planSubmittedBy,
        decidedAt: profile.planDecidedAt,
        decidedBy: profile.planDecidedBy,
        decisionReason: profile.planDecisionReason,
        via: current?.via ?? null,
        procedureInstanceCode: current?.procedureInstanceCode ?? null,
      },
      result: profile.result,
      winningPrice: profile.winningPrice,
      winnerName: profile.winnerName,
      lostReason: profile.lostReason,
      resultRecordedAt: profile.resultRecordedAt,
      resultRecordedBy: profile.resultRecordedBy,
      partners: profile.partners,
      rounds,
      contractDraft,
      editable: opportunity.stageInfo.semantic === 'OPEN',
      planLocked: profile.planStatus === 'PENDING',
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
