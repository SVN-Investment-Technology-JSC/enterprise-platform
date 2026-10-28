import {
  CRM_CONTRACT_RESERVATION_LOST,
  CRM_ORDER_RESERVATION_LOST,
  contractDeepLink,
  salesOrderDeepLink,
  type CrmReservationLostPayload,
} from '@enterprise-platform/contracts-crm';
import {
  CRM_CONTRACT_SOURCE_TYPE,
  CRM_DELIVERY_SOURCE_TYPE,
  CRM_ORDER_SOURCE_TYPE,
  type OrderBalanceReader,
} from '../application/fulfillment.port.js';
import { allocateIssuedLine, round2, round3 } from '../domain/delivery-plan.js';
import { isUuid } from '../domain/fields.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { CONTRACT_AUDIT_ENTITY } from './postgres-contract.store.js';
import { deliveredSnapshot, recognizeOrderDelivery, vietnamDateOf } from './receivable-recognition.js';
import { recordSalesFacts, salesFactSnapshot } from './sales-facts.js';
import {
  lockOrder,
  markServiceLinesDelivered,
  refreshOrderProgress,
  SALES_ORDER_AUDIT_ENTITY,
} from './postgres-sales-order.store.js';

/**
 * Sự kiện Kho Bán hàng nghe (khai ở `@enterprise-platform/contracts-inventory`;
 * module không phụ thuộc package của Kho nên chép lại tên, không đổi).
 */
export const INVENTORY_STOCK_ISSUED = 'inventory.stock.issued';
export const INVENTORY_RESERVATION_EXPIRED = 'inventory.reservation.expired';
export const INVENTORY_RESERVATION_RELEASED = 'inventory.reservation.released';

/** Phần payload `inventory.stock.issued` Bán hàng đọc. */
export interface StockIssuedPayload {
  readonly documentId?: string;
  readonly documentCode?: string;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
  readonly reversesDocumentId?: string | null;
  readonly postedAt?: string;
  readonly lines?: readonly {
    readonly materialId?: string;
    readonly materialCode?: string;
    readonly quantity?: number | string;
    readonly costAmount?: number | string;
    readonly serials?: readonly string[];
    readonly direction?: string;
    /** Phần giữ Kho đã trừ khi xuất dòng này (phần giữ của đơn hoặc của hợp đồng). */
    readonly reservationId?: string | null;
  }[];
}

/** Phần payload `inventory.reservation.expired` và `.released` Bán hàng đọc. */
export interface ReservationExpiredPayload {
  readonly reservationCode?: string;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
}

/** Dòng đợt giao đang được cộng, trừ trong lúc áp một chứng từ. */
interface WorkingLine {
  id: string;
  orderLineId: string;
  materialId: string;
  plannedQuantity: number;
  deliveredQuantity: number;
  serials: string[];
}

/** Chứng từ đảo đến trước chứng từ gốc: để consumer thử lại sau. */
export class ReversalBeforeOriginalError extends Error {
  constructor(documentId: string) {
    super(`Reversal of ${documentId} arrived before the original issue was applied.`);
  }
}

/**
 * Áp kết quả xuất kho của một đợt giao (T4-12, TC-ORD-07, TC-SM-08): cộng số
 * đã giao, serial, giá vốn thực tế vào dòng đợt và dòng đơn; trừ phần còn giữ;
 * đợt sang Đã xuất kho; đơn sang Đã giao một phần hoặc Đã giao đủ.
 *
 * Chứng từ đảo (`reversesDocumentId`) làm ngược lại: trừ số đã giao, giá vốn,
 * bỏ serial; đợt bị đảo hết thì Đã đảo chứng từ và đơn lùi trạng thái. Mỗi
 * chứng từ chỉ áp một lần (`delivery_issue_documents`), nhận trùng thì bỏ qua.
 */
