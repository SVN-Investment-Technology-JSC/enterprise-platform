import { Inject, Injectable } from '@nestjs/common';
import type {
  AddAssetBomRequest,
  Asset,
  AssetBomLine,
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  RetireResult,
  SerialTracking,
  InventorySettingsKey,
  InventorySettingsSnapshot,
  SettingsEntry,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSettingsRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port.js';
import { INVENTORY_STORE } from './inventory-store.port.js';
import {
  AssetNotFoundError,
  InventoryError,
  InvalidReservationError,
  MaterialNotFoundError,
  SettingsVersionConflictError,
  UnknownSettingsKeyError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import {
  INVENTORY_SETTINGS_DEFAULTS,
  isInventorySettingsKey,
  normalizeInventorySetting,
} from './inventory-settings.js';
import { INVENTORY_SETTINGS_KEYS } from '@enterprise-platform/contracts-inventory';

/** Resolved by the access guard from the caller's session or service token. */
export interface InventoryActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  /** Sửa danh mục: thêm/sửa/ngừng vật tư và thiết bị. */
  readonly canManage: boolean;
  /**
   * Ghi phát sinh tồn kho: nhập, xuất, chuyển kho, giữ chỗ.
   *
   * Tách khỏi `canManage` để thủ kho làm được việc hằng ngày mà không có quyền
   * xoá danh mục. Bỏ trống = suy theo `canManage`, giữ nguyên hành vi cũ cho
   * mọi nơi gọi chưa cập nhật.
   */
  readonly canWriteTransactions?: boolean;
}

@Injectable()
export class InventoryApplication {
  constructor(@Inject(INVENTORY_STORE) private readonly store: InventoryStore) {}

  async getWarehouse(actor: InventoryActor, code: string): Promise<Warehouse> {
    const warehouse = await this.store.warehouse.findByCode(actor.tenantId, code);
    if (!warehouse) throw new WarehouseNotFoundError(code);
    return warehouse;
  }

  listWarehouses(actor: InventoryActor): Promise<Warehouse[]> {
    return this.store.warehouse.list(actor.tenantId);
  }

  async getMaterial(actor: InventoryActor, code: string): Promise<Material> {
    const material = await this.store.material.findByCode(actor.tenantId, code);
    if (!material) throw new MaterialNotFoundError(code);
    return material;
  }

  listMaterials(actor: InventoryActor): Promise<Material[]> {
    return this.store.material.list(actor.tenantId);
  }

  /**
   * Danh mục vật tư kèm tồn khả dụng, cho module khác chọn vật tư.
   *
   * Gộp tồn vào cùng một lời gọi thay vì để bên gọi tra từng mã: màn phân rã
   * công việc bên Quy trình cần thấy tồn ngay trên từng dòng chọn, mà tra rời
   * từng mã sẽ là một lượt HTTP cho mỗi dòng.
   */
  async listMaterialsWithStock(
    actor: InventoryActor,
  ): Promise<{ code: string; name: string; unit: string; available: number }[]> {
    const [materials, stock] = await Promise.all([
      this.store.material.list(actor.tenantId),
      this.store.inventory.availableByMaterial(actor.tenantId),
    ]);
    return materials.map(({ code, name, unit }) => ({
      code,
      name,
      unit,
      available: stock.get(code) ?? 0,
    }));
  }

  async getAsset(actor: InventoryActor, code: string): Promise<Asset> {
    const asset = await this.store.asset.findByCode(actor.tenantId, code);
    if (!asset) throw new AssetNotFoundError(code);
    return asset;
  }

  /** Sửa hồ sơ kỹ thuật của thiết bị: thông số và danh sách đầu việc mặc định. */
  async updateAsset(
    actor: InventoryActor,
    code: string,
    patch: UpdateAssetRequest,
  ): Promise<Asset> {
    for (const task of patch.taskTemplate ?? []) {
      if (!task.key?.trim() || !task.name?.trim()) {
        throw new InventoryError('VALIDATION', 'Mỗi đầu việc phải có mã và tên.');
      }
    }
    const keys = (patch.taskTemplate ?? []).map((task) => task.key.trim().toUpperCase());
    if (new Set(keys).size !== keys.length) {
      throw new InventoryError('VALIDATION', 'Mã đầu việc phải là duy nhất trong một thiết bị.');
    }

    let parentId: string | undefined;
    if (patch.parentCode) {
      if (patch.parentCode.trim().toUpperCase() === code.trim().toUpperCase()) {
        throw new InventoryError('VALIDATION', 'Thiết bị không thể là cha của chính nó.');
      }
      const parent = await this.store.asset.findAnyByCode(actor.tenantId, patch.parentCode.trim());
      if (!parent) throw new AssetNotFoundError(patch.parentCode.trim());
      parentId = parent.id;
    }

    const updated = await this.store.asset.update(actor.tenantId, code, patch, parentId);
    if (!updated) throw new AssetNotFoundError(code);
    return updated;
  }

  listAssets(actor: InventoryActor): Promise<Asset[]> {
    return this.store.asset.list(actor.tenantId);
  }

  /** Feeds Role E task decomposition in the Procedure module. */
  async resolveAssetTaskTemplate(
    actor: InventoryActor,
    assetCode: string,
  ): Promise<Record<string, unknown>[] | null> {
    await this.getAsset(actor, assetCode);
    return this.store.taskTemplate.resolveAssetTaskTemplate(actor.tenantId, assetCode);
  }

  getStockLevel(
    actor: InventoryActor,
    materialCode: string,
    warehouseCode: string,
  ): Promise<MaterialInventory | null> {
    return this.store.inventory.findByMaterialAndWarehouse(
      actor.tenantId,
      materialCode,
      warehouseCode,
    );
  }

  listStockByWarehouse(actor: InventoryActor, warehouseCode: string): Promise<MaterialInventory[]> {
    return this.store.inventory.listByWarehouse(actor.tenantId, warehouseCode);
  }

  listRecentTransactions(actor: InventoryActor, limit = 50): Promise<InventoryTransaction[]> {
    return this.store.transaction.listRecent(actor.tenantId, Math.min(Math.max(limit, 1), 200));
  }

  listReservations(actor: InventoryActor): Promise<Reservation[]> {
    return this.store.reservation.list(actor.tenantId);
  }

  listSerials(actor: InventoryActor): Promise<SerialTracking[]> {
    return this.store.serial.list(actor.tenantId);
  }

  /** Inbound movement — positive ledger quantity. */
  receiveStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      unitCost?: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ): Promise<InventoryTransaction> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    return this.store.transaction.append(actor.tenantId, {
      ...input,
      type: 'IMPORT',
      quantity: input.quantity,
      createdBy: actor.userId,
    });
  }

  /** Outbound movement — stored as a negative ledger quantity. */
  issueStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ): Promise<InventoryTransaction> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    return this.store.transaction.append(actor.tenantId, {
      ...input,
      type: 'EXPORT',
      quantity: -input.quantity,
      createdBy: actor.userId,
    });
  }

  /** Two ledger rows: TRANSFER_OUT at source, TRANSFER_IN at destination. */
  async transferStock(
    actor: InventoryActor,
    input: {
      fromWarehouseCode: string;
      toWarehouseCode: string;
      materialCode: string;
      quantity: number;
      note?: string;
    },
  ): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    if (input.fromWarehouseCode === input.toWarehouseCode) {
      throw new InvalidReservationError('Kho nguồn và kho đích phải khác nhau.');
    }

    const out = await this.store.transaction.append(actor.tenantId, {
      warehouseCode: input.fromWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_OUT',
      quantity: -input.quantity,
      note: input.note,
      createdBy: actor.userId,
    });
    const inbound = await this.store.transaction.append(actor.tenantId, {
      warehouseCode: input.toWarehouseCode,
      materialCode: input.materialCode,
      type: 'TRANSFER_IN',
      quantity: input.quantity,
      referenceType: 'inventory_transaction',
      referenceId: out.id,
      note: input.note,
      createdBy: actor.userId,
    });

    return { out, in: inbound };
  }

  createStockReservation(
    actor: InventoryActor,
    request: CreateStockReservationRequest,
  ): Promise<Reservation> {
    this.requireStockWriter(actor);
    if (!request.items?.length) {
      throw new InvalidReservationError('Yêu cầu giữ vật tư phải có ít nhất một dòng.');
    }
    for (const item of request.items) {
      this.requirePositive(item.quantityReserved);
    }

    return this.store.reservation.create(actor.tenantId, {
      referenceType: request.referenceType,
      referenceId: request.referenceId,
      expiresAt: request.expiresAt,
      createdBy: actor.userId,
      items: request.items.map((item) => ({
        warehouseCode: request.warehouseCode,
        materialCode: item.materialCode,
        quantityReserved: item.quantityReserved,
      })),
    });
  }

  /** Nhả giữ chỗ, trả số lượng về khả dụng. Idempotent ở tầng store. */
  async releaseReservation(actor: InventoryActor, code: string): Promise<Reservation> {
    this.requireStockWriter(actor);
    const released = await this.store.reservation.release(actor.tenantId, code);
    if (!released) {
      throw new InvalidReservationError(`Không tìm thấy phiếu giữ vật tư ${code}.`);
    }
    return released;
  }

  async getReservation(actor: InventoryActor, code: string): Promise<Reservation> {
    const reservation = await this.store.reservation.findByCode(actor.tenantId, code);
    if (!reservation) {
      throw new InvalidReservationError(`Không tìm thấy phiếu giữ vật tư ${code}.`);
    }
    return reservation;
  }

  findReservationsByReference(
    actor: InventoryActor,
    referenceType: string,
    referenceId: string,
  ): Promise<Reservation[]> {
    return this.store.reservation.findByReference(actor.tenantId, referenceType, referenceId);
  }

  /**
   * Tổng tồn khả dụng của một vật tư trên toàn bộ kho, kèm chi tiết từng kho.
   *
   * Quy trình gọi lúc chạy để biết bước có đủ vật tư không. Cộng dồn ở đây thay
   * vì bắt bên gọi lặp qua từng kho — số kho là chuyện nội bộ của Kho.
   */
  async getAvailability(
    actor: InventoryActor,
    materialCode: string,
  ): Promise<{
    materialCode: string;
    materialName: string;
    unit: string;
    available: number;
    byWarehouse: { warehouseCode: string; available: number }[];
  }> {
    const material = await this.getMaterial(actor, materialCode);
    const warehouses = await this.store.warehouse.list(actor.tenantId);

    const byWarehouse: { warehouseCode: string; available: number }[] = [];
    for (const warehouse of warehouses) {
      const row = await this.store.inventory.findByMaterialAndWarehouse(
        actor.tenantId,
        material.code,
        warehouse.code,
      );
      if (row) byWarehouse.push({ warehouseCode: warehouse.code, available: row.available });
    }

    return {
      materialCode: material.code,
      materialName: material.name,
      unit: material.unit,
      available: byWarehouse.reduce((sum, item) => sum + item.available, 0),
      byWarehouse,
    };
  }

  // ==========================================================================
  // Danh mục vật tư — thêm / sửa / ngừng hoạt động
  // ==========================================================================

  async createMaterial(actor: InventoryActor, input: CreateMaterialRequest): Promise<Material> {
    this.requireManager(actor);
    const code = input.code?.trim().toUpperCase();
    if (!code) throw new InventoryError('VALIDATION', 'Mã vật tư không được để trống.');
    if (!input.name?.trim()) throw new InventoryError('VALIDATION', 'Tên vật tư không được để trống.');
    if (!input.unit?.trim()) throw new InventoryError('VALIDATION', 'Đơn vị tính không được để trống.');
    this.requireStockBounds(input.minStock, input.maxStock);

    // Kiểm cả vật tư đã ngừng hoạt động: mã vẫn chiếm chỗ, và tạo trùng sẽ vỡ
    // ràng buộc UNIQUE với thông báo khó hiểu của Postgres.
    if (await this.store.material.findAnyByCode(actor.tenantId, code)) {
      throw new InventoryError('VALIDATION', `Mã vật tư ${code} đã tồn tại.`);
    }
    return this.store.material.create(actor.tenantId, { ...input, code, name: input.name.trim() });
  }

  async updateMaterial(
    actor: InventoryActor,
    code: string,
    patch: UpdateMaterialRequest,
  ): Promise<Material> {
    this.requireManager(actor);
    const current = await this.store.material.findAnyByCode(actor.tenantId, code);
    if (!current) throw new MaterialNotFoundError(code);
    this.requireStockBounds(
      patch.minStock ?? current.minStock,
      patch.maxStock ?? current.maxStock,
    );
    const updated = await this.store.material.update(actor.tenantId, code, patch);
    if (!updated) throw new MaterialNotFoundError(code);
    return updated;
  }

  /**
   * Ngừng dùng một vật tư.
   *
   * Chưa từng phát sinh giao dịch thì xoá hẳn; đã có giao dịch thì chỉ hạ cờ
   * `isActive` — sổ cái là append-only, xoá vật tư sẽ làm mồ côi mọi dòng lịch
   * sử trỏ vào nó.
   */
  async retireMaterial(actor: InventoryActor, code: string): Promise<RetireResult> {
    this.requireManager(actor);
    const material = await this.store.material.findAnyByCode(actor.tenantId, code);
    if (!material) throw new MaterialNotFoundError(code);

    const used = await this.store.material.countTransactions(actor.tenantId, code);
    if (used === 0) {
      await this.store.material.delete(actor.tenantId, code);
      return { code, mode: 'deleted' };
    }
    await this.store.material.update(actor.tenantId, code, { isActive: false });
    return {
      code,
      mode: 'deactivated',
      reason: `Vật tư đã có ${used} giao dịch trong sổ cái nên chỉ được ngừng hoạt động, không xoá.`,
    };
  }

  // ==========================================================================
  // Danh mục thiết bị — thêm / thanh lý
  // ==========================================================================

  async createAsset(actor: InventoryActor, input: CreateAssetRequest): Promise<Asset> {
    this.requireManager(actor);
    const code = input.code?.trim().toUpperCase();
    if (!code) throw new InventoryError('VALIDATION', 'Mã thiết bị không được để trống.');
    if (!input.name?.trim()) throw new InventoryError('VALIDATION', 'Tên thiết bị không được để trống.');
    if (await this.store.asset.findAnyByCode(actor.tenantId, code)) {
      throw new InventoryError('VALIDATION', `Mã thiết bị ${code} đã tồn tại.`);
    }

    let parentId: string | undefined;
    if (input.parentCode?.trim()) {
      const parent = await this.store.asset.findAnyByCode(actor.tenantId, input.parentCode.trim());
      if (!parent) throw new AssetNotFoundError(input.parentCode.trim());
      parentId = parent.id;
    }
    return this.store.asset.create(actor.tenantId, { ...input, code, name: input.name.trim() }, parentId);
  }

  /**
   * Thanh lý một thiết bị.
   *
   * Chưa có thiết bị con thì xoá hẳn; còn con thì chuyển `status='DISPOSED'` —
   * xoá node cha sẽ làm cả nhánh con mồ côi và biến mất khỏi cây.
   */
  async retireAsset(actor: InventoryActor, code: string): Promise<RetireResult> {
    this.requireManager(actor);
    const asset = await this.store.asset.findAnyByCode(actor.tenantId, code);
    if (!asset) throw new AssetNotFoundError(code);

    const children = await this.store.asset.countChildren(actor.tenantId, code);
    if (children === 0) {
      await this.store.asset.delete(actor.tenantId, code);
      return { code, mode: 'deleted' };
    }
    await this.store.asset.update(actor.tenantId, code, { status: 'DISPOSED' });
    return {
      code,
      mode: 'deactivated',
      reason: `Thiết bị còn ${children} thiết bị con nên chỉ được đánh dấu thanh lý, không xoá.`,
    };
  }

  private requireStockBounds(min?: number, max?: number): void {
    const low = min ?? 0;
    const high = max ?? 0;
    if (low < 0 || high < 0) {
      throw new InventoryError('VALIDATION', 'Tồn tối thiểu và tối đa không được âm.');
    }
    if (high > 0 && low > high) {
      throw new InventoryError('VALIDATION', 'Tồn tối thiểu không được lớn hơn tồn tối đa.');
    }
  }

  /** Phụ tùng tiêu chuẩn của một thiết bị. */
  async listAssetBom(actor: InventoryActor, assetCode: string): Promise<AssetBomLine[]> {
    const asset = await this.store.asset.findAnyByCode(actor.tenantId, assetCode);
    if (!asset) throw new AssetNotFoundError(assetCode);
    return this.store.bom.listByAsset(actor.tenantId, assetCode);
  }

  async addAssetBom(
    actor: InventoryActor,
    assetCode: string,
    input: AddAssetBomRequest,
  ): Promise<AssetBomLine> {
    this.requireManager(actor);
    const quantity = Number(input?.standardQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InventoryError('VALIDATION', 'Định mức phụ tùng phải là số dương.');
    }
    const materialCode = input?.materialCode?.trim().toUpperCase();
    if (!materialCode) throw new InventoryError('VALIDATION', 'Thiếu mã vật tư.');
    return this.store.bom.add(actor.tenantId, assetCode, {
      materialCode,
      standardQuantity: quantity,
      isCriticalSpare: input.isCriticalSpare,
      note: input.note?.trim() || undefined,
    });
  }

  async removeAssetBom(actor: InventoryActor, assetCode: string, bomId: string): Promise<void> {
    this.requireManager(actor);
    const removed = await this.store.bom.remove(actor.tenantId, assetCode, bomId);
    if (!removed) {
      throw new InventoryError('BOM_NOT_FOUND', 'Không tìm thấy dòng phụ tùng cần xoá.', 404);
    }
  }

  /**
   * Đọc cả cấu hình module. Khoá chưa có dòng trong bảng trả về mặc định với
   * `version: 0`, nên client vẫn gửi lại được `expectedVersion` ở lần ghi đầu.
   */
  async getSettings(actor: InventoryActor): Promise<InventorySettingsSnapshot> {
    const stored = new Map(
      (await this.store.settings.list(actor.tenantId)).map((entry) => [entry.key, entry]),
    );
    const snapshot = {} as Record<string, SettingsEntry<unknown>>;
    for (const key of INVENTORY_SETTINGS_KEYS) {
      const entry = stored.get(key);
      snapshot[key] = entry
        ? { ...entry, value: normalizeInventorySetting(key, entry.value) }
        : {
            key,
            value: INVENTORY_SETTINGS_DEFAULTS[key],
            version: 0,
            updatedAt: new Date(0).toISOString(),
          };
    }
    return snapshot as InventorySettingsSnapshot;
  }

  async updateSetting<K extends InventorySettingsKey>(
    actor: InventoryActor,
    key: K,
    input: UpdateSettingsRequest<unknown>,
  ): Promise<SettingsEntry<unknown>> {
    this.requireManager(actor);
    if (!isInventorySettingsKey(key)) throw new UnknownSettingsKeyError(key);

    // Chuẩn hoá trước khi ghi: bảng là khoá–giá trị nên đây là chỗ duy nhất
    // ngăn một payload lạ nằm nguyên trạng trong database.
    const value = normalizeInventorySetting(key, input?.value);
    // version 0 nghĩa là "lúc đọc chưa có dòng nào". Vẫn phải gửi xuống SQL chứ
    // không được bỏ qua: không dòng nào mang version 0, nên mệnh đề WHERE sẽ
    // chặn đúng trường hợp hai admin cùng đọc "chưa có" rồi cùng ghi. Chỉ khi
    // client không gửi gì mới là cố ý ghi đè bất chấp.
    const raw = input?.expectedVersion;
    const expected = Number.isInteger(raw) && Number(raw) >= 0 ? Number(raw) : undefined;
    const saved = await this.store.settings.put(
      actor.tenantId,
      key,
      value,
      actor.userId,
      expected,
    );
    if (!saved) throw new SettingsVersionConflictError(key);
    return { ...saved, value: normalizeInventorySetting(key, saved.value) };
  }

  private requireManager(actor: InventoryActor): void {
    if (!actor.canManage) {
      throw new InvalidReservationError('Bạn không có quyền sửa danh mục kho.');
    }
  }

  /** Cổng cho nhập/xuất/chuyển kho và giữ chỗ — rộng hơn quyền sửa danh mục. */
  private requireStockWriter(actor: InventoryActor): void {
    if (!(actor.canWriteTransactions ?? actor.canManage)) {
      throw new InvalidReservationError('Bạn không có quyền ghi phát sinh tồn kho.');
    }
  }

  private requirePositive(quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InvalidReservationError('Số lượng phải là số dương.');
    }
  }
}
