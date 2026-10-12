import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { inTransaction } from '@enterprise-platform/adapter-database';
import {
  createIntegrationEvent,
  type IntegrationEventEnvelope,
} from '@enterprise-platform/contracts-integration';
import {
  PROJECT_REQUEST_STATUSES,
  WORKSPACE_PROJECT_REQUEST_REGISTERED,
  WORKSPACE_PROJECT_REQUEST_REJECTED,
  type ProjectRequestRegisteredPayload,
  type ProjectRequestRejectedPayload,
  type ProjectRequestStatus,
} from '@enterprise-platform/contracts-workspace';

/**
 * Nhận đơn từ của module khác qua sự kiện.
 *
 * Module gửi (HRM) không ghi vào Workspace: nó chỉ phát payload. Workspace tự
 * kiểm người gửi có tham gia dự án, tự sinh mã DTxxx rồi báo lại bằng sự kiện
 * của chính mình. Mọi thứ — chống trùng, ghi đơn, phát sự kiện trả lời — nằm
 * trong một transaction: nhận lại cùng sự kiện không sinh mã thứ hai, và không
 * có đơn nào được ghi mà quên báo lại.
 */

export const WORKSPACE_INTEGRATION_QUEUE = 'workspace.integrations.v1';

/** Sự kiện Workspace lắng nghe. Khai tại chỗ: không phụ thuộc hợp đồng của HRM. */
export const HRM_PROJECT_REQUEST_SUBMITTED = 'hrm.project_request.submitted';
export const HRM_PROJECT_REQUEST_UPDATED = 'hrm.project_request.updated';
/**
 * Module nguồn từ chối yêu cầu huỷ hiệu lực sau khi đã qua bước kiểm trước
 * (vd vừa chốt kỳ lương): ghi lỗi lên đơn để người dùng thấy và xử lý.
 */
export const HRM_REQUEST_REVERSAL_FAILED = 'hrm.request.reversal_failed';
export const PROCEDURE_INSTANCE_REVERSAL_FAILED = 'procedure.instance.reversal_failed';
export const WORKSPACE_INTEGRATION_BINDINGS = [
  HRM_PROJECT_REQUEST_SUBMITTED,
  HRM_PROJECT_REQUEST_UPDATED,
  HRM_REQUEST_REVERSAL_FAILED,
  PROCEDURE_INSTANCE_REVERSAL_FAILED,
] as const;

interface ReversalFailedPayload {
  /** Đơn từ của dự án đã gửi yêu cầu (có khi yêu cầu xuất phát từ tab Đơn từ). */
  readonly projectRequestId?: string;
  readonly reason: string;
}

interface SubmittedPayload {
  readonly requestKind: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly requesterUserId: string;
  readonly requesterName?: string;
  readonly requestTypeLabel: string;
  readonly fromDate?: string | null;
  readonly toDate?: string | null;
  readonly submittedAt: string;
  readonly launchUrl?: string;
  readonly status: string;
  readonly version: number;
  /** Đơn tự gắn theo một đơn công tác (người gửi không chọn dự án). */
  readonly viaRequestKind?: string | null;
  readonly viaRequestId?: string | null;
}

interface UpdatedPayload {
  readonly requestKind: string;
  readonly requestId: string;
  readonly status: string;
  readonly version: number;
  readonly procedureInstanceId?: string | null;
  readonly procedureInstanceCode?: string | null;
  readonly changedAt?: string;
  /** Lý do kèm trạng thái (huỷ hiệu lực). */
  readonly reason?: string | null;
}

/** Vai trò được gửi đơn cho dự án — cùng luật tạo việc: tối thiểu `member`. */
const SUBMITTER_ROLES = new Set(['owner', 'manager', 'member']);
const CLOSED_PROJECT_STATUSES = new Set(['completed', 'cancelled']);

function asStatus(value: unknown): ProjectRequestStatus | undefined {
  return PROJECT_REQUEST_STATUSES.find((status) => status === value);
}

function dateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Xử lý một sự kiện; trả `false` nếu sự kiện đã được xử lý trước đó. */
export async function receiveWorkspaceIntegrationEvent(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const fresh = await client.query(
      `INSERT INTO integration_schema.inbox_messages (consumer, event_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id`,
      [WORKSPACE_INTEGRATION_QUEUE, event.id],
    );
    if (fresh.rowCount === 0) return false;
    if (event.type === HRM_PROJECT_REQUEST_SUBMITTED) {
      await registerRequest(client, tenantId, event.source, event.payload as SubmittedPayload);
    } else if (event.type === HRM_PROJECT_REQUEST_UPDATED) {
      await updateRequest(client, event.source, event.payload as UpdatedPayload);
    } else if (
      event.type === HRM_REQUEST_REVERSAL_FAILED ||
      event.type === PROCEDURE_INSTANCE_REVERSAL_FAILED
    ) {
      const failed = event.payload as ReversalFailedPayload;
      if (failed?.projectRequestId && /^[0-9a-f-]{36}$/i.test(failed.projectRequestId)) {
        await client.query(
          `UPDATE workspace_schema.project_requests
              SET reversal_error = $2, updated_at = now()
            WHERE id = $1 AND status = 'APPROVED' AND reversal_requested_at IS NOT NULL`,
          [failed.projectRequestId, String(failed.reason ?? 'Module nguồn từ chối huỷ hiệu lực.').slice(0, 1000)],
        );
      }
    }
    return true;
  });
}

