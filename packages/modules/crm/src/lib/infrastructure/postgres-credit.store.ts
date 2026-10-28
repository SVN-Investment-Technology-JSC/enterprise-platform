import { randomUUID } from 'node:crypto';
import {
  CRM_ORDER_CREDIT_APPROVAL_REDIRECTED,
  salesOrderDeepLink,
  type CreditLimitMode,
  type CrmOrderCreditApprovalRedirectedPayload,
  type OrderCreditRequest,
} from '@enterprise-platform/contracts-crm';
import {
  CRM_ORDER_CREDIT_SOURCE_TYPE,
  type CreditApprovalRequest,
  type CreditSnapshot,
  type CreditStore,
} from '../application/receivable-store.port.js';
import { isUuid } from '../domain/fields.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { PROCEDURE_START_MAX_ATTEMPTS, type ProcedureCompletedPayload } from './quote-procedure-links.js';
import { lockOrder, SALES_ORDER_AUDIT_ENTITY } from './postgres-sales-order.store.js';
import { toIso } from './sql-helpers.js';

export const CREDIT_LIMIT_SETTING_KEY = 'credit.limit';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

/** Đọc cách xử lý vượt hạn mức; thiếu hoặc hỏng thì đưa đi duyệt (D5). */
export function parseCreditLimitMode(value: unknown): CreditLimitMode {
  return (value as { mode?: unknown } | null | undefined)?.mode === 'BLOCK' ? 'BLOCK' : 'APPROVAL';
}

interface RequestRow {
  id: string;
  order_id: string;
  status: OrderCreditRequest['status'];
  mode: OrderCreditRequest['mode'];
  order_amount: string;
  balance: string;
  credit_limit: string;
  message: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  instance_code: string | null;
  created_at: Date;
}

/**
 * Hạn mức công nợ (D5, T5-10): dư nợ đọc từ sổ; vượt hạn mức với cấu hình
 * "duyệt" thì đơn sang Chờ duyệt hạn mức cùng một yêu cầu duyệt. Cách duyệt theo
 * `approval_bindings` loại ORDER_CREDIT: chưa gắn là duyệt trực tiếp trong Bán
 * hàng (người thấy toàn bộ dữ liệu); gắn Quy trình thì tạo liên kết
 * `crm_order_credit` để worker tạo phiên.
 */
export class PostgresCreditStore implements CreditStore {
  constructor(private readonly database: CrmDatabase) {}

  async snapshot(tenantId: string, customerId: string, orderId: string): Promise<CreditSnapshot> {
    const pool = await this.database.pool(tenantId);
    return readSnapshot(pool, customerId, orderId);
  }

