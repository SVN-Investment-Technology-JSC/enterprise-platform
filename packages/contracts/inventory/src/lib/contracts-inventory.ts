// Inventory Service (AMM - Asset & Materials Management)
// Schema: inventory_schema
// Principles: Ledger-only inventory, hierarchical assets, serialized tracking, pessimistic locking

// ============================================================================
// ASSET HIERARCHY & LIFECYCLE
// ============================================================================

/**
 * Loại vật tư — CHUỖI TỰ DO, danh mục do tenant khai trong Cài đặt.
 *
 * Trước là union bốn giá trị (nhà máy / hệ thống / thiết bị / chi tiết). Bốn cái
 * tên đó là cách phân cấp của riêng ngành điện; đơn vị khác phân loại theo trục
 * khác hẳn. Cột `materials.type` ở database vốn không có ràng buộc nào nên mở ra
 * không cần migration.
 */
export type AssetType = string;
/** Tình trạng vật tư — chuỗi tự do, danh mục khai trong Cài đặt. */
export type AssetStatus = string;
export type AssetCriticality = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Một đầu việc trong hồ sơ bảo trì mặc định của thiết bị. */
export interface AssetTaskItem {
  readonly key: string;
  readonly name: string;
  readonly durationMinutes?: number;
  readonly note?: string;
}

export interface UpdateAssetRequest {
  /** Loại vật tư, giá trị lấy từ danh mục trong Cài đặt. */
  readonly type?: AssetType;
  /** Thông số kỹ thuật dạng cặp khoá–giá trị. */
  readonly specs?: Record<string, unknown>;
  readonly taskTemplate?: readonly AssetTaskItem[];
  /** Bỏ trống một trường nghĩa là giữ nguyên, không phải xoá trắng. */
  readonly name?: string;
  readonly parentCode?: string | null;
  readonly status?: AssetStatus;
  readonly criticality?: AssetCriticality;
  readonly internalCode?: string;
  readonly serialNumber?: string;
  readonly qrCode?: string;
  readonly orgUnitId?: string;
  readonly unit?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
  readonly warrantyUntil?: string;
  /** Năm sản xuất. Chỉ năm — người dùng thường không biết ngày chính xác. */
  readonly manufactureYear?: number;
  /** Mua của ai. */
  readonly supplier?: string;
  /** Ai làm ra nó. Khác nhà cung cấp: một đại lý bán hàng của nhiều hãng. */
  readonly manufacturer?: string;
  /** Đang ở đâu — giá trị lấy từ danh mục trong Cài đặt. */
  readonly usageState?: string;
}

export interface CreateAssetRequest {
  readonly code: string;
  readonly name: string;
  readonly type: AssetType;
  /** Mã thiết bị cha; bỏ trống là node gốc. */
  readonly parentCode?: string;
  readonly status?: AssetStatus;
  readonly criticality?: AssetCriticality;
  readonly internalCode?: string;
  readonly serialNumber?: string;
  readonly qrCode?: string;
  readonly orgUnitId?: string;
  readonly specs?: Record<string, unknown>;
  readonly taskTemplate?: readonly AssetTaskItem[];
  /** Đơn vị tính của thiết bị, ví dụ "Cái", "Bộ". */
  readonly unit?: string;
  /** Giá mua. Bỏ trống nghĩa là chưa khai báo, khác hẳn với 0. */
  readonly purchasePrice?: number;
  /** Mã tiền tệ của `purchasePrice`, ví dụ VND, USD. */
  readonly currency?: string;
  /** Ngày hết hạn bảo hành, dạng YYYY-MM-DD. */
  readonly warrantyUntil?: string;
  /** Năm sản xuất. Chỉ năm — người dùng thường không biết ngày chính xác. */
  readonly manufactureYear?: number;
  /** Mua của ai. */
  readonly supplier?: string;
  /** Ai làm ra nó. Khác nhà cung cấp: một đại lý bán hàng của nhiều hãng. */
  readonly manufacturer?: string;
}

export interface CreateMaterialRequest {
  readonly code: string;
  readonly name: string;
  readonly category: MaterialCategory;
  readonly unit: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly isSerialized?: boolean;
  readonly barcode?: string;
  /** Số sê-ri của vật tư cá thể; tuỳ chọn. */
  readonly serialNumber?: string;
  readonly manufactureYear?: number;
  readonly supplier?: string;
  readonly manufacturer?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
}

