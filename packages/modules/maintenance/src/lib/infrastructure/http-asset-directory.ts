import type { MaintenanceMatrixAsset } from '@enterprise-platform/contracts-maintenance';
import type { AssetDirectory } from '../application/asset-directory.port.js';

/** Đọc danh mục thiết bị qua endpoint nội bộ của Kho. */
export class HttpAssetDirectory implements AssetDirectory {
  constructor(
    private readonly inventoryApiUrl: string = process.env['INVENTORY_API_URL'] ??
      'http://localhost:3336/api/inventory',
  ) {}

  async listAssets(tenantId: string): Promise<MaintenanceMatrixAsset[]> {
    const response = await fetch(`${this.inventoryApiUrl}/v1/internal/assets`, {
      headers: {
        'X-Tenant-ID': tenantId,
        'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
      },
    });
    if (!response.ok) {
      throw new Error(`Kho trả về ${response.status} khi lấy danh mục thiết bị.`);
    }
    const body = (await response.json()) as { assets?: MaintenanceMatrixAsset[] };
    return body.assets ?? [];
  }
}
