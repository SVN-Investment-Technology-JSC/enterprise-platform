import { Inject, Injectable } from '@nestjs/common';
import type {
  MaterialStorageLocation,
  ReplaceStorageLocationsRequest,
  StorageLocationQuery,
  UpdateWarehouseLocationLevelsRequest,
  WarehouseLocationLevels,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import { normalizeStorageLocations, parseLevelNames } from '../domain/storage-location-policy.js';
import type { InventoryActor } from './inventory.application.js';
import { STORAGE_LOCATION_STORE, type StorageLocationStore } from './storage-location-store.port.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

/**
 * Vị trí lưu trữ của mặt hàng theo kho (chuỗi tự do, tùy chọn). Đọc cần `inventory.read`; ghi dùng chung quyền sửa
 * danh mục (`inventory.manage`): guard của inventory-api kiểm theo đường dẫn, service kiểm lại trên actor.
 */
@Injectable()
export class StorageLocationService {
  constructor(@Inject(STORAGE_LOCATION_STORE) private readonly store: StorageLocationStore) {}

  async list(actor: InventoryActor, query: StorageLocationQuery): Promise<MaterialStorageLocation[]> {
    const limit = Number(query.limit);
    return this.store.list(actor.tenantId, {
      q: clean(query.q),
      warehouseCode: clean(query.warehouseCode),
      materialCode: clean(query.materialCode),
      limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT,
    });
  }

  /** Mọi vị trí của một mặt hàng ở mọi kho. */
  async listForMaterial(actor: InventoryActor, materialCode: string): Promise<MaterialStorageLocation[]> {
    return this.store.list(actor.tenantId, {
      materialCode: requireCode(materialCode, 'Thiếu mã vật tư.'),
      limit: MAX_LIMIT,
    });
  }

  /** Thay toàn bộ vị trí của một mặt hàng ở một kho; danh sách rỗng là xóa hết. */
  async replace(
    actor: InventoryActor,
    materialCode: string,
    warehouseCode: string,
    body: ReplaceStorageLocationsRequest,
  ): Promise<MaterialStorageLocation[]> {
    requireManager(actor);
    return this.store.replace(actor.tenantId, {
      materialCode: requireCode(materialCode, 'Thiếu mã vật tư.'),
      warehouseCode: requireCode(warehouseCode, 'Thiếu mã kho.'),
      locations: normalizeStorageLocations(body?.locations),
      actorId: actor.userId,
    });
  }

  async setWarehouseLevels(
    actor: InventoryActor,
    warehouseCode: string,
    body: UpdateWarehouseLocationLevelsRequest,
  ): Promise<WarehouseLocationLevels> {
    requireManager(actor);
    if (!body || !('levels' in body)) {
      throw new InventoryError('VALIDATION', 'Thiếu danh sách tên cấp.');
    }
    return this.store.setWarehouseLevels(
      actor.tenantId,
      requireCode(warehouseCode, 'Thiếu mã kho.'),
      parseLevelNames(body.levels),
    );
  }
}

function clean(value: string | undefined): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function requireCode(value: string | undefined, message: string): string {
  const code = clean(value);
  if (!code) throw new InventoryError('VALIDATION', message);
  return code;
}

function requireManager(actor: InventoryActor): void {
  if (!actor.canManage) {
    throw new InventoryError('ACCESS_DENIED', 'Bạn không có quyền sửa danh mục kho.', 403);
  }
}
