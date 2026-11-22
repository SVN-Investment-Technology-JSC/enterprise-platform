import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  StocktakeLine,
  StocktakeLineAudit,
  StocktakeLinesResult,
  StocktakeListQuery,
  StocktakeLotAllocation,
  StocktakePage,
  StocktakeSerialAllocation,
  StocktakeSession,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  NewStocktakeInput,
  StocktakeActor,
  StocktakeLineFilter,
  StocktakeStore,
  StocktakeTransition,
} from '../application/stocktake-store.port.js';
import {
  InventoryError,
  MaterialNotFoundError,
  StocktakeNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import { lineFigures, nextStocktakeCode, round3 } from '../domain/stocktake-policy.js';

type Row = QueryResultRow & Record<string, unknown>;
type Queryable = Pick<PoolClient, 'query'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined => (value == null ? undefined : String(value));
const num = (value: unknown): number => Number(value ?? 0);
const optNum = (value: unknown): number | undefined => (value == null ? undefined : Number(value));
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const optIso = (value: unknown): string | undefined => (value == null ? undefined : iso(value));
const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map((item) => String(item)) : undefined;

/** Tổng hợp số liệu đợt ngay trong SQL để luôn khớp với dòng, không lưu số thừa. */
const SESSION_SELECT = `
  SELECT s.*, s.stocktake_date::text AS stocktake_date_text,
         w.code AS warehouse_code, w.name AS warehouse_name, d.code AS document_code,
         COALESCE(t.total_items, 0) AS total_items,
         COALESCE(t.counted_items, 0) AS counted_items,
         COALESCE(t.difference_items, 0) AS difference_items,
         COALESCE(t.total_variance_value, 0) AS total_variance_value
    FROM inventory_schema.stocktake_sessions s
    JOIN inventory_schema.warehouses w ON w.id = s.warehouse_id
    LEFT JOIN inventory_schema.stock_documents d ON d.id = s.document_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_items,
             count(*) FILTER (WHERE l.status <> 'UNCOUNTED') AS counted_items,
             count(*) FILTER (WHERE l.status IN ('SURPLUS', 'DEFICIT')) AS difference_items,
             COALESCE(SUM(round(l.difference * l.unit_cost, 2))
               FILTER (WHERE l.status IN ('SURPLUS', 'DEFICIT')), 0) AS total_variance_value
        FROM inventory_schema.stocktake_lines l
       WHERE l.session_id = s.id
    ) t ON true`;

const LINE_SELECT = `
  SELECT l.*, s.warehouse_id, s.status AS session_status,
         m.code AS material_code, m.name AS material_name, m.unit AS material_unit,
         COALESCE(m.is_serialized, false) AS is_serialized,
         EXISTS (
           SELECT 1 FROM inventory_schema.lots lo
             JOIN inventory_schema.lot_balances lb ON lb.lot_id = lo.id AND lb.warehouse_id = s.warehouse_id
            WHERE lo.material_id = l.material_id
         ) AS is_lot_tracked,
         (SELECT COALESCE(SUM(mi.quantity), 0) FROM inventory_schema.material_inventory mi
           WHERE mi.warehouse_id = s.warehouse_id AND mi.material_id = l.material_id) AS current_quantity
    FROM inventory_schema.stocktake_lines l
    JOIN inventory_schema.stocktake_sessions s ON s.id = l.session_id
    JOIN inventory_schema.materials m ON m.id = l.material_id`;

function mapSession(row: Row): StocktakeSession {
  return {
    id: str(row.id),
    code: str(row.code),
    title: str(row.title),
    warehouseId: str(row.warehouse_id),
    warehouseCode: str(row.warehouse_code),
    warehouseName: opt(row.warehouse_name),
    status: str(row.status) as StocktakeSession['status'],
    scopeType: str(row.scope_type) as StocktakeSession['scopeType'],
    scopeCategories: stringList(row.scope_categories),
    specificMaterialCodes: stringList(row.scope_materials),
    stocktakeDate: opt(row.stocktake_date_text),
    snapshotAt: optIso(row.snapshot_at),
    leadAuditor: opt(row.lead_auditor),
    auditors: stringList(row.auditors),
    approvedBy: opt(row.approved_by),
    approvedAt: optIso(row.approved_at),
    note: opt(row.note),
    totalItems: num(row.total_items),
    countedItems: num(row.counted_items),
    differenceItems: num(row.difference_items),
    totalVarianceValue: num(row.total_variance_value),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: opt(row.created_by),
    submittedBy: opt(row.submitted_by),
    submittedAt: optIso(row.submitted_at),
    postedAt: optIso(row.posted_at),
    rejectReason: opt(row.reject_reason),
    cancelReason: opt(row.cancel_reason),
    documentId: opt(row.document_id),
    documentCode: opt(row.document_code),
  };
}

function mapLine(row: Row): StocktakeLine {
  const closed = row.session_status === 'POSTED' || row.session_status === 'CANCELLED';
  const unitCost = num(row.unit_cost);
  const difference = num(row.difference);
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    materialId: str(row.material_id),
    materialCode: str(row.material_code),
    materialName: str(row.material_name),
    unit: str(row.material_unit),
    binLocation: opt(row.bin_location),
    isSerialized: Boolean(row.is_serialized),
    isLotTracked: Boolean(row.is_lot_tracked),
    systemQuantity: num(row.system_quantity),
    currentQuantity: closed ? undefined : round3(num(row.current_quantity)),
    countRound1: optNum(row.count_round_1),
    countRound2: optNum(row.count_round_2),
    actualQuantity: optNum(row.actual_quantity),
    difference,
    unitCost,
    differenceValue: Math.round(difference * unitCost * 100) / 100,
    reason: opt(row.reason),
    status: str(row.status) as StocktakeLine['status'],
    lotAllocations: Array.isArray(row.lot_allocations)
      ? (row.lot_allocations as StocktakeLotAllocation[])
      : undefined,
    serialAllocations: Array.isArray(row.serial_allocations)
      ? (row.serial_allocations as StocktakeSerialAllocation[])
      : undefined,
    note: opt(row.note),
    updatedAt: optIso(row.updated_at),
  };
}

