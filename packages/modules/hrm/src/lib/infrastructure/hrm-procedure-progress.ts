import type { Pool, PoolClient } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { hrmTransaction } from './hrm-transaction.js';
import {
  HRM_REQUEST_TABLES,
  normalizeHrmRequestKind,
} from './hrm-procedure-links.js';

/**
 * FIX-E-02: ghi tiến độ duyệt của Procedure Engine (bước hiện tại, người xử lý)
 * vào đơn HRM. Chỉ ghi cột hiển thị; KHÔNG đổi trạng thái nghiệp vụ của đơn
 * (chỉ sự kiện completed/rejected/cancelled làm việc đó, ở hrm-procedure-sync).
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STEP_CHANGED_EVENT = 'procedure.instance.step_changed';
/** Sự kiện chưa gặp được liên kết sau ngần này thì bỏ (đơn không thuộc HRM hoặc liên kết đã mất). */
const ORPHAN_EVENT_TTL = "interval '1 hour'";

export interface StepProgressInput {
  stepName?: string | null;
  assigneeName?: string | null;
  sequence: number;
}

interface LinkRef {
  id: string;
  request_kind: string;
  request_id: string;
  revision: number;
}

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

let schemaReady = false;
/**
 * Migration 0029 chưa chạy thì bỏ qua ghi tiến độ (không làm hỏng luồng kết quả/khởi tạo).
 * Chỉ nhớ kết quả dương: lần sau migration xong sẽ tự bật.
 */
