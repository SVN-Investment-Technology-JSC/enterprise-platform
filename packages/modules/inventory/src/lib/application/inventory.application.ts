import { Inject, Injectable } from '@nestjs/common';
import {
  MATERIAL_KINDS,
  type MaterialKind,
} from '@enterprise-platform/contracts-inventory';
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
  InternalMaterialCatalogPage,
  InternalMaterialCatalogQuery,
  InventoryItem,
  InventorySettingsKey,
  InventorySettingsSnapshot,
  InventoryTransaction,
  LotAllocationInput,
  Material,
  MaterialInventory,
  Reservation,
  RetireResult,
  ReturnItemToStockRequest,
  SerialTracking,
  SettingsEntry,
  StockDocumentLotInput,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSettingsRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port.js';
import { INVENTORY_STORE } from './inventory-store.port.js';
import {
  STOCK_DOCUMENT_STORE,
  type NewStockDocumentInput,
  type StockDocumentStore,
} from './stock-document-store.port.js';
import {
  AssetNotFoundError,
  IdempotencyKeyConflictError,
  InsufficientAvailableStockError,
  InsufficientStockError,
  InventoryError,
  InvalidReservationError,
  MaterialNotFoundError,
  ServiceMaterialNotStockedError,
  SettingsVersionConflictError,
  UnknownSettingsKeyError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import {
  assertExpiryInFuture,
  normalizeReservationRequest,
  reservationRequestHash,
} from '../domain/reservation-policy.js';
import {
  INVENTORY_SETTINGS_DEFAULTS,
  isInventorySettingsKey,
  normalizeInventorySetting,
} from './inventory-settings.js';
import { INVENTORY_SETTINGS_KEYS } from '@enterprise-platform/contracts-inventory';
import { normalizeLotInput, splitByLots } from '../domain/traceability-policy.js';

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
  /**
   * Duyệt, từ chối chứng từ kho (`inventory.document.approve`). Bỏ trống = suy
   * theo `canManage`, như `canWriteTransactions`.
   */
  readonly canApproveDocuments?: boolean;
  /**
   * Đổi trạng thái chất lượng của lô, serial (`inventory.quality.write`). Bỏ
   * trống = suy theo `canManage`.
   */
  readonly canWriteQuality?: boolean;
}

@Injectable()
export class InventoryApplication {
  constructor(
    @Inject(INVENTORY_STORE) private readonly store: InventoryStore,
    @Inject(STOCK_DOCUMENT_STORE) private readonly documents: StockDocumentStore,
  ) {}

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

  listMaterials(actor: InventoryActor, includeInactive = false): Promise<Material[]> {
    return this.store.material.list(actor.tenantId, includeInactive);
  }

  /**
   * Danh mục mặt hàng cho phân hệ khác (T1-24): loại, tồn khả dụng theo kho, giá
   * vốn bình quân, số tháng bảo hành. Không có `limit` thì trả cả danh mục như
   * hành vi cũ mà Quy trình đang dùng; có `limit` thì phân trang theo mã.
   */
  async listMaterialCatalog(
    actor: InventoryActor,
    query: InternalMaterialCatalogQuery,
  ): Promise<InternalMaterialCatalogPage> {
    const normalized = normalizeCatalogQuery(query);
    const rows = await this.store.material.catalog(actor.tenantId, normalized);
    if (!normalized.limit || rows.length <= normalized.limit) {
      return { materials: rows, nextCursor: null };
    }
    const page = rows.slice(0, normalized.limit);
    return { materials: page, nextCursor: page[page.length - 1].code };
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

    const parentCode = input?.parentCode?.trim() || undefined;
    if (parentCode && code === parentCode) {
      throw new InventoryError('VALIDATION', 'Không thể lắp một vật tư vào chính nó.');
    }
    if (parentCode) {
      const parent = await this.store.asset.findAnyByCode(actor.tenantId, parentCode);
      if (!parent) throw new AssetNotFoundError(parentCode);
    }

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
      const actionNote = parentCode
        ? `Lắp ${code} vào ${parentCode}.`
        : `Xuất kho ${code} làm thiết bị gốc trên cây tài sản.`;
      return await this.store.transaction.append(actor.tenantId, {
        warehouseCode,
        materialCode: code,
        type: 'EXPORT',
        quantity: -quantity,
        referenceType: 'asset',
        referenceId: unit.unitId,
        note: input.note?.trim() || actionNote,
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
    const material = await this.store.material.findAnyByCode(actor.tenantId, materialCode);
    if (!material) throw new MaterialNotFoundError(materialCode);
    if (material.kind === 'SERVICE') throw new ServiceMaterialNotStockedError(materialCode);

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

  /**
   * Inbound movement — positive ledger quantity.
   *
   * Từ T1-06 ghi qua chứng từ kho một dòng (nhập theo đơn mua), tạo và ghi sổ
   * trong cùng một transaction, nên bút toán mới có `document_id`. Request và
   * response giữ nguyên; import tồn đầu kỳ cũng đi đường này.
   */
  async receiveStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      unitCost?: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
      lot?: StockDocumentLotInput;
    },
  ): Promise<InventoryTransaction> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    const lot = normalizeLotInput(input.lot, 'IN');
    const posted = await this.postLegacyDocument(actor, {
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: input.warehouseCode,
      sourceType: input.referenceType,
      sourceId: input.referenceId,
      note: input.note,
      createdBy: actor.userId,
      lines: [
        {
          materialCode: input.materialCode,
          quantity: input.quantity,
          direction: 'IN',
          unitCost: input.unitCost ?? 0,
          lot,
        },
      ],
    });
    return posted[0];
  }