export interface UpdateMaterialRequest {
  /** Loại vật tư, giá trị lấy từ danh mục trong Cài đặt. */
  readonly type?: AssetType;
  /** Tình trạng và vị trí sử dụng — cùng hai cột với vật tư đã lắp. */
  readonly status?: AssetStatus;
  readonly usageState?: string;
  /** Bật theo dõi theo cá thể. Khai sê-ri lần đầu tự bật cờ này. */
  readonly isSerialized?: boolean;
  readonly name?: string;
  readonly category?: MaterialCategory;
  readonly unit?: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly barcode?: string;
  readonly serialNumber?: string;
  readonly manufactureYear?: number;
  readonly supplier?: string;
  readonly manufacturer?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
  readonly isActive?: boolean;
}

/**
 * Kết quả của một lệnh ngừng hoạt động.
 *
 * Sổ cái kho là append-only: xoá cứng một vật tư đã phát sinh giao dịch sẽ làm
 * mồ côi lịch sử tồn, và xoá thiết bị đang có con sẽ làm đứt cây. Nên mặc định
 * là *ngừng hoạt động* (`isActive=false` / `status='DISPOSED'`), chỉ xoá hẳn khi
 * bản ghi chưa từng được dùng.
 */
/**
 * Kết quả ngừng dùng một mã.
 *
 * KHÔNG có chế độ xoá. Hàng đã vào sổ kho thì chỉ nhập hoặc xuất, không bao giờ
 * biến mất: một mã bị xoá sẽ làm mồ côi mọi bút toán trỏ vào nó, và số liệu tồn
 * của những kỳ đã chốt không còn đối chiếu được. Ngừng dùng chỉ ẩn mã khỏi các
 * ô chọn, lịch sử giữ nguyên.
 */
export interface RetireResult {
  readonly code: string;
  readonly mode: 'deactivated';
  readonly reason?: string;
}

/**
 * Thanh lý một vật tư khỏi cây lắp đặt: tháo ra và NHẬP về một kho cụ thể.
 *
 * Bắt buộc chọn kho. Trước đây thao tác này chỉ lật cờ trong danh mục mà không
 * ghi bút toán nào, nên vật tư "về kho" mà không kho nào tăng tồn — sổ sách và
 * hiện vật lệch nhau ngay từ lúc đó.
 */
/**
 * Một dòng vật tư ĐANG LẮP trên một thiết bị.
 *
 * Không phải một bản ghi riêng mà là số dư suy ra từ sổ cái: mọi lần lắp là một
 * bút toán xuất có tham chiếu tới thiết bị, mọi lần tháo là một bút toán nhập
 * cùng tham chiếu đó. Cộng lại ra số đang nằm trên thiết bị.
 *
 * Làm vậy để không phải bịa thêm một nguồn sự thật thứ hai cạnh sổ cái — thứ
 * chắc chắn sẽ lệch khỏi sổ ở lần đầu có ai đó ghi vào một nơi mà quên nơi kia.
 */
export interface InstalledMaterial {
  /** Dòng vật tư đại diện cho lần lắp này — cũng là một node của cây. */
  readonly unitId: string;
  readonly unitCode: string;
  /** Mã gốc trong kho mà đơn vị này lấy ra. */
  readonly materialCode: string;
  readonly materialName: string;
  readonly quantity: number;
  readonly unit?: string;
}

/**
 * Lắp vật tư từ kho vào một thiết bị.
 *
 * Đây là một lệnh XUẤT: hàng rời khỏi kho ra hiện trường. Mã vật tư ở lại danh
 * mục kho với phần tồn còn lại — lắp 1 mét cáp thì kho còn 2999 mét, vì mét là
 * đơn vị tính chứ không phải một khối cố định.
 */
export interface InstallItemRequest {
  readonly parentCode: string;
  readonly warehouseCode: string;
  /** Mặc định 1. */
  readonly quantity?: number;
  readonly note?: string;
}