async function registerRequest(
  client: PoolClient,
  tenantId: string,
  sourceModule: string,
  payload: SubmittedPayload,
): Promise<void> {
  const source = { sourceKind: payload.requestKind, sourceId: payload.requestId };

  // Nhận lại sự kiện cũ (phát lại sau sự cố): báo lại đúng mã đã cấp.
  const existing = await client.query(
    `SELECT r.id, r.code, p.id AS project_id, p.code AS project_code, p.name AS project_name
       FROM workspace_schema.project_requests r
       JOIN workspace_schema.projects p ON p.id = r.project_id
      WHERE r.source_module = $1 AND r.source_kind = $2 AND r.source_id = $3 AND r.project_id = $4`,
    [sourceModule, payload.requestKind, payload.requestId, payload.projectId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    await writeReply(client, tenantId, WORKSPACE_PROJECT_REQUEST_REGISTERED, row.id, {
      ...source,
      projectRequestId: row.id,
      code: row.code,
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
    } satisfies ProjectRequestRegisteredPayload);
    return;
  }

  const reject = (reason: string) =>
    writeReply(client, tenantId, WORKSPACE_PROJECT_REQUEST_REJECTED, payload.requestId, {
      ...source,
      projectId: payload.projectId,
      reason,
    } satisfies ProjectRequestRejectedPayload);

  const status = asStatus(payload.status);
  if (!status) return reject('Trạng thái đơn không hợp lệ.');
  const project = (
    await client.query(
      `SELECT id, code, name, status FROM workspace_schema.projects WHERE id = $1`,
      [payload.projectId],
    )
  ).rows[0];
  if (!project) return reject('Dự án không tồn tại.');
  if (CLOSED_PROJECT_STATUSES.has(project.status)) return reject('Dự án đã đóng.');
  const member = (
    await client.query(
      `SELECT role FROM workspace_schema.project_members WHERE project_id = $1 AND user_id = $2`,
      [project.id, payload.requesterUserId],
    )
  ).rows[0];
  if (!member || !SUBMITTER_ROLES.has(member.role)) {
    return reject('Người gửi đơn không tham gia dự án này.');
  }

  // Cùng cách sinh mã CVxxx: khoá theo dự án rồi đọc MAX, để hai đơn đến cùng
  // lúc không nhận chung một mã.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `workspace-project-request-code:${project.id}`,
  ]);
  const next = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1 AS next
       FROM workspace_schema.project_requests WHERE project_id = $1`,
    [project.id],
  );
  const code = `DT${String(Number(next.rows[0]?.next) || 1).padStart(3, '0')}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO workspace_schema.project_requests
       (project_id, code, source_module, source_kind, source_id, request_type_label,
        requester_user_id, requester_name, from_date, to_date, status, source_version,
        launch_url, submitted_at, status_changed_at, linked_via_kind, linked_via_source_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16)
     RETURNING id`,
    [
      project.id,
      code,
      sourceModule,
      payload.requestKind,
      payload.requestId,
      String(payload.requestTypeLabel ?? '').slice(0, 120) || 'Đơn từ',
      payload.requesterUserId,
      payload.requesterName?.slice(0, 255) ?? null,
      dateOnly(payload.fromDate),
      dateOnly(payload.toDate),
      status,
      Number(payload.version) || 0,
      payload.launchUrl?.slice(0, 500) ?? null,
      payload.submittedAt ?? new Date().toISOString(),
      payload.viaRequestKind?.slice(0, 40) ?? null,
      payload.viaRequestId ?? null,
    ],
  );
  const id = inserted.rows[0]?.id as string;
  await writeReply(client, tenantId, WORKSPACE_PROJECT_REQUEST_REGISTERED, id, {
    ...source,
    projectRequestId: id,
    code,
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
  } satisfies ProjectRequestRegisteredPayload);
}

async function updateRequest(
  client: PoolClient,
  sourceModule: string,
  payload: UpdatedPayload,
): Promise<void> {
  const status = asStatus(payload.status);
  if (!status) return;
  // Chỉ nhận phiên bản mới hơn: sự kiện đến trễ không kéo trạng thái lùi lại.
  // Đơn chưa đăng ký (bị từ chối) thì không có dòng nào để cập nhật.
  await client.query(
    `UPDATE workspace_schema.project_requests
        SET status = $4::text,
            source_version = $5::int,
            procedure_instance_id = COALESCE($6::uuid, procedure_instance_id),
            procedure_instance_code = COALESCE($7::text, procedure_instance_code),
            status_changed_at = CASE WHEN status <> $4::text THEN COALESCE($8::timestamptz, now()) ELSE status_changed_at END,
            status_note = $9::text,
            -- Đã huỷ hiệu lực xong thì yêu cầu đang chờ (nếu có) không còn lỗi.
            reversal_error = CASE WHEN $4::text = 'REVERSED' THEN NULL ELSE reversal_error END,
            updated_at = now()
      WHERE source_module = $1 AND source_kind = $2 AND source_id = $3::uuid AND source_version < $5::int`,
    [
      sourceModule,
      payload.requestKind,
      payload.requestId,
      status,
      Number(payload.version) || 0,
      payload.procedureInstanceId ?? null,
      payload.procedureInstanceCode ?? null,
      payload.changedAt ?? null,
      typeof payload.reason === 'string' ? payload.reason.slice(0, 1000) : null,
    ],
  );
}

async function writeReply(
  client: PoolClient,
  tenantId: string,
  type: string,
  aggregateId: string,
  payload: ProjectRequestRegisteredPayload | ProjectRequestRejectedPayload,
): Promise<void> {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    version: 1,
    tenantId,
    source: 'workspace',
    correlationId: payload.sourceId,
    payload,
  });
  await client.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'workspace-project-request', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, aggregateId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/** Bảng đơn từ đã có chưa (migration đã chạy) — worker hỏi module, không tự đọc schema. */
export async function projectRequestsReady(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ relation: string | null }>(
    `SELECT to_regclass('workspace_schema.project_requests')::text AS relation`,
  );
  return Boolean(result.rows[0]?.relation);
}

/** Sự kiện thuộc luồng đơn từ (không phải liên kết công việc ↔ quy trình). */
export function isProjectRequestEvent(type: string): boolean {
  return (WORKSPACE_INTEGRATION_BINDINGS as readonly string[]).includes(type);
}
