import type { QualityStatus, SerialStockState, StockDocument } from '@enterprise-platform/contracts-inventory';
import type { PoolClient, QueryResultRow } from 'pg';
import { InventoryError } from '../domain/inventory.error.js';
import {
  QUALITY_STATUS_LABELS,
  SERIAL_STOCK_STATE_LABELS,
  isBlockingQuality,
  requiresPassedQuality,
  serialKey,
  serialMovementType,
} from '../domain/traceability-policy.js';

type Row = QueryResultRow & Record<string, unknown>;
type Queryable = Pick<PoolClient, 'query'>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const num = (value: unknown): number => Number(value ?? 0);
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Một lần cộng hoặc trừ tồn của chứng từ, đủ thông tin để xử lý lô và serial. */
export interface TrackedMovement {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly delta: number;
  readonly lineNo: number;
  readonly lineId: string;
  readonly lotId?: string;
  readonly lotNo?: string;
  readonly serials?: readonly string[];
  /** Vế nhập của điều chuyển: chỉ số vế xuất. */
  readonly transferInOf?: number;
}

interface SerialOp {
  readonly kind: 'IN' | 'OUT' | 'MOVE';
  readonly lineNo: number;
  readonly lineId: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly serial: string;
  readonly key: string;
  readonly fromWarehouseId?: string;
  readonly fromWarehouseCode?: string;
  readonly toWarehouseId?: string;
  /** Chỉ số movement trừ tồn (OUT, MOVE) và cộng tồn (IN, MOVE). */
  readonly outIndex?: number;
  readonly inIndex?: number;
}

interface LockedSerial {
  readonly id: string;
  readonly serialNumber: string;
  readonly stockState?: SerialStockState;
  readonly warehouseId?: string;
  readonly warehouseCode?: string;
  readonly quality: QualityStatus;
}

interface SerialChange {
  readonly serialId: string;
  readonly op: SerialOp;
  readonly quality: QualityStatus;
  readonly stockState: SerialStockState;
  readonly warehouseId: string | null;
  /** Dòng có sẵn cần UPDATE; serial vừa tạo thì đã có trạng thái đúng. */
  readonly update: boolean;
}

interface LockedLot {
  readonly id: string;
  readonly lotNo: string;
  readonly quality: QualityStatus;
}

interface LotBalanceState {
  readonly id: string;
  quantity: number;
  readonly reserved: number;
  blocked: number;
  touched: boolean;
}

function serialError(code: string, message: string, status = 400): InventoryError {
  return new InventoryError(code, message, status);
}

/**
 * Lô và serial khi ghi sổ một chứng từ đã khoá (T1-14, T1-17, T1-19).
 *
 * Thứ tự khoá cố định cho mọi đường ghi: chứng từ, giữ hàng, serial (theo id),
 * lô (theo id, FOR SHARE), tồn lô (theo kho, lô), rồi tồn vật tư. Đổi trạng thái
 * chất lượng khoá serial hoặc lô trước rồi mới tới tồn, nên hai đường không khoá
 * chéo nhau.
 *
 * `prepare` kiểm và tính, chưa sửa dòng có sẵn (chỉ chèn serial mới để unique
 * chặn hai phiếu nhập cùng serial); `apply` ghi tồn lô và serial; `record` ghi
 * lịch sử serial. Lỗi ở bất kỳ bước nào thì transaction của bên gọi rollback.
 */
export class StockDocumentTracking {
  private constructor(
    private readonly document: StockDocument,
    /** Phần không Đạt trong số lượng của từng movement, cùng chỉ số với danh sách movement. */
    readonly blocked: number[],
    private readonly serialChanges: SerialChange[],
    private readonly lotBalances: Map<string, LotBalanceState>,
  ) {}

  static async prepare(
    client: Queryable,
    document: StockDocument,
    movements: readonly TrackedMovement[],
  ): Promise<StockDocumentTracking> {
    const blocked = movements.map(() => 0);
    const serialChanges = await prepareSerials(client, document, movements, blocked);
    const lotBalances = await prepareLots(client, document, movements, blocked);
    return new StockDocumentTracking(document, blocked, serialChanges, lotBalances);
  }

  async apply(client: Queryable): Promise<void> {
    for (const change of this.serialChanges) {
      if (!change.update) continue;
      await client.query(
        `UPDATE inventory_schema.serial_tracking
            SET stock_state = $2, current_warehouse_id = $3, updated_at = now()
          WHERE id = $1`,
        [change.serialId, change.stockState, change.warehouseId],
      );
    }
    for (const balance of this.lotBalances.values()) {
      if (!balance.touched) continue;
      await client.query(
        `UPDATE inventory_schema.lot_balances
            SET quantity = $2, quantity_blocked = $3, updated_at = now()
          WHERE id = $1`,
        [balance.id, balance.quantity, balance.blocked],
      );
    }
  }

