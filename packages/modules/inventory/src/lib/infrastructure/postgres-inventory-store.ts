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
      const id = (await this.pool.query(`SELECT gen_random_uuid() as id`)).rows[0].id;
      const result = await this.pool.query<StockReceipt>(
        `INSERT INTO inventory_schema.stock_receipts (id, code, warehouse_id, material_id, quantity, unit_cost, supplier_code, reference_id, status, notes, received_by, created_at)
         SELECT $1, $2, w.id, m.id, $5, $6, $7, $8, $9, $10, $11, now()
         FROM inventory_schema.warehouses w, inventory_schema.materials m
         WHERE w.code = $3 AND m.code = $4
         RETURNING *`,
        [id, receipt.code, receipt.warehouseCode, receipt.materialCode, receipt.quantity, receipt.unitCost ?? 0, receipt.supplierCode ?? null, receipt.referenceId ?? null, receipt.status ?? 'pending', receipt.notes ?? null, receipt.receivedBy]
      );
      return result.rows[0];
    },

    findByCode: async (code: string): Promise<StockReceipt | null> => {
      const result = await this.pool.query<StockReceipt>(
        `SELECT sr.*, w.code as warehouse_code, m.code as material_code FROM inventory_schema.stock_receipts sr
         JOIN inventory_schema.warehouses w ON sr.warehouse_id = w.id
         JOIN inventory_schema.materials m ON sr.material_id = m.id
         WHERE sr.code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },
  };

  issue = {
    create: async (issue: Omit<StockIssue, 'id' | 'created_at'>): Promise<StockIssue> => {
      const id = (await this.pool.query(`SELECT gen_random_uuid() as id`)).rows[0].id;
      const result = await this.pool.query<StockIssue>(
        `INSERT INTO inventory_schema.stock_issues (id, code, warehouse_id, material_id, quantity, unit_cost, reference_type, reference_id, status, notes, issued_by, created_at)
         SELECT $1, $2, w.id, m.id, $5, $6, $7, $8, $9, $10, $11, now()
         FROM inventory_schema.warehouses w, inventory_schema.materials m
         WHERE w.code = $3 AND m.code = $4
         RETURNING *`,
        [id, issue.code, issue.warehouseCode, issue.materialCode, issue.quantity, issue.unitCost ?? 0, issue.referenceType ?? null, issue.referenceId ?? null, issue.status ?? 'pending', issue.notes ?? null, issue.issuedBy]
      );
      return result.rows[0];
    },

    findByCode: async (code: string): Promise<StockIssue | null> => {
      const result = await this.pool.query<StockIssue>(
        `SELECT si.*, w.code as warehouse_code, m.code as material_code FROM inventory_schema.stock_issues si
         JOIN inventory_schema.warehouses w ON si.warehouse_id = w.id
         JOIN inventory_schema.materials m ON si.material_id = m.id
         WHERE si.code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },
  };

  transfer = {
    create: async (transfer: Omit<StockTransfer, 'id' | 'created_at'>): Promise<StockTransfer> => {
      const id = (await this.pool.query(`SELECT gen_random_uuid() as id`)).rows[0].id;
      const result = await this.pool.query<StockTransfer>(
        `INSERT INTO inventory_schema.stock_transfers (id, code, from_warehouse_id, to_warehouse_id, material_id, quantity, status, notes, transferred_by, created_at)
         SELECT $1, $2, w1.id, w2.id, m.id, $6, $7, $8, $9, now()
         FROM inventory_schema.warehouses w1, inventory_schema.warehouses w2, inventory_schema.materials m
         WHERE w1.code = $3 AND w2.code = $4 AND m.code = $5
         RETURNING *`,
        [id, transfer.code, transfer.fromWarehouseCode, transfer.toWarehouseCode, transfer.materialCode, transfer.quantity, transfer.status ?? 'pending', transfer.notes ?? null, transfer.transferredBy]
      );
      return result.rows[0];
    },

    findByCode: async (code: string): Promise<StockTransfer | null> => {
      const result = await this.pool.query<StockTransfer>(
        `SELECT st.*, w1.code as from_warehouse_code, w2.code as to_warehouse_code, m.code as material_code
         FROM inventory_schema.stock_transfers st
         JOIN inventory_schema.warehouses w1 ON st.from_warehouse_id = w1.id
         JOIN inventory_schema.warehouses w2 ON st.to_warehouse_id = w2.id
         JOIN inventory_schema.materials m ON st.material_id = m.id
         WHERE st.code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },
  };

  reservation = {
    create: async (
      reservation: Omit<StockReservation, 'id' | 'created_at' | 'code'>
    ): Promise<StockReservation> => {
      const id = (await this.pool.query(`SELECT gen_random_uuid() as id`)).rows[0].id;
      const code = `RES-${id.substring(0, 8).toUpperCase()}`;
      const result = await this.pool.query<StockReservation>(
        `INSERT INTO inventory_schema.stock_reservations (id, code, warehouse_id, material_id, quantity_reserved, reference_type, reference_id, expires_at, status, reserved_by, created_at)
         SELECT $1, $2, w.id, m.id, $5, $6, $7, $8, $9, $10, now()
         FROM inventory_schema.warehouses w, inventory_schema.materials m
         WHERE w.code = $3 AND m.code = $4
         RETURNING *`,
        [id, code, reservation.warehouseCode, reservation.materialCode, reservation.quantityReserved, reservation.referenceType, reservation.referenceId ?? null, reservation.expiresAt ?? null, reservation.status ?? 'reserved', reservation.reservedBy]
      );
      return result.rows[0];
    },

    findByCode: async (code: string): Promise<StockReservation | null> => {
      const result = await this.pool.query<StockReservation>(
        `SELECT sr.*, w.code as warehouse_code, m.code as material_code FROM inventory_schema.stock_reservations sr
         JOIN inventory_schema.warehouses w ON sr.warehouse_id = w.id
         JOIN inventory_schema.materials m ON sr.material_id = m.id
         WHERE sr.code = $1 LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    },

    findByReference: async (referenceType: string, referenceId: string): Promise<StockReservation[]> => {
      const result = await this.pool.query<StockReservation>(
        `SELECT sr.*, w.code as warehouse_code, m.code as material_code FROM inventory_schema.stock_reservations sr
         JOIN inventory_schema.warehouses w ON sr.warehouse_id = w.id
         JOIN inventory_schema.materials m ON sr.material_id = m.id
         WHERE sr.reference_type = $1 AND sr.reference_id = $2 ORDER BY sr.created_at DESC`,
        [referenceType, referenceId]
      );
      return result.rows;
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