  /**
   * Outbound movement — stored as a negative ledger quantity.
   *
   * Ghi qua chứng từ xuất một dòng. Khác trước: kiểm theo tồn khả dụng (tồn trừ
   * phần đã giữ) thay vì tồn thực tế, để xuất tự do không lấy hàng đã giữ cho
   * người khác (T1-09). Lỗi vẫn là 400 INSUFFICIENT_STOCK như cũ.
   */
  async issueStock(
    actor: InventoryActor,
    input: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
      lots?: readonly LotAllocationInput[];
    },
  ): Promise<InventoryTransaction> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    // Phân bổ nhiều lô thành nhiều dòng của cùng một chứng từ; response giữ bút
    // toán của dòng đầu như trước.
    const posted = await this.postLegacyDocument(actor, {
      docType: 'ISSUE_PROJECT',
      warehouseCode: input.warehouseCode,
      sourceType: input.referenceType,
      sourceId: input.referenceId,
      note: input.note,
      createdBy: actor.userId,
      lines: splitByLots(input.quantity, input.lots).map((part) => ({
        materialCode: input.materialCode,
        quantity: part.quantity,
        direction: 'OUT' as const,
        unitCost: 0,
        lot: part.lotNo ? { lotNo: part.lotNo } : undefined,
      })),
    });
    return posted[0];
  }

  /**
   * Hai bút toán EXPORT ở kho nguồn và IMPORT ở kho đích (vế nhập tham chiếu vế
   * xuất), cùng một chứng từ TRANSFER và cùng một transaction: vế nhập lỗi thì
   * vế xuất cũng không còn.
   */
  async transferStock(
    actor: InventoryActor,
    input: {
      fromWarehouseCode: string;
      toWarehouseCode: string;
      materialCode: string;
      quantity: number;
      note?: string;
      lots?: readonly LotAllocationInput[];
    },
  ): Promise<{ out: InventoryTransaction; in: InventoryTransaction }> {
    this.requireStockWriter(actor);
    this.requirePositive(input.quantity);
    if (input.fromWarehouseCode === input.toWarehouseCode) {
      throw new InvalidReservationError('Kho nguồn và kho đích phải khác nhau.');
    }

    const [out, inbound] = await this.postLegacyDocument(actor, {
      docType: 'TRANSFER',
      warehouseCode: input.fromWarehouseCode,
      targetWarehouseCode: input.toWarehouseCode,
      note: input.note,
      createdBy: actor.userId,
      lines: splitByLots(input.quantity, input.lots).map((part) => ({
        materialCode: input.materialCode,
        quantity: part.quantity,
        direction: 'OUT' as const,
        unitCost: 0,
        lot: part.lotNo ? { lotNo: part.lotNo } : undefined,
      })),
    });
    return { out, in: inbound };
  }

  /**
   * Tạo và ghi sổ chứng từ cho đường API cũ. Không qua bước duyệt: loại chứng
   * từ được chọn đều là loại ghi sổ thẳng, và quyền đã kiểm như trước. Lỗi
   * thiếu tồn đổi về `InsufficientStockError` (400) để màn Kho cũ nhận đúng mã.
   */
  private async postLegacyDocument(
    actor: InventoryActor,
    input: NewStockDocumentInput,
  ): Promise<InventoryTransaction[]> {
    try {
      const posted = await this.documents.createAndPost(actor.tenantId, input, actor.userId);
      return [...posted.transactions];
    } catch (error) {
      if (error instanceof InsufficientAvailableStockError) {
        throw new InsufficientStockError(
          error.materialCode,
          error.requested,
          error.available,
          error.warehouseCode,
        );
      }
      throw error;
    }
  }

  /**
   * Giữ hàng nhiều dòng, tất cả hoặc không (Q4), có khoá chống lặp (T1-11).
   *
   * Gọi lại cùng `idempotencyKey` và cùng nội dung trả giữ hàng đã tạo (trạng thái
   * hiện tại của nó), không giữ thêm; khác nội dung thì 409. Kiểm hạn ở tương lai
   * chỉ khi tạo mới, để lần thử lại muộn vẫn nhận được kết quả lần đầu.
   */
  async createStockReservation(
    actor: InventoryActor,
    request: CreateStockReservationRequest,
  ): Promise<Reservation> {
    this.requireStockWriter(actor);
    const normalized = normalizeReservationRequest(request);
    const requestHash = reservationRequestHash(normalized);

    if (normalized.idempotencyKey) {
      const existing = await this.store.reservation.findByIdempotencyKey(
        actor.tenantId,
        normalized.idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyKeyConflictError(normalized.idempotencyKey);
        }
        return existing.reservation;
      }
    }
    assertExpiryInFuture(normalized.expiresAt, new Date());

    return this.store.reservation.create(actor.tenantId, {
      referenceType: normalized.referenceType,
      referenceId: normalized.referenceId,
      sourceType: normalized.sourceType,
      sourceId: normalized.sourceId,
      idempotencyKey: normalized.idempotencyKey,
      requestHash,
      expiresAt: normalized.expiresAt,
      createdBy: actor.userId,
      items: normalized.lines.map((line) => ({
        warehouseCode: line.warehouseCode,
        materialCode: line.materialCode,
        quantityReserved: line.quantity,
      })),
    });
  }

  /**
   * Nhả phần chưa xuất, trả về khả dụng. Idempotent theo trạng thái: giữ hàng đã
   * đóng (huỷ, hết hạn, xuất đủ) thì trả nguyên trạng, không trừ thêm — đủ cho bên
   * gọi thử lại mà không cần khoá chống lặp riêng.
   */
  async releaseReservation(actor: InventoryActor, code: string): Promise<Reservation> {
    this.requireStockWriter(actor);
    const released = await this.store.reservation.release(actor.tenantId, code, actor.userId);
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
    const kind = requireMaterialKind(input.kind) ?? 'STOCK';
    requireWarrantyMonths(input.warrantyMonths);
    if (kind === 'SERVICE' && input.isSerialized) {
      throw new InventoryError('VALIDATION', 'Mặt hàng dịch vụ không theo dõi serial.');
    }

    // Kiểm cả vật tư đã ngừng hoạt động: mã vẫn chiếm chỗ, và tạo trùng sẽ vỡ
    // ràng buộc UNIQUE với thông báo khó hiểu của Postgres.
    if (await this.store.material.findAnyByCode(actor.tenantId, code)) {
      throw new InventoryError('VALIDATION', `Mã vật tư ${code} đã tồn tại.`);
    }
    return this.store.material.create(actor.tenantId, {
      ...input,
      code,
      name: input.name.trim(),
      kind,
      // Dịch vụ không có tồn nên không có định mức tồn.
      ...(kind === 'SERVICE' ? { minStock: 0, maxStock: 0, isSerialized: false } : {}),
    });
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
    const kind = requireMaterialKind(patch.kind) ?? current.kind;
    requireWarrantyMonths(patch.warrantyMonths);
    if (kind !== current.kind && (await this.store.material.hasStockFootprint(actor.tenantId, code))) {
      throw new InventoryError(
        'VALIDATION',
        `Mã ${code} đã có tồn, bút toán, giữ hàng hoặc serial; không đổi được giữa hàng hoá và dịch vụ.`,
      );
    }
    if (kind === 'SERVICE' && (patch.isSerialized ?? current.isSerialized)) {
      throw new InventoryError('VALIDATION', 'Mặt hàng dịch vụ không theo dõi serial.');
    }
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

const MAX_CATALOG_PAGE = 500;
const CATALOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireMaterialKind(value: unknown): MaterialKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (!(MATERIAL_KINDS as readonly unknown[]).includes(value)) {
    throw new InventoryError('VALIDATION', 'Loại mặt hàng phải là hàng hoá hoặc dịch vụ.');
  }
  return value as MaterialKind;
}

