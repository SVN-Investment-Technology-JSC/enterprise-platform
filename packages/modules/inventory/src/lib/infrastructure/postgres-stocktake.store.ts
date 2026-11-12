import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  CreateStocktakeRequest,
  StocktakeLine,
  StocktakeLineAudit,
  StocktakeLotAllocation,
  StocktakeScopeType,
  StocktakeSerialAllocation,
  StocktakeSession,
  StocktakeStatus,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { LatestMaterialStocktake, StocktakeStore } from '../application/stocktake-store.port.js';
import {
  InsufficientStockError,
  InventoryError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';

type Row = QueryResultRow & Record<string, unknown>;

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return iso(value);
}

function lineStatus(
  systemQty: number,
  actualQty?: number,
): 'UNCOUNTED' | 'MATCHED' | 'SURPLUS' | 'DEFICIT' {
  if (actualQty === undefined) return 'UNCOUNTED';
  const diff = actualQty - systemQty;
  if (Math.abs(diff) < 1e-6) return 'MATCHED';
  return diff > 0 ? 'SURPLUS' : 'DEFICIT';
}

function parseJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return value as T;
}

function mapSession(row: Row): StocktakeSession {
  return {
    id: String(row['id']),
    code: String(row['code']),
    title: String(row['title']),
    warehouseId: String(row['warehouse_id']),
    warehouseCode: String(row['warehouse_code'] ?? ''),
    warehouseName: row['warehouse_name'] ? String(row['warehouse_name']) : undefined,
    status: String(row['status']) as StocktakeStatus,
    scopeType: String(row['scope_type']) as StocktakeScopeType,
    scopeCategories: parseJson<string[]>(row['scope_categories']),
    snapshotAt: optionalIso(row['snapshot_at']),
    leadAuditor: row['lead_auditor'] ? String(row['lead_auditor']) : undefined,
    auditors: parseJson<string[]>(row['auditors']),
    approvedBy: row['approved_by'] ? String(row['approved_by']) : undefined,
    approvedAt: optionalIso(row['approved_at']),
    note: row['note'] ? String(row['note']) : undefined,
    totalItems: num(row['total_items']),
    countedItems: num(row['counted_items']),
    differenceItems: num(row['difference_items']),
    totalVarianceValue: num(row['total_variance_value']),
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

function mapLine(row: Row, audits: StocktakeLineAudit[]): StocktakeLine {
  const sysQty = num(row['system_quantity']);
  const actualQty =
    row['actual_quantity'] === null || row['actual_quantity'] === undefined
      ? undefined
      : num(row['actual_quantity']);
  const unitCost = num(row['unit_cost']);
  const diff = actualQty === undefined ? 0 : actualQty - sysQty;
  return {
    id: String(row['id']),
    sessionId: String(row['session_id']),
    materialId: String(row['material_id']),
    materialCode: String(row['material_code'] ?? ''),
    materialName: String(row['material_name'] ?? ''),
    unit: String(row['unit'] ?? ''),
    binLocation: row['bin_location'] ? String(row['bin_location']) : undefined,
    isSerialized: Boolean(row['is_serialized']),
    isLotTracked: Boolean(row['is_lot_tracked']),
    systemQuantity: sysQty,
    countRound1:
      row['count_round_1'] === null || row['count_round_1'] === undefined
        ? undefined
        : num(row['count_round_1']),
    countRound2:
      row['count_round_2'] === null || row['count_round_2'] === undefined
        ? undefined
        : num(row['count_round_2']),
    actualQuantity: actualQty,
    difference: diff,
    unitCost,
    differenceValue: actualQty === undefined ? 0 : diff * unitCost,
    reason: row['reason'] ? String(row['reason']) : undefined,
    status: String(row['status'] ?? 'UNCOUNTED') as StocktakeLine['status'],
    lotAllocations: parseJson<StocktakeLotAllocation[]>(row['lot_allocations']),
    serialAllocations: parseJson<StocktakeSerialAllocation[]>(row['serial_allocations']),
    note: row['note'] ? String(row['note']) : undefined,
    updatedAt: optionalIso(row['updated_at']),
    audits,
  };
}

const SESSION_SUMMARY_SQL = `
  SELECT s.*,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         COALESCE(stats.total_items, 0)::int AS total_items,
         COALESCE(stats.counted_items, 0)::int AS counted_items,
         COALESCE(stats.difference_items, 0)::int AS difference_items,
         COALESCE(stats.total_variance_value, 0)::float8 AS total_variance_value
    FROM inventory_schema.stocktake_sessions s
    JOIN inventory_schema.warehouses w ON w.id = s.warehouse_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total_items,
             COUNT(*) FILTER (WHERE l.actual_quantity IS NOT NULL) AS counted_items,
             COUNT(*) FILTER (WHERE l.actual_quantity IS NOT NULL AND ABS(l.actual_quantity - l.system_quantity) > 1e-6) AS difference_items,
             COALESCE(SUM(
               CASE WHEN l.actual_quantity IS NOT NULL
                    THEN (l.actual_quantity - l.system_quantity) * COALESCE(m.standard_cost, 0)
                    ELSE 0
               END
             ), 0) AS total_variance_value
        FROM inventory_schema.stocktake_lines l
        JOIN inventory_schema.materials m ON m.id = l.material_id
       WHERE l.session_id = s.id
    ) stats ON true
`;

export class PostgresStocktakeStore implements StocktakeStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  private async loadSession(client: Pool | PoolClient, sessionId: string): Promise<StocktakeSession> {
    const res = await client.query<Row>(`${SESSION_SUMMARY_SQL} WHERE s.id = $1`, [sessionId]);
    if (!res.rows[0]) {
      throw new InventoryError('STOCKTAKE_NOT_FOUND', `Không tìm thấy đợt kiểm kê ${sessionId}.`, 404);
    }
    return mapSession(res.rows[0]);
  }

  private async loadLinesInternal(client: Pool | PoolClient, sessionId: string): Promise<StocktakeLine[]> {
    const lineRes = await client.query<Row>(
      `SELECT l.*,
              m.code AS material_code,
              m.name AS material_name,
              m.unit,
              COALESCE(m.is_serialized, false) AS is_serialized,
              COALESCE(m.is_lot_tracked, false) AS is_lot_tracked,
              COALESCE(m.standard_cost, 0) AS unit_cost
         FROM inventory_schema.stocktake_lines l
         JOIN inventory_schema.materials m ON m.id = l.material_id
        WHERE l.session_id = $1
        ORDER BY m.code ASC`,
      [sessionId],
    );
    const lineIds = lineRes.rows.map((r) => String(r['id']));
    const auditsByLine = new Map<string, StocktakeLineAudit[]>();
    if (lineIds.length > 0) {
      const auditRes = await client.query<Row>(
        `SELECT * FROM inventory_schema.stocktake_line_audits
          WHERE line_id = ANY($1::uuid[])
          ORDER BY timestamp DESC`,
        [lineIds],
      );
      for (const a of auditRes.rows) {
        const lid = String(a['line_id']);
        const list = auditsByLine.get(lid) ?? [];
        list.push({
          id: String(a['id']),
          lineId: lid,
          previousQuantity:
            a['previous_quantity'] === null || a['previous_quantity'] === undefined
              ? undefined
              : num(a['previous_quantity']),
          newQuantity: num(a['new_quantity']),
          operator: String(a['operator']),
          timestamp: iso(a['timestamp']),
          reason: a['reason'] ? String(a['reason']) : undefined,
        });
        auditsByLine.set(lid, list);
      }
    }
    return lineRes.rows.map((r) => mapLine(r, auditsByLine.get(String(r['id'])) ?? []));
  }

  async listSessions(tenantId: string): Promise<StocktakeSession[]> {
    const pool = await this.poolFor(tenantId);
    const res = await pool.query<Row>(`${SESSION_SUMMARY_SQL} ORDER BY s.created_at DESC`);
    return res.rows.map(mapSession);
  }

  async listLines(tenantId: string, sessionId: string): Promise<StocktakeLine[]> {
    const pool = await this.poolFor(tenantId);
    return this.loadLinesInternal(pool, sessionId);
  }

  async latestByMaterial(
    tenantId: string,
    materialCode: string,
  ): Promise<LatestMaterialStocktake | null> {
    const pool = await this.poolFor(tenantId);
    const res = await pool.query<Row>(
      `SELECT s.code AS session_code,
              COALESCE(s.approved_at, s.snapshot_at, s.updated_at) AS counted_at,
              l.system_quantity,
              l.actual_quantity,
              l.status
         FROM inventory_schema.stocktake_lines l
         JOIN inventory_schema.stocktake_sessions s ON s.id = l.session_id
         JOIN inventory_schema.materials m ON m.id = l.material_id
        WHERE m.code = $1
          AND s.status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED')
        ORDER BY COALESCE(s.approved_at, s.updated_at) DESC
        LIMIT 1`,
      [materialCode],
    );
    const row = res.rows[0];
    if (!row) return null;
    const sysQty = num(row['system_quantity']);
    const actQty =
      row['actual_quantity'] === null || row['actual_quantity'] === undefined
        ? undefined
        : num(row['actual_quantity']);
    return {
      sessionCode: String(row['session_code']),
      countedAt: iso(row['counted_at']),
      systemQuantity: sysQty,
      actualQuantity: actQty,
      difference: actQty === undefined ? 0 : actQty - sysQty,
      status: String(row['status']),
    };
  }

  async createSession(tenantId: string, input: CreateStocktakeRequest): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const whRes = await client.query<Row>(
        `SELECT id FROM inventory_schema.warehouses WHERE code = $1`,
        [input.warehouseCode],
      );
      const warehouseId = whRes.rows[0]?.['id'];
      if (!warehouseId) {
        throw new WarehouseNotFoundError(input.warehouseCode);
      }

      const id = randomUUID();
      const year = new Date().getFullYear();
      const code =
        input.code?.trim() ||
        `KK-${year}-${String(Math.floor(Math.random() * 90000) + 10000)}`;

      await client.query(
        `INSERT INTO inventory_schema.stocktake_sessions
           (id, code, title, warehouse_id, status, scope_type, scope_categories, lead_auditor, auditors, note)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6::jsonb, $7, $8::jsonb, $9)`,
        [
          id,
          code,
          input.title.trim(),
          warehouseId,
          input.scopeType,
          input.scopeCategories ? JSON.stringify(input.scopeCategories) : null,
          input.leadAuditor ?? null,
          input.auditors ? JSON.stringify(input.auditors) : null,
          input.note ?? null,
        ],
      );

      // Nếu chọn SPECIFIC_ITEMS, lưu trước danh sách mã vật tư với tồn hiện tại = 0 (sẽ chụp lại lúc Bắt đầu đếm).
      if (input.scopeType === 'SPECIFIC_ITEMS' && input.specificMaterialCodes?.length) {
        await client.query(
          `INSERT INTO inventory_schema.stocktake_lines (id, session_id, material_id, system_quantity, status)
           SELECT gen_random_uuid(), $1, m.id,
                  COALESCE((
                    SELECT SUM(mi.quantity)
                      FROM inventory_schema.material_inventory mi
                     WHERE mi.warehouse_id = $2 AND mi.material_id = m.id
                  ), 0),
                  'UNCOUNTED'
             FROM inventory_schema.materials m
            WHERE m.code = ANY($3::text[])
              AND COALESCE(m.is_active, true) = true`,
          [id, warehouseId, input.specificMaterialCodes],
        );
      }

      return this.loadSession(client, id);
    });
  }

  async startCounting(
    tenantId: string,
    sessionId: string,
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const sRes = await client.query<Row>(
        `SELECT * FROM inventory_schema.stocktake_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      const sessionRow = sRes.rows[0];
      if (!sessionRow) {
        throw new InventoryError('STOCKTAKE_NOT_FOUND', `Không tìm thấy đợt kiểm kê ${sessionId}.`, 404);
      }
      if (sessionRow['status'] !== 'DRAFT') {
        throw new InventoryError('INVALID_STATUS', 'Chỉ đợt kiểm kê ở trạng thái Nháp mới có thể bắt đầu đếm.', 409);
      }

      const warehouseId = String(sessionRow['warehouse_id']);
      const scopeType = String(sessionRow['scope_type']);
      const scopeCategories = parseJson<string[]>(sessionRow['scope_categories']) ?? [];

      if (scopeType === 'SPECIFIC_ITEMS') {
        // Cập nhật lại system_quantity mới nhất từ tồn kho tại thời điểm chốt snapshot
        await client.query(
          `UPDATE inventory_schema.stocktake_lines l
              SET system_quantity = COALESCE((
                    SELECT SUM(mi.quantity)
                      FROM inventory_schema.material_inventory mi
                     WHERE mi.warehouse_id = $2 AND mi.material_id = l.material_id
                  ), 0),
                  updated_at = now()
            WHERE l.session_id = $1`,
          [sessionId, warehouseId],
        );
      } else {
        await client.query(`DELETE FROM inventory_schema.stocktake_lines WHERE session_id = $1`, [sessionId]);
        const filterByCategory = scopeType === 'CATEGORY' && scopeCategories.length > 0;
        await client.query(
          `INSERT INTO inventory_schema.stocktake_lines (id, session_id, material_id, system_quantity, status)
           SELECT gen_random_uuid(), $1, m.id, COALESCE(SUM(mi.quantity), 0), 'UNCOUNTED'
             FROM inventory_schema.materials m
             LEFT JOIN inventory_schema.material_inventory mi
               ON mi.material_id = m.id AND mi.warehouse_id = $2
            WHERE COALESCE(m.is_active, true) = true
              AND COALESCE(m.material_kind, 'STOCKED') = 'STOCKED'
              ${filterByCategory ? 'AND m.category = ANY($3::text[])' : ''}
            GROUP BY m.id`,
          filterByCategory ? [sessionId, warehouseId, scopeCategories] : [sessionId, warehouseId],
        );
      }

      await client.query(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'COUNTING', snapshot_at = now(), updated_at = now()
          WHERE id = $1`,
        [sessionId],
      );

      const session = await this.loadSession(client, sessionId);
      const lines = await this.loadLinesInternal(client, sessionId);
      return { session, lines };
    });
  }

  async saveLines(
    tenantId: string,
    sessionId: string,
    updates: readonly UpdateStocktakeLineInput[],
    operator: string,
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const sRes = await client.query<Row>(
        `SELECT status FROM inventory_schema.stocktake_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId],
      );
      const status = sRes.rows[0]?.['status'];
      if (!status) {
        throw new InventoryError('STOCKTAKE_NOT_FOUND', `Không tìm thấy đợt kiểm kê ${sessionId}.`, 404);
      }
      if (status !== 'COUNTING') {
        throw new InventoryError('INVALID_STATUS', 'Chỉ có thể nhập số đếm khi đợt kiểm kê đang kiểm đếm.', 409);
      }

      for (const u of updates) {
        const existing = await client.query<Row>(
          `SELECT system_quantity, actual_quantity FROM inventory_schema.stocktake_lines WHERE id = $1 AND session_id = $2`,
          [u.lineId, sessionId],
        );
        const cur = existing.rows[0];
        if (!cur) continue;

        const sysQty = num(cur['system_quantity']);
        const prevActual =
          cur['actual_quantity'] === null || cur['actual_quantity'] === undefined
            ? undefined
            : num(cur['actual_quantity']);
        const nextStatus = lineStatus(sysQty, u.actualQuantity);

        await client.query(
          `UPDATE inventory_schema.stocktake_lines
              SET count_round_1 = $3,
                  count_round_2 = $4,
                  actual_quantity = $5,
                  reason = $6,
                  note = $7,
                  status = $8,
                  lot_allocations = $9::jsonb,
                  serial_allocations = $10::jsonb,
                  updated_at = now()
            WHERE id = $1 AND session_id = $2`,
          [
            u.lineId,
            sessionId,
            u.countRound1 ?? null,
            u.countRound2 ?? null,
            u.actualQuantity ?? null,
            u.reason ?? null,
            u.note ?? null,
            nextStatus,
            u.lotAllocations ? JSON.stringify(u.lotAllocations) : null,
            u.serialAllocations ? JSON.stringify(u.serialAllocations) : null,
          ],
        );

        if (u.actualQuantity !== undefined && u.actualQuantity !== prevActual) {
          await client.query(
            `INSERT INTO inventory_schema.stocktake_line_audits
               (id, line_id, previous_quantity, new_quantity, operator, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), u.lineId, prevActual ?? null, u.actualQuantity, operator, u.reason ?? null],
          );
        }
      }

      await client.query(
        `UPDATE inventory_schema.stocktake_sessions SET updated_at = now() WHERE id = $1`,
        [sessionId],
      );

      const session = await this.loadSession(client, sessionId);
      const lines = await this.loadLinesInternal(client, sessionId);
      return { session, lines };
    });
  }

  async submitForApproval(tenantId: string, sessionId: string): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const res = await client.query<Row>(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'PENDING_APPROVAL', updated_at = now()
          WHERE id = $1 AND status = 'COUNTING'
          RETURNING id`,
        [sessionId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new InventoryError('INVALID_STATUS', 'Chỉ đợt Đang kiểm đếm mới có thể gửi duyệt.', 409);
      }
      return this.loadSession(client, sessionId);
    });
  }

  async approveAndPost(
    tenantId: string,
    sessionId: string,
    approvedBy: string,
  ): Promise<{ session: StocktakeSession; transactionsCreated: number }> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const sRes = await client.query<Row>(
        `SELECT s.*, w.code AS warehouse_code
           FROM inventory_schema.stocktake_sessions s
           JOIN inventory_schema.warehouses w ON w.id = s.warehouse_id
          WHERE s.id = $1 FOR UPDATE`,
        [sessionId],
      );
      const sessionRow = sRes.rows[0];
      if (!sessionRow) {
        throw new InventoryError('STOCKTAKE_NOT_FOUND', `Không tìm thấy đợt kiểm kê ${sessionId}.`, 404);
      }
      if (sessionRow['status'] !== 'PENDING_APPROVAL') {
        throw new InventoryError('INVALID_STATUS', 'Chỉ đợt kiểm kê Chờ duyệt mới có thể duyệt và ghi sổ.', 409);
      }

      const warehouseId = String(sessionRow['warehouse_id']);
      const warehouseCode = String(sessionRow['warehouse_code']);
      const sessionCode = String(sessionRow['code']);

      const linesRes = await client.query<Row>(
        `SELECT l.*, m.code AS material_code, COALESCE(m.standard_cost, 0) AS unit_cost
           FROM inventory_schema.stocktake_lines l
           JOIN inventory_schema.materials m ON m.id = l.material_id
          WHERE l.session_id = $1`,
        [sessionId],
      );

      let transactionsCreated = 0;
      for (const line of linesRes.rows) {
        if (line['actual_quantity'] === null || line['actual_quantity'] === undefined) continue;
        const sysQty = num(line['system_quantity']);
        const actQty = num(line['actual_quantity']);
        const diff = actQty - sysQty;
        if (Math.abs(diff) < 1e-6) continue;

        const materialId = String(line['material_id']);
        const materialCode = String(line['material_code']);
        const lineId = String(line['id']);
        const reason = line['reason']
          ? String(line['reason'])
          : `Cân kho kiểm kê đợt ${sessionCode}`;

        await client.query(
          `INSERT INTO inventory_schema.inventory_adjustments
             (id, warehouse_id, material_id, system_quantity, actual_quantity, reason, status, approved_by, stocktake_session_id, stocktake_line_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7, $8, $9)`,
          [randomUUID(), warehouseId, materialId, sysQty, actQty, reason, approvedBy, sessionId, lineId],
        );

        if (diff > 0) {
          await client.query(
            `INSERT INTO inventory_schema.material_inventory
               (id, warehouse_id, location_id, material_id, quantity, quantity_reserved, updated_at)
             VALUES (gen_random_uuid(), $1, NULL, $2, $3, 0, now())
             ON CONFLICT (warehouse_id, location_id, material_id)
             DO UPDATE SET quantity = inventory_schema.material_inventory.quantity + EXCLUDED.quantity,
                           updated_at = now()`,
            [warehouseId, materialId, diff],
          );
        } else {
          const moved = await client.query(
            `UPDATE inventory_schema.material_inventory
                SET quantity = quantity + $3, updated_at = now()
              WHERE warehouse_id = $1 AND location_id IS NULL AND material_id = $2
                AND quantity - quantity_reserved - quantity_blocked + $3 >= 0`,
            [warehouseId, materialId, diff],
          );
          if ((moved.rowCount ?? 0) === 0) {
            throw new InsufficientStockError(materialCode, Math.abs(diff), 0, warehouseCode);
          }
        }

        const txCode = `ADJ-${sessionCode}-${transactionsCreated + 1}-${randomUUID().slice(0, 6).toUpperCase()}`;
        await client.query(
          `INSERT INTO inventory_schema.inventory_transactions
             (id, transaction_code, warehouse_id, location_id, material_id, type, quantity, unit_cost, reference_type, reference_id, workflow_status, note, created_by)
           VALUES ($1, $2, $3, NULL, $4, 'ADJUST', $5, $6, 'STOCKTAKE', $7, 'APPROVED', $8, $9)`,
          [
            randomUUID(),
            txCode,
            warehouseId,
            materialId,
            diff,
            num(line['unit_cost']),
            sessionId,
            `[Kiểm kê ${sessionCode}] ${reason}`,
            approvedBy,
          ],
        );
        transactionsCreated += 1;
      }

      await client.query(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'POSTED', approved_by = $2, approved_at = now(), updated_at = now()
          WHERE id = $1`,
        [sessionId, approvedBy],
      );

      const session = await this.loadSession(client, sessionId);
      return { session, transactionsCreated };
    });
  }

  async rejectSession(
    tenantId: string,
    sessionId: string,
    reason?: string,
  ): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const res = await client.query<Row>(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'COUNTING',
                note = COALESCE($2, note),
                updated_at = now()
          WHERE id = $1 AND status = 'PENDING_APPROVAL'
          RETURNING id`,
        [sessionId, reason ? `[Trả kiểm đếm lại] ${reason}` : null],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new InventoryError('INVALID_STATUS', 'Chỉ đợt kiểm kê Chờ duyệt mới có thể trả kiểm đếm lại.', 409);
      }
      return this.loadSession(client, sessionId);
    });
  }

  async cancelSession(
    tenantId: string,
    sessionId: string,
    reason?: string,
  ): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const res = await client.query<Row>(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'CANCELLED',
                note = COALESCE($2, note),
                updated_at = now()
          WHERE id = $1 AND status IN ('DRAFT', 'COUNTING', 'PENDING_APPROVAL')
          RETURNING id`,
        [sessionId, reason ? `[Đã huỷ] ${reason}` : null],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new InventoryError('INVALID_STATUS', 'Không thể huỷ đợt kiểm kê đã ghi sổ.', 409);
      }
      return this.loadSession(client, sessionId);
    });
  }
}
