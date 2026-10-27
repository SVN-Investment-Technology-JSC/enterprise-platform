import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  InventoryTransaction,
  PostedStockDocument,
  StockDocument,
  StockDocumentLine,
  StockDocumentListQuery,
  StockDocumentPage,
  StockDocumentType,
  TransactionType,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  NewStockDocumentInput,
  StockDocumentChange,
  StockDocumentLineDraft,
  StockDocumentPatch,
  StockDocumentStore,
} from '../application/stock-document-store.port.js';
import {
  InsufficientAvailableStockError,
  InventoryError,
  MaterialNotFoundError,
  ReservationIssueError,
  StockDocumentNotFoundError,
  WarehouseNotFoundError,
} from '../domain/inventory.error.js';
import { lowStockNotificationEvent } from './inventory-notification-events.js';
import { mapTransaction, writeInventoryOutbox } from './postgres-inventory-store.js';

type Row = QueryResultRow & Record<string, unknown>;
type Queryable = Pick<PoolClient, 'query'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const num = (value: unknown): number => Number(value ?? 0);
const optNum = (value: unknown): number | undefined =>
  value == null ? undefined : Number(value);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const optIso = (value: unknown): string | undefined => (value == null ? undefined : iso(value));
/** Số lượng là NUMERIC(12,3): làm tròn 3 chữ số để cộng dồn số thực không lệch kiểu 0,1 + 0,2. */
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Tiền tố mã theo nhóm chứng từ: phiếu nhập, phiếu xuất, phiếu chuyển, phiếu điều chỉnh. */
function codePrefix(docType: StockDocumentType): string {
  if (docType === 'TRANSFER') return 'PC';
  if (docType === 'ADJUSTMENT') return 'PDC';
  return docType.startsWith('RECEIPT_') ? 'PN' : 'PX';
}

