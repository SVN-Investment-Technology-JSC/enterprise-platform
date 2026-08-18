import { randomUUID } from 'node:crypto';
import { PostgresPoolRegistry, inTransaction } from '@enterprise-platform/adapter-database';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import type {
  AssetStatusDto,
  AssetSummaryDto,
  CreateAssetDto,
  CreateAssetStatusDto,
  CreateItemDto,
  CreateWarehouseDto,
  ExportStockDto,
  ImportStockDto,
  InventoryWorkspaceDto,
  ItemDetailDto,
  ReservationSummaryDto,
  SerialTrackingDto,
  StockBalanceDto,
  StockTransactionDto,
  UpdateAssetSpecsDto,
  UploadAssetDocumentDto,
  WarehouseSummaryDto,
} from '@enterprise-platform/contract-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import { assertCanIssue } from '../domain/stock.policy.js';
import type { InventoryStore } from '../application/inventory-store.port.js';

type Row = Record<string, unknown>;

export class PostgresInventoryStore implements InventoryStore {
  constructor(
    private readonly pools: PostgresPoolRegistry,
    private readonly resolve: (tenantId: string) => Promise<TenantDatabaseReference>,
  ) {}

  async workspace(tenantId: string): Promise<InventoryWorkspaceDto> {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    await ensureAmmAssetsTable(pool);

    const ammCheck = await pool.query<{ has_amm: boolean }>(
      `SELECT (to_regclass('amm_schema.amm_materials') IS NOT NULL) AS has_amm`,
    );
    const hasAmm = Boolean(ammCheck.rows[0]?.has_amm);

    const ammAssetCheck = await pool.query<{ has_amm: boolean }>(
      `SELECT (to_regclass('amm_schema.amm_assets') IS NOT NULL) AS has_amm`,
    );
    const hasAmmAssets = Boolean(ammAssetCheck.rows[0]?.has_amm);

    const [w, i, b, t, a, s, r] = await Promise.all([
      pool.query<Row>(
        `SELECT w.*,
                coalesce(stock.item_count, 0)::int item_count,
                coalesce(loc.location_count, 0)::int location_count,
                coalesce(stock.total_on_hand, 0) total_on_hand
         FROM inventory_schema.warehouses w
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT item_id) item_count, sum(on_hand_qty) total_on_hand
           FROM inventory_schema.stock_balances
           WHERE warehouse_id = w.id
         ) stock ON true
         LEFT JOIN LATERAL (
           SELECT count(*) location_count
           FROM inventory_schema.warehouse_locations
           WHERE warehouse_id = w.id
         ) loc ON true
         ORDER BY w.plant_code NULLS LAST, w.code`,
      ),
      hasAmm
        ? pool.query<Row>(
            `SELECT DISTINCT ON (i.code) i.*, coalesce(m.category, 'SPARE_PART') as category, m.manufacturer, m.reorder_point, u.name uom
             FROM inventory_schema.items i
             JOIN inventory_schema.uoms u ON u.id = i.uom_id
             LEFT JOIN amm_schema.amm_materials m ON m.id = i.id
             ORDER BY i.code, i.created_at ASC`,
          )
        : pool.query<Row>(
            `SELECT DISTINCT ON (i.code) i.*, c.name category, NULL::text manufacturer, NULL::numeric reorder_point, u.name uom
             FROM inventory_schema.items i
             JOIN inventory_schema.uoms u ON u.id = i.uom_id
             LEFT JOIN inventory_schema.item_categories c ON c.id = i.category_id
             ORDER BY i.code, i.created_at ASC`,
          ),
      pool.query<Row>(
        `SELECT b.warehouse_id, w.code warehouse_code, w.plant_code, w.name warehouse_name,
                min(b.item_id::text)::uuid item_id,
                upper(trim(i.code)) item_code,
                max(i.name) item_name,
                max(i.min_stock) min_stock,
                max(u.name) uom,
                coalesce(sum(b.on_hand_qty), 0) on_hand_qty,
                coalesce(sum(b.reserved_qty), 0) reserved_qty,
                coalesce(sum(b.available_qty), 0) available_qty
         FROM inventory_schema.stock_balances b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
         JOIN inventory_schema.items i ON i.id = b.item_id
         JOIN inventory_schema.uoms u ON u.id = i.uom_id
         GROUP BY b.warehouse_id, w.code, w.plant_code, w.name, upper(trim(i.code))
         ORDER BY upper(trim(i.code)), w.code`,
      ),
      pool.query<Row>(
        `SELECT t.*, i.code item_code, i.name item_name, w.code warehouse_code
         FROM inventory_schema.stock_transactions t
         JOIN inventory_schema.items i ON i.id = t.item_id
         JOIN inventory_schema.warehouses w ON w.id = t.warehouse_id
         ORDER BY t.transaction_date DESC
         LIMIT 100`,
      ),
      hasAmmAssets
        ? pool.query<Row>(
            `SELECT a.*, count(b.id)::int bom_count,
                    coalesce(jsonb_agg(jsonb_build_object('itemCode', coalesce(i.code, 'SPARE'), 'itemName', coalesce(i.name, 'Phụ tùng'), 'quantity', b.standard_quantity, 'critical', b.is_critical_spare)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb) bom,
                    coalesce((SELECT jsonb_agg(event ORDER BY event_date DESC) FROM (
                      SELECT jsonb_build_object('id', l.id, 'date', l.created_at, 'title', concat(l.from_status, ' → ', l.to_status), 'type', CASE WHEN l.to_status = 'MAINTENANCE' THEN 'PREVENTIVE' ELSE 'INSPECTION' END, 'status', 'COMPLETED', 'technician', l.changed_by::text, 'note', l.reason) event, l.created_at event_date FROM amm_schema.amm_asset_status_logs l WHERE l.asset_id = a.id
                      UNION ALL
                      SELECT jsonb_build_object('id', ins.id, 'date', ins.installed_at, 'title', concat(CASE ins.action WHEN 'INSTALL' THEN 'Lắp đặt ' WHEN 'REMOVE' THEN 'Tháo dỡ ' ELSE 'Thay thế ' END, coalesce(ins.note, 'phụ tùng')), 'type', 'CORRECTIVE', 'status', 'COMPLETED', 'technician', ins.technician_id::text, 'note', ins.note, 'replacedParts', '[]'::jsonb) event, ins.installed_at event_date FROM amm_schema.amm_asset_installations ins WHERE ins.asset_id = a.id
                    ) events), '[]'::jsonb) maintenance_history,
                    '[]'::jsonb procedures
             FROM amm_schema.amm_assets a
             LEFT JOIN amm_schema.amm_asset_boms b ON b.asset_id = a.id
             LEFT JOIN inventory_schema.items i ON i.id = b.material_id
             GROUP BY a.id
             ORDER BY CASE a.type WHEN 'PLANT' THEN 1 WHEN 'AREA' THEN 2 WHEN 'SYSTEM' THEN 3 WHEN 'SUBSYSTEM' THEN 4 WHEN 'EQUIPMENT' THEN 5 WHEN 'ASSEMBLY' THEN 6 WHEN 'COMPONENT' THEN 7 ELSE 8 END, a.code`,
          )
        : Promise.resolve({ rows: [] as Row[] }),
      hasAmm
        ? pool.query<Row>(
            `SELECT s.*, m.code item_code, m.name item_name, w.code warehouse_code, a.code asset_code
             FROM amm_schema.amm_serial_tracking s
             JOIN amm_schema.amm_materials m ON m.id = s.material_id
             LEFT JOIN amm_schema.amm_warehouses w ON w.id = s.current_warehouse_id
             LEFT JOIN amm_schema.amm_assets a ON a.id = s.current_asset_id
             ORDER BY m.code, s.serial_number`,
          )
        : pool.query<Row>(
            `SELECT s.id, i.code item_code, i.name item_name, s.serial_number, NULL::text internal_code, s.status current_status, 'WAREHOUSE' location_type, w.code warehouse_code, s.installed_asset_code asset_code
             FROM inventory_schema.item_serials s
             JOIN inventory_schema.items i ON i.id = s.item_id
             LEFT JOIN inventory_schema.warehouses w ON w.id = s.warehouse_id
             ORDER BY i.code, s.serial_number`,
          ),
      hasAmm
        ? pool.query<Row>(
            `SELECT r.*, count(i.id)::int line_count, coalesce(sum(i.quantity_reserved), 0) total_reserved
             FROM amm_schema.amm_reservations r
             LEFT JOIN amm_schema.amm_reservation_items i ON i.reservation_id = r.id
             GROUP BY r.id
             ORDER BY r.created_at DESC`,
          )
        : Promise.resolve({ rows: [] as Row[] }),
    ]);

    let assetStatuses: AssetStatusDto[] = [];
    if (hasAmmAssets) {
      const stRes = await pool.query<Row>(
        `SELECT code, name, badge_label, color, sort_order, is_active, is_system
         FROM amm_schema.amm_asset_statuses
         WHERE is_active = true
         ORDER BY sort_order ASC, created_at ASC`,
      );
      assetStatuses = stRes.rows.map((row) => ({
        code: str(row.code),
        name: str(row.name),
        badgeLabel: row.badge_label ? str(row.badge_label) : undefined,
        color: str(row.color || '#10b981'),
        sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
        isActive: Boolean(row.is_active),
        isSystem: Boolean(row.is_system),
      }));
    }

    const balances = b.rows.map(balance);
    return {
      warehouses: w.rows.map(warehouse),
      items: i.rows.map(item),
      balances,
      lowStock: balances.filter((x) => x.available <= x.minStock),
      transactions: t.rows.map(transaction),
      assets: a.rows.map(asset),
      serials: s.rows.map(serial),
      reservations: r.rows.map(reservation),
      assetStatuses,
    };
  }

