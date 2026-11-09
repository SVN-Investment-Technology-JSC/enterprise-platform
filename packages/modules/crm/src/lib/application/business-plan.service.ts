import {
  type BusinessPlanCostLine,
  type BusinessPlanDecisionRequest,
  type BusinessPlanDetail,
  type BusinessPlanDeviation,
  type BusinessPlanDeviationSettings,
  type BusinessPlanFigures,
  type BusinessPlanVersionRequest,
  type QuoteApprovalReason,
  type QuoteVersion,
  type SaveBusinessPlanRequest,
} from '@enterprise-platform/contracts-crm';
import {
  assertPlanEditable,
  assertPlanSubmittable,
  computeBusinessPlan,
  normalizeDeviationSettings,
  normalizePlanLines,
  type PlanBasis,
} from '../domain/business-plan.js';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalText } from '../domain/fields.js';
import { evaluatePlanApproval } from '../domain/quote-approval-policy.js';
import type { BusinessPlanRecord, BusinessPlanStore, PlanAttachment, PlanLineRecord } from './business-plan-store.port.js';
import { canViewQuoteCost, requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ApprovalLinks, EditableQuote, QuoteSettingsStore, QuoteStore } from './quote-store.port.js';

const QUOTE_NOT_FOUND = 'Không tìm thấy báo giá.';

/** Kết quả kiểm PAKD khi gửi duyệt báo giá: lý do thêm và PAKD cần đính vào hồ sơ. */
export interface PlanSubmissionCheck {
  readonly reasons: QuoteApprovalReason[];
  readonly attachment: PlanAttachment | null;
}

/** Phần QuoteService dùng của PAKD (cổng hẹp để QuoteService không phụ thuộc cả service này). */
export interface QuoteBusinessPlans {
  /** PAKD của phiên bản đang xem, theo quyền của người xem; rỗng khi chưa lập. */
  detail(actor: CrmActor, quoteId: string, version: QuoteVersion): Promise<BusinessPlanDetail | null>;
  /**
   * Lý do cần duyệt do PAKD (đang soạn thì cần duyệt, lệch PAKD đã duyệt gần nhất thì buộc trình lại).
   * `forSubmit`: PAKD đang chờ duyệt hoặc bị từ chối thì 409 thay vì bỏ qua.
   */
  check(tenantId: string, quoteId: string, version: QuoteVersion, forSubmit: boolean): Promise<PlanSubmissionCheck>;
}

const basisOf = (version: QuoteVersion): PlanBasis => ({
  grossAmount: version.totals.grossAmount,
  quoteDiscountAmount: version.totals.discountAmount,
  revenue: version.totals.netAmount + version.totals.shippingAmount,
  goodsCost: version.totals.estCost,
});

const costLinesOf = (lines: readonly { kind: BusinessPlanCostLine['kind']; amount: number }[]) =>
  lines.map((line) => ({ kind: line.kind, amount: line.amount }));

function versionNoOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
  return number;
}

function planVersionOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu số lần sửa của phương án kinh doanh; vui lòng tải lại.');
  }
  return number;
}

function requireWriter(actor: CrmActor): void {
  if (!actor.canWriteQuote) throw new CrmForbiddenError('Bạn không có quyền lập phương án kinh doanh.');
}

function requireApprover(actor: CrmActor): void {
  if (!actor.canApproveQuote) throw new CrmForbiddenError('Bạn không có quyền duyệt phương án kinh doanh.');
}

/**
 * Phương án kinh doanh (PAKD, GĐ D): lập, sửa, trình, duyệt, từ chối, và nối vào duyệt báo giá.
 *
 * - Mỗi phiên bản báo giá có tối đa một PAKD; lập và sửa khi phiên bản còn Nháp; trình duyệt thì khoá.
 * - Gửi duyệt báo giá kèm PAKD đang soạn thì PAKD đi cùng hồ sơ duyệt (trực tiếp và qua Quy trình), được duyệt
 *   hay bị từ chối cùng báo giá; có thể trình, duyệt PAKD riêng khi báo giá chưa gửi.
 * - Người trình không tự duyệt. Bị từ chối thì sửa lại (về đang soạn) rồi trình lại, mỗi lần trình là một vòng
 *   và lịch sử các vòng được giữ.
 * - PAKD trình riêng duyệt theo loại `BUSINESS_PLAN` (D3-30): trực tiếp trong CRM, hoặc qua Quy trình
 *   (`crm_business_plan`, kết quả áp từ sự kiện của Quy trình; đang chờ thì duyệt tay bị chặn 409).
 * - Quyền xem giá vốn, lợi nhuận (`crm.quote.cost.read`) kiểm ở đây; người không có chỉ thấy doanh thu.
 * - Báo giá ngoài phạm vi dữ liệu trả 404 như báo giá.
 */