/** Tháo bớt một đơn vị đang lắp, nhập ngược về kho. */
export interface UninstallMaterialRequest {
  readonly warehouseCode: string;
  readonly quantity?: number;
  readonly note?: string;
}

export interface ReturnItemToStockRequest {
  readonly warehouseCode: string;
  /** Mặc định 1: thiết bị tháo ra là một cá thể. */
  readonly quantity?: number;
  readonly note?: string;
}

/**
 * Một dòng trong danh mục HỢP NHẤT: vật tư kho và thiết bị nằm chung một chỗ.
 *
 * Từ lượt gộp dữ liệu 0006, cả hai đã là cùng một bảng — chỉ khác `kind`. Tách
 * làm hai danh sách trên giao diện là di sản của mô hình cũ, và nó khiến câu hỏi
 * thường gặp nhất ("cái máy này là vật tư gì, còn bao nhiêu, đang lắp ở đâu")
 * phải tra hai màn hình.
 */
export interface InventoryItem {
  readonly code: string;
  readonly name: string;
  /** STOCK = vật tư luân chuyển; ASSET = thiết bị có hồ sơ kỹ thuật. */
  readonly kind: 'STOCK' | 'ASSET';
  readonly unit?: string;
  readonly category?: MaterialCategory;
  readonly type?: AssetType;
  readonly status?: AssetStatus;
  /** Đang ở đâu — giá trị lấy từ danh mục trong Cài đặt. */
  readonly usageState?: string;
  /** Tồn khả dụng gộp mọi kho. Thiết bị lắp đặt thường bằng 0. */
  readonly available: number;
  /**
   * Thiết bị/vật tư này đang gắn vào đâu — cha trực tiếp trong cây thiết bị.
   *
   * Ví dụ "Máy biến áp lực T1" gắn vào "Trạm biến áp 110kV Savina".
   */
  readonly installedAtCode?: string;
  readonly installedAtName?: string;
  /** Gốc của nhánh — trạm/nhà máy chứa nó, để lọc theo vị trí lớn. */
  readonly rootCode?: string;
  readonly rootName?: string;
}

export interface Asset {
  readonly id: string;
  readonly code: string;
  readonly internalCode?: string;
  readonly name: string;
  readonly parentId?: string;
  readonly type: AssetType;
  readonly orgUnitId?: string;
  readonly serialNumber?: string;
  readonly status: AssetStatus;
  readonly criticality: AssetCriticality;
  readonly specs?: Record<string, unknown>;
  /** Đầu việc bảo trì mặc định; Procedure đóng băng danh sách này khi công bố vai trò E. */
  readonly taskTemplate: readonly AssetTaskItem[];
  readonly qrCode?: string;
  readonly unit?: string;
  readonly purchasePrice?: number;
  readonly currency?: string;
  readonly warrantyUntil?: string;
  /** Năm sản xuất. Chỉ năm — người dùng thường không biết ngày chính xác. */
  readonly manufactureYear?: number;
  /** Mua của ai. */
  readonly supplier?: string;
  /** Ai làm ra nó. Khác nhà cung cấp: một đại lý bán hàng của nhiều hãng. */
  readonly manufacturer?: string;
  /** Đang ở đâu — giá trị lấy từ danh mục trong Cài đặt. */
  readonly usageState?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Một dòng phụ tùng của thiết bị, đã kèm sẵn thông tin vật tư.
 *
 * Trả kèm mã/tên/đơn vị thay vì chỉ `materialId`: màn hình nào cũng cần ba
 * trường đó, để client tự tra thì mỗi dòng là một lượt gọi thêm.
 */
export interface AssetBomLine {
  readonly id: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly standardQuantity: number;
  readonly isCriticalSpare: boolean;
  readonly note?: string;
}

export interface AddAssetBomRequest {
  readonly materialCode: string;
  readonly standardQuantity: number;
  readonly isCriticalSpare?: boolean;
  readonly note?: string;
}

export interface AssetBom {
  readonly id: string;
  readonly assetId: string;
  readonly materialId: string;
  readonly standardQuantity: number;
  readonly isCriticalSpare: boolean;
  readonly note?: string;
}

export interface AssetStatusLog {
  readonly id: string;
  readonly assetId: string;
  readonly fromStatus: AssetStatus;
  readonly toStatus: AssetStatus;
  readonly reason?: string;
  readonly workOrderId?: string;
  readonly changedBy: string;
  readonly createdAt: string;
}

export interface AssetInstallation {
  readonly id: string;
  readonly assetId: string;
  readonly materialId: string;
  readonly serialNumber?: string;
  readonly action: 'INSTALL' | 'REMOVE' | 'REPLACE';
  readonly workOrderId?: string;
  readonly technicianId: string;
  readonly note?: string;
  readonly installedAt: string;
}

// ============================================================================
// WAREHOUSE & MATERIALS
// ============================================================================

export type WarehouseType = 'PHYSICAL' | 'VIRTUAL_IN_TRANSIT';
export type MaterialCategory = 'SPARE_PART' | 'CONSUMABLE' | 'TOOL' | 'ROTABLE';
/**
 * Tình trạng và "đang ở đâu" của một cá thể — CHUỖI TỰ DO, không phải union.
 *
 * Trước đây là hai union khớp đúng CHECK của database. Migration 0009 gỡ hai
 * CHECK đó để admin tenant tự khai danh mục, nên giữ union ở đây sẽ chặn lại
 * đúng thứ vừa mở ra: TypeScript từ chối "Mượn thí nghiệm" trong khi database
 * đã nhận.
 *
 * Danh mục hợp lệ nằm trong `InventoryCatalogSettings` — cùng một danh sách với
 * vật tư không có sê-ri, để hai bên không nói hai thứ tiếng.
 */
export type SerialStatus = string;
export type LocationType = string;

export interface Warehouse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: WarehouseType;
  readonly orgUnitId?: string;
  readonly managerUserId?: string;
  readonly location?: string;
  readonly isActive: boolean;
}