  async createWarehouse(tenantId: string, input: CreateWarehouseDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    try {
      const r = await pool.query<Row>(
        `INSERT INTO inventory_schema.warehouses(code, name, type, address)
         VALUES($1, $2, $3, $4)
         RETURNING *, 0::int item_count, 0::numeric total_on_hand`,
        [input.code.trim().toUpperCase(), input.name.trim(), input.type ?? 'PHYSICAL', input.address?.trim() || null],
      );
      return warehouse(r.rows[0]);
    } catch (e) {
      this.db(e, 'Mã kho đã tồn tại.');
    }
  }

  async createItem(tenantId: string, input: CreateItemDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    try {
      const uomCode = (input.uomCode || 'CAI').trim().toUpperCase();
      let uom = await pool.query<Row>(`SELECT id FROM inventory_schema.uoms WHERE upper(code) = $1 OR upper(name) = $1`, [uomCode]);
      let uomId = uom.rows[0]?.id as string | undefined;
      if (!uomId) {
        const uId = randomUUID();
        await pool.query(
          `INSERT INTO inventory_schema.uoms(id, code, name, precision) VALUES($1, $2, $3, 3) ON CONFLICT (code) DO NOTHING`,
          [uId, uomCode, uomCode],
        );
        uom = await pool.query<Row>(`SELECT id FROM inventory_schema.uoms WHERE upper(code) = $1`, [uomCode]);
        uomId = (uom.rows[0]?.id as string) || uId;
      }

      const r = await pool.query<Row>(
        `INSERT INTO inventory_schema.items(code, name, uom_id, tracking_type, costing_method, min_stock, max_stock)
         VALUES($1, $2, $3, $4, $5, $6, $7)
         RETURNING *, $8::text uom`,
        [
          input.code.trim().toUpperCase(),
          input.name.trim(),
          uomId,
          input.trackingType ?? 'NONE',
          input.costingMethod ?? 'FIFO',
          input.minStock ?? 0,
          input.maxStock ?? 0,
          uomCode,
        ],
      );

      // Also sync to amm_materials if table exists
      const ammMatCheck = await pool.query<{ has_table: boolean }>(
        `SELECT (to_regclass('amm_schema.amm_materials') IS NOT NULL) as has_table`,
      );
      if (ammMatCheck.rows[0]?.has_table && r.rows[0]?.id) {
        await pool.query(
          `INSERT INTO amm_schema.amm_materials(id, code, name, category, unit, min_stock, max_stock, is_active)
           VALUES($1, $2, $3, 'SPARE_PART', $4, $5, $6, true)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
          [
            r.rows[0].id,
            input.code.trim().toUpperCase(),
            input.name.trim(),
            uomCode,
            input.minStock ?? 0,
            input.maxStock ?? 0,
          ],
        );
      }

      return item(r.rows[0]);
    } catch (e) {
      if (e instanceof InventoryError) throw e;
      this.db(e, 'Mã vật tư đã tồn tại.');
    }
  }

  async createAsset(tenantId: string, input: CreateAssetDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    await ensureAmmAssetsTable(pool);

    try {
      return await inTransaction(pool, async (c) => {
        let parentType: string | undefined;
        if (input.parentId) {
          const p = await c.query<Row>(`SELECT type FROM amm_schema.amm_assets WHERE id = $1 FOR SHARE`, [input.parentId]);
          if (!p.rows[0]) throw new InventoryError('not_found', 'Không tìm thấy tài sản cha.');
          parentType = str(p.rows[0].type);
        }
        assertAssetParent(parentType, input.type);
        const code = input.code.trim().toUpperCase();
        const r = await c.query<Row>(
          `INSERT INTO amm_schema.amm_assets(code, name, parent_id, type, criticality, serial_number, specs, qr_code)
           VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING *`,
          [
            code,
            input.name.trim(),
            input.parentId ?? null,
            input.type,
            input.criticality ?? 'MEDIUM',
            input.serialNumber?.trim() || null,
            JSON.stringify(input.specs ?? {}),
            `QR-${code}`,
          ],
        );

        // If a PLANT is created, ensure an associated warehouse is registered for inventory stock
        if (input.type === 'PLANT') {
          await c.query(
            `INSERT INTO inventory_schema.warehouses(id, code, name, type, plant_code, warehouse_type, is_active)
             VALUES(gen_random_uuid(), $1, $2, 'PHYSICAL', $3, 'PLANT_MAIN', true)
             ON CONFLICT (code) DO NOTHING`,
            [`WH-${code}`, `Kho vật tư ${input.name.trim()}`, code],
          );
        }

        return asset(r.rows[0]);
      });
    } catch (e) {
      if (e instanceof InventoryError) throw e;
      this.db(e, 'Mã thiết bị đã tồn tại.');
    }
  }

  async updateAssetSpecs(tenantId: string, userId: string, assetId: string, input: UpdateAssetSpecsDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    const ammCheck = await pool.query<{ has_amm: boolean }>(
      `SELECT (to_regclass('amm_schema.amm_assets') IS NOT NULL) AS has_amm`,
    );
    if (!ammCheck.rows[0]?.has_amm) throw new InventoryError('not_found', 'Không tìm thấy thiết bị.');
    return inTransaction(pool, async (c) => {
      const current = await c.query<Row>(`SELECT status FROM amm_schema.amm_assets WHERE id = $1 FOR UPDATE`, [assetId]);
      if (!current.rows[0]) throw new InventoryError('not_found', 'Không tìm thấy thiết bị.');
      const oldStatus = str(current.rows[0].status);
      const r = await c.query<Row>(
        `UPDATE amm_schema.amm_assets
         SET specs = $2::jsonb || CASE WHEN specs ? '_documents' THEN jsonb_build_object('_documents', specs->'_documents') ELSE '{}'::jsonb END || CASE WHEN $3::text IS NOT NULL THEN jsonb_build_object('_description', $3::text) ELSE '{}'::jsonb END,
             status = coalesce($4, status),
             criticality = coalesce($5, criticality),
             updated_at = now()
         WHERE id = $1 RETURNING *`,
        [assetId, JSON.stringify(input.specs ?? {}), input.description ?? null, input.status ?? null, input.criticality ?? null],
      );
      if (input.status && input.status !== oldStatus) {
        await c.query(
          `INSERT INTO amm_schema.amm_asset_status_logs(asset_id, from_status, to_status, reason, changed_by)
           VALUES($1, $2, $3, $4, $5)`,
          [assetId, oldStatus, input.status, input.description ?? 'Cập nhật từ hồ sơ tài sản', userId],
        );
      }
      return asset(r.rows[0]);
    });
  }

  async uploadAssetDocument(tenantId: string, assetId: string, input: UploadAssetDocumentDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    const ammCheck = await pool.query<{ has_amm: boolean }>(
      `SELECT (to_regclass('amm_schema.amm_assets') IS NOT NULL) AS has_amm`,
    );
    if (!ammCheck.rows[0]?.has_amm) throw new InventoryError('not_found', 'Không tìm thấy thiết bị.');
    const document = {
      id: randomUUID(),
      title: input.title.trim(),
      docType: input.docType,
      fileName: input.fileName.trim(),
      fileUrl: input.fileUrl.trim(),
      fileSize: input.fileSize,
      uploadedAt: new Date().toISOString(),
    };
    const r = await pool.query(
      `UPDATE amm_schema.amm_assets
       SET specs = jsonb_set(coalesce(specs, '{}'::jsonb), '{_documents}', coalesce(specs->'_documents', '[]'::jsonb) || $2::jsonb, true),
           updated_at = now()
       WHERE id = $1 RETURNING id`,
      [assetId, JSON.stringify(document)],
    );
    if (!r.rowCount) throw new InventoryError('not_found', 'Không tìm thấy thiết bị.');
    return document;
  }

  async deleteAsset(tenantId: string, assetId: string): Promise<{ deletedIds: string[] }> {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    await ensureAmmAssetsTable(pool);

    return inTransaction(pool, async (c) => {
      // Find all descendant IDs recursively
      const descRes = await c.query<{ id: string; code: string; type: string }>(
        `WITH RECURSIVE descendants AS (
           SELECT id, code, type FROM amm_schema.amm_assets WHERE id = $1
           UNION ALL
           SELECT a.id, a.code, a.type FROM amm_schema.amm_assets a
           JOIN descendants d ON a.parent_id = d.id
         )
         SELECT id::text, code, type FROM descendants`,
        [assetId],
      );

      if (!descRes.rowCount) {
        throw new InventoryError('not_found', 'Không tìm thấy tài sản cần xóa.');
      }

      const deletedIds = descRes.rows.map((r) => r.id);
      const plantCodes = descRes.rows.filter((r) => r.type === 'PLANT').map((r) => r.code);

      // Clean up linked tables
      await c.query(`DELETE FROM amm_schema.amm_asset_boms WHERE asset_id = ANY($1::uuid[])`, [deletedIds]);
      await c.query(`DELETE FROM amm_schema.amm_asset_status_logs WHERE asset_id = ANY($1::uuid[])`, [deletedIds]);
      await c.query(`DELETE FROM amm_schema.amm_asset_installations WHERE asset_id = ANY($1::uuid[])`, [deletedIds]);
      await c.query(`DELETE FROM amm_schema.amm_assets WHERE id = ANY($1::uuid[])`, [deletedIds]);

      // If plants were deleted, also deactivate associated warehouses if unused
      if (plantCodes.length > 0) {
        await c.query(
          `UPDATE inventory_schema.warehouses SET is_active = false WHERE plant_code = ANY($1::text[])`,
          [plantCodes],
        );
      }

      return { deletedIds };
    });
  }

  async getAssetStatuses(tenantId: string): Promise<AssetStatusDto[]> {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    await ensureAmmAssetsTable(pool);
    const r = await pool.query<Row>(
      `SELECT code, name, badge_label, color, sort_order, is_active, is_system
       FROM amm_schema.amm_asset_statuses
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at ASC`,
    );
    return r.rows.map((row) => ({
      code: str(row.code),
      name: str(row.name),
      badgeLabel: row.badge_label ? str(row.badge_label) : undefined,
      color: str(row.color || '#10b981'),
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
      isActive: Boolean(row.is_active),
      isSystem: Boolean(row.is_system),
    }));
  }

  async createAssetStatus(tenantId: string, input: CreateAssetStatusDto): Promise<AssetStatusDto> {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    await ensureAmmAssetsTable(pool);
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const color = input.color?.trim() || '#10b981';
    const badgeLabel = input.badgeLabel?.trim() || name.split('(')[0].trim();
    const sortOrder = input.sortOrder ?? 100;

    const r = await pool.query<Row>(
      `INSERT INTO amm_schema.amm_asset_statuses(code, name, badge_label, color, sort_order, is_active, is_system)
       VALUES($1, $2, $3, $4, $5, true, false)
       ON CONFLICT (code) DO UPDATE 
       SET name = EXCLUDED.name,
           badge_label = EXCLUDED.badge_label,
           color = EXCLUDED.color,
           is_active = true,
           updated_at = now()
       RETURNING *`,
      [code, name, badgeLabel, color, sortOrder],
    );

    const row = r.rows[0];
    return {
      code: str(row.code),
      name: str(row.name),
      badgeLabel: row.badge_label ? str(row.badge_label) : undefined,
      color: str(row.color || '#10b981'),
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
      isActive: Boolean(row.is_active),
      isSystem: Boolean(row.is_system),
    };
  }

  async importStock(tenantId: string, userId: string, input: ImportStockDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    return inTransaction(pool, async (c) => {
      const id = randomUUID();
      const origin = input.sourceOrigin || input.supplierCode || 'Nhà cung cấp / Đối tác';
      await c.query(
        `INSERT INTO inventory_schema.stock_receipts(id, receipt_no, warehouse_id, supplier_code, created_by)
         VALUES($1, $2, $3, $4, $5)`,
        [id, input.receiptNo, input.warehouseId, origin, userId],
      );

      for (const line of input.lines) {
        let resolvedItemId = line.itemId;

        // Tự động tạo phụ tùng / vật tư mới hoàn toàn nếu được nhập trực tiếp
        if (!resolvedItemId && line.newItem) {
          const uomName = (line.newItem.uomCode || 'Cái').trim();
          let uomRes = await c.query<Row>(`SELECT id FROM inventory_schema.uoms WHERE code = $1 OR name = $2`, [
            uomName.toUpperCase(),
            uomName,
          ]);
          let uomId = uomRes.rows[0]?.id as string | undefined;
          if (!uomId) {
            const newUomId = randomUUID();
            const uomCode = `UOM-${line.newItem.code.slice(0, 4).toUpperCase()}`;
            await c.query(
              `INSERT INTO inventory_schema.uoms(id, code, name, precision) VALUES($1, $2, $3, 3) ON CONFLICT DO NOTHING`,
              [newUomId, uomCode, uomName],
            );
            uomRes = await c.query<Row>(`SELECT id FROM inventory_schema.uoms WHERE name = $1 OR code = $2`, [uomName, uomCode]);
            uomId = (uomRes.rows[0]?.id as string) || newUomId;
          }

          const newItemCode = line.newItem.code.trim().toUpperCase();
          const existingItem = await c.query<Row>(
            `SELECT id FROM inventory_schema.items WHERE upper(trim(code)) = $1`,
            [newItemCode],
          );
          if (existingItem.rows[0]) {
            resolvedItemId = existingItem.rows[0].id as string;
          } else {
            const newItemId = randomUUID();
            await c.query(
              `INSERT INTO inventory_schema.items(id, code, name, uom_id, description, tracking_type, costing_method, min_stock, max_stock)
               VALUES($1, $2, $3, $4, $5, 'NONE', 'FIFO', $6, $7)`,
              [
                newItemId,
                newItemCode,
                line.newItem.name.trim(),
                uomId,
                line.newItem.description || line.newItem.category || null,
                line.newItem.minStock ?? 0,
                line.newItem.maxStock ?? 0,
              ],
            );

            const ammMatCheck = await c.query<{ has_table: boolean }>(
              `SELECT (to_regclass('amm_schema.amm_materials') IS NOT NULL) as has_table`,
            );
            if (ammMatCheck.rows[0]?.has_table) {
              await c.query(
                `INSERT INTO amm_schema.amm_materials(id, code, name, category, unit, manufacturer, min_stock, max_stock, is_active)
                 VALUES($1, $2, $3, $4, $5, $6, $7, $8, true)
                 ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
                [
                  newItemId,
                  newItemCode,
                  line.newItem.name.trim(),
                  line.newItem.category || 'SPARE_PART',
                  uomName,
                  line.newItem.manufacturer || null,
                  line.newItem.minStock ?? 0,
                  line.newItem.maxStock ?? 0,
                ],
              );
            }
            resolvedItemId = newItemId;
          }
        }