export class BusinessPlanService implements QuoteBusinessPlans {
  constructor(
    private readonly plans: BusinessPlanStore,
    private readonly quotes: Pick<QuoteStore, 'loadForEdit'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    /** Cách duyệt loại `BUSINESS_PLAN` (D3-30); rỗng thì PAKD trình riêng luôn duyệt trực tiếp như phase 2. */
    private readonly settings?: Pick<QuoteSettingsStore, 'binding'>,
    /** Tạo phiên Quy trình sau khi trình (PAKD trình riêng qua Quy trình). */
    private readonly links?: ApprovalLinks,
  ) {}

  async get(actor: CrmActor, quoteId: string, versionNo: unknown): Promise<BusinessPlanDetail | null> {
    const quote = await this.require(actor, quoteId, versionNoOf(versionNo));
    const plan = await this.plans.findByVersion(actor.tenantId, quoteId, quote.version.versionNo);
    return plan ? this.toDetail(actor, quote.version, plan) : null;
  }

  detail(actor: CrmActor, quoteId: string, version: QuoteVersion): Promise<BusinessPlanDetail | null> {
    return this.plans.findByVersion(actor.tenantId, quoteId, version.versionNo).then((plan) => (plan ? this.toDetail(actor, version, plan) : null));
  }

  /** Tạo PAKD (chưa có) hoặc sửa PAKD (đã có, cần `version`). */
  async save(actor: CrmActor, quoteId: string, versionNo: unknown, request: SaveBusinessPlanRequest): Promise<BusinessPlanDetail> {
    requireWriter(actor);
    const quote = await this.require(actor, quoteId, versionNoOf(versionNo));
    const existing = await this.plans.findByVersion(actor.tenantId, quoteId, quote.version.versionNo);
    const note = optionalText(request?.note, 2000, 'ghi chú');
    if (!existing) {
      let lines: PlanLineRecord[] = [];
      let copiedNote: string | null = null;
      if (request?.copyFromVersionNo !== undefined && request.copyFromVersionNo !== null) {
        const source = await this.plans.findByVersion(actor.tenantId, quoteId, versionNoOf(request.copyFromVersionNo));
        if (!source) throw new CrmNotFoundError('Phiên bản báo giá nguồn chưa có phương án kinh doanh để chép.');
        lines = source.lines.map((line) => ({ kind: line.kind, description: line.description, amount: line.amount }));
        copiedNote = source.note;
      }
      if (request?.lines !== undefined) lines = normalizePlanLines(request.lines);
      const figures = computeBusinessPlan(basisOf(quote.version), costLinesOf(lines));
      await this.plans.create(actor.tenantId, { quoteId, quoteVersionId: quote.version.id, note: note ?? copiedNote, lines, figures }, actor.userId);
    } else {
      const expected = planVersionOf(request?.version);
      if (expected !== existing.version) throw this.stale();
      assertPlanEditable(existing.status);
      this.assertQuoteDraft(quote);
      const lines = request?.lines === undefined ? existing.lines.map(toRecord) : normalizePlanLines(request.lines);
      const figures = computeBusinessPlan(basisOf(quote.version), costLinesOf(lines));
      await this.plans.update(
        actor.tenantId,
        existing.id,
        expected,
        { note: request?.note === undefined ? existing.note : note, lines, figures },
        actor.userId,
      );
    }
    return this.reload(actor, quoteId, quote);
  }

  async submit(actor: CrmActor, quoteId: string, versionNo: unknown, request: BusinessPlanVersionRequest): Promise<BusinessPlanDetail> {
    requireWriter(actor);
    const { quote, plan } = await this.requirePlan(actor, quoteId, versionNo);
    const expected = planVersionOf(request?.version);
    if (expected !== plan.version) throw this.stale();
    assertPlanSubmittable(plan.status);
    this.assertQuoteDraft(quote);
    const figures = computeBusinessPlan(basisOf(quote.version), costLinesOf(plan.lines));
    // Loại duyệt `BUSINESS_PLAN` qua Quy trình (D3-30): cùng transaction tạo liên kết cho vòng mới.
    const binding = this.settings && this.links ? await this.settings.binding(actor.tenantId, 'BUSINESS_PLAN') : null;
    const procedure =
      binding?.mode === 'PROCEDURE' && binding.procedureDefinitionId
        ? {
            definitionId: binding.procedureDefinitionId,
            title: `Duyệt PAKD báo giá ${quote.head.code} v${quote.version.versionNo} - ${quote.head.customerName}`.slice(0, 255),
          }
        : null;
    const linkId = await this.plans.submit(actor.tenantId, plan.id, expected, figures, actor.userId, procedure);
    // Tạo phiên Quy trình ngay sau khi commit; lỗi đã ghi vào liên kết và worker thử lại.
    if (linkId && this.links) await this.links.start(actor.tenantId, linkId).catch(() => undefined);
    return this.reload(actor, quoteId, quote);
  }