/** Khai một kho mới. Mã là khoá nghiệp vụ nên không sửa được sau khi tạo. */
export interface CreateWarehouseRequest {
  readonly code: string;
  readonly name: string;
  readonly type?: WarehouseType;
  readonly location?: string;
}

/**
 * Sửa một kho. KHÔNG có đường xoá — hàng đã vào sổ thì kho phải còn để mọi bút
 * toán trỏ vào nó vẫn đọc được. Ngừng dùng bằng `isActive: false`.
 */
export interface UpdateWarehouseRequest {
  readonly name?: string;
  readonly type?: WarehouseType;
  readonly location?: string;
  readonly isActive?: boolean;
}

export interface WarehouseLocation {
  readonly id: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly qrCode?: string;
}

export interface Material {
  readonly type?: AssetType;
  readonly status?: AssetStatus;
  readonly usageState?: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: MaterialCategory;
  readonly unit: string;
  readonly minStock: number;
  readonly maxStock: number;
  readonly isSerialized: boolean;
  readonly barcode?: string;
  /**
   * Số sê-ri của chính mã vật tư này. TUỲ CHỌN.
   *
   * Khác `isSerialized`: cờ đó nói "mỗi đơn vị tồn có sê-ri riêng, theo dõi ở
   * bảng `serial_tracking`". Trường này là sê-ri của một vật tư cá thể — máy
   * biến áp T1 chỉ có đúng một cái, sê-ri nằm ngay trên nó chứ không cần bảng
   * theo dõi riêng.
   */
  readonly serialNumber?: string;
  /** Năm sản xuất. Chỉ năm — người dùng thường không biết ngày chính xác. */
  readonly manufactureYear?: number;
  /** Mua của ai. */
  readonly supplier?: string;
  /** Ai làm ra nó. Khác nhà cung cấp: một đại lý bán hàng của nhiều hãng. */
  readonly manufacturer?: string;
  /** Giá nhập. Bỏ trống nghĩa là chưa khai, khác hẳn 0. */
  readonly purchasePrice?: number;
  readonly currency?: string;
  readonly isActive: boolean;
}

export interface SerialTracking {
  readonly id: string;
  readonly materialId: string;
  /** Mã vật tư gốc — kèm sẵn để màn hình khỏi phải tra ngược. */
  readonly materialCode?: string;
  readonly serialNumber: string;
  readonly internalCode?: string;
  readonly currentStatus: SerialStatus;
  readonly locationType: LocationType;
  readonly currentWarehouseId?: string;
  readonly currentAssetId?: string;
  readonly createdAt: string;
}