        if (!resolvedItemId) {
          throw new InventoryError('validation', 'Vui lòng chọn vật tư hoặc nhập phụ tùng mới.');
        }

        const existingBal = await c.query<Row>(
          `SELECT id, on_hand_qty, location_id, lot_id FROM inventory_schema.stock_balances
           WHERE warehouse_id = $1 AND item_id = $2
             AND ($3::uuid IS NULL OR location_id = $3)
             AND ($4::uuid IS NULL OR lot_id = $4)
           ORDER BY on_hand_qty DESC, updated_at DESC
           LIMIT 1
           FOR UPDATE`,
          [input.warehouseId, resolvedItemId, line.locationId ?? null, line.lotId ?? null],
        );

        let before = 0;
        let after = line.quantity;

        if (existingBal.rows[0]) {
          before = Number(existingBal.rows[0].on_hand_qty ?? 0);
          after = before + line.quantity;
          await c.query(
            `UPDATE inventory_schema.stock_balances SET on_hand_qty = $2, updated_at = now() WHERE id = $1`,
            [existingBal.rows[0].id, after],
          );
        } else {
          before = 0;
          after = line.quantity;
          await c.query(
            `INSERT INTO inventory_schema.stock_balances(warehouse_id, location_id, item_id, lot_id, on_hand_qty, updated_at)
             VALUES($1, $2, $3, $4, $5, now())`,
            [input.warehouseId, line.locationId ?? null, resolvedItemId, line.lotId ?? null, after],
          );
        }

