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
  /** Hàng hoá (mặc định) hoặc dịch vụ. Dịch vụ không quản lý tồn (D6). */
  readonly kind?: MaterialKind;
  /** Số tháng bảo hành mặc định khi bán; bỏ trống là chưa khai. */
  readonly warrantyMonths?: number | null;
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
  /**
   * Đổi giữa hàng hoá và dịch vụ. Chỉ đổi được khi mã chưa có bút toán, dòng tồn
   * hay serial nào.
   */
  readonly kind?: MaterialKind;
  /** `null` xoá số tháng bảo hành đã khai. */
  readonly warrantyMonths?: number | null;
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
  /** Mã thiết bị cha. Bỏ trống nếu lắp làm Cụm/Thiết bị gốc trên cây (Root Asset). */
  readonly parentCode?: string;
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
 * Loại mặt hàng trong danh mục vật tư. SERVICE (dịch vụ, phần mềm) có trong danh
 * mục để Bán hàng chọn nhưng không có dòng tồn; chứng từ kho và giữ hàng từ chối
 * (D6). Thiết bị (`ASSET`) đi đường riêng, không nằm trong union này.
 */
export const MATERIAL_KINDS = ['STOCK', 'SERVICE'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
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
  /** Organization node resolved by Platform Core before calling Inventory. */
  readonly orgUnitId?: string;
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
  /** Hàng hoá hoặc dịch vụ (không quản lý tồn). */
  readonly kind: MaterialKind;
  /** Số tháng bảo hành mặc định; không có là chưa khai. */
  readonly warrantyMonths?: number;
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
  readonly qualityStatus?: QualityStatus;
  readonly stockState?: SerialStockState;
  readonly createdAt: string;
}

// ---------------------------------------------------------------- Chất lượng, lô, serial

/**
 * Trạng thái chất lượng của lô và serial (INV-06). Chỉ hàng Đạt mới tính vào tồn
 * khả dụng; ba trạng thái còn lại cộng vào `quantityBlocked` của tồn.
 */