/**
 * Khai sê-ri cho một mã vật tư.
 *
 * Thời điểm duy nhất người ta cầm hiện vật trong tay và đọc được sê-ri là lúc
 * nhập kho, nên đây là chỗ khai. Bỏ qua lúc đó thì sau phải ra tận hiện trường.
 */
export interface RegisterSerialsRequest {
  readonly materialCode: string;
  readonly warehouseCode?: string;
  readonly serialNumbers: readonly string[];
  /** Tình trạng ban đầu, mặc định lấy giá trị đầu trong danh mục. */
  readonly currentStatus?: string;
  readonly locationType?: string;
}

/** Sửa tình trạng / vị trí sử dụng của MỘT cá thể. */
export interface UpdateSerialRequest {
  readonly currentStatus?: string;
  readonly locationType?: string;
  readonly internalCode?: string;
}

// ============================================================================
// INVENTORY LEDGER & TRANSACTIONS
// ============================================================================

export type TransactionType = 'IMPORT' | 'EXPORT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'BORROW' | 'RETURN' | 'ADJUST';
export type WorkflowStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface MaterialInventory {
  readonly id: string;
  readonly warehouseId: string;
  readonly locationId?: string;
  readonly materialId: string;
  readonly quantity: number;
  readonly quantityReserved: number;
  readonly available: number; // quantity - quantityReserved (generated)
  readonly updatedAt: string;
}

export interface InventoryTransaction {
  readonly id: string;
  readonly transactionCode: string;
  readonly warehouseId: string;
  readonly locationId?: string;
  readonly materialId: string;
  readonly serialNumber?: string;
  readonly type: TransactionType;
  readonly quantity: number; // + or -
  readonly unitCost: number;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly workflowStatus: WorkflowStatus;
  readonly note?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export type ReservationStatus = 'PENDING' | 'RESERVED' | 'PARTIALLY_ISSUED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface Reservation {
  readonly id: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId?: string;
  readonly status: ReservationStatus;
  readonly expiresAt?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly items?: ReservationItem[];
}

export interface ReservationItem {
  readonly id: string;
  readonly reservationId: string;
  readonly warehouseId: string;
  readonly materialId: string;
  readonly quantityReserved: number;
  readonly quantityIssued: number;
}

export interface InventoryAdjustment {
  readonly id: string;
  readonly warehouseId: string;
  readonly materialId: string;
  readonly systemQuantity: number;
  readonly actualQuantity: number;
  readonly difference: number; // actualQuantity - systemQuantity (generated)
  readonly reason: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly approvedBy?: string;
  readonly createdAt: string;
}

// ============================================================================
// API REQUESTS/RESPONSES
// ============================================================================

export interface CreateStockReservationRequest {
  readonly warehouseCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly expiresAt?: string;
  readonly notes?: string;
  readonly items: Array<{
    readonly materialCode: string;
    readonly quantityReserved: number;
  }>;
}

export interface ResolveAssetTaskTemplateRequest {
  readonly assetCode: string;
}

export interface ResolveAssetTaskTemplateResponse {
  readonly taskTemplate: Record<string, unknown>[];
}

export interface ResolveMaterialTaskTemplateRequest {
  readonly materialCode: string;
  readonly assetCode?: string;
}

export interface ResolveMaterialTaskTemplateResponse {
  readonly taskTemplate: Record<string, unknown>[];
}

// ============================================================================
// EVENTS
// ============================================================================

export interface InventoryStockReservationCreatedPayload {
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly materialCode: string;
  readonly quantityReserved: number;
}

export interface InventoryStockIssuedPayload {
  readonly transactionCode: string;
  readonly materialCode: string;
  readonly quantityIssued: number;
  readonly warehouseCode: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
}

export interface InventoryStockTransferredPayload {
  readonly transactionCode: string;
  readonly materialCode: string;
  readonly quantity: number;
  readonly fromWarehouse: string;
  readonly toWarehouse: string;
}

// ---------------------------------------------------------------- Cấu hình module

