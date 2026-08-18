import type { AssetDocumentDto, AssetSummaryDto, CreateAssetDto, CreateItemDto, CreateWarehouseDto, ExportStockDto, ImportStockDto, InventoryWorkspaceDto, ItemDetailDto, UpdateAssetSpecsDto, UploadAssetDocumentDto, WarehouseSummaryDto } from '@enterprise-platform/contract-inventory';
export const INVENTORY_STORE=Symbol('INVENTORY_STORE');
export interface InventoryActor { tenantId:string; userId:string; displayName:string; canRead:boolean; canManage:boolean; canAdjust:boolean }
export interface InventoryStore { 
  workspace(tenantId:string):Promise<InventoryWorkspaceDto>; 
  createWarehouse(tenantId:string,input:CreateWarehouseDto):Promise<WarehouseSummaryDto>; 
  createItem(tenantId:string,input:CreateItemDto):Promise<ItemDetailDto>; 
  createAsset(tenantId:string,input:CreateAssetDto):Promise<AssetSummaryDto>;
  updateAssetSpecs(tenantId:string,userId:string,assetId:string,input:UpdateAssetSpecsDto):Promise<AssetSummaryDto>;
  uploadAssetDocument(tenantId:string,assetId:string,input:UploadAssetDocumentDto):Promise<AssetDocumentDto>;
  importStock(tenantId:string,userId:string,input:ImportStockDto):Promise<{id:string;receiptNo:string}>; 
  exportStock(tenantId:string,userId:string,input:ExportStockDto):Promise<{id:string;issueNo:string}>; 
}
