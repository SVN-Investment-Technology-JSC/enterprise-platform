import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { HrmTerminalStatus } from '@enterprise-platform/contracts-hrm';
import { hrmTransaction } from './hrm-transaction.js';
import {
  HRM_REQUEST_TABLES,
  normalizeHrmRequestKind,
} from './hrm-procedure-links.js';
import { startHrmProcedure } from './hrm-procedure-bridge.service.js';
import { fetchProcedureStatuses } from './hrm-procedure-api.js';
import {
  clearProcedureStepProgress,
  procedureProgressSchemaReady,
  processHrmProcedureStepInbox,
  writeProcedureStepProgress,
} from './hrm-procedure-progress.js';
import { applyHrmRequestResult } from './hrm-request-transition.js';

export const HRM_PROCEDURE_SYSTEM_ACTOR_ID =
  '00000000-0000-4000-8000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Người duyệt thật từ sự kiện PE; thiếu / không phải UUID / là actor hệ thống thì dùng actor kỹ thuật. */
export function resolveProcedureApproverId(actorId?: string | null): string {
  return typeof actorId === 'string' &&
    uuid.test(actorId) &&
    actorId.toLowerCase() !== HRM_PROCEDURE_SYSTEM_ACTOR_ID
    ? actorId
    : HRM_PROCEDURE_SYSTEM_ACTOR_ID;
}
type ResultPayload = {
  instanceId: string;
  sourceType: string;
  sourceId: string;
  status: 'completed' | 'rejected' | 'cancelled';
  actorId?: string;
  revision?: number;
};
const targets: Record<ResultPayload['status'], HrmTerminalStatus> = {
  completed: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
};