function newDocumentCode(docType: StockDocumentType): string {
  return `${codePrefix(docType)}-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * Mã bút toán. Một chứng từ sinh nhiều dòng sổ trong cùng mili giây, nên phần
 * đuôi lấy từ UUID chứ không phải ba chữ số ngẫu nhiên như `append` cũ.
 */
function newLedgerCode(): string {
  return `TXN-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

const DOCUMENT_SELECT = `
  SELECT d.*, d.document_date::text AS document_date_text,
         w.code AS warehouse_code, tw.code AS target_warehouse_code
    FROM inventory_schema.stock_documents d
    JOIN inventory_schema.warehouses w ON w.id = d.warehouse_id
    LEFT JOIN inventory_schema.warehouses tw ON tw.id = d.target_warehouse_id`;

function mapLine(row: Row): StockDocumentLine {
  return {
    id: str(row.id),
    lineNo: num(row.line_no),
    materialId: str(row.material_id),
    materialCode: str(row.material_code),
    materialName: str(row.material_name),
    unit: opt(row.unit),
    quantity: num(row.quantity),
    direction: row.direction as StockDocumentLine['direction'],
    unitCost: num(row.unit_cost),
    costAmount: optNum(row.cost_amount),
    reservationId: opt(row.reservation_id),
    note: opt(row.note),
  };
}

function mapDocument(row: Row, lines: StockDocumentLine[]): StockDocument {
  return {
    id: str(row.id),
    code: str(row.code),
    docType: row.doc_type as StockDocument['docType'],
    status: row.status as StockDocument['status'],
    warehouseId: str(row.warehouse_id),
    warehouseCode: str(row.warehouse_code),
    targetWarehouseId: opt(row.target_warehouse_id),
    targetWarehouseCode: opt(row.target_warehouse_code),
    sourceType: opt(row.source_type),
    sourceId: opt(row.source_id),
    idempotencyKey: opt(row.idempotency_key),
    documentDate: str(row.document_date_text),
    note: opt(row.note),
    rejectReason: opt(row.reject_reason),
    reversesDocumentId: opt(row.reverses_document_id),
    createdBy: str(row.created_by),
    submittedBy: opt(row.submitted_by),
    submittedAt: optIso(row.submitted_at),
    approvedBy: opt(row.approved_by),
    approvedAt: optIso(row.approved_at),
    rejectedBy: opt(row.rejected_by),
    rejectedAt: optIso(row.rejected_at),
    postedBy: opt(row.posted_by),
    postedAt: optIso(row.posted_at),
    cancelledBy: opt(row.cancelled_by),
    cancelledAt: optIso(row.cancelled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lines,
  };
}

/** Cột người và thời điểm ghi theo trạng thái đích; hằng số, không lấy từ input. */
const TRANSITION_COLUMNS = {
  PENDING: ['submitted_by', 'submitted_at'],
  APPROVED: ['approved_by', 'approved_at'],
  REJECTED: ['rejected_by', 'rejected_at'],
  CANCELLED: ['cancelled_by', 'cancelled_at'],
} as const;

/** Một lần cộng hoặc trừ tồn khi ghi sổ, kèm bút toán sinh ra cho nó. */
interface Movement {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly delta: number;
  readonly type: TransactionType;
  readonly unitCost: number;
  readonly note?: string;
  /** Vế nhập của điều chuyển: tham chiếu bút toán vế xuất như đường cũ. */
  readonly transferInOf?: number;
  readonly transferFromCode?: string;
  /** Dòng xuất trừ vào giữ hàng: giảm cả tồn lẫn phần đã giữ. */
  readonly reservationId?: string;
  readonly lineNo: number;
}

interface Balance {
  readonly id: string;
  quantity: number;
  reserved: number;
}

/** Dòng giữ hàng đã khoá, kèm phần chưa xuất còn lại trong lượt ghi sổ này. */
interface LockedReservationItem {
  readonly id: string;
  readonly reservationId: string;
  readonly warehouseId: string;
  readonly materialId: string;
  outstanding: number;
  issued: number;
}

const RESERVATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'chờ giữ',
  COMPLETED: 'xuất đủ',
  CANCELLED: 'bị huỷ',
  EXPIRED: 'hết hạn',
};

/**
 * Chứng từ kho trên Postgres. Mọi thay đổi trạng thái khoá dòng chứng từ
 * `FOR UPDATE` trước, nên hai người cùng bấm ghi sổ thì người sau chờ, đọc thấy
 * Đã ghi sổ và bị từ chối — tồn chỉ đổi một lần.
 */
export class PostgresStockDocumentStore implements StockDocumentStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  /** Throws if the tenant's database reference was never registered by the guard. */
  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async list(tenantId: string, query: StockDocumentListQuery): Promise<StockDocumentPage> {
    const pool = await this.poolFor(tenantId);
    const limit = Math.min(
      Math.max(Math.trunc(Number(query.limit) || DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const offset = Math.max(Math.trunc(Number(query.offset) || 0), 0);
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.docType) {
      values.push(query.docType);
      where.push(`d.doc_type = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`d.status = $${values.length}`);
    }
    if (query.warehouseCode) {
      values.push(query.warehouseCode);
      where.push(`(w.code = $${values.length} OR tw.code = $${values.length})`);
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await pool.query<Row>(
      `SELECT count(*)::int AS n
         FROM inventory_schema.stock_documents d
         JOIN inventory_schema.warehouses w ON w.id = d.warehouse_id
         LEFT JOIN inventory_schema.warehouses tw ON tw.id = d.target_warehouse_id
         ${filter}`,
      values,
    );
    const rows = await pool.query<Row>(
      `${DOCUMENT_SELECT} ${filter}
        ORDER BY d.created_at DESC, d.id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const lines = await this.loadLines(
      pool,
      rows.rows.map((row) => str(row.id)),
    );
    return {
      items: rows.rows.map((row) => mapDocument(row, lines.get(str(row.id)) ?? [])),
      total: num(total.rows[0]?.n),
      limit,
      offset,
    };
  }

  async get(tenantId: string, key: string): Promise<StockDocument | null> {
    const pool = await this.poolFor(tenantId);
    return this.load(pool, key, false);
  }

  async create(tenantId: string, input: NewStockDocumentInput): Promise<StockDocument> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const id = await this.insertDocument(client, input);
      const document = await this.load(client, id, false);
      if (!document) throw new StockDocumentNotFoundError(id);
      return document;
    });
  }

  async change(
    tenantId: string,
    key: string,
    decide: (current: StockDocument) => StockDocumentChange,
  ): Promise<PostedStockDocument> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const current = await this.load(client, key, true);
      if (!current) throw new StockDocumentNotFoundError(key);
      const change = decide(current);
      let transactions: InventoryTransaction[] = [];
      if (change.kind === 'update') {
        await this.applyPatch(client, current, change.patch);
      } else if (change.kind === 'transition') {
        const [byColumn, atColumn] = TRANSITION_COLUMNS[change.to];
        await client.query(
          `UPDATE inventory_schema.stock_documents
              SET status = $2::varchar, ${byColumn} = $3, ${atColumn} = now(),
                  reject_reason = CASE WHEN $2::varchar = 'REJECTED' THEN $4 ELSE reject_reason END,
                  updated_at = now()
            WHERE id = $1`,
          [current.id, change.to, change.actorId, change.reason ?? null],
        );
      } else {
        transactions = await this.postLocked(client, tenantId, current, change.actorId);
      }
      const document = await this.load(client, current.id, false);
      if (!document) throw new StockDocumentNotFoundError(key);
      return { document, transactions };
    });
  }

  async createAndPost(
    tenantId: string,
    input: NewStockDocumentInput,
    postedBy: string,
  ): Promise<PostedStockDocument> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const id = await this.insertDocument(client, input);
      const created = await this.load(client, id, true);
      if (!created) throw new StockDocumentNotFoundError(id);
      // Gọi lại cùng khoá chống lặp: chứng từ đã ghi sổ thì trả lại kết quả cũ.
      if (created.status === 'POSTED') {
        return { document: created, transactions: await this.loadLedger(client, id) };
      }
      const transactions = await this.postLocked(client, tenantId, created, postedBy);
      const document = await this.load(client, id, false);
      if (!document) throw new StockDocumentNotFoundError(id);
      return { document, transactions };
    });
  }

  async reverse(
    tenantId: string,
    key: string,
    actorId: string,
    check: (original: StockDocument) => void,
  ): Promise<PostedStockDocument> {
    const pool = await this.poolFor(tenantId);
    return inTransaction(pool, async (client) => {
      const original = await this.load(client, key, true);
      if (!original) throw new StockDocumentNotFoundError(key);
      check(original);
      const existing = await client.query<Row>(
        `SELECT code FROM inventory_schema.stock_documents WHERE reverses_document_id = $1`,
        [original.id],
      );
      if (existing.rows[0]) {
        throw new InventoryError(
          'STOCK_DOCUMENT_ALREADY_REVERSED',
          `Chứng từ ${original.code} đã được đảo bằng chứng từ ${str(existing.rows[0].code)}.`,
          409,
        );
      }

      // Điều chuyển đảo bằng cách đổi chiều kho; loại khác giữ kho, lật chiều từng dòng.
      const isTransfer = original.docType === 'TRANSFER';
      const id = await this.insertDocument(
        client,
        {
          docType: original.docType,
          warehouseCode: isTransfer
            ? (original.targetWarehouseCode ?? original.warehouseCode)
            : original.warehouseCode,
          targetWarehouseCode: isTransfer ? original.warehouseCode : original.targetWarehouseCode,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          note: `Đảo chứng từ ${original.code}`,
          createdBy: actorId,
          lines: original.lines.map((line) => ({
            materialCode: line.materialCode,
            quantity: line.quantity,
            direction: isTransfer ? line.direction : line.direction === 'IN' ? 'OUT' : 'IN',
            unitCost: line.unitCost,
            note: line.note,
          })),
        },
        original.id,
      );
      const reversal = await this.load(client, id, true);
      if (!reversal) throw new StockDocumentNotFoundError(id);
      const transactions = await this.postLocked(client, tenantId, reversal, actorId);
      const document = await this.load(client, id, false);
      if (!document) throw new StockDocumentNotFoundError(id);
      return { document, transactions };
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private async load(
    client: Queryable,
    key: string,
    lock: boolean,
  ): Promise<StockDocument | null> {
    const column = UUID_PATTERN.test(key) ? 'd.id' : 'd.code';
    const result = await client.query<Row>(
      `${DOCUMENT_SELECT} WHERE ${column} = $1 ${lock ? 'FOR UPDATE OF d' : ''}`,
      [key],
    );
    const row = result.rows[0];
    if (!row) return null;
    const lines = await this.loadLines(client, [str(row.id)]);
    return mapDocument(row, lines.get(str(row.id)) ?? []);
  }

  private async loadLines(
    client: Queryable,
    documentIds: string[],
  ): Promise<Map<string, StockDocumentLine[]>> {
    const grouped = new Map<string, StockDocumentLine[]>();
    if (documentIds.length === 0) return grouped;
    const result = await client.query<Row>(
      `SELECT l.*, m.code AS material_code, m.name AS material_name, m.unit
         FROM inventory_schema.stock_document_lines l
         JOIN inventory_schema.materials m ON m.id = l.material_id
        WHERE l.document_id = ANY($1::uuid[])
        ORDER BY l.document_id, l.line_no`,
      [documentIds],
    );
    for (const row of result.rows) {
      const key = str(row.document_id);
      const list = grouped.get(key) ?? [];
      list.push(mapLine(row));
      grouped.set(key, list);
    }
    return grouped;
  }

  private async loadLedger(client: Queryable, documentId: string): Promise<InventoryTransaction[]> {
    const result = await client.query<Row>(
      `SELECT * FROM inventory_schema.inventory_transactions
        WHERE document_id = $1 ORDER BY created_at, transaction_code`,
      [documentId],
    );
    return result.rows.map(mapTransaction);
  }

  private async warehouseId(client: Queryable, code: string): Promise<string> {
    const result = await client.query<Row>(
      `SELECT id FROM inventory_schema.warehouses WHERE code = $1 LIMIT 1`,
      [code],
    );
    if (!result.rows[0]) throw new WarehouseNotFoundError(code);
    return str(result.rows[0].id);
  }

  private async materialIds(
    client: Queryable,
    lines: readonly StockDocumentLineDraft[],
  ): Promise<Map<string, string>> {
    const codes = [...new Set(lines.map((line) => line.materialCode))];
    const result = await client.query<Row>(
      `SELECT id, code FROM inventory_schema.materials
        WHERE code = ANY($1::text[]) AND kind = 'STOCK'`,
      [codes],
    );
    const ids = new Map(result.rows.map((row) => [str(row.code), str(row.id)]));
    for (const code of codes) {
      if (!ids.has(code)) throw new MaterialNotFoundError(code);
    }
    return ids;
  }

  /** Chèn chứng từ Nháp và các dòng; trả id. Trùng khoá chống lặp thì trả id cũ. */
  private async insertDocument(
    client: Queryable,
    input: NewStockDocumentInput,
    reversesDocumentId?: string,
  ): Promise<string> {
    if (input.idempotencyKey) {
      const existing = await client.query<Row>(
        `SELECT id FROM inventory_schema.stock_documents WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return str(existing.rows[0].id);
    }
    const warehouseId = await this.warehouseId(client, input.warehouseCode);
    const targetId = input.targetWarehouseCode
      ? await this.warehouseId(client, input.targetWarehouseCode)
      : null;
    const materials = await this.materialIds(client, input.lines);
    const inserted = await client.query<Row>(
      `INSERT INTO inventory_schema.stock_documents
         (code, doc_type, status, warehouse_id, target_warehouse_id, source_type, source_id,
          idempotency_key, document_date, note, reverses_document_id, created_by)
       VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $10, $11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        newDocumentCode(input.docType),
        input.docType,
        warehouseId,
        targetId,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.idempotencyKey ?? null,
        input.documentDate ?? null,
        input.note ?? null,
        reversesDocumentId ?? null,
        input.createdBy,
      ],
    );
    if (!inserted.rows[0]) {
      // Hai lời gọi cùng khoá chạy song song: bên thua đọc lại chứng từ của bên thắng.
      const winner = await client.query<Row>(
        `SELECT id FROM inventory_schema.stock_documents WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      return str(winner.rows[0]?.id);
    }
    const id = str(inserted.rows[0].id);
    await this.insertLines(client, id, input.lines, materials);
    return id;
  }

  private async insertLines(
    client: Queryable,
    documentId: string,
    lines: readonly StockDocumentLineDraft[],
    materials: Map<string, string>,
  ): Promise<void> {
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO inventory_schema.stock_document_lines
           (document_id, line_no, material_id, quantity, direction, unit_cost, reservation_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          documentId,
          index + 1,
          materials.get(line.materialCode),
          line.quantity,
          line.direction,
          line.unitCost,
          line.reservationId ?? null,
          line.note ?? null,
        ],
      );
    }
  }

  /** Sửa nháp, hoặc sửa chứng từ bị từ chối và đưa nó về Nháp. */
  private async applyPatch(
    client: Queryable,
    current: StockDocument,
    patch: StockDocumentPatch,
  ): Promise<void> {
    const warehouseId = patch.warehouseCode
      ? await this.warehouseId(client, patch.warehouseCode)
      : current.warehouseId;
    const targetId =
      patch.targetWarehouseCode !== undefined
        ? patch.targetWarehouseCode
          ? await this.warehouseId(client, patch.targetWarehouseCode)
          : null
        : (current.targetWarehouseId ?? null);
    await client.query(
      `UPDATE inventory_schema.stock_documents
          SET status = 'DRAFT', warehouse_id = $2, target_warehouse_id = $3,
              document_date = COALESCE($4::date, document_date),
              note = $5, updated_at = now()
        WHERE id = $1`,
      [
        current.id,
        warehouseId,
        targetId,
        patch.documentDate ?? null,
        patch.note !== undefined ? patch.note || null : (current.note ?? null),
      ],
    );
    if (patch.lines) {
      const materials = await this.materialIds(client, patch.lines);
      await client.query(
        `DELETE FROM inventory_schema.stock_document_lines WHERE document_id = $1`,
        [current.id],
      );
      await this.insertLines(client, current.id, patch.lines, materials);
    }
  }

  private movements(document: StockDocument): Movement[] {
    const result: Movement[] = [];
    for (const line of document.lines) {
      const note = line.note ?? document.note;
      if (document.docType === 'TRANSFER') {
        const to = document.targetWarehouseCode ?? '';
        const outIndex = result.length;
        result.push({
          warehouseId: document.warehouseId,
          warehouseCode: document.warehouseCode,
          materialId: line.materialId,
          materialCode: line.materialCode,
          delta: -line.quantity,
          type: 'EXPORT',
          unitCost: line.unitCost,
          note: note ? `${note} (Xuất chuyển đến kho ${to})` : `Xuất chuyển đến kho ${to}`,
          lineNo: line.lineNo,
        });
        result.push({
          warehouseId: document.targetWarehouseId ?? '',
          warehouseCode: to,
          materialId: line.materialId,
          materialCode: line.materialCode,
          delta: line.quantity,
          type: 'IMPORT',
          unitCost: line.unitCost,
          note,
          transferInOf: outIndex,
          transferFromCode: document.warehouseCode,
          lineNo: line.lineNo,
        });
        continue;
      }
      const inbound = line.direction === 'IN';
      result.push({
        warehouseId: document.warehouseId,
        warehouseCode: document.warehouseCode,
        materialId: line.materialId,
        materialCode: line.materialCode,
        delta: inbound ? line.quantity : -line.quantity,
        type: document.docType === 'ADJUSTMENT' ? 'ADJUST' : inbound ? 'IMPORT' : 'EXPORT',
        unitCost: line.unitCost,
        note,
        reservationId: inbound ? undefined : line.reservationId,
        lineNo: line.lineNo,
      });
    }
    return result;
  }

  /**
   * Ghi sổ chứng từ đã khoá: khoá dòng tồn theo thứ tự (warehouse_id,
   * material_id) để hai chứng từ chạm cùng các mã không khoá chéo nhau, kiểm tồn
   * khả dụng, cộng trừ tồn, chèn bút toán mang document_id, rồi đặt Đã ghi sổ.
   * Một dòng lỗi thì ném lỗi và transaction của bên gọi rollback cả chứng từ.
   */
  private async postLocked(
    client: Queryable,
    tenantId: string,
    document: StockDocument,
    postedBy: string,
  ): Promise<InventoryTransaction[]> {
    if (document.lines.length === 0) {
      throw new InventoryError('VALIDATION', 'Chứng từ không có dòng nào để ghi sổ.');
    }
    const movements = this.movements(document);
    // Khoá giữ hàng trước dòng tồn, cùng thứ tự với nhả hàng và job hết hạn.
    const reservationItems = await this.lockReservations(client, document, movements);
    const keyOf = (warehouseId: string, materialId: string) => `${warehouseId}|${materialId}`;
    const keys = [
      ...new Map(
        movements.map((movement) => [
          keyOf(movement.warehouseId, movement.materialId),
          movement,
        ]),
      ).values(),
    ].sort((left, right) =>
      left.warehouseId === right.warehouseId
        ? left.materialId.localeCompare(right.materialId)
        : left.warehouseId.localeCompare(right.warehouseId),
    );

    // Dòng nhận hàng chưa có dòng tồn thì dựng trước, theo cùng thứ tự khoá.
    const inboundKeys = new Set(
      movements
        .filter((movement) => movement.delta > 0)
        .map((movement) => keyOf(movement.warehouseId, movement.materialId)),
    );
    for (const key of keys) {
      if (!inboundKeys.has(keyOf(key.warehouseId, key.materialId))) continue;
      await client.query(
        `INSERT INTO inventory_schema.material_inventory
           (id, warehouse_id, location_id, material_id, quantity, quantity_reserved, updated_at)
         VALUES (gen_random_uuid(), $1, NULL, $2, 0, 0, now())
         ON CONFLICT (warehouse_id, location_id, material_id) DO NOTHING`,
        [key.warehouseId, key.materialId],
      );
    }

    const locked = await client.query<Row>(
      `SELECT b.id, b.warehouse_id, b.material_id, b.quantity, b.quantity_reserved
         FROM inventory_schema.material_inventory b
         JOIN unnest($1::uuid[], $2::uuid[]) AS k(warehouse_id, material_id)
           ON k.warehouse_id = b.warehouse_id AND k.material_id = b.material_id
        WHERE b.location_id IS NULL
        ORDER BY b.warehouse_id, b.material_id
        FOR UPDATE OF b`,
      [keys.map((key) => key.warehouseId), keys.map((key) => key.materialId)],
    );
    const balances = new Map<string, Balance>(
      locked.rows.map((row) => [
        keyOf(str(row.warehouse_id), str(row.material_id)),
        { id: str(row.id), quantity: num(row.quantity), reserved: num(row.quantity_reserved) },
      ]),
    );

    // Kiểm theo thứ tự dòng trên số dư trong bộ nhớ: dòng đã khoá nên số này là
    // số thật, và hai dòng cùng mã trong một chứng từ được cộng dồn đúng.
    for (const movement of movements) {
      const balance = balances.get(keyOf(movement.warehouseId, movement.materialId));
      if (movement.reservationId) {
        // Xuất theo giữ hàng lấy chính phần đã giữ: tồn và phần giữ cùng giảm,
        // khả dụng không đổi. Chỉ cần tồn thực tế đủ.
        const quantity = Math.abs(movement.delta);
        if (!balance || round3(balance.quantity - quantity) < 0) {
          throw new InsufficientAvailableStockError(
            movement.materialCode,
            quantity,
            Math.max(balance?.quantity ?? 0, 0),
            movement.warehouseCode,
          );
        }
        balance.quantity = round3(balance.quantity - quantity);
        balance.reserved = Math.max(round3(balance.reserved - quantity), 0);
        continue;
      }
      if (movement.delta < 0) {
        const available = balance ? round3(balance.quantity - balance.reserved) : 0;
        if (!balance || round3(available + movement.delta) < 0) {
          throw new InsufficientAvailableStockError(
            movement.materialCode,
            Math.abs(movement.delta),
            Math.max(available, 0),
            movement.warehouseCode,
          );
        }
      }
      if (balance) balance.quantity = round3(balance.quantity + movement.delta);
    }

    for (const balance of balances.values()) {
      await client.query(
        `UPDATE inventory_schema.material_inventory
            SET quantity = $2, quantity_reserved = $3, updated_at = now()
          WHERE id = $1`,
        [balance.id, balance.quantity, balance.reserved],
      );
    }
    await this.recordReservationIssue(client, reservationItems);

    const ledger: InventoryTransaction[] = [];
    for (const movement of movements) {
      const outLeg = movement.transferInOf !== undefined ? ledger[movement.transferInOf] : undefined;
      const note = outLeg
        ? movement.note
          ? `${movement.note} (Nhập chuyển từ kho ${movement.transferFromCode} theo ${outLeg.transactionCode})`
          : `Nhập chuyển từ kho ${movement.transferFromCode} theo ${outLeg.transactionCode}`
        : movement.note;
      const inserted = await client.query<Row>(
        `INSERT INTO inventory_schema.inventory_transactions
           (id, transaction_code, warehouse_id, material_id, type, quantity, unit_cost,
            reference_type, reference_id, workflow_status, note, created_by, document_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'APPROVED', $9, $10, $11)
         RETURNING *`,
        [
          newLedgerCode(),
          movement.warehouseId,
          movement.materialId,
          movement.type,
          movement.delta,
          movement.unitCost,
          outLeg ? 'inventory_transaction' : (document.sourceType ?? null),
          outLeg ? outLeg.id : (document.sourceId ?? null),
          note ?? null,
          postedBy,
          document.id,
        ],
      );
      ledger.push(mapTransaction(inserted.rows[0]));
    }

    await client.query(
      `UPDATE inventory_schema.stock_documents
          SET status = 'POSTED', posted_by = $2, posted_at = now(), updated_at = now()
        WHERE id = $1`,
      [document.id, postedBy],
    );

    await this.notifyLowStock(client, tenantId, movements, ledger);
    return ledger;
  }

  /**
   * Khoá các giữ hàng mà dòng xuất tham chiếu (theo id) và dòng của chúng, rồi
   * phân số xuất vào phần chưa xuất. Lỗi khi giữ hàng không có, đã đóng, không
   * giữ đúng vật tư tại đúng kho, hoặc xuất quá phần còn giữ.
   */
  private async lockReservations(
    client: Queryable,
    document: StockDocument,
    movements: readonly Movement[],
  ): Promise<LockedReservationItem[]> {
    const ids = [
      ...new Set(
        movements
          .map((movement) => movement.reservationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
    if (ids.length === 0) return [];
    const headers = await client.query<Row>(
      `SELECT id, reservation_code, status FROM inventory_schema.reservations
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    );
    const itemRows = await client.query<Row>(
      `SELECT id, reservation_id, warehouse_id, material_id, quantity_reserved, quantity_issued
         FROM inventory_schema.reservation_items
        WHERE reservation_id = ANY($1::uuid[])
        ORDER BY reservation_id, id
        FOR UPDATE`,
      [ids],
    );
    const byId = new Map(headers.rows.map((row) => [str(row.id), row]));
    const items: LockedReservationItem[] = itemRows.rows.map((row) => ({
      id: str(row.id),
      reservationId: str(row.reservation_id),
      warehouseId: str(row.warehouse_id),
      materialId: str(row.material_id),
      outstanding: round3(num(row.quantity_reserved) - num(row.quantity_issued)),
      issued: 0,
    }));

    for (const movement of movements) {
      if (!movement.reservationId) continue;
      const header = byId.get(movement.reservationId);
      if (!header) {
        throw new ReservationIssueError(
          'RESERVATION_NOT_FOUND',
          `Dòng ${movement.lineNo}: không tìm thấy giữ hàng ${movement.reservationId}.`,
          404,
        );
      }
      const code = str(header.reservation_code);
      const status = str(header.status);
      if (status !== 'RESERVED' && status !== 'PARTIALLY_ISSUED') {
        throw new ReservationIssueError(
          'RESERVATION_CLOSED',
          `Dòng ${movement.lineNo}: giữ hàng ${code} đã ${RESERVATION_STATUS_LABELS[status] ?? status}, không xuất theo được.`,
        );
      }
      const matching = items.filter(
        (item) =>
          item.reservationId === movement.reservationId &&
          item.warehouseId === movement.warehouseId &&
          item.materialId === movement.materialId,
      );
      if (matching.length === 0) {
        throw new ReservationIssueError(
          'RESERVATION_MISMATCH',
          `Dòng ${movement.lineNo}: giữ hàng ${code} không giữ ${movement.materialCode} tại kho ${document.warehouseCode}.`,
        );
      }
      let remaining = Math.abs(movement.delta);
      const outstanding = round3(matching.reduce((sum, item) => sum + item.outstanding, 0));
      if (round3(outstanding - remaining) < 0) {
        throw new ReservationIssueError(
          'RESERVATION_OVER_ISSUE',
          `Dòng ${movement.lineNo}: giữ hàng ${code} chỉ còn ${Math.max(outstanding, 0)} ${movement.materialCode} chưa xuất, không xuất được ${remaining}.`,
        );
      }
      for (const item of matching) {
        if (remaining <= 0) break;
        const take = Math.min(item.outstanding, remaining);
        if (take <= 0) continue;
        item.outstanding = round3(item.outstanding - take);
        item.issued = round3(item.issued + take);
        remaining = round3(remaining - take);
      }
    }
    return items;
  }

  /** Cộng số đã xuất vào dòng giữ hàng, đặt Xuất một phần hoặc Xuất đủ. */
  private async recordReservationIssue(
    client: Queryable,
    items: readonly LockedReservationItem[],
  ): Promise<void> {
    const touched = items.filter((item) => item.issued > 0);
    if (touched.length === 0) return;
    for (const item of touched) {
      await client.query(
        `UPDATE inventory_schema.reservation_items
            SET quantity_issued = quantity_issued + $2
          WHERE id = $1`,
        [item.id, item.issued],
      );
    }
    await client.query(
      `UPDATE inventory_schema.reservations r
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM inventory_schema.reservation_items i
                   WHERE i.reservation_id = r.id AND i.quantity_issued < i.quantity_reserved
                ) THEN 'PARTIALLY_ISSUED'
                ELSE 'COMPLETED'
              END
        WHERE r.id = ANY($1::uuid[])`,
      [[...new Set(touched.map((item) => item.reservationId))]],
    );
  }

  /** Cảnh báo tồn thấp như `append` cũ, mỗi mã một lần cho cả chứng từ. */
  private async notifyLowStock(
    client: Queryable,
    tenantId: string,
    movements: Movement[],
    ledger: InventoryTransaction[],
  ): Promise<void> {
    const firstEntry = new Map<string, string>();
    movements.forEach((movement, index) => {
      if (!firstEntry.has(movement.materialId)) firstEntry.set(movement.materialId, ledger[index].id);
    });
    for (const [materialId, alertId] of firstEntry) {
      const lowStock = await client.query<Row>(
        `SELECT material.id, material.code, material.name, material.min_stock,
                COALESCE(SUM(balance.quantity - balance.quantity_reserved), 0) AS available
           FROM inventory_schema.materials material
           LEFT JOIN inventory_schema.material_inventory balance
             ON balance.material_id = material.id
          WHERE material.id = $1
          GROUP BY material.id, material.code, material.name, material.min_stock
         HAVING material.min_stock > 0
            AND COALESCE(SUM(balance.quantity - balance.quantity_reserved), 0)
                < material.min_stock`,
        [materialId],
      );
      const row = lowStock.rows[0];
      if (!row) continue;
      await writeInventoryOutbox(
        client as PoolClient,
        tenantId,
        lowStockNotificationEvent({
          alertId,
          materialId: str(row.id),
          materialCode: str(row.code),
          materialName: str(row.name),
          available: num(row.available),
          minimum: num(row.min_stock),
        }),
      );
    }
  }
}
