import type {
  DiscountPolicy,
  DiscountPolicyRule,
  DiscountStacking,
  PriceListDetail,
  PriceListSummary,
  PricingStatus,
} from '@enterprise-platform/contracts-crm';
import type { PricingPolicy, PricingPriceList } from '../domain/pricing-engine.js';

/**
 * Port lưu trữ của bảng giá, chính sách chiết khấu và cấu hình giá (GĐ3a), cùng
 * port đọc danh mục mặt hàng của Kho.
 */

export const CRM_PRICE_LIST_STORE = Symbol('CRM_PRICE_LIST_STORE');
export const CRM_DISCOUNT_POLICY_STORE = Symbol('CRM_DISCOUNT_POLICY_STORE');
export const CRM_PRICING_STORE = Symbol('CRM_PRICING_STORE');
export const CRM_CATALOG_READER = Symbol('CRM_CATALOG_READER');

/** Phần đầu bảng giá đã kiểm, sẵn sàng ghi. */
export interface PriceListRecord {
  readonly code: string;
  readonly name: string;
  readonly isStandard: boolean;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly note: string | null;
}

export interface PriceListItemRecord {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly price: number;
  readonly vatRate: number;
}

export interface PriceListStore {
  listPriceLists(tenantId: string): Promise<PriceListSummary[]>;
  getPriceList(tenantId: string, id: string): Promise<PriceListDetail | undefined>;
  /**
   * Tạo bảng giá cùng nhóm gán trong một transaction, có khoá chống chồng hiệu
   * lực: trùng với bảng ACTIVE khác (cùng nhóm, hoặc cùng là bảng chuẩn) thì 409
   * "Trùng thời gian hiệu lực với bảng giá <mã>". Trùng mã: 409. Trả id.
   */
  createPriceList(
    tenantId: string,
    record: PriceListRecord,
    customerGroupIds: readonly string[],
    actorId: string,
  ): Promise<string>;
  /**
   * Sửa phần đầu; `customerGroupIds` rỗng (`undefined`) thì giữ nhóm đang gán.
   * Kiểm chồng hiệu lực như khi tạo. `false` khi không có.
   */
  updatePriceList(
    tenantId: string,
    id: string,
    record: PriceListRecord,
    customerGroupIds: readonly string[] | undefined,
    actorId: string,
  ): Promise<boolean>;
  deletePriceList(tenantId: string, id: string): Promise<boolean>;
  /** Trùng mặt hàng và đơn vị trong bảng: 409. Trả id; `undefined` khi bảng không có. */
  addItem(tenantId: string, priceListId: string, record: PriceListItemRecord, actorId: string): Promise<string | undefined>;
  /** `false` khi dòng không thuộc bảng. Trùng mặt hàng và đơn vị: 409. */
  updateItem(
    tenantId: string,
    priceListId: string,
    itemId: string,
    record: PriceListItemRecord,
    actorId: string,
  ): Promise<boolean>;
  deleteItem(tenantId: string, priceListId: string, itemId: string): Promise<boolean>;
  /** Thêm hoặc cập nhật theo (mặt hàng, đơn vị) trong một transaction. `false` khi bảng không có. */
  upsertItems(
    tenantId: string,
    priceListId: string,
    records: readonly PriceListItemRecord[],
    actorId: string,
  ): Promise<boolean>;
}

export interface DiscountPolicyRecord {
  readonly code: string;
  readonly name: string;
  readonly priority: number;
  readonly stacking: DiscountStacking;
  readonly exclusive: boolean;
  readonly percent: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly appliesToAllCustomers: boolean;
  readonly note: string | null;
  readonly rules: readonly DiscountPolicyRule[];
}

export interface DiscountPolicyStore {
  listPolicies(tenantId: string): Promise<DiscountPolicy[]>;
  getPolicy(tenantId: string, id: string): Promise<DiscountPolicy | undefined>;
  /** Trùng mã: 409. Trả id. */
  createPolicy(tenantId: string, record: DiscountPolicyRecord, actorId: string): Promise<string>;
  /** Thay toàn bộ tiêu chí trong một transaction. `false` khi không có. */
  updatePolicy(tenantId: string, id: string, record: DiscountPolicyRecord, actorId: string): Promise<boolean>;
  deletePolicy(tenantId: string, id: string): Promise<boolean>;
  /** Id trong danh sách mà không có nhóm khách tương ứng. */
  missingCustomerGroups(tenantId: string, ids: readonly string[]): Promise<string[]>;
  /** Id trong danh sách mà không có khách hàng tương ứng. */
  missingCustomers(tenantId: string, ids: readonly string[]): Promise<string[]>;
}

/** Dữ liệu cho engine giá và cấu hình trần chiết khấu. */
export interface PricingStore {
  discountCapPercent(tenantId: string): Promise<number>;
  saveDiscountCapPercent(tenantId: string, percent: number, actorId: string): Promise<void>;
  /**
   * Bảng giá ACTIVE còn hiệu lực ngày `date` là bảng chuẩn hoặc gán cho
   * `customerGroupId`; chỉ kèm dòng của các mặt hàng trong `materialIds`.
   */
  priceListsForPricing(
    tenantId: string,
    date: string,
    customerGroupId: string | null,
    materialIds: readonly string[],
  ): Promise<PricingPriceList[]>;
  /** Chính sách ACTIVE còn hiệu lực ngày `date`, kèm tiêu chí. */
  policiesForPricing(tenantId: string, date: string): Promise<PricingPolicy[]>;
}

/** Mặt hàng theo danh mục Kho. */
export interface CatalogMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string | null;
  /** Loại hàng, dùng cho tiêu chí "Nhóm hàng". */
  readonly category: string | null;
}

/**
 * Đọc danh mục mặt hàng của Kho qua API nội bộ, không đọc schema của Kho.
 *
 * API `GET /v1/internal/materials` của Kho làm ở T1-24; trước đó phân hệ dùng
 * `PendingCatalogReader` (không biết mặt hàng nào), nên mã, tên, đơn vị, loại
 * hàng lấy theo dữ liệu người dùng nhập. Bản HTTP thay vào đây khi T1-24 xong,
 * service không phải đổi.
 */
export interface CatalogReader {
  /** Mặt hàng danh mục biết, theo id; id không biết thì vắng trong kết quả. */
  materials(tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMaterial>>;
}
