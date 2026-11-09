import { randomUUID } from 'node:crypto';
import {
  QUOTE_DEFAULT_VALIDITY_DAYS,
  QUOTE_LINES_INVALID_CODE,
  QUOTE_FEES_MAX,
  QUOTE_LINE_POSITION_INVALID_CODE,
  QUOTE_LINES_MAX,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUSES,
  quoteDeepLink,
  sellerFromOrganization,
  type CreateQuoteRequest,
  type CrmCatalogMaterial,
  type CrmPage,
  type QuoteApprovalReason,
  type QuoteComparison,
  type QuoteAdjustmentMode,
  type QuoteDecisionRequest,
  type QuoteCustomFields,
  type QuoteFee,
  type QuoteOrderAmountInput,
  type QuoteTemplate,
  type QuoteType,
  type QuoteDetail,
  type QuoteListQuery,
  type QuoteRevisionRequest,
  type QuoteShipping,
  type QuoteStatus,
  type QuoteSummary,
  type QuoteVersion,
  type AddQuoteLinesRequest,
  type QuoteLineError,
  type SaveQuoteLineRequest,
  type UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, normalizeSearch, optionalDate, optionalEnum, optionalId, optionalText, requiredText } from '../domain/fields.js';
import { decodeCursor, pageLimit, pageNumber } from '../domain/pagination.js';
import { priceQuote, type PricingLineInput } from '../domain/pricing-engine.js';
import { assertCustomerTransition, assertQuoteTransition, planQuoteEdit, type QuoteEditPlan } from '../domain/quote.js';
import { evaluateQuoteApproval, quoteRoleTier } from '../domain/quote-approval-policy.js';
import { normalizeManualQuoteCode } from '../domain/quote-code.js';
import { applyQuoteAdjustments } from '../domain/quote-totals.js';
import { compareQuoteVersions, costLine, quoteTotals } from '../domain/quote-version.js';
import { computeNearestSuperiorUserIds } from '../domain/reporting-line.js';
import { assertOwnerInScope, canViewQuoteCost } from './crm-access.js';
import type { QuoteBusinessPlans } from './business-plan.service.js';
import type { AwaitingApprovalReader } from './crm-task.service.js';
import type { PlanAttachment } from './business-plan-store.port.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ReportingLineReader } from './organization-scope.port.js';
import { boundedNumber } from './price-list.service.js';
import { vietnamToday } from './pricing.service.js';
import type { CatalogMaterial, CatalogReader, PricingStore } from './pricing-store.port.js';
import type {
  ApprovalLinks,
  EditableQuote,
  QuoteFormInput,
  QuoteLineRecord,
  QuoteOrganizationInput,
  QuoteSettingsStore,
  QuoteStore,
  QuoteVersionRef,
  QuoteVersionWrite,
} from './quote-store.port.js';
import type { QuoteFormStore } from './quote-form-store.port.js';
import type { SalesOrganizationReader } from './sales-organization-store.port.js';
import { pickSalesOrganization, quoteSellerOf } from './sales-organization.service.js';
import { applyCustomFields } from '../domain/custom-fields.js';
import type { CustomerStore, OpportunityStore } from './sales-store.port.js';

const QUOTE_NOT_FOUND = 'Không tìm thấy báo giá.';
const QUANTITY_MAX = 999_999_999;
const AMOUNT_MAX = 1e13;
const CATALOG_SEARCH_LIMIT = 30;

/** Phần sửa một phiên bản trước khi tính giá: dòng và trường theo mẫu do người dùng nhập. */
type QuoteChange = Omit<QuoteVersionWrite, 'pricedOn' | 'totals' | 'lines' | 'form'> & {
  lines: LineDraft[];
  form: QuoteFormInput;
};

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

