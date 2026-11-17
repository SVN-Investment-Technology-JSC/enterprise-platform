import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type {
  StockDocumentStatus,
  StockMovementEntry,
  StockMovementKind,
} from '@enterprise-platform/contracts-inventory';
import type { Pool, QueryResultRow } from 'pg';
import type {
  MovementListFilter,
  MovementListResult,
  StockMovementStore,
} from '../application/stock-movement-store.port.js';
import { likePattern } from '../domain/stock-movement.js';

type Row = QueryResultRow;

/** Cùng quy tắc với `normalizeMovementSource`: chữ thường, trống thành `manual`. */
function sourceSql(column: string): string {
  return `COALESCE(NULLIF(lower(btrim(${column})), ''), 'manual')`;
}

/** Bút toán cũ không có máy trạng thái chứng từ: đã duyệt nghĩa là đã ghi sổ. */
const LEGACY_STATUS_SQL = `CASE COALESCE(t.workflow_status, 'APPROVED')
    WHEN 'APPROVED' THEN 'POSTED'
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'REJECTED' THEN 'REJECTED'
    ELSE 'CANCELLED'
  END`;

const VN_ZONE = `'Asia/Ho_Chi_Minh'`;

const DOCUMENT_FROM = `inventory_schema.stock_documents d
    JOIN inventory_schema.warehouses w ON w.id = d.warehouse_id
    LEFT JOIN inventory_schema.warehouses tw ON tw.id = d.target_warehouse_id`;

const LEGACY_FROM = `inventory_schema.inventory_transactions t
    JOIN inventory_schema.warehouses w ON w.id = t.warehouse_id
    JOIN inventory_schema.materials m ON m.id = t.material_id`;

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function opt(value: unknown): string | undefined {
  const text = str(value);
  return text ? text : undefined;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(str(value)).toISOString();
}

function mapEntry(row: Row): StockMovementEntry {
  return {
    kind: str(row.kind) as StockMovementKind,
    id: str(row.id),
    code: str(row.code),
    type: str(row.type),
    status: str(row.status) as StockDocumentStatus,
    warehouseCode: str(row.warehouse_code),
    targetWarehouseCode: opt(row.target_warehouse_code),
    occurredAt: iso(row.occurred_at),
    movementDate: str(row.movement_date),
    sourceType: str(row.source_type),
    sourceId: opt(row.source_id),
    lineCount: num(row.line_count),
    quantityTotal: num(row.quantity_total),
    materialCode: opt(row.material_code),
    materialName: opt(row.material_name),
    createdBy: str(row.created_by),
    note: opt(row.note),
  };
}

/**
 * Danh sách gộp trên Postgres: một câu `UNION ALL` hai nhánh, sắp xếp chung theo
 * thời điểm rồi mới cắt trang, nên trang nào cũng đúng thứ tự dù dòng đến từ
 * nguồn nào. Bộ lọc áp trong từng nhánh để mỗi nhánh dùng được chỉ mục của bảng
 * mình; mọi giá trị đi qua tham số, không nối chuỗi.
 */
export class PostgresStockMovementStore implements StockMovementStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  protected poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  async list(tenantId: string, filter: MovementListFilter): Promise<MovementListResult> {
    const pool = await this.poolFor(tenantId);
    const values: unknown[] = [];
    const param = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const documentWhere: string[] = ['TRUE'];
    // Chỉ bút toán chưa gắn chứng từ; bút toán có chứng từ đã hiện qua nhánh chứng từ.
    const legacyWhere: string[] = ['t.document_id IS NULL'];

    if (filter.kind === 'legacy') documentWhere.push('FALSE');
    if (filter.kind === 'document') legacyWhere.push('FALSE');
    if (filter.docType) {
      documentWhere.push(`d.doc_type = ${param(filter.docType)}`);
      legacyWhere.push('FALSE');
    }
    if (filter.status) {
      const status = param(filter.status);
      documentWhere.push(`d.status = ${status}`);
      legacyWhere.push(`(${LEGACY_STATUS_SQL}) = ${status}`);
    }
    if (filter.warehouseCode) {
      const code = param(filter.warehouseCode);
      documentWhere.push(`(w.code = ${code} OR tw.code = ${code})`);
      legacyWhere.push(`w.code = ${code}`);
    }
    if (filter.sourceType) {
      const source = param(filter.sourceType);
      documentWhere.push(`${sourceSql('d.source_type')} = ${source}`);
      legacyWhere.push(`${sourceSql('t.reference_type')} = ${source}`);
    }
    if (filter.fromDate) {
      const from = param(filter.fromDate);
      documentWhere.push(`d.document_date >= ${from}::date`);
      legacyWhere.push(`t.created_at >= (${from}::date)::timestamp AT TIME ZONE ${VN_ZONE}`);
    }
    if (filter.toDate) {
      const to = param(filter.toDate);
      documentWhere.push(`d.document_date <= ${to}::date`);
      legacyWhere.push(`t.created_at < (${to}::date + 1)::timestamp AT TIME ZONE ${VN_ZONE}`);
    }
    if (filter.search) {
      const pattern = param(likePattern(filter.search));
      documentWhere.push(
        `(d.code ILIKE ${pattern}
          OR EXISTS (
            SELECT 1
              FROM inventory_schema.stock_document_lines sl
              JOIN inventory_schema.materials sm ON sm.id = sl.material_id
             WHERE sl.document_id = d.id AND (sm.code ILIKE ${pattern} OR sm.name ILIKE ${pattern})
          ))`,
      );
      legacyWhere.push(
        `(t.transaction_code ILIKE ${pattern} OR m.code ILIKE ${pattern} OR m.name ILIKE ${pattern})`,
      );
    }

