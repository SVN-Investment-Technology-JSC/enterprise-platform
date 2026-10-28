import { randomUUID } from 'node:crypto';
import type { QuoteStatus } from '@enterprise-platform/contracts-crm';
import type { ApprovalLinks, ProcedureClient } from '../application/quote-store.port.js';
import { CrmError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { canQuoteSystemTransition, QUOTE_PROCEDURE_REVERSED_REASON } from '../domain/quote.js';
import type { CrmDatabase } from './crm.database.js';
import { PROCEDURE_REJECTED, type ProcedureInstanceState } from './http-procedure-client.js';
import { applyDecision, CRM_QUOTE_SOURCE_TYPE, lockVersionById } from './postgres-quote.store.js';

/** Số lần thử tạo phiên tối đa trước khi bỏ (lỗi hạ tầng). */
export const PROCEDURE_START_MAX_ATTEMPTS = 30;
/** Một tiến trình giữ liên kết tối đa chừng này giây khi đang gọi Quy trình. */
const LEASE_SECONDS = 30;

/** Liên kết đang chạy quá chừng này phút mà chưa có kết quả thì hỏi lại Quy trình (T3-20). */
export const PROCEDURE_RECONCILE_AFTER_MINUTES = 5;

/** Đọc trạng thái hồ sơ để đối soát (`HttpProcedureClient.instanceStatuses`). */
export interface ProcedureStatusReader {
  instanceStatuses(tenantId: string, ids: readonly string[]): Promise<ProcedureInstanceState[]>;
}

/** Kết quả hồ sơ Quy trình theo `procedure.instance.completed`. */
const RESULTS: Readonly<Record<string, 'completed' | 'rejected' | 'cancelled'>> = {
  completed: 'completed',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

/** Payload của `procedure.instance.completed` mà Bán hàng đọc. */
export interface ProcedureCompletedPayload {
  readonly instanceId?: string;
  readonly instanceCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly status?: string;
  readonly actorId?: string;
  readonly reason?: string;
  readonly comment?: string;
}

/** Payload của `procedure.instance.reversed` mà Bán hàng đọc. */
export interface ProcedureReversedPayload {
  readonly instanceId?: string;
  readonly instanceCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly reason?: string;
  readonly reversedBy?: string;
  readonly actorUserId?: string;
}

/**
 * Liên kết báo giá ↔ phiên Quy trình (mẫu `finance/.../procedure-links.store.ts`).
 *
 * `start` tạo phiên cho một liên kết sau khi gửi duyệt đã commit: giành lease
 * ngắn để hai tiến trình không cùng gọi, gọi `POST /v1/internal/instances` với
 * khoá `crm:<id>` (Quy trình chặn phiên trùng khi gọi lại). Lỗi ghi vào liên
 * kết (FAILED) để worker thử lại; Quy trình từ chối dữ liệu thì không thử lại.
 */
export class PostgresApprovalLinks implements ApprovalLinks {
  constructor(
    private readonly database: CrmDatabase,
    private readonly procedures: ProcedureClient,
  ) {}

  async start(tenantId: string, linkId: string): Promise<void> {
    const pool = await this.database.pool(tenantId);
    const lease = randomUUID();
    const claimed = await pool.query<{
      id: string;
      source_type: 'crm_quote' | 'crm_order_credit';
      definition_id: string;
      title: string;
      initiated_by: string;
      start_idempotency_key: string;
    }>(
      `UPDATE crm_schema.procedure_links
          SET lease_token = $2, lease_until = now() + ($3 || ' seconds')::interval, attempts = attempts + 1, updated_at = now()
        WHERE id = $1 AND instance_id IS NULL AND status IN ('START_PENDING', 'FAILED')
          AND attempts < $4 AND (lease_until IS NULL OR lease_until < now())
        RETURNING id, source_type, definition_id, title, initiated_by, start_idempotency_key`,
      [linkId, lease, String(LEASE_SECONDS), PROCEDURE_START_MAX_ATTEMPTS],
    );
    const link = claimed.rows[0];
    if (!link) return;
    try {
      const instance = await this.procedures.startInstance(tenantId, {
        definitionId: link.definition_id,
        title: link.title,
        sourceType: link.source_type,
        sourceId: link.id,
        idempotencyKey: link.start_idempotency_key,
        initiatedBy: link.initiated_by,
        // Người lập là vai S của bước đầu: Quy trình tự hoàn tất bước đó.
        autoCompleteInitiatorStep: true,
      });
      await pool.query(
        `UPDATE crm_schema.procedure_links
            SET instance_id = COALESCE(instance_id, $3::uuid), instance_code = COALESCE(instance_code, $4),
                status = CASE WHEN status IN ('START_PENDING', 'FAILED') THEN 'RUNNING' ELSE status END,
                last_error = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
          WHERE id = $1 AND (lease_token = $2 OR lease_token IS NULL)`,
        [linkId, lease, instance.id, instance.code],
      );
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Không tạo được phiên Quy trình.').slice(0, 2000);
      const permanent = error instanceof CrmError && error.code === PROCEDURE_REJECTED;
      await pool.query(
        `UPDATE crm_schema.procedure_links
            SET status = 'FAILED', last_error = $3, lease_token = NULL,
                lease_until = CASE WHEN $4 THEN now() + interval '100 years' ELSE NULL END, updated_at = now()
          WHERE id = $1 AND lease_token = $2`,
        [linkId, lease, message, permanent],
      );
    }
  }

  /** Worker: tạo phiên cho các liên kết đang chờ hoặc lỗi tạm (hết lease). Trả số liên kết đã thử. */
  async sync(tenantId: string, limit = 20): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const due = await pool.query<{ id: string }>(
      `SELECT id FROM crm_schema.procedure_links
        WHERE status IN ('START_PENDING', 'FAILED') AND instance_id IS NULL AND attempts < $1
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY created_at
        LIMIT $2`,
      [PROCEDURE_START_MAX_ATTEMPTS, limit],
    );
    for (const row of due.rows) await this.start(tenantId, row.id);
    return due.rows.length;
  }
}

/**
 * Đối soát khi lỡ mất sự kiện kết quả (T3-20, mẫu `processFinanceProcedureSync`
 * của Tài chính): liên kết đã có phiên, còn Đang chạy quá
 * `PROCEDURE_RECONCILE_AFTER_MINUTES` phút thì hỏi Quy trình. Hồ sơ đã kết thúc
 * (hoàn tất, từ chối, huỷ) trả về payload như `procedure.instance.completed`
 * để bên gọi áp đúng như consumer (báo giá, duyệt vượt hạn mức); còn chạy hoặc
 * không thấy thì đẩy mốc `updated_at` để lần sau mới hỏi lại.
 */
export async function reconcileRunningLinks(
  database: CrmDatabase,
  reader: ProcedureStatusReader,
  tenantId: string,
  limit = 50,
): Promise<ProcedureCompletedPayload[]> {
  const pool = await database.pool(tenantId);
  const stale = (
    await pool.query<{ id: string; source_type: string; instance_id: string }>(
      `SELECT id, source_type, instance_id FROM crm_schema.procedure_links
        WHERE status = 'RUNNING' AND instance_id IS NOT NULL
          AND updated_at < now() - make_interval(mins => $1)
        ORDER BY updated_at
        LIMIT $2`,
      [PROCEDURE_RECONCILE_AFTER_MINUTES, Math.min(limit, 100)],
    )
  ).rows;
  if (!stale.length) return [];
  const states = new Map((await reader.instanceStatuses(tenantId, stale.map((row) => row.instance_id))).map((state) => [state.instanceId, state]));
  const finished: ProcedureCompletedPayload[] = [];
  const waiting: string[] = [];
  for (const row of stale) {
    const state = states.get(row.instance_id);
    if (state && RESULTS[state.status]) {
      finished.push({
        instanceId: row.instance_id,
        instanceCode: state.instanceCode ?? undefined,
        sourceType: row.source_type,
        sourceId: row.id,
        status: state.status,
        actorId: state.lastActorId ?? undefined,
      });
    } else {
      waiting.push(row.id);
    }
  }
  if (waiting.length) {
    await pool.query(`UPDATE crm_schema.procedure_links SET updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'RUNNING'`, [waiting]);
  }
  return finished;
}

/**
 * Áp kết quả `procedure.instance.completed` (sourceType `crm_quote`) vào báo
 * giá trong một transaction: hoàn tất thì Đã duyệt; từ chối hoặc huỷ thì Từ
 * chối duyệt kèm lý do. Nhận trùng hoặc đến muộn (liên kết đã áp, đã đóng;
 * phiên bản không còn Chờ duyệt; phiên khác) thì bỏ qua.
 */
export async function applyQuoteProcedureResult(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureCompletedPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_QUOTE_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const result = RESULTS[payload.status ?? ''];
  if (!result) return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const linkResult = await client.query<{ source_id: string; status: string; instance_id: string | null; instance_code: string | null }>(
      `SELECT source_id, status, instance_id, instance_code FROM crm_schema.procedure_links
        WHERE id = $1 AND source_type = $2 FOR UPDATE`,
      [linkId, CRM_QUOTE_SOURCE_TYPE],
    );
    const link = linkResult.rows[0];
    if (!link || link.status === 'APPLIED' || link.status === 'CLOSED') return 'ignored';
    if (link.instance_id && payload.instanceId && link.instance_id !== payload.instanceId) return 'ignored';

    const reason =
      result === 'completed'
        ? null
        : (payload.reason?.trim() || payload.comment?.trim() || (result === 'rejected' ? 'Quy trình từ chối duyệt.' : 'Hồ sơ Quy trình đã bị huỷ.')).slice(0, 2000);
    await client.query(
      `UPDATE crm_schema.procedure_links
          SET result = $2, result_reason = $3, instance_id = COALESCE(instance_id, $4::uuid),
              instance_code = COALESCE(instance_code, $5), lease_until = NULL, lease_token = NULL, updated_at = now()
        WHERE id = $1`,
      [linkId, result, reason, isUuid(payload.instanceId) ? payload.instanceId : null, payload.instanceCode ?? null],
    );
    const locked = await lockVersionById(client, link.source_id);
    if (!locked || locked.status !== 'PENDING') {
      await client.query(`UPDATE crm_schema.procedure_links SET status = 'CLOSED', updated_at = now() WHERE id = $1`, [linkId]);
      return 'ignored';
    }
    const to: QuoteStatus = result === 'completed' ? 'APPROVED' : 'REJECTED';
    const code = payload.instanceCode ?? link.instance_code;
    await applyDecision(
      client,
      tenantId,
      locked,
      { from: 'PENDING', to: to as 'APPROVED' | 'REJECTED', action: to === 'APPROVED' ? 'approve' : 'reject', reason: reason ?? (code ? `Theo quy trình ${code}` : 'Theo quy trình duyệt') },
      isUuid(payload.actorId) ? payload.actorId : null,
      { procedureLinkId: linkId, instanceId: payload.instanceId ?? link.instance_id, instanceCode: code, result },
    );
    await client.query(
      `UPDATE crm_schema.procedure_links SET status = 'APPLIED', last_error = NULL, updated_at = now() WHERE id = $1`,
      [linkId],
    );
    return 'applied';
  });
}

