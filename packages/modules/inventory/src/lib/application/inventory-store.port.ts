import type {
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  InstalledMaterial,
  Asset,
  InventoryItem,
  CreateAssetRequest,
  CreateMaterialRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  SerialTracking,
  AssetBomLine,
  SettingsEntry,
  TransactionType,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';

/** Ledger entry to append. Balances are derived from these, never written directly. */
export interface AppendTransactionInput {
  readonly warehouseCode: string;
  readonly materialCode: string;
  readonly type: TransactionType;
  /** Signed: positive for inbound, negative for outbound. */
  readonly quantity: number;
  readonly unitCost?: number;
  readonly serialNumber?: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
  readonly note?: string;
  readonly createdBy: string;
}

export interface CreateReservationInput {
  readonly referenceType: string;
  readonly referenceId?: string;
  readonly expiresAt?: string;
  readonly createdBy: string;
  readonly items: ReadonlyArray<{
    readonly warehouseCode: string;
    readonly materialCode: string;
    readonly quantityReserved: number;
  }>;
}

/**
 * Every method takes tenantId: the store resolves a pool per tenant through
 * TenantDatabaseRegistry, matching the maintenance and procedure modules. A tenant
 * is only reachable after its database reference has been registered by the guard.
 */
export interface InventoryStore {
  warehouse: {
    findByCode(tenantId: string, code: string): Promise<Warehouse | null>;
    list(tenantId: string): Promise<Warehouse[]>;
    /** Gồm cả kho đã ngừng dùng — màn Cài đặt phải thấy để bật lại được. */
    listAll(tenantId: string): Promise<Warehouse[]>;
    create(tenantId: string, input: CreateWarehouseRequest): Promise<Warehouse>;
    update(
      tenantId: string,
      code: string,
      patch: UpdateWarehouseRequest,
    ): Promise<Warehouse | null>;
    /** Tổng tồn đang nằm trong kho — để chặn ngừng dùng một kho còn hàng. */
    stockTotal(tenantId: string, code: string): Promise<number>;
  };

  material: {
    findByCode(tenantId: string, code: string): Promise<Material | null>;
    /** Gồm cả vật tư đã ngừng hoạt động; dùng khi cần kiểm mã trùng. */
    findAnyByCode(tenantId: string, code: string): Promise<Material | null>;
    list(tenantId: string): Promise<Material[]>;
    create(tenantId: string, input: CreateMaterialRequest): Promise<Material>;
    update(tenantId: string, code: string, patch: UpdateMaterialRequest): Promise<Material | null>;
    /** Số giao dịch đã phát sinh; chỉ để giải thích vì sao mã bị ngừng dùng. */
    countTransactions(tenantId: string, code: string): Promise<number>;
  };

  /**
   * Danh mục hợp nhất: vật tư kho và thiết bị trong một truy vấn.
   *
   * Không ghép ở tầng application từ hai lời gọi `material.list` + `asset.list`:
   * vị trí lắp đặt và tồn gộp đều cần join, làm ở SQL là một lượt, làm ở
   * JavaScript là ba vòng lặp lồng nhau trên toàn bộ danh mục.
   */
  item: {
    listAll(tenantId: string): Promise<InventoryItem[]>;
    /**
     * Vật tư đang lắp trên từng thiết bị, suy ra từ sổ cái.
     *
     * Chỉ trả những cặp còn số dư dương: lắp rồi tháo hết thì cặp đó biến mất
     * khỏi cây thay vì nằm lại thành một dòng 0.
     */
    listInstalled(tenantId: string): Promise<InstalledMaterial[]>;
    /** Sinh dòng vật tư đại diện cho một lần lắp; nó lại mang được con. */
    /** Hồ sơ đầy đủ của một mã, bất kể đang trong kho hay đã lắp. */
    findProfile(tenantId: string, code: string): Promise<Asset | null>;
    /** Sửa hồ sơ của một mã bất kể loại; ghi thẳng bảng gốc. */
    updateProfile(
      tenantId: string,
      code: string,
      patch: UpdateAssetRequest,
      parentId?: string | null,
    ): Promise<Asset | null>;
    createInstalledUnit(
      tenantId: string,
      code: string,
      parentCode: string,
    ): Promise<{ unitId: string; unitCode: string; sourceId: string } | 'not_found'>;
    /** Đơn vị đã tháo hết thì ngừng dùng, không xoá. */
    deactivateUnit(tenantId: string, unitCode: string): Promise<void>;
    /** Tháo khỏi cây, trả về kho. Từ chối khi vật tư còn con. */
    returnToStock(
      tenantId: string,
      code: string,
    ): Promise<'ok' | 'has_children' | 'not_found'>;
  };

  asset: {
    findByCode(tenantId: string, code: string): Promise<Asset | null>;
    /** Gồm cả thiết bị đã thanh lý; dùng khi cần kiểm mã trùng. */
    findAnyByCode(tenantId: string, code: string): Promise<Asset | null>;
    list(tenantId: string): Promise<Asset[]>;
    create(tenantId: string, input: CreateAssetRequest, parentId?: string): Promise<Asset>;
    update(tenantId: string, code: string, patch: UpdateAssetRequest, parentId?: string | null): Promise<Asset | null>;
    /** Số thiết bị con đang trỏ vào; dùng để chặn tháo node còn con. */
    countChildren(tenantId: string, code: string): Promise<number>;
  };

  inventory: {
    findByMaterialAndWarehouse(
      tenantId: string,
      materialCode: string,
      warehouseCode: string,
    ): Promise<MaterialInventory | null>;
    listByWarehouse(tenantId: string, warehouseCode: string): Promise<MaterialInventory[]>;
    /**
     * Tổng tồn khả dụng của MỌI vật tư, gộp qua các kho, trong một truy vấn.
     *
     * Dùng cho danh mục: tra từng mã một sẽ là N lượt truy vấn cho một màn hình
     * chỉ cần một con số mỗi dòng. Mã không có dòng tồn nào thì vắng mặt trong
     * map — bên gọi hiểu là 0.
     */
    availableByMaterial(tenantId: string): Promise<Map<string, number>>;
  };

  /** Append-only ledger. Every stock movement goes through here. */
  transaction: {
    append(tenantId: string, input: AppendTransactionInput): Promise<InventoryTransaction>;
    /** Most recent ledger entries across all warehouses, for the ledger view. */
    listRecent(tenantId: string, limit: number): Promise<InventoryTransaction[]>;
    /**
     * Lịch sử nhập/xuất của MỘT mã vật tư, mới nhất trước.
     *
     * Tách khỏi `listRecent` chứ không lọc ở tầng trên: sổ cái của một tenant
     * lớn có hàng chục nghìn dòng, kéo hết về rồi lọc trong bộ nhớ là cách chắc
     * chắn làm chậm màn chi tiết vật tư.
     */
    listByMaterial(
      tenantId: string,
      materialCode: string,
      limit: number,
    ): Promise<InventoryTransaction[]>;
    findByCode(tenantId: string, transactionCode: string): Promise<InventoryTransaction | null>;
    listByReference(
      tenantId: string,
      referenceType: string,
      referenceId: string,
    ): Promise<InventoryTransaction[]>;
  };

  reservation: {
    create(tenantId: string, input: CreateReservationInput): Promise<Reservation>;
    list(tenantId: string): Promise<Reservation[]>;
    findByCode(tenantId: string, reservationCode: string): Promise<Reservation | null>;
    /**
     * Nhả giữ chỗ: trả số lượng về khả dụng và đóng phiếu.
     *
     * Idempotent — gọi lại trên phiếu đã đóng không trừ thêm lần nữa. Cần vậy vì
     * bên gọi là Quy trình, nhả sau khi transaction của nó đã commit nên có thể
     * thử lại.
     */
    release(tenantId: string, reservationCode: string): Promise<Reservation | null>;
    findByReference(
      tenantId: string,
      referenceType: string,
      referenceId: string,
    ): Promise<Reservation[]>;
  };

  serial: {
    list(tenantId: string): Promise<SerialTracking[]>;
    listByMaterial(tenantId: string, materialCode: string): Promise<SerialTracking[]>;
    /** Khai một loạt sê-ri; trả số dòng thật sự được thêm (bỏ qua số đã có). */
    register(
      tenantId: string,
      materialCode: string,
      serialNumbers: readonly string[],
      currentStatus: string,
      locationType: string,
      warehouseCode?: string,
    ): Promise<number>;
    update(
      tenantId: string,
      materialCode: string,
      serialNumber: string,
      patch: { currentStatus?: string; locationType?: string; internalCode?: string },
    ): Promise<SerialTracking | null>;
  };

  taskTemplate: {
    /** Feeds Role E task decomposition; read from assets.task_template. */
    resolveAssetTaskTemplate(
      tenantId: string,
      assetCode: string,
    ): Promise<Record<string, unknown>[] | null>;
  };

  /**
   * Phụ tùng tiêu chuẩn của một thiết bị. Bảng `asset_boms` đã có từ migration
   * đầu tiên nhưng chưa từng được nối dây.
   */
  bom: {
    listByAsset(tenantId: string, assetCode: string): Promise<AssetBomLine[]>;
    add(
      tenantId: string,
      assetCode: string,
      input: { materialCode: string; standardQuantity: number; isCriticalSpare?: boolean; note?: string },
    ): Promise<AssetBomLine>;
    remove(tenantId: string, assetCode: string, bomId: string): Promise<boolean>;
  };

  settings: {
    list(tenantId: string): Promise<SettingsEntry<unknown>[]>;
    get(tenantId: string, key: string): Promise<SettingsEntry<unknown> | null>;
    /**
     * Upsert kèm kiểm tra version. Trả `null` khi dòng đã tồn tại mà
     * `expectedVersion` không khớp — bên gọi biến nó thành 409 thay vì ghi đè
     * im lặng lên thay đổi của người khác.
     */
    put(
      tenantId: string,
      key: string,
      value: unknown,
      updatedBy: string,
      expectedVersion?: number,
    ): Promise<SettingsEntry<unknown> | null>;
  };
}

export const INVENTORY_STORE = 'INVENTORY_STORE';
