import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface ProcedureMaterialCatalogItem {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  /**
   * Tồn khả dụng gộp mọi kho, đọc tươi mỗi lần gọi.
   *
   * Vắng mặt khi Kho chạy bản cũ chưa trả trường này — bên hiển thị phải chịu
   * được `undefined` thay vì vẽ ra số 0 sai sự thật.
   */
  readonly available?: number;
}

/** Một thiết bị trong danh mục Kho, để vai E chọn lúc chạy. */
export interface ProcedureAssetCatalogItem {
  readonly code: string;
  readonly name: string;
  readonly type?: string;
  readonly parentCode?: string;
  /** Số đầu việc mặc định của thiết bị; 0 nghĩa là Kho chưa khai đầu việc nào. */
  readonly taskCount?: number;
}

/** Procedure reads Inventory through its internal contract, never its tables. */
@Injectable()
export class TenantInventoryCatalogClient {
  /**
   * Danh mục thiết bị. Vai E chọn thiết bị LÚC CHẠY chứ không khai lúc thiết kế,
   * nên danh sách này phải đọc tươi mỗi lần mở màn phân rã công việc.
   */
  async listAssets(tenantId: string): Promise<readonly ProcedureAssetCatalogItem[]> {
    const root = process.env.INVENTORY_API_URL ?? 'http://localhost:3336/api/inventory';
    try {
      const response = await fetch(`${root}/v1/internal/assets`, {
        headers: {
          'X-Tenant-ID': tenantId,
          'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
        },
      });
      if (!response.ok) throw new Error(`Inventory asset catalog returned ${response.status}.`);
      const body = (await response.json()) as { assets?: ProcedureAssetCatalogItem[] };
      return body.assets ?? [];
    } catch {
      throw new ServiceUnavailableException({
        code: 'INVENTORY_CATALOG_UNAVAILABLE',
        message: 'Không thể lấy danh mục thiết bị từ Inventory.',
      });
    }
  }

  async list(tenantId: string): Promise<readonly ProcedureMaterialCatalogItem[]> {
    const root = process.env.INVENTORY_API_URL ?? 'http://localhost:3336/api/inventory';
    try {
      const response = await fetch(`${root}/v1/internal/materials`, {
        headers: {
          'X-Tenant-ID': tenantId,
          'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
        },
      });
      if (!response.ok) throw new Error(`Inventory material catalog returned ${response.status}.`);
      const body = await response.json() as { materials?: ProcedureMaterialCatalogItem[] };
      return body.materials ?? [];
    } catch {
      throw new ServiceUnavailableException({
        code: 'INVENTORY_CATALOG_UNAVAILABLE',
        message: 'Không thể lấy danh mục vật tư từ Inventory.',
      });
    }
  }
}
