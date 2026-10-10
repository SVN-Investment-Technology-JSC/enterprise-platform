import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  createIntegrationEvent,
  type IntegrationEventEnvelope,
} from '@enterprise-platform/contracts-integration';
import type {
  HrmRequestKind,
  HrmRequestProjectLink,
} from '@enterprise-platform/contracts-hrm';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { hrmTransaction } from './hrm-transaction.js';

/**
 * "Dự án liên kết" của đơn từ — một trường dùng chung, không gắn cứng vào loại đơn.
 *
 * Loại đơn nào có trường này thì gửi kèm dự án; HRM không đọc hay ghi bảng
 * của Workspace mà chỉ phát payload:
 * 1. Gửi duyệt → `hrm.project_request.submitted`.
 * 2. Workspace tự kiểm người gửi có tham gia dự án, sinh mã DTxxx và trả lời
 *    `workspace.project_request.registered` (hoặc `.rejected`).
 * 3. Nhận mã → đổi tên hồ sơ quy trình đang chờ thành `EVN-DT001-…`; hồ sơ chỉ
 *    được mở sau bước này (xem điều kiện trong `startHrmProcedure`).
 * 4. Mỗi lần trạng thái đơn đổi, trigger `trg_project_request_update` phát
 *    `hrm.project_request.updated`.
 */

/** Loại đơn đang có trường dự án. Form dynamic sau này chỉ cần thêm vào đây. */
export const PROJECT_LINKABLE_REQUEST_KINDS: ReadonlySet<HrmRequestKind> =
  new Set<HrmRequestKind>(['business_trip']);

export const HRM_PROJECT_REQUEST_SUBMITTED = 'hrm.project_request.submitted';
/** Sự kiện trả lời của Workspace. Khai tại chỗ: không phụ thuộc hợp đồng của Workspace. */
export const WORKSPACE_PROJECT_REQUEST_REGISTERED =
  'workspace.project_request.registered';
export const WORKSPACE_PROJECT_REQUEST_REJECTED =
  'workspace.project_request.rejected';
export const HRM_WORKSPACE_EVENT_BINDINGS = [
  WORKSPACE_PROJECT_REQUEST_REGISTERED,
  WORKSPACE_PROJECT_REQUEST_REJECTED,
] as const;

const INBOX_CONSUMER = 'hrm.workspace-project-requests';