  async creditLimitMode(tenantId: string): Promise<CreditLimitMode> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [CREDIT_LIMIT_SETTING_KEY]);
    return parseCreditLimitMode(result.rows[0]?.value);
  }

  requestApproval(request: CreditApprovalRequest): Promise<{ requestId: string; linkId: string | null }> {
    return this.database.transaction(request.tenantId, async (client) => {
      const locked = await lockOrder(client, request.orderId, request.revision, ['DRAFT']);
      const order = (
        await client.query<{ customer_id: string }>(`SELECT customer_id FROM crm_schema.sales_orders WHERE id = $1`, [request.orderId])
      ).rows[0];
      const snapshot = await readSnapshot(client, order.customer_id, request.orderId);
      const binding = (
        await client.query<{ mode: string; procedure_definition_id: string | null }>(
          `SELECT mode, procedure_definition_id FROM crm_schema.approval_bindings WHERE kind = 'ORDER_CREDIT'`,
        )
      ).rows[0];
      const viaProcedure = binding?.mode === 'PROCEDURE' && !!binding.procedure_definition_id;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.order_credit_requests
           (order_id, customer_id, order_amount, balance, credit_limit, mode, message, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          request.orderId,
          order.customer_id,
          request.orderAmount,
          snapshot.balance,
          snapshot.creditLimit ?? 0,
          viaProcedure ? 'PROCEDURE' : 'DIRECT',
          request.message.slice(0, 2000),
          request.actorId,
        ],
      );
      const requestId = inserted.rows[0].id;
      await client.query(
        `UPDATE crm_schema.sales_orders
            SET status = 'CREDIT_PENDING', revision = revision + 1, updated_at = now(), updated_by = $2
          WHERE id = $1`,
        [request.orderId, request.actorId],
      );
      await writeAuditLog(client, {
        entityType: SALES_ORDER_AUDIT_ENTITY,
        entityId: request.orderId,
        fromStatus: 'DRAFT',
        toStatus: 'CREDIT_PENDING',
        action: 'credit-check',
        actorId: request.actorId,
        reason: request.message,
        metadata: { code: locked.code, creditRequestId: requestId, mode: viaProcedure ? 'PROCEDURE' : 'DIRECT' },
      });
      let linkId: string | null = null;
      if (viaProcedure) {
        linkId = randomUUID();
        await client.query(
          `INSERT INTO crm_schema.procedure_links
             (id, source_type, source_id, definition_id, title, initiated_by, start_idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            linkId,
            CRM_ORDER_CREDIT_SOURCE_TYPE,
            requestId,
            binding.procedure_definition_id,
            `Duyệt vượt hạn mức công nợ đơn ${locked.code}`.slice(0, 500),
            request.actorId,
            `crm:${linkId}`,
          ],
        );
      }
      return { requestId, linkId };
    });
  }

  async latestRequest(tenantId: string, orderId: string): Promise<OrderCreditRequest | undefined> {
    const pool = await this.database.pool(tenantId);
    const row = (
      await pool.query<RequestRow>(
        `SELECT r.*, l.instance_code
           FROM crm_schema.order_credit_requests r
           LEFT JOIN crm_schema.procedure_links l ON l.source_type = $2 AND l.source_id = r.id
          WHERE r.order_id = $1
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 1`,
        [orderId, CRM_ORDER_CREDIT_SOURCE_TYPE],
      )
    ).rows[0];
    return row ? toRequest(row) : undefined;
  }

  decide(
    tenantId: string,
    requestId: string,
    decision: { readonly approve: boolean; readonly actorId: string | null; readonly note: string | null },
  ): Promise<'applied' | 'ignored'> {
    return this.database.transaction(tenantId, (client) => decideRequest(client, requestId, decision));
  }

  returnToDraft(tenantId: string, orderId: string, reason: string, actorId: string | null): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const locked = await lockOrder(client, orderId, null);
      if (locked.status !== 'CREDIT_PENDING') return;
      await moveToDraft(client, orderId, locked.code, 'credit-unreserved', reason, actorId);
    });
  }

  async approvedAwaitingConfirmation(tenantId: string, limit: number): Promise<{ requestId: string; orderId: string }[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ id: string; order_id: string }>(
      `SELECT DISTINCT ON (r.order_id) r.id, r.order_id
         FROM crm_schema.order_credit_requests r
         JOIN crm_schema.sales_orders o ON o.id = r.order_id
        WHERE r.status = 'APPROVED' AND o.status = 'CREDIT_PENDING'
        ORDER BY r.order_id, r.decided_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ requestId: row.id, orderId: row.order_id }));
  }

  redirectFailedProcedures(tenantId: string, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      // Lỗi vĩnh viễn: hết số lần thử, hoặc Quy trình từ chối dữ liệu (lease khoá 100 năm).
      const failed = (
        await client.query<{ link_id: string; last_error: string | null; request_id: string; order_id: string; created_by: string; code: string }>(
          `SELECT l.id AS link_id, l.last_error, r.id AS request_id, r.order_id, r.created_by, o.code
             FROM crm_schema.procedure_links l
             JOIN crm_schema.order_credit_requests r ON r.id = l.source_id
             JOIN crm_schema.sales_orders o ON o.id = r.order_id
            WHERE l.source_type = $1 AND l.status = 'FAILED' AND l.instance_id IS NULL
              AND (l.attempts >= $2 OR l.lease_until > now() + interval '1 year')
              AND r.status = 'PENDING' AND r.mode = 'PROCEDURE'
            ORDER BY l.created_at
            LIMIT $3
            FOR UPDATE OF l, r SKIP LOCKED`,
          [CRM_ORDER_CREDIT_SOURCE_TYPE, PROCEDURE_START_MAX_ATTEMPTS, limit],
        )
      ).rows;
      for (const row of failed) {
        await client.query(`UPDATE crm_schema.order_credit_requests SET mode = 'DIRECT', updated_at = now() WHERE id = $1`, [row.request_id]);
        await client.query(
          `UPDATE crm_schema.procedure_links SET status = 'CLOSED', lease_token = NULL, lease_until = NULL, updated_at = now() WHERE id = $1`,
          [row.link_id],
        );
        await client.query(`UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1`, [row.order_id]);
        const cause = row.last_error ? ` (${row.last_error})` : '';
        const reason = `Không tạo được phiên Quy trình duyệt vượt hạn mức${cause}; chuyển sang duyệt trực tiếp trong Bán hàng.`.slice(0, 2000);
        await writeAuditLog(client, {
          entityType: SALES_ORDER_AUDIT_ENTITY,
          entityId: row.order_id,
          action: 'credit-redirect',
          actorId: null,
          reason,
          metadata: { code: row.code, creditRequestId: row.request_id, procedureLinkId: row.link_id },
        });
        const payload: CrmOrderCreditApprovalRedirectedPayload = {
          orderId: row.order_id,
          orderCode: row.code,
          creditRequestId: row.request_id,
          actorUserId: null,
          recipientUserIds: [row.created_by],
          summary: `Đơn ${row.code}: ${reason}`.slice(0, 500),
          deepLink: salesOrderDeepLink(row.order_id),
        };
        await writeCrmOutbox(client, tenantId, {
          type: CRM_ORDER_CREDIT_APPROVAL_REDIRECTED,
          aggregateType: 'crm-order',
          aggregateId: row.order_id,
          payload,
        });
      }
      return failed.length;
    });
  }
}