    const documentFilter = documentWhere.join(' AND ');
    const legacyFilter = legacyWhere.join(' AND ');

    const totalQuery = pool.query<Row>(
      `SELECT (SELECT count(*) FROM ${DOCUMENT_FROM} WHERE ${documentFilter})::int
            + (SELECT count(*) FROM ${LEGACY_FROM} WHERE ${legacyFilter})::int AS n`,
      // Chụp lại mảng: câu lấy trang bên dưới còn thêm tham số limit, offset.
      [...values],
    );

    // Cắt trang trước, rồi mới gom số dòng và mặt hàng đầu của các chứng từ trong trang.
    const pageQuery = pool.query<Row>(
      `SELECT p.kind, p.id, p.code, p.type, p.status, p.warehouse_code, p.target_warehouse_code,
              p.occurred_at, to_char(p.movement_date, 'YYYY-MM-DD') AS movement_date,
              p.source_type, p.source_id, p.created_by, p.note,
              COALESCE(agg.line_count, 1) AS line_count,
              COALESCE(agg.quantity_total, p.legacy_quantity, 0) AS quantity_total,
              COALESCE(agg.material_code, p.legacy_material_code) AS material_code,
              COALESCE(agg.material_name, p.legacy_material_name) AS material_name
         FROM (
           SELECT 'document'::text AS kind, d.id, d.code::text AS code, d.doc_type::text AS type,
                  d.status::text AS status, w.code::text AS warehouse_code,
                  tw.code::text AS target_warehouse_code,
                  COALESCE(d.posted_at, d.created_at) AS occurred_at,
                  d.document_date AS movement_date,
                  ${sourceSql('d.source_type')} AS source_type, d.source_id,
                  d.created_by, d.note,
                  NULL::numeric AS legacy_quantity,
                  NULL::text AS legacy_material_code, NULL::text AS legacy_material_name
             FROM ${DOCUMENT_FROM}
            WHERE ${documentFilter}
           UNION ALL
           SELECT 'legacy'::text, t.id, t.transaction_code::text, t.type::text,
                  (${LEGACY_STATUS_SQL})::text, w.code::text, NULL::text,
                  t.created_at,
                  (t.created_at AT TIME ZONE ${VN_ZONE})::date,
                  ${sourceSql('t.reference_type')}, t.reference_id,
                  t.created_by, t.note,
                  abs(t.quantity), m.code::text, m.name::text
             FROM ${LEGACY_FROM}
            WHERE ${legacyFilter}
            ORDER BY occurred_at DESC, id DESC
            LIMIT ${param(filter.limit)} OFFSET ${param(filter.offset)}
         ) p
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS line_count,
                  COALESCE(sum(l.quantity), 0) AS quantity_total,
                  (array_agg(lm.code ORDER BY l.line_no))[1] AS material_code,
                  (array_agg(lm.name ORDER BY l.line_no))[1] AS material_name
             FROM inventory_schema.stock_document_lines l
             JOIN inventory_schema.materials lm ON lm.id = l.material_id
            WHERE p.kind = 'document' AND l.document_id = p.id
         ) agg ON p.kind = 'document'
        ORDER BY p.occurred_at DESC, p.id DESC`,
      values,
    );

    const pendingValues: unknown[] = [];
    let pendingFilter = `d.status = 'PENDING'`;
    if (filter.warehouseCode) {
      pendingValues.push(filter.warehouseCode);
      pendingFilter += ` AND (w.code = $1 OR tw.code = $1)`;
    }
    const pendingQuery = pool.query<Row>(
      `SELECT count(*)::int AS n FROM ${DOCUMENT_FROM} WHERE ${pendingFilter}`,
      pendingValues,
    );

    const [total, page, pending] = await Promise.all([totalQuery, pageQuery, pendingQuery]);
    return {
      rows: page.rows.map(mapEntry),
      total: num(total.rows[0]?.n),
      pendingCount: num(pending.rows[0]?.n),
    };
  }
}