function mapAudit(row: Row): StocktakeLineAudit {
  return {
    id: str(row.id),
    lineId: str(row.line_id),
    previousQuantity: optNum(row.previous_quantity),
    newQuantity: num(row.new_quantity),
    operator: str(row.operator),
    timestamp: iso(row.timestamp),
    reason: opt(row.reason),
  };
}

/**
 * Kiểm kê kho trên Postgres. Số tồn sổ sách chụp từ `material_inventory` (gộp
 * các vị trí của cùng một kho) cùng giá vốn bình quân tại thời điểm bắt đầu;
 * sau đó đợt chỉ đọc số đã chụp, không đọc lại tồn đang đổi.
 */
export class PostgresStocktakeStore implements StocktakeStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async list(tenantId: string, query: StocktakeListQuery): Promise<StocktakePage> {
    const pool = await this.poolFor(tenantId);
    const limit = Math.min(Math.max(Math.trunc(Number(query.limit) || DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const offset = Math.max(Math.trunc(Number(query.offset) || 0), 0);
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.warehouseCode) {
      values.push(query.warehouseCode);
      where.push(`w.code = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`s.status = $${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(s.code ILIKE $${values.length} OR s.title ILIKE $${values.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await pool.query<Row>(
      `SELECT count(*) AS total
         FROM inventory_schema.stocktake_sessions s
         JOIN inventory_schema.warehouses w ON w.id = s.warehouse_id
         ${clause}`,
      values,
    );
    const rows = await pool.query<Row>(
      `${SESSION_SELECT} ${clause} ORDER BY s.created_at DESC, s.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    return { items: rows.rows.map(mapSession), total: num(total.rows[0]?.total), limit, offset };
  }

  async get(tenantId: string, key: string): Promise<StocktakeSession | null> {
    const pool = await this.poolFor(tenantId);
    return this.loadSession(pool, key, false);
  }

  async lines(tenantId: string, key: string, filter: StocktakeLineFilter = {}): Promise<StocktakeLine[]> {
    const pool = await this.poolFor(tenantId);
    const session = await this.loadSession(pool, key, false);
    if (!session) return [];
    return this.loadLines(pool, session.id, filter);
  }

  async audits(tenantId: string, key: string): Promise<StocktakeLineAudit[]> {
    const pool = await this.poolFor(tenantId);
    const session = await this.loadSession(pool, key, false);
    if (!session) return [];
    const result = await pool.query<Row>(
      `SELECT a.*
         FROM inventory_schema.stocktake_line_audits a
         JOIN inventory_schema.stocktake_lines l ON l.id = a.line_id
        WHERE l.session_id = $1
        ORDER BY a.timestamp, a.id`,
      [session.id],
    );
    return result.rows.map(mapAudit);
  }

  async create(tenantId: string, input: NewStocktakeInput): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const warehouse = await client.query<Row>(
        `SELECT id, is_active FROM inventory_schema.warehouses WHERE code = $1`,
        [input.warehouseCode],
      );
      if (!warehouse.rows[0]) throw new WarehouseNotFoundError(input.warehouseCode);
      if (warehouse.rows[0].is_active === false) {
        throw new InventoryError('WAREHOUSE_INACTIVE', `Kho ${input.warehouseCode} đã ngừng sử dụng.`, 409);
      }

      // Sinh mã tuần tự trong năm; khoá để hai đợt tạo cùng lúc không trùng mã.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('inventory.stocktake.code'))`);
      const year = new Date().getFullYear();
      const latest = await client.query<Row>(
        `SELECT code FROM inventory_schema.stocktake_sessions
          WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
        [`KK-${year}-%`],
      );
      const code = nextStocktakeCode(year, opt(latest.rows[0]?.code));

      const inserted = await client.query<Row>(
        `INSERT INTO inventory_schema.stocktake_sessions
           (code, title, warehouse_id, status, scope_type, scope_categories, scope_materials,
            stocktake_date, lead_auditor, auditors, note, created_by)
         VALUES ($1, $2, $3, 'DRAFT', $4, $5::jsonb, $6::jsonb,
                 COALESCE($7::date, CURRENT_DATE), $8, $9::jsonb, $10, $11)
         RETURNING id`,
        [
          code,
          input.title,
          warehouse.rows[0].id,
          input.scopeType,
          input.scopeCategories ? JSON.stringify(input.scopeCategories) : null,
          input.scopeMaterialCodes ? JSON.stringify(input.scopeMaterialCodes) : null,
          input.stocktakeDate ?? null,
          input.leadAuditor ?? null,
          JSON.stringify(input.auditors ?? []),
          input.note ?? null,
          input.createdBy,
        ],
      );
      const session = await this.loadSession(client, str(inserted.rows[0].id), false);
      if (!session) throw new StocktakeNotFoundError(code);
      return session;
    });
  }

  async start(
    tenantId: string,
    key: string,
    actorId: string,
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeLinesResult> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const current = await this.loadSession(client, key, true);
      if (!current) throw new StocktakeNotFoundError(key);
      check(current);

      const snapshot = await this.snapshotLines(client, current);
      if (snapshot.length === 0) {
        throw new InventoryError(
          'STOCKTAKE_EMPTY_SCOPE',
          `Phạm vi kiểm kê của đợt ${current.code} không có vật tư nào tại kho ${current.warehouseCode}.`,
          409,
        );
      }
      await client.query(
        `INSERT INTO inventory_schema.stocktake_lines
           (session_id, material_id, system_quantity, unit_cost, lot_allocations, serial_allocations, status)
         SELECT $1, x.material_id, x.system_quantity, x.unit_cost, x.lot_allocations, x.serial_allocations, 'UNCOUNTED'
           FROM jsonb_to_recordset($2::jsonb) AS x(
             material_id uuid, system_quantity numeric, unit_cost numeric,
             lot_allocations jsonb, serial_allocations jsonb)`,
        [current.id, JSON.stringify(snapshot)],
      );
      await client.query(
        `UPDATE inventory_schema.stocktake_sessions
            SET status = 'COUNTING', snapshot_at = now(), started_by = $2, updated_at = now()
          WHERE id = $1`,
        [current.id, actorId],
      );
      const session = await this.loadSession(client, current.id, false);
      if (!session) throw new StocktakeNotFoundError(key);
      return { session, lines: await this.loadLines(client, current.id) };
    });
  }

  async saveLines(
    tenantId: string,
    key: string,
    actor: StocktakeActor,
    updates: readonly UpdateStocktakeLineInput[],
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeLinesResult> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const current = await this.loadSession(client, key, true);
      if (!current) throw new StocktakeNotFoundError(key);
      check(current);

      const existing = await client.query<Row>(
        `SELECT id, system_quantity, unit_cost, count_round_1, count_round_2, actual_quantity,
                reason, note, lot_allocations, serial_allocations
           FROM inventory_schema.stocktake_lines
          WHERE session_id = $1 AND id = ANY($2::uuid[])
          FOR UPDATE`,
        [current.id, updates.map((update) => update.lineId)],
      );
      const byId = new Map(existing.rows.map((row) => [str(row.id), row]));

      for (const update of updates) {
        const row = byId.get(update.lineId);
        if (!row) {
          throw new InventoryError(
            'STOCKTAKE_LINE_NOT_FOUND',
            `Không tìm thấy dòng kiểm kê ${update.lineId} trong đợt ${current.code}.`,
            404,
          );
        }
        const previousActual = optNum(row.actual_quantity);
        const actual = update.actualQuantity ?? previousActual;
        const figures = lineFigures(num(row.system_quantity), actual, num(row.unit_cost));
        const reason = update.reason !== undefined ? update.reason || null : (opt(row.reason) ?? null);
        const note = update.note !== undefined ? update.note || null : (opt(row.note) ?? null);
        const actualChanged = actual !== undefined && actual !== previousActual;

        await client.query(
          `UPDATE inventory_schema.stocktake_lines
              SET count_round_1 = $2, count_round_2 = $3, actual_quantity = $4,
                  reason = $5, note = $6, status = $7,
                  lot_allocations = $8::jsonb, serial_allocations = $9::jsonb,
                  counted_by = CASE WHEN $10 THEN $11::uuid ELSE counted_by END,
                  counted_at = CASE WHEN $10 THEN now() ELSE counted_at END,
                  updated_at = now()
            WHERE id = $1`,
          [
            update.lineId,
            update.countRound1 ?? optNum(row.count_round_1) ?? null,
            update.countRound2 ?? optNum(row.count_round_2) ?? null,
            actual ?? null,
            reason,
            note,
            figures.status,
            JSON.stringify(update.lotAllocations ?? row.lot_allocations ?? null),
            JSON.stringify(update.serialAllocations ?? row.serial_allocations ?? null),
            actualChanged,
            actor.id,
          ],
        );
        if (actualChanged && actual !== undefined) {
          await client.query(
            `INSERT INTO inventory_schema.stocktake_line_audits
               (line_id, previous_quantity, new_quantity, operator, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [update.lineId, previousActual ?? null, actual, actor.name, reason],
          );
        }
      }
      await client.query(
        `UPDATE inventory_schema.stocktake_sessions SET updated_at = now() WHERE id = $1`,
        [current.id],
      );
      const session = await this.loadSession(client, current.id, false);
      if (!session) throw new StocktakeNotFoundError(key);
      return { session, lines: await this.loadLines(client, current.id) };
    });
  }

  async transition(
    tenantId: string,
    key: string,
    change: StocktakeTransition,
    check: (current: StocktakeSession, lines: readonly StocktakeLine[]) => void,
  ): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const current = await this.loadSession(client, key, true);
      if (!current) throw new StocktakeNotFoundError(key);
      // Chỉ gửi duyệt mới cần đọc dòng (kiểm lý do chênh lệch); các bước khác không.
      const lines = change.to === 'PENDING_APPROVAL' ? await this.loadLines(client, current.id) : [];
      check(current, lines);

      switch (change.to) {
        case 'PENDING_APPROVAL':
          await client.query(
            `UPDATE inventory_schema.stocktake_sessions
                SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_at = now(),
                    reject_reason = NULL, updated_at = now()
              WHERE id = $1`,
            [current.id, change.actorId],
          );
          break;
        case 'COUNTING':
          await client.query(
            `UPDATE inventory_schema.stocktake_sessions
                SET status = 'COUNTING', submitted_by = NULL, submitted_at = NULL,
                    reject_reason = $2, updated_at = now()
              WHERE id = $1`,
            [current.id, change.reason ?? null],
          );
          break;
        case 'APPROVED':
          await client.query(
            `UPDATE inventory_schema.stocktake_sessions
                SET status = 'APPROVED', approved_by = $2, approved_at = now(), updated_at = now()
              WHERE id = $1`,
            [current.id, change.actorId],
          );
          break;
        case 'CANCELLED':
          await client.query(
            `UPDATE inventory_schema.stocktake_sessions
                SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(),
                    cancel_reason = $3, updated_at = now()
              WHERE id = $1`,
            [current.id, change.actorId, change.reason ?? null],
          );
          break;
      }
      const session = await this.loadSession(client, current.id, false);
      if (!session) throw new StocktakeNotFoundError(key);
      return session;
    });
  }

