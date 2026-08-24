import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface ProcedureMaterialCatalogItem {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
}

/** Procedure reads Inventory through its internal contract, never its tables. */
@Injectable()
export class TenantInventoryCatalogClient {
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
