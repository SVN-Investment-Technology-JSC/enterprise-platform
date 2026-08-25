import type {
  Asset,
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
  };

  material: {
    findByCode(tenantId: string, code: string): Promise<Material | null>;
    /** Gồm cả vật tư đã ngừng hoạt động; dùng khi cần kiểm mã trùng. */
    findAnyByCode(tenantId: string, code: string): Promise<Material | null>;
    list(tenantId: string): Promise<Material[]>;
    create(tenantId: string, input: CreateMaterialRequest): Promise<Material>;
    update(tenantId: string, code: string, patch: UpdateMaterialRequest): Promise<Material | null>;
    /** Số giao dịch đã phát sinh; >0 thì không được xoá cứng. */
    countTransactions(tenantId: string, code: string): Promise<number>;
    delete(tenantId: string, code: string): Promise<boolean>;
  };

  asset: {
    findByCode(tenantId: string, code: string): Promise<Asset | null>;
    /** Gồm cả thiết bị đã thanh lý; dùng khi cần kiểm mã trùng. */
    findAnyByCode(tenantId: string, code: string): Promise<Asset | null>;
    list(tenantId: string): Promise<Asset[]>;
    create(tenantId: string, input: CreateAssetRequest, parentId?: string): Promise<Asset>;
    update(tenantId: string, code: string, patch: UpdateAssetRequest, parentId?: string | null): Promise<Asset | null>;
    /** Số thiết bị con đang trỏ vào; >0 thì không được xoá cứng. */
    countChildren(tenantId: string, code: string): Promise<number>;
    delete(tenantId: string, code: string): Promise<boolean>;
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