        await c.query(
          `INSERT INTO inventory_schema.stock_receipt_items(receipt_id, item_id, location_id, lot_id, quantity, unit_cost)
           VALUES($1, $2, $3, $4, $5, $6)`,
          [id, resolvedItemId, line.locationId ?? null, line.lotId ?? null, line.quantity, line.unitCost ?? 0],
        );
        await this.ledger(
          c,
          'RECEIPT',
          line.quantity,
          before,
          after,
          input.receiptNo,
          id,
          input.warehouseId,
          { ...line, itemId: resolvedItemId },
          userId,
          origin,
        );
      }
      return { id, receiptNo: input.receiptNo };
    });
  }

  async exportStock(tenantId: string, userId: string, input: ExportStockDto) {
    const pool = await this.pools.forTenant(await this.resolve(tenantId));
    const dest = input.destination || input.toLocation || 'Hiện trường / Công trường';
    return inTransaction(pool, async (c) => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO inventory_schema.stock_issues(id, issue_no, warehouse_id, reference_type, reference_id, destination, created_by)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.issueNo, input.warehouseId, input.referenceType ?? null, input.referenceId ?? null, dest, userId],
      );

      for (const line of input.lines) {
        if (!line.itemId) throw new InventoryError('validation', 'Vui lòng chọn vật tư cần xuất.');
        
        // Tìm dòng tồn kho phù hợp trong kho đã chọn (linh hoạt theo location nếu không chỉ định)
        const r = await c.query<Row>(
          `SELECT * FROM inventory_schema.stock_balances
           WHERE warehouse_id = $1 AND item_id = $2
             AND ($3::uuid IS NULL OR location_id = $3)
             AND ($4::uuid IS NULL OR lot_id = $4)
             AND available_qty > 0
           ORDER BY available_qty DESC
           FOR UPDATE`,
          [input.warehouseId, line.itemId, line.locationId ?? null, line.lotId ?? null],
        );

        if (!r.rows[0]) {
          const anyBal = await c.query<Row>(
            `SELECT coalesce(sum(on_hand_qty), 0) as total_on_hand, coalesce(sum(available_qty), 0) as total_available
             FROM inventory_schema.stock_balances
             WHERE warehouse_id = $1 AND item_id = $2`,
            [input.warehouseId, line.itemId],
          );
          const totalAvail = Number(anyBal.rows[0]?.total_available ?? 0);
          if (totalAvail <= 0) {
            throw new InventoryError('insufficient_stock', 'Thiết bị/vật tư này hiện không còn tồn khả dụng trong kho được chọn.');
          }
          throw new InventoryError('insufficient_stock', `Không đủ tồn khả dụng (Chỉ còn ${totalAvail} khả dụng trong kho).`);
        }

        const matchedBal = r.rows[0];
        const before = Number(matchedBal.on_hand_qty);
        const available = Number(matchedBal.available_qty);
        assertCanIssue(available, line.quantity);
        const after = before - line.quantity;
        await c.query(`UPDATE inventory_schema.stock_balances SET on_hand_qty = $2, updated_at = now() WHERE id = $1`, [
          matchedBal.id,
          after,
        ]);

        const resolvedLocationId = (matchedBal.location_id as string | undefined) ?? line.locationId ?? undefined;
        const resolvedLotId = (matchedBal.lot_id as string | undefined) ?? line.lotId ?? undefined;

        await c.query(
          `INSERT INTO inventory_schema.stock_issue_items(issue_id, item_id, location_id, lot_id, quantity, unit_cost)
           VALUES($1, $2, $3, $4, $5, $6)`,
          [id, line.itemId, resolvedLocationId ?? null, resolvedLotId ?? null, line.quantity, line.unitCost ?? 0],
        );
        await this.ledger(
          c,
          'ISSUE',
          -line.quantity,
          before,
          after,
          input.issueNo,
          id,
          input.warehouseId,
          { ...line, locationId: resolvedLocationId, lotId: resolvedLotId },
          userId,
          dest,
        );

      }
      return { id, issueNo: input.issueNo };
    });
  }


  private ledger(
    c: { query: (q: string, v?: unknown[]) => Promise<unknown> },
    type: string,
    change: number,
    before: number,
    after: number,
    no: string,
    id: string,
    wid: string,
    line: { itemId?: string; locationId?: string; lotId?: string; unitCost?: number },
    user: string,
    destOrOrigin?: string,
  ) {
    const noteText = destOrOrigin ? (type === 'ISSUE' ? `Xuất tới: ${destOrOrigin}` : `Nguồn: ${destOrOrigin}`) : null;
    const txCode = `TX-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    return c.query(
      `INSERT INTO inventory_schema.stock_transactions(transaction_code, transaction_type, item_id, warehouse_id, location_id, lot_id, qty_change, balance_before, balance_after, unit_cost, reference_type, reference_id, performed_by, notes, destination, source_origin)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        txCode,
        type,
        line.itemId,
        wid,
        line.locationId ?? null,
        line.lotId ?? null,
        change,
        before,
        after,
        line.unitCost ?? 0,
        type,
        id,
        user,
        noteText,
        type === 'ISSUE' ? destOrOrigin ?? null : null,
        type === 'RECEIPT' ? destOrOrigin ?? null : null,
      ],
    );
  }

  private db(e: unknown, msg: string): never {
    if (typeof e === 'object' && e && 'code' in e && String(e.code) === '23505') {
      throw new InventoryError('conflict', msg);
    }
    throw e;
  }
}

