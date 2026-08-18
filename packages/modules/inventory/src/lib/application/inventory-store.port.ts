import type {
  Warehouse,
  Material,
  Asset,
  InventoryBalance,
  StockReceipt,
  StockIssue,
  StockTransfer,
  StockReservation,
} from '@enterprise-platform/contracts-inventory';

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

  balance: {
    findByMaterialAndWarehouse(
      materialCode: string,
      warehouseCode: string
    ): Promise<InventoryBalance | null>;
  };

  receipt: {
    create(receipt: Omit<StockReceipt, 'id' | 'created_at'>): Promise<StockReceipt>;
    findByCode(code: string): Promise<StockReceipt | null>;
  };

  issue: {
    create(issue: Omit<StockIssue, 'id' | 'created_at'>): Promise<StockIssue>;
    findByCode(code: string): Promise<StockIssue | null>;
  };

  transfer: {
    create(transfer: Omit<StockTransfer, 'id' | 'created_at'>): Promise<StockTransfer>;
    findByCode(code: string): Promise<StockTransfer | null>;
  };

  reservation: {
    create(
      reservation: Omit<StockReservation, 'id' | 'created_at' | 'code'>
    ): Promise<StockReservation>;
    findByCode(code: string): Promise<StockReservation | null>;
    findByReference(referenceType: string, referenceId: string): Promise<StockReservation[]>;
  };

  taskTemplate: {
    resolveAssetTaskTemplate(assetCode: string): Promise<Record<string, unknown>[] | null>;
    resolveMaterialTaskTemplate(
      materialCode: string,
      assetCode?: string
    ): Promise<Record<string, unknown>[] | null>;
  };
}

export const INVENTORY_STORE = 'INVENTORY_STORE';
