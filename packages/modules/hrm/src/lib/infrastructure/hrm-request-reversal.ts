import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { assertLifecycleVersion, lifecycleAudit } from './hrm-lifecycle.js';
import {
  assertOpenRange,
  isoDate,
  lockEmployee,
  recalculateAttendance,
  resolvePolicy,
} from './hrm-time.js';
import { transitionLeave } from './hrm-leave-operations.js';
import { hrmTransaction } from './hrm-transaction.js';

/**
 * Caller checks the approval permission; this transaction never edits Procedure state.
 * `expectedUpdatedAt = null` chỉ dành cho lời gọi hệ thống (sự kiện huỷ hiệu lực
 * từ Procedure), nơi không có bản ghi "vừa tải" để so phiên bản.
 */
export async function reverseApprovedRequest(
  db: PoolClient,
  tenant: string,
  actor: string,
  kind: HrmRequestKind,
  id: string,
  expectedUpdatedAt: string | null,
  reason: string,
) {
  if (!['leave', 'ot', 'business_trip', 'correction', 'advance'].includes(kind))
    throw new BadRequestException(
      'Đổi ca và hồ sơ đã áp dụng cần lập đơn điều chỉnh mới, giữ lịch sử phê duyệt cũ.',
    );
  const table = HRM_REQUEST_TABLES[kind];
  const before = (
    await db.query(
      `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenant, id],
    )
  ).rows[0];
  if (!before) throw new NotFoundException('Không tìm thấy đơn trong tenant');
  await lockEmployee(db, tenant, before.employee_id);
  const prior = (
    await db.query(
      'SELECT * FROM hrm_schema.request_reversals WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3',
      [tenant, kind, id],
    )
  ).rows[0];
  if (prior) {
    if (prior.reason !== reason)
      throw new ConflictException('Đơn đã được hủy hiệu lực với lý do khác.');
    return prior;
  }
  if (expectedUpdatedAt !== null)
    assertLifecycleVersion(before, expectedUpdatedAt);
  if (before.status !== 'APPROVED')
    throw new ConflictException(
      'Chỉ hủy hiệu lực đơn đã duyệt; đơn đang chờ dùng thao tác rút đơn.',
    );
  const link = (
    await db.query(
      'SELECT sync_status FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 ORDER BY revision DESC LIMIT 1',
      [tenant, kind, id],
    )
  ).rows[0];
  if (link && link.sync_status !== 'APPLIED')
    throw new ConflictException(
      'Quy trình chưa đồng bộ xong; cần đối soát trước khi hủy hiệu lực.',
    );
  const from = isoDate(
    before.work_date || before.from_date || before.request_date,
  );
  const to = isoDate(before.to_date || before.work_date || before.request_date);
  await assertOpenRange(db, tenant, from, to);
  const payroll = await db.query(
    `SELECT 1 FROM hrm_schema.payroll_periods p WHERE p.tenant_id=$1 AND p.from_date<=$3::date AND p.to_date>=$2::date AND (p.status IN ('LOCKED','PAID') OR EXISTS(SELECT 1 FROM hrm_schema.payroll_runs r WHERE r.tenant_id=p.tenant_id AND r.payroll_period_id=p.id AND r.status='FINALIZED'))`,
    [tenant, from, to],
  );
  if (payroll.rowCount)
    throw new ConflictException(
      'Kỳ lương đã chốt; cần xử lý điều chỉnh ở kỳ sau.',
    );
  if (
    kind === 'advance' &&
    (Number(before.disbursed_amount) > 0 ||
      Number(before.total_deducted_amount) > 0 ||
      (
        await db.query(
          'SELECT 1 FROM hrm_schema.salary_advance_deductions WHERE tenant_id=$1 AND advance_request_id=$2',
          [tenant, id],
        )
      ).rowCount)
  )
    throw new ConflictException(
      'Tạm ứng đã giải ngân hoặc có lịch khấu trừ; cần đối soát thu hồi, không hủy đơn.',
    );
  if (kind === 'correction') {
    const events = (
      await db.query(
        'SELECT * FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 FOR UPDATE',
        [tenant, before.employee_id, from],
      )
    ).rows;
    const own = events.filter((e) => e.evidence?.correctionId === id);
    if (
      !own.length ||
      own.some((e) => e.voided_by_correction_id) ||
      events.some(
        (e) => !e.voided_by_correction_id && e.evidence?.correctionId !== id,
      )
    )
      throw new ConflictException(
        'Dữ liệu công đã thay đổi sau giải trình; cần gửi đơn điều chỉnh mới để đối chiếu.',
      );
    await db.query(
      'UPDATE hrm_schema.attendance_events SET voided_by_correction_id=NULL WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id=$4',
      [tenant, before.employee_id, from, id],
    );
    await db.query(
      "UPDATE hrm_schema.attendance_events SET voided_by_correction_id=$4 WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND evidence->>'correctionId'=$4::uuid::text",
      [tenant, before.employee_id, from, id],
    );
    const policy = await resolvePolicy(
      db,
      tenant,
      'ATTENDANCE',
      from,
      before.employee_id,
    );
    await recalculateAttendance(
      db,
      tenant,
      before.employee_id,
      from,
      String(policy?.config_json.timezone || 'Asia/Ho_Chi_Minh'),
      'MANUAL_CORRECTION',
    );
  }
  const reversal = (
    await db.query(
      `INSERT INTO hrm_schema.request_reversals(tenant_id,request_kind,request_id,employee_id,request_revision,before_snapshot,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenant,
        kind,
        id,
        before.employee_id,
        before.revision || 1,
        JSON.stringify(before),
        reason,
        actor,
      ],
    )
  ).rows[0];
  await db.query("SELECT set_config('hrm.business_reversal',$1,true)", [
    reversal.id,
  ]);
  if (kind === 'leave')
    await transitionLeave(db, tenant, actor, id, 'CANCELLED', reason);
  else
    await db.query(
      `UPDATE hrm_schema.${table} SET status='CANCELLED',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2`,
      [tenant, id],
    );
  await lifecycleAudit(db, tenant, actor, 'REQUEST_EFFECT_REVERSED', id, {
    kind,
    reason,
    reversalId: reversal.id,
    before,
  });
  return reversal;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

/** Đơn đứng sau hồ sơ Procedure: `sourceId` của hồ sơ chính là `procedure_links.id`. */
async function linkedRequest(db: Pick<PoolClient, 'query'>, tenant: string, linkId: string) {
  if (!uuid.test(linkId)) return undefined;
  return (
    await db.query<{ request_kind: HrmRequestKind; request_id: string }>(
      'SELECT request_kind,request_id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2',
      [tenant, linkId],
    )
  ).rows[0];
}

async function priorReversal(
  db: Pick<PoolClient, 'query'>,
  tenant: string,
  kind: string,
  id: string,
) {
  return Boolean(
    (
      await db.query(
        'SELECT 1 FROM hrm_schema.request_reversals WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3',
        [tenant, kind, id],
      )
    ).rowCount,
  );
}

function businessMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : error.message;
}

