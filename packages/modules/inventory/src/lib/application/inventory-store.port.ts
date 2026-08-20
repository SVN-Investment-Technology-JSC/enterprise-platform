import type {
  Asset,
  CreateAssetRequest,
  CreateMaterialRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  SerialTracking,
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
}

export const INVENTORY_STORE = 'INVENTORY_STORE';
