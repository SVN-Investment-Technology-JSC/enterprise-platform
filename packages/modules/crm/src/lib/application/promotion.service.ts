import {
  OPPORTUNITY_PROMOTIONS_MAX,
  PROMOTION_KINDS,
  type AddOpportunityPromotionRequest,
  type OpportunityPromotion,
  type PromotionCatalogItem,
  type QuotePromotionSnapshot,
  type SaveQuotePromotionsRequest,
  type SaveQuotePromotionsResponse,
  type SavePromotionCatalogRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalText } from '../domain/fields.js';
import { planQuoteEdit } from '../domain/quote.js';
import {
  promotionRecord,
  promotionSnapshot,
  promotionUnavailableReason,
  withEffective,
  type PromotionCatalogRow,
} from '../domain/promotion.js';
import { requireSalesManager, requireSalesWriter } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import { scopeIncludes, type CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { PromotionStore } from './promotion-store.port.js';
import type { QuoteStore } from './quote-store.port.js';
import { requireQuoteWriter } from './quote.service.js';
import type { OpportunityStore } from './sales-store.port.js';

const OPPORTUNITY_NOT_FOUND = 'Không tìm thấy cơ hội.';
const PROMOTION_NOT_FOUND = 'Không tìm thấy khuyến mãi.';

/**
 * Khuyến mãi của báo giá (P2I-11).
 *
 * - Danh mục (Cài đặt): đọc với `crm.read`; thêm, sửa, vô hiệu hoá chỉ `crm.manage`. Không xoá cứng: tắt bằng `active`.
 * - Dự án bán hàng: xem trong phạm vi đọc của cơ hội; chọn, bỏ chọn cần `crm.opportunity.write` và là chủ dự án (hoặc
 *   cấp trên theo phạm vi); chỉ chọn mục đang bật và còn hiệu lực.
 * - Báo giá: chọn nhiều khuyến mãi từ tập của dự án mà báo giá thuộc về; ảnh chụp lưu trên phiên bản (Nháp, phiên bản
 *   hiện tại). Phiên bản đã gửi duyệt hoặc đã khoá không sửa được.
 *
 * Khuyến mãi chỉ là thông tin kèm theo: không đổi tổng báo giá.
 */
export class PromotionService {
  constructor(
    private readonly store: PromotionStore,
    private readonly opportunities: Pick<OpportunityStore, 'getOpportunity'>,
    private readonly quotes: Pick<QuoteStore, 'loadForEdit'>,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  // Danh mục -------------------------------------------------------------------

  async listCatalog(actor: CrmActor, query: { kind?: unknown; includeInactive?: unknown }): Promise<PromotionCatalogItem[]> {
    const kind = query?.kind === undefined || query.kind === '' ? undefined : PROMOTION_KINDS.find((candidate) => candidate === query.kind);
    if (query?.kind !== undefined && query.kind !== '' && !kind) {
      throw new CrmValidationError('PROMOTION_KIND_INVALID', 'Loại khuyến mãi không hợp lệ.');
    }
    const today = this.today();
    const rows = await this.store.listCatalog(actor.tenantId, {
      kind,
      includeInactive: query?.includeInactive === true || query?.includeInactive === 'true',
    });
    return rows.map((row) => withEffective(row, today));
  }

  async getCatalog(actor: CrmActor, id: string): Promise<PromotionCatalogItem> {
    return withEffective(await this.requireCatalog(actor.tenantId, id), this.today());
  }

  async createCatalog(actor: CrmActor, request: SavePromotionCatalogRequest): Promise<PromotionCatalogItem> {
    requireSalesManager(actor);
    const row = await this.store.createCatalog(actor.tenantId, promotionRecord(request), actor.userId);
    return withEffective(row, this.today());
  }

  async updateCatalog(actor: CrmActor, id: string, request: SavePromotionCatalogRequest): Promise<PromotionCatalogItem> {
    requireSalesManager(actor);
    const current = await this.requireCatalog(actor.tenantId, id);
    const updated = await this.store.updateCatalog(actor.tenantId, id, promotionRecord(request, current), actor.userId);
    if (!updated) throw new CrmNotFoundError(PROMOTION_NOT_FOUND);
    return withEffective(updated, this.today());
  }

  private async requireCatalog(tenantId: string, id: string): Promise<PromotionCatalogRow> {
    const row = isUuid(id) ? await this.store.getCatalog(tenantId, id) : undefined;
    if (!row) throw new CrmNotFoundError(PROMOTION_NOT_FOUND);
    return row;
  }

  // Dự án bán hàng ---------------------------------------------------------------

  async listForOpportunity(actor: CrmActor, opportunityId: string): Promise<OpportunityPromotion[]> {
    await this.requireOpportunity(actor, opportunityId);
    return this.decorate(await this.store.listOpportunityPromotions(actor.tenantId, opportunityId));
  }

  async addToOpportunity(actor: CrmActor, opportunityId: string, request: AddOpportunityPromotionRequest): Promise<OpportunityPromotion[]> {
    requireSalesWriter(actor);
    await this.requireOpportunityWritable(actor, opportunityId);
    const catalogId = typeof request?.catalogId === 'string' ? request.catalogId.toLowerCase() : '';
    if (!isUuid(catalogId)) throw new CrmValidationError('PROMOTION_REQUIRED', 'Vui lòng chọn chương trình khuyến mãi hoặc chính sách chiết khấu.');
    const note = optionalText(request.note, 500, 'ghi chú');
    const catalog = await this.store.getCatalog(actor.tenantId, catalogId);
    if (!catalog) throw new CrmNotFoundError(PROMOTION_NOT_FOUND);
    const reason = promotionUnavailableReason(catalog, this.today());
    if (reason) throw new CrmConflictError('PROMOTION_NOT_EFFECTIVE', reason);
    if (!(await this.store.addOpportunityPromotion(actor.tenantId, opportunityId, catalogId, note, actor.userId))) {
      throw new CrmConflictError('PROMOTION_EXISTS', 'Dự án đã chọn khuyến mãi này.');
    }
    return this.decorate(await this.store.listOpportunityPromotions(actor.tenantId, opportunityId));
  }

  async removeFromOpportunity(actor: CrmActor, opportunityId: string, linkId: string): Promise<OpportunityPromotion[]> {
    requireSalesWriter(actor);
    await this.requireOpportunityWritable(actor, opportunityId);
    if (!isUuid(linkId) || !(await this.store.removeOpportunityPromotion(actor.tenantId, opportunityId, linkId, actor.userId))) {
      throw new CrmNotFoundError(PROMOTION_NOT_FOUND);
    }
    return this.decorate(await this.store.listOpportunityPromotions(actor.tenantId, opportunityId));
  }

  private decorate(rows: Awaited<ReturnType<PromotionStore['listOpportunityPromotions']>>): OpportunityPromotion[] {
    const today = this.today();
    return rows.map((row) => ({ ...row, catalog: withEffective(row.catalog, today) }));
  }

  private async requireOpportunity(actor: CrmActor, opportunityId: string) {
    if (!isUuid(opportunityId)) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const opportunity = await this.opportunities.getOpportunity(actor.tenantId, scope, opportunityId);
    if (!opportunity) throw new CrmNotFoundError(OPPORTUNITY_NOT_FOUND);
    return { opportunity, scope };
  }

  /** Cơ hội trong phạm vi đọc; ghi cần là người phụ trách trong phạm vi (người chỉ được gán giai đoạn thì chỉ đọc). */
  private async requireOpportunityWritable(actor: CrmActor, opportunityId: string): Promise<void> {
    const { opportunity, scope } = await this.requireOpportunity(actor, opportunityId);
    if (!scopeIncludes(scope, opportunity.ownerUserId)) {
      throw new CrmForbiddenError('Chỉ chủ dự án hoặc cấp trên mới thay đổi được khuyến mãi của dự án.');
    }
  }

  // Báo giá --------------------------------------------------------------------------

  /** Thay toàn bộ khuyến mãi áp trên một phiên bản báo giá bằng lựa chọn mới (chụp lại từ danh mục). */
  async saveForQuote(
    actor: CrmActor,
    quoteId: string,
    versionNo: unknown,
    request: SaveQuotePromotionsRequest,
  ): Promise<SaveQuotePromotionsResponse> {
    requireQuoteWriter(actor);
    const number = Number(versionNo);
    if (!isUuid(quoteId) || !Number.isInteger(number) || number < 1) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
    const scope = await this.scopes.resolve(actor);
    const quote = await this.quotes.loadForEdit(actor.tenantId, scope, quoteId, number);
    if (!quote || !scopeIncludes(scope, quote.head.ownerUserId)) throw new CrmNotFoundError('Không tìm thấy phiên bản báo giá.');
    if (!Array.isArray(request?.catalogIds)) throw new CrmValidationError('PROMOTIONS_INVALID', 'Danh sách khuyến mãi không hợp lệ.');
    if (!Number.isInteger(request.revision) || request.revision < 0) {
      throw new CrmValidationError('VERSION_REQUIRED', 'Thiếu phiên bản dữ liệu đang sửa. Vui lòng tải lại.');
    }
    const ids = request.catalogIds.map((id) => (typeof id === 'string' ? id.toLowerCase() : ''));
    if (ids.some((id) => !isUuid(id))) throw new CrmValidationError('PROMOTIONS_INVALID', 'Danh sách khuyến mãi không hợp lệ.');
    if (new Set(ids).size !== ids.length) throw new CrmValidationError('PROMOTIONS_DUPLICATE', 'Mỗi khuyến mãi chỉ chọn một lần.');
    if (ids.length > OPPORTUNITY_PROMOTIONS_MAX) {
      throw new CrmValidationError('TOO_MANY_PROMOTIONS', `Tối đa ${OPPORTUNITY_PROMOTIONS_MAX} khuyến mãi cho mỗi báo giá.`);
    }
    // Phiên bản cũ, đã gửi duyệt, chờ duyệt hoặc đã khoá thì không sửa (chỉ Nháp của phiên bản hiện tại).
    const plan = planQuoteEdit({
      currentVersion: quote.head.currentVersion,
      versionNo: quote.version.versionNo,
      status: quote.version.status,
    });
    if (plan !== 'IN_PLACE') {
      throw new CrmConflictError('QUOTE_PROMOTIONS_LOCKED', 'Phiên bản đã gửi duyệt hoặc đã khoá, không sửa được khuyến mãi. Hãy tạo phiên bản mới để sửa.');
    }
    if (!quote.head.opportunityId) {
      if (ids.length) {
        throw new CrmConflictError('QUOTE_NO_OPPORTUNITY', 'Báo giá chưa thuộc dự án bán hàng nên chưa chọn được khuyến mãi.');
      }
    }
    const snapshots: QuotePromotionSnapshot[] = [];
    if (ids.length && quote.head.opportunityId) {
      const available = new Map(
        (await this.store.listOpportunityPromotions(actor.tenantId, quote.head.opportunityId)).map((row) => [row.catalog.id, row.catalog]),
      );
      const kept = new Map(quote.version.promotions.map((snapshot) => [snapshot.catalogId, snapshot]));
      const today = this.today();
      for (const id of ids) {
        const previous = kept.get(id);
        if (previous) {
          // Đã áp từ trước: giữ ảnh chụp cũ dù mục sau đó hết hiệu lực, bị tắt hoặc dự án đã bỏ chọn.
          snapshots.push(previous);
          continue;
        }
        const catalog = available.get(id);
        if (!catalog) {
          throw new CrmValidationError('PROMOTION_NOT_IN_OPPORTUNITY', 'Khuyến mãi này chưa được chọn cho dự án của báo giá.');
        }
        const reason = promotionUnavailableReason(catalog, today);
        if (reason) throw new CrmConflictError('PROMOTION_NOT_EFFECTIVE', reason);
        snapshots.push(promotionSnapshot(catalog));
      }
    }
    const revision = await this.store.saveQuotePromotions(
      actor.tenantId,
      quoteId,
      {
        versionId: quote.version.id,
        versionNo: quote.version.versionNo,
        status: quote.version.status,
        revision: request.revision,
      },
      snapshots,
      actor.userId,
    );
    return { versionNo: quote.version.versionNo, revision, promotions: snapshots };
  }
}