async function readSnapshot(client: CrmSqlClient, customerId: string, orderId: string): Promise<CreditSnapshot> {
  const result = await client.query<{ code: string; credit_limit: string | null; balance: string; approved: string | null }>(
    `SELECT c.code, c.credit_limit,
            (SELECT COALESCE(sum(e.amount), 0) FROM crm_schema.receivable_entries e WHERE e.customer_id = c.id) AS balance,
            (SELECT max(r.order_amount) FROM crm_schema.order_credit_requests r
              WHERE r.order_id = $2 AND r.status = 'APPROVED') AS approved
       FROM crm_schema.customers c WHERE c.id = $1`,
    [customerId, orderId],
  );
  const row = result.rows[0];
  return {
    customerCode: row?.code ?? '',
    creditLimit: row?.credit_limit === null || row?.credit_limit === undefined ? null : num(row.credit_limit),
    balance: num(row?.balance),
    approvedAmount: row?.approved === null || row?.approved === undefined ? null : num(row.approved),
  };
}

async function moveToDraft(client: CrmSqlClient, orderId: string, code: string, action: string, reason: string, actorId: string | null) {
  await client.query(
    `UPDATE crm_schema.sales_orders
        SET status = 'DRAFT', revision = revision + 1, updated_at = now(), updated_by = COALESCE($2, updated_by)
      WHERE id = $1`,
    [orderId, actorId],
  );
  await writeAuditLog(client, {
    entityType: SALES_ORDER_AUDIT_ENTITY,
    entityId: orderId,
    fromStatus: 'CREDIT_PENDING',
    toStatus: 'DRAFT',
    action,
    actorId,
    reason: reason.slice(0, 2000),
    metadata: { code },
  });
}

/** Ghi quyết định cho yêu cầu đang chờ (trong transaction của bên gọi). */
async function decideRequest(
  client: CrmSqlClient,
  requestId: string,
  decision: { readonly approve: boolean; readonly actorId: string | null; readonly note: string | null },
): Promise<'applied' | 'ignored'> {
  const request = (
    await client.query<{ order_id: string; status: string }>(
      `SELECT order_id, status FROM crm_schema.order_credit_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    )
  ).rows[0];
  if (!request || request.status !== 'PENDING') return 'ignored';
  const locked = await lockOrder(client, request.order_id, null);
  if (locked.status !== 'CREDIT_PENDING') {
    await client.query(`UPDATE crm_schema.order_credit_requests SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [requestId]);
    return 'ignored';
  }
  await client.query(
    `UPDATE crm_schema.order_credit_requests
        SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, updated_at = now()
      WHERE id = $1`,
    [requestId, decision.approve ? 'APPROVED' : 'REJECTED', decision.actorId, decision.note?.slice(0, 2000) ?? null],
  );
  if (decision.approve) {
    await writeAuditLog(client, {
      entityType: SALES_ORDER_AUDIT_ENTITY,
      entityId: request.order_id,
      action: 'credit-approve',
      actorId: decision.actorId,
      reason: decision.note ?? 'Duyệt vượt hạn mức công nợ',
      metadata: { code: locked.code, creditRequestId: requestId },
    });
    await client.query(`UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1`, [request.order_id]);
  } else {
    await moveToDraft(client, request.order_id, locked.code, 'credit-reject', decision.note ?? 'Từ chối duyệt vượt hạn mức công nợ', decision.actorId);
  }
  return 'applied';
}

