// Warehouse & Storage Location Types
export const WAREHOUSE_TYPES = ['CENTRAL', 'WORKSHOP', 'SHIFT_STATION'] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export interface Warehouse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly warehouseType: WarehouseType;
  readonly plantCode?: string;
  readonly managerUserId?: string;
  readonly address?: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const STORAGE_LOCATION_TYPES = ['ZONE', 'RACK', 'SHELF', 'BIN'] as const;
export type StorageLocationType = (typeof STORAGE_LOCATION_TYPES)[number];

export interface StorageLocation {
  readonly id: string;
  readonly warehouseId: string;
  readonly parentId?: string;
  readonly code: string;
  readonly name: string;
  readonly locationType: StorageLocationType;
  readonly barcodeQr?: string;
  readonly isQuarantine: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
}

// Material & Category Types
export interface MaterialCategory {
  readonly id: string;
  readonly parentId?: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly isActive: boolean;
}

export const MATERIAL_CRITICALITY_LEVELS = ['A', 'B', 'C', 'D'] as const;
export type MaterialCriticality = (typeof MATERIAL_CRITICALITY_LEVELS)[number];

export interface MaintenanceTaskStep {
  readonly order: number;
  readonly title: string;
  readonly durationMinutes: number;
  readonly note?: string;
  readonly requiredTools?: string[];
}