/** Acknowledge only after durable receipt, even when the start response has not arrived. */
export async function receiveHrmProcedureResult(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<void> {
  const payload = event.payload as ResultPayload;
  if (
    event.type !== 'procedure.instance.completed' ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenantId
  )
    return;
  if (!payload || !['manual', 'hrm_request'].includes(payload.sourceType))
    return;
  if (
    !uuid.test(event.id) ||
    !uuid.test(payload.instanceId) ||
    !uuid.test(payload.sourceId) ||
    !Object.hasOwn(targets, payload.status)
  )
    throw new Error('Kết quả Procedure không hợp lệ');
  await pool.query(
    `INSERT INTO hrm_schema.procedure_result_inbox(tenant_id,event_id,instance_id,source_type,source_id,event)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,event_id) DO NOTHING`,
    [
      tenantId,
      event.id,
      payload.instanceId,
      payload.sourceType,
      payload.sourceId,
      JSON.stringify(event),
    ],
  );
  const saved = (
    await pool.query(
      `SELECT instance_id,source_type,source_id,event->'payload'->>'status' AS result FROM hrm_schema.procedure_result_inbox WHERE tenant_id=$1 AND event_id=$2`,
      [tenantId, event.id],
    )
  ).rows[0];
  if (
    saved.instance_id !== payload.instanceId ||
    saved.source_type !== payload.sourceType ||
    saved.source_id !== payload.sourceId ||
    saved.result !== payload.status
  )
    throw new Error('Mã sự kiện Procedure đã được dùng cho kết quả khác');
}

async function rejectInbox(
  db: PoolClient,
  tenantId: string,
  eventId: string,
  reason: string,
) {
  await db.query(
    `UPDATE hrm_schema.procedure_result_inbox SET status='REJECTED',processed_at=now(),last_error=$3 WHERE tenant_id=$1 AND event_id=$2`,
    [tenantId, eventId, reason],
  );
}

async function applyInbox(pool: Pool, tenantId: string, eventId: string) {
  let applyingLink: string | null = null;
  try {
    await hrmTransaction(pool, async (db) => {
      const inbox = (
        await db.query(
          `SELECT * FROM hrm_schema.procedure_result_inbox WHERE tenant_id=$1 AND event_id=$2 AND status IN ('PENDING','FAILED') FOR UPDATE SKIP LOCKED`,
          [tenantId, eventId],
        )
      ).rows[0];
      if (!inbox) return;
      const payload = (inbox.event as IntegrationEventEnvelope<ResultPayload>)
        .payload;
      const matches = await db.query(
        `SELECT l.* FROM hrm_schema.procedure_links l WHERE l.tenant_id=$1 AND EXISTS (
        SELECT 1 FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id
          AND c.instance_id=$2 AND c.source_type=$3 AND c.source_id=$4) FOR UPDATE`,
        [tenantId, inbox.instance_id, inbox.source_type, inbox.source_id],
      );
      if (matches.rows.length !== 1) {
        const awaiting = (
          await db.query(
            `SELECT id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND source_type=$2 AND source_id=$3
          AND instance_id IS NULL AND sync_status IN ('START_PENDING','FAILED')`,
            [tenantId, inbox.source_type, inbox.source_id],
          )
        ).rows[0];
        if (awaiting) {
          await db.query(
            `UPDATE hrm_schema.procedure_result_inbox SET link_id=$3,processed_at=now(),last_error='Chờ xác nhận khởi tạo Procedure' WHERE tenant_id=$1 AND event_id=$2`,
            [tenantId, eventId, awaiting.id],
          );
        } else
          await rejectInbox(
            db,
            tenantId,
            eventId,
            'Kết quả không khớp tenant, instance hoặc correlation HRM',
          );
        return;
      }
      const link = matches.rows[0];
      if (
        link.sync_status === 'CONFLICT' ||
        link.instance_id !== inbox.instance_id
      ) {
        await rejectInbox(
          db,
          tenantId,
          eventId,
          'Liên kết đang có xung đột; cần đối soát',
        );
        return;
      }
      const kind = normalizeHrmRequestKind(link.request_kind);
      const request = (
        await db.query(
          `SELECT * FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, link.request_id],
        )
      ).rows[0];
      const latest = (
        await db.query(
          `SELECT max(revision) AS revision FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3`,
          [tenantId, kind, link.request_id],
        )
      ).rows[0];
      if (
        !request ||
        request.employee_id !== link.employee_id ||
        Number(request.revision ?? 1) !== link.revision ||
        latest.revision !== link.revision ||
        (payload.revision !== undefined && payload.revision !== link.revision)
      ) {
        await rejectInbox(
          db,
          tenantId,
          eventId,
          'Phiên bản hoặc nhân sự của đơn đã thay đổi',
        );
        return;
      }
      const target = targets[payload.status];
      // A cancelled/rejected revision can never be resurrected by a late completion.
      if (
        ['APPROVED', 'REJECTED', 'CANCELLED', 'DISBURSED'].includes(
          request.status,
        ) &&
        request.status !== target &&
        !(request.status === 'DISBURSED' && target === 'APPROVED')
      ) {
        await rejectInbox(
          db,
          tenantId,
          eventId,
          'Kết quả đến muộn khác trạng thái đã ghi nhận',
        );
        return;
      }
      if (link.sync_status === 'APPLIED') {
        await db.query(
          `UPDATE hrm_schema.procedure_result_inbox SET link_id=$3,status='APPLIED',processed_at=now(),last_error=NULL WHERE tenant_id=$1 AND event_id=$2`,
          [tenantId, eventId, link.id],
        );
        return;
      }
      applyingLink = link.id;
      await db.query(`SELECT set_config('hrm.workflow_callback',$1,true)`, [
        link.id,
      ]);
      await applyHrmRequestResult(
        db,
        { tenantId, kind, requestId: link.request_id, revision: link.revision },
        target,
        resolveProcedureApproverId(payload.actorId),
        'Kết quả Procedure Engine',
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
        VALUES($1,$2,'PROCEDURE_RESULT_APPLIED',$3,$4,$5)`,
        [
          tenantId,
          HRM_PROCEDURE_SYSTEM_ACTOR_ID,
          kind,
          link.request_id,
          JSON.stringify({
            linkId: link.id,
            eventId,
            instanceId: link.instance_id,
            revision: link.revision,
            result: target,
            approverId:
              resolveProcedureApproverId(payload.actorId) ===
              HRM_PROCEDURE_SYSTEM_ACTOR_ID
                ? null
                : resolveProcedureApproverId(payload.actorId),
            technicalActorId: HRM_PROCEDURE_SYSTEM_ACTOR_ID,
          }),
        ],
      );
      await clearProcedureStepProgress(
        db,
        tenantId,
        link,
        payload.status === 'completed' ? 'COMPLETED' : payload.status === 'rejected' ? 'REJECTED' : 'CANCELLED',
      );
      await db.query(
        `UPDATE hrm_schema.procedure_links SET sync_status='APPLIED',result_event=$3,applied_at=now(),attempted_at=now(),last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, link.id, JSON.stringify(inbox.event)],
      );
      await db.query(
        `UPDATE hrm_schema.procedure_result_inbox SET link_id=$3,status='APPLIED',processed_at=now(),last_error=NULL WHERE tenant_id=$1 AND event_id=$2`,
        [tenantId, eventId, link.id],
      );
    });
  } catch (error) {
    const message = (
      error instanceof Error
        ? error.message
        : 'Không áp dụng được kết quả Procedure'
    ).slice(0, 2000);
    // Business writes rolled back. Record retry metadata in a separate transaction.
    await hrmTransaction(pool, async (db) => {
      const result = await db.query(
        `UPDATE hrm_schema.procedure_result_inbox SET status='FAILED',link_id=COALESCE(link_id,$3),last_error=$4,processed_at=now()
        WHERE tenant_id=$1 AND event_id=$2 AND status IN ('PENDING','FAILED') RETURNING event_id`,
        [tenantId, eventId, applyingLink, message],
      );
      if (result.rowCount && applyingLink)
        await db.query(
          `UPDATE hrm_schema.procedure_links SET sync_status='FAILED',last_error=$3,attempts=attempts+1,attempted_at=now(),updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND sync_status NOT IN ('APPLIED','CONFLICT')`,
          [tenantId, applyingLink, message],
        );
    });
  }
}

/**
 * Đối soát qua API nội bộ của Procedure (không đọc procedure_schema.*):
 * - hồ sơ đã kết thúc: đưa kết quả vào cùng hộp thư, không có đường ghi nghiệp vụ riêng;
 * - hồ sơ còn chạy: cập nhật bước hiện tại cho liên kết RUNNING khi mất sự kiện step_changed.
 */
async function reconcile(pool: Pool, tenantId: string) {
  if (!(await procedureProgressSchemaReady(pool))) return;
  const links = await pool.query(
    `SELECT l.id,l.instance_id,l.source_type,l.source_id,l.sync_status FROM hrm_schema.procedure_links l
    WHERE l.tenant_id=$1 AND l.instance_id IS NOT NULL AND l.sync_status IN ('RUNNING','APPLY_PENDING','FAILED')
      AND (l.step_reconciled_at IS NULL OR l.step_reconciled_at<now()-interval '5 minutes')
    ORDER BY l.step_reconciled_at NULLS FIRST LIMIT 50`,
    [tenantId],
  );
  if (!links.rows.length) return;
  let entries;
  try {
    entries = await fetchProcedureStatuses(
      tenantId,
      links.rows.map((row) => row.instance_id as string),
    );
  } catch {
    return; // Procedure tạm không phục vụ: lần tick sau đối soát tiếp.
  }
  const byInstance = new Map(entries.map((entry) => [entry.instanceId, entry]));
  for (const link of links.rows) {
    const entry = byInstance.get(link.instance_id);
    if (!entry) continue;
    if (['completed', 'rejected', 'cancelled'].includes(entry.status)) {
      const hex = createHash('sha256')
        .update(
          `${tenantId}:${entry.instanceId}:${entry.status}:${entry.completedAt}`,
        )
        .digest('hex');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      await receiveHrmProcedureResult(pool, tenantId, {
        id,
        type: 'procedure.instance.completed',
        version: 1,
        tenantId,
        source: 'procedure-engine',
        occurredAt: new Date().toISOString(),
        correlationId: entry.instanceId,
        payload: {
          instanceId: entry.instanceId,
          sourceType: link.source_type,
          sourceId: link.source_id,
          status: entry.status,
          actorId: entry.lastActorId,
        },
      });
      continue;
    }
    await hrmTransaction(pool, async (db) => {
      await writeProcedureStepProgress(db, tenantId, link.id, {
        stepName: entry.currentStepName,
        assigneeName: entry.currentAssigneeName,
        sequence: entry.sequence,
      });
      await db.query(
        `UPDATE hrm_schema.procedure_links SET step_reconciled_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, link.id],
      );
    });
  }
}

export async function processHrmProcedureSync(
  pool: Pool,
  tenantId: string,
): Promise<void> {
  const pending = await pool.query(
    `SELECT id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND instance_id IS NULL AND sync_status IN ('START_PENDING','FAILED')
    AND (attempted_at IS NULL OR attempted_at<now()-interval '1 minute') AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 10`,
    [tenantId],
  );
  for (const link of pending.rows)
    await startHrmProcedure(pool, link.id, tenantId);
  await reconcile(pool, tenantId);
  await processHrmProcedureStepInbox(pool, tenantId);
  const events = await pool.query(
    `SELECT i.event_id FROM hrm_schema.procedure_result_inbox i LEFT JOIN hrm_schema.procedure_links l ON l.tenant_id=i.tenant_id AND l.id=i.link_id
    WHERE i.tenant_id=$1 AND (i.status='PENDING' OR (i.status='FAILED' AND (l.attempted_at IS NULL OR l.attempted_at<now()-interval '1 minute')))
    ORDER BY i.received_at LIMIT 100`,
    [tenantId],
  );
  for (const event of events.rows)
    await applyInbox(pool, tenantId, event.event_id);
}