/** Huỷ đơn đang chờ duyệt hạn mức: yêu cầu đang chờ huỷ theo, liên kết Quy trình đóng. */
export async function cancelPendingCreditRequests(client: CrmSqlClient, orderId: string): Promise<void> {
  const closed = await client.query<{ id: string }>(
    `UPDATE crm_schema.order_credit_requests SET status = 'CANCELLED', updated_at = now()
      WHERE order_id = $1 AND status = 'PENDING' RETURNING id`,
    [orderId],
  );
  if (!closed.rows.length) return;
  await client.query(
    `UPDATE crm_schema.procedure_links SET status = 'CLOSED', lease_until = NULL, updated_at = now()
      WHERE source_type = $1 AND source_id = ANY($2::uuid[]) AND status IN ('START_PENDING', 'RUNNING', 'FAILED')`,
    [CRM_ORDER_CREDIT_SOURCE_TYPE, closed.rows.map((row) => row.id)],
  );
}

/**
 * Áp kết quả `procedure.instance.completed` (sourceType `crm_order_credit`):
 * hoàn tất thì yêu cầu Đã duyệt (bên gọi giữ hàng, xác nhận đơn sau commit); từ
 * chối, huỷ thì đơn về Nháp. Nhận trùng, đến muộn thì bỏ qua.
 */
export async function applyOrderCreditProcedureResult(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureCompletedPayload,
): Promise<{ readonly orderId: string; readonly approved: boolean } | 'ignored'> {
  if (payload.sourceType !== CRM_ORDER_CREDIT_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const status = payload.status;
  if (status !== 'completed' && status !== 'rejected' && status !== 'cancelled') return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const link = (
      await client.query<{ source_id: string; status: string; instance_id: string | null; instance_code: string | null }>(
        `SELECT source_id, status, instance_id, instance_code FROM crm_schema.procedure_links
          WHERE id = $1 AND source_type = $2 FOR UPDATE`,
        [linkId, CRM_ORDER_CREDIT_SOURCE_TYPE],
      )
    ).rows[0];
    if (!link || link.status === 'APPLIED' || link.status === 'CLOSED') return 'ignored';
    if (link.instance_id && payload.instanceId && link.instance_id !== payload.instanceId) return 'ignored';
    const approve = status === 'completed';
    const code = payload.instanceCode ?? link.instance_code;
    const note = approve
      ? `Theo quy trình ${code ?? ''}`.trim()
      : (payload.reason?.trim() || payload.comment?.trim() || (status === 'rejected' ? 'Quy trình từ chối duyệt vượt hạn mức.' : 'Hồ sơ Quy trình đã bị huỷ.')).slice(0, 2000);
    await client.query(
      `UPDATE crm_schema.procedure_links
          SET status = 'APPLIED', result = $2, result_reason = $3, instance_id = COALESCE(instance_id, $4::uuid),
              instance_code = COALESCE(instance_code, $5), lease_until = NULL, lease_token = NULL, last_error = NULL, updated_at = now()
        WHERE id = $1`,
      [linkId, status, approve ? null : note, isUuid(payload.instanceId) ? payload.instanceId : null, payload.instanceCode ?? null],
    );
    const request = (
      await client.query<{ order_id: string }>(`SELECT order_id FROM crm_schema.order_credit_requests WHERE id = $1`, [link.source_id])
    ).rows[0];
    if (!request) return 'ignored';
    const outcome = await decideRequest(client, link.source_id, {
      approve,
      actorId: isUuid(payload.actorId) ? payload.actorId : null,
      note,
    });
    return outcome === 'applied' ? { orderId: request.order_id, approved: approve } : 'ignored';
  });
}

function toRequest(row: RequestRow): OrderCreditRequest {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    orderAmount: num(row.order_amount),
    balance: num(row.balance),
    creditLimit: num(row.credit_limit),
    message: row.message,
    decidedBy: row.decided_by,
    decidedAt: toIso(row.decided_at),
    decisionNote: row.decision_note,
    procedureInstanceCode: row.instance_code,
    createdAt: toIso(row.created_at) ?? '',
  };
}