export async function applyStockIssued(
  database: CrmDatabase,
  tenantId: string,
  payload: StockIssuedPayload,
  balances: OrderBalanceReader,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_DELIVERY_SOURCE_TYPE || !isUuid(payload.sourceId) || !isUuid(payload.documentId)) return 'ignored';
  const deliveryId = payload.sourceId;
  const documentId = payload.documentId;
  const reversesId = isUuid(payload.reversesDocumentId) ? payload.reversesDocumentId : null;
  return database.transaction(tenantId, async (client) => {
    const found = await client.query<{ order_id: string }>(`SELECT order_id FROM crm_schema.delivery_plans WHERE id = $1`, [deliveryId]);
    const orderId = found.rows[0]?.order_id;
    if (!orderId) return 'ignored';
    await lockOrder(client, orderId, null);
    const deliveredBefore = await deliveredSnapshot(client, orderId);
    const factsBefore = await salesFactSnapshot(client, orderId);
    const delivery = (
      await client.query<{ code: string; status: string }>(
        `SELECT code, status FROM crm_schema.delivery_plans WHERE id = $1 FOR UPDATE`,
        [deliveryId],
      )
    ).rows[0];
    if (reversesId) {
      const original = await client.query(
        `SELECT 1 FROM crm_schema.delivery_issue_documents WHERE document_id = $1 AND delivery_id = $2`,
        [reversesId, deliveryId],
      );
      if (!original.rows.length) {
        const seen = await client.query(`SELECT 1 FROM crm_schema.delivery_issue_documents WHERE document_id = $1`, [documentId]);
        if (seen.rows.length) return 'ignored';
        throw new ReversalBeforeOriginalError(reversesId);
      }
    }
    const claimed = await client.query(
      `INSERT INTO crm_schema.delivery_issue_documents (document_id, delivery_id, document_code, reverses_document_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id) DO NOTHING
       RETURNING document_id`,
      [documentId, deliveryId, (payload.documentCode ?? '').slice(0, 100) || documentId, reversesId],
    );
    if (!claimed.rows.length) return 'ignored';
    // Khoá hợp đồng trước dòng đơn (cùng thứ tự với huỷ hợp đồng nhả phần giữ).
    if (!reversesId) await recordContractReservationIssue(client, payload.lines ?? []);

    const targets = (
      await client.query<{ id: string; order_line_id: string; material_id: string; planned_quantity: string; delivered_quantity: string; serials: string[] | null }>(
        `SELECT dl.id, dl.order_line_id, l.material_id, dl.planned_quantity, dl.delivered_quantity, dl.serials
           FROM crm_schema.delivery_lines dl
           JOIN crm_schema.sales_order_lines l ON l.id = dl.order_line_id
          WHERE dl.delivery_id = $1 AND l.material_kind <> 'SERVICE'
          ORDER BY l.line_no`,
        [deliveryId],
      )
    ).rows;
    const working: WorkingLine[] = targets.map((row) => ({
      id: row.id,
      orderLineId: row.order_line_id,
      materialId: row.material_id,
      plannedQuantity: Number(row.planned_quantity),
      deliveredQuantity: Number(row.delivered_quantity),
      serials: row.serials ?? [],
    }));
    let quantityTotal = 0;
    let costTotal = 0;
    const unmatched: string[] = [];
    for (const raw of payload.lines ?? []) {
      const materialId = String(raw.materialId ?? '').toLowerCase();
      const quantity = Math.abs(Number(raw.quantity ?? 0));
      if (!isUuid(materialId) || !Number.isFinite(quantity) || quantity <= 0) continue;
      const reverse = !!reversesId || raw.direction === 'IN';
      const allocations = allocateIssuedLine(
        working,
        {
          materialId,
          quantity,
          costAmount: Math.abs(Number(raw.costAmount ?? 0)) || 0,
          serials: Array.isArray(raw.serials) ? raw.serials.filter((serial) => typeof serial === 'string') : [],
        },
        reverse,
      );
      if (!allocations.length) {
        unmatched.push(String(raw.materialCode ?? materialId));
        continue;
      }
      for (const part of allocations) {
        const target = working.find((line) => line.id === part.lineId) as WorkingLine;
        const serials = reverse
          ? target.serials.filter((serial) => !part.serials.includes(serial))
          : [...target.serials, ...part.serials.filter((serial) => !target.serials.includes(serial))];
        target.deliveredQuantity = round3(Math.max(0, target.deliveredQuantity + part.quantity));
        target.serials = serials;
        quantityTotal = round3(quantityTotal + part.quantity);
        costTotal = round2(costTotal + part.cost);
        await client.query(
          `UPDATE crm_schema.delivery_lines
              SET delivered_quantity = $2, actual_cost = actual_cost + $3, serials = $4::text[]
            WHERE id = $1`,
          [target.id, target.deliveredQuantity, part.cost, serials],
        );
        await client.query(
          `UPDATE crm_schema.sales_order_lines
              SET delivered_quantity = GREATEST(delivered_quantity + $2, 0),
                  actual_cost = actual_cost + $3,
                  serials = CASE WHEN $4 THEN ARRAY(SELECT s FROM unnest(serials) s WHERE NOT (s = ANY($5::text[])))
                                 ELSE serials || ARRAY(SELECT s FROM unnest($5::text[]) s WHERE NOT (s = ANY(serials))) END,
                  reserved_quantity = CASE WHEN $2 > 0 AND reservation_status = 'HELD' THEN GREATEST(reserved_quantity - $2, 0)
                                           ELSE reserved_quantity END,
                  updated_at = now()
            WHERE id = $1`,
          [target.orderLineId, part.quantity, part.cost, reverse, part.serials],
        );
      }
    }
    await client.query(
      `UPDATE crm_schema.delivery_issue_documents SET quantity = $2, cost_amount = $3 WHERE document_id = $1`,
      [documentId, quantityTotal, costTotal],
    );

    const reversal = !!reversesId;
    if (!reversal) {
      await client.query(
        `UPDATE crm_schema.delivery_plans
            SET status = 'ISSUED', issued_at = COALESCE($2::timestamptz, now()),
                issue_document_id = COALESCE(issue_document_id, $3::uuid), issue_document_code = COALESCE(issue_document_code, $4),
                updated_at = now()
          WHERE id = $1`,
        [deliveryId, isoOrNull(payload.postedAt), documentId, payload.documentCode ?? null],
      );
      if (delivery?.status !== 'ISSUED') await markServiceLinesDelivered(client, deliveryId, 1);
    } else if (working.every((line) => line.deliveredQuantity <= 0)) {
      await client.query(`UPDATE crm_schema.delivery_plans SET status = 'REVERSED', updated_at = now() WHERE id = $1`, [deliveryId]);
      await markServiceLinesDelivered(client, deliveryId, -1);
    }
    // Dòng giao cho báo cáo doanh thu (T7-01): chứng từ đảo ghi dòng âm.
    await recordSalesFacts(client, {
      orderId,
      deliveryId,
      before: factsBefore,
      sourceType: 'stock_issue',
      documentId,
      documentCode: payload.documentCode ?? null,
      reversesDocumentId: reversesId,
      deliveredAt: isoOrNull(payload.postedAt),
      deliveredDate: vietnamDateOf(payload.postedAt),
    });
    // Ghi nợ theo phần vừa giao (D3, T5-04) trước khi xét tự Hoàn tất.
    await recognizeOrderDelivery(client, {
      orderId,
      deliveryId,
      before: deliveredBefore,
      sourceType: 'stock_issue',
      sourceId: documentId,
      reversesSourceId: reversesId,
      documentCode: payload.documentCode ?? null,
      date: vietnamDateOf(payload.postedAt),
      actorId: null,
    });
    await refreshOrderProgress(client, tenantId, orderId, balances, {
      action: reversal ? 'reverse-delivery' : 'deliver',
      actorId: null,
      metadata: {
        deliveryCode: delivery?.code ?? null,
        documentCode: payload.documentCode ?? null,
        quantity: quantityTotal,
        ...(unmatched.length ? { unmatchedMaterials: unmatched } : {}),
      },
    });
    await client.query(`UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1`, [orderId]);
    return 'applied';
  });
}

