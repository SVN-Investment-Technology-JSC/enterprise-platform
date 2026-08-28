import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  RegisterSerialsRequest,
  UpdateSerialRequest,
  InstallItemRequest,
  InstalledMaterial,
  UninstallMaterialRequest,
  AddAssetBomRequest,
  Asset,
  AssetBomLine,
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  InventoryItem,
  InventorySettingsKey,
  InventorySettingsSnapshot,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  RetireResult,
  ReturnItemToStockRequest,
  SerialTracking,
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

  /**
   * Khai một kho mới.
   *
   * Mã viết hoa và là khoá nghiệp vụ: mọi bút toán trỏ vào kho qua mã này, nên
   * nó không sửa được sau khi tạo — đổi mã là làm mồ côi toàn bộ sổ cái của kho.
   */
  async createWarehouse(actor: InventoryActor, input: CreateWarehouseRequest): Promise<Warehouse> {
    this.requireManager(actor);
    const code = input?.code?.trim().toUpperCase();
    if (!code) throw new InventoryError('VALIDATION', 'Mã kho không được để trống.');
    if (!input?.name?.trim()) throw new InventoryError('VALIDATION', 'Tên kho không được để trống.');
    if (await this.store.warehouse.findByCode(actor.tenantId, code)) {
      throw new InventoryError('VALIDATION', `Mã kho ${code} đã tồn tại.`);
    }
    return this.store.warehouse.create(actor.tenantId, {
      ...input,
      code,
      name: input.name.trim(),
      location: input.location?.trim() || undefined,
    });
  }

  /**
   * Sửa một kho. Không có đường xoá — chỉ ngừng dùng.
   *
   * Và ngừng dùng một kho CÒN HÀNG thì từ chối: kho biến mất khỏi mọi ô chọn
   * trong khi số tồn vẫn nằm đó, không ai xuất ra được nữa và cũng không thấy
   * nó ở đâu. Chuyển hàng đi trước.
   */
  async updateWarehouse(
    actor: InventoryActor,
    code: string,
    patch: UpdateWarehouseRequest,
  ): Promise<Warehouse> {
    this.requireManager(actor);
    if (patch?.isActive === false) {
      const onHand = await this.store.warehouse.stockTotal(actor.tenantId, code);
      if (onHand > 0) {
        throw new InventoryError(
          'VALIDATION',
          `Kho ${code} còn ${onHand} đơn vị hàng. Chuyển hết đi trước khi ngừng dùng.`,
        );
      }
    }
    const updated = await this.store.warehouse.update(actor.tenantId, code, {
      ...patch,
      name: patch?.name?.trim() || undefined,
      location: patch?.location?.trim() || undefined,
    });
    if (!updated) throw new WarehouseNotFoundError(code);
    return updated;
  }

  /** Gồm cả kho đã ngừng dùng — màn Cài đặt phải thấy để bật lại được. */
  listAllWarehouses(actor: InventoryActor): Promise<Warehouse[]> {
    return this.store.warehouse.listAll(actor.tenantId);
  }

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

  /**
   * Lịch sử nhập/xuất của một mã vật tư.
   *
   * Kiểm mã tồn tại trước khi truy sổ: mã sai mà trả mảng rỗng thì người dùng
   * tưởng vật tư chưa từng luân chuyển, trong khi thực ra họ gõ nhầm mã.
   */
  async listMaterialHistory(
    actor: InventoryActor,
    code: string,
    limit = 50,
  ): Promise<InventoryTransaction[]> {
    await this.getMaterial(actor, code);
    return this.store.transaction.listByMaterial(actor.tenantId, code, Math.min(limit, 200));
  }

  /**
   * Danh mục hợp nhất — vật tư kho và thiết bị trong một danh sách.
   *
   * Từ lượt gộp dữ liệu, cả hai đã là cùng một bảng; tách làm hai màn hình chỉ
   * còn là di sản của mô hình cũ.
   */
  /**
   * Lắp vật tư từ kho vào một thiết bị — một lệnh XUẤT.
   *
   * Mã vật tư KHÔNG rời khỏi danh mục kho. Lắp 1 mét cáp thì kho còn 2999 mét,
   * vì mét là đơn vị tính chứ không phải một khối cố định. Bản trước lật cờ
   * `kind` của cả mã: lắp 1 mét làm toàn bộ 3000 mét biến mất khỏi danh mục kho
   * trong khi số dư vẫn nằm đó, không ai trỏ tới.
   *
   * Phần đã lắp được suy ra từ chính bút toán này qua `reference_id`, nên không
   * có nguồn sự thật thứ hai để lệch.
   */
  async installItem(
    actor: InventoryActor,
    code: string,
    input: InstallItemRequest,
  ): Promise<InventoryTransaction> {
    this.requireManager(actor);
    this.requireStockWriter(actor);

    const parentCode = input?.parentCode?.trim();
    if (!parentCode) {
      throw new InventoryError('VALIDATION', 'Cần chọn thiết bị để lắp vào.');
    }
    if (code === parentCode) {
      throw new InventoryError('VALIDATION', 'Không thể lắp một vật tư vào chính nó.');
    }
    const parent = await this.store.asset.findAnyByCode(actor.tenantId, parentCode);
    if (!parent) throw new AssetNotFoundError(parentCode);

    const warehouseCode = input?.warehouseCode?.trim();
    if (!warehouseCode) {
      throw new InventoryError('VALIDATION', 'Phải chọn kho xuất hàng.');
    }
    if (!(await this.store.warehouse.findByCode(actor.tenantId, warehouseCode))) {
      throw new InventoryError('NOT_FOUND', `Không tìm thấy kho ${warehouseCode}.`, 404);
    }

    const quantity = input.quantity ?? 1;
    this.requirePositive(quantity);

    /**
     * Mỗi lần lắp sinh MỘT DÒNG vật tư riêng, không lật cờ mã gốc.
     *
     * `code` là UNIQUE nên một mã kho lắp ở hai chỗ không thể là một dòng. Và vì
     * đơn vị này là dòng vật tư bình thường, nó lại lắp được vật tư con — không
     * có cấp nào trên cây là cấp cuối.
     */
    const unit = await this.store.item.createInstalledUnit(actor.tenantId, code, parentCode);
    if (unit === 'not_found') {
      throw new InventoryError('NOT_FOUND', 'Không tìm thấy vật tư hoặc vật tư cha.', 404);
    }

    try {
      // Số âm vì đây là chiều xuất. Không đủ tồn thì tầng ghi số dư từ chối.
      return await this.store.transaction.append(actor.tenantId, {
        warehouseCode,
        materialCode: code,
        type: 'EXPORT',
        quantity: -quantity,
        referenceType: 'asset',
        referenceId: unit.unitId,
        note: input.note?.trim() || `Lắp ${code} vào ${parentCode}.`,
        createdBy: actor.userId,
      });
    } catch (cause) {
      // Dòng đơn vị được tạo ở một transaction khác với bút toán, nên khi bút
      // toán hỏng (thiếu tồn) nó không tự cuốn theo. Không dọn thì cây mọc ra
      // một node không có số lượng nào đứng sau.
      await this.store.item.deactivateUnit(actor.tenantId, unit.unitCode);
      throw cause;
    }
  }

  /**
   * Hồ sơ đầy đủ của MỘT MÃ BẤT KỲ.
   *
   * Trước đây hồ sơ chỉ mở được từ cây thiết bị, vì `getAsset` đi qua view
   * `assets` vốn lọc `kind = 'ASSET'` — tra một mã kho bằng đường đó luôn ra
   * 404. Mà từ khi có vị trí và theo dõi theo sê-ri thì mã kho cũng có đủ thứ
   * để xem: sê-ri, tình trạng, vị trí, tài liệu.
   */
  async getItemProfile(actor: InventoryActor, code: string): Promise<Asset> {
    const item = await this.store.item.findProfile(actor.tenantId, code);
    if (!item) throw new AssetNotFoundError(code);
    return item;
  }

  /** Sửa hồ sơ của một mã bất kể loại. */
  async updateItemProfile(
    actor: InventoryActor,
    code: string,
    patch: UpdateAssetRequest,
  ): Promise<Asset> {
    this.requireManager(actor);
    this.requireValidYear(patch.manufactureYear);

    let parentId: string | undefined | null;
    if (patch.parentCode !== undefined) {
      const trimmed = patch.parentCode?.trim();
      if (!trimmed) parentId = null;
      else {
        const parent = await this.store.item.findProfile(actor.tenantId, trimmed);
        if (!parent) throw new AssetNotFoundError(trimmed);
        parentId = parent.id;
      }
    }

    const updated = await this.store.item.updateProfile(actor.tenantId, code, patch, parentId);
    if (!updated) throw new AssetNotFoundError(code);
    return updated;
  }

  /** Vật tư đang lắp trên từng thiết bị. */
  listInstalled(actor: InventoryActor): Promise<InstalledMaterial[]> {
    return this.store.item.listInstalled(actor.tenantId);
  }

  /**
   * Tháo bớt vật tư đang lắp trên một thiết bị, NHẬP ngược về kho.
   *
   * Cùng `reference_id` với lúc lắp nên hai bút toán triệt tiêu nhau: tháo hết
   * thì cặp thiết bị–vật tư biến mất khỏi cây thay vì nằm lại thành dòng 0.
   */
  async uninstallMaterial(
    actor: InventoryActor,
    unitCode: string,
    input: UninstallMaterialRequest,
  ): Promise<InventoryTransaction> {
    this.requireManager(actor);
    this.requireStockWriter(actor);

    const unit = await this.store.asset.findAnyByCode(actor.tenantId, unitCode);
    if (!unit) throw new AssetNotFoundError(unitCode);

    const warehouseCode = input?.warehouseCode?.trim();
    if (!warehouseCode) {
      throw new InventoryError('VALIDATION', 'Phải chọn kho tiếp nhận.');
    }
    if (!(await this.store.warehouse.findByCode(actor.tenantId, warehouseCode))) {
      throw new InventoryError('NOT_FOUND', `Không tìm thấy kho ${warehouseCode}.`, 404);
    }

    // Đơn vị này vốn là mã gì thì SỔ CÁI biết, không cột nào phải ghi lại.
    const installed = await this.store.item.listInstalled(actor.tenantId);
    const line = installed.find((entry) => entry.unitCode === unitCode);
    if (!line) {
      throw new InventoryError(
        'VALIDATION',
        `${unitCode} không phải một đơn vị đang lắp, hoặc đã tháo hết rồi.`,
      );
    }

    const quantity = input.quantity ?? line.quantity;
    this.requirePositive(quantity);

    // Tháo nhiều hơn số đang lắp là đẻ hàng từ hư không — cùng một luật với
    // chiều xuất, chỉ khác chiều.
    if (quantity > line.quantity) {
      throw new InventoryError(
        'VALIDATION',
        `${unitCode} chỉ đang lắp ${line.quantity} ${line.unit ?? ''}, không tháo được ${quantity}.`,
      );
    }

    // Còn cấu phần con thì không tháo: con sẽ mồ côi giữa cây.
    const children = await this.store.asset.countChildren(actor.tenantId, unitCode);
    if (children > 0) {
      throw new InventoryError(
        'VALIDATION',
        `${unitCode} còn ${children} vật tư con. Tháo các con đi trước.`,
      );
    }

    const receipt = await this.store.transaction.append(actor.tenantId, {
      warehouseCode,
      materialCode: line.materialCode,
      type: 'RETURN',
      quantity,
      referenceType: 'asset',
      referenceId: unit.id,
      note:
        input.note?.trim() || `Tháo ${unitCode} về kho ${warehouseCode}.`,
      createdBy: actor.userId,
    });

    // Tháo hết thì đơn vị rời khỏi cây. Ngừng dùng chứ không xoá — bút toán
    // lắp–tháo của nó vẫn phải trỏ được vào một dòng có thật.
    if (quantity === line.quantity) {
      await this.store.item.deactivateUnit(actor.tenantId, unitCode);
    }

    return receipt;
  }

  /**
   * Thanh lý: tháo vật tư khỏi cây lắp đặt và NHẬP nó về một kho cụ thể.
   *
   * Phải chọn kho, không có kho mặc định. Bản trước chỉ lật cờ trong danh mục mà
   * không ghi bút toán nào — vật tư "về kho" nhưng không kho nào tăng tồn, nên
   * đếm thực tế và số trên sổ lệch nhau kể từ thao tác đó mà không ai biết.
   *
   * Đây là một lệnh NHẬP thật, do thủ kho bấm trực tiếp trong module Kho, nên
   * ghi thẳng vào sổ cái là đúng chỗ.
   */
  async returnItemToStock(
    actor: InventoryActor,
    code: string,
    input: ReturnItemToStockRequest,
  ): Promise<InventoryTransaction> {
    this.requireManager(actor);
    this.requireStockWriter(actor);

    const warehouseCode = input?.warehouseCode?.trim();
    if (!warehouseCode) {
      throw new InventoryError('VALIDATION', 'Phải chọn kho tiếp nhận trước khi thanh lý.');
    }
    const warehouse = await this.store.warehouse.findByCode(actor.tenantId, warehouseCode);
    if (!warehouse) {
      throw new InventoryError('NOT_FOUND', `Không tìm thấy kho ${warehouseCode}.`, 404);
    }

    // Thiết bị tháo ra là một cá thể; vật tư rời thì thủ kho đếm được bao nhiêu
    // nhập bấy nhiêu.
    const quantity = input.quantity ?? 1;
    this.requirePositive(quantity);

    /**
     * Vật tư trong kho bắt buộc phải có ĐƠN VỊ TÍNH (ràng buộc
     * `materials_stock_requires_category`). Thiết bị có thể chưa khai đơn vị,
     * nên kiểm ở đây để trả 400 kèm hướng dẫn, thay vì để ràng buộc database
     * ném ra và tầng trên biến thành "Internal server error".
     */
    const item = await this.store.asset.findAnyByCode(actor.tenantId, code);
    if (item && !item.unit?.trim()) {
      throw new InventoryError(
        'VALIDATION',
        'Vật tư chưa khai đơn vị tính nên chưa trả về kho được. Mở hồ sơ và chọn đơn vị trước.',
      );
    }
    const result = await this.store.item.returnToStock(actor.tenantId, code);
    if (result === 'has_children') {
      throw new InventoryError(
        'VALIDATION',
        'Vật tư này còn cấu phần con. Tháo hoặc chuyển các con đi trước, nếu không chúng sẽ mồ côi giữa cây.',
      );
    }
    if (result === 'not_found') {
      throw new InventoryError('NOT_FOUND', 'Không tìm thấy vật tư.', 404);
    }

    return this.store.transaction.append(actor.tenantId, {
      warehouseCode,
      materialCode: code,
      type: 'RETURN',
      quantity,
      note: input.note?.trim() || `Thanh lý ${code} về kho ${warehouseCode}.`,
      createdBy: actor.userId,
    });
  }

  listItems(actor: InventoryActor): Promise<InventoryItem[]> {
    return this.store.item.listAll(actor.tenantId);
  }

  async getAsset(actor: InventoryActor, code: string): Promise<Asset> {
    const asset = await this.store.asset.findByCode(actor.tenantId, code);
    if (!asset) throw new AssetNotFoundError(code);
    return asset;
  }

  /** Sửa hồ sơ kỹ thuật của thiết bị: thông số và danh sách đầu việc mặc định. */
  /**
   * Chặn năm sản xuất vô lý ở TẦNG ỨNG DỤNG, không để CHECK của database bắt.
   *
   * Ràng buộc database vẫn giữ làm lưới an toàn cuối, nhưng nó ném ra lỗi
   * Postgres và tầng trên biến thành 500 — người dùng nhận "Internal server
   * error" cho một lỗi nhập liệu. Bắt ở đây mới trả về 400 kèm câu giải thích.
   */
  private requireValidYear(year: number | undefined): void {
    if (year === undefined) return;
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new InventoryError('VALIDATION', 'Năm sản xuất phải là số nguyên từ 1900 đến 2200.');
    }
  }

  async updateAsset(
    actor: InventoryActor,
    code: string,
    patch: UpdateAssetRequest,
  ): Promise<Asset> {
    this.requireValidYear(patch.manufactureYear);
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

  listSerials(actor: InventoryActor, materialCode?: string): Promise<SerialTracking[]> {
    const code = materialCode?.trim();
    return code
      ? this.store.serial.listByMaterial(actor.tenantId, code)
      : this.store.serial.list(actor.tenantId);
  }

  /**
   * Khai sê-ri cho một mã vật tư.
   *
   * Giá trị mặc định lấy từ chính danh mục admin đã khai, không phải hằng số
   * trong code: sau migration 0009 thì danh sách này là của tenant, đoán hộ họ
   * một giá trị dựng sẵn sẽ đẻ ra dữ liệu không nằm trong danh mục nào.
   */
  async registerSerials(
    actor: InventoryActor,
    input: RegisterSerialsRequest,
  ): Promise<{ added: number; total: number }> {
    this.requireManager(actor);

    const materialCode = input?.materialCode?.trim().toUpperCase();
    if (!materialCode) throw new InventoryError('VALIDATION', 'Thiếu mã vật tư.');
    if (!(await this.store.material.findAnyByCode(actor.tenantId, materialCode))) {
      throw new MaterialNotFoundError(materialCode);
    }

    // Bỏ trùng và bỏ rỗng ngay: dán một cột từ Excel gần như luôn kéo theo dòng
    // trắng, và hai dòng giống nhau thì chỉ là một cá thể.
    const serials = [
      ...new Set((input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean)),
    ];
    if (serials.length === 0) {
      throw new InventoryError('VALIDATION', 'Chưa nhập số sê-ri nào.');
    }

    const states = (await this.getSettings(actor))['catalog.asset'].value.usageStates;
    const added = await this.store.serial.register(
      actor.tenantId,
      materialCode,
      serials,
      input.currentStatus?.trim() || 'OPERATING',
      input.locationType?.trim() || states[0] || '',
      input.warehouseCode?.trim(),
    );

    // Khai sê-ri CHÍNH LÀ tuyên bố mã này theo dõi theo cá thể. Không bật cờ thì
    // khối "Cá thể theo sê-ri" không hiện, và người vừa nhập xong tưởng dữ liệu
    // rơi mất.
    await this.store.material.update(actor.tenantId, materialCode, { isSerialized: true });

    const total = (await this.store.serial.listByMaterial(actor.tenantId, materialCode)).length;
    return { added, total };
  }

  async updateSerial(
    actor: InventoryActor,
    materialCode: string,
    serialNumber: string,
    patch: UpdateSerialRequest,
  ): Promise<SerialTracking> {
    this.requireManager(actor);
    const updated = await this.store.serial.update(
      actor.tenantId,
      materialCode.trim().toUpperCase(),
      serialNumber.trim(),
      {
        currentStatus: patch?.currentStatus?.trim() || undefined,
        locationType: patch?.locationType?.trim() || undefined,
        internalCode: patch?.internalCode?.trim() || undefined,
      },
    );
    if (!updated) {
      throw new InventoryError('NOT_FOUND', `Không tìm thấy sê-ri ${serialNumber}.`, 404);
    }
    return updated;
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
    this.requireValidYear(input.manufactureYear);
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
    this.requireValidYear(patch.manufactureYear);
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
   * Ngừng dùng một vật tư — KHÔNG BAO GIỜ xoá.
   *
   * Sổ cái là append-only và mã vật tư là thứ mọi bút toán trỏ vào. Xoá một mã,
   * kể cả mã chưa phát sinh giao dịch nào, mở đường cho việc mã đó được dựng lại
   * sau này với ý nghĩa khác trong khi lịch sử cũ vẫn mang tên nó. Ngừng dùng
   * chỉ ẩn mã khỏi các ô chọn; số liệu và lịch sử giữ nguyên.
   */
  async retireMaterial(actor: InventoryActor, code: string): Promise<RetireResult> {
    this.requireManager(actor);
    const material = await this.store.material.findAnyByCode(actor.tenantId, code);
    if (!material) throw new MaterialNotFoundError(code);

    const used = await this.store.material.countTransactions(actor.tenantId, code);
    await this.store.material.update(actor.tenantId, code, { isActive: false });
    return {
      code,
      mode: 'deactivated',
      reason:
        used > 0
          ? `Mã này đã có ${used} bút toán trong sổ cái. Đã ngừng dùng, lịch sử giữ nguyên.`
          : 'Đã ngừng dùng. Hàng đã vào sổ kho thì không xoá, chỉ nhập hoặc xuất.',
    };
  }

  // ==========================================================================
  // Danh mục thiết bị — thêm / thanh lý
  // ==========================================================================

  async createAsset(actor: InventoryActor, input: CreateAssetRequest): Promise<Asset> {
    this.requireValidYear(input.manufactureYear);
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
   * Đánh dấu một thiết bị đã thanh lý — KHÔNG BAO GIỜ xoá.
   *
   * Còn thiết bị con thì từ chối hẳn: đánh dấu node cha là đã thanh lý trong khi
   * các con vẫn treo dưới nó tạo ra một nhánh cây mà phần gốc không còn tồn tại
   * về mặt nghiệp vụ. Tháo các con ra trước.
   */
  async retireAsset(actor: InventoryActor, code: string): Promise<RetireResult> {
    this.requireManager(actor);
    const asset = await this.store.asset.findAnyByCode(actor.tenantId, code);
    if (!asset) throw new AssetNotFoundError(code);

    const children = await this.store.asset.countChildren(actor.tenantId, code);
    if (children > 0) {
      throw new InventoryError(
        'VALIDATION',
        `Thiết bị còn ${children} cấu phần con. Tháo hoặc chuyển các con đi trước khi thanh lý.`,
      );
    }
    await this.store.asset.update(actor.tenantId, code, { status: 'DISPOSED' });
    return {
      code,
      mode: 'deactivated',
      reason: 'Đã đánh dấu thanh lý. Mã và toàn bộ lịch sử vẫn giữ trong sổ.',
    };
  }

  /**
   * Chỉ còn kiểm SÀN tồn.
   *
   * Trần tồn đã bỏ khỏi giao diện: không luật nào của kho đọc tới nó, nên nó chỉ
   * là một con số bắt phải nhập rồi nằm đó. Luật "sàn không được lớn hơn trần"
   * cũng bỏ theo — giữ lại thì mọi mã có trần cũ sẽ chặn việc nâng sàn, vì lý do
   * người dùng không còn nhìn thấy ở đâu.
   */
  private requireStockBounds(min?: number, max?: number): void {
    if ((min ?? 0) < 0 || (max ?? 0) < 0) {
      throw new InventoryError('VALIDATION', 'Tồn tối thiểu không được âm.');
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
