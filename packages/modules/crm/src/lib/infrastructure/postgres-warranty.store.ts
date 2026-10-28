import {
  DEFAULT_WARRANTY_DEFECT_WAREHOUSE,
  DEFAULT_WARRANTY_QUARANTINE_WAREHOUSE,
  DEFAULT_WARRANTY_RESTOCK_WAREHOUSE,
  WARRANTY_STATUS_LABELS,
  type CrmPage,
  type WarrantyCaseDetail,
  type WarrantyCaseLine,
  type WarrantyCaseSummary,
  type WarrantyCause,
  type WarrantyDisposition,
  type WarrantyDocument,
  type WarrantyDocumentKind,
  type WarrantyDocumentStatus,
  type WarrantyInspectionResult,
  type WarrantyRemedy,
  type WarrantySettings,
  type WarrantySource,
  type WarrantyStatus,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import {
  WARRANTY_AUDIT_ENTITY,
  type DeliveredItemRecord,
  type NewWarrantyCaseRecord,
  type WarrantyCaseFilter,
  type WarrantyDocumentRecord,
  type WarrantyResolutionRecord,
  type WarrantyStore,
} from '../application/warranty.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { assertClosable, assertWarrantyTransition, formatWarrantyCode, isLineResolved } from '../domain/warranty-case.js';
import { computeWarranty } from '../domain/warranty-period.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { readHistory } from './postgres-contract.store.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toDateOnly, toIso, toNumber } from './sql-helpers.js';

/** Khoá cấu hình kho cách ly, kho lỗi (giá trị `{ "code": "..." }`). */
export const WARRANTY_QUARANTINE_SETTING_KEY = 'warranty.quarantineWarehouseCode';
export const WARRANTY_DEFECT_SETTING_KEY = 'warranty.defectWarehouseCode';
export const WARRANTY_RESTOCK_SETTING_KEY = 'warranty.restockWarehouseCode';