/**
 * Kho báo phần giữ hết hạn (T4-13): dòng đơn (hoặc hợp đồng và các đơn đang
 * dùng phần giữ đó) mất phần giữ; báo người phụ trách. Trạng thái đơn không đổi.
 * Phần giữ không còn khớp (đã nhả, đã thay) thì bỏ qua.
 */
export async function applyReservationExpired(
  database: CrmDatabase,
  tenantId: string,
  payload: ReservationExpiredPayload,
): Promise<'applied' | 'ignored'> {
  const code = payload.reservationCode?.trim();
  if (!code || !isUuid(payload.sourceId)) return 'ignored';
  const sourceId = payload.sourceId;
  if (payload.sourceType === CRM_ORDER_SOURCE_TYPE) {
    return database.transaction(tenantId, async (client) => {
      const lost = await expireOrderLines(client, `order_id = $2 AND reservation_code = $1`, [code, sourceId]);
      if (!lost) return 'ignored';
      await notifyOrderLost(client, tenantId, sourceId, code);
      return 'applied';
    });
  }
  if (payload.sourceType === CRM_CONTRACT_SOURCE_TYPE) {
    return database.transaction(tenantId, async (client) => {
      const contract = await client.query<{ code: string; owner_user_id: string; status: string }>(
        `UPDATE crm_schema.contracts SET reservation_status = 'EXPIRED', updated_at = now()
          WHERE id = $1 AND reservation_code = $2 AND reservation_status = 'HELD'
          RETURNING code, owner_user_id, status`,
        [sourceId, code],
      );
      const row = contract.rows[0];
      if (!row) return 'ignored';
      await writeAuditLog(client, {
        entityType: CONTRACT_AUDIT_ENTITY,
        entityId: sourceId,
        action: 'reservation-expired',
        actorId: null,
        reason: `Phần giữ hàng ${code} ở Kho đã hết hạn.`,
        metadata: { code: row.code, reservationCode: code },
      });
      const payloadOut: CrmReservationLostPayload = {
        orderId: null,
        contractId: sourceId,
        code: row.code,
        reservationCode: code,
        actorUserId: null,
        recipientUserIds: [row.owner_user_id],
        summary: `Phần giữ hàng ${code} của hợp đồng ${row.code} đã hết hạn ở Kho; hàng không còn được giữ.`,
        deepLink: contractDeepLink(sourceId),
      };
      await writeCrmOutbox(client, tenantId, { type: CRM_CONTRACT_RESERVATION_LOST, aggregateType: 'crm-contract', aggregateId: sourceId, payload: payloadOut });
      // Đơn đang dùng phần giữ của hợp đồng cũng mất phần giữ.
      const orders = await client.query<{ order_id: string }>(
        `UPDATE crm_schema.sales_order_lines
            SET reservation_status = 'EXPIRED', reserved_quantity = 0, reservation_lost_at = now(), updated_at = now()
          WHERE reservation_code = $1 AND reservation_source = 'CONTRACT' AND reservation_status = 'HELD'
          RETURNING order_id`,
        [code],
      );
      for (const orderId of new Set(orders.rows.map((line) => line.order_id))) await notifyOrderLost(client, tenantId, orderId, code);
      return 'applied';
    });
  }
  return 'ignored';
}