  async markPosted(
    tenantId: string,
    key: string,
    input: { readonly documentId?: string; readonly actorId: string },
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeSession> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const current = await this.loadSession(client, key, true);
      if (!current) throw new StocktakeNotFoundError(key);
      check(current);
      if (current.status !== 'POSTED') {
        await client.query(
          `UPDATE inventory_schema.stocktake_sessions
              SET status = 'POSTED', document_id = $2, posted_by = $3, posted_at = now(), updated_at = now()
            WHERE id = $1`,
          [current.id, input.documentId ?? null, input.actorId],
        );
      }
      const session = await this.loadSession(client, current.id, false);
      if (!session) throw new StocktakeNotFoundError(key);
      return session;
    });
  }

  // ------------------------------------------------------------------ nội bộ

  /** Đọc đợt theo id hoặc mã; `lock` khoá hàng đợt (không khoá bảng join) cho thao tác đổi dữ liệu. */
  private async loadSession(client: Queryable, key: string, lock: boolean): Promise<StocktakeSession | null> {
    const column = UUID_PATTERN.test(key) ? 's.id = $1' : 's.code = $1';
    if (lock) {
      // FOR UPDATE không đi cùng GROUP/LATERAL tổng hợp: khoá hàng đợt trước, đọc sau.
      const locked = await client.query<Row>(
        `SELECT s.id FROM inventory_schema.stocktake_sessions s WHERE ${column} FOR UPDATE OF s`,
        [key],
      );
      if (!locked.rows[0]) return null;
      key = str(locked.rows[0].id);
    }
    const result = await client.query<Row>(
      `${SESSION_SELECT} WHERE ${UUID_PATTERN.test(key) ? 's.id = $1' : 's.code = $1'}`,
      [key],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  private async loadLines(
    client: Queryable,
    sessionId: string,
    filter: StocktakeLineFilter = {},
  ): Promise<StocktakeLine[]> {
    const values: unknown[] = [sessionId];
    const where = ['l.session_id = $1'];
    if (filter.status) {
      values.push(filter.status);
      where.push(`l.status = $${values.length}`);
    }
    if (filter.hasDiffOnly) where.push(`l.status IN ('SURPLUS', 'DEFICIT')`);
    if (filter.search) {
      values.push(`%${filter.search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(m.code ILIKE $${values.length} OR m.name ILIKE $${values.length})`);
    }
    const result = await client.query<Row>(
      `${LINE_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.code, l.id`,
      values,
    );
    return result.rows.map(mapLine);
  }

  /**
   * Dòng kiểm kê theo phạm vi, kèm tồn sổ sách, giá vốn bình quân và (với vật
   * tư theo lô, theo serial) danh sách lô, serial đang có trong kho để ngăn
   * kiểm đếm chi tiết đối chiếu từ số thật, không phải dữ liệu mẫu.
   */
  private async snapshotLines(client: Queryable, session: StocktakeSession): Promise<readonly SnapshotLine[]> {
    const values: unknown[] = [session.warehouseId];
    let scope = `AND COALESCE(m.is_active, true)`;
    let join = 'JOIN';
    if (session.scopeType === 'CATEGORY') {
      values.push(session.scopeCategories ?? []);
      scope += ` AND m.trade_category = ANY($${values.length}::text[])`;
    } else if (session.scopeType === 'SPECIFIC_ITEMS') {
      const codes = session.specificMaterialCodes ?? [];
      const found = await client.query<Row>(
        `SELECT code, kind FROM inventory_schema.materials WHERE code = ANY($1::text[])`,
        [codes],
      );
      const known = new Map(found.rows.map((row) => [str(row.code), str(row.kind)]));
      for (const code of codes) {
        if (!known.has(code)) throw new MaterialNotFoundError(code);
        if (known.get(code) !== 'STOCK') {
          throw new InventoryError(
            'STOCKTAKE_NOT_STOCK_ITEM',
            `${code} không phải hàng tồn kho nên không kiểm kê được.`,
            409,
          );
        }
      }
      values.push(codes);
      scope = `AND m.code = ANY($${values.length}::text[])`;
      join = 'LEFT JOIN';
    }
    const base = await client.query<Row>(
      `SELECT m.id AS material_id,
              COALESCE(inv.quantity, 0) AS quantity,
              COALESCE(inv.avg_cost, 0) AS avg_cost
         FROM inventory_schema.materials m
         ${join} (
           SELECT mi.material_id,
                  SUM(mi.quantity) AS quantity,
                  CASE WHEN SUM(mi.quantity) > 0
                       THEN SUM(mi.quantity * mi.avg_cost) / SUM(mi.quantity)
                       ELSE COALESCE(MAX(mi.avg_cost), 0) END AS avg_cost
             FROM inventory_schema.material_inventory mi
            WHERE mi.warehouse_id = $1
            GROUP BY mi.material_id
         ) inv ON inv.material_id = m.id
        WHERE m.kind = 'STOCK' ${scope}
        ORDER BY m.code`,
      values,
    );
    if (base.rows.length === 0) return [];
    const materialIds = base.rows.map((row) => str(row.material_id));

    const lots = await client.query<Row>(
      `SELECT lo.material_id, lo.lot_no, lb.quantity, lo.expires_on::text AS expires_on
         FROM inventory_schema.lots lo
         JOIN inventory_schema.lot_balances lb ON lb.lot_id = lo.id AND lb.warehouse_id = $1
        WHERE lo.material_id = ANY($2::uuid[]) AND lb.quantity > 0
        ORDER BY lo.material_id, lo.expires_on NULLS LAST, lo.lot_no`,
      [session.warehouseId, materialIds],
    );
    const serials = await client.query<Row>(
      `SELECT st.material_id, st.serial_number
         FROM inventory_schema.serial_tracking st
        WHERE st.material_id = ANY($2::uuid[])
          AND st.current_warehouse_id = $1 AND st.stock_state = 'IN_STOCK'
        ORDER BY st.material_id, st.serial_number`,
      [session.warehouseId, materialIds],
    );
    const lotsByMaterial = groupBy(lots.rows, (row) => str(row.material_id));
    const serialsByMaterial = groupBy(serials.rows, (row) => str(row.material_id));

    return base.rows.map((row): SnapshotLine => {
      const id = str(row.material_id);
      const quantity = round3(num(row.quantity));
      const lotRows = lotsByMaterial.get(id);
      const serialRows = serialsByMaterial.get(id);
      return {
        material_id: id,
        system_quantity: quantity,
        unit_cost: num(row.avg_cost),
        // Số đếm của từng lô và từng serial khởi đầu bằng số sổ sách: người đếm chỉ sửa chỗ lệch.
        lot_allocations: lotRows?.length
          ? lotRows.map((lot) => ({
              lotNumber: str(lot.lot_no),
              systemQty: num(lot.quantity),
              actualQty: num(lot.quantity),
              expiryDate: opt(lot.expires_on),
            }))
          : null,
        serial_allocations: serialRows?.length
          ? serialRows.map((serial) => ({ serialNumber: str(serial.serial_number), status: 'FOUND' as const }))
          : null,
      };
    });
  }
}

interface SnapshotLine {
  readonly material_id: string;
  readonly system_quantity: number;
  readonly unit_cost: number;
  readonly lot_allocations: readonly StocktakeLotAllocation[] | null;
  readonly serial_allocations: readonly StocktakeSerialAllocation[] | null;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}
