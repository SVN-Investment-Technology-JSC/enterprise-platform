import {
  CRM_DELIVERY_LATE,
  SALES_ORDER_STATUS_LABELS,
  salesOrderDeepLink,
  type AppliedDiscountPolicy,
  type CrmDeliveryLatePayload,
  type CrmPage,
  type CrmReservationStatus,
  type DeliveryLine,
  type DeliveryPlan,
  type DeliveryStatus,
  type PriceSource,
  type ReservationSource,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SalesOrderSource,
  type SalesOrderStatus,
  type SalesOrderSummary,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import type { OrderBalanceReader } from '../application/fulfillment.port.js';
import type {
  DeliveryRecord,
  NewOrderRecord,
  OrderConfirmation,
  OrderHeaderRecord,
  OrderLineRecord,
  OrderTransition,
  SalesOrderFilter,
  SalesOrderStore,
} from '../application/sales-order-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { committedQuantity, round3 } from '../domain/delivery-plan.js';
import { formatDeliveryCode, formatOrderCode, isDeliveryLate, orderStatusAfterDelivery } from '../domain/sales-order.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { enqueueReservationRelease } from './integration-requests.js';
import { cancelPendingCreditRequests, PostgresCreditStore } from './postgres-credit.store.js';
import { deliveredSnapshot, recognizeOrderDelivery, vietnamDateOf } from './receivable-recognition.js';
import { recordSalesFacts, salesFactSnapshot } from './sales-facts.js';
import { readHistory } from './postgres-contract.store.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toDateOnly, toIso, toNumber } from './sql-helpers.js';

/** Thực thể ghi vào `audit_log`. */
export const SALES_ORDER_AUDIT_ENTITY = 'sales_order';

const STALE = () =>
  new CrmConflictError('STALE_VERSION', 'Đơn bán vừa được người khác cập nhật. Vui lòng tải lại rồi thao tác lại.');

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface HeadRow {
  id: string;
  code: string;
  source: SalesOrderSource;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  contract_id: string | null;
  contract_code: string | null;
  quote_id: string | null;
  quote_code: string | null;
  status: SalesOrderStatus;
  order_date: string;
  expected_delivery_date: string | null;
  total_amount: string;
  owner_user_id: string;
  late: boolean;
  warehouse_code: string | null;
  delivery_address: string | null;
  note: string | null;
  price_date: string | null;
  shipping_amount: string;
  shipping_vat_rate: string;
  gross_amount: string;
  discount_amount: string;
  net_amount: string;
  vat_amount: string;
  revision: number;
  reservation_expires_at: Date | null;
  cancel_reason: string | null;
  close_reason: string | null;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
  outstanding: string;
}

/** Cột đầu đơn; `$today` là tham số ngày hôm nay để tính cờ giao trễ. */
const headColumns = (today: string) => `
  o.id, o.code, o.source, o.customer_id, c.code AS customer_code, c.name AS customer_name, o.contract_id,
  k.code AS contract_code, o.quote_id, q.code AS quote_code, o.status, o.order_date::text AS order_date,
  o.expected_delivery_date::text AS expected_delivery_date, o.total_amount, o.owner_user_id,
  EXISTS (SELECT 1 FROM crm_schema.delivery_plans d
           WHERE d.order_id = o.id AND d.status IN ('PLANNED', 'REQUESTED') AND d.planned_date < ${today}::date) AS late,
  o.warehouse_code, o.delivery_address, o.note, o.price_date::text AS price_date, o.shipping_amount, o.shipping_vat_rate,
  o.gross_amount, o.discount_amount, o.net_amount, o.vat_amount, o.revision, o.reservation_expires_at, o.cancel_reason,
  o.close_reason, o.created_at, o.updated_at, ${cursorAt('o.updated_at')} AS cursor_at,
  (SELECT COALESCE(sum(e.amount), 0) FROM crm_schema.receivable_entries e WHERE e.order_id = o.id) AS outstanding`;

const HEAD_FROM = `
  FROM crm_schema.sales_orders o
  JOIN crm_schema.customers c ON c.id = o.customer_id
  LEFT JOIN crm_schema.contracts k ON k.id = o.contract_id
  LEFT JOIN crm_schema.quotes q ON q.id = o.quote_id`;

export class PostgresSalesOrderStore implements SalesOrderStore {
  constructor(
    private readonly database: CrmDatabase,
    private readonly balances: OrderBalanceReader,
  ) {}

  async listOrders(tenantId: string, scope: CrmDataScope, filter: SalesOrderFilter): Promise<CrmPage<SalesOrderSummary>> {
    const where = new SqlConditions();
    const today = where.param(filter.today);
    where.scope(scope, 'o.owner_user_id');
    if (filter.status) where.add(`o.status = ${where.param(filter.status)}`);
    if (filter.customerId) where.add(`o.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.contractId) where.add(`o.contract_id = ${where.param(filter.contractId)}::uuid`);
    if (filter.ownerUserId) where.add(`o.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.late) {
      where.add(
        `EXISTS (SELECT 1 FROM crm_schema.delivery_plans d
                  WHERE d.order_id = o.id AND d.status IN ('PLANNED', 'REQUESTED') AND d.planned_date < ${today}::date)`,
      );
    }
    if (filter.q) {
      const tsQuery = prefixTsQuery(filter.q);
      const code = `o.code ILIKE ${where.param(prefixPattern(filter.q.toUpperCase()))}`;
      where.add(
        tsQuery
          ? `(${code} OR to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)}))`
          : code,
      );
    }
    where.after(filter.cursor, 'o.updated_at', 'o.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<HeadRow>(
      `SELECT ${headColumns(today)} ${HEAD_FROM} ${where.where()}
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toSummary);
  }

  async getOrder(tenantId: string, scope: CrmDataScope, id: string, today: string): Promise<SalesOrderDetail | undefined> {
    const pool = await this.database.pool(tenantId);
    const where = new SqlConditions();
    const todayParam = where.param(today);
    where.add(`o.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'o.owner_user_id');
    const head = (await pool.query<HeadRow>(`SELECT ${headColumns(todayParam)} ${HEAD_FROM} ${where.where()}`, where.params)).rows[0];
    if (!head) return undefined;
    const [lines, deliveries, deliveryLines, history, receivable, creditRequest] = await Promise.all([
      pool.query<LineRow>(`SELECT * FROM crm_schema.sales_order_lines WHERE order_id = $1 ORDER BY line_no`, [id]),
      pool.query<DeliveryRow>(
        `SELECT id, code, seq, planned_date::text AS planned_date, warehouse_code, address, note, status, issue_document_id,
                issue_document_code, requested_at, issued_at
           FROM crm_schema.delivery_plans WHERE order_id = $1 ORDER BY seq`,
        [id],
      ),
      pool.query<DeliveryLineRow>(
        `SELECT dl.id, dl.delivery_id, dl.order_line_id, dl.planned_quantity, dl.delivered_quantity, dl.actual_cost, dl.serials,
                l.line_no, l.material_id, l.material_code, l.material_name, l.unit, l.material_kind
           FROM crm_schema.delivery_lines dl
           JOIN crm_schema.sales_order_lines l ON l.id = dl.order_line_id
           JOIN crm_schema.delivery_plans d ON d.id = dl.delivery_id
          WHERE d.order_id = $1
          ORDER BY l.line_no`,
        [id],
      ),
      readHistory(pool, SALES_ORDER_AUDIT_ENTITY, id),
      pool.query<{ debited: string | null; collected: string | null; adjusted: string | null; outstanding: string | null }>(
        `SELECT debited, collected, adjusted, outstanding FROM crm_schema.receivable_order_balances WHERE order_id = $1`,
        [id],
      ),
      new PostgresCreditStore(this.database).latestRequest(tenantId, id),
    ]);
    const balance = receivable.rows[0];
    const plans = deliveries.rows.map((row) => toDelivery(row, deliveryLines.rows.filter((line) => line.delivery_id === row.id), today));
    const planned = new Map<string, number>();
    for (const plan of plans) {
      for (const line of plan.lines) {
        planned.set(
          line.orderLineId,
          round3((planned.get(line.orderLineId) ?? 0) + committedQuantity(plan.status, line.plannedQuantity, line.deliveredQuantity)),
        );
      }
    }
    return {
      ...toSummary(head),
      warehouseCode: head.warehouse_code,
      deliveryAddress: head.delivery_address,
      note: head.note,
      priceDate: toDateOnly(head.price_date),
      shipping: { amount: num(head.shipping_amount), vatRate: num(head.shipping_vat_rate) },
      totals: {
        grossAmount: num(head.gross_amount),
        discountAmount: num(head.discount_amount),
        netAmount: num(head.net_amount),
        shippingAmount: num(head.shipping_amount),
        vatAmount: num(head.vat_amount),
        totalAmount: num(head.total_amount),
      },
      revision: head.revision,
      lines: lines.rows.map((row) => toLine(row, planned.get(row.id) ?? 0)),
      deliveries: plans,
      reservationExpiresAt: toIso(head.reservation_expires_at),
      cancelReason: head.cancel_reason,
      closeReason: head.close_reason,
      history,
      createdAt: toIso(head.created_at) ?? '',
      receivable: {
        debited: num(balance?.debited),
        collected: num(balance?.collected),
        adjusted: num(balance?.adjusted),
        outstanding: num(balance?.outstanding),
      },
      creditRequest: creditRequest ?? null,
    };
  }

  createOrder(tenantId: string, record: NewOrderRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, async (client) => (await insertOrder(client, record, actorId)).id);
  }

  updateDraft(
    tenantId: string,
    id: string,
    revision: number,
    header: OrderHeaderRecord,
    lines: readonly OrderLineRecord[] | undefined,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      await lockOrder(client, id, revision, ['DRAFT']);
      await client.query(
        `UPDATE crm_schema.sales_orders
            SET expected_delivery_date = $2, warehouse_code = $3, delivery_address = $4, note = $5, price_date = $6,
                shipping_amount = $7, shipping_vat_rate = $8, gross_amount = $9, discount_amount = $10, net_amount = $11,
                vat_amount = $12, total_amount = $13, revision = revision + 1, updated_at = now(), updated_by = $14
          WHERE id = $1`,
        [id, ...headerValues(header), actorId],
      );
      if (lines) {
        // Thay dòng đơn Nháp: đợt giao lập theo dòng cũ không còn đúng, bỏ để lập lại.
        await client.query(`DELETE FROM crm_schema.delivery_plans WHERE order_id = $1`, [id]);
        await client.query(`DELETE FROM crm_schema.sales_order_lines WHERE order_id = $1`, [id]);
        await insertOrderLines(client, id, lines);
      }
    });
  }

  confirm(
    tenantId: string,
    id: string,
    revision: number,
    from: SalesOrderStatus,
    confirmation: OrderConfirmation,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, id, revision, [from]);
      await client.query(
        `UPDATE crm_schema.sales_orders
            SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by = $2, reservation_expires_at = $3,
                revision = revision + 1, updated_at = now(), updated_by = $2
          WHERE id = $1`,
        [id, actorId, confirmation.expiresAt],
      );
      for (const line of confirmation.lines) {
        await client.query(
          `UPDATE crm_schema.sales_order_lines
              SET reservation_id = $3, reservation_code = $4, reservation_source = $5, reservation_status = 'HELD',
                  reserved_quantity = $6, reservation_lost_at = NULL, updated_at = now()
            WHERE id = $2 AND order_id = $1`,
          [id, line.lineId, line.reservationId, line.reservationCode, line.source, line.quantity],
        );
      }
      const codes = [...new Set(confirmation.lines.map((line) => line.reservationCode))];
      await writeAuditLog(client, {
        entityType: SALES_ORDER_AUDIT_ENTITY,
        entityId: id,
        fromStatus: from,
        toStatus: 'CONFIRMED',
        action: 'confirm',
        actorId,
        metadata: {
          code: locked.code,
          reservationCodes: codes,
          reservationSource: confirmation.lines[0]?.source ?? null,
        },
      });
    });
  }

  transition(tenantId: string, id: string, revision: number, transition: OrderTransition, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, id, revision, [transition.from]);
      await client.query(
        `UPDATE crm_schema.sales_orders
            SET status = $2::varchar,
                closed_at = CASE WHEN $2::varchar = 'DONE' THEN now() ELSE closed_at END,
                close_reason = CASE WHEN $2::varchar = 'DONE' THEN $3::varchar ELSE close_reason END,
                revision = revision + 1, updated_at = now(), updated_by = $4
          WHERE id = $1`,
        [id, transition.to, transition.reason, actorId],
      );
      await writeAuditLog(client, {
        entityType: SALES_ORDER_AUDIT_ENTITY,
        entityId: id,
        fromStatus: transition.from,
        toStatus: transition.to,
        action: transition.action,
        actorId,
        reason: transition.reason,
        metadata: { code: locked.code },
      });
    });
  }

  cancel(tenantId: string, id: string, revision: number, from: SalesOrderStatus, reason: string, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, id, revision, [from]);
      await client.query(
        `UPDATE crm_schema.sales_orders
            SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2, revision = revision + 1,
                updated_at = now(), updated_by = $3
          WHERE id = $1`,
        [id, reason, actorId],
      );
      await client.query(
        `UPDATE crm_schema.delivery_plans SET status = 'CANCELLED', updated_at = now()
          WHERE order_id = $1 AND status IN ('PLANNED', 'REQUESTED')`,
        [id],
      );
      if (from === 'CREDIT_PENDING') await cancelPendingCreditRequests(client, id);
      // Chỉ nhả phần giữ riêng của đơn; phần dùng của hợp đồng vẫn thuộc hợp đồng. Kho chỉ nhả phần chưa xuất.
      const own = await client.query<{ reservation_code: string }>(
        `SELECT DISTINCT reservation_code FROM crm_schema.sales_order_lines
          WHERE order_id = $1 AND reservation_source = 'ORDER' AND reservation_status = 'HELD' AND reservation_code IS NOT NULL`,
        [id],
      );
      for (const row of own.rows) await enqueueReservationRelease(client, row.reservation_code, `Huỷ đơn ${locked.code}`);
      await client.query(
        `UPDATE crm_schema.sales_order_lines
            SET reservation_status = 'RELEASED', reserved_quantity = 0, updated_at = now()
          WHERE order_id = $1 AND reservation_status = 'HELD'`,
        [id],
      );
      await writeAuditLog(client, {
        entityType: SALES_ORDER_AUDIT_ENTITY,
        entityId: id,
        fromStatus: from,
        toStatus: 'CANCELLED',
        action: 'cancel',
        actorId,
        reason,
        metadata: { code: locked.code, releasedReservations: own.rows.map((row) => row.reservation_code) },
      });
    });
  }

  async reserveAttempt(tenantId: string, id: string): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ reserve_attempt: number }>(`SELECT reserve_attempt FROM crm_schema.sales_orders WHERE id = $1`, [id]);
    return result.rows[0]?.reserve_attempt ?? 1;
  }

  async bumpReserveAttempt(tenantId: string, id: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    await pool.query(`UPDATE crm_schema.sales_orders SET reserve_attempt = reserve_attempt + 1 WHERE id = $1`, [id]);
  }

  async contractReservationUsage(tenantId: string, contractId: string, excludeOrderId: string): Promise<ReadonlyMap<string, number>> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ material_id: string; quantity: string }>(
      `SELECT l.material_id, sum(l.quantity) AS quantity
         FROM crm_schema.sales_order_lines l
         JOIN crm_schema.sales_orders o ON o.id = l.order_id
        WHERE o.contract_id = $1 AND o.id <> $2 AND o.status <> 'CANCELLED' AND l.reservation_source = 'CONTRACT'
        GROUP BY l.material_id`,
      [contractId, excludeOrderId],
    );
    return new Map(result.rows.map((row) => [row.material_id, num(row.quantity)]));
  }

  saveDelivery(
    tenantId: string,
    orderId: string,
    revision: number,
    deliveryId: string | null,
    record: DeliveryRecord,
    actorId: string,
  ): Promise<string> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, orderId, revision, ['DRAFT', 'CREDIT_PENDING', 'CONFIRMED', 'DELIVERING', 'PARTIAL']);
      let id = deliveryId;
      if (id) {
        const updated = await client.query(
          `UPDATE crm_schema.delivery_plans
              SET late_notified_at = CASE WHEN planned_date = $3::date THEN late_notified_at ELSE NULL END,
                  planned_date = $3, warehouse_code = $4, address = $5, note = $6, updated_at = now()
            WHERE id = $1 AND order_id = $2 AND status = 'PLANNED'`,
          [id, orderId, record.plannedDate, record.warehouseCode, record.address, record.note],
        );
        if (!updated.rowCount) throw new CrmConflictError('DELIVERY_LOCKED', 'Đợt giao đã yêu cầu xuất kho, không sửa được.');
        await client.query(`DELETE FROM crm_schema.delivery_lines WHERE delivery_id = $1`, [id]);
        await insertDeliveryLines(client, id, record);
      } else {
        id = await insertDelivery(client, orderId, locked.code, record, actorId);
      }
      await bumpRevision(client, orderId, actorId);
      return id;
    });
  }

  cancelDelivery(tenantId: string, orderId: string, revision: number, deliveryId: string, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      await lockOrder(client, orderId, revision);
      const updated = await client.query(
        `UPDATE crm_schema.delivery_plans SET status = 'CANCELLED', updated_at = now()
          WHERE id = $1 AND order_id = $2 AND status = 'PLANNED'`,
        [deliveryId, orderId],
      );
      if (!updated.rowCount) throw new CrmConflictError('DELIVERY_LOCKED', 'Chỉ bỏ được đợt giao chưa yêu cầu xuất kho.');
      await bumpRevision(client, orderId, actorId);
    });
  }

  markDeliveryRequested(
    tenantId: string,
    orderId: string,
    revision: number,
    deliveryId: string,
    document: { readonly documentId: string; readonly documentCode: string } | null,
    actorId: string,
  ): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, orderId, revision, ['CONFIRMED', 'DELIVERING', 'PARTIAL']);
      const delivery = await client.query<{ code: string }>(
        document
          ? `UPDATE crm_schema.delivery_plans
                SET status = 'REQUESTED', issue_document_id = $3, issue_document_code = $4, requested_at = now(),
                    requested_by = $5, updated_at = now()
              WHERE id = $1 AND order_id = $2 AND status = 'PLANNED' RETURNING code`
          : `UPDATE crm_schema.delivery_plans
                SET status = 'ISSUED', requested_at = now(), requested_by = $5, issued_at = now(), updated_at = now()
              WHERE id = $1 AND order_id = $2 AND status = 'PLANNED' AND $3::uuid IS NULL AND $4::varchar IS NULL RETURNING code`,
        [deliveryId, orderId, document?.documentId ?? null, document?.documentCode ?? null, actorId],
      );
      const code = delivery.rows[0]?.code;
      if (!code) throw new CrmConflictError('DELIVERY_ALREADY_REQUESTED', 'Đợt giao đã yêu cầu xuất kho.');
      if (document) {
        if (locked.status !== 'DELIVERING') {
          await setStatus(client, orderId, locked.status, 'DELIVERING', 'request-issue', actorId, null, {
            code: locked.code,
            deliveryCode: code,
            documentCode: document.documentCode,
          });
        }
      } else {
        // Đợt chỉ có dịch vụ: không qua Kho, ghi nhận đã giao ngay và ghi nợ (D3).
        const before = await deliveredSnapshot(client, orderId);
        const factsBefore = await salesFactSnapshot(client, orderId);
        await markServiceLinesDelivered(client, deliveryId, 1);
        await recordSalesFacts(client, {
          orderId,
          deliveryId,
          before: factsBefore,
          sourceType: 'service_delivery',
          documentId: deliveryId,
          documentCode: code,
          reversesDocumentId: null,
          deliveredAt: null,
          deliveredDate: vietnamDateOf(null),
        });
        await recognizeOrderDelivery(client, {
          orderId,
          deliveryId,
          before,
          sourceType: 'service_delivery',
          sourceId: deliveryId,
          reversesSourceId: null,
          documentCode: null,
          date: vietnamDateOf(null),
          actorId,
        });
        await refreshOrderProgress(client, tenantId, orderId, this.balances, {
          action: 'deliver-service',
          actorId,
          metadata: { deliveryCode: code },
        });
      }
      await bumpRevision(client, orderId, actorId);
    });
  }

  notifyLateDeliveries(tenantId: string, today: string, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      const due = await client.query<{
        id: string;
        code: string;
        planned_date: string;
        order_id: string;
        order_code: string;
        owner_user_id: string;
      }>(
        `SELECT d.id, d.code, d.planned_date::text AS planned_date, o.id AS order_id, o.code AS order_code, o.owner_user_id
           FROM crm_schema.delivery_plans d
           JOIN crm_schema.sales_orders o ON o.id = d.order_id
          WHERE d.status IN ('PLANNED', 'REQUESTED') AND d.planned_date < $1::date AND d.late_notified_at IS NULL
            AND o.status NOT IN ('CANCELLED', 'DONE')
          ORDER BY d.planned_date, d.id
          LIMIT $2
          FOR UPDATE OF d SKIP LOCKED`,
        [today, limit],
      );
      for (const row of due.rows) {
        await client.query(`UPDATE crm_schema.delivery_plans SET late_notified_at = now() WHERE id = $1`, [row.id]);
        const payload: CrmDeliveryLatePayload = {
          orderId: row.order_id,
          orderCode: row.order_code,
          deliveryId: row.id,
          deliveryCode: row.code,
          plannedDate: row.planned_date,
          ownerUserId: row.owner_user_id,
          actorUserId: null,
          recipientUserIds: [row.owner_user_id],
          summary: `Đợt giao ${row.code} của đơn ${row.order_code} đã quá ngày dự kiến ${row.planned_date.split('-').reverse().join('/')} mà chưa xuất kho.`,
          deepLink: salesOrderDeepLink(row.order_id),
        };
        await writeCrmOutbox(client, tenantId, { type: CRM_DELIVERY_LATE, aggregateType: 'crm-delivery', aggregateId: row.id, payload });
      }
      return due.rows.length;
    });
  }
}