/**
 * Cộng số Kho đã xuất theo phần giữ của hợp đồng (dòng có `reservationId` là
 * phần giữ của hợp đồng); đủ số đã giữ của mọi mặt hàng thì phần giữ sang Đã
 * xuất đủ, như trạng thái Xuất đủ bên Kho. Chứng từ đảo không trừ lại vì Kho
 * cũng không trả phần giữ khi đảo.
 */
export async function recordContractReservationIssue(client: CrmSqlClient, lines: NonNullable<StockIssuedPayload['lines']>): Promise<void> {
  const byReservation = new Map<string, Map<string, number>>();
  for (const raw of lines) {
    const reservationId = String(raw.reservationId ?? '').toLowerCase();
    const materialId = String(raw.materialId ?? '').toLowerCase();
    const quantity = Math.abs(Number(raw.quantity ?? 0));
    if (raw.direction === 'IN' || !isUuid(reservationId) || !isUuid(materialId) || !Number.isFinite(quantity) || quantity <= 0) continue;
    const issued = byReservation.get(reservationId) ?? new Map<string, number>();
    issued.set(materialId, round3((issued.get(materialId) ?? 0) + quantity));
    byReservation.set(reservationId, issued);
  }
  for (const [reservationId, issued] of byReservation) {
    const contract = (
      await client.query<{ id: string; code: string; reservation_code: string | null; reservation_issued: Record<string, number | string> | null }>(
        `SELECT id, code, reservation_code, reservation_issued FROM crm_schema.contracts
          WHERE reservation_id = $1 AND reservation_status = 'HELD' FOR UPDATE`,
        [reservationId],
      )
    ).rows[0];
    if (!contract) continue;
    const total: Record<string, number> = {};
    for (const [materialId, quantity] of Object.entries(contract.reservation_issued ?? {})) total[materialId] = Number(quantity) || 0;
    for (const [materialId, quantity] of issued) total[materialId] = round3((total[materialId] ?? 0) + quantity);
    const covered = (
      await client.query<{ material_id: string; quantity: string }>(
        `SELECT material_id, sum(quantity) AS quantity FROM crm_schema.contract_lines
          WHERE contract_id = $1 AND material_kind <> 'SERVICE' AND quantity IS NOT NULL
          GROUP BY material_id`,
        [contract.id],
      )
    ).rows;
    const completed = covered.length > 0 && covered.every((row) => (total[row.material_id] ?? 0) >= Number(row.quantity));
    await client.query(
      `UPDATE crm_schema.contracts
          SET reservation_issued = $2::jsonb,
              reservation_status = CASE WHEN $3 THEN 'COMPLETED' ELSE reservation_status END,
              updated_at = now()
        WHERE id = $1`,
      [contract.id, JSON.stringify(total), completed],
    );
    if (completed) {
      await writeAuditLog(client, {
        entityType: CONTRACT_AUDIT_ENTITY,
        entityId: contract.id,
        action: 'reservation-completed',
        actorId: null,
        reason: `Kho đã xuất đủ phần giữ hàng ${contract.reservation_code ?? ''}.`,
        metadata: { code: contract.code, reservationCode: contract.reservation_code },
      });
    }
  }
}

