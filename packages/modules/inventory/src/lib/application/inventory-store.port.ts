import type {
  Asset,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  TransactionType,
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

export interface InventoryStore {
  warehouse: {
    findByCode(code: string): Promise<Warehouse | null>;
    list(): Promise<Warehouse[]>;
  };

  material: {
    findByCode(code: string): Promise<Material | null>;
    list(): Promise<Material[]>;
  };

  asset: {
    findByCode(code: string): Promise<Asset | null>;
    list(): Promise<Asset[]>;
  };

  inventory: {
    findByMaterialAndWarehouse(
      materialCode: string,
      warehouseCode: string,
    ): Promise<MaterialInventory | null>;
    listByWarehouse(warehouseCode: string): Promise<MaterialInventory[]>;
  };

  /** Append-only ledger. Every stock movement goes through here. */
  transaction: {
    append(input: AppendTransactionInput): Promise<InventoryTransaction>;
    findByCode(transactionCode: string): Promise<InventoryTransaction | null>;
    listByReference(
      referenceType: string,
      referenceId: string,
    ): Promise<InventoryTransaction[]>;
  };

  reservation: {
    create(input: CreateReservationInput): Promise<Reservation>;
    findByCode(reservationCode: string): Promise<Reservation | null>;
    findByReference(referenceType: string, referenceId: string): Promise<Reservation[]>;
  };

  taskTemplate: {
    /** Read from assets.specs->'taskTemplate'; the AMM schema has no dedicated column. */
    resolveAssetTaskTemplate(assetCode: string): Promise<Record<string, unknown>[] | null>;
  };
}

export const INVENTORY_STORE = 'INVENTORY_STORE';
