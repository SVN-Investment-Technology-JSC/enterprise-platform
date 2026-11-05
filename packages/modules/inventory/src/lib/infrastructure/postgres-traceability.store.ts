import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  Lot,
  LotBalance,
  LotDetail,
  QualityStatus,
  SerialHistory,
  SerialLastIssue,
  SerialMovement,
  SerialStockState,
  StockDocumentType,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { DecideQuality, TraceabilityStore } from '../application/traceability-store.port.js';
import {
  InventoryError,
  MaterialNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import { isBlockingQuality, type LotCandidate } from '../domain/traceability-policy.js';

type Row = QueryResultRow & Record<string, unknown>;
type Queryable = Pick<PoolClient, 'query'>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const LOT_SELECT = `
  SELECT l.id, l.material_id, l.lot_no, l.manufactured_on::text AS manufactured_on,
         l.expires_on::text AS expires_on, l.quality_status, l.supplier, l.certificate_no,
         l.note, l.created_at, l.updated_at, m.code AS material_code
    FROM inventory_schema.lots l
    JOIN inventory_schema.materials m ON m.id = l.material_id`;

const SERIAL_SELECT = `
  SELECT s.id, s.material_id, s.serial_number, s.stock_state, s.current_status, s.quality_status,
         s.current_warehouse_id, m.code AS material_code, m.name AS material_name,
         w.code AS warehouse_code
    FROM inventory_schema.serial_tracking s
    JOIN inventory_schema.materials m ON m.id = s.material_id
    LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id`;

function mapBalance(row: Row): LotBalance {
  const quantity = num(row.quantity);
  const reserved = num(row.quantity_reserved);
  const blocked = num(row.quantity_blocked);
  return {
    warehouseId: str(row.warehouse_id),
    warehouseCode: str(row.warehouse_code),
    warehouseName: opt(row.warehouse_name),
    quantity,
    quantityReserved: reserved,
    quantityBlocked: blocked,
    available: round3(quantity - reserved - blocked),
  };
}

function mapLot(row: Row, balances: LotBalance[]): Lot {
  return {
    id: str(row.id),
    materialId: str(row.material_id),
    materialCode: str(row.material_code),
    lotNo: str(row.lot_no),
    manufacturedOn: opt(row.manufactured_on),
    expiresOn: opt(row.expires_on),
    qualityStatus: str(row.quality_status) as QualityStatus,
    supplier: opt(row.supplier),
    certificateNo: opt(row.certificate_no),
    note: opt(row.note),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    quantity: round3(balances.reduce((sum, balance) => sum + balance.quantity, 0)),
    balances,
  };
}

/** Phần không Đạt mới của dòng tồn vật tư, giữ trong [0, tồn thực tế]. */
function clampBlocked(blocked: number, quantity: number): number {
  return Math.min(Math.max(round3(blocked), 0), Math.max(quantity, 0));
}

/** Lô, serial và trạng thái chất lượng trên Postgres. */
export class PostgresTraceabilityStore implements TraceabilityStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async listLots(tenantId: string, materialCode: string): Promise<Lot[]> {
    const pool = await this.poolFor(tenantId);
    await this.materialId(pool, materialCode);
    const lots = await pool.query<Row>(
      `${LOT_SELECT} WHERE m.code = $1 ORDER BY l.expires_on NULLS LAST, l.lot_no`,
      [materialCode],
    );
    const balances = await this.balances(pool, lots.rows.map((row) => str(row.id)));
    return lots.rows.map((row) => mapLot(row, balances.get(str(row.id)) ?? []));
  }

  async getLot(tenantId: string, lotId: string): Promise<LotDetail | null> {
    const pool = await this.poolFor(tenantId);
    return this.loadLot(pool, lotId);
  }

  async lotCandidates(
    tenantId: string,
    materialCode: string,
    warehouseCode: string,
  ): Promise<LotCandidate[]> {
    const pool = await this.poolFor(tenantId);
    const materialId = await this.materialId(pool, materialCode);
    const warehouse = await pool.query<Row>(
      `SELECT id FROM inventory_schema.warehouses WHERE code = $1`,
      [warehouseCode],
    );
    if (!warehouse.rows[0]) throw new WarehouseNotFoundError(warehouseCode);
    const result = await pool.query<Row>(
      `SELECT l.id, l.lot_no, l.expires_on::text AS expires_on,
              l.manufactured_on::text AS manufactured_on, l.quality_status,
              b.quantity - b.quantity_reserved - b.quantity_blocked AS available
         FROM inventory_schema.lots l
         JOIN inventory_schema.lot_balances b ON b.lot_id = l.id
        WHERE l.material_id = $1 AND b.warehouse_id = $2 AND b.quantity > 0`,
      [materialId, str(warehouse.rows[0].id)],
    );
    return result.rows.map((row) => ({
      lotId: str(row.id),
      lotNo: str(row.lot_no),
      expiresOn: opt(row.expires_on),
      manufacturedOn: opt(row.manufactured_on),
      qualityStatus: str(row.quality_status) as QualityStatus,
      available: num(row.available),
    }));
  }

  async serialHistory(
    tenantId: string,
    serial: string,
    materialCode?: string,
  ): Promise<SerialHistory | null> {
    const pool = await this.poolFor(tenantId);
    const row = await this.findSerial(pool, serial, materialCode, false);
    return row ? this.history(pool, row) : null;
  }

  async changeSerialQuality(
    tenantId: string,
    serial: string,
    materialCode: string | undefined,
    actorId: string,
    decide: DecideQuality,
  ): Promise<SerialHistory> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const row = await this.findSerial(client, serial, materialCode, true);
      if (!row) {
        throw new InventoryError('SERIAL_NOT_FOUND', `Serial ${serial} không tồn tại.`, 404);
      }
      const from = str(row.quality_status) as QualityStatus;
      const decision = decide(from, `Serial ${str(row.serial_number)}`);
      const stockState = opt(row.stock_state) as SerialStockState | undefined;
      const warehouseId = opt(row.current_warehouse_id);
      const delta = (isBlockingQuality(decision.to) ? 1 : 0) - (isBlockingQuality(from) ? 1 : 0);
      if (delta !== 0 && stockState === 'IN_STOCK' && warehouseId) {
        // Serial Trong kho: cộng hoặc trừ một đơn vị không Đạt ở dòng tồn của kho.
        const balance = await client.query<Row>(
          `SELECT id, quantity, quantity_blocked FROM inventory_schema.material_inventory
            WHERE warehouse_id = $1 AND material_id = $2 AND location_id IS NULL
            FOR UPDATE`,
          [warehouseId, str(row.material_id)],
        );
        if (balance.rows[0]) {
          await client.query(
            `UPDATE inventory_schema.material_inventory
                SET quantity_blocked = $2, updated_at = now()
              WHERE id = $1`,
            [
              str(balance.rows[0].id),
              clampBlocked(num(balance.rows[0].quantity_blocked) + delta, num(balance.rows[0].quantity)),
            ],
          );
        }
      }
      await client.query(
        `UPDATE inventory_schema.serial_tracking
            SET quality_status = $2, updated_at = now()
          WHERE id = $1`,
        [str(row.id), decision.to],
      );
      await client.query(
        `INSERT INTO inventory_schema.serial_movements
           (serial_id, material_id, serial_number, movement_type, from_warehouse_id, to_warehouse_id,
            stock_state, quality_status, previous_quality_status, reason, actor_id)
         VALUES ($1, $2, $3, 'QUALITY_CHANGE', $4, $4, $5, $6, $7, $8, $9)`,
        [
          str(row.id),
          str(row.material_id),
          str(row.serial_number),
          warehouseId ?? null,
          stockState ?? null,
          decision.to,
          from,
          decision.reason,
          actorId,
        ],
      );
      const updated = await this.findSerial(client, str(row.serial_number), str(row.material_code), false);
      return this.history(client, updated as Row);
    });
  }

  async changeLotQuality(
    tenantId: string,
    lotId: string,
    actorId: string,
    decide: DecideQuality,
  ): Promise<LotDetail> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      // Thứ tự khoá như ghi sổ chứng từ: lô, tồn lô (theo kho), tồn vật tư (theo kho).
      const locked = await client.query<Row>(
        `SELECT id, material_id, lot_no, quality_status FROM inventory_schema.lots
          WHERE id = $1 FOR UPDATE`,
        [lotId],
      );
      const lot = locked.rows[0];
      if (!lot) throw new InventoryError('LOT_NOT_FOUND', 'Không tìm thấy lô.', 404);
      const from = str(lot.quality_status) as QualityStatus;
      const decision = decide(from, `Lô ${str(lot.lot_no)}`);
      const blocking = isBlockingQuality(decision.to);

      const balances = await client.query<Row>(
        `SELECT id, warehouse_id, quantity, quantity_blocked FROM inventory_schema.lot_balances
          WHERE lot_id = $1 ORDER BY warehouse_id FOR UPDATE`,
        [lotId],
      );
      const deltas = balances.rows
        .map((row) => ({
          id: str(row.id),
          warehouseId: str(row.warehouse_id),
          next: blocking ? num(row.quantity) : 0,
          delta: round3((blocking ? num(row.quantity) : 0) - num(row.quantity_blocked)),
        }))
        .filter((row) => row.delta !== 0);
      if (deltas.length > 0) {
        const stock = await client.query<Row>(
          `SELECT id, warehouse_id, quantity, quantity_blocked FROM inventory_schema.material_inventory
            WHERE material_id = $1 AND location_id IS NULL AND warehouse_id = ANY($2::uuid[])
            ORDER BY warehouse_id
            FOR UPDATE`,
          [str(lot.material_id), deltas.map((row) => row.warehouseId)],
        );
        const byWarehouse = new Map(stock.rows.map((row) => [str(row.warehouse_id), row]));
        for (const row of deltas) {
          await client.query(
            `UPDATE inventory_schema.lot_balances
                SET quantity_blocked = $2, updated_at = now()
              WHERE id = $1`,
            [row.id, row.next],
          );
          const balance = byWarehouse.get(row.warehouseId);
          if (!balance) continue;
          await client.query(
            `UPDATE inventory_schema.material_inventory
                SET quantity_blocked = $2, updated_at = now()
              WHERE id = $1`,
            [
              str(balance.id),
              clampBlocked(num(balance.quantity_blocked) + row.delta, num(balance.quantity)),
            ],
          );
        }
      }
      await client.query(
        `UPDATE inventory_schema.lots SET quality_status = $2, updated_at = now() WHERE id = $1`,
        [lotId, decision.to],
      );
      await client.query(
        `INSERT INTO inventory_schema.lot_quality_events (lot_id, from_status, to_status, reason, actor_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [lotId, from, decision.to, decision.reason, actorId],
      );
      const detail = await this.loadLot(client, lotId);
      if (!detail) throw new InventoryError('LOT_NOT_FOUND', 'Không tìm thấy lô.', 404);
      return detail;
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private async materialId(client: Queryable, materialCode: string): Promise<string> {
    const result = await client.query<Row>(
      `SELECT id FROM inventory_schema.materials WHERE code = $1`,
      [materialCode],
    );
    if (!result.rows[0]) throw new MaterialNotFoundError(materialCode);
    return str(result.rows[0].id);
  }

  private async balances(client: Queryable, lotIds: string[]): Promise<Map<string, LotBalance[]>> {
    const grouped = new Map<string, LotBalance[]>();
    if (lotIds.length === 0) return grouped;
    const result = await client.query<Row>(
      `SELECT b.*, w.code AS warehouse_code, w.name AS warehouse_name
         FROM inventory_schema.lot_balances b
         JOIN inventory_schema.warehouses w ON w.id = b.warehouse_id
        WHERE b.lot_id = ANY($1::uuid[])
        ORDER BY w.code`,
      [lotIds],
    );
    for (const row of result.rows) {
      const list = grouped.get(str(row.lot_id)) ?? [];
      list.push(mapBalance(row));
      grouped.set(str(row.lot_id), list);
    }
    return grouped;
  }

  private async loadLot(client: Queryable, lotId: string): Promise<LotDetail | null> {
    const result = await client.query<Row>(`${LOT_SELECT} WHERE l.id = $1`, [lotId]);
    const row = result.rows[0];
    if (!row) return null;
    const balances = await this.balances(client, [lotId]);
    const events = await client.query<Row>(
      `SELECT * FROM inventory_schema.lot_quality_events WHERE lot_id = $1 ORDER BY occurred_at, id`,
      [lotId],
    );
    return {
      ...mapLot(row, balances.get(lotId) ?? []),
      qualityEvents: events.rows.map((event) => ({
        id: str(event.id),
        fromStatus: str(event.from_status) as QualityStatus,
        toStatus: str(event.to_status) as QualityStatus,
        reason: str(event.reason),
        actorId: str(event.actor_id),
        occurredAt: iso(event.occurred_at),
      })),
    };
  }

  /**
   * Tìm serial theo khoá đã chuẩn hoá. Có `lock` thì khoá `FOR UPDATE`. Cùng số
   * serial ở nhiều mặt hàng mà không nêu mặt hàng thì 409.
   */
  private async findSerial(
    client: Queryable,
    serial: string,
    materialCode: string | undefined,
    lock: boolean,
  ): Promise<Row | null> {
    const result = await client.query<Row>(
      `${SERIAL_SELECT}
        WHERE upper(btrim(s.serial_number)) = upper(btrim($1))
          AND ($2::text IS NULL OR m.code = $2)
        ORDER BY m.code
        ${lock ? 'FOR UPDATE OF s' : ''}`,
      [serial, materialCode ?? null],
    );
    if (result.rows.length > 1) {
      throw new InventoryError(
        'SERIAL_AMBIGUOUS',
        `Serial ${serial} có ở nhiều mặt hàng (${result.rows.map((row) => str(row.material_code)).join(', ')}); ghi rõ mã vật tư.`,
        409,
      );
    }
    return result.rows[0] ?? null;
  }

  private async history(client: Queryable, row: Row): Promise<SerialHistory> {
    const movements = await client.query<Row>(
      `SELECT sm.*, fw.code AS from_code, tw.code AS to_code, d.code AS document_code,
              d.doc_type,
              EXISTS (
                SELECT 1 FROM inventory_schema.stock_documents r
                 WHERE r.reverses_document_id = sm.document_id
              ) AS reversed
         FROM inventory_schema.serial_movements sm
         LEFT JOIN inventory_schema.warehouses fw ON fw.id = sm.from_warehouse_id
         LEFT JOIN inventory_schema.warehouses tw ON tw.id = sm.to_warehouse_id
         LEFT JOIN inventory_schema.stock_documents d ON d.id = sm.document_id
        WHERE sm.serial_id = $1
        ORDER BY sm.occurred_at, sm.id`,
      [str(row.id)],
    );
    const mapped: SerialMovement[] = movements.rows.map((movement) => ({
      id: str(movement.id),
      movementType: str(movement.movement_type) as SerialMovement['movementType'],
      fromWarehouseCode: opt(movement.from_code),
      toWarehouseCode: opt(movement.to_code),
      documentId: opt(movement.document_id),
      documentCode: opt(movement.document_code),
      docType: opt(movement.doc_type) as StockDocumentType | undefined,
      sourceType: opt(movement.source_type),
      sourceId: opt(movement.source_id),
      stockState: opt(movement.stock_state) as SerialStockState | undefined,
      qualityStatus: str(movement.quality_status) as QualityStatus,
      previousQualityStatus: opt(movement.previous_quality_status) as QualityStatus | undefined,
      reason: opt(movement.reason),
      occurredAt: iso(movement.occurred_at),
      actorId: str(movement.actor_id),
    }));
    // Lần xuất gần nhất chưa bị đảo: đảo phiếu xuất nghĩa là chưa giao.
    const issue = [...movements.rows]
      .reverse()
      .find(
        (movement) =>
          ['ISSUE', 'WARRANTY_ISSUE'].includes(str(movement.movement_type)) &&
          movement.document_id &&
          movement.reversed !== true,
      );
    const lastIssue: SerialLastIssue | undefined = issue
      ? {
          documentId: str(issue.document_id),
          documentCode: str(issue.document_code),
          docType: str(issue.doc_type) as StockDocumentType,
          warehouseCode: opt(issue.from_code),
          sourceType: opt(issue.source_type),
          sourceId: opt(issue.source_id),
          issuedAt: iso(issue.occurred_at),
        }
      : undefined;
    return {
      id: str(row.id),
      serialNumber: str(row.serial_number),
      materialId: str(row.material_id),
      materialCode: str(row.material_code),
      materialName: str(row.material_name),
      warehouseCode: opt(row.warehouse_code),
      stockState: opt(row.stock_state) as SerialStockState | undefined,
      currentStatus: str(row.current_status),
      qualityStatus: str(row.quality_status) as QualityStatus,
      lastIssue,
      issuedAt: lastIssue?.issuedAt,
      movements: mapped,
    };
  }
}
