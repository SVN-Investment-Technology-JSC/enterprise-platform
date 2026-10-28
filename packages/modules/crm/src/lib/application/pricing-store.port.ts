import type {
  CrmWarehouseOption,
  DiscountPolicy,
  DiscountPolicyRule,
  DiscountStacking,
  PriceListDetail,
  PriceListSummary,
  PricingStatus,
} from '@enterprise-platform/contracts-crm';
import type { PricingContractPrice, PricingPolicy, PricingPriceList } from '../domain/pricing-engine.js';

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
  /**
   * Giá khung hợp đồng cho engine giá (nguồn "Hợp đồng", T4-02). Có
   * `contractId`: dòng của đúng hợp đồng đó (đơn từ hợp đồng). Không có: dòng
   * của các hợp đồng khung, nguyên tắc đang Hiệu lực của `customerId`. Chỉ hợp
   * đồng Hiệu lực ngày `date`; hợp đồng bắt đầu sau cùng đứng trước.
   */
  contractPricesForPricing(
    tenantId: string,
    date: string,
    customerId: string | null,
    materialIds: readonly string[],
    contractId?: string | null,
  ): Promise<PricingContractPrice[]>;
}

/** Mặt hàng theo danh mục Kho. */
export interface CatalogMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string | null;
  /** Loại hàng, dùng cho tiêu chí "Nhóm hàng". */
  readonly category: string | null;
  /** STOCK hoặc SERVICE; dịch vụ không có tồn (D6). */
  readonly kind?: string | null;
  /** Giá vốn bình quân hiện tại, đơn giá 4 chữ số thập phân (D4); rỗng với dịch vụ. */
  readonly avgCost?: number | null;
  /** Tồn khả dụng gộp các kho; rỗng với dịch vụ. */
  readonly totalAvailable?: number | null;
  readonly availableByWarehouse?: readonly CatalogMaterialStock[] | null;
  /** Số tháng bảo hành của mặt hàng (tính hạn bảo hành khi không theo hợp đồng). */
  readonly warrantyMonths?: number | null;
}

export interface CatalogMaterialStock {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly available: number;
}

/**
 * Đọc danh mục mặt hàng của Kho qua API nội bộ `GET /v1/internal/materials`,
 * không đọc schema của Kho (`HttpInventoryCatalogReader`). Test dùng bản giả.
 *
 * Kho không trả lời thì ném `CrmError` 503; bên gọi chỉ dùng danh mục để làm
 * giàu dữ liệu (thử tính giá) có thể bỏ qua lỗi.
 */
export interface CatalogReader {
  /** Mặt hàng danh mục biết, theo id; id không biết thì vắng trong kết quả. */
  materials(tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMaterial>>;
  /** Tìm theo mã hoặc tên (chọn mặt hàng khi thêm dòng báo giá). */
  search(tenantId: string, query: string, limit: number): Promise<CatalogMaterial[]>;
  /**
   * Danh sách kho của Kho (`GET /v1/internal/warehouses?search=&codes=`) để chọn
   * kho xuất (T4-19). Bản giả trong test có thể không có.
   */
  warehouses?(tenantId: string, query: { readonly search?: string; readonly codes?: readonly string[] }): Promise<CrmWarehouseOption[]>;
}