function requireWarrantyMonths(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1200) {
    throw new InventoryError('VALIDATION', 'Số tháng bảo hành phải là số nguyên từ 0 đến 1200.');
  }
}

/** Chuẩn hoá tham số danh mục nội bộ; giá trị sai thì 400, không lặng lẽ bỏ qua. */
function normalizeCatalogQuery(query: InternalMaterialCatalogQuery): InternalMaterialCatalogQuery {
  const ids = (query.ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !CATALOG_UUID.test(id))) {
    throw new InventoryError('VALIDATION', 'Danh sách id mặt hàng không hợp lệ.');
  }
  const codes = (query.codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean);
  const kinds = (query.kinds ?? []).map((kind) => requireMaterialKind(kind) as MaterialKind);
  let limit: number | undefined;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CATALOG_PAGE) {
      throw new InventoryError('VALIDATION', `limit phải là số nguyên từ 1 đến ${MAX_CATALOG_PAGE}.`);
    }
  }
  return {
    search: query.search?.trim() || undefined,
    ids: ids.length ? ids : undefined,
    codes: codes.length ? codes : undefined,
    warehouseCode: query.warehouseCode?.trim() || undefined,
    kinds: kinds.length ? kinds : undefined,
    limit,
    cursor: query.cursor?.trim() || undefined,
  };
}