const STALE = () =>
  new CrmConflictError('STALE_VERSION', 'Yêu cầu bảo hành vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

// ---------------------------------------------------------------------------
// Serial, dòng đơn đã giao
// ---------------------------------------------------------------------------

interface DeliveredRow {
  serial: string | null;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  quantity: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  owner_user_id: string;
  order_id: string | null;
  order_code: string | null;
  order_line_id: string | null;
  order_line_quantity: string | null;
  order_line_total: string | null;
  contract_id: string | null;
  contract_code: string | null;
  contract_warranty_months: number | null;
  delivery_code: string | null;
  warehouse_code: string | null;
  delivered_at: Date | null;
  replacement_case_id: string | null;
  replacement_case_code: string | null;
  replacement_serial: string | null;
  replacement_until: string | null;
}

/** Cột chung của serial đã giao theo đợt giao (bí danh: o đơn, l dòng đơn, d đợt, c khách, k hợp đồng). */
const ORDER_ITEM_COLUMNS = `l.material_id, l.material_code, l.material_name, l.unit,
  o.customer_id, c.code AS customer_code, c.name AS customer_name, o.owner_user_id,
  o.id AS order_id, o.code AS order_code, l.id AS order_line_id, l.quantity AS order_line_quantity,
  l.line_total AS order_line_total, k.id AS contract_id, k.code AS contract_code, k.warranty_months AS contract_warranty_months`;

const ORDER_ITEM_JOINS = `JOIN crm_schema.sales_order_lines l ON l.id = dl.order_line_id
  JOIN crm_schema.sales_orders o ON o.id = l.order_id
  JOIN crm_schema.customers c ON c.id = o.customer_id
  LEFT JOIN crm_schema.contracts k ON k.id = o.contract_id`;

const NO_REPLACEMENT = `NULL::uuid AS replacement_case_id, NULL::varchar AS replacement_case_code,
  NULL::varchar AS replacement_serial, NULL::text AS replacement_until`;

/** Serial đã giao theo đợt giao (một dòng mỗi serial). */
const SERIAL_ITEMS = `SELECT s.serial, 1::numeric AS quantity, ${ORDER_ITEM_COLUMNS},
    d.code AS delivery_code, COALESCE(d.warehouse_code, o.warehouse_code) AS warehouse_code, d.issued_at AS delivered_at,
    ${NO_REPLACEMENT}
  FROM crm_schema.delivery_lines dl
  JOIN crm_schema.delivery_plans d ON d.id = dl.delivery_id
  ${ORDER_ITEM_JOINS}
  CROSS JOIN LATERAL unnest(dl.serials) AS s(serial)`;

/** Serial đã xuất thay thế theo yêu cầu bảo hành (Q9). */
const REPLACEMENT_ITEMS = `SELECT r.serial, 1::numeric AS quantity, wl.material_id, wl.material_code, wl.material_name, wl.unit,
    w.customer_id, c.code AS customer_code, c.name AS customer_name, w.owner_user_id,
    wl.order_id, so.code AS order_code, wl.order_line_id, sol.quantity AS order_line_quantity,
    sol.line_total AS order_line_total, k.id AS contract_id, k.code AS contract_code, k.warranty_months AS contract_warranty_months,
    NULL::varchar AS delivery_code, wl.replacement_warehouse_code AS warehouse_code, rd.posted_at AS delivered_at,
    w.id AS replacement_case_id, w.code AS replacement_case_code, wl.serial AS replacement_serial,
    wl.replacement_warranty_until::text AS replacement_until
  FROM crm_schema.warranty_case_lines wl
  JOIN crm_schema.warranty_cases w ON w.id = wl.case_id
  JOIN crm_schema.customers c ON c.id = w.customer_id
  LEFT JOIN crm_schema.sales_orders so ON so.id = wl.order_id
  LEFT JOIN crm_schema.sales_order_lines sol ON sol.id = wl.order_line_id
  LEFT JOIN crm_schema.contracts k ON k.id = so.contract_id
  LEFT JOIN crm_schema.warranty_documents rd ON rd.line_id = wl.id AND rd.kind = 'REPLACEMENT'
  CROSS JOIN LATERAL unnest(wl.replacement_serials) AS r(serial)`;

/** Dòng đơn không theo serial đã giao: số đã giao, ngày giao đầu tiên. */
const LINE_ITEMS = `SELECT NULL::varchar AS serial, l.delivered_quantity AS quantity, ${ORDER_ITEM_COLUMNS},
    NULL::varchar AS delivery_code,
    (SELECT COALESCE(d.warehouse_code, o.warehouse_code) FROM crm_schema.delivery_lines dl2
       JOIN crm_schema.delivery_plans d ON d.id = dl2.delivery_id
      WHERE dl2.order_line_id = l.id AND dl2.delivered_quantity > 0 ORDER BY d.issued_at LIMIT 1) AS warehouse_code,
    (SELECT min(d.issued_at) FROM crm_schema.delivery_lines dl2
       JOIN crm_schema.delivery_plans d ON d.id = dl2.delivery_id
      WHERE dl2.order_line_id = l.id AND dl2.delivered_quantity > 0) AS delivered_at,
    ${NO_REPLACEMENT}
  FROM crm_schema.sales_order_lines l
  JOIN crm_schema.sales_orders o ON o.id = l.order_id
  JOIN crm_schema.customers c ON c.id = o.customer_id
  LEFT JOIN crm_schema.contracts k ON k.id = o.contract_id`;

function toDelivered(row: DeliveredRow): DeliveredItemRecord {
  return {
    serial: row.serial,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    quantity: num(row.quantity),
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    ownerUserId: row.owner_user_id,
    orderId: row.order_id,
    orderCode: row.order_code,
    orderLineId: row.order_line_id,
    orderLineQuantity: toNumber(row.order_line_quantity),
    orderLineTotal: toNumber(row.order_line_total),
    contractId: row.contract_id,
    contractCode: row.contract_code,
    contractWarrantyMonths: row.contract_warranty_months === null ? null : Number(row.contract_warranty_months),
    deliveryCode: row.delivery_code,
    warehouseCode: row.warehouse_code,
    deliveredAt: toIso(row.delivered_at),
    replacementOf: row.replacement_case_id
      ? {
          caseId: row.replacement_case_id,
          caseCode: row.replacement_case_code ?? '',
          serial: row.replacement_serial,
          warrantyUntil: toDateOnly(row.replacement_until),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Yêu cầu bảo hành
// ---------------------------------------------------------------------------

interface CaseRow {
  id: string;
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  order_id: string | null;
  order_code: string | null;
  contract_id: string | null;
  cause: WarrantyCause;
  status: WarrantyStatus;
  chargeable: boolean;
  description: string | null;
  quarantine_warehouse_code: string | null;
  reject_reason: string | null;
  revision: number;
  owner_user_id: string;
  assignee_user_id: string | null;
  line_count: number;
  serials: string[] | null;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

const CASE_COLUMNS = `w.id, w.code, w.customer_id, c.code AS customer_code, c.name AS customer_name, w.order_id,
  so.code AS order_code, w.contract_id, w.cause, w.status, w.chargeable, w.description, w.quarantine_warehouse_code,
  w.reject_reason, w.revision, w.owner_user_id, w.assignee_user_id, w.created_at, w.updated_at,
  (SELECT count(*)::int FROM crm_schema.warranty_case_lines x WHERE x.case_id = w.id) AS line_count,
  ARRAY(SELECT x.serial FROM crm_schema.warranty_case_lines x WHERE x.case_id = w.id AND x.serial IS NOT NULL ORDER BY x.line_no) AS serials,
  ${cursorAt('w.updated_at')} AS cursor_at`;

const CASE_FROM = `FROM crm_schema.warranty_cases w
  JOIN crm_schema.customers c ON c.id = w.customer_id
  LEFT JOIN crm_schema.sales_orders so ON so.id = w.order_id`;

function toSummary(row: CaseRow): WarrantyCaseSummary {
  return {
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    orderId: row.order_id,
    orderCode: row.order_code,
    cause: row.cause,
    status: row.status,
    chargeable: row.chargeable,
    lineCount: Number(row.line_count),
    serials: row.serials ?? [],
    ownerUserId: row.owner_user_id,
    assigneeUserId: row.assignee_user_id,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

interface LineRow {
  id: string;
  line_no: number;
  serial: string | null;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  quantity: string;
  order_id: string | null;
  order_code: string | null;
  order_line_id: string | null;
  delivery_warehouse_code: string | null;
  delivered_on: string | null;
  warranty_months: number | null;
  warranty_source: WarrantySource;
  warranty_until: string | null;
  chargeable: boolean;
  received_at: Date | null;
  received_lot_id: string | null;
  received_lot_no: string | null;
  inspection_result: WarrantyInspectionResult | null;
  inspection_note: string | null;
  inspected_at: Date | null;
  inspected_by: string | null;
  disposition: WarrantyDisposition | null;
  remedy: WarrantyRemedy | null;
  resolution_note: string | null;
  resolved_at: Date | null;
  replacement_warehouse_code: string | null;
  replacement_serials: string[] | null;
  replacement_warranty_until: string | null;
  credit_amount: string | null;
}

interface DocumentRow {
  id: string;
  line_id: string | null;
  kind: WarrantyDocumentKind;
  status: WarrantyDocumentStatus;
  document_id: string | null;
  document_code: string | null;
  amount: string | null;
  last_error: string | null;
  created_at: Date;
  posted_at: Date | null;
}

function toLine(row: LineRow, today: string): WarrantyCaseLine {
  // Hạn chụp lúc tiếp nhận; còn lại tính theo hôm nay để màn hình luôn đúng.
  const until = toDateOnly(row.warranty_until);
  const coverage = computeWarranty({
    deliveredOn: toDateOnly(row.delivered_on),
    contractMonths: null,
    materialMonths: null,
    inheritedUntil: until,
    today,
  });
  return {
    id: row.id,
    lineNo: Number(row.line_no),
    serial: row.serial,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    quantity: num(row.quantity),
    orderId: row.order_id,
    orderCode: row.order_code,
    orderLineId: row.order_line_id,
    coverage: { ...coverage, months: row.warranty_months, source: row.warranty_source },
    chargeable: row.chargeable,
    receivedAt: toIso(row.received_at),
    receivedLotId: row.received_lot_id,
    receivedLotNo: row.received_lot_no,
    deliveryWarehouseCode: row.delivery_warehouse_code,
    inspectionResult: row.inspection_result,
    inspectionNote: row.inspection_note,
    inspectedAt: toIso(row.inspected_at),
    inspectedBy: row.inspected_by,
    disposition: row.disposition,
    remedy: row.remedy,
    resolutionNote: row.resolution_note,
    resolvedAt: toIso(row.resolved_at),
    replacementWarehouseCode: row.replacement_warehouse_code,
    replacementSerials: row.replacement_serials ?? [],
    replacementWarrantyUntil: toDateOnly(row.replacement_warranty_until),
    creditAmount: toNumber(row.credit_amount),
  };
}

function toDocument(row: DocumentRow): WarrantyDocument {
  return {
    id: row.id,
    lineId: row.line_id,
    kind: row.kind,
    status: row.status,
    documentId: row.document_id,
    documentCode: row.document_code,
    amount: toNumber(row.amount),
    lastError: row.last_error,
    createdAt: toIso(row.created_at) ?? '',
    postedAt: toIso(row.posted_at),
  };
}

/** Ngày hôm nay theo giờ Việt Nam. */
function vietnamToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface LockedCase {
  readonly code: string;
  readonly status: WarrantyStatus;
  readonly revision: number;
}

/** Khoá yêu cầu; `revision` khác bản người dùng đang sửa thì 409. */
export async function lockWarrantyCase(client: CrmSqlClient, id: string, revision: number | null): Promise<LockedCase> {
  const result = await client.query<{ code: string; status: WarrantyStatus; revision: number }>(
    `SELECT code, status, revision FROM crm_schema.warranty_cases WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw STALE();
  if (revision !== null && row.revision !== revision) throw STALE();
  return { code: row.code, status: row.status, revision: row.revision };
}

/** Chuyển trạng thái kèm nhật ký; tăng `revision`. */
export async function transitionWarrantyCase(
  client: CrmSqlClient,
  id: string,
  from: WarrantyStatus,
  to: WarrantyStatus,
  entry: { readonly action: string; readonly actorId: string | null; readonly reason?: string | null; readonly metadata?: Record<string, unknown> },
  extraSet = '',
): Promise<void> {
  assertWarrantyTransition(from, to);
  await client.query(
    `UPDATE crm_schema.warranty_cases
        SET status = $2, revision = revision + 1, updated_at = now(), updated_by = COALESCE($3, updated_by)${extraSet ? `, ${extraSet}` : ''}
      WHERE id = $1`,
    [id, to, entry.actorId],
  );
  await writeAuditLog(client, {
    entityType: WARRANTY_AUDIT_ENTITY,
    entityId: id,
    fromStatus: from,
    toStatus: to,
    action: entry.action,
    actorId: entry.actorId,
    reason: entry.reason ?? null,
    metadata: entry.metadata,
  });
}

async function bumpCase(client: CrmSqlClient, id: string, actorId: string | null): Promise<void> {
  await client.query(
    `UPDATE crm_schema.warranty_cases SET revision = revision + 1, updated_at = now(), updated_by = COALESCE($2, updated_by) WHERE id = $1`,
    [id, actorId],
  );
}

/** Ghi (hoặc cập nhật theo khoá chống lặp) một chứng từ; đã ghi sổ thì chỉ lùi khi Kho đảo. */
export async function upsertWarrantyDocument(client: CrmSqlClient, caseId: string, record: WarrantyDocumentRecord): Promise<void> {
  await client.query(
    `INSERT INTO crm_schema.warranty_documents
       (case_id, line_id, kind, idempotency_key, status, document_id, document_code, amount, payload, last_error, posted_at)
     VALUES ($1, $2, $3, $4, $5::varchar, $6, $7, $8, $9::jsonb, $10, CASE WHEN $5::varchar = 'POSTED' THEN now() END)
     ON CONFLICT (idempotency_key) DO UPDATE
       SET status = CASE WHEN crm_schema.warranty_documents.status = 'POSTED' AND EXCLUDED.status <> 'REVERSED'
                         THEN crm_schema.warranty_documents.status ELSE EXCLUDED.status END,
           document_id = COALESCE(EXCLUDED.document_id, crm_schema.warranty_documents.document_id),
           document_code = COALESCE(EXCLUDED.document_code, crm_schema.warranty_documents.document_code),
           amount = COALESCE(EXCLUDED.amount, crm_schema.warranty_documents.amount),
           payload = crm_schema.warranty_documents.payload || EXCLUDED.payload,
           last_error = CASE WHEN crm_schema.warranty_documents.status = 'POSTED' THEN NULL ELSE EXCLUDED.last_error END,
           posted_at = COALESCE(crm_schema.warranty_documents.posted_at, EXCLUDED.posted_at),
           updated_at = now()`,
    [
      caseId,
      record.lineId,
      record.kind,
      record.idempotencyKey,
      record.status,
      record.documentId ?? null,
      record.documentCode ?? null,
      record.amount ?? null,
      JSON.stringify(record.payload ?? {}),
      record.lastError ?? null,
    ],
  );
}

/**
 * Yêu cầu bảo hành trong Postgres (GĐ6). Đọc lọc theo người phụ trách hoặc
 * người xử lý yêu cầu; serial đã giao lọc theo người phụ trách đơn. Mọi chuyển
 * trạng thái ghi `audit_log` trong cùng transaction.
 */
export class PostgresWarrantyStore implements WarrantyStore {
  constructor(private readonly database: CrmDatabase) {}

  async serialDeliveries(tenantId: string, scope: CrmDataScope, serial: string): Promise<DeliveredItemRecord[]> {
    const orders = new SqlConditions();
    const key = orders.param(serial.toUpperCase());
    orders.add(`upper(s.serial) = ${key}`);
    orders.scope(scope, 'o.owner_user_id');
    const replacements = new SqlConditions(orders.params);
    replacements.add(`upper(r.serial) = ${key}`);
    replacements.scope(scope, 'w.owner_user_id', 'w.assignee_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DeliveredRow>(
      `SELECT * FROM (${SERIAL_ITEMS} ${orders.where()}
        UNION ALL ${REPLACEMENT_ITEMS} ${replacements.where()}) t
        ORDER BY t.delivered_at DESC NULLS LAST
        LIMIT 20`,
      orders.params,
    );
    return result.rows.map(toDelivered);
  }

  async deliveredItems(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly orderId?: string; readonly customerId?: string },
    limit: number,
  ): Promise<DeliveredItemRecord[]> {
    // Hai nhánh (serial, dòng không theo serial) dùng chung điều kiện và tham số.
    const params = new SqlConditions();
    const conditions: string[] = [];
    if (filter.orderId) conditions.push(`o.id = ${params.param(filter.orderId)}::uuid`);
    if (filter.customerId) conditions.push(`o.customer_id = ${params.param(filter.customerId)}::uuid`);
    if (scope.kind !== 'all') conditions.push(`o.owner_user_id = ANY(${params.param([...scope.userIds])}::uuid[])`);
    const base = conditions.length ? conditions.join(' AND ') : 'TRUE';
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DeliveredRow>(
      `SELECT * FROM (
         ${SERIAL_ITEMS} WHERE ${base}
         UNION ALL
         ${LINE_ITEMS} WHERE ${base} AND l.material_kind <> 'SERVICE' AND l.delivered_quantity > 0 AND cardinality(l.serials) = 0
       ) t
        ORDER BY t.delivered_at DESC NULLS LAST, t.order_code, t.serial
        LIMIT ${params.param(limit)}`,
      params.params,
    );
    return result.rows.map(toDelivered);
  }

  async deliveryItem(
    tenantId: string,
    scope: CrmDataScope,
    deliveryId: string,
    materialId: string,
    serial: string,
  ): Promise<DeliveredItemRecord | undefined> {
    const where = new SqlConditions();
    const value = where.param(serial);
    where.add(`dl.delivery_id = ${where.param(deliveryId)}::uuid`);
    where.add(`l.material_id = ${where.param(materialId)}::uuid`);
    where.scope(scope, 'o.owner_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DeliveredRow>(
      `SELECT ${value}::varchar AS serial, 1::numeric AS quantity, ${ORDER_ITEM_COLUMNS},
              d.code AS delivery_code, COALESCE(d.warehouse_code, o.warehouse_code) AS warehouse_code, d.issued_at AS delivered_at,
              ${NO_REPLACEMENT}
         FROM crm_schema.delivery_lines dl
         JOIN crm_schema.delivery_plans d ON d.id = dl.delivery_id
         ${ORDER_ITEM_JOINS}
         ${where.where()}
        ORDER BY l.line_no LIMIT 1`,
      where.params,
    );
    return result.rows[0] ? toDelivered(result.rows[0]) : undefined;
  }

  async orderLineValue(tenantId: string, orderLineId: string): Promise<{ quantity: number; lineTotal: number } | undefined> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ quantity: string; line_total: string }>(
      `SELECT quantity, line_total FROM crm_schema.sales_order_lines WHERE id = $1`,
      [orderLineId],
    );
    const row = result.rows[0];
    return row ? { quantity: num(row.quantity), lineTotal: num(row.line_total) } : undefined;
  }

  async orderLineDelivery(tenantId: string, scope: CrmDataScope, orderLineId: string): Promise<DeliveredItemRecord | undefined> {
    const where = new SqlConditions();
    where.add(`l.id = ${where.param(orderLineId)}::uuid`);
    where.add(`l.material_kind <> 'SERVICE' AND l.delivered_quantity > 0 AND cardinality(l.serials) = 0`);
    where.scope(scope, 'o.owner_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DeliveredRow>(`${LINE_ITEMS} ${where.where()}`, where.params);
    return result.rows[0] ? toDelivered(result.rows[0]) : undefined;
  }

  async openCasesBySerial(tenantId: string, serials: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (!serials.length) return new Map();
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ serial: string; case_id: string }>(
      `SELECT DISTINCT ON (upper(wl.serial)) upper(wl.serial) AS serial, w.id AS case_id
         FROM crm_schema.warranty_case_lines wl
         JOIN crm_schema.warranty_cases w ON w.id = wl.case_id
        WHERE wl.serial IS NOT NULL AND upper(wl.serial) = ANY($1::text[]) AND w.status NOT IN ('CLOSED', 'REJECTED')
        ORDER BY upper(wl.serial), w.created_at DESC`,
      [serials.map((serial) => serial.toUpperCase())],
    );
    return new Map(result.rows.map((row) => [row.serial, row.case_id]));
  }

  async listCases(tenantId: string, scope: CrmDataScope, filter: WarrantyCaseFilter): Promise<CrmPage<WarrantyCaseSummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'w.owner_user_id', 'w.assignee_user_id');
    if (filter.status) where.add(`w.status = ${where.param(filter.status)}`);
    if (filter.customerId) where.add(`w.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.serial) {
      const serial = where.param(filter.serial.toUpperCase());
      where.add(
        `EXISTS (SELECT 1 FROM crm_schema.warranty_case_lines x
                  WHERE x.case_id = w.id AND (upper(x.serial) = ${serial} OR ${serial} = ANY(SELECT upper(v) FROM unnest(x.replacement_serials) v)))`,
      );
    }
    if (filter.q) {
      const pattern = where.param(prefixPattern(filter.q.toUpperCase()));
      const tsQuery = prefixTsQuery(filter.q);
      where.add(
        `(w.code ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM crm_schema.warranty_case_lines x WHERE x.case_id = w.id AND upper(x.serial) LIKE ${pattern})
          ${tsQuery ? `OR to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)})` : ''})`,
      );
    }
    where.after(filter.cursor, 'w.updated_at', 'w.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<CaseRow>(
      `SELECT ${CASE_COLUMNS} ${CASE_FROM} ${where.where()}
        ORDER BY w.updated_at DESC, w.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async getCase(tenantId: string, scope: CrmDataScope, id: string): Promise<WarrantyCaseDetail | undefined> {
    const where = new SqlConditions();
    where.add(`w.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'w.owner_user_id', 'w.assignee_user_id');
    const pool = await this.database.pool(tenantId);
    const head = (await pool.query<CaseRow>(`SELECT ${CASE_COLUMNS} ${CASE_FROM} ${where.where()}`, where.params)).rows[0];
    if (!head) return undefined;
    const [lines, documents, history] = await Promise.all([
      pool.query<LineRow>(
        `SELECT wl.*, wl.delivered_on::text AS delivered_on, wl.warranty_until::text AS warranty_until,
                wl.replacement_warranty_until::text AS replacement_warranty_until, so.code AS order_code
           FROM crm_schema.warranty_case_lines wl
           LEFT JOIN crm_schema.sales_orders so ON so.id = wl.order_id
          WHERE wl.case_id = $1 ORDER BY wl.line_no`,
        [id],
      ),
      pool.query<DocumentRow>(
        `SELECT id, line_id, kind, status, document_id, document_code, amount, last_error, created_at, posted_at
           FROM crm_schema.warranty_documents WHERE case_id = $1 ORDER BY created_at, id`,
        [id],
      ),
      readHistory(pool, WARRANTY_AUDIT_ENTITY, id),
    ]);
    const today = vietnamToday();
    return {
      ...toSummary(head),
      description: head.description,
      contractId: head.contract_id,
      quarantineWarehouseCode: head.quarantine_warehouse_code,
      rejectReason: head.reject_reason,
      revision: Number(head.revision),
      lines: lines.rows.map((row) => toLine(row, today)),
      documents: documents.rows.map(toDocument),
      history,
    };
  }

  async createCase(tenantId: string, record: NewWarrantyCaseRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, async (client) => {
      const serials = [...new Set(record.lines.flatMap((line) => (line.serial ? [line.serial.toUpperCase()] : [])))].sort();
      // Khoá theo serial để hai người tiếp nhận cùng serial không cùng tạo được yêu cầu mở.
      for (const serial of serials) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`crm-warranty-serial:${serial}`]);
      }
      if (serials.length) {
        const open = await client.query<{ serial: string }>(
          `SELECT upper(wl.serial) AS serial FROM crm_schema.warranty_case_lines wl
             JOIN crm_schema.warranty_cases w ON w.id = wl.case_id
            WHERE upper(wl.serial) = ANY($1::text[]) AND w.status NOT IN ('CLOSED', 'REJECTED')`,
          [serials],
        );
        if (open.rows.length) {
          throw new CrmConflictError(
            'SERIAL_HAS_OPEN_CASE',
            `Serial ${[...new Set(open.rows.map((row) => row.serial))].join(', ')} đang có yêu cầu bảo hành chưa đóng.`,
          );
        }
      }
      const sequence = await client.query<{ value: string; year: number }>(
        `SELECT nextval('crm_schema.warranty_case_code_seq')::text AS value,
                EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS year`,
      );
      const code = formatWarrantyCode(Number(sequence.rows[0].year), Number(sequence.rows[0].value));
      const chargeable = record.lines.some((line) => line.coverage.expired);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.warranty_cases
           (code, customer_id, order_id, contract_id, cause, description, chargeable, owner_user_id, assignee_user_id,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id`,
        [
          code,
          record.customerId,
          record.orderId,
          record.contractId,
          record.cause,
          record.description,
          chargeable,
          record.ownerUserId,
          record.assigneeUserId,
          actorId,
        ],
      );
      const id = inserted.rows[0].id;
      for (const [index, line] of record.lines.entries()) {
        await client.query(
          `INSERT INTO crm_schema.warranty_case_lines
             (case_id, line_no, serial, material_id, material_code, material_name, unit, quantity, order_id, order_line_id,
              delivery_warehouse_code, delivered_on, warranty_months, warranty_source, warranty_until, chargeable)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            id,
            index + 1,
            line.serial,
            line.materialId,
            line.materialCode,
            line.materialName,
            line.unit,
            line.quantity,
            line.orderId,
            line.orderLineId,
            line.deliveryWarehouseCode,
            line.coverage.deliveredOn,
            line.coverage.months,
            line.coverage.source,
            line.coverage.warrantyUntil,
            line.coverage.expired,
          ],
        );
      }
      await writeAuditLog(client, {
        entityType: WARRANTY_AUDIT_ENTITY,
        entityId: id,
        fromStatus: null,
        toStatus: 'RECEIVED',
        action: 'create',
        actorId,
        metadata: { code, cause: record.cause, chargeable, serials },
      });
      return id;
    });
  }

  async reject(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, id, revision);
      assertWarrantyTransition(locked.status, 'REJECTED');
      await client.query(`UPDATE crm_schema.warranty_cases SET reject_reason = $2 WHERE id = $1`, [id, reason]);
      await transitionWarrantyCase(client, id, locked.status, 'REJECTED', { action: 'reject', actorId, reason });
    });
  }

  async requestGoods(tenantId: string, id: string, revision: number, warehouseCode: string, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, id, null);
      const current = await client.query<{ quarantine_warehouse_code: string | null }>(
        `SELECT quarantine_warehouse_code FROM crm_schema.warranty_cases WHERE id = $1`,
        [id],
      );
      // Gửi lại sau lỗi: giữ kho đã chụp để Kho nhận đúng nội dung theo khoá chống lặp.
      if (locked.status === 'AWAITING_GOODS') return current.rows[0]?.quarantine_warehouse_code ?? warehouseCode;
      if (locked.revision !== revision) throw STALE();
      await client.query(
        `UPDATE crm_schema.warranty_cases SET quarantine_warehouse_code = $2, goods_requested_at = now() WHERE id = $1`,
        [id, warehouseCode],
      );
      await transitionWarrantyCase(client, id, locked.status, 'AWAITING_GOODS', {
        action: 'request-goods',
        actorId,
        metadata: { warehouseCode },
      });
      return warehouseCode;
    });
  }

  async saveDocument(tenantId: string, caseId: string, record: WarrantyDocumentRecord): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      await upsertWarrantyDocument(client, caseId, record);
      await client.query(`UPDATE crm_schema.warranty_cases SET updated_at = now() WHERE id = $1`, [caseId]);
    });
  }

  async inspectLine(
    tenantId: string,
    caseId: string,
    revision: number,
    lineId: string,
    result: WarrantyInspectionResult,
    note: string | null,
    actorId: string,
  ): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, caseId, revision);
      if (locked.status !== 'INSPECTING') {
        throw new CrmConflictError(
          'NOT_INSPECTING',
          `Yêu cầu đang ở trạng thái "${WARRANTY_STATUS_LABELS[locked.status]}"; chỉ ghi kết quả kiểm định khi Đang kiểm định.`,
        );
      }
      const updated = await client.query(
        `UPDATE crm_schema.warranty_case_lines
            SET inspection_result = $3, inspection_note = $4, inspected_at = now(), inspected_by = $5
          WHERE id = $2 AND case_id = $1
          RETURNING id`,
        [caseId, lineId, result, note, actorId],
      );
      if (!updated.rows.length) throw STALE();
      const pending = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM crm_schema.warranty_case_lines WHERE case_id = $1 AND inspection_result IS NULL`,
        [caseId],
      );
      const line = (
        await client.query<{ line_no: number; serial: string | null }>(
          `SELECT line_no, serial FROM crm_schema.warranty_case_lines WHERE id = $1`,
          [lineId],
        )
      ).rows[0];
      const metadata = { lineNo: line?.line_no, serial: line?.serial ?? null, result };
      if (Number(pending.rows[0]?.n ?? 0) === 0) {
        await transitionWarrantyCase(client, caseId, locked.status, 'RESOLVING', { action: 'inspect', actorId, reason: note, metadata });
        return;
      }
      await bumpCase(client, caseId, actorId);
      await writeAuditLog(client, { entityType: WARRANTY_AUDIT_ENTITY, entityId: caseId, action: 'inspect', actorId, reason: note, metadata });
    });
  }

  async saveResolution(
    tenantId: string,
    caseId: string,
    revision: number,
    lineId: string,
    resolution: WarrantyResolutionRecord,
    actorId: string,
  ): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, caseId, revision);
      if (locked.status !== 'RESOLVING') {
        throw new CrmConflictError('NOT_RESOLVING', 'Chỉ chọn hướng xử lý khi yêu cầu đang ở bước Đang xử lý.');
      }
      const current = (
        await client.query<{ line_no: number; serial: string | null; disposition: string | null; remedy: string | null }>(
          `SELECT line_no, serial, disposition, remedy FROM crm_schema.warranty_case_lines WHERE id = $1 AND case_id = $2 FOR UPDATE`,
          [lineId, caseId],
        )
      ).rows[0];
      if (!current) throw STALE();
      if (current.disposition) {
        if (current.disposition === resolution.disposition && current.remedy === resolution.remedy) return;
        throw new CrmConflictError('LINE_ALREADY_RESOLVED', 'Dòng đã chốt hướng xử lý khác; không đổi được sau khi đã sinh chứng từ.');
      }
      await client.query(
        `UPDATE crm_schema.warranty_case_lines
            SET disposition = $3, remedy = $4, resolution_note = $5, replacement_warehouse_code = $6, credit_amount = $7,
                resolved_at = now(), resolved_by = $8
          WHERE id = $2 AND case_id = $1`,
        [
          caseId,
          lineId,
          resolution.disposition,
          resolution.remedy,
          resolution.note,
          resolution.replacementWarehouseCode,
          resolution.creditAmount,
          actorId,
        ],
      );
      await bumpCase(client, caseId, actorId);
      await writeAuditLog(client, {
        entityType: WARRANTY_AUDIT_ENTITY,
        entityId: caseId,
        action: 'resolve-line',
        actorId,
        reason: resolution.note,
        metadata: {
          lineNo: current.line_no,
          serial: current.serial,
          disposition: resolution.disposition,
          remedy: resolution.remedy,
          creditAmount: resolution.creditAmount,
        },
      });
    });
  }

  async completeResolution(tenantId: string, caseId: string, actorId: string): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, caseId, null);
      if (locked.status !== 'RESOLVING') return false;
      const { lines, documents } = await readResolution(client, caseId);
      const done = lines.every((line) => isLineResolved(line, documents.filter((document) => document.lineId === line.id)));
      if (!done) return false;
      await transitionWarrantyCase(client, caseId, locked.status, 'RESOLVED', { action: 'resolve', actorId }, 'resolved_at = now()');
      return true;
    });
  }

  async close(tenantId: string, caseId: string, revision: number, actorId: string): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      const locked = await lockWarrantyCase(client, caseId, revision);
      const { lines, documents } = await readResolution(client, caseId);
      assertClosable(locked.status, lines, documents);
      await transitionWarrantyCase(client, caseId, locked.status, 'CLOSED', { action: 'close', actorId }, 'closed_at = now()');
    });
  }

  async serialCases(
    tenantId: string,
    scope: CrmDataScope,
    serial: string,
  ): Promise<{ caseId: string; caseCode: string; status: WarrantyStatus; role: 'ORIGINAL' | 'REPLACEMENT'; at: string }[]> {
    const where = new SqlConditions();
    const key = where.param(serial.toUpperCase());
    where.add(`(upper(wl.serial) = ${key} OR ${key} = ANY(SELECT upper(v) FROM unnest(wl.replacement_serials) v))`);
    where.scope(scope, 'w.owner_user_id', 'w.assignee_user_id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string; code: string; status: WarrantyStatus; original: boolean; created_at: Date }>(
      `SELECT w.id, w.code, w.status, upper(wl.serial) IS NOT DISTINCT FROM ${key} AS original, w.created_at
         FROM crm_schema.warranty_case_lines wl
         JOIN crm_schema.warranty_cases w ON w.id = wl.case_id
         ${where.where()}
        ORDER BY w.created_at DESC
        LIMIT 50`,
      where.params,
    );
    return result.rows.map((row) => ({
      caseId: row.id,
      caseCode: row.code,
      status: row.status,
      role: row.original ? 'ORIGINAL' : 'REPLACEMENT',
      at: toIso(row.created_at) ?? '',
    }));
  }

  async settings(tenantId: string): Promise<WarrantySettings> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ key: string; value: { code?: unknown } | null }>(
      `SELECT key, value FROM crm_schema.settings WHERE key = ANY($1::text[])`,
      [[WARRANTY_QUARANTINE_SETTING_KEY, WARRANTY_DEFECT_SETTING_KEY, WARRANTY_RESTOCK_SETTING_KEY]],
    );
    const read = (key: string, fallback: string) => {
      const code = result.rows.find((row) => row.key === key)?.value?.code;
      return typeof code === 'string' && code.trim() ? code.trim() : fallback;
    };
    return {
      quarantineWarehouseCode: read(WARRANTY_QUARANTINE_SETTING_KEY, DEFAULT_WARRANTY_QUARANTINE_WAREHOUSE),
      defectWarehouseCode: read(WARRANTY_DEFECT_SETTING_KEY, DEFAULT_WARRANTY_DEFECT_WAREHOUSE),
      restockWarehouseCode: read(WARRANTY_RESTOCK_SETTING_KEY, DEFAULT_WARRANTY_RESTOCK_WAREHOUSE),
    };
  }

  async saveSettings(tenantId: string, settings: WarrantySettings, actorId: string): Promise<void> {
    await this.database.transaction(tenantId, async (client) => {
      for (const [key, code] of [
        [WARRANTY_QUARANTINE_SETTING_KEY, settings.quarantineWarehouseCode],
        [WARRANTY_DEFECT_SETTING_KEY, settings.defectWarehouseCode],
        [WARRANTY_RESTOCK_SETTING_KEY, settings.restockWarehouseCode],
      ] as const) {
        await client.query(
          `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, version = crm_schema.settings.version + 1,
                 updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify({ code }), actorId],
        );
      }
    });
  }
}

/** Dòng và chứng từ của yêu cầu (đã khoá) để kiểm xử lý xong, đóng được. */
async function readResolution(client: CrmSqlClient, caseId: string) {
  const lines = (
    await client.query<{
      id: string;
      disposition: WarrantyDisposition | null;
      remedy: WarrantyRemedy | null;
      inspection_result: WarrantyInspectionResult | null;
    }>(`SELECT id, disposition, remedy, inspection_result FROM crm_schema.warranty_case_lines WHERE case_id = $1`, [caseId])
  ).rows.map((row) => ({ id: row.id, disposition: row.disposition, remedy: row.remedy, inspectionResult: row.inspection_result }));
  const documents = (
    await client.query<{ line_id: string | null; kind: WarrantyDocumentKind; status: WarrantyDocumentStatus }>(
      `SELECT line_id, kind, status FROM crm_schema.warranty_documents WHERE case_id = $1`,
      [caseId],
    )
  ).rows.map((row) => ({ lineId: row.line_id, kind: row.kind, status: row.status }));
  return { lines, documents };
}