// ---------------------------------------------------------------------------
// Ghi trong transaction của bên gọi
// ---------------------------------------------------------------------------

/** Tạo đơn Nháp cùng dòng và nhật ký (lập tay, chuyển báo giá). Trả id và mã. */
export async function insertOrder(client: CrmSqlClient, record: NewOrderRecord, actorId: string): Promise<{ id: string; code: string }> {
  const sequence = await client.query<{ seq: string; year: number }>(
    `SELECT nextval('crm_schema.sales_order_code_seq') AS seq,
            extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS year`,
  );
  const code = formatOrderCode(sequence.rows[0].year, Number(sequence.rows[0].seq));
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.sales_orders
       (code, source, customer_id, contract_id, quote_id, opportunity_id, owner_user_id, order_date, expected_delivery_date,
        warehouse_code, delivery_address, note, price_date, shipping_amount, shipping_vat_rate, gross_amount,
        discount_amount, net_amount, vat_amount, total_amount, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)
     RETURNING id`,
    [
      code,
      record.source,
      record.customerId,
      record.contractId,
      record.quoteId,
      record.opportunityId,
      record.ownerUserId,
      record.orderDate,
      ...headerValues(record),
      actorId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('crm_schema.sales_orders insert returned no row.');
  await insertOrderLines(client, id, record.lines);
  await writeAuditLog(client, {
    entityType: SALES_ORDER_AUDIT_ENTITY,
    entityId: id,
    fromStatus: null,
    toStatus: 'DRAFT',
    action: 'create',
    actorId,
    metadata: { code, source: record.source, ...(record.quoteId ? { quoteId: record.quoteId } : {}), ...(record.contractId ? { contractId: record.contractId } : {}) },
  });
  return { id, code };
}

/** Thêm một đợt giao (số thứ tự kế tiếp). Trả id. */
export async function insertDelivery(
  client: CrmSqlClient,
  orderId: string,
  orderCode: string,
  record: DeliveryRecord,
  actorId: string,
): Promise<string> {
  const next = await client.query<{ seq: number }>(
    `SELECT COALESCE(max(seq), 0) + 1 AS seq FROM crm_schema.delivery_plans WHERE order_id = $1`,
    [orderId],
  );
  const seq = next.rows[0].seq;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.delivery_plans (order_id, code, seq, planned_date, warehouse_code, address, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [orderId, formatDeliveryCode(orderCode, seq), seq, record.plannedDate, record.warehouseCode, record.address, record.note, actorId],
  );
  const id = inserted.rows[0].id;
  await insertDeliveryLines(client, id, record);
  return id;
}

async function insertDeliveryLines(client: CrmSqlClient, deliveryId: string, record: DeliveryRecord) {
  for (const line of record.lines) {
    await client.query(
      `INSERT INTO crm_schema.delivery_lines (delivery_id, order_line_id, planned_quantity) VALUES ($1, $2, $3)`,
      [deliveryId, line.orderLineId, line.quantity],
    );
  }
}

export async function insertOrderLines(client: CrmSqlClient, orderId: string, lines: readonly OrderLineRecord[]) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO crm_schema.sales_order_lines
         (id, order_id, line_no, material_id, material_code, material_name, unit, material_kind, category, quantity,
          list_price, price_source, price_reference_id, price_reference_code, applied_policies, discount_percent,
          overridden, override_unit_price, override_discount_percent, unit_price, gross_amount, discount_amount, vat_rate,
          line_amount, vat_amount, line_total, est_unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27)`,
      [
        line.id,
        orderId,
        line.lineNo,
        line.materialId,
        line.materialCode.slice(0, 100),
        line.materialName.slice(0, 300),
        line.unit,
        line.materialKind.slice(0, 16),
        line.category?.slice(0, 300) ?? null,
        line.quantity,
        line.listPrice,
        line.priceSource,
        line.priceReferenceId,
        line.priceReferenceCode,
        JSON.stringify(line.appliedPolicies),
        line.discountPercent,
        line.overridden,
        line.overrideUnitPrice,
        line.overrideDiscountPercent,
        line.unitPrice,
        line.grossAmount,
        line.discountAmount,
        line.vatRate,
        line.lineAmount,
        line.vatAmount,
        line.lineTotal,
        line.estUnitCost,
      ],
    );
  }
}

