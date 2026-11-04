import type { OpportunityPromotion, QuotePromotionSnapshot } from '@enterprise-platform/contracts-crm';
import type { PromotionCatalogRow, PromotionRecord } from '../domain/promotion.js';
import type { QuoteVersionRef } from './quote-store.port.js';

/** Port của khuyến mãi (P2I-11): danh mục, lựa chọn của dự án, ảnh chụp trên phiên bản báo giá. */
export const CRM_PROMOTION_STORE = Symbol('CRM_PROMOTION_STORE');

/** Lựa chọn của dự án; `catalog` chưa có `effective` (service tính theo ngày hôm nay). */
export interface OpportunityPromotionRow extends Omit<OpportunityPromotion, 'catalog'> {
  readonly catalog: PromotionCatalogRow;
}

export interface PromotionStore {
  listCatalog(tenantId: string, query: { readonly kind?: string; readonly includeInactive: boolean }): Promise<PromotionCatalogRow[]>;
  getCatalog(tenantId: string, id: string): Promise<PromotionCatalogRow | undefined>;
  /** Ném 409 `PROMOTION_CODE_EXISTS` khi trùng mã (không phân biệt hoa thường). */
  createCatalog(tenantId: string, record: PromotionRecord, actorId: string): Promise<PromotionCatalogRow>;
  updateCatalog(tenantId: string, id: string, record: PromotionRecord, actorId: string): Promise<PromotionCatalogRow | undefined>;

  listOpportunityPromotions(tenantId: string, opportunityId: string): Promise<OpportunityPromotionRow[]>;
  /** `false` khi đã chọn rồi; ném 409 khi quá số lượng tối đa. */
  addOpportunityPromotion(tenantId: string, opportunityId: string, catalogId: string, note: string | null, actorId: string): Promise<boolean>;
  removeOpportunityPromotion(tenantId: string, opportunityId: string, linkId: string, actorId: string): Promise<boolean>;

  /**
   * Thay toàn bộ ảnh chụp khuyến mãi của phiên bản, trong transaction: khoá phiên bản, phải đang là phiên bản hiện
   * tại ở Nháp và đúng `revision` (409 nếu không). Trả `revision` mới.
   */
  saveQuotePromotions(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    promotions: readonly QuotePromotionSnapshot[],
    actorId: string,
  ): Promise<number>;
}