/**
 * Quy trình thu hồi phiên duyệt báo giá (`procedure.instance.reversed`,
 * sourceType `crm_quote`, T3-19): báo giá chưa chuyển hợp đồng, phiên bản đã
 * duyệt theo phiên này vẫn là phiên bản hiện tại ở Đã duyệt hoặc Đã gửi khách
 * thì về Từ chối duyệt với lý do "Quy trình đã thu hồi" và ghi nhật ký. Báo giá
 * đã chuyển hợp đồng thì Quy trình đã bị chặn từ `reversal-check`; nếu vẫn tới
 * thì bỏ qua. Nhận lặp: liên kết đã ghi `result = reversed` thì bỏ qua.
 */
export async function applyQuoteProcedureReversed(
  database: CrmDatabase,
  tenantId: string,
  payload: ProcedureReversedPayload,
): Promise<'applied' | 'ignored'> {
  if (payload.sourceType !== CRM_QUOTE_SOURCE_TYPE || !isUuid(payload.sourceId)) return 'ignored';
  const linkId = payload.sourceId;
  return database.transaction(tenantId, async (client) => {
    const link = (
      await client.query<{ source_id: string; status: string; result: string | null; instance_id: string | null; instance_code: string | null }>(
        `SELECT source_id, status, result, instance_id, instance_code FROM crm_schema.procedure_links
          WHERE id = $1 AND source_type = $2 FOR UPDATE`,
        [linkId, CRM_QUOTE_SOURCE_TYPE],
      )
    ).rows[0];
    if (!link || link.result === 'reversed' || link.result !== 'completed') return 'ignored';
    if (link.instance_id && payload.instanceId && link.instance_id !== payload.instanceId) return 'ignored';
    const detail = payload.reason?.trim();
    const reason = `${QUOTE_PROCEDURE_REVERSED_REASON}${detail ? `: ${detail}` : ''}`.slice(0, 2000);
    await client.query(
      `UPDATE crm_schema.procedure_links SET result = 'reversed', result_reason = $2, updated_at = now() WHERE id = $1`,
      [linkId, reason],
    );
    const locked = await lockVersionById(client, link.source_id);
    if (!locked || !canQuoteSystemTransition('PROCEDURE_REVERSED', locked.status, 'REJECTED')) return 'ignored';
    const converted = await client.query(`SELECT 1 FROM crm_schema.quotes WHERE id = $1 AND converted_at IS NOT NULL`, [locked.quoteId]);
    if (converted.rows.length) return 'ignored';
    const actor = isUuid(payload.reversedBy) ? payload.reversedBy : isUuid(payload.actorUserId) ? payload.actorUserId : null;
    await applyDecision(
      client,
      tenantId,
      locked,
      { from: locked.status, to: 'REJECTED', action: 'procedure-reversed', reason },
      actor,
      { procedureLinkId: linkId, instanceId: payload.instanceId ?? link.instance_id, instanceCode: payload.instanceCode ?? link.instance_code },
    );
    return 'applied';
  });
}
