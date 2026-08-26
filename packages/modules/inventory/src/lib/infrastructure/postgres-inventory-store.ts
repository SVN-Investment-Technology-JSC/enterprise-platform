import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  Asset,
  InventoryItem,
  CreateAssetRequest,
  CreateMaterialRequest,
  UpdateMaterialRequest,
  InventoryTransaction,
  Material,
  MaterialInventory,
  Reservation,
  ReservationItem,
  AssetBomLine,
  SerialTracking,
  SettingsEntry,
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
  InventoryError,
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

function mapBomLine(row: Row): AssetBomLine {
  return {
    id: str(row.id),
    materialCode: str(row.material_code),
    materialName: str(row.material_name),
    unit: str(row.unit),
    standardQuantity: num(row.standard_quantity),
    isCriticalSpare: Boolean(row.is_critical_spare),
    note: opt(row.note),
  };
}

function mapSettingsEntry(row: Row): SettingsEntry<unknown> {
  return {
    key: str(row.key),
    value: row.value,
    version: num(row.version),
    updatedAt: iso(row.updated_at),
    updatedBy: opt(row.updated_by),
  };
}

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
    unit: opt(row.unit),
    // `null` là chưa khai báo; 0 là giá bằng không. Không gộp hai thứ này.
    purchasePrice: row.purchase_price == null ? undefined : num(row.purchase_price),
    currency: opt(row.currency),
    warrantyUntil: row.warranty_until ? iso(row.warranty_until).slice(0, 10) : undefined,
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

  /**
   * Vật tư và thiết bị dùng chung một bảng từ migration 0006.
   *
   * Mọi truy vấn ở nhóm này PHẢI lọc `kind = 'STOCK'`; thiếu bộ lọc thì thiết bị
   * lọt vào danh sách vật tư, và sổ cái tồn kho sẽ nhận những mã không có tồn.
   */
  material = {
    findByCode: async (tenantId: string, code: string): Promise<Material | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE code = $1 AND kind = 'STOCK' LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapMaterial(result.rows[0]) : null;
    },

    findAnyByCode: async (tenantId: string, code: string): Promise<Material | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE code = $1 AND kind = 'STOCK' LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapMaterial(result.rows[0]) : null;
    },

    list: async (tenantId: string): Promise<Material[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT * FROM inventory_schema.materials WHERE kind = 'STOCK' AND is_active = true ORDER BY code`,
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
          WHERE code = $1 AND kind = 'STOCK'
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
        `DELETE FROM inventory_schema.materials WHERE code = $1 AND kind = 'STOCK'`,
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
            serial_number, qr_code, org_unit_id, specs, task_template,
            unit, purchase_price, currency, warranty_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
                 $13, $14, $15, $16)
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
          input.unit ?? null,
          input.purchasePrice ?? null,
          input.currency ?? null,
          input.warrantyUntil ?? null,
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
                unit = COALESCE($13, unit),
                purchase_price = COALESCE($14, purchase_price),
                currency = COALESCE($15, currency),
                warranty_until = COALESCE($16, warranty_until),
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
          patch.unit ?? null,
          patch.purchasePrice ?? null,
          patch.currency ?? null,
          patch.warrantyUntil ?? null,
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

    availableByMaterial: async (tenantId: string): Promise<Map<string, number>> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ code: string; available: string }>(
        `SELECT m.code, COALESCE(SUM(mi.available), 0) AS available
           FROM inventory_schema.materials m
           LEFT JOIN inventory_schema.material_inventory mi ON mi.material_id = m.id
          WHERE m.kind = 'STOCK'
          GROUP BY m.code`,
      );
      return new Map(result.rows.map((row) => [row.code, Number(row.available)]));
    },
  };

  item = {
    listAll: async (tenantId: string): Promise<InventoryItem[]> => {
      const pool = await this.poolFor(tenantId);
      /**
       * `roots` leo ngược cây `parent_id` để tìm gốc của mỗi nhánh.
       *
       * Dùng CTE đệ quy chứ không leo bằng vòng lặp ở tầng ứng dụng: cây thiết
       * bị sâu vài tầng, leo ở JavaScript là mỗi tầng một lượt truy vấn.
       * `cycle` chặn dữ liệu hỏng (A là cha của B, B là cha của A) làm treo.
       */
      const result = await pool.query<Row>(
        `WITH RECURSIVE roots AS (
           SELECT id, id AS root_id, ARRAY[id] AS seen FROM inventory_schema.materials
            WHERE parent_id IS NULL
           UNION ALL
           SELECT m.id, r.root_id, r.seen || m.id
             FROM inventory_schema.materials m
             JOIN roots r ON m.parent_id = r.id
            WHERE NOT m.id = ANY(r.seen)
         ),
         stock AS (
           SELECT material_id, COALESCE(SUM(available), 0) AS available
             FROM inventory_schema.material_inventory GROUP BY material_id
         )
         SELECT m.code, m.name, m.kind, m.unit, m.category, m.type, m.status,
                COALESCE(s.available, 0) AS available,
                p.code AS installed_at_code, p.name AS installed_at_name,
                rt.code AS root_code, rt.name AS root_name
           FROM inventory_schema.materials m
           LEFT JOIN stock s ON s.material_id = m.id
           LEFT JOIN inventory_schema.materials p ON p.id = m.parent_id
           LEFT JOIN roots r ON r.id = m.id
           LEFT JOIN inventory_schema.materials rt ON rt.id = r.root_id AND rt.id <> m.id
          WHERE m.is_active
          ORDER BY m.kind, m.name`,
      );
      return result.rows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        kind: row.kind === 'ASSET' ? ('ASSET' as const) : ('STOCK' as const),
        unit: row.unit ? String(row.unit) : undefined,
        category: row.category ? (String(row.category) as InventoryItem['category']) : undefined,
        type: row.type ? (String(row.type) as InventoryItem['type']) : undefined,
        status: row.status ? (String(row.status) as InventoryItem['status']) : undefined,
        available: Number(row.available ?? 0),
        installedAtCode: row.installed_at_code ? String(row.installed_at_code) : undefined,
        installedAtName: row.installed_at_name ? String(row.installed_at_name) : undefined,
        rootCode: row.root_code ? String(row.root_code) : undefined,
        rootName: row.root_name ? String(row.root_name) : undefined,
      }));
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

    listByMaterial: async (
      tenantId: string,
      materialCode: string,
      limit: number,
    ): Promise<InventoryTransaction[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT t.* FROM inventory_schema.inventory_transactions t
           JOIN inventory_schema.materials m ON m.id = t.material_id
          WHERE m.code = $1
          ORDER BY t.created_at DESC LIMIT $2`,
        [materialCode, limit],
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

  bom = {
    listByAsset: async (tenantId: string, assetCode: string): Promise<AssetBomLine[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT b.id, b.standard_quantity, b.is_critical_spare, b.note,
                m.code AS material_code, m.name AS material_name, m.unit
           FROM inventory_schema.asset_boms b
           JOIN inventory_schema.assets a ON a.id = b.asset_id
           JOIN inventory_schema.materials m ON m.id = b.material_id AND m.kind = 'STOCK'
          WHERE a.code = $1
          ORDER BY b.is_critical_spare DESC, m.code`,
        [assetCode],
      );
      return result.rows.map(mapBomLine);
    },

    add: async (
      tenantId: string,
      assetCode: string,
      input: { materialCode: string; standardQuantity: number; isCriticalSpare?: boolean; note?: string },
    ): Promise<AssetBomLine> => {
      const pool = await this.poolFor(tenantId);
      // Chèn bằng SELECT để mã thiết bị và mã vật tư được phân giải trong cùng
      // một câu lệnh; sai mã thì không có dòng nào chèn và bên gọi báo 404.
      const inserted = await pool.query<Row>(
        `INSERT INTO inventory_schema.asset_boms
           (asset_id, material_id, standard_quantity, is_critical_spare, note)
         SELECT a.id, m.id, $3, $4, $5
           FROM inventory_schema.assets a, inventory_schema.materials m
          WHERE a.code = $1 AND m.code = $2 AND m.kind = 'STOCK'
      RETURNING id`,
        [
          assetCode,
          input.materialCode,
          input.standardQuantity,
          input.isCriticalSpare ?? false,
          input.note ?? null,
        ],
      );
      if (!inserted.rows[0]) {
        throw new InventoryError(
          'BOM_TARGET_NOT_FOUND',
          `Không tìm thấy thiết bị ${assetCode} hoặc vật tư ${input.materialCode}.`,
          404,
        );
      }
      const lines = await this.bom.listByAsset(tenantId, assetCode);
      const created = lines.find((line) => line.id === str(inserted.rows[0].id));
      if (!created) throw new InventoryError('BOM_TARGET_NOT_FOUND', 'Không đọc lại được phụ tùng vừa thêm.', 404);
      return created;
    },

    remove: async (tenantId: string, assetCode: string, bomId: string): Promise<boolean> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query(
        `DELETE FROM inventory_schema.asset_boms b
          USING inventory_schema.assets a
          WHERE b.asset_id = a.id AND a.code = $1 AND b.id = $2`,
        [assetCode, bomId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  settings = {
    list: async (tenantId: string): Promise<SettingsEntry<unknown>[]> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT key, value, version, updated_at, updated_by
           FROM inventory_schema.module_settings
          ORDER BY key`,
      );
      return result.rows.map(mapSettingsEntry);
    },

    get: async (tenantId: string, key: string): Promise<SettingsEntry<unknown> | null> => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT key, value, version, updated_at, updated_by
           FROM inventory_schema.module_settings
          WHERE key = $1
          LIMIT 1`,
        [key],
      );
      return result.rows[0] ? mapSettingsEntry(result.rows[0]) : null;
    },

    put: async (
      tenantId: string,
      key: string,
      value: unknown,
      updatedBy: string,
      expectedVersion?: number,
    ): Promise<SettingsEntry<unknown> | null> => {
      const pool = await this.poolFor(tenantId);
      // Mệnh đề WHERE nằm trên nhánh DO UPDATE: dòng chưa tồn tại thì INSERT đi
      // thẳng, dòng đã tồn tại mà version lệch thì không update và không trả
      // dòng nào — bên gọi đọc "không có dòng" thành xung đột version.
      const result = await pool.query<Row>(
        `INSERT INTO inventory_schema.module_settings (key, value, version, updated_at, updated_by)
         VALUES ($1, $2::jsonb, 1, now(), $3)
         ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                version = inventory_schema.module_settings.version + 1,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
          WHERE $4::int IS NULL OR inventory_schema.module_settings.version = $4::int
         RETURNING key, value, version, updated_at, updated_by`,
        [key, JSON.stringify(value), updatedBy, expectedVersion ?? null],
      );
      return result.rows[0] ? mapSettingsEntry(result.rows[0]) : null;
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
      `SELECT id FROM inventory_schema.materials WHERE code = $1 AND kind = 'STOCK' LIMIT 1`,
      [materialCode],
    );
    if (!material.rows[0]) throw new MaterialNotFoundError(materialCode);

    return {
      warehouseId: str(warehouse.rows[0].id),
      materialId: str(material.rows[0].id),
    };
  }
}
