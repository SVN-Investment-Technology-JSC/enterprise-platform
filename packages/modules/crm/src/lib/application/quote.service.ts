import { randomUUID } from 'node:crypto';
import {
  QUOTE_DEFAULT_VALIDITY_DAYS,
  QUOTE_LINES_MAX,
  QUOTE_STATUSES,
  quoteDeepLink,
  type CreateQuoteRequest,
  type CrmCatalogMaterial,
  type CrmPage,
  type QuoteApprovalReason,
  type QuoteComparison,
  type QuoteDecisionRequest,
  type QuoteDetail,
  type QuoteListQuery,
  type QuoteRevisionRequest,
  type QuoteShipping,
  type QuoteStatus,
  type QuoteSummary,
  type QuoteVersion,
  type SaveQuoteLineRequest,
  type UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, normalizeSearch, optionalDate, optionalEnum, optionalId, optionalText, requiredText } from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { priceQuote, type PricingLineInput } from '../domain/pricing-engine.js';
import { assertCustomerTransition, assertQuoteTransition, planQuoteEdit, type QuoteEditPlan } from '../domain/quote.js';
import { evaluateQuoteApproval, quoteRoleTier } from '../domain/quote-approval-policy.js';
import { compareQuoteVersions, costLine, quoteTotals } from '../domain/quote-version.js';
import { computeNearestSuperiorUserIds } from '../domain/reporting-line.js';
import { assertOwnerInScope } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ReportingLineReader } from './organization-scope.port.js';
import { boundedNumber } from './price-list.service.js';
import { vietnamToday } from './pricing.service.js';
import type { CatalogMaterial, CatalogReader, PricingStore } from './pricing-store.port.js';
import type {
  ApprovalLinks,
  EditableQuote,
  QuoteLineRecord,
  QuoteSettingsStore,
  QuoteStore,
  QuoteVersionRef,
  QuoteVersionWrite,
} from './quote-store.port.js';
import type { CustomerStore, OpportunityStore } from './sales-store.port.js';

const QUOTE_NOT_FOUND = 'Không tìm thấy báo giá.';
const QUANTITY_MAX = 999_999_999;
const AMOUNT_MAX = 1e13;
const CATALOG_SEARCH_LIMIT = 30;

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
  /** Giá vốn đã biết ở lần tính trước, dùng khi danh mục không còn mặt hàng. */
  readonly previousUnitCost: number | null;
}

export function requireQuoteWriter(actor: CrmActor): void {
  if (!actor.canWriteQuote) throw new CrmForbiddenError('Bạn không có quyền lập báo giá.');
}

export function requireQuoteApprover(actor: CrmActor): void {
  if (!actor.canApproveQuote) throw new CrmForbiddenError('Bạn không có quyền duyệt báo giá.');
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function revisionOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu số lần sửa của phiên bản; vui lòng tải lại báo giá.');
  }
  return number;
}

function versionNoOf(value: unknown): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
  return number;
}

function optionalReason(value: unknown, label: string): string | null {
  return optionalText(value, 2000, label);
}

/**
 * Báo giá theo phiên bản (T3-08, T3-09, T3-11, T3-12).
 *
 * - Mỗi lần sửa dòng, phí vận chuyển, ngày tính giá: tính lại cả phiên bản bằng
 *   engine giá (bảng giá, chính sách đang hiệu lực) và giá vốn bình quân hiện
 *   tại của Kho (`CatalogReader`).
 * - Sửa phiên bản Đã duyệt, Đã gửi khách, Từ chối duyệt sinh phiên bản mới ở
 *   Nháp; sửa phiên bản cũ trả 409 "Phiên bản cũ chỉ đọc".
 * - Gửi duyệt: không vượt ngưỡng thì Đã duyệt ngay; vượt thì Chờ duyệt, duyệt
 *   qua Quy trình (`crm_quote`) hoặc trực tiếp trong Bán hàng theo cách duyệt
 *   cấu hình ở `approval_bindings`.
 *
 * Quyền: lập, sửa, gửi cần `crm.quote.write`; duyệt cần `crm.quote.approve` và
 * không tự duyệt báo giá mình gửi. Báo giá ngoài phạm vi dữ liệu trả 404.
 */