  approve(actor: CrmActor, quoteId: string, versionNo: unknown, request: BusinessPlanDecisionRequest): Promise<BusinessPlanDetail> {
    return this.decide(actor, quoteId, versionNo, request, 'APPROVED');
  }

  reject(actor: CrmActor, quoteId: string, versionNo: unknown, request: BusinessPlanDecisionRequest): Promise<BusinessPlanDetail> {
    return this.decide(actor, quoteId, versionNo, request, 'REJECTED');
  }

  // -------------------------------------------------------------------------
  // Cấu hình so lệch (Cài đặt CRM)
  // -------------------------------------------------------------------------

  deviationSettings(actor: CrmActor): Promise<BusinessPlanDeviationSettings> {
    return this.plans.deviationSettings(actor.tenantId);
  }

  async saveDeviationSettings(actor: CrmActor, request: unknown): Promise<BusinessPlanDeviationSettings> {
    requireSalesManager(actor);
    const settings = normalizeDeviationSettings(request);
    await this.plans.saveDeviationSettings(actor.tenantId, settings, actor.userId);
    return this.plans.deviationSettings(actor.tenantId);
  }

  // -------------------------------------------------------------------------
  // Nối vào duyệt báo giá
  // -------------------------------------------------------------------------

  async check(tenantId: string, quoteId: string, version: QuoteVersion, forSubmit: boolean): Promise<PlanSubmissionCheck> {
    const [plan, earlierApproved, settings] = await Promise.all([
      this.plans.findByVersion(tenantId, quoteId, version.versionNo),
      this.plans.latestApproved(tenantId, quoteId, version.versionNo),
      this.plans.deviationSettings(tenantId),
    ]);
    // PAKD của chính phiên bản này đã duyệt (trình riêng) là mốc mới nhất: sửa báo giá sau đó vẫn phải so lệch với nó.
    const baseline = plan?.status === 'APPROVED' ? plan : earlierApproved;
    if (forSubmit && plan?.status === 'PENDING') {
      throw new CrmConflictError('PLAN_PENDING', 'Phương án kinh doanh đang chờ duyệt riêng; vui lòng đợi kết quả duyệt rồi gửi duyệt báo giá.');
    }
    if (forSubmit && plan?.status === 'REJECTED') {
      throw new CrmConflictError('PLAN_REJECTED', 'Phương án kinh doanh bị từ chối, vui lòng sửa lại trước khi gửi duyệt báo giá.');
    }
    // Phiên bản chưa có PAKD riêng thì giữ chi phí của PAKD đã duyệt gần nhất để so cho công bằng.
    const lines = plan ? plan.lines : (baseline?.lines ?? []);
    const current = plan || baseline ? computeBusinessPlan(basisOf(version), costLinesOf(lines)) : null;
    const { reasons } = evaluatePlanApproval({
      plan: plan ?? null,
      current,
      baseline: baseline ? baseline.figures : null,
      settings,
    });
    const attachment: PlanAttachment | null =
      plan?.status === 'DRAFT' && current ? { planId: plan.id, expectedVersion: plan.version, figures: current } : null;
    return { reasons, attachment };
  }

  // -------------------------------------------------------------------------

