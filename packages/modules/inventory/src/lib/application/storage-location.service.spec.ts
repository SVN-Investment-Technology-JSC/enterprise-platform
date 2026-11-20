import type { MaterialStorageLocation, WarehouseLocationLevels } from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from './inventory.application.js';
import { StorageLocationService } from './storage-location.service.js';
import type {
  ReplaceStorageLocationsInput,
  StorageLocationListFilter,
  StorageLocationStore,
} from './storage-location-store.port.js';

class FakeStorageLocationStore implements StorageLocationStore {
  listCalls: StorageLocationListFilter[] = [];
  replaceCalls: ReplaceStorageLocationsInput[] = [];
  levelCalls: { warehouseCode: string; levels: readonly string[] | null }[] = [];

  async list(_tenantId: string, filter: StorageLocationListFilter): Promise<MaterialStorageLocation[]> {
    this.listCalls.push(filter);
    return [];
  }
  async replace(_tenantId: string, input: ReplaceStorageLocationsInput): Promise<MaterialStorageLocation[]> {
    this.replaceCalls.push(input);
    return [];
  }
  async setWarehouseLevels(
    _tenantId: string,
    warehouseCode: string,
    levels: readonly string[] | null,
  ): Promise<WarehouseLocationLevels> {
    this.levelCalls.push({ warehouseCode, levels });
    return { warehouseCode, levels };
  }
}

const actor = (rights: Partial<InventoryActor> = {}): InventoryActor => ({
  tenantId: 'tenant',
  userId: 'user-1',
  displayName: 'User',
  canManage: true,
  canWriteTransactions: true,
  ...rights,
});

describe('StorageLocationService', () => {
  let store: FakeStorageLocationStore;
  let service: StorageLocationService;
  beforeEach(() => {
    store = new FakeStorageLocationStore();
    service = new StorageLocationService(store);
  });

  it('thay vị trí: chuẩn hoá danh sách và ghi người sửa', async () => {
    await service.replace(actor(), ' VT-001 ', 'KHO-A', {
      locations: [{ locationText: ' Kệ  3 ' }, { locationText: 'kệ 3' }, { segments: ['Khu B', 'Ngăn 1'] }],
    });
    expect(store.replaceCalls).toEqual([
      {
        materialCode: 'VT-001',
        warehouseCode: 'KHO-A',
        actorId: 'user-1',
        locations: [
          { locationText: 'Kệ 3', segments: undefined, isPrimary: true, note: undefined },
          { locationText: 'Khu B / Ngăn 1', segments: ['Khu B', 'Ngăn 1'], isPrimary: false, note: undefined },
        ],
      },
    ]);
  });

  it('danh sách rỗng là xóa hết vị trí của cặp', async () => {
    await service.replace(actor(), 'VT-001', 'KHO-A', { locations: [] });
    expect(store.replaceCalls[0].locations).toEqual([]);
  });

  it('không có quyền sửa danh mục thì không ghi vị trí hay tên cấp', async () => {
    const reader = actor({ canManage: false });
    await expect(service.replace(reader, 'VT-001', 'KHO-A', { locations: [] })).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      statusCode: 403,
    });
    await expect(service.setWarehouseLevels(reader, 'KHO-A', { levels: ['Khu'] })).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
    expect(store.replaceCalls).toHaveLength(0);
    expect(store.levelCalls).toHaveLength(0);
  });

  it('thiếu mã vật tư hoặc mã kho thì từ chối trước khi chạm store', async () => {
    await expect(service.replace(actor(), '  ', 'KHO-A', { locations: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(service.replace(actor(), 'VT-001', '', { locations: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(service.listForMaterial(actor({ canManage: false }), '')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(store.replaceCalls).toHaveLength(0);
  });

  it('đọc chỉ cần quyền đọc; giới hạn mặc định và bị chặn trên', async () => {
    const reader = actor({ canManage: false });
    await service.list(reader, { q: ' kệ 3 ' });
    await service.list(reader, { limit: 999999 });
    await service.list(reader, { limit: -5 });
    expect(store.listCalls.map((call) => call.limit)).toEqual([200, 2000, 200]);
    expect(store.listCalls[0].q).toBe('kệ 3');
  });

  it('tên cấp: null bỏ ghi đè, mảng rỗng là không chia cấp, tên quá dài bị từ chối', async () => {
    await service.setWarehouseLevels(actor(), 'KHO-A', { levels: null });
    await service.setWarehouseLevels(actor(), 'KHO-A', { levels: [] });
    await service.setWarehouseLevels(actor(), 'KHO-A', { levels: [' Khu ', 'Kệ', 'Ngăn', 'Tầng', 'Ô', 'Hộc', 'Khay'] });
    expect(store.levelCalls.map((call) => call.levels)).toEqual([
      null,
      [],
      ['Khu', 'Kệ', 'Ngăn', 'Tầng', 'Ô', 'Hộc', 'Khay'],
    ]);
    await expect(
      service.setWarehouseLevels(actor(), 'KHO-A', { levels: ['x'.repeat(51)] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      service.setWarehouseLevels(actor(), 'KHO-A', {} as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
