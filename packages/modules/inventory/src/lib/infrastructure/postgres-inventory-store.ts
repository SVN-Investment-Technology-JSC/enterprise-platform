import { Injectable } from '@nestjs/common';
import type { PostgresPool } from '@enterprise-platform/adapter-database';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
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
import type { InventoryStore } from '../application/inventory-store.port';

@Injectable()
export class PostgresInventoryStore implements InventoryStore {
  private pool: PostgresPool;

  constructor(connectionString: string) {
    this.pool = createPostgresPool(connectionString);
  }

  warehouse = {
    findByCode: async (code: string): Promise<Warehouse | null> => {
      const result = await this.pool.query<Warehouse>(
        `SELECT * FROM inventory_schema.warehouses WHERE code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },

    list: async (): Promise<Warehouse[]> => {
      const result = await this.pool.query<Warehouse>(
        `SELECT * FROM inventory_schema.warehouses WHERE is_active = true ORDER BY code`
      );
      return result.rows;
    },
  };

  material = {
    findByCode: async (code: string): Promise<Material | null> => {
      const result = await this.pool.query<Material>(
        `SELECT * FROM inventory_schema.materials WHERE material_code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },

    list: async (): Promise<Material[]> => {
      const result = await this.pool.query<Material>(
        `SELECT * FROM inventory_schema.materials ORDER BY material_code`
      );
      return result.rows;
    },
  };

  asset = {
    findByCode: async (code: string): Promise<Asset | null> => {
      const result = await this.pool.query<Asset>(
        `SELECT * FROM inventory_schema.assets WHERE code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },

    list: async (): Promise<Asset[]> => {
      const result = await this.pool.query<Asset>(
        `SELECT * FROM inventory_schema.assets WHERE status = 'active' ORDER BY code`
      );
      return result.rows;
    },
  };

  balance = {
    findByMaterialAndWarehouse: async (
      materialCode: string,
      warehouseCode: string
    ): Promise<InventoryBalance | null> => {
      const result = await this.pool.query<InventoryBalance>(
        `SELECT ib.* FROM inventory_schema.inventory_balances ib
         JOIN inventory_schema.materials m ON ib.material_id = m.id
         JOIN inventory_schema.warehouses w ON ib.warehouse_id = w.id
         WHERE m.material_code = $1 AND w.code = $2 LIMIT 1`,
        [materialCode, warehouseCode]
      );
      return result.rows[0] ?? null;
    },
  };

  receipt = {
    create: async (receipt: Omit<StockReceipt, 'id' | 'created_at'>): Promise<StockReceipt> => {
      throw new Error('Not yet implemented: StockReceipt.create');
    },

    findByCode: async (code: string): Promise<StockReceipt | null> => {
      throw new Error('Not yet implemented: StockReceipt.findByCode');
    },
  };

  issue = {
    create: async (issue: Omit<StockIssue, 'id' | 'created_at'>): Promise<StockIssue> => {
      throw new Error('Not yet implemented: StockIssue.create');
    },

    findByCode: async (code: string): Promise<StockIssue | null> => {
      throw new Error('Not yet implemented: StockIssue.findByCode');
    },
  };

  transfer = {
    create: async (transfer: Omit<StockTransfer, 'id' | 'created_at'>): Promise<StockTransfer> => {
      throw new Error('Not yet implemented: StockTransfer.create');
    },

    findByCode: async (code: string): Promise<StockTransfer | null> => {
      throw new Error('Not yet implemented: StockTransfer.findByCode');
    },
  };

  reservation = {
    create: async (
      reservation: Omit<StockReservation, 'id' | 'created_at' | 'code'>
    ): Promise<StockReservation> => {
      throw new Error('Not yet implemented: StockReservation.create');
    },

    findByCode: async (code: string): Promise<StockReservation | null> => {
      throw new Error('Not yet implemented: StockReservation.findByCode');
    },

    findByReference: async (referenceType: string, referenceId: string): Promise<StockReservation[]> => {
      throw new Error('Not yet implemented: StockReservation.findByReference');
    },
  };

  taskTemplate = {
    resolveAssetTaskTemplate: async (assetCode: string): Promise<Record<string, unknown>[] | null> => {
      const result = await this.pool.query<{ task_template: Record<string, unknown>[] }>(
        `SELECT task_template FROM inventory_schema.assets WHERE code = $1 LIMIT 1`,
        [assetCode]
      );
      return result.rows[0]?.task_template ?? null;
    },

    resolveMaterialTaskTemplate: async (
      materialCode: string,
      assetCode?: string
    ): Promise<Record<string, unknown>[] | null> => {
      // Check material_compatibilities first if assetCode provided
      if (assetCode) {
        const result = await this.pool.query<{ task_template: Record<string, unknown>[] }>(
          `SELECT task_template FROM inventory_schema.material_compatibilities
           WHERE asset_code = $1 AND material_code = $2 LIMIT 1`,
          [assetCode, materialCode]
        );
        if (result.rows[0]) {
          return result.rows[0].task_template;
        }
      }

      // Fall back to material's default replacement_steps
      const result = await this.pool.query<{ replacement_steps: Record<string, unknown>[] }>(
        `SELECT replacement_steps FROM inventory_schema.materials WHERE material_code = $1 LIMIT 1`,
        [materialCode]
      );
      return result.rows[0]?.replacement_steps ?? null;
    },
  };
}