export interface Material {
  readonly id: string;
  readonly materialCode: string;
  readonly name: string;
  readonly categoryId: string;
  readonly uom: string;
  readonly specification?: string;
  readonly manufacturer?: string;
  readonly partNumberOem?: string;
  readonly criticality: MaterialCriticality;
  readonly minStock: number;
  readonly maxStock: number;
  readonly reorderPoint: number;
  readonly leadTimeDays: number;
  readonly isSerialControlled: boolean;
  readonly isBatchControlled: boolean;
  readonly isExpiryControlled: boolean;
  readonly shelfLifeDays?: number;
  readonly replacementSteps: readonly MaintenanceTaskStep[];
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MaterialCompatibility {
  readonly id: string;
  readonly materialId: string;
  readonly assetCode: string;
  readonly assetPartSymbol?: string;
  readonly requiredQty: number;
  readonly taskTemplate: readonly MaintenanceTaskStep[];
  readonly notes?: string;
}

export interface MaterialAlternative {
  readonly id: string;
  readonly materialId: string;
  readonly alternativeMaterialId: string;
  readonly interchangeability: 'ONE_WAY' | 'TWO_WAY';
  readonly conversionRatio: number;
  readonly notes?: string;
}

// Asset/Equipment Types
export const ASSET_TYPES = ['company', 'site', 'system', 'equipment', 'part'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUS = ['active', 'inactive', 'retired'] as const;
export type AssetStatus = (typeof ASSET_STATUS)[number];

export const ASSET_HEALTH = ['unknown', 'good', 'warning', 'critical'] as const;
export type AssetHealth = (typeof ASSET_HEALTH)[number];

export interface Asset {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly assetType: AssetType;
  readonly parentId?: string;
  readonly status: AssetStatus;
  readonly health: AssetHealth;
  readonly location?: string;
  readonly manufacturer?: string;
  readonly organizationUnitId?: string;
  readonly organizationUnitName?: string;
  readonly taskTemplate: readonly MaintenanceTaskStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Inventory Balance Types
export interface InventoryBalance {
  readonly id: string;
  readonly warehouseId: string;
  readonly locationId?: string;
  readonly materialId: string;
  readonly onHandQty: number;
  readonly reservedQty: number;
  readonly availableQty: number;
  readonly quarantineQty: number;
  readonly damagedQty: number;
  readonly inTransitQty: number;
  readonly updatedAt: string;
}

// Lot & Serial Types
export interface InventoryLot {
  readonly id: string;
  readonly lotNumber: string;
  readonly materialId: string;
  readonly manufactureDate?: string;
  readonly expiryDate?: string;
  readonly coCqNumber?: string;
  readonly supplierCode?: string;
  readonly notes?: string;
}

export const SERIAL_STATUS = ['IN_STOCK', 'RESERVED', 'ISSUED', 'INSTALLED', 'SCRAPPED'] as const;
export type SerialStatus = (typeof SERIAL_STATUS)[number];

export interface InventorySerial {
  readonly id: string;
  readonly serialNumber: string;
  readonly materialId: string;
  readonly lotId?: string;
  readonly warehouseId: string;
  readonly locationId?: string;
  readonly status: SerialStatus;
  readonly installedAssetCode?: string;
  readonly createdAt: string;
}

// Stock Reservation Types
export const RESERVATION_STATUS = ['ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[number];

export interface StockReservation {
  readonly id: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly requestedBy: string;
  readonly status: ReservationStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface StockReservationItem {
  readonly id: string;
  readonly reservationId: string;
  readonly materialId: string;
  readonly warehouseId: string;
  readonly reservedQty: number;
  readonly issuedQty: number;
}

// Stock Transaction Types
export const TRANSACTION_TYPES = [
  'GOODS_RECEIPT',
  'GOODS_ISSUE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RETURN_FROM_MAINTENANCE',
  'ADJUSTMENT_PLUS',
  'ADJUSTMENT_MINUS',
  'SCRAP',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface InventoryTransaction {
  readonly id: string;
  readonly transactionCode: string;
  readonly transactionDate: string;
  readonly transactionType: TransactionType;
  readonly materialId: string;
  readonly warehouseId: string;
  readonly locationId?: string;
  readonly lotId?: string;
  readonly serialId?: string;
  readonly qtyChange: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly unitCost: number;
  readonly totalCost: number;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly performedBy: string;
  readonly notes?: string;
}

// Stock Receipt/Issue/Transfer/Audit Types
export const STOCK_RECEIPT_TYPE = ['PURCHASE_NEW', 'MAINTENANCE_RETURN', 'INITIAL_STOCK', 'TRANSFER_IN'] as const;
export type StockReceiptType = (typeof STOCK_RECEIPT_TYPE)[number];

export const STOCK_ISSUE_TYPE = ['FOR_MAINTENANCE', 'FOR_CONSUMABLE_OPERATION', 'SCRAP_DISPOSAL', 'TRANSFER_OUT'] as const;
export type StockIssueType = (typeof STOCK_ISSUE_TYPE)[number];

export const STOCK_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'CANCELLED'] as const;
export type StockStatus = (typeof STOCK_STATUS)[number];

export interface StockReceipt {
  readonly id: string;
  readonly receiptNo: string;
  readonly receiptType: StockReceiptType;
  readonly warehouseId: string;
  readonly supplierCode?: string;
  readonly supplierInvoiceNo?: string;
  readonly status: StockStatus;
  readonly procedureInstanceId?: string;
  readonly receivedDate?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface StockIssue {
  readonly id: string;
  readonly issueNo: string;
  readonly issueType: StockIssueType;
  readonly warehouseId: string;
  readonly reservationId?: string;
  readonly receiverUserId?: string;
  readonly workOrderCode?: string;
  readonly workOrderTasks: readonly MaintenanceTaskStep[];
  readonly status: StockStatus;
  readonly procedureInstanceId?: string;
  readonly issuedDate?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface StockTransfer {
  readonly id: string;
  readonly transferNo: string;
  readonly sourceWarehouseId: string;
  readonly destWarehouseId: string;
  readonly transferStatus: StockStatus;
  readonly procedureInstanceId?: string;
  readonly shippedAt?: string;
  readonly receivedAt?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface StockAudit {
  readonly id: string;
  readonly auditNo: string;
  readonly warehouseId: string;
  readonly auditType: 'PERIODIC' | 'SURPRISE' | 'CYCLE_COUNT';
  readonly status: StockStatus;
  readonly procedureInstanceId?: string;
  readonly auditDate: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

// Quality Control Types
export interface GoodsInspection {
  readonly id: string;
  readonly inspectionNo: string;
  readonly receiptId: string;
  readonly inspectorUserId: string;
  readonly result: 'PASSED' | 'REJECTED' | 'PARTIALLY_PASSED';
  readonly inspectionDate: string;
  readonly testReportUrl?: string;
  readonly notes?: string;
}

// Inventory Workspace & Workspace Types
export interface InventoryWorkspace {
  readonly materials: readonly Material[];
  readonly assets: readonly Asset[];
  readonly warehouses: readonly Warehouse[];
  readonly balances: readonly InventoryBalance[];
  readonly reservations: readonly StockReservation[];
}

// Cross-module Request/Response DTOs
export interface ResolveAssetTaskTemplateRequest {
  readonly assetCode: string;
}

export interface ResolveAssetTaskTemplateResponse {
  readonly taskTemplate: readonly MaintenanceTaskStep[];
  readonly assetCode: string;
  readonly assetName: string;
}

export interface ResolveMaterialTaskTemplateRequest {
  readonly materialId: string;
  readonly assetCode?: string;
}

export interface ResolveMaterialTaskTemplateResponse {
  readonly taskTemplate: readonly MaintenanceTaskStep[];
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
}

export interface CreateStockReservationRequest {
  readonly referenceType: string;
  readonly referenceId: string;
  readonly requestedBy: string;
  readonly items: Array<{
    readonly materialId: string;
    readonly warehouseId: string;
    readonly qty: number;
  }>;
  readonly expiresAtDays?: number;
}

export interface CreateStockReservationResponse {
  readonly reservationId: string;
  readonly reservationCode: string;
}

// Event Payloads
export interface InventoryStockReservationCreatedPayload {
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface InventoryStockIssuedPayload {
  readonly issueId: string;
  readonly issueNo: string;
  readonly procedureInstanceId?: string;
  readonly issuedDate: string;
  readonly issuedBy: string;
}