export const QUALITY_STATUSES = ['PASSED', 'QUARANTINE', 'DEFECTIVE', 'PENDING_INSPECTION'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/**
 * Serial nằm ở đâu theo sổ kho: Trong kho, Đã xuất, Đang chuyển, Đã huỷ. Khác
 * `currentStatus` (trạng thái sử dụng do admin tenant khai). Không có giá trị là
 * serial khai ở danh mục chưa vào sổ kho.
 */
export type SerialStockState = 'IN_STOCK' | 'ISSUED' | 'IN_TRANSIT' | 'SCRAPPED';

export type SerialMovementType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER'
  | 'RETURN'
  | 'WARRANTY_ISSUE'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'QUALITY_CHANGE';

/** Tồn của một lô tại một kho. `available` = số lượng − đã giữ − không Đạt. */
export interface LotBalance {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName?: string;
  readonly quantity: number;
  readonly quantityReserved: number;
  readonly quantityBlocked: number;
  readonly available: number;
}

/** Lô của một mặt hàng, lưu ở server (INV-04). Số lô duy nhất trong mặt hàng. */
export interface Lot {
  readonly id: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly lotNo: string;
  /** YYYY-MM-DD. */
  readonly manufacturedOn?: string;
  /** YYYY-MM-DD; dùng được đến hết ngày này. */
  readonly expiresOn?: string;
  readonly qualityStatus: QualityStatus;
  readonly supplier?: string;
  readonly certificateNo?: string;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Tổng số lượng mọi kho. */
  readonly quantity: number;
  readonly balances: readonly LotBalance[];
}

export interface LotQualityEvent {
  readonly id: string;
  readonly fromStatus: QualityStatus;
  readonly toStatus: QualityStatus;
  readonly reason: string;
  readonly actorId: string;
  readonly occurredAt: string;
}

export interface LotDetail extends Lot {
  readonly qualityEvents: readonly LotQualityEvent[];
}

/** Một lô trong gợi ý xuất FEFO: hạn dùng gần nhất trước. */
export interface LotSuggestionLine {
  readonly lotId: string;
  readonly lotNo: string;
  readonly expiresOn?: string;
  readonly manufacturedOn?: string;
  readonly available: number;
  /** Số nên lấy từ lô này để đủ số yêu cầu. */
  readonly quantity: number;
}

export interface LotSuggestion {
  readonly materialCode: string;
  readonly warehouseCode: string;
  readonly requested: number;
  /** Tổng các dòng gợi ý; nhỏ hơn `requested` khi các lô dùng được không đủ. */
  readonly allocated: number;
  readonly shortage: number;
  readonly lines: readonly LotSuggestionLine[];
}

export interface ChangeQualityRequest {
  readonly qualityStatus: QualityStatus;
  /** Bắt buộc: lý do đổi trạng thái, ghi vào lịch sử. */
  readonly reason: string;
  /** Chỉ dùng cho serial: mã vật tư khi cùng số serial có ở nhiều mặt hàng. */
  readonly materialCode?: string;
}

export interface SerialMovement {
  readonly id: string;
  readonly movementType: SerialMovementType;
  readonly fromWarehouseCode?: string;
  readonly toWarehouseCode?: string;
  readonly documentId?: string;
  readonly documentCode?: string;
  readonly docType?: StockDocumentType;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly stockState?: SerialStockState;
  readonly qualityStatus: QualityStatus;
  readonly previousQualityStatus?: QualityStatus;
  readonly reason?: string;
  readonly occurredAt: string;
  readonly actorId: string;
}

/** Lần xuất gần nhất của serial: chứng từ xuất và chứng từ nguồn (đơn bán, bảo hành). */
export interface SerialLastIssue {
  readonly documentId: string;
  readonly documentCode: string;
  readonly docType: StockDocumentType;
  readonly warehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly issuedAt: string;
}

/** Tra cứu một serial: mặt hàng, kho, trạng thái, lần xuất gần nhất và toàn bộ lịch sử. */
export interface SerialHistory {
  readonly id: string;
  readonly serialNumber: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly warehouseCode?: string;
  readonly stockState?: SerialStockState;
  readonly currentStatus: SerialStatus;
  readonly qualityStatus: QualityStatus;
  readonly lastIssue?: SerialLastIssue;
  /** Bằng `lastIssue.issuedAt`; tiện cho bên tính hạn bảo hành. */
  readonly issuedAt?: string;
  readonly movements: readonly SerialMovement[];
}

/** Thông tin lô trên dòng nhập: tạo lô mới hoặc cộng vào lô đã có cùng số lô. */
export interface StockDocumentLotInput {
  readonly lotNo: string;
  readonly manufacturedOn?: string;
  readonly expiresOn?: string;
  readonly supplier?: string;
  readonly certificateNo?: string;
}

/** Một phần số lượng xuất hoặc chuyển lấy từ một lô (đường API cũ `issues`, `transfers`). */
export interface LotAllocationInput {
  readonly lotNo: string;
  readonly quantity: number;
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
  /** Phần tồn không Đạt (lô, serial Cách ly, Lỗi, Chờ kiểm định). */
  readonly quantityBlocked: number;
  readonly available: number; // quantity - quantityReserved - quantityBlocked (generated)
  /** Giá vốn bình quân gia quyền của dòng tồn (kho, vật tư), 4 chữ số thập phân. */
  readonly avgCost?: number;
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
  /** Chứng từ kho sinh ra bút toán; bút toán trước migration 0011 không có. */
  readonly documentId?: string;
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
  /** Chứng từ nguồn (đơn bán, hợp đồng...). Giữ hàng tạo trước migration 0012 không có. */
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
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

/**
 * Giữ hàng một hoặc nhiều dòng, tất cả hoặc không (Q4): thiếu một dòng thì không
 * dòng nào được giữ, trả 409 `RESERVATION_INSUFFICIENT_STOCK` kèm `shortages`.
 *
 * Kho đặt ở đầu phiếu, hoặc riêng từng dòng (`items[].warehouseCode`) khi giữ ở
 * nhiều kho. Bên gọi mới (Bán hàng) dùng `sourceType`, `sourceId`; bên gọi cũ dùng
 * `referenceType`, `referenceId` — thiếu một cặp thì lấy theo cặp kia.
 */
export interface CreateStockReservationRequest {
  readonly warehouseCode?: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  /**
   * Gọi lại cùng khoá và cùng nội dung trả lại giữ hàng đã tạo, không giữ thêm;
   * cùng khoá mà khác nội dung trả 409 `IDEMPOTENCY_KEY_CONFLICT`.
   */
  readonly idempotencyKey?: string;
  /** ISO 8601, phải sau thời điểm gọi. Bỏ trống thì không tự hết hạn. */
  readonly expiresAt?: string;
  readonly notes?: string;
  readonly items: Array<{
    readonly materialCode: string;
    readonly quantityReserved: number;
    readonly warehouseCode?: string;
  }>;
}

/** Một dòng thiếu tồn khi giữ hàng, trả trong lỗi 409 `RESERVATION_INSUFFICIENT_STOCK`. */
export interface ReservationShortage {
  readonly materialId?: string;
  readonly materialCode: string;
  readonly warehouseId?: string;
  readonly warehouseCode: string;
  readonly requested: number;
  readonly available: number;
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

export const INVENTORY_RESERVATION_CREATED_EVENT = 'inventory.reservation.created';
export const INVENTORY_RESERVATION_RELEASED_EVENT = 'inventory.reservation.released';
export const INVENTORY_RESERVATION_EXPIRED_EVENT = 'inventory.reservation.expired';

export const INVENTORY_RESERVATION_EVENT_TYPES = [
  INVENTORY_RESERVATION_CREATED_EVENT,
  INVENTORY_RESERVATION_RELEASED_EVENT,
  INVENTORY_RESERVATION_EXPIRED_EVENT,
] as const;

export type InventoryReservationEventType = (typeof INVENTORY_RESERVATION_EVENT_TYPES)[number];

/** Một dòng trong sự kiện giữ hàng: số đã giữ lúc tạo, hoặc số vừa nhả khi nhả, hết hạn. */
export interface InventoryReservationEventLine {
  readonly materialId: string;
  readonly materialCode: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly quantity: number;
}

/**
 * Payload chung của `inventory.reservation.*`. Trường `referenceType`,
 * `referenceId`, `materialCode`, `quantityReserved` có từ trước (chưa ai phát);
 * giữ lại để không bỏ trường, với giữ hàng nhiều dòng thì `materialCode` và
 * `quantityReserved` lấy theo dòng đầu.
 */
export interface InventoryStockReservationCreatedPayload {
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  /** Giữ hàng không gắn đối tượng thì null. */
  readonly referenceId: string | null;
  readonly materialCode: string;
  readonly quantityReserved: number;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly expiresAt: string | null;
  readonly lines: readonly InventoryReservationEventLine[];
  /** Null khi hệ thống tự làm. */
  readonly actorUserId: string | null;
}

/** `inventory.reservation.released` và `.expired`: phần chưa xuất vừa được trả về khả dụng. */
export interface InventoryReservationReleasedPayload {
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId: string | null;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly status: 'CANCELLED' | 'EXPIRED';
  readonly releasedLines: readonly InventoryReservationEventLine[];
  readonly releasedQuantity: number;
  /** Null khi hệ thống tự làm (job hết hạn). */
  readonly actorUserId: string | null;
}

export type InventoryReservationExpiredPayload = InventoryReservationReleasedPayload;

export const INVENTORY_STOCK_ISSUED_EVENT = 'inventory.stock.issued';
export const INVENTORY_STOCK_RETURNED_EVENT = 'inventory.stock.returned';

export const INVENTORY_STOCK_EVENT_TYPES = [
  INVENTORY_STOCK_ISSUED_EVENT,
  INVENTORY_STOCK_RETURNED_EVENT,
] as const;

export type InventoryStockEventType = (typeof INVENTORY_STOCK_EVENT_TYPES)[number];

/** Một dòng đã ghi sổ trong sự kiện xuất kho, nhập trả. */
export interface InventoryStockEventLine {
  readonly lineId: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  /** IN cộng tồn, OUT trừ tồn; chứng từ đảo có chiều ngược với chứng từ gốc. */
  readonly direction: StockDocumentLineDirection;
  readonly quantity: number;
  /** Giá vốn đơn vị lúc ghi sổ (4 chữ số thập phân). */
  readonly unitCost: number;
  /** `quantity × unitCost`, làm tròn 2 chữ số. */
  readonly costAmount: number;
  readonly lotId: string | null;
  readonly lotNo: string | null;
  readonly serials: readonly string[];
  readonly reservationId: string | null;
  /** Dòng xuất gốc của dòng nhập trả, nếu có. */
  readonly sourceLineId: string | null;
}

/**
 * `inventory.stock.issued`: chứng từ xuất (ISSUE_*) vừa ghi sổ, trong cùng
 * transaction với ghi sổ (T1-27). Bên nghe chống trùng theo `documentId`.
 *
 * Chứng từ đảo của chứng từ xuất cũng phát sự kiện này với `reversesDocumentId`
 * khác null và dòng chiều IN: bên nghe hiểu là huỷ tác dụng của chứng từ gốc,
 * không phải một lần giao thêm.
 *
 * `transactionCode`, `materialCode`, `quantityIssued`, `warehouseCode`,
 * `referenceType`, `referenceId` có từ trước (chưa ai phát); giữ để không bỏ
 * trường, lấy theo dòng đầu và nguồn của chứng từ.
 */
export interface InventoryStockIssuedPayload {
  readonly transactionCode: string;
  readonly materialCode: string;
  readonly quantityIssued: number;
  readonly warehouseCode: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly documentId: string;
  readonly documentCode: string;
  readonly docType: StockDocumentType;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly warehouseId: string;
  readonly reversesDocumentId: string | null;
  readonly postedAt: string;
  readonly lines: readonly InventoryStockEventLine[];
  readonly totalCostAmount: number;
  /** Null khi hệ thống tự làm. */
  readonly actorUserId: string | null;
}

/**
 * `inventory.stock.returned`: chứng từ nhập trả hàng bán (RECEIPT_SALES_RETURN)
 * vừa ghi sổ. `qualityStatus` là trạng thái chất lượng hàng nhận về (Chờ kiểm
 * định với nhập trả qua API nội bộ).
 */
export interface InventoryStockReturnedPayload extends InventoryStockIssuedPayload {
  readonly qualityStatus: QualityStatus;
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
  'documents.approval',
  'costing.method',
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

/**
 * Quy tắc duyệt chứng từ kho (nhập khác, xuất khác, điều chỉnh).
 *
 * Mặc định người lập không tự duyệt được chứng từ của mình, giống
 * `allow_self_approval` của Tài chính.
 */
export interface InventoryDocumentApprovalSettings {
  readonly allowSelfApproval: boolean;
}

/**
 * Phương pháp tính giá xuất kho. Union đóng; hiện chỉ có bình quân gia quyền tức
 * thời (D4). FIFO làm ở P2.
 */
export const COSTING_METHODS = ['MOVING_AVERAGE'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

export interface InventoryCostingSettings {
  readonly method: CostingMethod;
}

export interface InventorySettings {
  readonly 'dashboard.cards': DashboardCardSelection;
  readonly 'catalog.material': InventoryCatalogSettings;
  readonly 'catalog.asset': InventoryCatalogSettings;
  readonly 'catalog.unit': InventoryUnitCatalog;
  readonly 'documents.approval': InventoryDocumentApprovalSettings;
  readonly 'costing.method': InventoryCostingSettings;
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

// ============================================================================
// STOCKTAKE (KIỂM KÊ KHO)
// ============================================================================

export type StocktakeStatus =
  | 'DRAFT'
  | 'COUNTING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTED'
  | 'CANCELLED';

export type StocktakeScopeType = 'ALL' | 'CATEGORY' | 'SPECIFIC_ITEMS';

export interface StocktakeLotAllocation {
  readonly lotNumber: string;
  readonly systemQty: number;
  readonly actualQty: number;
  readonly expiryDate?: string;
}

export interface StocktakeSerialAllocation {
  readonly serialNumber: string;
  readonly status: 'FOUND' | 'MISSING' | 'EXTRA';
}

export interface StocktakeLineAudit {
  readonly id: string;
  readonly lineId: string;
  readonly previousQuantity?: number;
  readonly newQuantity: number;
  readonly operator: string;
  readonly timestamp: string;
  readonly reason?: string;
}

export interface StocktakeLine {
  readonly id: string;
  readonly sessionId: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly binLocation?: string;
  readonly isSerialized?: boolean;
  readonly isLotTracked?: boolean;
  readonly systemQuantity: number;
  readonly countRound1?: number;
  readonly countRound2?: number;
  readonly actualQuantity?: number;
  readonly difference: number; // actualQuantity - systemQuantity
  readonly unitCost?: number;
  readonly differenceValue?: number;
  readonly reason?: string;
  readonly status: 'UNCOUNTED' | 'MATCHED' | 'SURPLUS' | 'DEFICIT';
  readonly lotAllocations?: readonly StocktakeLotAllocation[];
  readonly serialAllocations?: readonly StocktakeSerialAllocation[];
  readonly note?: string;
  readonly updatedAt?: string;
  readonly audits?: readonly StocktakeLineAudit[];
}

export interface StocktakeSession {
  readonly id: string;
  readonly code: string; // KK-YYYY-xxxxx
  readonly title: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName?: string;
  readonly status: StocktakeStatus;
  readonly scopeType: StocktakeScopeType;
  readonly scopeCategories?: readonly string[];
  readonly snapshotAt?: string;
  readonly leadAuditor?: string;
  readonly auditors?: readonly string[];
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly note?: string;
  readonly totalItems: number;
  readonly countedItems: number;
  readonly differenceItems: number;
  readonly totalVarianceValue: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines?: readonly StocktakeLine[];
}

export interface CreateStocktakeRequest {
  readonly code?: string;
  readonly title: string;
  readonly warehouseCode: string;
  readonly scopeType: StocktakeScopeType;
  readonly scopeCategories?: readonly string[];
  readonly specificMaterialCodes?: readonly string[];
  readonly leadAuditor?: string;
  readonly auditors?: readonly string[];
  readonly note?: string;
}

export interface UpdateStocktakeLineInput {
  readonly lineId: string;
  readonly countRound1?: number;
  readonly countRound2?: number;
  readonly actualQuantity?: number;
  readonly reason?: string;
  readonly note?: string;
  readonly lotAllocations?: readonly StocktakeLotAllocation[];
  readonly serialAllocations?: readonly StocktakeSerialAllocation[];
}

// ---------------------------------------------------------------- Chứng từ kho

export const STOCK_DOCUMENT_TYPES = [
  'RECEIPT_PURCHASE',
  'RECEIPT_SALES_RETURN',
  'RECEIPT_TRANSFER',
  'RECEIPT_OTHER',
  'ISSUE_SALES',
  'ISSUE_PROJECT',
  'ISSUE_WARRANTY',
  'ISSUE_TRANSFER',
  'ISSUE_OTHER',
  'ADJUSTMENT',
  'TRANSFER',
] as const;

export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

export const STOCK_DOCUMENT_STATUSES = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'CANCELLED',
] as const;

export type StockDocumentStatus = (typeof STOCK_DOCUMENT_STATUSES)[number];

/** Chiều của dòng: IN cộng tồn, OUT trừ tồn. Dòng điều chuyển ghi OUT (xuất khỏi kho đi). */
export type StockDocumentLineDirection = 'IN' | 'OUT';

export interface StockDocumentLine {
  readonly id: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit?: string;
  readonly quantity: number;
  readonly direction: StockDocumentLineDirection;
  readonly unitCost: number;
  readonly costAmount?: number;
  readonly reservationId?: string;
  readonly lotId?: string;
  readonly lotNo?: string;
  readonly lotExpiresOn?: string;
  /** Serial của dòng, đúng bằng số lượng. */
  readonly serials?: readonly string[];
  /** Dòng xuất gốc mà dòng nhập trả này lấy giá vốn. */
  readonly sourceLineId?: string;
  readonly note?: string;
}

export interface StockDocument {
  readonly id: string;
  readonly code: string;
  readonly docType: StockDocumentType;
  readonly status: StockDocumentStatus;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly targetWarehouseId?: string;
  readonly targetWarehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
  /** Ngày chứng từ, dạng YYYY-MM-DD. */
  readonly documentDate: string;
  readonly note?: string;
  readonly rejectReason?: string;
  readonly reversesDocumentId?: string;
  readonly createdBy: string;
  readonly submittedBy?: string;
  readonly submittedAt?: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly rejectedBy?: string;
  readonly rejectedAt?: string;
  readonly postedBy?: string;
  readonly postedAt?: string;
  readonly cancelledBy?: string;
  readonly cancelledAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly StockDocumentLine[];
}

export interface StockDocumentLineInput {
  readonly materialCode: string;
  readonly quantity: number;
  /** Bỏ trống thì suy theo loại chứng từ; chứng từ điều chỉnh bắt buộc ghi. */
  readonly direction?: StockDocumentLineDirection;
  readonly unitCost?: number;
  /**
   * Dòng xuất trừ vào giữ hàng này (id): ghi sổ giảm cả tồn lẫn phần đã giữ và
   * tăng số đã xuất của giữ hàng. Chỉ dùng cho dòng của chứng từ xuất (ISSUE_*).
   */
  readonly reservationId?: string;
  /**
   * Danh sách serial cho mặt hàng theo dõi theo serial: số phần tử phải bằng số
   * lượng (nguyên). Dòng nhập tạo hoặc nhận lại serial; dòng xuất kiểm serial có,
   * đúng mặt hàng, đúng kho, Trong kho và Đạt.
   */
  readonly serials?: readonly string[];
  /**
   * Lô của dòng. Dòng nhập tạo lô mới hoặc cộng vào lô cùng số lô; dòng xuất và
   * điều chuyển chỉ cần `lotNo` của lô đã có. Không ghi cùng lúc lô và serial.
   */
  readonly lot?: StockDocumentLotInput;
  /**
   * Chỉ cho dòng nhập trả hàng bán (RECEIPT_SALES_RETURN): id dòng xuất gốc đã ghi
   * sổ, cùng mặt hàng. Giá vốn nhập trả lấy theo giá vốn của dòng đó; bỏ trống thì
   * lấy giá bình quân hiện tại của kho nhận.
   */
  readonly sourceLineId?: string;
  readonly note?: string;
}

export interface CreateStockDocumentRequest {
  readonly docType: StockDocumentType;
  readonly warehouseCode: string;
  readonly targetWarehouseCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  /** Gọi lại cùng khoá trả về chứng từ đã tạo, không tạo thêm. */
  readonly idempotencyKey?: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines: readonly StockDocumentLineInput[];
}

/** Sửa chứng từ nháp (hoặc bị từ chối, sửa xong quay về nháp). Không đổi được loại chứng từ. */
export interface UpdateStockDocumentRequest {
  readonly warehouseCode?: string;
  readonly targetWarehouseCode?: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines?: readonly StockDocumentLineInput[];
}

export interface RejectStockDocumentRequest {
  readonly reason: string;
}

export interface StockDocumentListQuery {
  readonly docType?: StockDocumentType;
  /** Lọc theo nhiều loại cùng lúc (màn thủ kho: xuất bán và xuất bảo hành). */
  readonly docTypes?: readonly StockDocumentType[];
  readonly status?: StockDocumentStatus;
  readonly warehouseCode?: string;
  /** Loại chứng từ nguồn, ví dụ đơn bán, bảo hành. */
  readonly sourceType?: string;
  /** Ngày chứng từ từ ngày này (YYYY-MM-DD, tính cả ngày này). */
  readonly fromDate?: string;
  /** Ngày chứng từ đến ngày này (YYYY-MM-DD, tính cả ngày này). */
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StockDocumentPage {
  readonly items: readonly StockDocument[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Kết quả ghi sổ: chứng từ và các bút toán vừa sinh, theo thứ tự dòng. */
export interface PostedStockDocument {
  readonly document: StockDocument;
  readonly transactions: readonly InventoryTransaction[];
}

// ============================================================================
// API NỘI BỘ CHO BÁN HÀNG (T1-24, T1-25, T1-26)
// ============================================================================

/**
 * Tham số `GET v1/internal/materials`. Mọi trường tuỳ chọn; `ids`, `codes`,
 * `kind` nhận danh sách cách nhau bằng dấu phẩy.
 *
 * Không có `limit` thì trả cả danh mục (hành vi cũ mà Quy trình đang dùng); có
 * `limit` thì phân trang theo mã, trang sau gọi lại với `cursor = nextCursor`.
 */
export interface InternalMaterialCatalogQuery {
  /** Tìm theo mã hoặc tên, không phân biệt hoa thường. */
  readonly search?: string;
  readonly ids?: readonly string[];
  readonly codes?: readonly string[];
  /** Chỉ tính tồn tại kho này. */
  readonly warehouseCode?: string;
  /** Mặc định cả STOCK và SERVICE. */
  readonly kinds?: readonly MaterialKind[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface InternalMaterialWarehouseStock {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  /** Tồn khả dụng = thực tế − đã giữ − không Đạt. */
  readonly available: number;
  /** Giá vốn bình quân của dòng tồn tại kho này. */
  readonly avgCost: number;
}

/**
 * Một mặt hàng cho phân hệ khác. Mặt hàng dịch vụ có `avgCost`,
 * `availableByWarehouse`, `totalAvailable` là null (không quản lý tồn).
 *
 * `available` là trường cũ Quy trình đang đọc: bằng `totalAvailable`, dịch vụ
 * nhận 0.
 */
export interface InternalMaterialCatalogItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly kind: MaterialKind;
  readonly category: MaterialCategory | null;
  readonly isSerialized: boolean;
  readonly isActive: boolean;
  readonly warrantyMonths: number | null;
  /**
   * Giá vốn bình quân của mặt hàng: bình quân theo số lượng của giá bình quân các
   * kho đang có hàng (chỉ kho `warehouseCode` khi có lọc). Là giá ước tính cho báo
   * giá; giá vốn thực tế ghi trên dòng xuất lúc ghi sổ.
   */
  readonly avgCost: number | null;
  readonly availableByWarehouse: readonly InternalMaterialWarehouseStock[] | null;
  readonly totalAvailable: number | null;
  readonly available: number;
}

export interface InternalMaterialCatalogPage {
  readonly materials: readonly InternalMaterialCatalogItem[];
  /** Có khi còn trang sau (chỉ khi gọi với `limit`). */
  readonly nextCursor: string | null;
}

/** Một dòng của yêu cầu xuất. */
export interface InternalIssueRequestLine {
  readonly materialCode: string;
  readonly quantity: number;
  /** Giữ hàng (id) mà dòng xuất trừ vào. */
  readonly reservationId?: string;
  /** Lô gợi ý; thủ kho đổi được trước khi ghi sổ. */
  readonly lotNo?: string;
  /** Serial gợi ý; mặt hàng theo serial bắt buộc đủ serial lúc ghi sổ. */
  readonly serials?: readonly string[];
  readonly note?: string;
}

/**
 * `POST v1/internal/issue-requests`: tạo chứng từ xuất NHÁP từ đợt giao hàng
 * (ISSUE_SALES) hoặc bảo hành (ISSUE_WARRANTY). Thủ kho chọn serial, lô rồi ghi
 * sổ trên màn Kho; ghi sổ phát `inventory.stock.issued`.
 *
 * Cùng `idempotencyKey` và cùng nội dung trả lại chứng từ đã tạo; khác nội dung
 * thì 409 `IDEMPOTENCY_KEY_CONFLICT`.
 */
export interface InternalIssueRequest {
  readonly idempotencyKey: string;
  /** Mặc định ISSUE_SALES. */
  readonly docType?: 'ISSUE_SALES' | 'ISSUE_WARRANTY';
  readonly warehouseCode: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines: readonly InternalIssueRequestLine[];
}

/** Một dòng nhập trả. */
export interface InternalReturnReceiptLine {
  readonly materialCode: string;
  readonly quantity: number;
  /** Serial nhận về; mặt hàng theo serial bắt buộc đủ serial. */
  readonly serials?: readonly string[];
  /** Lô gốc của hàng trả về (để chép hạn dùng). */
  readonly lotNo?: string;
  /** Dòng xuất gốc (id dòng chứng từ) để lấy giá vốn lúc xuất. */
  readonly sourceLineId?: string;
  readonly note?: string;
}

/**
 * `POST v1/internal/return-receipts`: tạo VÀ ghi sổ chứng từ nhập trả hàng bán
 * (RECEIPT_SALES_RETURN) vào kho được chỉ định (kho cách ly). Hàng nhận về ở
 * trạng thái Chờ kiểm định, không tính vào tồn khả dụng. Có khoá chống lặp như
 * `issue-requests`. Ghi sổ phát `inventory.stock.returned`.
 */
export interface InternalReturnReceiptRequest {
  readonly idempotencyKey: string;
  readonly warehouseCode: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines: readonly InternalReturnReceiptLine[];
}

/**
 * `POST v1/internal/stock-documents`: chứng từ kho do phân hệ khác yêu cầu (Bán
 * hàng: bảo hành chuyển hàng lỗi sang kho lỗi, loại bỏ hàng lỗi). Chỉ nhận
 * điều chuyển (ghi sổ ngay, nguồn đã duyệt) và xuất khác (gửi duyệt, người có
 * `inventory.document.approve` duyệt rồi ghi sổ). Khoá chống lặp bắt buộc như
 * hai API trên.
 */
export interface InternalStockDocumentRequest {
  readonly idempotencyKey: string;
  readonly docType: 'TRANSFER' | 'ISSUE_OTHER';
  readonly warehouseCode: string;
  /** Bắt buộc với điều chuyển. */
  readonly targetWarehouseCode?: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines: readonly InternalIssueRequestLine[];
}

/**
 * `POST v1/internal/serials/:serial/quality`, `POST v1/internal/lots/:id/quality`:
 * đổi trạng thái chất lượng thay người kiểm định của phân hệ khác (kỹ thuật
 * bảo hành ở Bán hàng). Lý do bắt buộc; `actorUserId` là người chịu trách nhiệm
 * ghi vào lịch sử chất lượng.
 */
export interface InternalChangeQualityRequest extends ChangeQualityRequest {
  readonly actorUserId?: string;
}

/** Kết quả của hai API nội bộ tạo chứng từ. */
export interface InternalStockDocumentResult {
  readonly documentId: string;
  readonly documentCode: string;
  readonly docType: StockDocumentType;
  readonly status: StockDocumentStatus;
  readonly document: StockDocument;
}

// ---------------------------------------------------------------- Danh mục kho cho phân hệ khác (T4-19)

/**
 * `GET v1/internal/warehouses?search=&codes=&ids=&includeInactive=`: kho cho
 * phân hệ khác chọn (Bán hàng chọn kho xuất trong kế hoạch giao). Mặc định chỉ
 * kho đang dùng; `includeInactive=true` trả cả kho đã ngừng để hiện tên kho cũ.
 */
export interface InternalWarehouseCatalogQuery {
  /** Tìm theo mã hoặc tên, không phân biệt hoa thường. */
  readonly search?: string;
  readonly codes?: readonly string[];
  readonly ids?: readonly string[];
  readonly includeInactive?: boolean;
}

export interface InternalWarehouseCatalogItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  /** Kho vật lý hay kho ảo (hàng đang luân chuyển). */
  readonly type: WarehouseType;
}

export interface InternalWarehouseCatalogPage {
  readonly warehouses: readonly InternalWarehouseCatalogItem[];
}

// ---------------------------------------------------------------- Báo cáo kho (T7-06, T7-07)

/** Báo cáo tồn xem theo kho (mặt hàng tại kho), theo lô, hoặc theo serial. */
export const STOCK_REPORT_GROUPS = ['WAREHOUSE', 'LOT', 'SERIAL'] as const;
export type StockReportGroupBy = (typeof STOCK_REPORT_GROUPS)[number];

/**
 * `GET v1/reports/stock`. Lọc theo mặt hàng (mã hoặc tên), nhóm vật tư, kho;
 * `expiringWithinDays` chỉ dùng cho báo cáo theo lô và gồm cả lô đã hết hạn.
 * Dòng tồn bằng 0 bị ẩn trừ khi `includeZero`. Serial mặc định chỉ lấy serial
 * Trong kho; `stockState=ALL` lấy mọi trạng thái.
 */
export interface StockReportQuery {
  readonly groupBy?: StockReportGroupBy;
  readonly search?: string;
  readonly materialCode?: string;
  readonly category?: MaterialCategory;
  readonly warehouseCode?: string;
  readonly expiringWithinDays?: number;
  readonly qualityStatus?: QualityStatus;
  readonly stockState?: SerialStockState | 'ALL';
  readonly includeZero?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Bốn loại tồn (INV-07). Theo Q2, MVP không có cột hàng đang vận chuyển.
 * `available` = `onHand` − `reserved` − `blocked`.
 */
export interface StockQuantities {
  /** Tồn thực tế. */
  readonly onHand: number;
  /** Đã giữ cho đơn bán, công việc. */
  readonly reserved: number;
  /** Chờ kiểm định, cách ly hoặc lỗi: có trong kho nhưng không được xuất. */
  readonly blocked: number;
  /** Khả dụng. */
  readonly available: number;
}

interface StockReportMaterialColumns {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit?: string;
  readonly category?: MaterialCategory;
}

/** Một mặt hàng tại một kho (cộng mọi vị trí trong kho). */
export interface StockReportWarehouseRow extends StockQuantities, StockReportMaterialColumns {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  /** Giá vốn bình quân hiện tại tại kho. */
  readonly avgCost: number;
  /** Giá trị tồn = tồn thực tế × giá bình quân, làm tròn 2 chữ số. */
  readonly stockValue: number;
}

/** Một lô tại một kho. */
export interface StockReportLotRow extends StockQuantities, StockReportMaterialColumns {
  readonly lotId: string;
  readonly lotNo: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly manufacturedOn?: string;
  /** Hạn dùng, dạng YYYY-MM-DD. */
  readonly expiresOn?: string;
  /** Số ngày còn lại tới hạn dùng theo giờ Việt Nam; âm là đã hết hạn. */
  readonly daysToExpiry?: number;
  readonly qualityStatus: QualityStatus;
}

/** Một serial; `warehouseCode` trống khi serial không ở kho nào (đã xuất). */
export interface StockReportSerialRow extends StockReportMaterialColumns {
  readonly serialId: string;
  readonly serialNumber: string;
  readonly warehouseId?: string;
  readonly warehouseCode?: string;
  readonly warehouseName?: string;
  readonly stockState?: SerialStockState;
  readonly qualityStatus: QualityStatus;
  readonly updatedAt: string;
}

/** Tổng của cả tập đã lọc (không chỉ trang đang xem). */
export interface StockReportTotals extends StockQuantities {
  /** Chỉ báo cáo theo kho có giá trị tồn. */
  readonly stockValue?: number;
}

/** Tổng của báo cáo serial: đếm số serial. */
export interface SerialReportTotals {
  readonly serials: number;
  /** Serial Trong kho. */
  readonly inStock: number;
  /** Serial Trong kho nhưng không Đạt. */
  readonly blocked: number;
  /** Serial Trong kho và Đạt. */
  readonly available: number;
}

interface StockReportPageBase {
  /** Số dòng của cả tập đã lọc. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** Thời điểm lấy số liệu (ISO). */
  readonly asOf: string;
}

export type StockReport =
  | (StockReportPageBase & {
      readonly groupBy: 'WAREHOUSE';
      readonly rows: readonly StockReportWarehouseRow[];
      readonly totals: StockReportTotals;
    })
  | (StockReportPageBase & {
      readonly groupBy: 'LOT';
      readonly rows: readonly StockReportLotRow[];
      readonly totals: StockReportTotals;
    })
  | (StockReportPageBase & {
      readonly groupBy: 'SERIAL';
      readonly rows: readonly StockReportSerialRow[];
      readonly totals: SerialReportTotals;
    });

/**
 * Nhóm nghiệp vụ của báo cáo nhập xuất (RPT-05). Chứng từ đảo tách riêng để số
 * nhập, xuất gốc không bị lẫn số sửa sai.
 */
export const STOCK_MOVEMENT_CATEGORIES = [
  'RECEIPT',
  'ISSUE',
  'TRANSFER',
  'SALES_RETURN',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type StockMovementCategory = (typeof STOCK_MOVEMENT_CATEGORIES)[number];

/**
 * `GET v1/reports/movements`. Kỳ tính theo ngày ghi sổ (giờ Việt Nam), gồm cả
 * hai đầu; bỏ trống thì lấy từ đầu tháng tới hôm nay.
 */
export interface StockMovementReportQuery {
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly warehouseCode?: string;
  readonly docType?: StockDocumentType;
  readonly category?: StockMovementCategory;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** Số lượng và giá trị theo chiều nhập, xuất. */
export interface StockMovementAmounts {
  readonly quantityIn: number;
  readonly quantityOut: number;
  readonly valueIn: number;
  readonly valueOut: number;
  /** Số bút toán sổ kho. */
  readonly entries: number;
}

export interface StockMovementSummaryRow extends StockMovementAmounts {
  readonly category: StockMovementCategory;
}

/** Một nhóm, một loại chứng từ, một kho. `docType` trống là bút toán không có chứng từ. */
export interface StockMovementBreakdownRow extends StockMovementAmounts {
  readonly category: StockMovementCategory;
  readonly docType?: StockDocumentType;
  readonly warehouseCode: string;
  readonly warehouseName: string;
}

/** Một bút toán sổ kho trong kỳ. `quantity` âm là xuất. */
export interface StockMovementLine {
  readonly transactionId: string;
  readonly transactionCode: string;
  readonly postedAt: string;
  readonly category: StockMovementCategory;
  readonly ledgerType: TransactionType;
  readonly documentId?: string;
  readonly documentCode?: string;
  readonly docType?: StockDocumentType;
  readonly reversesDocumentCode?: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit?: string;
  readonly quantity: number;
  readonly unitCost: number;
  /** |số lượng| × đơn giá, làm tròn 2 chữ số. */
  readonly value: number;
  readonly createdBy: string;
  readonly note?: string;
}

export interface StockMovementReport {
  readonly fromDate: string;
  readonly toDate: string;
  /** Đủ sáu nhóm theo thứ tự `STOCK_MOVEMENT_CATEGORIES`, nhóm không phát sinh là 0. */
  readonly summary: readonly StockMovementSummaryRow[];
  readonly breakdown: readonly StockMovementBreakdownRow[];
  readonly totals: StockMovementAmounts;
  /** Trang bút toán chi tiết. */
  readonly lines: readonly StockMovementLine[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * `GET v1/reports/approvals`: lịch sử chứng từ phải duyệt (điều chỉnh, nhập khác,
 * xuất khác) theo ngày chứng từ. Lý do là ghi chú của chứng từ; người duyệt,
 * từ chối, ghi sổ là id người dùng.
 */
export interface StockApprovalReportQuery {
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly warehouseCode?: string;
  readonly docType?: StockDocumentType;
  readonly status?: StockDocumentStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StockApprovalReportRow {
  readonly documentId: string;
  readonly documentCode: string;
  readonly docType: StockDocumentType;
  readonly status: StockDocumentStatus;
  readonly documentDate: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly reason?: string;
  readonly rejectReason?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly submittedBy?: string;
  readonly submittedAt?: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly rejectedBy?: string;
  readonly rejectedAt?: string;
  readonly postedBy?: string;
  readonly postedAt?: string;
  readonly lineCount: number;
  readonly quantityIn: number;
  readonly quantityOut: number;
  /** Tổng giá vốn các dòng sau ghi sổ; chứng từ chưa ghi sổ là 0. */
  readonly value: number;
}

export interface StockApprovalReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: readonly StockApprovalReportRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
