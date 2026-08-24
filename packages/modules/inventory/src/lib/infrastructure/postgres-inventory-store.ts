import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  Asset,
  CreateAssetRequest,
  CreateMaterialRequest,
  UpdateMaterialRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  ReservationItem,
  SerialTracking,
  UpdateAssetRequest,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  AppendTransactionInput,
  CreateReservationInput,
  InventoryStore,
} from '../application/inventory-store.port.js';
import {
  InsufficientStockError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';

type Row = QueryResultRow & Record<string, unknown>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

function mapWarehouse(row: Row): Warehouse {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    type: row.type as Warehouse['type'],
    orgUnitId: opt(row.org_unit_id),
    managerUserId: opt(row.manager_user_id),
    location: opt(row.location),
    isActive: Boolean(row.is_active),
  };
}

function mapMaterial(row: Row): Material {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    category: row.category as Material['category'],
    unit: str(row.unit),
    minStock: num(row.min_stock),
    maxStock: num(row.max_stock),
    isSerialized: Boolean(row.is_serialized),
    barcode: opt(row.barcode),
    isActive: Boolean(row.is_active),
  };
}

function mapAsset(row: Row): Asset {
  return {
    id: str(row.id),
    code: str(row.code),
    internalCode: opt(row.internal_code),
    name: str(row.name),
    parentId: opt(row.parent_id),
    type: row.type as Asset['type'],
    orgUnitId: opt(row.org_unit_id),
    serialNumber: opt(row.serial_number),
    status: row.status as Asset['status'],
    criticality: row.criticality as Asset['criticality'],
    specs: (row.specs as Record<string, unknown>) ?? undefined,
    taskTemplate: (row.task_template as Asset['taskTemplate']) ?? [],
    qrCode: opt(row.qr_code),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapInventory(row: Row): MaterialInventory {
  return {
    id: str(row.id),
    warehouseId: str(row.warehouse_id),
    locationId: opt(row.location_id),
    materialId: str(row.material_id),
    quantity: num(row.quantity),
    quantityReserved: num(row.quantity_reserved),
    available: num(row.available),
    updatedAt: iso(row.updated_at),
  };
}

function mapTransaction(row: Row): InventoryTransaction {
  return {
    id: str(row.id),
    transactionCode: str(row.transaction_code),
    warehouseId: str(row.warehouse_id),
    locationId: opt(row.location_id),
    materialId: str(row.material_id),
    serialNumber: opt(row.serial_number),
    type: row.type as InventoryTransaction['type'],
    quantity: num(row.quantity),
    unitCost: num(row.unit_cost),
    referenceType: opt(row.reference_type),
    referenceId: opt(row.reference_id),
    workflowStatus: row.workflow_status as InventoryTransaction['workflowStatus'],
    note: opt(row.note),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
  };
}

function mapSerial(row: Row): SerialTracking {
  return {
    id: str(row.id),
    materialId: str(row.material_id),
    serialNumber: str(row.serial_number),
    internalCode: opt(row.internal_code),
    currentStatus: row.current_status as SerialTracking['currentStatus'],
    locationType: row.location_type as SerialTracking['locationType'],
    currentWarehouseId: opt(row.current_warehouse_id),
    currentAssetId: opt(row.current_asset_id),
    createdAt: iso(row.created_at),
  };
}

function mapReservationItem(row: Row): ReservationItem {
  return {
    id: str(row.id),
    reservationId: str(row.reservation_id),
    warehouseId: str(row.warehouse_id),
    materialId: str(row.material_id),
    quantityReserved: num(row.quantity_reserved),
    quantityIssued: num(row.quantity_issued),
  };
}

function mapReservation(row: Row, items: ReservationItem[] = []): Reservation {
  return {
    id: str(row.id),
    reservationCode: str(row.reservation_code),
    referenceType: str(row.reference_type),
    referenceId: opt(row.reference_id),
    status: row.status as Reservation['status'],
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at),
    items,
  };
}

function newCode(prefix: string): string {
  const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${Date.now()}-${suffix}`;
}

export class PostgresInventoryStore implements InventoryStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  /** Throws if the tenant's database reference was never registered by the guard. */
  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  warehouse = {
    findByCode: async (tenantId: string, code: string): Promise<Warehouse | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.warehouses WHERE code = $1 LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapWarehouse(result.rows[0]) : null;
    },

    list: async (tenantId: string): Promise<Warehouse[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.warehouses WHERE is_active = true ORDER BY code`,
      );
      return result.rows.map(mapWarehouse);
    },
  };

  material = {
    findByCode: async (tenantId: string, code: string): Promise<Material | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE code = $1 LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapMaterial(result.rows[0]) : null;
    },

    findAnyByCode: async (tenantId: string, code: string): Promise<Material | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE code = $1 LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapMaterial(result.rows[0]) : null;
    },

    list: async (tenantId: string): Promise<Material[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE is_active = true ORDER BY code`,
      );
      return result.rows.map(mapMaterial);
    },

    create: async (tenantId: string, input: CreateMaterialRequest): Promise<Material> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO inventory_schema.materials
           (code, name, category, unit, min_stock, max_stock, is_serialized, barcode, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING *`,
        [
          input.code,
          input.name,
          input.category,
          input.unit,
          input.minStock ?? 0,
          input.maxStock ?? 0,
          input.isSerialized ?? false,
          input.barcode ?? null,
        ],
      );
      return mapMaterial(result.rows[0]);
    },

    update: async (
      tenantId: string,
      code: string,
      patch: UpdateMaterialRequest,
    ): Promise<Material | null> => {
      const pool = await this.poolFor(tenantId);
      // COALESCE trên tham số NULL: bỏ trống một trường là giữ nguyên.
      const result = await pool.query<Row>(
        `UPDATE inventory_schema.materials
            SET name = COALESCE($2, name),
                category = COALESCE($3, category),
                unit = COALESCE($4, unit),
                min_stock = COALESCE($5, min_stock),
                max_stock = COALESCE($6, max_stock),
                barcode = COALESCE($7, barcode),
                is_active = COALESCE($8, is_active)
          WHERE code = $1
      RETURNING *`,
        [
          code,
          patch.name ?? null,
          patch.category ?? null,
          patch.unit ?? null,
          patch.minStock ?? null,
          patch.maxStock ?? null,
          patch.barcode ?? null,
          patch.isActive ?? null,
        ],
      );
      return result.rows[0] ? mapMaterial(result.rows[0]) : null;
    },

    countTransactions: async (tenantId: string, code: string): Promise<number> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT count(*)::int AS n
           FROM inventory_schema.inventory_transactions t
           JOIN inventory_schema.materials m ON m.id = t.material_id
          WHERE m.code = $1`,
        [code],
      );
      return num(result.rows[0]?.n ?? 0);
    },

    delete: async (tenantId: string, code: string): Promise<boolean> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query(
        `DELETE FROM inventory_schema.materials WHERE code = $1`,
        [code],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  asset = {
    findByCode: async (tenantId: string, code: string): Promise<Asset | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.assets WHERE code = $1 LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapAsset(result.rows[0]) : null;
    },

    findAnyByCode: async (tenantId: string, code: string): Promise<Asset | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.assets WHERE code = $1 LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapAsset(result.rows[0]) : null;
    },

    list: async (tenantId: string): Promise<Asset[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.assets WHERE status <> 'DISPOSED' ORDER BY code`,
      );
      return result.rows.map(mapAsset);
    },

    create: async (
      tenantId: string,
      input: CreateAssetRequest,
      parentId?: string,
    ): Promise<Asset> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO inventory_schema.assets
           (code, name, type, parent_id, status, criticality, internal_code,
            serial_number, qr_code, org_unit_id, specs, task_template)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
      RETURNING *`,
        [
          input.code,
          input.name,
          input.type,
          parentId ?? null,
          input.status ?? 'OPERATING',
          input.criticality ?? 'MEDIUM',
          input.internalCode ?? null,
          input.serialNumber ?? null,
          input.qrCode ?? null,
          input.orgUnitId ?? null,
          JSON.stringify(input.specs ?? {}),
          JSON.stringify(input.taskTemplate ?? []),
        ],
      );
      return mapAsset(result.rows[0]);
    },

    countChildren: async (tenantId: string, code: string): Promise<number> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT count(*)::int AS n
           FROM inventory_schema.assets child
           JOIN inventory_schema.assets parent ON parent.id = child.parent_id
          WHERE parent.code = $1`,
        [code],
      );
      return num(result.rows[0]?.n ?? 0);
    },

    delete: async (tenantId: string, code: string): Promise<boolean> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query(`DELETE FROM inventory_schema.assets WHERE code = $1`, [
        code,
      ]);
      return (result.rowCount ?? 0) > 0;
    },

    update: async (
      tenantId: string,
      code: string,
      patch: UpdateAssetRequest,
      parentId?: string | null,
    ): Promise<Asset | null> => {
      const pool = await this.poolFor(tenantId);
      // COALESCE trên tham số NULL: bỏ trống một trường nghĩa là giữ nguyên,
      // chứ không phải xoá trắng nó. Riêng cha thì cần phân biệt "không đổi"
      // (parentId === undefined) với "gỡ lên gốc" (parentCode === null), nên
      // dùng thêm một cờ boolean.
      const clearParent = patch.parentCode === null;
      const result = await pool.query<Row>(
        `UPDATE inventory_schema.assets
            SET specs = COALESCE($2::jsonb, specs),
                task_template = COALESCE($3::jsonb, task_template),
                name = COALESCE($4, name),
                status = COALESCE($5, status),
                criticality = COALESCE($6, criticality),
                internal_code = COALESCE($7, internal_code),
                serial_number = COALESCE($8, serial_number),
                qr_code = COALESCE($9, qr_code),
                org_unit_id = COALESCE($10, org_unit_id),
                parent_id = CASE WHEN $11 THEN NULL ELSE COALESCE($12, parent_id) END,
                updated_at = now()
          WHERE code = $1
      RETURNING *`,
        [
          code,
          patch.specs === undefined ? null : JSON.stringify(patch.specs),
          patch.taskTemplate === undefined ? null : JSON.stringify(patch.taskTemplate),
          patch.name ?? null,
          patch.status ?? null,
          patch.criticality ?? null,
          patch.internalCode ?? null,
          patch.serialNumber ?? null,
          patch.qrCode ?? null,
          patch.orgUnitId ?? null,
          clearParent,
          parentId ?? null,
        ],
      );
      return result.rows[0] ? mapAsset(result.rows[0]) : null;
    },
  };

  inventory = {
    findByMaterialAndWarehouse: async (
      tenantId: string,
      materialCode: string,
      warehouseCode: string,
    ): Promise<MaterialInventory | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT mi.* FROM inventory_schema.material_inventory mi
         JOIN inventory_schema.materials m ON mi.material_id = m.id
         JOIN inventory_schema.warehouses w ON mi.warehouse_id = w.id
         WHERE m.code = $1 AND w.code = $2 LIMIT 1`,
        [materialCode, warehouseCode],
      );
      return result.rows[0] ? mapInventory(result.rows[0]) : null;
    },

    listByWarehouse: async (
      tenantId: string,
      warehouseCode: string,
    ): Promise<MaterialInventory[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT mi.* FROM inventory_schema.material_inventory mi
         JOIN inventory_schema.warehouses w ON mi.warehouse_id = w.id
         WHERE w.code = $1 ORDER BY mi.updated_at DESC`,
        [warehouseCode],
      );
      return result.rows.map(mapInventory);
    },
  };

  transaction = {
    /**
     * Appends a ledger row and moves the balance in the same transaction.
     * material_inventory is a derived cache of the ledger, never edited on its own.
     */
    append: async (
      tenantId: string,
      input: AppendTransactionInput,
    ): Promise<InventoryTransaction> => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const { warehouseId, materialId } = await this.resolveIds(
          client,
          input.warehouseCode,
          input.materialCode,
        );

        const inserted = await client.query<Row>(
          `INSERT INTO inventory_schema.inventory_transactions
             (id, transaction_code, warehouse_id, material_id, serial_number, type,
              quantity, unit_cost, reference_type, reference_id, workflow_status, note, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'APPROVED', $10, $11)
           RETURNING *`,
          [
            newCode('TXN'),
            warehouseId,
            materialId,
            input.serialNumber ?? null,
            input.type,
            input.quantity,
            input.unitCost ?? 0,
            input.referenceType ?? null,
            input.referenceId ?? null,
            input.note ?? null,
            input.createdBy,
          ],
        );

        // Roll the derived balance forward by the signed quantity. The unique key
        // is NULLS NOT DISTINCT (migration 0002) so warehouse-level rows, which
        // carry a NULL location, actually collide instead of duplicating.
        await client.query(
          `INSERT INTO inventory_schema.material_inventory
             (id, warehouse_id, location_id, material_id, quantity, quantity_reserved, updated_at)
           VALUES (gen_random_uuid(), $1, NULL, $2, $3, 0, now())
           ON CONFLICT (warehouse_id, location_id, material_id)
           DO UPDATE SET quantity = inventory_schema.material_inventory.quantity + EXCLUDED.quantity,
                         updated_at = now()`,
          [warehouseId, materialId, input.quantity],
        );

        return mapTransaction(inserted.rows[0]);
      });
    },

    listRecent: async (tenantId: string, limit: number): Promise<InventoryTransaction[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.inventory_transactions
         ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      return result.rows.map(mapTransaction);
    },

    findByCode: async (
      tenantId: string,
      transactionCode: string,
    ): Promise<InventoryTransaction | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.inventory_transactions WHERE transaction_code = $1 LIMIT 1`,
        [transactionCode],
      );
      return result.rows[0] ? mapTransaction(result.rows[0]) : null;
    },

    listByReference: async (
      tenantId: string,
      referenceType: string,
      referenceId: string,
    ): Promise<InventoryTransaction[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.inventory_transactions
         WHERE reference_type = $1 AND reference_id = $2 ORDER BY created_at DESC`,
        [referenceType, referenceId],
      );
      return result.rows.map(mapTransaction);
    },
  };

  reservation = {
    create: async (tenantId: string, input: CreateReservationInput): Promise<Reservation> => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        const reservationRow = await client.query<Row>(
          `INSERT INTO inventory_schema.reservations
             (id, reservation_code, reference_type, reference_id, status, expires_at, created_by)
           VALUES (gen_random_uuid(), $1, $2, $3, 'RESERVED', $4, $5)
           RETURNING *`,
          [
            newCode('RES'),
            input.referenceType,
            input.referenceId ?? null,
            input.expiresAt ?? null,
            input.createdBy,
          ],
        );
        const reservationId = str(reservationRow.rows[0].id);

        const items: ReservationItem[] = [];
        for (const item of input.items) {
          const { warehouseId, materialId } = await this.resolveIds(
            client,
            item.warehouseCode,
            item.materialCode,
          );

          // Lock the balance row so two reservations cannot claim the same stock.
          const balance = await client.query<Row>(
            `SELECT quantity, quantity_reserved
             FROM inventory_schema.material_inventory
             WHERE warehouse_id = $1 AND material_id = $2
             FOR UPDATE`,
            [warehouseId, materialId],
          );

          const available =
            num(balance.rows[0]?.quantity) - num(balance.rows[0]?.quantity_reserved);
          if (available < item.quantityReserved) {
            throw new InsufficientStockError(
              item.materialCode,
              item.quantityReserved,
              available,
            );
          }

          const itemRow = await client.query<Row>(
            `INSERT INTO inventory_schema.reservation_items
               (id, reservation_id, warehouse_id, material_id, quantity_reserved, quantity_issued)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 0)
             RETURNING *`,
            [reservationId, warehouseId, materialId, item.quantityReserved],
          );
          items.push(mapReservationItem(itemRow.rows[0]));

          await client.query(
            `UPDATE inventory_schema.material_inventory
             SET quantity_reserved = quantity_reserved + $3, updated_at = now()
             WHERE warehouse_id = $1 AND material_id = $2`,
            [warehouseId, materialId, item.quantityReserved],
          );
        }

        return mapReservation(reservationRow.rows[0], items);
      });
    },

    release: async (tenantId: string, reservationCode: string): Promise<Reservation | null> => {
      const pool = await this.poolFor(tenantId);
      return inTransaction(pool, async (client) => {
        // Khoá phiếu trước: hai lần nhả song song không được trừ hai lần.
        const header = await client.query<Row>(
          `SELECT * FROM inventory_schema.reservations WHERE reservation_code = $1 FOR UPDATE`,
          [reservationCode],
        );
        if (!header.rows[0]) return null;

        const status = str(header.rows[0].status);
        const reservationId = str(header.rows[0].id);
        const itemRows = await client.query<Row>(
          `SELECT * FROM inventory_schema.reservation_items WHERE reservation_id = $1`,
          [reservationId],
        );

        // Đã đóng rồi thì trả nguyên trạng, không trừ thêm.
        if (status === 'CANCELLED' || status === 'COMPLETED' || status === 'EXPIRED') {
          return mapReservation(header.rows[0], itemRows.rows.map(mapReservationItem));
        }

        for (const item of itemRows.rows) {
          const outstanding = num(item.quantity_reserved) - num(item.quantity_issued);
          if (outstanding <= 0) continue;
          await client.query(
            `UPDATE inventory_schema.material_inventory
             SET quantity_reserved = GREATEST(0, quantity_reserved - $3), updated_at = now()
             WHERE warehouse_id = $1 AND material_id = $2`,
            [str(item.warehouse_id), str(item.material_id), outstanding],
          );
        }

        const updated = await client.query<Row>(
          `UPDATE inventory_schema.reservations SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
          [reservationId],
        );
        return mapReservation(updated.rows[0], itemRows.rows.map(mapReservationItem));
      });
    },

    list: async (tenantId: string): Promise<Reservation[]> => {
      const pool = await this.poolFor(tenantId);
      const rows = await pool.query<Row>(
        `SELECT * FROM inventory_schema.reservations ORDER BY created_at DESC`,
      );
      const items = await pool.query<Row>(`SELECT * FROM inventory_schema.reservation_items`);
      return rows.rows.map((row) =>
        mapReservation(
          row,
          items.rows.filter((item) => str(item.reservation_id) === str(row.id)).map(mapReservationItem),
        ),
      );
    },

    findByCode: async (
      tenantId: string,
      reservationCode: string,
    ): Promise<Reservation | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.reservations WHERE reservation_code = $1 LIMIT 1`,
        [reservationCode],
      );
      if (!result.rows[0]) return null;
      const items = await pool.query<Row>(
        `SELECT * FROM inventory_schema.reservation_items WHERE reservation_id = $1`,
        [result.rows[0].id],
      );
      return mapReservation(result.rows[0], items.rows.map(mapReservationItem));
    },

    findByReference: async (
      tenantId: string,
      referenceType: string,
      referenceId: string,
    ): Promise<Reservation[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.reservations
         WHERE reference_type = $1 AND reference_id = $2 ORDER BY created_at DESC`,
        [referenceType, referenceId],
      );
      return result.rows.map((row) => mapReservation(row));
    },
  };

  serial = {
    list: async (tenantId: string): Promise<SerialTracking[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.serial_tracking ORDER BY serial_number`,
      );
      return result.rows.map(mapSerial);
    },
  };

  taskTemplate = {
    resolveAssetTaskTemplate: async (
      tenantId: string,
      assetCode: string,
    ): Promise<Record<string, unknown>[] | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT task_template FROM inventory_schema.assets WHERE code = $1 LIMIT 1`,
        [assetCode],
      );
      const template = result.rows[0]?.task_template;
      return Array.isArray(template) ? (template as Record<string, unknown>[]) : null;
    },
  };

  private async resolveIds(
    client: PoolClient,
    warehouseCode: string,
    materialCode: string,
  ): Promise<{ warehouseId: string; materialId: string }> {
    const warehouse = await client.query<Row>(
      `SELECT id FROM inventory_schema.warehouses WHERE code = $1 LIMIT 1`,
      [warehouseCode],
    );
    if (!warehouse.rows[0]) throw new WarehouseNotFoundError(warehouseCode);

    const material = await client.query<Row>(
      `SELECT id FROM inventory_schema.materials WHERE code = $1 LIMIT 1`,
      [materialCode],
    );
    if (!material.rows[0]) throw new MaterialNotFoundError(materialCode);

    return {
      warehouseId: str(warehouse.rows[0].id),
      materialId: str(material.rows[0].id),
    };
  }
}