export class QuoteService {
  constructor(
    private readonly quotes: QuoteStore,
    private readonly settings: QuoteSettingsStore,
    private readonly pricing: PricingStore,
    private readonly catalog: CatalogReader,
    private readonly customers: Pick<CustomerStore, 'getCustomer'>,
    private readonly opportunities: Pick<OpportunityStore, 'getOpportunity'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly links: ApprovalLinks,
    private readonly reportingLines: ReportingLineReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  async list(actor: CrmActor, query: QuoteListQuery): Promise<CrmPage<QuoteSummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.quotes.listQuotes(actor.tenantId, scope, {
      q: normalizeSearch(query.q),
      status: optionalEnum(query.status, QUOTE_STATUSES, 'trạng thái'),
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      opportunityId: optionalId(query.opportunityId, 'cơ hội') ?? undefined,
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: pageLimit(query.limit),
    });
  }

  /** Chi tiết kèm tồn khả dụng hiện tại của từng dòng (đọc Kho, lỗi thì để trống) và lý do sẽ cần duyệt. */
  async get(actor: CrmActor, id: string, versionNo?: unknown): Promise<QuoteDetail> {
    const detail = await this.require(actor, id, versionNo === undefined || versionNo === '' ? undefined : versionNoOf(versionNo));
    const version = await this.withStock(actor.tenantId, detail.version);
    const approvalCheck =
      version.status === 'DRAFT' && version.versionNo === detail.currentVersion && version.lines.length
        ? await this.evaluate(actor, version)
        : null;
    return { ...detail, version, approvalCheck };
  }

  async create(actor: CrmActor, request: CreateQuoteRequest): Promise<QuoteDetail> {
    requireQuoteWriter(actor);
    const scope = await this.scopes.resolve(actor);
    const opportunityId = optionalId(request?.opportunityId, 'cơ hội');
    let customerId = optionalId(request?.customerId, 'khách hàng');
    let defaultOwner = actor.userId;
    if (opportunityId) {
      const opportunity = await this.opportunities.getOpportunity(actor.tenantId, scope, opportunityId);
      if (!opportunity) throw new CrmNotFoundError('Không tìm thấy cơ hội.');
      if (opportunity.stage === 'WON' || opportunity.stage === 'LOST') {
        throw new CrmConflictError('OPPORTUNITY_CLOSED', 'Cơ hội đã đóng (Thắng hoặc Thua), không lập báo giá được.');
      }
      if (customerId && customerId !== opportunity.customerId) {
        throw new CrmValidationError('CUSTOMER_MISMATCH', 'Khách hàng không khớp với cơ hội.');
      }
      customerId = opportunity.customerId;
      defaultOwner = opportunity.ownerUserId;
    } else {
      if (!customerId) throw new CrmValidationError('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng hoặc cơ hội.');
      const customer = await this.customers.getCustomer(actor.tenantId, scope, customerId);
      if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
    }
    const ownerUserId = optionalId(request?.ownerUserId, 'người phụ trách') ?? defaultOwner;
    assertOwnerInScope(scope, ownerUserId);
    const validUntil = optionalDate(request?.validUntil, 'hạn hiệu lực') ?? addDays(this.today(), QUOTE_DEFAULT_VALIDITY_DAYS);
    if (validUntil < this.today()) throw new CrmValidationError('INVALID_DATE', 'Hạn hiệu lực không được trước hôm nay.');
    const id = await this.quotes.createQuote(
      actor.tenantId,
      { opportunityId, customerId: customerId as string, ownerUserId, validUntil, note: optionalText(request?.note, 4000, 'ghi chú') },
      actor.userId,
    );
    return this.get(actor, id);
  }

