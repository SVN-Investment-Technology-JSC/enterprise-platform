import type {
  CrmWarehouseOption,
  DiscountPolicy,
  DiscountPolicyRule,
  DiscountStacking,
  PriceListDetail,
  PriceListSummary,
  PriceListSyncResult,
  PriceListType,
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
export const CRM_PRICE_LIST_SYNC_STORE = Symbol('CRM_PRICE_LIST_SYNC_STORE');

/**
 * Phần đầu bảng giá đã kiểm, sẵn sàng ghi. `ratioPercent`: tỷ lệ của bảng `DERIVED` (bắt buộc khi tạo); bảng `MANUAL`
 * bỏ qua.
 */
export interface PriceListRecord {
  readonly code: string;
  readonly name: string;
  readonly ratioPercent: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly note: string | null;
}

/** Phần đầu bảng giá để kiểm loại, hiệu lực (không kèm dòng). */
export interface PriceListRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly listType: PriceListType;
  readonly status: PricingStatus;
  readonly validFrom: string;
  readonly validTo: string | null;
}

/** Dòng giá của bảng `MANUAL` cũ (thêm, sửa, dán nhiều dòng). */
export interface PriceListItemRecord {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly price: number;
  readonly vatRate: number;
}

/**
 * Bảng giá (`docs/crm_price_list_logic/plan.md` 4.4). Ghi vào bảng mặc định và bảng theo tỷ lệ giữ cùng khoá tư vấn
 * với đồng bộ Kho, nên các thao tác này chạy lần lượt với "Đồng bộ".
 */
export interface PriceListStore {
  /** Bảng mặc định đứng đầu. */
  listPriceLists(tenantId: string): Promise<PriceListSummary[]>;
  getPriceList(tenantId: string, id: string): Promise<PriceListDetail | undefined>;
  priceListRef(tenantId: string, id: string): Promise<PriceListRef | undefined>;
  /**
   * Tạo bảng `DERIVED` với tỷ lệ `record.ratioPercent` và sinh ngay mọi dòng `RATIO` từ bảng mặc định. Chưa có bảng mặc
   * định: 409 `DEFAULT_PRICE_LIST_MISSING`. Trùng mã: 409. Giá sau tỷ lệ vượt giới hạn: 400 `PRICE_OUT_OF_RANGE`. Trả id.
   */
  createPriceList(tenantId: string, record: PriceListRecord, actorId: string): Promise<string>;
  /**
   * Sửa phần đầu bảng `DERIVED` hoặc `MANUAL` (bảng mặc định không sửa ở đây). Bảng `DERIVED` đổi tỷ lệ thì tính lại các
   * dòng `RATIO`, giữ dòng giá tay. `false` khi không có.
   */
  updatePriceList(tenantId: string, id: string, record: PriceListRecord, actorId: string): Promise<boolean>;
  /** Bảng đang được phiên bản báo giá hoặc đơn bán dùng: 409 `PRICE_LIST_IN_USE`. `false` khi không có. */
  deletePriceList(tenantId: string, id: string): Promise<boolean>;
  /** Bảng `DERIVED`: dòng thành `MANUAL` với giá `price`. `false` khi dòng không thuộc bảng. */
  setManualPrice(tenantId: string, priceListId: string, itemId: string, price: number, actorId: string): Promise<boolean>;
  /** Bảng `DERIVED`: dòng về `RATIO`, giá tính lại theo bảng mặc định; dòng đang `RATIO` thì giữ nguyên. */
  clearManualPrice(tenantId: string, priceListId: string, itemId: string, actorId: string): Promise<boolean>;
  /** Bảng mặc định: sửa thuế suất của dòng; dòng cùng mặt hàng ở mọi bảng `DERIVED` nhận theo. */
  setVatRate(tenantId: string, priceListId: string, itemId: string, vatRate: number, actorId: string): Promise<boolean>;
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
   * Đúng bảng giá đã chọn `priceListId` nếu bảng ACTIVE và còn hiệu lực ngày `date` (không kèm bảng chuẩn); chỉ kèm dòng
   * của các mặt hàng trong `materialIds`, giá dòng có thể rỗng. `priceListId` rỗng: `[]`.
   */
  priceListsForPricing(
    tenantId: string,
    date: string,
    priceListId: string | null,
    materialIds: readonly string[],
  ): Promise<PricingPriceList[]>;
  /** Phần đầu bảng giá (kiểm bảng người dùng chọn ở báo giá, đơn, thử tính giá). */
  priceListRef(tenantId: string, id: string): Promise<PriceListRef | undefined>;
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
  /**
   * Mặt hàng có giá bán cho báo giá (hộp thoại "Thêm dòng báo giá" chỉ liệt kê các mặt hàng này): có dòng trong bảng
   * giá đã chọn `priceListId` đang hiệu lực ngày `date` (kể cả dòng chưa nhập giá ở Kho), hoặc trong hợp đồng khung,
   * nguyên tắc đang hiệu lực của `customerId` (cùng nguồn với engine giá). `priceListId` rỗng: `[]`. Mã hoặc tên (bản
   * chụp) chứa `search`; xếp theo mã; tối đa `limit` mặt hàng.
   */
  pricedMaterials(tenantId: string, query: PricedMaterialsQuery): Promise<PricedMaterial[]>;
}