/**
 * Kho báo phần giữ đã nhả (người dùng Kho nhả tay, hoặc lệnh nhả của chính Bán
 * hàng): hợp đồng, dòng đơn còn "Đang giữ" phần giữ đó sang Đã nhả. Lệnh nhả do
 * Bán hàng gửi đã đánh dấu trước nên sự kiện về sau bị bỏ qua.
 */
export async function applyReservationReleased(
  database: CrmDatabase,
  tenantId: string,
  payload: ReservationExpiredPayload,
): Promise<'applied' | 'ignored'> {
  const code = payload.reservationCode?.trim();
  if (!code || !isUuid(payload.sourceId)) return 'ignored';
  const sourceId = payload.sourceId;
  if (payload.sourceType !== CRM_ORDER_SOURCE_TYPE && payload.sourceType !== CRM_CONTRACT_SOURCE_TYPE) return 'ignored';
  return database.transaction(tenantId, async (client) => {
    let applied = false;
    if (payload.sourceType === CRM_CONTRACT_SOURCE_TYPE) {
      const contract = await client.query<{ code: string }>(
        `UPDATE crm_schema.contracts SET reservation_status = 'RELEASED', updated_at = now()
          WHERE id = $1 AND reservation_code = $2 AND reservation_status = 'HELD'
          RETURNING code`,
        [sourceId, code],
      );
      const row = contract.rows[0];
      if (row) {
        applied = true;
        await writeAuditLog(client, {
          entityType: CONTRACT_AUDIT_ENTITY,
          entityId: sourceId,
          action: 'reservation-released',
          actorId: null,
          reason: `Phần giữ hàng ${code} đã được nhả ở Kho.`,
          metadata: { code: row.code, reservationCode: code },
        });
      }
    }
    // Phần giữ của hợp đồng không còn Đang giữ (đã xuất đủ, đã nhả): dòng đơn giữ nguyên.
    if (payload.sourceType === CRM_CONTRACT_SOURCE_TYPE && !applied) return 'ignored';
    const lines = await client.query<{ order_id: string }>(
      `UPDATE crm_schema.sales_order_lines
          SET reservation_status = 'RELEASED', reserved_quantity = 0, updated_at = now()
        WHERE reservation_code = $1 AND reservation_status = 'HELD'
          AND (reservation_source = 'CONTRACT' OR order_id = $2)
        RETURNING order_id`,
      [code, sourceId],
    );
    for (const orderId of new Set(lines.rows.map((line) => line.order_id))) {
      applied = true;
      const order = (
        await client.query<{ code: string }>(
          `UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING code`,
          [orderId],
        )
      ).rows[0];
      await writeAuditLog(client, {
        entityType: SALES_ORDER_AUDIT_ENTITY,
        entityId: orderId,
        action: 'reservation-released',
        actorId: null,
        reason: `Phần giữ hàng ${code} đã được nhả ở Kho.`,
        metadata: { code: order?.code ?? null, reservationCode: code },
      });
    }
    return applied ? 'applied' : 'ignored';
  });
}