export async function procedureProgressSchemaReady(db: Db): Promise<boolean> {
  if (schemaReady) return true;
  const row = (
    await db.query(
      `SELECT to_regclass('hrm_schema.procedure_step_inbox') AS inbox,
        (SELECT count(*) FROM information_schema.columns WHERE table_schema='hrm_schema'
          AND table_name='procedure_links' AND column_name='step_reconciled_at') AS col`,
    )
  ).rows[0];
  schemaReady = Boolean(row?.inbox) && Number(row?.col) > 0;
  return schemaReady;
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Ghi tiến độ lên liên kết rồi lên bảng đơn. Chỉ ghi khi `sequence` mới hơn
 * mức đã ghi (sự kiện đến muộn/lặp bị bỏ qua) và liên kết còn chạy. Trả true
 * khi có ghi.
 */
export async function writeProcedureStepProgress(
  db: Db,
  tenantId: string,
  linkId: string,
  progress: StepProgressInput,
): Promise<boolean> {
  if (!(await procedureProgressSchemaReady(db))) return false;
  const stepName = clip(progress.stepName, 100);
  const assigneeName = clip(progress.assigneeName, 500);
  const updated = (
    await db.query(
      `UPDATE hrm_schema.procedure_links
          SET current_step_name=$3,current_assignee_name=$4,current_step_seq=$5,current_step_updated_at=now(),
              step_reconciled_at=now()
        WHERE tenant_id=$1 AND id=$2 AND current_step_seq<$5 AND sync_status NOT IN ('APPLIED','CONFLICT')
        RETURNING id,request_kind,request_id,revision`,
      [tenantId, linkId, stepName, assigneeName, progress.sequence],
    )
  ).rows[0] as LinkRef | undefined;
  if (!updated) return false;
  const kind = normalizeHrmRequestKind(updated.request_kind);
  // Chỉ bản liên kết mới nhất của đơn được hiển thị (đơn có thể có nhiều revision).
  await db.query(
    `UPDATE hrm_schema.${HRM_REQUEST_TABLES[kind]} SET current_step_name=$3,current_assignee_name=$4,workflow_status='RUNNING'
      WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS (
        SELECT 1 FROM hrm_schema.procedure_links n WHERE n.tenant_id=$1 AND n.request_kind=$5 AND n.request_id=$2 AND n.revision>$6)`,
    [
      tenantId,
      updated.request_id,
      stepName,
      assigneeName,
      updated.request_kind,
      updated.revision,
    ],
  );
  return true;
}

/** Hồ sơ đã kết thúc: bỏ bước/người xử lý hiện tại, ghi mốc cuối vào workflow_status. */
export async function clearProcedureStepProgress(
  db: Db,
  tenantId: string,
  link: { id: string; request_kind: string; request_id: string; revision: number },
  outcome: 'COMPLETED' | 'REJECTED' | 'CANCELLED',
) {
  if (!(await procedureProgressSchemaReady(db))) return;
  const kind = normalizeHrmRequestKind(link.request_kind);
  await db.query(
    `UPDATE hrm_schema.procedure_links SET current_step_name=NULL,current_assignee_name=NULL WHERE tenant_id=$1 AND id=$2`,
    [tenantId, link.id],
  );
  await db.query(
    `UPDATE hrm_schema.${HRM_REQUEST_TABLES[kind]} SET current_step_name=NULL,current_assignee_id=NULL,current_assignee_name=NULL,workflow_status=$3
      WHERE tenant_id=$1 AND id=$2 AND NOT EXISTS (
        SELECT 1 FROM hrm_schema.procedure_links n WHERE n.tenant_id=$1 AND n.request_kind=$4 AND n.request_id=$2 AND n.revision>$5)`,
    [tenantId, link.request_id, outcome, link.request_kind, link.revision],
  );
}

type StepPayload = {
  instanceId: string;
  sourceType: string;
  sourceId: string;
  stepName?: string;
  assignees?: string[];
  status?: string;
  sequence: number;
};

/**
 * Nhận sự kiện step_changed: ghi hộp thư idempotent (khóa instanceId+sequence)
 * rồi áp dụng ngay. Chưa có liên kết (phản hồi tạo instance chưa về) thì giữ
 * PENDING, tick đồng bộ sẽ áp dụng lại.
 */
export async function receiveHrmProcedureStep(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<void> {
  const payload = event.payload as StepPayload;
  if (
    event.type !== STEP_CHANGED_EVENT ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenantId
  )
    return;
  if (!payload || payload.sourceType !== 'hrm_request') return;
  if (
    !uuid.test(event.id) ||
    !uuid.test(payload.instanceId) ||
    !uuid.test(payload.sourceId) ||
    !Number.isInteger(payload.sequence) ||
    payload.sequence < 1
  )
    throw new Error('Sự kiện bước Procedure không hợp lệ');
  if (!(await procedureProgressSchemaReady(pool)))
    throw new Error('HRM cần chạy migration 0029 trước khi nhận tiến độ Procedure');
  await pool.query(
    `INSERT INTO hrm_schema.procedure_step_inbox(tenant_id,instance_id,sequence,event_id,source_type,source_id,event)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,instance_id,sequence) DO NOTHING`,
    [
      tenantId,
      payload.instanceId,
      payload.sequence,
      event.id,
      payload.sourceType,
      payload.sourceId,
      JSON.stringify(event),
    ],
  );
  await applyHrmProcedureStep(pool, tenantId, payload.instanceId, payload.sequence);
}

async function settle(
  db: Db,
  tenantId: string,
  instanceId: string,
  sequence: number,
  status: 'APPLIED' | 'SKIPPED',
  linkId: string | null,
  note: string | null,
) {
  await db.query(
    `UPDATE hrm_schema.procedure_step_inbox SET status=$4,link_id=$5,processed_at=now(),last_error=$6
      WHERE tenant_id=$1 AND instance_id=$2 AND sequence=$3`,
    [tenantId, instanceId, sequence, status, linkId, note],
  );
}

export async function applyHrmProcedureStep(
  pool: Pool,
  tenantId: string,
  instanceId: string,
  sequence: number,
): Promise<void> {
  try {
    await hrmTransaction(pool, async (db) => {
      const inbox = (
        await db.query(
          `SELECT *,(received_at<now()-${ORPHAN_EVENT_TTL}) AS orphaned FROM hrm_schema.procedure_step_inbox
            WHERE tenant_id=$1 AND instance_id=$2 AND sequence=$3 AND status IN ('PENDING','FAILED') FOR UPDATE SKIP LOCKED`,
          [tenantId, instanceId, sequence],
        )
      ).rows[0];
      if (!inbox) return;
      const link = (
        await db.query(
          `SELECT l.* FROM hrm_schema.procedure_links l WHERE l.tenant_id=$1 AND EXISTS (
            SELECT 1 FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id
              AND c.instance_id=$2 AND c.source_type=$3 AND c.source_id=$4) FOR UPDATE`,
          [tenantId, instanceId, inbox.source_type, inbox.source_id],
        )
      ).rows[0];
      if (!link) {
        if (inbox.orphaned)
          await settle(db, tenantId, instanceId, sequence, 'SKIPPED', null, 'Không có liên kết HRM');
        else
          await db.query(
            `UPDATE hrm_schema.procedure_step_inbox SET last_error='Chờ xác nhận khởi tạo Procedure'
              WHERE tenant_id=$1 AND instance_id=$2 AND sequence=$3`,
            [tenantId, instanceId, sequence],
          );
        return;
      }
      const payload = (inbox.event as IntegrationEventEnvelope<StepPayload>).payload;
      // Hồ sơ đã kết thúc thì bước chỉ còn là lịch sử: trạng thái cuối do sự kiện kết quả ghi.
      if (payload.status && payload.status !== 'running') {
        await settle(db, tenantId, instanceId, sequence, 'SKIPPED', link.id, 'Hồ sơ không còn chạy');
        return;
      }
      const written = await writeProcedureStepProgress(db, tenantId, link.id, {
        stepName: payload.stepName,
        assigneeName: (payload.assignees ?? []).join(', '),
        sequence,
      });
      await settle(
        db,
        tenantId,
        instanceId,
        sequence,
        written ? 'APPLIED' : 'SKIPPED',
        link.id,
        written ? null : 'Sự kiện cũ hơn tiến độ đã ghi hoặc liên kết đã đóng',
      );
    });
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : 'Không ghi được tiến độ Procedure'
    ).slice(0, 2000);
    await pool.query(
      `UPDATE hrm_schema.procedure_step_inbox SET status='FAILED',last_error=$4,processed_at=now()
        WHERE tenant_id=$1 AND instance_id=$2 AND sequence=$3 AND status IN ('PENDING','FAILED')`,
      [tenantId, instanceId, sequence, message],
    );
  }
}

/** Tick đồng bộ: áp dụng lại sự kiện bước còn treo (liên kết về muộn hoặc lỗi tạm). */
export async function processHrmProcedureStepInbox(pool: Pool, tenantId: string) {
  if (!(await procedureProgressSchemaReady(pool))) return;
  const pending = await pool.query(
    `SELECT instance_id,sequence FROM hrm_schema.procedure_step_inbox
      WHERE tenant_id=$1 AND status IN ('PENDING','FAILED') ORDER BY received_at LIMIT 100`,
    [tenantId],
  );
  for (const row of pending.rows)
    await applyHrmProcedureStep(pool, tenantId, row.instance_id, row.sequence);
}
