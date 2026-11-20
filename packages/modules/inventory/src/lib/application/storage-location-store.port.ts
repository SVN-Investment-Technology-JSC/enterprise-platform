import type {
  MaterialStorageLocation,
  WarehouseLocationLevels,
} from '@enterprise-platform/contracts-inventory';
import type { NormalizedStorageLocation } from '../domain/storage-location-policy.js';

/** Bộ lọc danh sách vị trí lưu trữ, đã kiểm và chuẩn hoá ở tầng application. */
export interface StorageLocationListFilter {
  /** Tìm theo chuỗi vị trí, mã hoặc tên mặt hàng (không phân biệt hoa thường). */
  readonly q?: string;
  readonly warehouseCode?: string;
  readonly materialCode?: string;
  readonly limit: number;
}

export interface ReplaceStorageLocationsInput {
  readonly warehouseCode: string;
  readonly materialCode: string;
  readonly locations: readonly NormalizedStorageLocation[];
  readonly actorId: string;
}

/**
 * Vị trí lưu trữ của mặt hàng theo kho. Chỉ là thông tin tùy chọn: bảng độc lập với tồn kho, giữ hàng và báo cáo.
 * Mã kho hoặc mã mặt hàng không tồn tại thì ném `WarehouseNotFoundError` / `MaterialNotFoundError`.
 */
export interface StorageLocationStore {
  list(tenantId: string, filter: StorageLocationListFilter): Promise<MaterialStorageLocation[]>;
  /**
   * Thay toàn bộ vị trí của cặp (kho, mặt hàng) trong một transaction, rồi trả danh sách mới. Từ chối kho
   * `VIRTUAL_IN_TRANSIT` và mặt hàng `SERVICE`.
   */
  replace(tenantId: string, input: ReplaceStorageLocationsInput): Promise<MaterialStorageLocation[]>;
  /** `levels` null: bỏ ghi đè, kho dùng lại mẫu của tenant. */
  setWarehouseLevels(
    tenantId: string,
    warehouseCode: string,
    levels: readonly string[] | null,
  ): Promise<WarehouseLocationLevels>;
}

export const STORAGE_LOCATION_STORE = 'STORAGE_LOCATION_STORE';