async function expireOrderLines(client: CrmSqlClient, condition: string, values: unknown[]): Promise<number> {
  const result = await client.query<{ id: string }>(
    `UPDATE crm_schema.sales_order_lines
        SET reservation_status = 'EXPIRED', reserved_quantity = 0, reservation_lost_at = now(), updated_at = now()
      WHERE ${condition} AND reservation_status = 'HELD'
      RETURNING id`,
    values,
  );
  return result.rows.length;
}

/** Nhật ký và thông báo cho người phụ trách đơn khi dòng đơn mất phần giữ. */
async function notifyOrderLost(client: CrmSqlClient, tenantId: string, orderId: string, reservationCode: string) {
  const order = (
    await client.query<{ code: string; owner_user_id: string; status: string }>(
      `UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1
       RETURNING code, owner_user_id, status`,
      [orderId],
    )
  ).rows[0];
  if (!order) return;
  await writeAuditLog(client, {
    entityType: SALES_ORDER_AUDIT_ENTITY,
    entityId: orderId,
    action: 'reservation-expired',
    actorId: null,
    reason: `Phần giữ hàng ${reservationCode} ở Kho đã hết hạn.`,
    metadata: { code: order.code, reservationCode },
  });
  if (['CANCELLED', 'DONE', 'DELIVERED'].includes(order.status)) return;
  const payload: CrmReservationLostPayload = {
    orderId,
    contractId: null,
    code: order.code,
    reservationCode,
    actorUserId: null,
    recipientUserIds: [order.owner_user_id],
    summary: `Phần giữ hàng của đơn ${order.code} đã hết hạn ở Kho; phần chưa giao không còn được giữ.`,
    deepLink: salesOrderDeepLink(orderId),
  };
  await writeCrmOutbox(client, tenantId, { type: CRM_ORDER_RESERVATION_LOST, aggregateType: 'crm-order', aggregateId: orderId, payload });
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
