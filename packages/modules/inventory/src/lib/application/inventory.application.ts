import type { CreateAssetDto, CreateItemDto, CreateWarehouseDto, ExportStockDto, ImportStockDto, UpdateAssetSpecsDto, UploadAssetDocumentDto } from '@enterprise-platform/contract-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import type { InventoryActor,InventoryStore } from './inventory-store.port.js';
export class InventoryApplication {
 constructor(private readonly store:InventoryStore){}
 workspace(actor:InventoryActor){ this.read(actor); return this.store.workspace(actor.tenantId); }
 createWarehouse(actor:InventoryActor,input:CreateWarehouseDto){ this.manage(actor); this.required(input.code,input.name); return this.store.createWarehouse(actor.tenantId,input); }
 createItem(actor:InventoryActor,input:CreateItemDto){ this.manage(actor); this.required(input.code,input.name,input.uomCode); return this.store.createItem(actor.tenantId,input); }
 createAsset(actor:InventoryActor,input:CreateAssetDto){ this.manage(actor); this.required(input.code,input.name,input.type); if(!['PLANT','SYSTEM','EQUIPMENT','COMPONENT'].includes(input.type)||input.criticality&&!['CRITICAL','HIGH','MEDIUM','LOW'].includes(input.criticality))throw new InventoryError('validation','Loại hoặc độ quan trọng của tài sản không hợp lệ.'); return this.store.createAsset(actor.tenantId,input); }
 updateAssetSpecs(actor:InventoryActor,assetId:string,input:UpdateAssetSpecsDto){ this.manage(actor); this.required(assetId); if(!input.specs||Array.isArray(input.specs)||typeof input.specs!=='object')throw new InventoryError('validation','Thông số kỹ thuật phải là một JSON object.'); return this.store.updateAssetSpecs(actor.tenantId,actor.userId,assetId,input); }
 uploadAssetDocument(actor:InventoryActor,assetId:string,input:UploadAssetDocumentDto){ this.manage(actor); this.required(assetId,input.title,input.fileName,input.fileUrl); return this.store.uploadAssetDocument(actor.tenantId,assetId,input); }
 importStock(actor:InventoryActor,input:ImportStockDto){ this.adjust(actor); this.document(input.receiptNo,input.warehouseId,input.lines); return this.store.importStock(actor.tenantId,actor.userId,input); }
 exportStock(actor:InventoryActor,input:ExportStockDto){ this.adjust(actor); this.document(input.issueNo,input.warehouseId,input.lines); return this.store.exportStock(actor.tenantId,actor.userId,input); }
 private read(a:InventoryActor){ if(!a.canRead&&!a.canManage) throw new InventoryError('forbidden','Bạn không có quyền xem tồn kho.'); }
 private manage(a:InventoryActor){ if(!a.canManage) throw new InventoryError('forbidden','Bạn không có quyền quản lý danh mục kho và thiết bị.'); }
 private adjust(a:InventoryActor){ if(!a.canAdjust&&!a.canManage) throw new InventoryError('forbidden','Bạn không có quyền nhập/xuất kho.'); }
 private required(...v:(string|undefined)[]){ if(v.some(x=>!x?.trim())) throw new InventoryError('validation','Các trường bắt buộc chưa đầy đủ.'); }
 private document(no:string,warehouseId:string,lines:{quantity:number}[]){ this.required(no,warehouseId); if(!lines?.length||lines.some(x=>!Number.isFinite(x.quantity)||x.quantity<=0)) throw new InventoryError('validation','Phiếu phải có dòng vật tư với số lượng lớn hơn 0.'); }
}
