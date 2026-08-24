import type { MaintenanceMatrixAsset } from '@enterprise-platform/contracts-maintenance';

export const ASSET_DIRECTORY = Symbol('ASSET_DIRECTORY');

/**
 * Danh mục thiết bị nằm ở Kho. Bảo trì chỉ đọc để dựng ma trận; mọi thay đổi
 * hồ sơ thiết bị (thông số, đầu việc) vẫn thuộc về Kho.
 */
export interface AssetDirectory {
  listAssets(tenantId: string): Promise<MaintenanceMatrixAsset[]>;
  /**
   * Đầu việc bảo trì mặc định của một thiết bị.
   *
   * Bảo trì đọc để hiển thị tại chỗ, không nhân bản sang schema của mình — hồ sơ
   * thiết bị vẫn chỉ có một nguồn duy nhất là Kho.
   */
  readTaskTemplate(tenantId: string, assetCode: string): Promise<readonly Record<string, unknown>[]>;
}