const str = (v: unknown) => String(v);
const num = (v: unknown) => Number(v);

function warehouse(r?: Row): WarehouseSummaryDto {
  if (!r) throw new InventoryError('conflict', 'Không nhận được dữ liệu kho.');
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    type: str(r.type),
    plantCode: optional(r.plant_code),
    warehouseType: optional(r.warehouse_type),
    address: optional(r.address),
    itemCount: num(r.item_count),
    locationCount: num(r.location_count),
    totalOnHand: num(r.total_on_hand),
  };
}

function item(r?: Row): ItemDetailDto {
  if (!r) throw new InventoryError('conflict', 'Không nhận được dữ liệu vật tư.');
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    uom: str(r.uom),
    category: optional(r.category),
    manufacturer: optional(r.manufacturer),
    trackingType: r.tracking_type as ItemDetailDto['trackingType'],
    minStock: num(r.min_stock),
    maxStock: num(r.max_stock),
    reorderPoint: r.reorder_point == null ? undefined : num(r.reorder_point),
    isActive: Boolean(r.is_active),
  };
}

function balance(r: Row): StockBalanceDto {
  return {
    warehouseId: str(r.warehouse_id),
    warehouseCode: str(r.warehouse_code),
    plantCode: optional(r.plant_code),
    warehouseName: optional(r.warehouse_name),
    itemId: str(r.item_id),
    itemCode: str(r.item_code),
    itemName: str(r.item_name),
    uom: str(r.uom),
    onHand: num(r.on_hand_qty),
    reserved: num(r.reserved_qty),
    available: num(r.available_qty),
    minStock: num(r.min_stock),
  };
}