/** Dự án người dùng đã chọn; mã và tên chỉ để hiển thị, Workspace gửi lại bản chuẩn. */
export interface RequestProjectInput {
  readonly id: string;
  readonly code?: string;
  readonly name?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Đọc trường dự án từ body; rỗng nghĩa là đơn không gắn dự án. */
export function readRequestProject(body: {
  projectId?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
}): RequestProjectInput | undefined {
  const id = body.projectId?.trim();
  if (!id) return undefined;
  if (!UUID.test(id)) throw new BadRequestException('Dự án không hợp lệ');
  return {
    id,
    code: body.projectCode?.trim().slice(0, 100) || undefined,
    name: body.projectName?.trim().slice(0, 255) || undefined,
  };
}

/** Đường mở đơn ở HRM, gửi kèm để Workspace không phải tự ghép. */
export function hrmRequestLaunchUrl(requestId: string): string {
  return `/modules/hrm/requests?request=${requestId}`;
}

/** Liên kết do người dùng tự chọn, hay tự gắn theo một đơn công tác. */
export type RequestProjectLinkType = 'DIRECT' | 'BUSINESS_TRIP';

/**
 * Đơn có ngày, tự hiện ở dự án của đơn công tác trùng thời gian. Ngày đọc
 * thẳng bằng `to_char` trong SQL: cột `date` qua Date của Node bị lệch múi giờ.
 */
const DATED_REQUESTS: Readonly<
  Partial<Record<HrmRequestKind, { table: string; from: string; to: string; label: string }>>
> = {
  leave: { table: 'leave_requests', from: 'from_date', to: 'to_date', label: 'Đơn nghỉ phép' },
  ot: { table: 'ot_requests', from: 'work_date', to: 'work_date', label: 'Đơn làm thêm giờ' },
  shift_change: { table: 'shift_change_requests', from: 'from_date', to: 'to_date', label: 'Đơn đổi ca' },
  correction: {
    table: 'attendance_corrections',
    from: 'request_date',
    to: 'request_date',
    label: 'Đơn giải trình công',
  },
};

/** Đơn công tác còn hiệu lực để kéo đơn khác vào dự án. */
const ACTIVE_TRIP_STATUSES = ['PENDING', 'APPROVED'];

/** Trạng thái riêng của HRM quy về bốn trạng thái Workspace hiểu được. */
function projectStatus(status: string): string {
  return ['APPROVED', 'REJECTED', 'CANCELLED'].includes(status) ? status : 'PENDING';
}

/**
 * Ghi liên kết và phát `hrm.project_request.submitted`, trong transaction gửi duyệt.
 *
 * Người được kiểm "có tham gia dự án" là **nhân viên của đơn** (tài khoản gắn
 * với hồ sơ), không phải người bấm gửi — HR gửi hộ vẫn tính theo nhân viên.
 */
export async function registerRequestProject(
  db: PoolClient,
  input: {
    readonly tenantId: string;
    readonly kind: HrmRequestKind;
    readonly requestId: string;
    readonly employeeId: string;
    readonly initiatedBy: string;
    readonly requestTypeLabel: string;
    readonly project: RequestProjectInput;
    readonly status: string;
    readonly fromDate?: string | null;
    readonly toDate?: string | null;
    readonly linkType?: RequestProjectLinkType;
    /** Đơn công tác đã kéo đơn này vào dự án (chỉ với `BUSINESS_TRIP`). */
    readonly viaRequestId?: string;
  },
): Promise<void> {
  const linkType = input.linkType ?? 'DIRECT';
  if (linkType === 'DIRECT' && !PROJECT_LINKABLE_REQUEST_KINDS.has(input.kind)) return;
  const employee = (
    await db.query(
      'SELECT user_id, full_name FROM core_schema.employees WHERE tenant_id=$1 AND id=$2',
      [input.tenantId, input.employeeId],
    )
  ).rows[0];
  const requesterUserId = String(employee?.user_id ?? input.initiatedBy);
  const requesterName = employee?.full_name ? String(employee.full_name) : null;
  const inserted = await db.query(
    `INSERT INTO hrm_schema.request_project_links
       (tenant_id, request_kind, request_id, project_id, project_code, project_name,
        requester_user_id, requester_name, request_type_label, link_type, via_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id, request_kind, request_id, project_id) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.kind,
      input.requestId,
      input.project.id,
      input.project.code ?? null,
      input.project.name ?? null,
      requesterUserId,
      requesterName,
      input.requestTypeLabel,
      linkType,
      input.viaRequestId ?? null,
    ],
  );
  if (!inserted.rowCount) return;
  const event = createIntegrationEvent({
    id: randomUUID(),
    type: HRM_PROJECT_REQUEST_SUBMITTED,
    version: 1,
    tenantId: input.tenantId,
    source: 'hrm',
    correlationId: input.requestId,
    payload: {
      requestKind: input.kind,
      requestId: input.requestId,
      projectId: input.project.id,
      requesterUserId,
      requesterName,
      requestTypeLabel: input.requestTypeLabel,
      fromDate: input.fromDate ?? null,
      toDate: input.toDate ?? null,
      submittedAt: new Date().toISOString(),
      launchUrl: hrmRequestLaunchUrl(input.requestId),
      status: projectStatus(input.status),
      version: 0,
      linkType,
      viaRequestKind: linkType === 'BUSINESS_TRIP' ? 'business_trip' : null,
      viaRequestId: input.viaRequestId ?? null,
    },
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1,'hrm-request',$2,$3,$4,$5::jsonb,$6)`,
    [
      event.id,
      input.requestId,
      event.type,
      event.version,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
}

/**
 * Đơn có ngày vừa gửi: gắn vào dự án của mọi đơn công tác (chờ duyệt hoặc đã
 * duyệt) của cùng nhân viên mà nó rơi vào — kể cả khi người tạo không chọn dự án.
 */
export async function attachRequestToOverlappingTrips(
  db: PoolClient,
  input: {
    readonly tenantId: string;
    readonly kind: HrmRequestKind;
    readonly requestId: string;
    readonly employeeId: string;
    readonly initiatedBy: string;
    readonly requestTypeLabel: string;
    readonly status: string;
  },
): Promise<void> {
  const spec = DATED_REQUESTS[input.kind];
  if (!spec) return;
  const range = (
    await db.query(
      `SELECT to_char(${spec.from},'YYYY-MM-DD') AS from_date, to_char(${spec.to},'YYYY-MM-DD') AS to_date
         FROM hrm_schema.${spec.table} WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, input.requestId],
    )
  ).rows[0];
  if (!range?.from_date) return;
  // Dự án của đơn công tác: lấy từ liên kết DIRECT của nó. Workspace đã từ chối
  // (người gửi không tham gia) thì không kéo thêm đơn nào vào dự án đó.
  const trips = await db.query(
    `SELECT DISTINCT ON (l.project_id) t.id AS trip_id, l.project_id, l.project_code, l.project_name
       FROM hrm_schema.business_trip_requests t
       JOIN hrm_schema.request_project_links l
         ON l.tenant_id=t.tenant_id AND l.request_kind='business_trip' AND l.request_id=t.id
        AND l.link_type='DIRECT' AND l.status<>'REJECTED'
      WHERE t.tenant_id=$1 AND t.employee_id=$2 AND t.status = ANY($3::text[])
        AND t.from_date <= $5::date AND t.to_date >= $4::date
      ORDER BY l.project_id, t.from_date`,
    [input.tenantId, input.employeeId, ACTIVE_TRIP_STATUSES, range.from_date, range.to_date],
  );
  for (const trip of trips.rows)
    await registerRequestProject(db, {
      ...input,
      project: {
        id: String(trip.project_id),
        code: trip.project_code ?? undefined,
        name: trip.project_name ?? undefined,
      },
      fromDate: range.from_date,
      toDate: range.to_date,
      linkType: 'BUSINESS_TRIP',
      viaRequestId: String(trip.trip_id),
    });
}

/**
 * Đơn công tác vừa gắn dự án: kéo luôn các đơn có ngày đã gửi trước đó (chưa bị
 * từ chối hay huỷ) của cùng nhân viên rơi vào thời gian công tác.
 */
export async function attachOverlappingRequestsToTrip(
  db: PoolClient,
  input: {
    readonly tenantId: string;
    readonly tripId: string;
    readonly employeeId: string;
    readonly initiatedBy: string;
    readonly project: RequestProjectInput;
    readonly fromDate: string;
    readonly toDate: string;
  },
): Promise<void> {
  for (const [kind, spec] of Object.entries(DATED_REQUESTS)) {
    if (!spec) continue;
    const rows = await db.query(
      `SELECT id, status, to_char(${spec.from},'YYYY-MM-DD') AS from_date, to_char(${spec.to},'YYYY-MM-DD') AS to_date
         FROM hrm_schema.${spec.table}
        WHERE tenant_id=$1 AND employee_id=$2 AND status NOT IN ('REJECTED','CANCELLED')
          AND ${spec.from} <= $4::date AND ${spec.to} >= $3::date`,
      [input.tenantId, input.employeeId, input.fromDate, input.toDate],
    );
    for (const row of rows.rows)
      await registerRequestProject(db, {
        tenantId: input.tenantId,
        kind: kind as HrmRequestKind,
        requestId: String(row.id),
        employeeId: input.employeeId,
        initiatedBy: input.initiatedBy,
        requestTypeLabel: spec.label,
        project: input.project,
        status: String(row.status),
        fromDate: row.from_date,
        toDate: row.to_date,
        linkType: 'BUSINESS_TRIP',
        viaRequestId: input.tripId,
      });
  }
}

/** Tên hồ sơ quy trình của đơn gắn dự án: `EVN-DT001-Đơn công tác - admin`. */
export function projectRequestProcedureTitle(input: {
  readonly projectCode?: string | null;
  readonly requestCode: string;
  readonly requestTypeLabel: string;
  readonly requesterName?: string | null;
}): string {
  const head = [input.projectCode, input.requestCode, input.requestTypeLabel]
    .filter(Boolean)
    .join('-');
  return (input.requesterName ? `${head} - ${input.requesterName}` : head).slice(
    0,
    255,
  );
}

interface RegisteredPayload {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly projectRequestId: string;
  readonly code: string;
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
}

interface RejectedPayload {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly projectId: string;
  readonly reason: string;
}

/** Nhận trả lời của Workspace; trả `false` nếu sự kiện đã xử lý. */
export async function receiveWorkspaceProjectRequestEvent(
  pool: Pool,
  tenantId: string,
  event: IntegrationEventEnvelope,
): Promise<boolean> {
  return hrmTransaction(pool, async (db) => {
    const fresh = await db.query(
      `INSERT INTO integration_schema.inbox_messages (consumer, event_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id`,
      [INBOX_CONSUMER, event.id],
    );
    if (!fresh.rowCount) return false;
    if (event.type === WORKSPACE_PROJECT_REQUEST_REGISTERED)
      await applyRegistered(db, tenantId, event.payload as RegisteredPayload);
    else if (event.type === WORKSPACE_PROJECT_REQUEST_REJECTED) {
      const payload = event.payload as RejectedPayload;
      await db.query(
        `UPDATE hrm_schema.request_project_links SET status='REJECTED', rejection_reason=$4, updated_at=now()
          WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND project_id=$5 AND status='REGISTERING'`,
        [
          tenantId,
          payload.sourceKind,
          payload.sourceId,
          String(payload.reason ?? '').slice(0, 1000),
          payload.projectId,
        ],
      );
    }
    return true;
  });
}

async function applyRegistered(
  db: PoolClient,
  tenantId: string,
  payload: RegisteredPayload,
): Promise<void> {
  const link = (
    await db.query(
      `UPDATE hrm_schema.request_project_links
          SET status='REGISTERED', project_request_id=$4, project_request_code=$5,
              project_code=$6, project_name=$7, rejection_reason=NULL, updated_at=now()
        WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND project_id=$8 AND status <> 'REGISTERED'
        RETURNING *`,
      [
        tenantId,
        payload.sourceKind,
        payload.sourceId,
        payload.projectRequestId,
        payload.code,
        payload.projectCode,
        payload.projectName,
        payload.projectId,
      ],
    )
  ).rows[0];
  if (!link) return;
  // Hồ sơ đang chờ mã DT: đổi tên trước khi worker mở nó. Chỉ liên kết người
  // dùng tự chọn mới đặt tên hồ sơ — đơn tự gắn theo công tác giữ tên của nó.
  if (link.link_type === 'DIRECT') await db.query(
    `UPDATE hrm_schema.procedure_links SET title=$4, updated_at=now()
      WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND instance_id IS NULL`,
    [
      tenantId,
      link.request_kind,
      link.request_id,
      projectRequestProcedureTitle({
        projectCode: payload.projectCode,
        requestCode: payload.code,
        requestTypeLabel: link.request_type_label,
        requesterName: link.requester_name,
      }),
    ],
  );
  const kind = link.request_kind as HrmRequestKind;
  const table = HRM_REQUEST_TABLES[kind];
  if (!table) return;
  // Trong lúc chờ đăng ký, đơn có thể đã được duyệt hay huỷ: báo trạng thái hiện tại.
  const request = (
    await db.query(
      `SELECT status, procedure_instance_id FROM hrm_schema.${table} WHERE tenant_id=$1 AND id=$2`,
      [tenantId, link.request_id],
    )
  ).rows[0];
  if (request)
    await db.query(
      'SELECT hrm_schema.emit_project_request_update($1,$2,$3,$4,$5)',
      [
        tenantId,
        kind,
        link.request_id,
        String(request.status),
        request.procedure_instance_id ?? null,
      ],
    );
}

/** Liên kết dự án của một đơn, để trả kèm khi đọc đơn. */
export async function findRequestProjectLink(
  db: Pick<Pool, 'query'>,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
): Promise<HrmRequestProjectLink | undefined> {
  const row = (
    await db.query(
      `SELECT * FROM hrm_schema.request_project_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND link_type='DIRECT'`,
      [tenantId, kind, requestId],
    )
  ).rows[0];
  return row ? mapRequestProjectLink(row) : undefined;
}

export function mapRequestProjectLink(
  row: Record<string, unknown>,
): HrmRequestProjectLink {
  return {
    projectId: String(row.project_id),
    projectCode: (row.project_code as string | null) ?? undefined,
    projectName: (row.project_name as string | null) ?? undefined,
    status: row.status as HrmRequestProjectLink['status'],
    projectRequestCode: (row.project_request_code as string | null) ?? undefined,
    rejectionReason: (row.rejection_reason as string | null) ?? undefined,
  };
}

/** Gắn `projectLink` cho cả danh sách đơn trong một lượt đọc. */
export async function attachRequestProjectLinks<T extends { readonly id: string }>(
  db: Pick<Pool, 'query'>,
  tenantId: string,
  kind: HrmRequestKind,
  items: readonly T[],
): Promise<(T & { projectLink?: HrmRequestProjectLink })[]> {
  if (!PROJECT_LINKABLE_REQUEST_KINDS.has(kind) || items.length === 0)
    return [...items];
  const rows = (
    await db.query(
      `SELECT * FROM hrm_schema.request_project_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id = ANY($3::uuid[]) AND link_type='DIRECT'`,
      [tenantId, kind, items.map((item) => item.id)],
    )
  ).rows;
  const byRequest = new Map(
    rows.map((row) => [String(row.request_id), mapRequestProjectLink(row)]),
  );
  return items.map((item) => {
    const projectLink = byRequest.get(item.id);
    return projectLink ? { ...item, projectLink } : item;
  });
}
