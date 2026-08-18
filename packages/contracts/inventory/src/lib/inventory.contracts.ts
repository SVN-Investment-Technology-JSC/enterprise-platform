export enum StockTransactionType { RECEIPT='RECEIPT', ISSUE='ISSUE', ADJUSTMENT='ADJUSTMENT', TRANSFER_IN='TRANSFER_IN', TRANSFER_OUT='TRANSFER_OUT' }
export enum ReceiptStatus { DRAFT='DRAFT', POSTED='POSTED', CANCELLED='CANCELLED' }
export enum IssueStatus { DRAFT='DRAFT', POSTED='POSTED', CANCELLED='CANCELLED' }
export interface WarehouseSummaryDto { id:string; code:string; name:string; type:string; plantCode?:string; warehouseType?:string; address?:string; itemCount:number; locationCount:number; totalOnHand:number }
export interface ItemDetailDto { id:string; code:string; name:string; uom:string; category?:string; manufacturer?:string; trackingType:'NONE'|'LOT'|'SERIAL'; minStock:number; maxStock:number; reorderPoint?:number; isActive:boolean }
export interface StockBalanceDto { warehouseId:string; warehouseCode:string; plantCode?:string; warehouseName?:string; itemId:string; itemCode:string; itemName:string; uom:string; onHand:number; reserved:number; available:number; minStock:number }
export interface StockTransactionDto { id:string; code:string; date:string; type:string; itemCode:string; itemName:string; warehouseCode:string; quantity:number; balanceBefore:number; balanceAfter:number; unitCost:number; referenceType:string; referenceId:string; notes?:string; destination?:string; sourceOrigin?:string }
export interface AssetDocumentDto { id:string; title:string; docType:'manual'|'cocq'|'test_report'|'drawing'|'procedure'; fileName:string; fileUrl:string; fileSize?:string; uploadedAt:string }
export interface MaintenanceEventDto { id:string; date:string; title:string; type:'PREVENTIVE'|'CORRECTIVE'|'INSPECTION'; status:'COMPLETED'|'IN_PROGRESS'|'SCHEDULED'; technician:string; note?:string; replacedParts?:string[] }
export interface MaintenanceProcedureDto { id:string; title:string; frequency:string; estimatedDuration:string; steps:Array<{ stepNo:number; title:string; description:string; toolRequired?:string }>; safetyNotes?:string }
export type AssetHierarchyType = 'PLANT' | 'AREA' | 'SYSTEM' | 'SUBSYSTEM' | 'EQUIPMENT' | 'ASSEMBLY' | 'COMPONENT' | 'PART' | string;
export interface CreateAssetDto { code:string; name:string; parentId?:string; type:AssetHierarchyType; criticality?:'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; serialNumber?:string; specs?:Record<string,unknown> }
export interface UpdateAssetSpecsDto { specs:Record<string,unknown>; description?:string; status?:string; criticality?:string }
export interface UploadAssetDocumentDto { title:string; docType:'manual'|'cocq'|'test_report'|'drawing'|'procedure'; fileName:string; fileUrl:string; fileSize?:string }

export interface AssetBomDto { itemCode:string; itemName:string; quantity:number; critical:boolean }
export interface AssetSummaryDto { id:string; code:string; name:string; parentId?:string; type:AssetHierarchyType; status:string; criticality:string; serialNumber?:string; qrCode?:string; specs?:Record<string,unknown>; bomCount:number; bom:AssetBomDto[]; documents?:AssetDocumentDto[]; maintenanceHistory?:MaintenanceEventDto[]; procedures?:MaintenanceProcedureDto[] }
export interface SerialTrackingDto { id:string; itemCode:string; itemName:string; serialNumber:string; internalCode?:string; status:string; locationType:string; warehouseCode?:string; assetCode?:string }
export interface ReservationSummaryDto { id:string; code:string; referenceType:string; referenceId:string; status:string; expiresAt?:string; lineCount:number; totalReserved:number }
export interface CheckStockAvailabilityDto { warehouseId:string; itemId:string; requestedQuantity:number; availableQuantity:number; isAvailable:boolean }
export interface CreateWarehouseDto { code:string; name:string; type?:'PHYSICAL'|'VIRTUAL_IN_TRANSIT'; address?:string }
export interface CreateItemDto { code:string; name:string; uomCode:string; trackingType?:'NONE'|'LOT'|'SERIAL'; costingMethod?:'FIFO'|'LIFO'|'AVERAGE'; minStock?:number; maxStock?:number }
export interface NewItemDto { code:string; name:string; uomCode?:string; category?:string; manufacturer?:string; minStock?:number; maxStock?:number; description?:string }
export interface StockLineDto { itemId?:string; newItem?:NewItemDto; quantity:number; locationId?:string; lotId?:string; unitCost?:number }
export interface ImportStockDto { receiptNo:string; warehouseId:string; supplierCode?:string; sourceOrigin?:string; lines:StockLineDto[] }
export interface ExportStockDto { issueNo:string; warehouseId:string; destination?:string; toLocation?:string; referenceType?:string; referenceId?:string; lines:StockLineDto[] }
export interface AssetStatusDto { code:string; name:string; badgeLabel?:string; color:string; sortOrder?:number; isActive?:boolean; isSystem?:boolean }
export interface CreateAssetStatusDto { code:string; name:string; badgeLabel?:string; color?:string; sortOrder?:number }
export interface InventoryWorkspaceDto { warehouses:WarehouseSummaryDto[]; items:ItemDetailDto[]; balances:StockBalanceDto[]; lowStock:StockBalanceDto[]; transactions:StockTransactionDto[]; assets:AssetSummaryDto[]; serials:SerialTrackingDto[]; reservations:ReservationSummaryDto[]; assetStatuses?:AssetStatusDto[] }
export interface ItemCreatedEvent { type:'inventory.item.created'; itemId:string; code:string; occurredAt:string }
export interface StockDeductedEvent { type:'inventory.stock.deducted'; itemId:string; warehouseId:string; quantity:number; occurredAt:string }
export interface StockReplenishedEvent { type:'inventory.stock.replenished'; itemId:string; warehouseId:string; quantity:number; occurredAt:string }
export interface MinStockAlertEvent { type:'inventory.stock.min-alert'; itemId:string; warehouseId:string; available:number; minimum:number; occurredAt:string }