/**
 * Procedure hỏi trước khi huỷ hiệu lực hồ sơ: chạy thử đúng các bước huỷ của
 * đơn trong một transaction rồi ROLLBACK — cùng một bộ luật với lúc huỷ thật
 * (kỳ công/kỳ lương đã chốt, tạm ứng đã giải ngân...), không có bản sao luật.
 */
export async function checkLinkedReversal(
  pool: Pool,
  tenant: string,
  linkId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const link = await linkedRequest(client, tenant, linkId);
    if (!link)
      return { allowed: false, reason: 'Không tìm thấy đơn HRM của hồ sơ này.' };
    if (await priorReversal(client, tenant, link.request_kind, link.request_id))
      return { allowed: true };
    await reverseApprovedRequest(
      client,
      tenant,
      SYSTEM_ACTOR,
      link.request_kind,
      link.request_id,
      null,
      'Kiểm tra trước khi huỷ hiệu lực',
    );
    return { allowed: true };
  } catch (error) {
    const reason = businessMessage(error);
    if (reason) return { allowed: false, reason: `Đơn HRM: ${reason}` };
    throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

interface ReversedPayload {
  readonly instanceId?: string;
  readonly instanceCode?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly reason?: string;
  readonly reversedBy?: string;
}

/**
 * Procedure đã huỷ hiệu lực hồ sơ → HRM huỷ hiệu lực đơn đứng sau. Idempotent:
 * đơn đã huỷ trước đó thì bỏ qua. Luật nghiệp vụ chặn (chốt kỳ sau lúc Procedure
 * kiểm tra) không thể tự hết khi thử lại, nên ghi nhật ký rồi ack, không lặp vô hạn.
 */
export async function receiveHrmProcedureReversal(
  pool: Pool,
  tenant: string,
  event: IntegrationEventEnvelope,
): Promise<void> {
  const payload = event.payload as ReversedPayload;
  if (
    event.type !== 'procedure.instance.reversed' ||
    event.source !== 'procedure-engine' ||
    event.tenantId !== tenant ||
    payload?.sourceType !== 'hrm_request' ||
    !payload.sourceId
  )
    return;
  const link = await linkedRequest(pool, tenant, payload.sourceId);
  if (!link) return;
  const actor =
    payload.reversedBy && uuid.test(payload.reversedBy)
      ? payload.reversedBy
      : SYSTEM_ACTOR;
  const reason = `Hồ sơ ${payload.instanceCode ?? ''} bị huỷ hiệu lực: ${payload.reason ?? ''}`.trim();
  try {
    await hrmTransaction(pool, async (db) => {
      if (await priorReversal(db, tenant, link.request_kind, link.request_id))
        return;
      await reverseApprovedRequest(
        db,
        tenant,
        actor,
        link.request_kind,
        link.request_id,
        null,
        reason,
      );
    });
  } catch (error) {
    const message = businessMessage(error);
    if (!message) throw error;
    await lifecycleAudit(pool, tenant, actor, 'REQUEST_EFFECT_REVERSAL_FAILED', link.request_id, {
      kind: link.request_kind,
      instanceId: payload.instanceId,
      eventId: event.id,
      reason: message,
    });
  }
}