interface LockedOrder {
  readonly code: string;
  readonly status: SalesOrderStatus;
  readonly ownerUserId: string;
}

/** Khoá đơn rồi so `revision` (và trạng thái nằm trong `allowed` nếu có). */
export async function lockOrder(
  client: CrmSqlClient,
  id: string,
  revision: number | null,
  allowed?: readonly SalesOrderStatus[],
): Promise<LockedOrder> {
  const result = await client.query<{ code: string; status: SalesOrderStatus; revision: number; owner_user_id: string }>(
    `SELECT code, status, revision, owner_user_id FROM crm_schema.sales_orders WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw STALE();
  if (allowed && !allowed.includes(row.status)) {
    throw new CrmConflictError(
      'INVALID_ORDER_TRANSITION',
      `Đơn đang ở trạng thái "${SALES_ORDER_STATUS_LABELS[row.status]}", không thực hiện được thao tác này.`,
    );
  }
  if (revision !== null && row.revision !== revision) throw STALE();
  return { code: row.code, status: row.status, ownerUserId: row.owner_user_id };
}

async function bumpRevision(client: CrmSqlClient, orderId: string, actorId: string | null) {
  await client.query(
    `UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now(), updated_by = COALESCE($2, updated_by) WHERE id = $1`,
    [orderId, actorId],
  );
}

export async function setStatus(
  client: CrmSqlClient,
  orderId: string,
  from: SalesOrderStatus,
  to: SalesOrderStatus,
  action: string,
  actorId: string | null,
  reason: string | null,
  metadata: Readonly<Record<string, unknown>>,
) {
  await client.query(
    `UPDATE crm_schema.sales_orders
        SET status = $2::varchar,
            delivered_at = CASE WHEN $2::varchar = 'DELIVERED' THEN now() ELSE delivered_at END,
            closed_at = CASE WHEN $2::varchar = 'DONE' THEN now() ELSE closed_at END,
            close_reason = CASE WHEN $2::varchar = 'DONE' THEN $3::varchar ELSE close_reason END,
            updated_at = now()
      WHERE id = $1`,
    [orderId, to, reason],
  );
  await writeAuditLog(client, {
    entityType: SALES_ORDER_AUDIT_ENTITY,
    entityId: orderId,
    fromStatus: from,
    toStatus: to,
    action,
    actorId,
    reason,
    metadata,
  });
}

/**
 * Dòng dịch vụ của đợt giao ghi nhận đã giao (`sign` 1) hoặc bỏ ghi nhận
 * (`sign` -1, khi chứng từ xuất của đợt bị đảo hết): dịch vụ không qua Kho.
 */
export async function markServiceLinesDelivered(client: CrmSqlClient, deliveryId: string, sign: 1 | -1) {
  const lines = await client.query<{ id: string; order_line_id: string; planned_quantity: string; delivered_quantity: string }>(
    `SELECT dl.id, dl.order_line_id, dl.planned_quantity, dl.delivered_quantity
       FROM crm_schema.delivery_lines dl
       JOIN crm_schema.sales_order_lines l ON l.id = dl.order_line_id
      WHERE dl.delivery_id = $1 AND l.material_kind = 'SERVICE'`,
    [deliveryId],
  );
  for (const line of lines.rows) {
    const quantity = sign > 0 ? num(line.planned_quantity) - num(line.delivered_quantity) : -num(line.delivered_quantity);
    if (!quantity) continue;
    await client.query(`UPDATE crm_schema.delivery_lines SET delivered_quantity = delivered_quantity + $2 WHERE id = $1`, [line.id, quantity]);
    await client.query(
      `UPDATE crm_schema.sales_order_lines SET delivered_quantity = GREATEST(delivered_quantity + $2, 0), updated_at = now() WHERE id = $1`,
      [line.order_line_id, quantity],
    );
  }
}

/**
 * Tính lại trạng thái đơn sau khi số đã giao đổi (T4-12, T4-13): giao đủ thì
 * Đã giao đủ, có phần đã giao thì Đã giao một phần; chứng từ đảo thì lùi lại.
 * Đã giao đủ và còn phải thu bằng 0 thì tự Hoàn tất (Q8); bản đọc công nợ GĐ4
 * trả "chưa biết" nên đơn chưa tự Hoàn tất. Gọi trong transaction đã khoá đơn.
 */
export async function refreshOrderProgress(
  client: CrmSqlClient,
  tenantId: string,
  orderId: string,
  balances: OrderBalanceReader,
  options: { readonly action: string; readonly actorId: string | null; readonly metadata: Readonly<Record<string, unknown>> },
): Promise<SalesOrderStatus> {
  const order = await client.query<{ code: string; status: SalesOrderStatus }>(
    `SELECT code, status FROM crm_schema.sales_orders WHERE id = $1`,
    [orderId],
  );
  const current = order.rows[0]?.status;
  if (!current) return 'CANCELLED';
  const progress = await client.query<{ all_delivered: boolean; any_delivered: boolean; open_requests: boolean }>(
    `SELECT COALESCE(bool_and(delivered_quantity >= quantity), false) AS all_delivered,
            COALESCE(bool_or(delivered_quantity > 0), false) AS any_delivered,
            EXISTS (SELECT 1 FROM crm_schema.delivery_plans WHERE order_id = $1 AND status = 'REQUESTED') AS open_requests
       FROM crm_schema.sales_order_lines WHERE order_id = $1`,
    [orderId],
  );
  const row = progress.rows[0];
  const next = orderStatusAfterDelivery(current, {
    allDelivered: row.all_delivered,
    anyDelivered: row.any_delivered,
    openRequests: row.open_requests,
  });
  const metadata = { code: order.rows[0].code, ...options.metadata };
  if (next !== current) await setStatus(client, orderId, current, next, options.action, options.actorId, null, metadata);
  if (next === 'DELIVERED') {
    const outstanding = await balances.outstanding(tenantId, orderId, client);
    if (outstanding === 0) {
      await setStatus(client, orderId, 'DELIVERED', 'DONE', 'auto-complete', null, 'Đã giao đủ và còn phải thu bằng 0', metadata);
      return 'DONE';
    }
  }
  return next;
}

function headerValues(header: OrderHeaderRecord): unknown[] {
  return [
    header.expectedDeliveryDate,
    header.warehouseCode,
    header.deliveryAddress,
    header.note,
    header.priceDate,
    header.shipping.amount,
    header.shipping.vatRate,
    header.totals.grossAmount,
    header.totals.discountAmount,
    header.totals.netAmount,
    header.totals.vatAmount,
    header.totals.totalAmount,
  ];
}

// ---------------------------------------------------------------------------
// Đọc
// ---------------------------------------------------------------------------

interface LineRow {
  id: string;
  line_no: number;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  material_kind: string;
  category: string | null;
  quantity: string;
  list_price: string;
  price_source: PriceSource;
  price_reference_code: string | null;
  applied_policies: AppliedDiscountPolicy[] | null;
  discount_percent: string;
  overridden: boolean;
  override_unit_price: string | null;
  override_discount_percent: string | null;
  unit_price: string;
  gross_amount: string;
  discount_amount: string;
  vat_rate: string;
  line_amount: string;
  vat_amount: string;
  line_total: string;
  est_unit_cost: string | null;
  reserved_quantity: string;
  delivered_quantity: string;
  actual_cost: string;
  serials: string[] | null;
  reservation_id: string | null;
  reservation_code: string | null;
  reservation_source: ReservationSource | null;
  reservation_status: CrmReservationStatus | null;
}

interface DeliveryRow {
  id: string;
  code: string;
  seq: number;
  planned_date: string;
  warehouse_code: string | null;
  address: string | null;
  note: string | null;
  status: DeliveryStatus;
  issue_document_id: string | null;
  issue_document_code: string | null;
  requested_at: Date | null;
  issued_at: Date | null;
}

interface DeliveryLineRow {
  id: string;
  delivery_id: string;
  order_line_id: string;
  planned_quantity: string;
  delivered_quantity: string;
  actual_cost: string;
  serials: string[] | null;
  line_no: number;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  material_kind: string;
}

function toSummary(row: HeadRow): SalesOrderSummary {
  return {
    id: row.id,
    code: row.code,
    source: row.source,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    quoteId: row.quote_id,
    quoteCode: row.quote_code,
    status: row.status,
    orderDate: toDateOnly(row.order_date) ?? '',
    expectedDeliveryDate: toDateOnly(row.expected_delivery_date),
    totalAmount: num(row.total_amount),
    ownerUserId: row.owner_user_id,
    late: row.late && !['CANCELLED', 'DONE'].includes(row.status),
    outstanding: num(row.outstanding),
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toLine(row: LineRow, plannedQuantity: number): SalesOrderLine {
  return {
    id: row.id,
    lineNo: row.line_no,
    materialId: row.material_id,
    materialCode: row.material_code,
    materialName: row.material_name,
    unit: row.unit,
    materialKind: row.material_kind,
    category: row.category,
    quantity: num(row.quantity),
    listPrice: num(row.list_price),
    priceSource: row.price_source,
    priceReferenceCode: row.price_reference_code,
    appliedPolicies: row.applied_policies ?? [],
    discountPercent: num(row.discount_percent),
    overridden: row.overridden,
    overrideUnitPrice: toNumber(row.override_unit_price),
    overrideDiscountPercent: toNumber(row.override_discount_percent),
    unitPrice: num(row.unit_price),
    grossAmount: num(row.gross_amount),
    discountAmount: num(row.discount_amount),
    vatRate: num(row.vat_rate),
    lineAmount: num(row.line_amount),
    vatAmount: num(row.vat_amount),
    lineTotal: num(row.line_total),
    estUnitCost: toNumber(row.est_unit_cost),
    reservedQuantity: num(row.reserved_quantity),
    plannedQuantity,
    deliveredQuantity: num(row.delivered_quantity),
    actualCost: num(row.actual_cost),
    serials: row.serials ?? [],
    reservationId: row.reservation_id,
    reservationCode: row.reservation_code,
    reservationStatus: row.reservation_status,
    reservationSource: row.reservation_source,
  };
}

function toDelivery(row: DeliveryRow, lines: readonly DeliveryLineRow[], today: string): DeliveryPlan {
  const plannedDate = toDateOnly(row.planned_date) ?? '';
  return {
    id: row.id,
    code: row.code,
    seq: row.seq,
    plannedDate,
    warehouseCode: row.warehouse_code,
    address: row.address,
    note: row.note,
    status: row.status,
    issueDocumentId: row.issue_document_id,
    issueDocumentCode: row.issue_document_code,
    requestedAt: toIso(row.requested_at),
    issuedAt: toIso(row.issued_at),
    late: isDeliveryLate({ status: row.status, plannedDate }, today),
    lines: lines.map(
      (line): DeliveryLine => ({
        id: line.id,
        orderLineId: line.order_line_id,
        lineNo: line.line_no,
        materialId: line.material_id,
        materialCode: line.material_code,
        materialName: line.material_name,
        unit: line.unit,
        materialKind: line.material_kind,
        plannedQuantity: num(line.planned_quantity),
        deliveredQuantity: num(line.delivered_quantity),
        actualCost: num(line.actual_cost),
        serials: line.serials ?? [],
      }),
    ),
  };
}