  private async decide(
    actor: CrmActor,
    quoteId: string,
    versionNo: unknown,
    request: BusinessPlanDecisionRequest,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<BusinessPlanDetail> {
    requireApprover(actor);
    const { quote, plan } = await this.requirePlan(actor, quoteId, versionNo);
    const expected = planVersionOf(request?.version);
    if (expected !== plan.version) throw this.stale();
    if (plan.status !== 'PENDING') {
      throw new CrmConflictError('PLAN_NOT_PENDING', 'Phương án kinh doanh không ở trạng thái chờ duyệt.');
    }
    if (plan.currentRoundVia === 'QUOTE') {
      throw new CrmConflictError('PLAN_IN_QUOTE_APPROVAL', 'Phương án kinh doanh đang được duyệt cùng báo giá; vui lòng duyệt ở báo giá.');
    }
    if (plan.submittedBy === actor.userId) {
      throw new CrmForbiddenError('Không được tự duyệt phương án kinh doanh do mình trình.');
    }
    // Đang duyệt qua Quy trình: kết quả đến từ Quy trình. Chỉ duyệt tay khi Quy trình không tạo được phiên.
    const link = await this.plans.currentRoundLink(actor.tenantId, plan.id);
    if (link && !(link.status === 'FAILED' && !link.instanceId) && link.status !== 'CLOSED') {
      throw new CrmConflictError(
        'PLAN_IN_PROCEDURE',
        'Phương án kinh doanh đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.',
      );
    }
    const reason = optionalText(request?.reason, 2000, 'lý do');
    if (decision === 'REJECTED' && !reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do từ chối.');
    await this.plans.decide(actor.tenantId, plan.id, expected, decision, reason, actor.userId);
    return this.reload(actor, quoteId, quote);
  }

  private stale(): CrmConflictError {
    return new CrmConflictError('STALE_VERSION', 'Phương án kinh doanh vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');
  }

  private assertQuoteDraft(quote: EditableQuote): void {
    if (quote.version.status !== 'DRAFT') {
      throw new CrmConflictError(
        'QUOTE_NOT_DRAFT',
        'Chỉ lập, sửa và trình phương án kinh doanh khi phiên bản báo giá còn ở Nháp. Hãy sửa báo giá để tạo phiên bản mới rồi chép phương án sang.',
      );
    }
  }

  private async require(actor: CrmActor, quoteId: string, versionNo: number): Promise<EditableQuote> {
    if (!isUuid(quoteId)) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const quote = await this.quotes.loadForEdit(actor.tenantId, scope, quoteId, versionNo);
    if (!quote) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
    return quote;
  }

  private async requirePlan(actor: CrmActor, quoteId: string, versionNo: unknown): Promise<{ quote: EditableQuote; plan: BusinessPlanRecord }> {
    const quote = await this.require(actor, quoteId, versionNoOf(versionNo));
    const plan = await this.plans.findByVersion(actor.tenantId, quoteId, quote.version.versionNo);
    if (!plan) throw new CrmNotFoundError('Phiên bản báo giá này chưa có phương án kinh doanh.');
    return { quote, plan };
  }

  private async reload(actor: CrmActor, quoteId: string, quote: EditableQuote): Promise<BusinessPlanDetail> {
    const plan = await this.plans.findByVersion(actor.tenantId, quoteId, quote.version.versionNo);
    if (!plan) throw new CrmNotFoundError('Không tìm thấy phương án kinh doanh.');
    // Số liệu sau khi ghi: lấy lại báo giá để phản ánh đúng phiên bản hiện có.
    return this.toDetail(actor, quote.version, plan);
  }

  private async toDetail(actor: CrmActor, version: QuoteVersion, plan: BusinessPlanRecord): Promise<BusinessPlanDetail> {
    const costVisible = canViewQuoteCost(actor);
    const editable = (plan.status === 'DRAFT' || plan.status === 'REJECTED') && version.status === 'DRAFT';
    // Đang soạn thì số liệu theo báo giá hiện tại; đã trình hoặc duyệt thì dùng bản chụp lúc trình.
    const figures: BusinessPlanFigures = editable ? computeBusinessPlan(basisOf(version), costLinesOf(plan.lines)) : plan.figures;
    const [rounds, baseline, settings] = await Promise.all([
      this.plans.listRounds(actor.tenantId, plan.quoteId),
      costVisible ? this.plans.latestApproved(actor.tenantId, plan.quoteId, plan.quoteVersionNo) : Promise.resolve(undefined),
      this.plans.deviationSettings(actor.tenantId),
    ]);
    let deviation: BusinessPlanDeviation | null = null;
    if (baseline) {
      const result = evaluatePlanApproval({ plan: null, current: figures, baseline: baseline.figures, settings }).result;
      if (result) {
        deviation = {
          baselinePlanId: baseline.id,
          baselineVersionNo: baseline.quoteVersionNo,
          mode: settings.mode,
          thresholdPercent: settings.thresholdPercent,
          deviationPercent: result.deviationPercent,
          exceeded: result.exceeded,
        };
      }
    }
    return {
      id: plan.id,
      quoteId: plan.quoteId,
      quoteVersionId: plan.quoteVersionId,
      quoteVersionNo: plan.quoteVersionNo,
      status: plan.status,
      version: plan.version,
      note: plan.note,
      costVisible,
      figures: costVisible ? figures : null,
      visibleFigures: {
        grossAmount: figures.grossAmount,
        revenue: figures.revenue,
        discountAmount: figures.discountAmount,
        discountPercent: figures.discountPercent,
      },
      lines: costVisible ? plan.lines : [],
      currentRoundNo: plan.currentRoundNo,
      submittedAt: plan.submittedAt,
      submittedBy: plan.submittedBy,
      decidedAt: plan.decidedAt,
      decidedBy: plan.decidedBy,
      decisionReason: plan.decisionReason,
      rounds: rounds.map((round) => ({ ...round, figures: costVisible ? round.figures : null })),
      editable,
      deviation,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }
}

const toRecord = (line: BusinessPlanCostLine): PlanLineRecord => ({ kind: line.kind, description: line.description, amount: line.amount });
