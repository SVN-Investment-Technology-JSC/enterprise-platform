import type { MaintenanceMatrixAsset } from '@enterprise-platform/contracts-maintenance';

export const ASSET_DIRECTORY = Symbol('ASSET_DIRECTORY');

/**
 * Danh mục thiết bị nằm ở Kho. Bảo trì chỉ đọc để dựng ma trận; mọi thay đổi
 * hồ sơ thiết bị (thông số, đầu việc) vẫn thuộc về Kho.
 */
export interface AssetDirectory {
  listAssets(tenantId: string): Promise<MaintenanceMatrixAsset[]>;
}
