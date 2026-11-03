/**
 * Khuyến mãi của báo giá (P2I-11). Danh mục cấu hình ở Cài đặt (`crm.manage`); dự án bán hàng chọn nhiều lựa chọn từ
 * danh mục; báo giá chọn từ tập của dự án và chụp lại trên phiên bản. Khuyến mãi là thông tin kèm theo: KHÔNG đổi
 * tổng báo giá.
 */

export const PROMOTION_KINDS = ['PROGRAM', 'DISCOUNT_POLICY'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];
export const PROMOTION_KIND_LABELS: Readonly<Record<PromotionKind, string>> = {
  PROGRAM: 'Chương trình khuyến mãi',
  DISCOUNT_POLICY: 'Chính sách chiết khấu',
};

export const PROMOTION_DISCOUNT_TYPES = ['PERCENT', 'AMOUNT', 'NONE'] as const;
export type PromotionDiscountType = (typeof PROMOTION_DISCOUNT_TYPES)[number];

/** Tối đa số lựa chọn khuyến mãi của một dự án và của một phiên bản báo giá. */
export const OPPORTUNITY_PROMOTIONS_MAX = 20;

export interface PromotionCatalogItem {
  readonly id: string;
  readonly kind: PromotionKind;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly discountType: PromotionDiscountType;
  /** Phần trăm (0 đến 100) hoặc số tiền (đồng); 0 khi `discountType = NONE`. */
  readonly value: number;
  /** `yyyy-mm-dd`; rỗng là không giới hạn đầu. */
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly active: boolean;
  /** `true` khi đang bật và hôm nay (giờ Việt Nam) nằm trong thời hạn: chọn được cho dự án, báo giá. */
  readonly effective: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Thân `POST`, `PUT`, `PATCH /v1/promotions/catalog`. Khi sửa, trường bỏ trống giữ giá trị cũ. */
export interface SavePromotionCatalogRequest {
  readonly kind?: PromotionKind;
  readonly code?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly discountType?: PromotionDiscountType;
  readonly value?: number;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly active?: boolean;
}

/** Khuyến mãi đã chọn cho một dự án. */
export interface OpportunityPromotion {
  /** Id của lựa chọn (dùng để bỏ chọn). */
  readonly id: string;
  readonly opportunityId: string;
  readonly catalog: PromotionCatalogItem;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface AddOpportunityPromotionRequest {
  readonly catalogId: string;
  readonly note?: string | null;
}

/** Ảnh chụp một khuyến mãi trên phiên bản báo giá. */
export interface QuotePromotionSnapshot {
  readonly catalogId: string;
  readonly kind: PromotionKind;
  readonly code: string;
  readonly name: string;
  readonly discountType: PromotionDiscountType;
  readonly value: number;
}

/** Thân `PUT /v1/quotes/:id/versions/:versionNo/promotions`: thay toàn bộ lựa chọn. */
export interface SaveQuotePromotionsRequest {
  /** Id danh mục, mỗi id phải đang là lựa chọn của dự án của báo giá. Mảng rỗng là bỏ hết. */
  readonly catalogIds: readonly string[];
  readonly revision: number;
}

export interface SaveQuotePromotionsResponse {
  readonly versionNo: number;
  /** `revision` mới của phiên bản: dùng cho các thao tác sửa tiếp. */
  readonly revision: number;
  readonly promotions: readonly QuotePromotionSnapshot[];
}