/** Cờ trên query string: `true`, `1` là bật. */
function flagOf(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
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
    /** Phương án kinh doanh (GĐ D); rỗng thì báo giá chạy như trước khi có PAKD. */
    private readonly plans?: QuoteBusinessPlans,
    /** Mẫu, loại, mã báo giá (GĐI); rỗng thì báo giá chạy như phase 1 (theo dòng, không mẫu). */
    private readonly form?: QuoteFormStore,
    /** Tổ chức báo giá (phase 3, mục 16); rỗng thì báo giá tự lấy tổ chức mặc định ở store, không chọn được tổ chức khác. */
    private readonly organizations?: SalesOrganizationReader,
    /** Việc chờ người xem duyệt (plan mục 17.4): bộ lọc "Cần tôi duyệt" và cờ trên màn báo giá. */
    private readonly approvals?: AwaitingApprovalReader,
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  async list(actor: CrmActor, query: QuoteListQuery): Promise<CrmPage<QuoteSummary>> {
    const scope = await this.scopes.resolve(actor);
    // "Cần tôi duyệt" (plan mục 17.4): cùng cách tính với trang Việc cần xử lý.
    const awaiting = flagOf(query?.awaitingMyApproval);
    const ids = awaiting ? (this.approvals ? await this.approvals.awaitingQuoteIds(actor) : []) : undefined;
    return this.quotes.listQuotes(actor.tenantId, scope, {
      ...(ids ? { ids } : {}),
      q: normalizeSearch(query.q),
      status: optionalEnum(query.status, QUOTE_STATUSES, 'trạng thái'),
      customerId: optionalId(query.customerId, 'khách hàng') ?? undefined,
      opportunityId: optionalId(query.opportunityId, 'cơ hội') ?? undefined,
      ownerUserId: optionalId(query.ownerUserId, 'người phụ trách') ?? undefined,
      cursor: decodeCursor(query.cursor),
      page: pageNumber(query.page),
      limit: pageLimit(query.limit),
    });
  }

  /** Chi tiết kèm tồn khả dụng hiện tại của từng dòng (đọc Kho, lỗi thì để trống) và lý do sẽ cần duyệt. */
  async get(actor: CrmActor, id: string, versionNo?: unknown): Promise<QuoteDetail> {
    const detail = await this.require(actor, id, versionNo === undefined || versionNo === '' ? undefined : versionNoOf(versionNo));
    const version = await this.withStock(actor.tenantId, detail.version);
    const costVisible = canViewQuoteCost(actor);
    const approvalCheck =
      costVisible && version.status === 'DRAFT' && version.versionNo === detail.currentVersion && version.lines.length
        ? (await this.evaluate(actor, detail.id, version, false)).reasons
        : null;
    const businessPlan = this.plans ? await this.plans.detail(actor, detail.id, version) : null;
    // Chỉ phiên bản hiện tại đang chờ (báo giá Chờ duyệt hoặc PAKD trình riêng đang chờ) mới cần hỏi.
    const pending = version.status === 'PENDING' || businessPlan?.status === 'PENDING';
    const awaitingMyApproval =
      this.approvals && pending && version.versionNo === detail.currentVersion
        ? await this.approvals.awaitingTarget(actor, detail.id)
        : null;
    return { ...detail, version: costVisible ? version : hideCost(version), approvalCheck, businessPlan, awaitingMyApproval };
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
      if (opportunity.stageInfo.semantic !== 'OPEN') {
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
    const code = normalizeManualQuoteCode(request?.code);
    if (code && (await this.form?.codeExists(actor.tenantId, code))) throw codeExists();
    // Mẫu và loại bắt buộc: không chọn thì dùng mẫu, loại mặc định; mẫu hoặc loại tắt thì không chọn được.
    const template = await this.pickTemplate(actor.tenantId, request?.templateId);
    const type = await this.pickType(actor.tenantId, request?.quoteTypeId);
    const organization = await this.organizationOnCreate(actor.tenantId, request);
    const id = await this.quotes.createQuote(
      actor.tenantId,
      {
        opportunityId,
        customerId: customerId as string,
        ownerUserId,
        validUntil,
        note: optionalText(request?.note, 4000, 'ghi chú'),
        code,
        quoteName: optionalText(request?.quoteName, 300, 'tên báo giá'),
        quoteDate: optionalDate(request?.quoteDate, 'ngày báo giá'),
        // Trường tuỳ biến: kiểm kiểu và lựa chọn; bắt buộc chỉ ép khi lưu (báo giá mới chưa có dòng hàng).
        customFields: await this.customFields({}, request?.customFields, false, actor.tenantId),
        ...(organization ? { organization } : {}),
        form: this.form
          ? {
              templateId: template?.id ?? null,
              quoteTypeId: type?.id ?? null,
              discountMode: template?.discountMode ?? 'LINE',
              taxMode: template?.taxMode ?? 'LINE',
            }
          : null,
      },
      actor.userId,
    );
    return this.get(actor, id);
  }

  /**
   * Tổ chức khi lập (plan mục 16.2): không gửi `organizationId` thì tổ chức mặc định đang bật (nếu có); `null` là không
   * chọn; có id thì phải tồn tại và đang bật. `seller` gửi kèm thì giữ chữ sửa tay; không gửi thì chép từ tổ chức.
   * Không có kho tổ chức: để store chọn tổ chức mặc định như báo giá tự tạo.
   */
  private async organizationOnCreate(tenantId: string, request: CreateQuoteRequest): Promise<QuoteOrganizationInput | undefined> {
    if (!this.organizations) return undefined;
    const requested = request?.organizationId;
    const organization =
      requested === undefined
        ? ((await this.organizations.defaultOrganization(tenantId)) ?? null)
        : requested === null || requested === ''
          ? null
          : await pickSalesOrganization(this.organizations, tenantId, requested);
    const seller =
      request?.seller !== undefined ? quoteSellerOf(request.seller) : organization ? sellerFromOrganization(organization) : null;
    return { organizationId: organization?.id ?? null, seller };
  }

  /**
   * Tổ chức khi sửa: đổi tổ chức mà không gửi `seller` thì chép thông tin tổ chức mới; `null` là bỏ cả tổ chức và
   * thông tin; giữ nguyên id cũ thì không kiểm lại (tổ chức đã tắt vẫn giữ được). `seller` gửi thì lưu (`null` là xoá).
   */
  private async organizationChange(
    tenantId: string,
    current: QuoteOrganizationInput,
    request: UpdateQuoteVersionRequest,
  ): Promise<QuoteOrganizationInput> {
    let { organizationId, seller } = current;
    const requested = request.organizationId;
    if (requested === null || requested === '') {
      organizationId = null;
      seller = null;
    } else if (requested !== undefined && (!isUuid(requested) || requested.toLowerCase() !== current.organizationId)) {
      const organization = await pickSalesOrganization(this.organizations, tenantId, requested);
      organizationId = organization.id;
      seller = sellerFromOrganization(organization);
    }
    if (request.seller !== undefined) seller = quoteSellerOf(request.seller);
    return { organizationId, seller };
  }

  // -------------------------------------------------------------------------
  // Sửa phiên bản
  // -------------------------------------------------------------------------

  async updateVersion(actor: CrmActor, id: string, versionNo: unknown, request: UpdateQuoteVersionRequest): Promise<QuoteDetail> {
    return this.edit(actor, id, versionNo, request?.revision, async (quote, lines) => {
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
        ...(await this.formChange(actor, quote, request)),
      };
    });
  }

  /**
   * Trường theo mẫu khi sửa (P2I-04, P2I-05): đổi mã (chỉ khi Nháp, trùng mã 409), tên, ngày, mẫu, loại, chiết khấu
   * và thuế tổng đơn, phí. Báo giá đã có mẫu hoặc loại thì không bỏ trống được; báo giá cũ chưa có thì không bắt
   * buộc. Đổi mẫu thì chế độ theo mẫu mới; chuyển về chế độ theo dòng thì xoá chiết khấu, thuế tổng đơn đã nhập.
   */
  private async formChange(
    actor: CrmActor,
    quote: EditableQuote,
    request: UpdateQuoteVersionRequest,
  ): Promise<{ code?: string | null; form: QuoteFormInput }> {
    const current = quote.version.form;
    let code: string | null = null;
    if (request.code !== undefined) {
      code = normalizeManualQuoteCode(request.code);
      if (!code) throw new CrmValidationError('REQUIRED', 'Vui lòng nhập mã báo giá.');
      if (quote.version.status !== 'DRAFT') {
        throw new CrmConflictError('QUOTE_NOT_DRAFT', 'Chỉ đổi được mã báo giá khi báo giá còn ở trạng thái Nháp.');
      }
      if (code !== quote.head.code && (await this.form?.codeExists(actor.tenantId, code, quote.head.id))) throw codeExists();
    }
    let templateId = current.templateId;
    let discountMode: QuoteAdjustmentMode = current.discountMode;
    let taxMode: QuoteAdjustmentMode = current.taxMode;
    if (request.templateId !== undefined) {
      if (request.templateId === null || request.templateId === '') {
        if (current.templateId) throw new CrmValidationError('TEMPLATE_REQUIRED', 'Vui lòng chọn mẫu báo giá.');
      } else if (!isUuid(request.templateId) || request.templateId.toLowerCase() !== current.templateId) {
        const template = await this.pickTemplate(actor.tenantId, request.templateId);
        templateId = template?.id ?? null;
        discountMode = template?.discountMode ?? 'LINE';
        taxMode = template?.taxMode ?? 'LINE';
      }
    }
    let quoteTypeId = current.quoteTypeId;
    if (request.quoteTypeId !== undefined) {
      if (request.quoteTypeId === null || request.quoteTypeId === '') {
        if (current.quoteTypeId) throw new CrmValidationError('QUOTE_TYPE_REQUIRED', 'Vui lòng chọn loại báo giá.');
      } else if (!isUuid(request.quoteTypeId) || request.quoteTypeId.toLowerCase() !== current.quoteTypeId) {
        quoteTypeId = (await this.pickType(actor.tenantId, request.quoteTypeId))?.id ?? null;
      }
    }
    const keep = (amount: typeof current.orderDiscount): QuoteOrderAmountInput =>
      amount.inputKind === 'PERCENT'
        ? { percent: amount.percent, amount: null }
        : amount.inputKind === 'AMOUNT'
          ? { percent: null, amount: amount.amount }
          : { percent: null, amount: null };
    const modeChanged = discountMode !== current.discountMode || taxMode !== current.taxMode;
    const orderDiscount =
      request.orderDiscount !== undefined
        ? orderAmountOf(request.orderDiscount, 'chiết khấu tổng đơn')
        : modeChanged && discountMode === 'LINE'
          ? EMPTY_ORDER_AMOUNT
          : keep(current.orderDiscount);
    const orderTax =
      request.orderTax !== undefined
        ? orderAmountOf(request.orderTax, 'thuế tổng đơn')
        : modeChanged && taxMode === 'LINE'
          ? EMPTY_ORDER_AMOUNT
          : keep(current.orderTax);
    return {
      ...(code ? { code } : {}),
      form: {
        quoteName: request.quoteName === undefined ? current.quoteName : optionalText(request.quoteName, 300, 'tên báo giá'),
        quoteDate: request.quoteDate === undefined ? current.quoteDate : optionalDate(request.quoteDate, 'ngày báo giá'),
        templateId,
        quoteTypeId,
        discountMode,
        taxMode,
        orderDiscount,
        orderTax,
        fees: request.fees === undefined ? current.fees : feesOf(request.fees),
        // Lưu báo giá thì trường tuỳ biến bắt buộc phải có giá trị (TC-QF-11); xem thì không bị chặn.
        customFields: await this.customFields(current.customFields, request.customFields, true, actor.tenantId),
        ...(await this.organizationChange(actor.tenantId, current, request)),
      },
    };
  }

  /** Gộp phần sửa trường tuỳ biến vào giá trị hiện có theo định nghĩa đang bật; không có kho mẫu thì giữ nguyên. */
  private async customFields(
    current: QuoteCustomFields,
    patch: UpdateQuoteVersionRequest['customFields'],
    enforceRequired: boolean,
    tenantId: string,
  ): Promise<QuoteCustomFields> {
    if (!this.form) return current;
    return applyCustomFields(await this.form.listCustomFields(tenantId, 'quote', false), current, patch, enforceRequired);
  }

  /** Mẫu chọn lúc lập hoặc đổi: có id thì phải tồn tại và đang bật; không có id thì mẫu mặc định (không có form store: rỗng). */
  private async pickTemplate(tenantId: string, id: unknown): Promise<QuoteTemplate | null> {
    if (id !== undefined && id !== null && id !== '') {
      if (!isUuid(id)) throw new CrmValidationError('INVALID_REFERENCE', 'Mẫu báo giá không hợp lệ.');
      const template = await this.form?.getTemplate(tenantId, id.toLowerCase());
      if (!template) throw new CrmValidationError('TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu báo giá.');
      if (!template.active) throw new CrmValidationError('TEMPLATE_INACTIVE', 'Mẫu báo giá này đã tắt, vui lòng chọn mẫu khác.');
      return template;
    }
    if (!this.form) return null;
    return (await this.form.listTemplates(tenantId, false)).find((template) => template.isDefault) ?? null;
  }

  private async pickType(tenantId: string, id: unknown): Promise<QuoteType | null> {
    if (id !== undefined && id !== null && id !== '') {
      if (!isUuid(id)) throw new CrmValidationError('INVALID_REFERENCE', 'Loại báo giá không hợp lệ.');
      const type = await this.form?.getType(tenantId, id.toLowerCase());
      if (!type) throw new CrmValidationError('QUOTE_TYPE_NOT_FOUND', 'Không tìm thấy loại báo giá.');
      if (!type.active) throw new CrmValidationError('QUOTE_TYPE_INACTIVE', 'Loại báo giá này đã tắt, vui lòng chọn loại khác.');
      return type;
    }
    if (!this.form) return null;
    return (await this.form.listTypes(tenantId, false)).find((type) => type.isDefault) ?? null;
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

  /**
   * Thêm lô dòng vào báo giá Nháp: kiểm từng dòng, có dòng lỗi thì không thêm dòng nào và
   * trả lỗi theo dòng (400 `LINES_INVALID`). Một lần ghi, một lần tính giá. Báo giá không
   * còn Nháp thì 409 (không tạo phiên bản mới như thêm từng dòng).
   *
   * `beforeLineNo` (phase 3, "Chèn"): lô chèn ngay trước dòng có số đó, các dòng sau dời xuống. Mỗi lần lưu, phiên
   * bản ghi lại toàn bộ dòng với số thứ tự liên tục trong cùng transaction (xoá rồi chèn lại), nên không bao giờ có
   * hai dòng cùng `line_no`. Số không có trong phiên bản: 400 `LINE_POSITION_INVALID`.
   */
  async addLines(actor: CrmActor, id: string, versionNo: unknown, request: AddQuoteLinesRequest): Promise<QuoteDetail> {
    const inputs = request?.lines;
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new CrmValidationError('LINES_REQUIRED', 'Vui lòng chọn ít nhất một mặt hàng.');
    }
    const beforeLineNo = beforeLineNoOf(request?.beforeLineNo);
    /** Số dòng đứng trước lô mới; lô chiếm vị trí `at + 1` đến `at + inputs.length`. */
    let at = 0;
    try {
      return await this.edit(actor, id, versionNo, request?.revision, async (quote, lines) => {
        if (quote.version.status !== 'DRAFT') {
          throw new CrmConflictError(
            'QUOTE_NOT_DRAFT',
            `Báo giá ở trạng thái "${QUOTE_STATUS_LABELS[quote.version.status]}", không sửa được.`,
          );
        }
        at = lines.length;
        if (beforeLineNo !== null) {
          at = quote.version.lines.findIndex((line) => line.lineNo === beforeLineNo);
          if (at < 0) throw linePositionInvalid(beforeLineNo);
        }
        if (lines.length + inputs.length > QUOTE_LINES_MAX) {
          throw new CrmValidationError('TOO_MANY_LINES', `Mỗi phiên bản báo giá tối đa ${QUOTE_LINES_MAX} dòng.`);
        }
        const errors: QuoteLineError[] = [];
        const added: LineDraft[] = [];
        for (const [index, input] of inputs.entries()) {
          try {
            added.push(await this.newLine(actor.tenantId, input as SaveQuoteLineRequest, randomUUID()));
          } catch (error) {
            if (!(error instanceof CrmValidationError)) throw error;
            errors.push(lineErrorOf(index + 1, input, error));
          }
        }
        if (errors.length) throw linesInvalid(errors);
        return { ...unchanged(quote), lines: [...lines.slice(0, at), ...added, ...lines.slice(at)] };
      });
    } catch (error) {
      // Lỗi tính giá (chưa có giá bán...) mang số dòng trong toàn báo giá; dòng thuộc lô thì đổi về số dòng của lô.
      const position = error instanceof CrmValidationError ? error.details?.['line'] : undefined;
      if (
        error instanceof CrmValidationError &&
        error.code !== 'LINES_INVALID' &&
        typeof position === 'number' &&
        position > at &&
        position <= at + inputs.length
      ) {
        const index = position - at;
        throw linesInvalid([lineErrorOf(index, inputs[index - 1], error)]);
      }
      throw error;
    }
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
    const comparison = compareQuoteVersions(left.id, left.version, right.version);
    if (canViewQuoteCost(actor)) return comparison;
    return {
      ...comparison,
      from: hideCost(comparison.from),
      to: hideCost(comparison.to),
      totalsDelta: { ...comparison.totalsDelta, profit: 0 },
    };
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
      tradeCategory: material.tradeCategory ?? null,
      salePrice: material.salePrice ?? null,
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
    const { reasons, attachment } = await this.evaluate(actor, id, quote.version, true);
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
        businessPlan: attachment,
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
  private async evaluate(
    actor: CrmActor,
    quoteId: string,
    version: QuoteVersion,
    forSubmit: boolean,
  ): Promise<{ reasons: QuoteApprovalReason[]; attachment: PlanAttachment | null }> {
    const settings = await this.settings.approvalSettings(actor.tenantId);
    const reasons = evaluateQuoteApproval({
      settings,
      tier: quoteRoleTier(actor),
      lines: version.lines,
      totalDiscountPercent: version.totals.discountPercent,
      marginPercent: version.totals.marginPercent,
    });
    // PAKD (P2D-04, P2D-05): PAKD đang soạn cần duyệt cùng báo giá; lệch PAKD đã duyệt gần nhất thì buộc trình lại.
    const plan = this.plans ? await this.plans.check(actor.tenantId, quoteId, version, forSubmit) : null;
    return { reasons: [...reasons, ...(plan?.reasons ?? [])], attachment: plan?.attachment ?? null };
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
    change: (quote: EditableQuote, lines: LineDraft[]) => QuoteChange | Promise<QuoteChange>,
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
    next: QuoteChange,
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
      // Mẫu báo giá quyết định chiết khấu, VAT theo dòng hay theo tổng đơn (P2I-03); mẫu theo dòng giữ đúng phase 1.
      discountMode: next.form.discountMode,
      taxMode: next.form.taxMode,
    });
    const adjusted = applyQuoteAdjustments({
      discountMode: next.form.discountMode,
      taxMode: next.form.taxMode,
      pricing: priced.totals,
      shippingVatAmount: priced.shipping?.vatAmount ?? 0,
      orderDiscount: next.form.orderDiscount,
      orderTax: next.form.orderTax,
      fees: next.form.fees,
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
      adjusted.totals,
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
      ...(next.code ? { code: next.code } : {}),
      form: {
        ...next.form,
        orderDiscountTotal: adjusted.orderDiscount.amount,
        orderTaxTotal: adjusted.orderTax.amount,
        feesAmount: adjusted.feesAmount,
      },
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

const COST_REASON_CODES: readonly string[] = ['MARGIN_BELOW_MIN', 'COST_UNKNOWN', 'PLAN_DEVIATION'];

/** Ẩn giá vốn, lợi nhuận, biên của phiên bản cho người không có quyền xem (TC-BP-09); đặt cờ `costHidden`. */
function hideCost(version: QuoteVersion): QuoteVersion {
  return {
    ...version,
    costHidden: true,
    approvalReasons: version.approvalReasons.map((reason) =>
      COST_REASON_CODES.includes(reason.code) ? { code: reason.code, message: 'Chi tiết liên quan giá vốn, lợi nhuận không hiển thị với quyền của bạn.' } : reason,
    ),
    totals: { ...version.totals, estCost: 0, profit: 0, marginPercent: null },
    lines: version.lines.map((line) => ({ ...line, estUnitCost: null, estCost: 0, margin: null })),
  };
}

/** `beforeLineNo` gửi lên: không có là thêm cuối (`null`); có thì phải là số nguyên dương. */
function beforeLineNoOf(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw linePositionInvalid(value);
  return value;
}

function linePositionInvalid(value: unknown): CrmValidationError {
  return new CrmValidationError(
    QUOTE_LINE_POSITION_INVALID_CODE,
    typeof value === 'number' && Number.isInteger(value)
      ? `Không chèn được: báo giá không có dòng số ${value}. Tải lại báo giá rồi thử lại.`
      : 'Vị trí chèn phải là số thứ tự của một dòng trong báo giá.',
  );
}

function lineErrorOf(line: number, input: unknown, error: CrmValidationError): QuoteLineError {
  const materialId = (input as { materialId?: unknown } | undefined)?.materialId;
  return { line, materialId: typeof materialId === 'string' ? materialId : null, code: error.code, message: error.message };
}

function linesInvalid(errors: readonly QuoteLineError[]): CrmValidationError {
  const lines = errors.map((entry) => entry.line).join(', ');
  return new CrmValidationError(
    QUOTE_LINES_INVALID_CODE,
    `Có ${errors.length} dòng không hợp lệ (dòng ${lines}), chưa thêm dòng nào vào báo giá.`,
    { errors },
  );
}

function unchanged(quote: EditableQuote): Omit<QuoteChange, 'lines'> {
  const version = quote.version;
  const form = version.form;
  const input = (amount: typeof form.orderDiscount): QuoteOrderAmountInput =>
    amount.inputKind === 'PERCENT'
      ? { percent: amount.percent, amount: null }
      : amount.inputKind === 'AMOUNT'
        ? { percent: null, amount: amount.amount }
        : EMPTY_ORDER_AMOUNT;
  return {
    validUntil: version.validUntil,
    priceDate: version.priceDate,
    note: version.note,
    shipping: version.shipping,
    form: {
      quoteName: form.quoteName,
      quoteDate: form.quoteDate,
      templateId: form.templateId,
      quoteTypeId: form.quoteTypeId,
      discountMode: form.discountMode,
      taxMode: form.taxMode,
      orderDiscount: input(form.orderDiscount),
      orderTax: input(form.orderTax),
      fees: form.fees,
      customFields: form.customFields,
      organizationId: form.organizationId,
      seller: form.seller,
    },
  };
}

const EMPTY_ORDER_AMOUNT: QuoteOrderAmountInput = { percent: null, amount: null };

function codeExists(): CrmConflictError {
  return new CrmConflictError('QUOTE_CODE_EXISTS', 'Mã báo giá đã tồn tại. Vui lòng nhập mã khác hoặc bấm sinh lại.');
}

/** Chiết khấu hoặc thuế tổng đơn từ request: `null` là xoá; tiền nguyên đồng, phần trăm tối đa 4 chữ số thập phân. */
function orderAmountOf(value: QuoteOrderAmountInput | null, label: string): QuoteOrderAmountInput {
  if (value === null) return EMPTY_ORDER_AMOUNT;
  if (typeof value !== 'object') throw new CrmValidationError('INVALID', `${label.charAt(0).toUpperCase()}${label.slice(1)} không hợp lệ.`);
  const read = (input: unknown, max: number, name: string, decimals: number): number | null =>
    input === undefined || input === null || input === '' ? null : boundedNumber(input, 0, max, name, decimals);
  const percent = read(value.percent, 100, `${label} theo phần trăm`, 4);
  const amount = read(value.amount, AMOUNT_MAX, `${label} theo số tiền`, 0);
  if (percent !== null && amount !== null) {
    throw new CrmValidationError('ORDER_AMOUNT_CONFLICT', `Chỉ nhập ${label} theo phần trăm hoặc theo số tiền, không nhập cả hai.`);
  }
  return { percent, amount };
}

/** Các khoản phí trên hợp đồng: thay toàn bộ danh sách; tiền nguyên đồng. */
function feesOf(value: unknown): QuoteFee[] {
  if (!Array.isArray(value)) throw new CrmValidationError('INVALID', 'Danh sách phí không hợp lệ.');
  if (value.length > QUOTE_FEES_MAX) {
    throw new CrmValidationError('TOO_MANY_FEES', `Mỗi báo giá tối đa ${QUOTE_FEES_MAX} khoản phí.`);
  }
  return value.map((fee: { feeType?: unknown; amount?: unknown }, index) => {
    if (!fee || typeof fee !== 'object') throw new CrmValidationError('INVALID', `Khoản phí ${index + 1} không hợp lệ.`);
    return {
      feeType: requiredText(fee.feeType, 200, `loại phí của khoản ${index + 1}`),
      amount: boundedNumber(fee.amount, 0, AMOUNT_MAX, `số tiền phí của khoản ${index + 1}`, 0),
    };
  });
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