function transaction(r: Row): StockTransactionDto {
  return {
    id: str(r.id),
    code: str(r.transaction_code),
    date: new Date(str(r.transaction_date)).toISOString(),
    type: str(r.transaction_type),
    itemCode: str(r.item_code),
    itemName: str(r.item_name),
    warehouseCode: str(r.warehouse_code),
    quantity: num(r.qty_change),
    balanceBefore: num(r.balance_before),
    balanceAfter: num(r.balance_after),
    unitCost: num(r.unit_cost),
    referenceType: str(r.reference_type),
    referenceId: str(r.reference_id),
    notes: optional(r.notes),
    destination: optional(r.destination),
    sourceOrigin: optional(r.source_origin),
  };
}

function asset(r: Row): AssetSummaryDto {
  const code = str(r.code);
  const rawSpecs = isRecord(r.specs) ? r.specs : {};
  const specs = Object.fromEntries(Object.entries(rawSpecs).filter(([key]) => !key.startsWith('_')));
  return {
    id: str(r.id),
    code,
    name: str(r.name),
    parentId: optional(r.parent_id),
    type: r.type as AssetSummaryDto['type'],
    status: str(r.status),
    criticality: str(r.criticality),
    serialNumber: optional(r.serial_number),
    qrCode: optional(r.qr_code),
    specs,
    bomCount: num(r.bom_count ?? 0),
    bom: Array.isArray(r.bom) ? (r.bom as AssetSummaryDto['bom']) : [],
    documents: Array.isArray(rawSpecs._documents) ? (rawSpecs._documents as AssetSummaryDto['documents']) : [],
    maintenanceHistory: Array.isArray(r.maintenance_history)
      ? (r.maintenance_history as AssetSummaryDto['maintenanceHistory'])
      : [],
    procedures: Array.isArray(r.procedures) ? (r.procedures as AssetSummaryDto['procedures']) : [],
  };
}