export interface PricedMaterialsQuery {
  readonly date: string;
  readonly priceListId: string | null;
  readonly customerId: string | null;
  readonly search: string;
  readonly limit: number;
  /** Chỉ mặt hàng có mã (bản chụp) đứng sau mã này: trang kế. */
  readonly cursor?: string;
}

/** Mặt hàng có giá và các ĐVT có giá (chữ thường, đã bỏ khoảng trắng hai đầu). */
export interface PricedMaterial {
  readonly materialId: string;
  /** Mã (bản chụp) dùng xếp và làm cursor trang kế. */
  readonly code: string;
  readonly units: readonly string[];
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
  /** Giá bán khai trong danh mục hàng hoá của Kho; rỗng là chưa khai. */
  readonly salePrice?: number | null;
  /** Phân loại hàng hoá hoặc dịch vụ của Kho. */
  readonly tradeCategory?: string | null;
  /** Mặt hàng còn dùng ở Kho; rỗng là không biết (coi như còn dùng). */
  readonly isActive?: boolean | null;
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
  /**
   * Tìm theo mã, tên hoặc phân loại (chọn mặt hàng khi thêm dòng báo giá, dòng giá), xếp theo mã. `cursor`: chỉ mã
   * đứng sau mã này (trang kế); `kinds`: chỉ các nhóm này (STOCK, SERVICE).
   */
  search(
    tenantId: string,
    query: string,
    limit: number,
    options?: { readonly cursor?: string; readonly kinds?: readonly string[]; readonly tradeCategory?: string },
  ): Promise<CatalogMaterial[]>;
  /** Phân loại đang gắn trên mặt hàng của các nhóm `kinds` (ô lọc Phân loại). Bản giả trong test có thể không có. */
  tradeCategories?(tenantId: string, kinds: readonly string[]): Promise<string[]>;
  /**
   * Danh sách kho của Kho (`GET /v1/internal/warehouses?search=&codes=`) để chọn
   * kho xuất (T4-19). Bản giả trong test có thể không có.
   */
  warehouses?(tenantId: string, query: { readonly search?: string; readonly codes?: readonly string[] }): Promise<CrmWarehouseOption[]>;
}

/** Dấu vân tay danh mục Kho (`GET /v1/internal/materials/fingerprint`). */
export interface CatalogFingerprint {
  readonly count: number;
  readonly fingerprint: string;
}

/** Một trang danh mục Kho theo mã; `nextCursor` rỗng là trang cuối. */
export interface CatalogPage {
  readonly materials: readonly CatalogMaterial[];
  readonly nextCursor: string | null;
}

/**
 * Đọc danh mục Kho cho đồng bộ bảng giá mặc định (`HttpInventoryCatalogReader`). Lỗi Kho ném `CrmError`; bên gọi quyết
 * định bỏ qua (trạng thái) hay báo lỗi (đồng bộ).
 */
export interface CatalogSyncReader {
  catalogFingerprint(tenantId: string, kinds: readonly string[]): Promise<CatalogFingerprint>;
  /** Cả mặt hàng ngừng dùng khi `includeInactive`. */
  catalogPage(
    tenantId: string,
    query: { readonly kinds: readonly string[]; readonly cursor: string | null; readonly limit: number; readonly includeInactive: boolean },
  ): Promise<CatalogPage>;
}

/** Khoá `pricing.catalogSync` ở `settings`: dấu vân tay Kho lúc đồng bộ gần nhất. */
export interface CatalogSyncState {
  readonly fingerprint: string;
  readonly count: number;
  readonly syncedAt: string;
  readonly syncedBy: string | null;
}

/** Mặt hàng Kho đã kiểm (có đơn vị tính), sẵn sàng đưa vào bảng mặc định. */
export interface SyncCatalogMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly salePrice: number | null;
  readonly isActive: boolean;
}

export interface SyncDefaultPriceListInput {
  readonly materials: readonly SyncCatalogMaterial[];
  readonly skippedWithoutUnit: number;
  /** Dấu vân tay đọc TRƯỚC khi đọc danh mục: Kho đổi trong lúc đồng bộ thì lần sau vẫn báo. */
  readonly fingerprint: CatalogFingerprint;
  /** `YYYY-MM-DD` theo giờ Việt Nam, cho mã ngày của bảng mặc định mới. */
  readonly today: string;
}

/** Bảng mặc định và đồng bộ với Kho (`docs/crm_price_list_logic/plan.md` 4.3). */
export interface PriceListSyncStore {
  defaultPriceListId(tenantId: string): Promise<string | null>;
  catalogSyncState(tenantId: string): Promise<CatalogSyncState | null>;
  /**
   * Một transaction có khoá tư vấn: tạo bảng mặc định nếu chưa có, đồng bộ dòng theo `material_id`, tính lại mọi bảng
   * `DERIVED`, lưu `pricing.catalogSync`. Lỗi giữa chừng thì không ghi gì.
   */
  syncDefaultPriceList(tenantId: string, input: SyncDefaultPriceListInput, actorId: string): Promise<PriceListSyncResult>;
}
