import type { Pool } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { hrmTransaction } from './hrm-transaction.js';
import { transitionLeave } from './hrm-leave-operations.js';
import { approveOvertime } from './hrm-overtime.js';
import { approveShiftChange } from './hrm-shift-change.js';
import { assertOpenRange, isoDate, lockEmployee } from './hrm-time.js';

const tables: Record<string, string> = {
  LEAVE: 'leave_requests',
  OT: 'ot_requests',
  SHIFT_CHANGE: 'shift_change_requests',
};
const systemActor = '00000000-0000-4000-8000-000000000001';
type ResultPayload = {
  instanceId: string;
  sourceType: string;
  sourceId: string;
  status: string;
};

/** Persist a verified correlation before applying business effects; failures remain retryable. */
export async function receiveHrmWorkflowResult(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
) {
  const payload = event.payload as ResultPayload;
  if (
    event.type !== 'procedure.instance.completed' ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenantId ||
    payload?.sourceType !== 'hrm_request'
  )
    return;
  if (!['completed', 'rejected', 'cancelled'].includes(payload.status))
    throw new Error('Kết quả Procedure không hợp lệ');
  const updated = await pool.query(
    `UPDATE hrm_schema.workflow_links SET callback_event=$4,last_error=NULL,attempted_at=NULL WHERE tenant_id=$1 AND id=$2 AND instance_id=$3 AND status NOT IN ('APPLIED','IGNORED') AND (callback_event IS NULL OR callback_event->>'id'=$5) RETURNING id`,
    [
      tenantId,
      payload.sourceId,
      payload.instanceId,
      JSON.stringify(event),
      event.id,
    ],
  );
  if (!updated.rowCount) {
    const existing = (
      await pool.query(
        `SELECT instance_id,status,callback_event FROM hrm_schema.workflow_links WHERE tenant_id=$1 AND id=$2`,
        [tenantId, payload.sourceId],
      )
    ).rows[0];
    if (
      existing?.instance_id === payload.instanceId &&
      ['APPLIED', 'IGNORED'].includes(existing.status)
    )
      return;
    // A completion can arrive before the create response is committed; let the broker retry.
    throw new Error(
      'Kết quả Procedure không khớp liên kết HRM hoặc đang chờ xác nhận khởi tạo',
    );
  }
}

export async function processHrmWorkflows(pool: Pool, tenantId: string) {
  const candidates = await pool.query(
    `SELECT id FROM hrm_schema.workflow_links WHERE tenant_id=$1 AND status NOT IN ('APPLIED','IGNORED') AND (instance_id IS NULL OR callback_event IS NOT NULL) AND (attempted_at IS NULL OR attempted_at<now()-interval '1 minute') ORDER BY created_at LIMIT 10`,
    [tenantId],
  );
  for (const candidate of candidates.rows) {
    try {
      await hrmTransaction(pool, async (db) => {
        const link = (
          await db.query(
            `SELECT * FROM hrm_schema.workflow_links WHERE tenant_id=$1 AND id=$2 AND status NOT IN ('APPLIED','IGNORED') FOR UPDATE SKIP LOCKED`,
            [tenantId, candidate.id],
          )
        ).rows[0];
        if (!link) return;
        const table = tables[link.request_kind];
        if (!table) throw new Error('Loại đơn chưa hỗ trợ kết nối Procedure');
        const request = (
          await db.query(
            `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [tenantId, link.request_id],
          )
        ).rows[0];
        if (
          !request ||
          ['CANCELLED', 'REJECTED', 'APPROVED'].includes(request.status)
        ) {
          await db.query(
            `UPDATE hrm_schema.workflow_links SET status='IGNORED',applied_at=now(),last_error=NULL WHERE id=$1`,
            [link.id],
          );
          return;
        }
        if (!link.instance_id) {
          if (!process.env.INTERNAL_SERVICE_TOKEN)
            throw new Error('Chưa cấu hình INTERNAL_SERVICE_TOKEN');
          const employee = (
            await db.query(
              `SELECT employee_code,full_name FROM hrm_schema.employee_directory WHERE tenant_id=$1 AND employee_id=$2`,
              [tenantId, request.employee_id],
            )
          ).rows[0];
          const response = await fetch(
            `${process.env.PROCEDURE_API_URL || 'http://localhost:3334/api/procedure'}/v1/internal/instances`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-tenant-id': tenantId,
                'x-service-token': process.env.INTERNAL_SERVICE_TOKEN,
              },
              body: JSON.stringify({
                definitionId: link.definition_id,
                title: `HRM ${link.request_kind} · ${employee?.employee_code || ''} ${employee?.full_name || request.employee_id} · ${isoDate(request.work_date || request.from_date)}`,
                sourceType: 'hrm_request',
                sourceId: link.id,
                idempotencyKey: link.id,
              }),
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!response.ok)
            throw new Error(`Procedure trả mã ${response.status}`);
          const result = (await response.json()) as {
            id?: string;
            code?: string;
            data?: { id?: string; code?: string };
          };
          const instance = result.data || result;
          if (!instance.id || !/^[0-9a-f-]{36}$/i.test(instance.id))
            throw new Error('Procedure không trả ID hồ sơ hợp lệ');
          await db.query(
            `UPDATE hrm_schema.workflow_links SET instance_id=$2,instance_code=$3,status='RUNNING',attempts=attempts+1,attempted_at=now(),last_error=NULL WHERE id=$1`,
            [link.id, instance.id, instance.code || ''],
          );
          return;
        }
        if (!link.callback_event) return;
        const event =
          link.callback_event as IntegrationEventEnvelope<ResultPayload>;
        if (
          event.payload.instanceId !== link.instance_id ||
          event.payload.sourceId !== link.id ||
          event.tenantId !== tenantId
        )
          throw new Error('Callback sai đối tượng');
        const target =
          event.payload.status === 'completed' ? 'APPROVED' : 'REJECTED';
        await db.query(`SELECT set_config('hrm.workflow_callback',$1,true)`, [
          link.id,
        ]);
        if (link.request_kind === 'LEAVE')
          await transitionLeave(
            db,
            tenantId,
            systemActor,
            link.request_id,
            target,
            'Kết quả Procedure Engine',
          );
        else if (target === 'APPROVED') {
          if (link.request_kind === 'OT')
            await approveOvertime(db, tenantId, systemActor, link.request_id);
          else
            await approveShiftChange(
              db,
              tenantId,
              systemActor,
              link.request_id,
            );
        } else {
          await lockEmployee(db, tenantId, request.employee_id);
          await assertOpenRange(
            db,
            tenantId,
            isoDate(request.work_date || request.from_date),
            isoDate(request.work_date || request.to_date),
          );
          await db.query(
            `UPDATE hrm_schema.${table} SET status='REJECTED',approved_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
            [tenantId, link.request_id, systemActor],
          );
        }
        await db.query(
          `INSERT INTO hrm_schema.workflow_callbacks(tenant_id,event_id,link_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [tenantId, event.id, link.id],
        );
        await db.query(
          `UPDATE hrm_schema.workflow_links SET status='APPLIED',applied_at=now(),attempted_at=now(),last_error=NULL WHERE id=$1`,
          [link.id],
        );
      });
    } catch (error) {
      await pool.query(
        `UPDATE hrm_schema.workflow_links SET status='FAILED',attempts=attempts+1,attempted_at=now(),last_error=$3 WHERE tenant_id=$1 AND id=$2 AND status NOT IN ('APPLIED','IGNORED')`,
        [
          tenantId,
          candidate.id,
          error instanceof Error ? error.message : 'Lỗi kết nối Procedure',
        ],
      );
    }
  }
}
