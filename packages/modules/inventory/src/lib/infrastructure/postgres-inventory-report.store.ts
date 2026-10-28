import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type {
  MaterialCategory,
  QualityStatus,
  SerialReportTotals,
  SerialStockState,
  StockApprovalReportRow,
  StockDocumentStatus,
  StockDocumentType,
  StockReportLotRow,
  StockReportSerialRow,
  StockReportTotals,
  StockReportWarehouseRow,
  TransactionType,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, QueryResultRow } from 'pg';
import type {
  InventoryReportStore,
  ReportPage,
  ReportPaging,
  StockApprovalFilter,
  StockMovementFilter,
  StockMovementLineRecord,
  StockReportFilter,
} from '../application/inventory-report-store.port.js';
import {
  MOVEMENT_CATEGORY_RULES,
  stockQuantities,
  type MovementGroup,
} from '../domain/inventory-report.js';

type Row = QueryResultRow & Record<string, unknown>;

const str = (value: unknown): string => String(value);
const opt = (value: unknown): string | undefined => (value == null ? undefined : String(value));
const num = (value: unknown): number => Number(value ?? 0);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const isoOpt = (value: unknown): string | undefined => (value == null ? undefined : iso(value));

/** Mẫu ILIKE chứa chuỗi tìm, thoát `%`, `_`, `\` để người dùng gõ ký tự đó vẫn tìm đúng. */
function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** Dựng mệnh đề WHERE với tham số đánh số tăng dần. */
class Where {
  readonly params: unknown[] = [];
  private readonly clauses: string[] = [];

  /** Thêm tham số, trả placeholder `$n`. */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  add(clause: string): void {
    this.clauses.push(clause);
  }

