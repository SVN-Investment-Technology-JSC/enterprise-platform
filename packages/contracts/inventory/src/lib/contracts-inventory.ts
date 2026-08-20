// Inventory Service (AMM - Asset & Materials Management)
// Schema: inventory_schema
// Principles: Ledger-only inventory, hierarchical assets, serialized tracking, pessimistic locking

// ============================================================================
// ASSET HIERARCHY & LIFECYCLE
// ============================================================================

export type AssetType = 'PLANT' | 'SYSTEM' | 'EQUIPMENT' | 'COMPONENT';
export type AssetStatus = 'OPERATING' | 'STOPPED' | 'MAINTENANCE' | 'DISPOSED';
export type AssetCriticality = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Một đầu việc trong hồ sơ bảo trì mặc định của thiết bị. */
export interface AssetTaskItem {
  readonly key: string;
  readonly name: string;
  readonly durationMinutes?: number;
  readonly note?: string;
}

export interface UpdateAssetRequest {
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
}

export interface UpdateMaterialRequest {
  readonly name?: string;
  readonly category?: MaterialCategory;
  readonly unit?: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly barcode?: string;
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
export interface RetireResult {
  readonly code: string;
  readonly mode: 'deleted' | 'deactivated';
  readonly reason?: string;
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
  readonly createdAt: string;
  readonly updatedAt: string;
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
export type SerialStatus = 'IN_STOCK' | 'IN_USE' | 'UNDER_REPAIR' | 'IN_TRANSIT' | 'SCRAPPED';
export type LocationType = 'WAREHOUSE' | 'ASSET' | 'VENDOR_REPAIR';

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

export interface WarehouseLocation {
  readonly id: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly qrCode?: string;
}

export interface Material {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: MaterialCategory;
  readonly unit: string;
  readonly minStock: number;
  readonly maxStock: number;
  readonly isSerialized: boolean;
  readonly barcode?: string;
  readonly isActive: boolean;
}

export interface SerialTracking {
  readonly id: string;
  readonly materialId: string;
  readonly serialNumber: string;
  readonly internalCode?: string;
  readonly currentStatus: SerialStatus;
  readonly locationType: LocationType;
  readonly currentWarehouseId?: string;
  readonly currentAssetId?: string;
  readonly createdAt: string;
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