function serial(r: Row): SerialTrackingDto {
  return {
    id: str(r.id),
    itemCode: str(r.item_code),
    itemName: str(r.item_name),
    serialNumber: str(r.serial_number),
    internalCode: optional(r.internal_code),
    status: str(r.current_status),
    locationType: str(r.location_type),
    warehouseCode: optional(r.warehouse_code),
    assetCode: optional(r.asset_code),
  };
}

function reservation(r: Row): ReservationSummaryDto {
  return {
    id: str(r.id),
    code: str(r.reservation_code),
    referenceType: str(r.reference_type),
    referenceId: str(r.reference_id),
    status: str(r.status),
    expiresAt: r.expires_at ? new Date(str(r.expires_at)).toISOString() : undefined,
    lineCount: num(r.line_count),
    totalReserved: num(r.total_reserved),
  };
}

function optional(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAssetParent(parentType: string | undefined, childType: CreateAssetDto['type'] | string) {
  if (!childType || typeof childType !== 'string' || !childType.trim()) {
    throw new InventoryError('validation', 'Vui lòng chọn hoặc nhập loại phân cấp tài sản.');
  }
}

async function ensureAmmAssetsTable(pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): Promise<void> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS amm_schema;
    CREATE TABLE IF NOT EXISTS amm_schema.amm_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      parent_id UUID,
      type VARCHAR(50) NOT NULL DEFAULT 'EQUIPMENT',
      status VARCHAR(50) NOT NULL DEFAULT 'OPERATING',
      criticality VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
      serial_number VARCHAR(100),
      specs JSONB DEFAULT '{}'::jsonb,
      qr_code VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE amm_schema.amm_assets DROP CONSTRAINT IF EXISTS amm_assets_type_check;
    CREATE TABLE IF NOT EXISTS amm_schema.amm_asset_boms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id UUID NOT NULL,
      material_id UUID,
      standard_quantity NUMERIC DEFAULT 1,
      is_critical_spare BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS amm_schema.amm_asset_status_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id UUID NOT NULL,
      from_status VARCHAR(50) NOT NULL,
      to_status VARCHAR(50) NOT NULL,
      reason TEXT,
      changed_by UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS amm_schema.amm_asset_installations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id UUID NOT NULL,
      material_id UUID,
      action VARCHAR(50) NOT NULL DEFAULT 'INSTALL',
      technician_id UUID,
      note TEXT,
      installed_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS amm_schema.amm_asset_statuses (
      code VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      badge_label VARCHAR(100),
      color VARCHAR(30) NOT NULL DEFAULT '#10b981',
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO amm_schema.amm_asset_statuses(code, name, badge_label, color, sort_order, is_active, is_system)
    VALUES
      ('OPERATING', 'OPERATING (Đang chạy)', 'Đang chạy', '#10b981', 10, true, true),
      ('TESTING', 'TESTING (Đang thí nghiệm)', 'Đang thí nghiệm', '#0284c7', 20, true, true),
      ('COMMISSIONING', 'COMMISSIONING (Chạy thử nghiệm thu)', 'Chạy thử nghiệm thu', '#06b6d4', 30, true, true),
      ('MAINTENANCE', 'MAINTENANCE (Bảo trì)', 'Bảo trì', '#f59e0b', 40, true, true),
      ('STOPPED', 'STOPPED (Dừng sự cố)', 'Dừng sự cố', '#ef4444', 50, true, true),
      ('STORAGE', 'STORAGE (Lưu kho / Dự phòng)', 'Lưu kho', '#6b7280', 60, true, true)
    ON CONFLICT (code) DO NOTHING;
  `);
}