  // -------------------------------------------------------------------------
  // Sửa phiên bản
  // -------------------------------------------------------------------------

  async updateVersion(actor: CrmActor, id: string, versionNo: unknown, request: UpdateQuoteVersionRequest): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, request?.revision, (quote, lines) => {
      const version = quote.version;
      const validUntil =
        request.validUntil === undefined ? version.validUntil : optionalDate(request.validUntil, 'hạn hiệu lực');
      if (validUntil && validUntil < this.today()) {
        throw new CrmValidationError('INVALID_DATE', 'Hạn hiệu lực không được trước hôm nay.');
      }
      return {
        lines,
        validUntil,
        priceDate: request.priceDate === undefined ? version.priceDate : optionalDate(request.priceDate, 'ngày tính giá'),
        note: request.note === undefined ? version.note : optionalText(request.note, 4000, 'ghi chú'),
        shipping: request.shipping === undefined ? version.shipping : shippingOf(request.shipping),
      };
    });
  }

  async addLine(actor: CrmActor, id: string, versionNo: unknown, request: SaveQuoteLineRequest): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, request?.revision, async (quote, lines) => {
      if (lines.length >= QUOTE_LINES_MAX) {
        throw new CrmValidationError('TOO_MANY_LINES', `Mỗi phiên bản báo giá tối đa ${QUOTE_LINES_MAX} dòng.`);
      }
      const line = await this.newLine(actor.tenantId, request, randomUUID());
      return { ...unchanged(quote), lines: [...lines, line] };
    });
  }

  async updateLine(
    actor: CrmActor,
    id: string,
    versionNo: unknown,
    lineId: string,
    request: SaveQuoteLineRequest,
  ): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, request?.revision, async (quote, lines) => {
      const index = lines.findIndex((line) => line.id === lineId);
      if (index < 0) throw new CrmNotFoundError('Không tìm thấy dòng báo giá.');
      const current = lines[index];
      const materialId = request.materialId === undefined ? current.materialId : request.materialId;
      const next =
        typeof materialId === 'string' && materialId.toLowerCase() !== current.materialId
          ? await this.newLine(actor.tenantId, { ...request, materialId }, current.id)
          : {
              ...current,
              quantity: request.quantity === undefined ? current.quantity : quantityOf(request.quantity),
              unit: request.unit === undefined || request.unit === null ? current.unit : requiredText(request.unit, 50, 'đơn vị tính'),
              ...overridesOf(request, current),
            };
      return { ...unchanged(quote), lines: lines.map((line, position) => (position === index ? next : line)) };
    });
  }

  async removeLine(actor: CrmActor, id: string, versionNo: unknown, lineId: string, revision: unknown): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, revision, (quote, lines) => {
      if (!lines.some((line) => line.id === lineId)) throw new CrmNotFoundError('Không tìm thấy dòng báo giá.');
      return { ...unchanged(quote), lines: lines.filter((line) => line.id !== lineId) };
    });
  }

  /** Tính lại theo bảng giá, chính sách và giá vốn hiện tại (không đổi dòng). */
  async recalculate(actor: CrmActor, id: string, versionNo: unknown, request: QuoteRevisionRequest): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, request?.revision, (quote, lines) => ({ ...unchanged(quote), lines }));
  }

  /** Sinh phiên bản mới ở Nháp từ phiên bản Đã duyệt, Đã gửi khách, Từ chối duyệt để sửa tiếp. */
  async revise(actor: CrmActor, id: string, versionNo: unknown, request: QuoteRevisionRequest): Promise<QuoteDetail> {
    return this.edit(
      actor,
      id,
      versionNo,
      request?.revision,
      (quote, lines) => ({ ...unchanged(quote), lines }),
      'NEW_VERSION',
    );
  }

  async compare(actor: CrmActor, id: string, from: unknown, to: unknown): Promise<QuoteComparison> {
    const left = await this.require(actor, id, versionNoOf(from));
    const right = await this.require(actor, id, versionNoOf(to));
    return compareQuoteVersions(left.id, left.version, right.version);
  }

  async catalogMaterials(actor: CrmActor, query: { search?: unknown; limit?: unknown }): Promise<CrmCatalogMaterial[]> {
    const search = normalizeSearch(query.search) ?? '';
    const limit = Math.min(pageLimit(query.limit ?? CATALOG_SEARCH_LIMIT), 100);
    const materials = await this.catalog.search(actor.tenantId, search, limit);
    return materials.map((material) => ({
      id: material.id,
      code: material.code,
      name: material.name,
      unit: material.unit,
      kind: material.kind ?? null,
      category: material.category,
      avgCost: material.avgCost ?? null,
      totalAvailable: material.totalAvailable ?? null,
      availableByWarehouse: material.availableByWarehouse ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Duyệt và trạng thái
  // -------------------------------------------------------------------------

  async submit(actor: CrmActor, id: string, versionNo: unknown, request: QuoteRevisionRequest): Promise<QuoteDetail> {
    requireQuoteWriter(actor);
    const quote = await this.requireEditable(actor, id, versionNoOf(versionNo));
    const base = this.ref(quote, request?.revision);
    if (quote.version.status !== 'DRAFT') {
      throw new CrmConflictError('QUOTE_ALREADY_SUBMITTED', 'Phiên bản này đã được gửi duyệt.');
    }
    if (quote.version.versionNo !== quote.head.currentVersion) {
      throw new CrmConflictError('QUOTE_VERSION_READ_ONLY', 'Phiên bản cũ chỉ đọc.');
    }
    if (!quote.version.lines.length) {
      throw new CrmValidationError('QUOTE_EMPTY', 'Báo giá chưa có dòng hàng nào.');
    }
    if (quote.version.validUntil && quote.version.validUntil < this.today()) {
      throw new CrmConflictError('QUOTE_EXPIRED', 'Báo giá đã quá hạn hiệu lực; vui lòng đổi hạn trước khi gửi duyệt.');
    }
    const reasons = await this.evaluate(actor, quote.version);
    if (!reasons.length) {
      await this.quotes.submit(
        actor.tenantId,
        id,
        base,
        { outcome: 'APPROVED', reasons, procedure: null, approvalRequested: null },
        actor.userId,
      );
      return this.get(actor, id);
    }

    const binding = await this.settings.binding(actor.tenantId, 'QUOTE');
    const viaProcedure = binding.mode === 'PROCEDURE' && !!binding.procedureDefinitionId;
    const recipients = viaProcedure ? [] : await this.superiors(actor.tenantId, actor.userId);
    const totals = quote.version.totals;
    const linkId = await this.quotes.submit(
      actor.tenantId,
      id,
      base,
      {
        outcome: 'PENDING',
        reasons,
        procedure: viaProcedure
          ? {
              definitionId: binding.procedureDefinitionId as string,
              title: `Duyệt báo giá ${quote.head.code} v${quote.version.versionNo} - ${quote.head.customerName}`.slice(0, 255),
            }
          : null,
        approvalRequested: {
          quoteId: id,
          quoteCode: quote.head.code,
          versionNo: quote.version.versionNo,
          customerName: quote.head.customerName,
          totalAmount: totals.totalAmount,
          reasons: reasons.map((reason) => reason.message),
          requesterUserId: actor.userId,
          actorUserId: actor.userId,
          recipientUserIds: recipients,
          summary: `Báo giá ${quote.head.code} (${quote.head.customerName}) cần duyệt: ${reasons[0].message}`.slice(0, 500),
          deepLink: quoteDeepLink(id),
        },
      },
      actor.userId,
    );
    // Tạo phiên Quy trình ngay sau khi commit; lỗi đã ghi vào liên kết và worker thử lại.
    if (linkId) await this.links.start(actor.tenantId, linkId).catch(() => undefined);
    return this.get(actor, id);
  }

  async approve(actor: CrmActor, id: string, versionNo: unknown, request: QuoteDecisionRequest): Promise<QuoteDetail> {
    return this.decide(actor, id, versionNo, request, 'APPROVED');
  }

  async reject(actor: CrmActor, id: string, versionNo: unknown, request: QuoteDecisionRequest): Promise<QuoteDetail> {
    return this.decide(actor, id, versionNo, request, 'REJECTED');
  }

  async send(actor: CrmActor, id: string, versionNo: unknown, request: QuoteDecisionRequest): Promise<QuoteDetail> {
    return this.customerStep(actor, id, versionNo, request, 'SENT', 'send');
  }

  async accept(actor: CrmActor, id: string, versionNo: unknown, request: QuoteDecisionRequest): Promise<QuoteDetail> {
    return this.customerStep(actor, id, versionNo, request, 'ACCEPTED', 'accept');
  }

  async decline(actor: CrmActor, id: string, versionNo: unknown, request: QuoteDecisionRequest): Promise<QuoteDetail> {
    return this.customerStep(actor, id, versionNo, request, 'DECLINED', 'decline');
  }

  /** Lý do cần duyệt nếu `actor` gửi phiên bản này (theo vai trò của chính actor). */
  private async evaluate(actor: CrmActor, version: QuoteVersion): Promise<QuoteApprovalReason[]> {
    const settings = await this.settings.approvalSettings(actor.tenantId);
    return evaluateQuoteApproval({
      settings,
      tier: quoteRoleTier(actor),
      lines: version.lines,
      totalDiscountPercent: version.totals.discountPercent,
      marginPercent: version.totals.marginPercent,
    });
  }

  private async decide(
    actor: CrmActor,
    id: string,
    versionNo: unknown,
    request: QuoteDecisionRequest,
    to: 'APPROVED' | 'REJECTED',
  ): Promise<QuoteDetail> {
    requireQuoteApprover(actor);
    const detail = await this.require(actor, id, versionNoOf(versionNo));
    const version = detail.version;
    assertQuoteTransition(version.status, to);
    if (version.submittedBy === actor.userId) {
      throw new CrmForbiddenError('Không được tự duyệt báo giá do mình gửi.');
    }
    // Đang duyệt qua Quy trình: kết quả đến từ Quy trình. Chỉ duyệt tay khi Quy trình không tạo được phiên.
    const link = detail.procedure;
    if (link && !(link.status === 'FAILED' && !link.instanceId) && link.status !== 'CLOSED') {
      throw new CrmConflictError(
        'QUOTE_IN_PROCEDURE',
        'Báo giá đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.',
      );
    }
    const reason = optionalReason(request?.reason, 'lý do');
    if (to === 'REJECTED' && !reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do từ chối.');
    await this.quotes.transition(
      actor.tenantId,
      id,
      { versionId: version.id, versionNo: version.versionNo, status: version.status, revision: revisionOf(request?.revision) },
      { from: version.status, to, action: to === 'APPROVED' ? 'approve' : 'reject', reason },
      actor.userId,
    );
    return this.get(actor, id);
  }

  private async customerStep(
    actor: CrmActor,
    id: string,
    versionNo: unknown,
    request: QuoteDecisionRequest,
    to: 'SENT' | 'ACCEPTED' | 'DECLINED',
    action: string,
  ): Promise<QuoteDetail> {
    requireQuoteWriter(actor);
    const detail = await this.require(actor, id, versionNoOf(versionNo));
    const version = detail.version;
    if (version.versionNo !== detail.currentVersion) {
      throw new CrmConflictError('QUOTE_VERSION_READ_ONLY', 'Phiên bản cũ chỉ đọc.');
    }
    assertCustomerTransition(version.status, to, version.validUntil, this.today());
    const reason = optionalReason(request?.reason, 'lý do');
    if (to === 'DECLINED' && !reason) throw new CrmValidationError('REASON_REQUIRED', 'Phải ghi lý do khách từ chối.');
    await this.quotes.transition(
      actor.tenantId,
      id,
      { versionId: version.id, versionNo: version.versionNo, status: version.status, revision: revisionOf(request?.revision) },
      { from: version.status, to, action, reason },
      actor.userId,
    );
    return this.get(actor, id);
  }

  // -------------------------------------------------------------------------
  // Tính giá
  // -------------------------------------------------------------------------

  private async edit(
    actor: CrmActor,
    id: string,
    versionNo: unknown,
    revision: unknown,
    change: (
      quote: EditableQuote,
      lines: LineDraft[],
    ) => Omit<QuoteVersionWrite, 'pricedOn' | 'totals' | 'lines'> & { lines: LineDraft[] } | Promise<Omit<QuoteVersionWrite, 'pricedOn' | 'totals' | 'lines'> & { lines: LineDraft[] }>,
    forcePlan?: QuoteEditPlan,
  ): Promise<QuoteDetail> {
    requireQuoteWriter(actor);
    const quote = await this.requireEditable(actor, id, versionNoOf(versionNo));
    const base = this.ref(quote, revision);
    const plan = planQuoteEdit({
      currentVersion: quote.head.currentVersion,
      versionNo: quote.version.versionNo,
      status: quote.version.status,
    });
    if (forcePlan && plan !== forcePlan) {
      throw new CrmConflictError('QUOTE_IS_DRAFT', 'Phiên bản đang ở Nháp, sửa trực tiếp không cần tạo phiên bản mới.');
    }
    const drafts = quote.version.lines.map(
      (line): LineDraft => ({
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
      }),
    );
    const next = await change(quote, drafts);
    // Phiên bản mới dùng id dòng mới (dòng của bản cũ giữ nguyên, chỉ đọc).
    const lines = plan === 'NEW_VERSION' ? next.lines.map((line) => ({ ...line, id: randomUUID() })) : next.lines;
    const write = await this.price(actor.tenantId, quote, { ...next, lines });
    await this.quotes.saveVersion(actor.tenantId, id, base, plan, write, actor.userId);
    return this.get(actor, id);
  }

  private async price(
    tenantId: string,
    quote: EditableQuote,
    next: Omit<QuoteVersionWrite, 'pricedOn' | 'totals' | 'lines'> & { lines: LineDraft[] },
  ): Promise<QuoteVersionWrite> {
    const date = next.priceDate ?? this.today();
    const materialIds = [...new Set(next.lines.map((line) => line.materialId))];
    const [priceLists, policies, cap, known, contractPrices] = await Promise.all([
      this.pricing.priceListsForPricing(tenantId, date, quote.head.customerGroupId, materialIds),
      this.pricing.policiesForPricing(tenantId, date),
      this.pricing.discountCapPercent(tenantId),
      materialIds.length ? this.catalog.materials(tenantId, materialIds) : Promise.resolve(new Map<string, CatalogMaterial>()),
      // Giá khung hợp đồng khung, nguyên tắc đang hiệu lực của khách đứng trước bảng giá (T4-02).
      this.pricing.contractPricesForPricing(tenantId, date, quote.head.customerId, materialIds),
    ]);
    // Danh mục còn mặt hàng thì làm mới bản chụp mã, tên, loại; không thì giữ bản chụp cũ.
    const lines = next.lines.map((line) => {
      const material = known.get(line.materialId);
      return material
        ? {
            ...line,
            materialCode: material.code,
            materialName: material.name,
            materialKind: material.kind ?? line.materialKind,
            category: material.category ?? line.category,
          }
        : line;
    });
    const inputs: PricingLineInput[] = lines.map((line) => ({
      materialId: line.materialId,
      materialCode: line.materialCode,
      materialName: line.materialName,
      category: line.category,
      quantity: line.quantity,
      unit: line.unit,
      override: { unitPrice: line.overrideUnitPrice, discountPercent: line.overrideDiscountPercent },
    }));
    const shipping = next.shipping;
    const priced = priceQuote({
      date,
      customerId: quote.head.customerId,
      customerGroupId: quote.head.customerGroupId,
      lines: inputs,
      priceLists,
      policies,
      contractPrices,
      discountCapPercent: cap,
      shipping: shipping.amount > 0 ? { amount: shipping.amount, vatRate: shipping.vatRate } : null,
    });
    const records: QuoteLineRecord[] = priced.lines.map((pricedLine, index) => {
      const line = lines[index];
      const material = known.get(line.materialId);
      const unitCost =
        line.materialKind === 'SERVICE' ? (material?.avgCost ?? null) : material ? (material.avgCost ?? null) : line.previousUnitCost;
      const cost = costLine(pricedLine, unitCost);
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
        policyPercent: pricedLine.policyPercent,
        discountPercent: pricedLine.discountPercent,
        cappedAt: pricedLine.cappedAt,
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
        estUnitCost: cost.estUnitCost,
        estCost: cost.estCost,
        margin: cost.margin,
      };
    });
    const totals = quoteTotals(
      priced.totals,
      records.map((record) => ({ estUnitCost: record.estUnitCost, estCost: record.estCost, margin: record.margin })),
      shipping.cost,
    );
    return {
      validUntil: next.validUntil,
      priceDate: next.priceDate,
      pricedOn: date,
      note: next.note,
      shipping,
      totals,
      lines: records,
    };
  }

  private async newLine(tenantId: string, request: SaveQuoteLineRequest, id: string): Promise<LineDraft> {
    if (!isUuid(request?.materialId)) throw new CrmValidationError('INVALID_LINE', 'Vui lòng chọn mặt hàng.');
    const materialId = request.materialId.toLowerCase();
    const material = (await this.catalog.materials(tenantId, [materialId])).get(materialId);
    if (!material) {
      throw new CrmValidationError('MATERIAL_NOT_FOUND', 'Mặt hàng không có trong danh mục Kho.');
    }
    const unit = request.unit ? requiredText(request.unit, 50, 'đơn vị tính') : material.unit;
    if (!unit) throw new CrmValidationError('UNIT_REQUIRED', 'Vui lòng nhập đơn vị tính.');
    return {
      id,
      materialId,
      materialCode: material.code,
      materialName: material.name,
      unit,
      materialKind: material.kind ?? 'STOCK',
      category: material.category,
      quantity: quantityOf(request.quantity),
      ...overridesOf(request, { overrideUnitPrice: null, overrideDiscountPercent: null }),
      previousUnitCost: null,
    };
  }

  /** Tồn khả dụng hiện tại cho từng dòng hàng tồn kho; Kho lỗi thì để trống, không chặn xem báo giá. */
  private async withStock(tenantId: string, version: QuoteVersion): Promise<QuoteVersion> {
    const ids = [...new Set(version.lines.filter((line) => line.materialKind !== 'SERVICE').map((line) => line.materialId))];
    if (!ids.length) return version;
    const known = await this.catalog.materials(tenantId, ids).catch(() => new Map<string, CatalogMaterial>());
    return {
      ...version,
      lines: version.lines.map((line) => ({
        ...line,
        availableStock: line.materialKind === 'SERVICE' ? null : (known.get(line.materialId)?.totalAvailable ?? null),
      })),
    };
  }

  /** Cấp trên gần nhất của người gửi; Tenant Core lỗi thì không báo ai (không chặn việc gửi duyệt). */
  private async superiors(tenantId: string, userId: string): Promise<string[]> {
    try {
      return computeNearestSuperiorUserIds(await this.reportingLines.snapshot(tenantId), userId);
    } catch {
      return [];
    }
  }

  private ref(quote: EditableQuote, revision: unknown): QuoteVersionRef {
    const expected = revisionOf(revision);
    if (expected !== quote.version.revision) {
      throw new CrmConflictError('STALE_VERSION', 'Báo giá vừa được người khác cập nhật. Vui lòng tải lại rồi sửa tiếp.');
    }
    return {
      versionId: quote.version.id,
      versionNo: quote.version.versionNo,
      status: quote.version.status,
      revision: expected,
    };
  }

  private async require(actor: CrmActor, id: string, versionNo?: number): Promise<QuoteDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const detail = await this.quotes.getQuote(actor.tenantId, scope, id, versionNo);
    if (!detail) throw new CrmNotFoundError(versionNo ? 'Không tìm thấy phiên bản báo giá.' : QUOTE_NOT_FOUND);
    return detail;
  }

  private async requireEditable(actor: CrmActor, id: string, versionNo: number): Promise<EditableQuote> {
    if (!isUuid(id)) throw new CrmNotFoundError(QUOTE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const quote = await this.quotes.loadForEdit(actor.tenantId, scope, id, versionNo);
    if (!quote) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
    return quote;
  }
}

function unchanged(quote: EditableQuote) {
  const version = quote.version;
  return { validUntil: version.validUntil, priceDate: version.priceDate, note: version.note, shipping: version.shipping };
}

function quantityOf(value: unknown): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
    throw new CrmValidationError('INVALID_QUANTITY', 'Số lượng phải lớn hơn 0.');
  }
  return boundedNumber(number, 0, QUANTITY_MAX, 'số lượng', 3);
}

function overridesOf(
  request: SaveQuoteLineRequest,
  current: { overrideUnitPrice: number | null; overrideDiscountPercent: number | null },
): { overrideUnitPrice: number | null; overrideDiscountPercent: number | null } {
  const read = (value: unknown, max: number, label: string, decimals: number, fallback: number | null) =>
    value === undefined ? fallback : value === null || value === '' ? null : boundedNumber(value, 0, max, label, decimals);
  const overrideUnitPrice = read(request.overrideUnitPrice, AMOUNT_MAX, 'đơn giá ghi đè', 2, current.overrideUnitPrice);
  const overrideDiscountPercent = read(
    request.overrideDiscountPercent,
    100,
    'chiết khấu ghi đè',
    4,
    current.overrideDiscountPercent,
  );
  if (overrideUnitPrice !== null && overrideDiscountPercent !== null) {
    throw new CrmValidationError('OVERRIDE_CONFLICT', 'Chỉ ghi đè đơn giá hoặc chiết khấu, không ghi đè cả hai.');
  }
  return { overrideUnitPrice, overrideDiscountPercent };
}

function shippingOf(value: UpdateQuoteVersionRequest['shipping']): QuoteShipping {
  if (!value) return { amount: 0, vatRate: 10, cost: 0 };
  const amount = boundedNumber(value.amount ?? 0, 0, AMOUNT_MAX, 'phí vận chuyển', 2);
  const vatRate =
    value.vatRate === undefined || value.vatRate === null ? 10 : boundedNumber(value.vatRate, 0, 100, 'thuế suất phí vận chuyển', 2);
  // Không nhập chi phí thì coi chi phí bên bán chịu bằng phí thu của khách (thu hộ, không lời không lỗ).
  const cost = value.cost === undefined || value.cost === null ? amount : boundedNumber(value.cost, 0, AMOUNT_MAX, 'chi phí vận chuyển', 2);
  return { amount, vatRate, cost };
}

/** Trạng thái hiển thị cho danh sách: dùng khi lọc. */
export function isOpenQuoteStatus(status: QuoteStatus): boolean {
  return !['ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED'].includes(status);
}