  /** Mỗi serial một dòng lịch sử, cùng transaction với ghi sổ. */
  async record(client: Queryable, actorId: string): Promise<void> {
    const type = serialMovementType(this.document.docType, Boolean(this.document.reversesDocumentId));
    for (const change of this.serialChanges) {
      const { op } = change;
      await client.query(
        `INSERT INTO inventory_schema.serial_movements
           (serial_id, material_id, serial_number, movement_type, from_warehouse_id, to_warehouse_id,
            document_id, document_line_id, source_type, source_id, stock_state, quality_status, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          change.serialId,
          op.materialId,
          op.serial,
          type,
          op.fromWarehouseId ?? null,
          op.toWarehouseId ?? null,
          this.document.id,
          op.lineId,
          this.document.sourceType ?? null,
          this.document.sourceId ?? null,
          change.stockState,
          change.quality,
          actorId,
        ],
      );
    }
  }
}

function serialOps(document: StockDocument, movements: readonly TrackedMovement[]): SerialOp[] {
  const ops: SerialOp[] = [];
  movements.forEach((movement, index) => {
    if (!movement.serials?.length || movement.transferInOf !== undefined) return;
    const inIndex = movements.findIndex((candidate) => candidate.transferInOf === index);
    for (const serial of movement.serials) {
      const base = {
        lineNo: movement.lineNo,
        lineId: movement.lineId,
        materialId: movement.materialId,
        materialCode: movement.materialCode,
        serial,
        key: serialKey(serial),
      };
      if (inIndex >= 0) {
        const target = movements[inIndex];
        ops.push({
          ...base,
          kind: 'MOVE',
          fromWarehouseId: movement.warehouseId,
          fromWarehouseCode: movement.warehouseCode,
          toWarehouseId: target.warehouseId,
          outIndex: index,
          inIndex,
        });
      } else if (movement.delta < 0) {
        ops.push({
          ...base,
          kind: 'OUT',
          fromWarehouseId: movement.warehouseId,
          fromWarehouseCode: movement.warehouseCode,
          outIndex: index,
        });
      } else {
        ops.push({ ...base, kind: 'IN', toWarehouseId: movement.warehouseId, inIndex: index });
      }
    }
  });
  return ops;
}

async function prepareSerials(
  client: Queryable,
  document: StockDocument,
  movements: readonly TrackedMovement[],
  blocked: number[],
): Promise<SerialChange[]> {
  const ops = serialOps(document, movements);
  if (ops.length === 0) return [];

  // Khoá theo id: hai chứng từ cùng xuất một serial thì bên sau chờ, đọc thấy Đã
  // xuất và bị từ chối (TC-CONC-02).
  const locked = await client.query<Row>(
    `SELECT s.id, s.material_id, s.serial_number, s.stock_state, s.current_warehouse_id,
            s.quality_status, upper(btrim(s.serial_number)) AS serial_key, w.code AS warehouse_code
       FROM inventory_schema.serial_tracking s
       JOIN (SELECT DISTINCT material_id, serial_key
               FROM unnest($1::uuid[], $2::text[]) AS k(material_id, serial_key)) k
         ON k.material_id = s.material_id AND k.serial_key = upper(btrim(s.serial_number))
       LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
      ORDER BY s.id
      FOR UPDATE OF s`,
    [ops.map((op) => op.materialId), ops.map((op) => op.key)],
  );
  const existing = new Map<string, LockedSerial>(
    locked.rows.map((row) => [
      `${str(row.material_id)}|${str(row.serial_key)}`,
      {
        id: str(row.id),
        serialNumber: str(row.serial_number),
        stockState: opt(row.stock_state) as SerialStockState | undefined,
        warehouseId: opt(row.current_warehouse_id),
        warehouseCode: opt(row.warehouse_code),
        quality: str(row.quality_status) as QualityStatus,
      },
    ]),
  );

  const changes: SerialChange[] = [];
  for (const op of ops) {
    const current = existing.get(`${op.materialId}|${op.key}`);
    if (op.kind === 'IN') {
      changes.push(await receiveSerial(client, op, current, blocked));
      continue;
    }
    if (!current) {
      const other = await client.query<Row>(
        `SELECT m.code FROM inventory_schema.serial_tracking s
           JOIN inventory_schema.materials m ON m.id = s.material_id
          WHERE upper(btrim(s.serial_number)) = $1
          ORDER BY m.code LIMIT 1`,
        [op.key],
      );
      throw other.rows[0]
        ? serialError(
            'SERIAL_MATERIAL_MISMATCH',
            `Dòng ${op.lineNo}: serial ${op.serial} không thuộc vật tư ${op.materialCode} (đang khai cho ${str(other.rows[0].code)}).`,
          )
        : serialError('SERIAL_NOT_FOUND', `Dòng ${op.lineNo}: serial ${op.serial} không tồn tại.`);
    }
    const needsPassed = op.kind === 'OUT' && requiresPassedQuality(document.docType, 'OUT');
    if (current.stockState !== 'IN_STOCK') {
      const state = current.stockState
        ? SERIAL_STOCK_STATE_LABELS[current.stockState]
        : 'chưa vào sổ kho';
      throw serialError(
        'SERIAL_NOT_AVAILABLE',
        needsPassed
          ? `Dòng ${op.lineNo}: serial ${op.serial} không ở trạng thái Trong kho, Đạt (đang ${state}).`
          : `Dòng ${op.lineNo}: serial ${op.serial} không ở trạng thái Trong kho (đang ${state}).`,
      );
    }
    if (current.warehouseId !== op.fromWarehouseId) {
      throw serialError(
        'SERIAL_WRONG_WAREHOUSE',
        `Dòng ${op.lineNo}: serial ${op.serial} không ở kho xuất ${op.fromWarehouseCode}${current.warehouseCode ? ` (đang ở kho ${current.warehouseCode})` : ''}.`,
      );
    }
    if (needsPassed && current.quality !== 'PASSED') {
      throw serialError(
        'SERIAL_NOT_AVAILABLE',
        `Dòng ${op.lineNo}: serial ${op.serial} không ở trạng thái Trong kho, Đạt (đang ${QUALITY_STATUS_LABELS[current.quality]}).`,
      );
    }
    if (isBlockingQuality(current.quality)) {
      if (op.outIndex !== undefined) blocked[op.outIndex] += 1;
      if (op.inIndex !== undefined) blocked[op.inIndex] += 1;
    }
    changes.push({
      serialId: current.id,
      op,
      quality: current.quality,
      stockState: op.kind === 'MOVE' ? 'IN_STOCK' : 'ISSUED',
      warehouseId: op.kind === 'MOVE' ? (op.toWarehouseId ?? null) : null,
      update: true,
    });
  }
  return changes;
}

/**
 * Nhập một serial: chưa có thì tạo, đã có mà Đã xuất (hàng trả về, đảo phiếu xuất)
 * hoặc chưa vào sổ kho thì nhận lại; đang Trong kho, Đang chuyển hay Đã huỷ thì 409.
 */
async function receiveSerial(
  client: Queryable,
  op: SerialOp,
  current: LockedSerial | undefined,
  blocked: number[],
): Promise<SerialChange> {
  if (current) {
    if (current.stockState === 'IN_STOCK' || current.stockState === 'IN_TRANSIT' || current.stockState === 'SCRAPPED') {
      throw serialError(
        'SERIAL_DUPLICATE',
        `Dòng ${op.lineNo}: serial ${op.serial} của ${op.materialCode} đã có (${SERIAL_STOCK_STATE_LABELS[current.stockState]}${current.warehouseCode ? `, kho ${current.warehouseCode}` : ''}).`,
        409,
      );
    }
    if (isBlockingQuality(current.quality) && op.inIndex !== undefined) blocked[op.inIndex] += 1;
    return {
      serialId: current.id,
      op,
      quality: current.quality,
      stockState: 'IN_STOCK',
      warehouseId: op.toWarehouseId ?? null,
      update: true,
    };
  }
  // Unique (material_id, upper(btrim(serial_number))) của 0013: phiếu nhập khác
  // vừa tạo cùng serial thì lệnh này chờ nó, rồi không chèn được và trả 409.
  const inserted = await client.query<Row>(
    `INSERT INTO inventory_schema.serial_tracking
       (id, material_id, serial_number, current_status, location_type, current_warehouse_id,
        stock_state, quality_status)
     VALUES (gen_random_uuid(), $1, $2, 'IN_STOCK', 'WAREHOUSE', $3, 'IN_STOCK', 'PASSED')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [op.materialId, op.serial, op.toWarehouseId ?? null],
  );
  if (!inserted.rows[0]) {
    throw serialError(
      'SERIAL_DUPLICATE',
      `Dòng ${op.lineNo}: serial ${op.serial} của ${op.materialCode} đã có.`,
      409,
    );
  }
  return {
    serialId: str(inserted.rows[0].id),
    op,
    quality: 'PASSED',
    stockState: 'IN_STOCK',
    warehouseId: op.toWarehouseId ?? null,
    update: false,
  };
}

async function prepareLots(
  client: Queryable,
  document: StockDocument,
  movements: readonly TrackedMovement[],
  blocked: number[],
): Promise<Map<string, LotBalanceState>> {
  const balances = new Map<string, LotBalanceState>();
  const lotIds = [...new Set(movements.map((movement) => movement.lotId).filter((id): id is string => Boolean(id)))].sort();
  if (lotIds.length === 0) return balances;

  // FOR SHARE: chặn đổi trạng thái chất lượng giữa chừng, không chặn chứng từ khác cùng lô.
  const lotRows = await client.query<Row>(
    `SELECT id, lot_no, quality_status FROM inventory_schema.lots
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR SHARE`,
    [lotIds],
  );
  const lots = new Map<string, LockedLot>(
    lotRows.rows.map((row) => [
      str(row.id),
      { id: str(row.id), lotNo: str(row.lot_no), quality: str(row.quality_status) as QualityStatus },
    ]),
  );

  const keyOf = (warehouseId: string, lotId: string) => `${warehouseId}|${lotId}`;
  const keys = [
    ...new Map(
      movements
        .filter((movement) => movement.lotId)
        .map((movement) => [keyOf(movement.warehouseId, movement.lotId as string), movement]),
    ).values(),
  ].sort((left, right) =>
    left.warehouseId === right.warehouseId
      ? (left.lotId as string).localeCompare(right.lotId as string)
      : left.warehouseId.localeCompare(right.warehouseId),
  );
  for (const key of keys) {
    if (!movements.some((movement) => movement.delta > 0 && movement.lotId === key.lotId && movement.warehouseId === key.warehouseId)) continue;
    await client.query(
      `INSERT INTO inventory_schema.lot_balances (warehouse_id, lot_id)
       VALUES ($1, $2)
       ON CONFLICT (warehouse_id, lot_id) DO NOTHING`,
      [key.warehouseId, key.lotId],
    );
  }
  const locked = await client.query<Row>(
    `SELECT b.id, b.warehouse_id, b.lot_id, b.quantity, b.quantity_reserved, b.quantity_blocked
       FROM inventory_schema.lot_balances b
       JOIN unnest($1::uuid[], $2::uuid[]) AS k(warehouse_id, lot_id)
         ON k.warehouse_id = b.warehouse_id AND k.lot_id = b.lot_id
      ORDER BY b.warehouse_id, b.lot_id
      FOR UPDATE OF b`,
    [keys.map((key) => key.warehouseId), keys.map((key) => key.lotId)],
  );
  for (const row of locked.rows) {
    balances.set(keyOf(str(row.warehouse_id), str(row.lot_id)), {
      id: str(row.id),
      quantity: num(row.quantity),
      reserved: num(row.quantity_reserved),
      blocked: num(row.quantity_blocked),
      touched: false,
    });
  }

  movements.forEach((movement, index) => {
    if (!movement.lotId) return;
    const lot = lots.get(movement.lotId);
    if (!lot) {
      throw new InventoryError('LOT_NOT_FOUND', `Dòng ${movement.lineNo}: không tìm thấy lô ${movement.lotNo ?? movement.lotId}.`, 404);
    }
    const balance = balances.get(keyOf(movement.warehouseId, movement.lotId));
    const blocking = isBlockingQuality(lot.quality);
    const quantity = Math.abs(movement.delta);
    if (movement.delta < 0) {
      const needsPassed = requiresPassedQuality(document.docType, 'OUT');
      if (needsPassed && blocking) {
        throw new InventoryError(
          'LOT_NOT_AVAILABLE',
          `Dòng ${movement.lineNo}: lô ${lot.lotNo} không ở trạng thái Đạt (đang ${QUALITY_STATUS_LABELS[lot.quality]}).`,
        );
      }
      const available = balance
        ? needsPassed
          ? round3(balance.quantity - balance.reserved - balance.blocked)
          : balance.quantity
        : 0;
      if (!balance || round3(available - quantity) < 0) {
        throw new InventoryError(
          'LOT_INSUFFICIENT_STOCK',
          `Dòng ${movement.lineNo}: lô ${lot.lotNo} tại kho ${movement.warehouseCode} chỉ còn ${Math.max(available, 0)} ${movement.materialCode}, không đủ cho ${quantity}.`,
          409,
        );
      }
      balance.quantity = round3(balance.quantity - quantity);
      if (blocking) balance.blocked = round3(balance.blocked - quantity);
    } else {
      if (!balance) {
        throw new InventoryError('LOT_NOT_FOUND', `Dòng ${movement.lineNo}: không tìm thấy tồn của lô ${lot.lotNo}.`, 404);
      }
      balance.quantity = round3(balance.quantity + quantity);
      if (blocking) balance.blocked = round3(balance.blocked + quantity);
    }
    balance.touched = true;
    if (blocking) blocked[index] = round3(blocked[index] + quantity);
  });
  return balances;
}