/**
 * Khoá cấu hình của module Kho.
 *
 * Union đóng, cố ý: bảng lưu là khoá–giá trị nên đây là lớp chặn duy nhất giữ
 * cho nó không trôi thành kho dữ liệu tự do. Thêm tính năng cấu hình mới = thêm
 * một khoá ở đây, không phát sinh bảng.
 */
export const INVENTORY_SETTINGS_KEYS = [
  'dashboard.cards',
  'catalog.material',
  'catalog.asset',
  'catalog.unit',
] as const;

export type InventorySettingsKey = (typeof INVENTORY_SETTINGS_KEYS)[number];

/** Danh sách id thẻ dashboard admin đã chọn. Thứ tự trong mảng là thứ tự hiển thị. */
export interface DashboardCardSelection {
  readonly cardIds: readonly string[];
}

/** Những trường tuỳ chọn mà form vật tư/thiết bị được phép hiện. */
export interface InventoryCatalogSettings {
  readonly enabledAttributes: readonly string[];
  readonly enabledStatuses: readonly string[];
  /**
   * Danh mục "đang ở đâu": vận hành, mượn thí nghiệm, gửi đi sửa…
   *
   * Câu hỏi ĐỘC LẬP với tình trạng. Một máy biến áp có thể vừa còn tốt vừa đang
   * cho mượn — gộp hai vế vào một cột thì chọn vế này là mất vế kia.
   *
   * Rỗng nghĩa là tenant chưa khai, và khi đó ô chọn không hiện. Không có giá
   * trị dựng sẵn: mỗi đơn vị gọi tên các trạng thái này một khác.
   */
  readonly usageStates: readonly string[];
  /**
   * Danh mục "Loại vật tư".
   *
   * Rỗng thì cột Loại để trống và ô chọn không có gì — không bịa giá trị dựng
   * sẵn, vì mỗi đơn vị phân loại theo một trục khác nhau.
   */
  readonly types: readonly string[];
  readonly priceFieldsEnabled: boolean;
  readonly warrantyFieldsEnabled: boolean;
}

/**
 * Danh mục đơn vị tính.
 *
 * Trước đây đơn vị là ô nhập tự do, nên cùng một thứ vào kho dưới ba cái tên
 * ("Cái", "cái", "chiếc") và không cộng gộp được. Cho chọn từ danh mục thì mọi
 * dòng nói cùng một ngôn ngữ; admin tự thêm/xoá nên không phải chờ bản mới.
 */
export interface InventoryUnitCatalog {
  readonly units: readonly string[];
}

export interface InventorySettings {
  readonly 'dashboard.cards': DashboardCardSelection;
  readonly 'catalog.material': InventoryCatalogSettings;
  readonly 'catalog.asset': InventoryCatalogSettings;
  readonly 'catalog.unit': InventoryUnitCatalog;
}

export interface SettingsEntry<TValue> {
  readonly key: string;
  readonly value: TValue;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Đọc cả module: mọi khoá đều có mặt, khoá thiếu dòng được điền giá trị mặc định. */
export type InventorySettingsSnapshot = {
  readonly [K in InventorySettingsKey]: SettingsEntry<InventorySettings[K]>;
};

export interface UpdateSettingsRequest<TValue> {
  readonly value: TValue;
  /** Version đã đọc; lệch thì trả 409. Bỏ trống là ghi đè bất chấp. */
  readonly expectedVersion?: number;
}

// ------------------------------------------------- Tài liệu đính kèm thiết bị

/**
 * Đuôi tệp được phép và content-type tương ứng.
 *
 * Kiểm cả hai chiều: đuôi phải nằm trong danh sách, và content-type client khai
 * phải khớp đúng đuôi đó. Chỉ kiểm một chiều thì đổi tên `a.exe` thành `a.pdf`
 * là qua được.
 */
export const ASSET_DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
};

export const ASSET_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

export interface AssetDocument {
  readonly id: string;
  readonly assetCode: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly note?: string;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

export interface CreateAssetDocumentRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly note?: string;
}

/**
 * Tệp đi thẳng từ trình duyệt lên object storage bằng `uploadUrl`; server không
 * làm trung gian truyền dữ liệu.
 */
export interface CreateAssetDocumentResponse {
  readonly document: AssetDocument;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}