  toString(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

/** Lọc chung theo mặt hàng, nhóm vật tư, kho (alias `m`, `w`). */
function materialFilters(where: Where, filter: StockReportFilter, extraSearch: readonly string[] = []): void {
  if (filter.materialCode) where.add(`m.code = ${where.param(filter.materialCode)}`);
  if (filter.category) where.add(`m.category = ${where.param(filter.category)}`);
  if (filter.warehouseCode) where.add(`w.code = ${where.param(filter.warehouseCode)}`);
  if (filter.search) {
    const pattern = where.param(containsPattern(filter.search));
    const columns = ['m.code', 'm.name', ...extraSearch];
    where.add(`(${columns.map((column) => `${column} ILIKE ${pattern}`).join(' OR ')})`);
  }
}

/** Kỳ báo cáo theo ngày Việt Nam trên cột thời điểm (giữ được chỉ mục trên cột). */
function periodClause(where: Where, column: string, fromDate: string, toDate: string): void {
  where.add(`${column} >= (${where.param(fromDate)}::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`);
  where.add(`${column} < (${where.param(toDate)}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`);
}

/** Lọc bút toán theo kỳ, kho, loại chứng từ, nhóm nghiệp vụ, mặt hàng (alias `t`, `d`, `w`, `m`). */
function movementWhere(filter: StockMovementFilter): Where {
  const where = new Where();
  periodClause(where, 't.created_at', filter.fromDate, filter.toDate);
  where.add(`COALESCE(t.workflow_status, 'APPROVED') = 'APPROVED'`);
  if (filter.warehouseCode) where.add(`w.code = ${where.param(filter.warehouseCode)}`);
  if (filter.docType) where.add(`d.doc_type = ${where.param(filter.docType)}`);
  if (filter.search) {
    const pattern = where.param(containsPattern(filter.search));
    where.add(`(m.code ILIKE ${pattern} OR m.name ILIKE ${pattern} OR d.code ILIKE ${pattern})`);
  }
  if (filter.category === 'REVERSAL') {
    where.add('d.reverses_document_id IS NOT NULL');
  } else if (filter.category) {
    // Cùng quy tắc với `classifyMovement`: có chứng từ thì theo loại chứng từ, không thì theo loại bút toán.
    const rule = MOVEMENT_CATEGORY_RULES[filter.category];
    where.add(
      `((d.id IS NOT NULL AND d.reverses_document_id IS NULL AND d.doc_type = ANY(${where.param(rule.docTypes)}::text[]))
        OR (d.id IS NULL AND t.type = ANY(${where.param(rule.ledgerTypes)}::text[])))`,
    );
  }
  return where;
}

const MOVEMENT_FROM = `
  FROM inventory_schema.inventory_transactions t
  JOIN inventory_schema.warehouses w ON w.id = t.warehouse_id
  JOIN inventory_schema.materials m ON m.id = t.material_id
  LEFT JOIN inventory_schema.stock_documents d ON d.id = t.document_id`;

/**
 * Truy vấn chỉ đọc cho báo cáo kho. Mỗi báo cáo hai câu chạy song song: một
 * trang dòng và một câu đếm kèm tổng của cả tập đã lọc.
 */
export class PostgresInventoryReportStore implements InventoryReportStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async stockByWarehouse(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportWarehouseRow, StockReportTotals>> {
    const pool = await this.poolFor(tenantId);
    const where = new Where();
    materialFilters(where, filter);
    if (!filter.includeZero) where.add('(x.quantity <> 0 OR x.reserved <> 0 OR x.blocked <> 0)');
    // Dòng tồn có thể chia theo vị trí trong kho: cộng mọi vị trí. Giá bình quân
    // nằm ở dòng không vị trí, nơi chứng từ kho ghi sổ.
    const from = `
      FROM (
        SELECT b.warehouse_id, b.material_id,
               sum(b.quantity) AS quantity,
               sum(b.quantity_reserved) AS reserved,
               sum(b.quantity_blocked) AS blocked,
               COALESCE(max(b.avg_cost) FILTER (WHERE b.location_id IS NULL), 0) AS avg_cost
          FROM inventory_schema.material_inventory b
         GROUP BY b.warehouse_id, b.material_id
      ) x
      JOIN inventory_schema.warehouses w ON w.id = x.warehouse_id
      JOIN inventory_schema.materials m ON m.id = x.material_id
      ${where}`;
    const limit = where.params.length + 1;
    const [page, summary] = await Promise.all([
      pool.query<Row>(
        `SELECT x.*, round(x.quantity * x.avg_cost, 2) AS stock_value,
                w.code AS warehouse_code, w.name AS warehouse_name,
                m.code AS material_code, m.name AS material_name, m.unit, m.category
           ${from}
          ORDER BY w.code, m.code
          LIMIT $${limit} OFFSET $${limit + 1}`,
        [...where.params, paging.limit, paging.offset],
      ),
      pool.query<Row>(
        `SELECT count(*)::int AS total,
                COALESCE(sum(x.quantity), 0) AS quantity,
                COALESCE(sum(x.reserved), 0) AS reserved,
                COALESCE(sum(x.blocked), 0) AS blocked,
                COALESCE(sum(GREATEST(x.quantity - x.reserved - x.blocked, 0)), 0) AS available,
                COALESCE(sum(round(x.quantity * x.avg_cost, 2)), 0) AS stock_value
           ${from}`,
        where.params,
      ),
    ]);
    const totals = summary.rows[0] ?? {};
    return {
      rows: page.rows.map((row) => ({
        warehouseId: str(row.warehouse_id),
        warehouseCode: str(row.warehouse_code),
        warehouseName: str(row.warehouse_name),
        ...materialColumns(row),
        ...stockQuantities(num(row.quantity), num(row.reserved), num(row.blocked)),
        avgCost: num(row.avg_cost),
        stockValue: num(row.stock_value),
      })),
      total: num(totals.total),
      totals: { ...summaryQuantities(totals), stockValue: num(totals.stock_value) },
    };
  }

  async stockByLot(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportLotRow, StockReportTotals>> {
    const pool = await this.poolFor(tenantId);
    const where = new Where();
    const today = where.param(filter.today);
    materialFilters(where, filter, ['l.lot_no']);
    if (filter.qualityStatus) where.add(`l.quality_status = ${where.param(filter.qualityStatus)}`);
    if (filter.expiringWithinDays !== undefined) {
      // Gồm cả lô đã hết hạn: lô quá hạn còn tồn là thứ cần xử lý trước nhất.
      where.add(
        `l.expires_on IS NOT NULL AND l.expires_on <= ${today}::date + ${where.param(filter.expiringWithinDays)}::int`,
      );
    }
    if (!filter.includeZero) {
      where.add('(lb.quantity <> 0 OR lb.quantity_reserved <> 0 OR lb.quantity_blocked <> 0)');
    }
    const from = `
      FROM inventory_schema.lot_balances lb
      JOIN inventory_schema.lots l ON l.id = lb.lot_id
      JOIN inventory_schema.materials m ON m.id = l.material_id
      JOIN inventory_schema.warehouses w ON w.id = lb.warehouse_id
      ${where}`;
    const limit = where.params.length + 1;
    const [page, summary] = await Promise.all([
      pool.query<Row>(
        `SELECT lb.lot_id, lb.warehouse_id, lb.quantity, lb.quantity_reserved, lb.quantity_blocked,
                l.lot_no, l.manufactured_on::text AS manufactured_on, l.expires_on::text AS expires_on,
                (l.expires_on - ${today}::date) AS days_to_expiry, l.quality_status,
                l.material_id, m.code AS material_code, m.name AS material_name, m.unit, m.category,
                w.code AS warehouse_code, w.name AS warehouse_name
           ${from}
          ORDER BY l.expires_on NULLS LAST, m.code, l.lot_no, w.code
          LIMIT $${limit} OFFSET $${limit + 1}`,
        [...where.params, paging.limit, paging.offset],
      ),
      pool.query<Row>(
        // Nhắc `today` để câu đếm dùng cùng danh sách tham số với câu lấy trang.
        `SELECT count(*)::int AS total, ${today}::date AS as_of,
                COALESCE(sum(lb.quantity), 0) AS quantity,
                COALESCE(sum(lb.quantity_reserved), 0) AS reserved,
                COALESCE(sum(lb.quantity_blocked), 0) AS blocked,
                COALESCE(sum(GREATEST(lb.quantity - lb.quantity_reserved - lb.quantity_blocked, 0)), 0) AS available
           ${from}`,
        where.params,
      ),
    ]);
    const totals = summary.rows[0] ?? {};
    return {
      rows: page.rows.map((row) => ({
        lotId: str(row.lot_id),
        lotNo: str(row.lot_no),
        warehouseId: str(row.warehouse_id),
        warehouseCode: str(row.warehouse_code),
        warehouseName: str(row.warehouse_name),
        manufacturedOn: opt(row.manufactured_on),
        expiresOn: opt(row.expires_on),
        daysToExpiry: row.days_to_expiry == null ? undefined : num(row.days_to_expiry),
        qualityStatus: str(row.quality_status) as QualityStatus,
        ...materialColumns(row),
        ...stockQuantities(num(row.quantity), num(row.quantity_reserved), num(row.quantity_blocked)),
      })),
      total: num(totals.total),
      totals: summaryQuantities(totals),
    };
  }

  async stockBySerial(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportSerialRow, SerialReportTotals>> {
    const pool = await this.poolFor(tenantId);
    const where = new Where();
    materialFilters(where, filter, ['s.serial_number']);
    if (filter.qualityStatus) where.add(`s.quality_status = ${where.param(filter.qualityStatus)}`);
    if (filter.stockState) where.add(`s.stock_state = ${where.param(filter.stockState)}`);
    const from = `
      FROM inventory_schema.serial_tracking s
      JOIN inventory_schema.materials m ON m.id = s.material_id
      LEFT JOIN inventory_schema.warehouses w ON w.id = s.current_warehouse_id
      ${where}`;
    const limit = where.params.length + 1;
    const [page, summary] = await Promise.all([
      pool.query<Row>(
        `SELECT s.id, s.serial_number, s.stock_state, s.quality_status, s.updated_at,
                s.current_warehouse_id, s.material_id, m.code AS material_code, m.name AS material_name,
                m.unit, m.category, w.code AS warehouse_code, w.name AS warehouse_name
           ${from}
          ORDER BY m.code, s.serial_number
          LIMIT $${limit} OFFSET $${limit + 1}`,
        [...where.params, paging.limit, paging.offset],
      ),
      pool.query<Row>(
        `SELECT count(*)::int AS serials,
                count(*) FILTER (WHERE s.stock_state = 'IN_STOCK')::int AS in_stock,
                count(*) FILTER (WHERE s.stock_state = 'IN_STOCK' AND s.quality_status <> 'PASSED')::int AS blocked
           ${from}`,
        where.params,
      ),
    ]);
    const totals = summary.rows[0] ?? {};
    const inStock = num(totals.in_stock);
    const blocked = num(totals.blocked);
    return {
      rows: page.rows.map((row) => ({
        serialId: str(row.id),
        serialNumber: str(row.serial_number),
        warehouseId: opt(row.current_warehouse_id),
        warehouseCode: opt(row.warehouse_code),
        warehouseName: opt(row.warehouse_name),
        stockState: opt(row.stock_state) as SerialStockState | undefined,
        qualityStatus: str(row.quality_status) as QualityStatus,
        updatedAt: iso(row.updated_at),
        ...materialColumns(row),
      })),
      total: num(totals.serials),
      totals: { serials: num(totals.serials), inStock, blocked, available: inStock - blocked },
    };
  }

  async movementGroups(tenantId: string, filter: StockMovementFilter): Promise<MovementGroup[]> {
    const pool = await this.poolFor(tenantId);
    const where = movementWhere(filter);
    // Giá trị từng bút toán làm tròn 2 chữ số như `cost_amount` của dòng chứng từ.
    const result = await pool.query<Row>(
      `SELECT d.doc_type, (d.reverses_document_id IS NOT NULL) AS is_reversal, t.type,
              w.code AS warehouse_code, w.name AS warehouse_name,
              COALESCE(sum(t.quantity) FILTER (WHERE t.quantity > 0), 0) AS quantity_in,
              COALESCE(sum(-t.quantity) FILTER (WHERE t.quantity < 0), 0) AS quantity_out,
              COALESCE(sum(round(t.quantity * COALESCE(t.unit_cost, 0), 2)) FILTER (WHERE t.quantity > 0), 0) AS value_in,
              COALESCE(sum(round(-t.quantity * COALESCE(t.unit_cost, 0), 2)) FILTER (WHERE t.quantity < 0), 0) AS value_out,
              count(*)::int AS entries
         ${MOVEMENT_FROM}
         ${where}
        GROUP BY d.doc_type, (d.reverses_document_id IS NOT NULL), t.type, w.code, w.name`,
      where.params,
    );
    return result.rows.map((row) => ({
      docType: opt(row.doc_type) as StockDocumentType | undefined,
      isReversal: row.is_reversal === true,
      ledgerType: str(row.type) as TransactionType,
      warehouseCode: str(row.warehouse_code),
      warehouseName: str(row.warehouse_name),
      quantityIn: num(row.quantity_in),
      quantityOut: num(row.quantity_out),
      valueIn: num(row.value_in),
      valueOut: num(row.value_out),
      entries: num(row.entries),
    }));
  }

  async movementLines(
    tenantId: string,
    filter: StockMovementFilter,
    paging: ReportPaging,
  ): Promise<{ rows: StockMovementLineRecord[]; total: number }> {
    const pool = await this.poolFor(tenantId);
    const where = movementWhere(filter);
    const limit = where.params.length + 1;
    const [page, count] = await Promise.all([
      pool.query<Row>(
        `SELECT t.id, t.transaction_code, t.created_at, t.type, t.quantity, COALESCE(t.unit_cost, 0) AS unit_cost,
                round(abs(t.quantity) * COALESCE(t.unit_cost, 0), 2) AS value, t.created_by, t.note,
                d.id AS document_id, d.code AS document_code, d.doc_type,
                (d.reverses_document_id IS NOT NULL) AS is_reversal, r.code AS reverses_code,
                w.code AS warehouse_code, w.name AS warehouse_name,
                m.code AS material_code, m.name AS material_name, m.unit
           ${MOVEMENT_FROM}
           LEFT JOIN inventory_schema.stock_documents r ON r.id = d.reverses_document_id
           ${where}
          ORDER BY t.created_at, t.id
          LIMIT $${limit} OFFSET $${limit + 1}`,
        [...where.params, paging.limit, paging.offset],
      ),
      pool.query<Row>(`SELECT count(*)::int AS total ${MOVEMENT_FROM} ${where}`, where.params),
    ]);
    return {
      rows: page.rows.map((row) => ({
        transactionId: str(row.id),
        transactionCode: str(row.transaction_code),
        postedAt: iso(row.created_at),
        ledgerType: str(row.type) as TransactionType,
        isReversal: row.is_reversal === true,
        documentId: opt(row.document_id),
        documentCode: opt(row.document_code),
        docType: opt(row.doc_type) as StockDocumentType | undefined,
        reversesDocumentCode: opt(row.reverses_code),
        warehouseCode: str(row.warehouse_code),
        warehouseName: str(row.warehouse_name),
        materialCode: str(row.material_code),
        materialName: str(row.material_name),
        unit: opt(row.unit),
        quantity: num(row.quantity),
        unitCost: num(row.unit_cost),
        value: num(row.value),
        createdBy: str(row.created_by),
        note: opt(row.note),
      })),
      total: num(count.rows[0]?.total),
    };
  }

  async approvals(
    tenantId: string,
    filter: StockApprovalFilter,
    paging: ReportPaging,
  ): Promise<{ rows: StockApprovalReportRow[]; total: number }> {
    const pool = await this.poolFor(tenantId);
    const where = new Where();
    where.add(`d.doc_type = ANY(${where.param(filter.docTypes)}::text[])`);
    where.add(`d.document_date BETWEEN ${where.param(filter.fromDate)}::date AND ${where.param(filter.toDate)}::date`);
    if (filter.warehouseCode) where.add(`w.code = ${where.param(filter.warehouseCode)}`);
    if (filter.status) where.add(`d.status = ${where.param(filter.status)}`);
    const from = `
      FROM inventory_schema.stock_documents d
      JOIN inventory_schema.warehouses w ON w.id = d.warehouse_id`;
    const limit = where.params.length + 1;
    const [page, count] = await Promise.all([
      pool.query<Row>(
        `SELECT d.id, d.code, d.doc_type, d.status, d.document_date::text AS document_date, d.note,
                d.reject_reason, d.created_by, d.created_at, d.submitted_by, d.submitted_at,
                d.approved_by, d.approved_at, d.rejected_by, d.rejected_at, d.posted_by, d.posted_at,
                w.code AS warehouse_code, w.name AS warehouse_name,
                lines.line_count, lines.quantity_in, lines.quantity_out, lines.value
           ${from}
           CROSS JOIN LATERAL (
             SELECT count(*)::int AS line_count,
                    COALESCE(sum(l.quantity) FILTER (WHERE l.direction = 'IN'), 0) AS quantity_in,
                    COALESCE(sum(l.quantity) FILTER (WHERE l.direction = 'OUT'), 0) AS quantity_out,
                    COALESCE(sum(l.cost_amount), 0) AS value
               FROM inventory_schema.stock_document_lines l
              WHERE l.document_id = d.id
           ) lines
           ${where}
          ORDER BY d.document_date DESC, d.created_at DESC
          LIMIT $${limit} OFFSET $${limit + 1}`,
        [...where.params, paging.limit, paging.offset],
      ),
      pool.query<Row>(`SELECT count(*)::int AS total ${from} ${where}`, where.params),
    ]);
    return {
      rows: page.rows.map((row) => ({
        documentId: str(row.id),
        documentCode: str(row.code),
        docType: str(row.doc_type) as StockDocumentType,
        status: str(row.status) as StockDocumentStatus,
        documentDate: str(row.document_date),
        warehouseCode: str(row.warehouse_code),
        warehouseName: str(row.warehouse_name),
        reason: opt(row.note),
        rejectReason: opt(row.reject_reason),
        createdBy: str(row.created_by),
        createdAt: iso(row.created_at),
        submittedBy: opt(row.submitted_by),
        submittedAt: isoOpt(row.submitted_at),
        approvedBy: opt(row.approved_by),
        approvedAt: isoOpt(row.approved_at),
        rejectedBy: opt(row.rejected_by),
        rejectedAt: isoOpt(row.rejected_at),
        postedBy: opt(row.posted_by),
        postedAt: isoOpt(row.posted_at),
        lineCount: num(row.line_count),
        quantityIn: num(row.quantity_in),
        quantityOut: num(row.quantity_out),
        value: num(row.value),
      })),
      total: num(count.rows[0]?.total),
    };
  }
}

function materialColumns(row: Row) {
  return {
    materialId: str(row.material_id),
    materialCode: str(row.material_code),
    materialName: str(row.material_name),
    unit: opt(row.unit),
    category: opt(row.category) as MaterialCategory | undefined,
  };
}

function summaryQuantities(row: Row): StockReportTotals {
  return {
    onHand: num(row.quantity),
    reserved: num(row.reserved),
    blocked: num(row.blocked),
    available: num(row.available),
  };
}
