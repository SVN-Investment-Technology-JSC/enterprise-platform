import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  BulkStorageLocationItem,
  BulkStorageLocationsResult,
  MaterialStorageLocation,
  WarehouseLocationLevels,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  ReplaceStorageLocationsInput,
  StorageLocationListFilter,
  StorageLocationStore,
} from '../application/storage-location-store.port.js';
import {
  InventoryError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import { likePattern } from '../domain/stock-movement.js';

type Row = QueryResultRow & Record<string, unknown>;
type Queryable = Pick<PoolClient, 'query'>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined => (value == null ? undefined : String(value));
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

/** Cột dùng chung của mọi truy vấn trả `MaterialStorageLocation`. */
const SELECT_LOCATION = `SELECT l.id, w.code AS warehouse_code, w.name AS warehouse_name,
         m.code AS material_code, m.name AS material_name,
         l.location_text, l.segments, l.is_primary, l.note, l.updated_at, l.updated_by
    FROM inventory_schema.material_storage_locations l
    JOIN inventory_schema.warehouses w ON w.id = l.warehouse_id
    JOIN inventory_schema.materials m ON m.id = l.material_id`;

function mapLocation(row: Row): MaterialStorageLocation {
  return {
    id: str(row.id),
    warehouseCode: str(row.warehouse_code),
    warehouseName: str(row.warehouse_name),
    materialCode: str(row.material_code),
    materialName: str(row.material_name),
    locationText: str(row.location_text),
    segments: Array.isArray(row.segments) ? row.segments.map((part) => String(part)) : undefined,
    isPrimary: Boolean(row.is_primary),
    note: opt(row.note),
    updatedAt: iso(row.updated_at),
    updatedBy: opt(row.updated_by),
  };
}

/**
 * Vị trí lưu trữ trên Postgres (`0026-material-storage-locations`). Mọi giá trị đi qua tham số; việc ghi dùng khoá
 * tư vấn theo cặp (kho, mặt hàng) để hai lần thay thế đồng thời không vướng chỉ mục "một vị trí chính".
 */
export class PostgresStorageLocationStore implements StorageLocationStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async list(tenantId: string, filter: StorageLocationListFilter): Promise<MaterialStorageLocation[]> {
    const pool = await this.poolFor(tenantId);
    if (filter.warehouseCode) await this.requireWarehouse(pool, filter.warehouseCode);
    if (filter.materialCode) await this.requireMaterial(pool, filter.materialCode);

    const values: unknown[] = [];
    const param = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const where: string[] = ['TRUE'];
    if (filter.warehouseCode) where.push(`upper(w.code) = upper(${param(filter.warehouseCode)})`);
    if (filter.materialCode) where.push(`upper(m.code) = upper(${param(filter.materialCode)})`);
    if (filter.q) {
      const pattern = param(likePattern(filter.q));
      where.push(`(l.location_text ILIKE ${pattern} OR m.code ILIKE ${pattern} OR m.name ILIKE ${pattern})`);
    }
    const result = await pool.query<Row>(
      `${SELECT_LOCATION}
        WHERE ${where.join(' AND ')}
        ORDER BY w.code, m.code, l.is_primary DESC, lower(l.location_text)
        LIMIT ${param(filter.limit)}`,
      values,
    );
    return result.rows.map(mapLocation);
  }

  async replace(tenantId: string, input: ReplaceStorageLocationsInput): Promise<MaterialStorageLocation[]> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const warehouse = await this.requireWarehouse(client, input.warehouseCode);
      if (warehouse.type !== 'PHYSICAL') {
        throw new InventoryError(
          'STORAGE_LOCATION_WAREHOUSE_VIRTUAL',
          `Kho ${warehouse.code} là kho trung chuyển, không khai vị trí lưu trữ.`,
        );
      }
      const material = await this.requireMaterial(client, input.materialCode);
      if (material.kind === 'SERVICE') {
        throw new InventoryError(
          'STORAGE_LOCATION_SERVICE_MATERIAL',
          `${material.code} là dịch vụ, không có vị trí lưu trữ.`,
        );
      }
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `inventory.storage-location:${warehouse.id}:${material.id}`,
      ]);

      // Hạ cờ chính trước: upsert từng dòng rồi mới đặt lại cờ cho dòng được chọn, để chỉ mục "một vị trí chính"
      // không bị vướng khi đổi vị trí chính.
      await client.query(
        `UPDATE inventory_schema.material_storage_locations
            SET is_primary = FALSE
          WHERE warehouse_id = $1 AND material_id = $2 AND is_primary`,
        [warehouse.id, material.id],
      );
      // So khóa bằng chính hàm của database ở cả hai vế, cùng cách chỉ mục duy nhất hiểu "trùng", để kết quả không
      // phụ thuộc cách database viết thường chữ có dấu.
      await client.query(
        `DELETE FROM inventory_schema.material_storage_locations
          WHERE warehouse_id = $1 AND material_id = $2
            AND lower(btrim(location_text)) NOT IN (
              SELECT lower(btrim(kept)) FROM unnest($3::text[]) AS kept
            )`,
        [warehouse.id, material.id, input.locations.map((entry) => entry.locationText)],
      );
      for (const entry of input.locations) {
        await client.query(
          `INSERT INTO inventory_schema.material_storage_locations
             (warehouse_id, material_id, location_text, segments, is_primary, note, updated_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
           ON CONFLICT (warehouse_id, material_id, (lower(btrim(location_text))))
           DO UPDATE SET location_text = EXCLUDED.location_text,
                         segments = EXCLUDED.segments,
                         is_primary = EXCLUDED.is_primary,
                         note = EXCLUDED.note,
                         updated_at = now(),
                         updated_by = EXCLUDED.updated_by`,
          [
            warehouse.id,
            material.id,
            entry.locationText,
            entry.segments ? JSON.stringify(entry.segments) : null,
            entry.isPrimary,
            entry.note ?? null,
            input.actorId,
          ],
        );
      }
      const result = await client.query<Row>(
        `${SELECT_LOCATION}
          WHERE l.warehouse_id = $1 AND l.material_id = $2
          ORDER BY l.is_primary DESC, lower(l.location_text)`,
        [warehouse.id, material.id],
      );
      return result.rows.map(mapLocation);
    });
  }

  async setWarehouseLevels(
    tenantId: string,
    warehouseCode: string,
    levels: readonly string[] | null,
  ): Promise<WarehouseLocationLevels> {
    const pool = await this.poolFor(tenantId);
    const result = await pool.query<Row>(
      `UPDATE inventory_schema.warehouses
          SET location_levels = $2::jsonb
        WHERE upper(code) = upper($1)
      RETURNING code, location_levels`,
      [warehouseCode, levels === null ? null : JSON.stringify(levels)],
    );
    const row = result.rows[0];
    if (!row) throw new WarehouseNotFoundError(warehouseCode);
    return {
      warehouseCode: str(row.code),
      levels: Array.isArray(row.location_levels) ? row.location_levels.map((name) => String(name)) : null,
    };
  }

  async bulkUpsert(
    tenantId: string,
    items: readonly BulkStorageLocationItem[],
    actorId: string,
    overwritePrimary = false,
  ): Promise<BulkStorageLocationsResult> {
    const pool = await this.poolFor(tenantId);
    let successCount = 0;
    const errors: { materialCode: string; warehouseCode: string; message: string }[] = [];

    for (const item of items) {
      const matCode = (item.materialCode || '').trim();
      const whCode = (item.warehouseCode || '').trim();
      const locText = (item.locationText || '').trim();

      if (!matCode || !whCode || !locText) {
        errors.push({ materialCode: matCode, warehouseCode: whCode, message: 'Thiếu mã hàng, mã kho hoặc vị trí.' });
        continue;
      }
      if (locText.length > 255) {
        errors.push({ materialCode: matCode, warehouseCode: whCode, message: 'Chuỗi vị trí vượt quá 255 ký tự.' });
        continue;
      }

      try {
        await inTransaction(pool, async (client) => {
          const wh = await client.query<Row>(
            `SELECT id, code, type FROM inventory_schema.warehouses WHERE upper(code) = upper($1) LIMIT 1`,
            [whCode],
          );
          if (!wh.rows[0]) throw new WarehouseNotFoundError(whCode);
          if (wh.rows[0].type !== 'PHYSICAL') {
            throw new InventoryError('STORAGE_LOCATION_WAREHOUSE_VIRTUAL', `Kho ${whCode} là kho trung chuyển ảo.`);
          }

          const mat = await client.query<Row>(
            `SELECT id, code, kind FROM inventory_schema.materials WHERE upper(code) = upper($1) LIMIT 1`,
            [matCode],
          );
          if (!mat.rows[0]) throw new MaterialNotFoundError(matCode);
          if (mat.rows[0].kind === 'SERVICE') {
            throw new InventoryError('STORAGE_LOCATION_SERVICE_MATERIAL', `${matCode} là dịch vụ.`);
          }

          const warehouseId = str(wh.rows[0].id);
          const materialId = str(mat.rows[0].id);

          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
            `inventory.storage-location:${warehouseId}:${materialId}`,
          ]);

          const primaryRes = await client.query<Row>(
            `SELECT id, location_text FROM inventory_schema.material_storage_locations
              WHERE warehouse_id = $1 AND material_id = $2 AND is_primary = true LIMIT 1`,
            [warehouseId, materialId],
          );

          let isPrimary = false;
          if (!primaryRes.rows[0]) {
            isPrimary = true;
          } else if (item.isPrimary && overwritePrimary) {
            await client.query(
              `UPDATE inventory_schema.material_storage_locations SET is_primary = false WHERE id = $1`,
              [primaryRes.rows[0].id],
            );
            isPrimary = true;
          }

          await client.query(
            `INSERT INTO inventory_schema.material_storage_locations
               (warehouse_id, material_id, location_text, is_primary, note, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (warehouse_id, material_id, (lower(btrim(location_text))))
             DO UPDATE SET
               is_primary = CASE WHEN $4 THEN true ELSE inventory_schema.material_storage_locations.is_primary END,
               note = COALESCE($5, inventory_schema.material_storage_locations.note),
               updated_at = now(),
               updated_by = $6`,
            [warehouseId, materialId, locText, isPrimary, item.note?.trim() || null, actorId],
          );
        });
        successCount++;
      } catch (err: any) {
        errors.push({
          materialCode: matCode,
          warehouseCode: whCode,
          message: err?.message || 'Lỗi lưu vị trí.',
        });
      }
    }

    return { successCount, errorCount: errors.length, errors };
  }

  private async requireWarehouse(
    db: Queryable,
    code: string,
  ): Promise<{ id: string; code: string; type: string }> {
    const result = await db.query<Row>(
      `SELECT id, code, type FROM inventory_schema.warehouses WHERE upper(code) = upper($1) LIMIT 1`,
      [code],
    );
    const row = result.rows[0];
    if (!row) throw new WarehouseNotFoundError(code);
    return { id: str(row.id), code: str(row.code), type: str(row.type) };
  }

  private async requireMaterial(
    db: Queryable,
    code: string,
  ): Promise<{ id: string; code: string; kind: string }> {
    const result = await db.query<Row>(
      `SELECT id, code, kind FROM inventory_schema.materials
        WHERE upper(code) = upper($1) AND kind IN ('STOCK', 'SERVICE') LIMIT 1`,
      [code],
    );
    const row = result.rows[0];
    if (!row) throw new MaterialNotFoundError(code);
    return { id: str(row.id), code: str(row.code), kind: str(row.kind) };
  }
}
