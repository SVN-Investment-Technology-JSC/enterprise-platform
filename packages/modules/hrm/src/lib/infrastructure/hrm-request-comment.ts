import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { HRM_APPROVAL_PERMISSIONS } from './hrm-approval-notification.js';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export const MAX_COMMENT_LENGTH = 4000;
export const MAX_MENTIONS = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loại đơn ở màn hình duyệt (chữ hoa) hoặc ở API (chữ thường) về một khoá chuẩn. */
const KIND_ALIASES: Readonly<Record<string, HrmRequestKind>> = {
  leave: 'leave',
  ot: 'ot',
  overtime: 'ot',
  business_trip: 'business_trip',
  'business-trip': 'business_trip',
  trip: 'business_trip',
  shift_change: 'shift_change',
  'shift-change': 'shift_change',
  shift: 'shift_change',
  correction: 'correction',
  attendance: 'correction',
  advance: 'advance',
  profile_correction: 'profile_correction',
  'profile-correction': 'profile_correction',
  profile: 'profile_correction',
  custom: 'custom',
};

export function normalizeRequestKind(value: unknown): HrmRequestKind {
  const kind = typeof value === 'string' ? KIND_ALIASES[value.trim().toLowerCase()] : undefined;
  if (!kind)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Loại đơn không hợp lệ.' });
  return kind;
}

const KIND_LABELS: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'nghỉ phép',
  ot: 'làm thêm giờ',
  business_trip: 'công tác',
  shift_change: 'đổi ca',
  correction: 'giải trình công',
  advance: 'tạm ứng lương',
  profile_correction: 'đính chính hồ sơ',
  custom: 'đề nghị',
};

const DECISION_LABELS: Readonly<Record<string, string>> = {
  APPROVE: 'đã phê duyệt',
  REJECT: 'đã từ chối',
  RETURN: 'đã trả lại',
  COMPLETE: 'đã hoàn thành bước xử lý của',
};

export interface CommentActor {
  readonly userId: string;
  readonly permissions?: readonly string[];
}

export interface RequestOwner {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly userId: string | null;
}

/** Chủ đơn: nhân viên của đơn và tài khoản đăng nhập của họ. */
export async function loadRequestOwner(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
): Promise<RequestOwner> {
  const table = HRM_REQUEST_TABLES[kind];
  const found = await db.query(
    `SELECT r.employee_id, e.user_id, e.full_name
       FROM hrm_schema.${table} r
       JOIN core_schema.employees e ON e.tenant_id = r.tenant_id AND e.id = r.employee_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, requestId],
  );
  const row = found.rows[0] as { employee_id: string; user_id: string | null; full_name: string } | undefined;
  if (!row)
    throw new NotFoundException({ code: 'HRM_REQUEST_NOT_FOUND', message: 'Không tìm thấy đơn.' });
  return { employeeId: row.employee_id, employeeName: row.full_name, userId: row.user_id };
}

/** Quyền xem toàn bộ đơn của tenant (không giới hạn phạm vi cấp dưới). */
export function canReadAllRequests(actor: CommentActor, kind: HrmRequestKind): boolean {
  const p = actor.permissions ?? [];
  const approve = HRM_APPROVAL_PERMISSIONS[kind];
  return (
    p.includes('hrm.manage') ||
    p.includes('tenant.manage') ||
    p.includes('hrm.request.read') ||
    p.includes('hrm.request.manage') ||
    p.includes(`${approve}.all`)
  );
}

/** Người có quyền duyệt loại đơn này (trong phạm vi hay không sẽ được kiểm tra riêng). */
export function hasApprovePermission(actor: CommentActor, kind: HrmRequestKind): boolean {
  return (actor.permissions ?? []).includes(HRM_APPROVAL_PERMISSIONS[kind]);
}

export type ThreadAccess = 'OWNER' | 'ALL' | 'APPROVER' | 'PARTICIPANT';

/**
 * Ai được đọc và viết trong luồng trao đổi của một đơn: chủ đơn; người xem được mọi đơn; người duyệt trong phạm vi
 * (`inScope` do bên gọi tính qua chính sách phạm vi duyệt); người đã được nhắc tên trong luồng.
 * Trả `null` khi không có quyền.
 */
export async function resolveThreadAccess(
  db: Queryable,
  tenantId: string,
  actor: CommentActor,
  kind: HrmRequestKind,
  requestId: string,
  owner: RequestOwner,
  inScope: () => Promise<boolean>,
): Promise<ThreadAccess | null> {
  if (owner.userId && owner.userId === actor.userId) return 'OWNER';
  if (canReadAllRequests(actor, kind)) return 'ALL';
  if (hasApprovePermission(actor, kind) && (await inScope())) return 'APPROVER';
  const mentioned = await db.query(
    `SELECT 1 FROM hrm_schema.request_comments
      WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND deleted_at IS NULL AND $4::uuid = ANY(mention_user_ids) LIMIT 1`,
    [tenantId, kind, requestId, actor.userId],
  );
  return mentioned.rows.length ? 'PARTICIPANT' : null;
}

export interface CommentRow {
  id: string;
  request_kind: HrmRequestKind;
  request_id: string;
  author_user_id: string;
  author_name: string;
  kind: 'COMMENT' | 'DECISION';
  decision: string | null;
  body: string;
  mention_user_ids: string[];
  created_at: Date | string;
}

export async function listComments(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  viewerUserId: string,
) {
  const res = await db.query(
    `SELECT id, request_kind, request_id, author_user_id, author_name, kind, decision, body, mention_user_ids, created_at
       FROM hrm_schema.request_comments
      WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND deleted_at IS NULL
      ORDER BY created_at, id`,
    [tenantId, kind, requestId],
  );
  const rows = res.rows as CommentRow[];
  const ids = [...new Set(rows.flatMap((r) => r.mention_user_ids ?? []))];
  const names = new Map<string, string>();
  if (ids.length) {
    const people = await db.query(
      `SELECT user_id, full_name FROM core_schema.employees WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    for (const p of people.rows as { user_id: string; full_name: string }[]) names.set(p.user_id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    requestKind: r.request_kind,
    requestId: r.request_id,
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    kind: r.kind,
    decision: r.decision,
    body: r.body,
    mentions: (r.mention_user_ids ?? []).map((userId) => ({ userId, name: names.get(userId) ?? 'Người dùng' })),
    createdAt: new Date(r.created_at).toISOString(),
    mine: r.author_user_id === viewerUserId,
  }));
}

/** Người dùng được nhắc phải là nhân viên có tài khoản trong tenant; id lạ bị bỏ qua. */
export async function validMentions(
  db: Queryable,
  tenantId: string,
  authorUserId: string,
  ids: readonly unknown[] | undefined,
): Promise<string[]> {
  const unique = [...new Set((ids ?? []).filter((v): v is string => typeof v === 'string' && UUID.test(v)))].filter(
    (id) => id !== authorUserId,
  );
  if (unique.length > MAX_MENTIONS)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: `Chỉ nhắc tối đa ${MAX_MENTIONS} người một lần.` });
  if (!unique.length) return [];
  const found = await db.query(
    `SELECT user_id FROM core_schema.employees WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [tenantId, unique],
  );
  return (found.rows as { user_id: string }[]).map((r) => r.user_id);
}

export function validateCommentBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Nội dung trao đổi không được để trống.' });
  if (value.length > MAX_COMMENT_LENGTH)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: `Nội dung tối đa ${MAX_COMMENT_LENGTH} ký tự.` });
  return value.trim();
}

export interface CreateCommentInput {
  readonly tenantId: string;
  readonly kind: HrmRequestKind;
  readonly requestId: string;
  readonly actor: CommentActor & { readonly name: string };
  readonly owner: RequestOwner;
  readonly access: ThreadAccess;
  readonly body: string;
  readonly mentionUserIds: readonly string[];
  readonly commentKind: 'COMMENT' | 'DECISION';
  readonly decision: string | null;
}

async function insertEvent(db: Queryable, event: ReturnType<typeof createIntegrationEvent>) {
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'hrm-request', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, event.correlationId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

const excerpt = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Ghi một dòng trao đổi và các thông báo realtime tương ứng, cùng một transaction:
 *  - người được nhắc tên nhận thông báo "được nhắc đến";
 *  - chủ đơn nhận thông báo khi người khác (người duyệt) viết;
 *  - người có quyền duyệt loại đơn nhận thông báo khi chủ đơn trả lời.
 * Người viết không tự nhận thông báo của mình (notification-worker bỏ qua actor).
 */
export async function createComment(db: Queryable, input: CreateCommentInput) {
  const inserted = await db.query(
    `INSERT INTO hrm_schema.request_comments
       (tenant_id, request_kind, request_id, author_user_id, author_name, kind, decision, body, mention_user_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[]) RETURNING id, created_at`,
    [
      input.tenantId,
      input.kind,
      input.requestId,
      input.actor.userId,
      input.actor.name,
      input.commentKind,
      input.decision,
      input.body,
      input.mentionUserIds,
    ],
  );
  const created = inserted.rows[0] as { id: string; created_at: Date | string };
  const label = KIND_LABELS[input.kind];
  const who = input.actor.name || 'Một người dùng';
  const decisionText = input.decision ? DECISION_LABELS[input.decision] : undefined;
  const summary = decisionText
    ? `${who} ${decisionText} đơn ${label} của ${input.owner.employeeName}: ${excerpt(input.body)}`
    : `${who} trao đổi về đơn ${label} của ${input.owner.employeeName}: ${excerpt(input.body)}`;
  const base = {
    tenantId: input.tenantId,
    source: 'hrm',
    correlationId: input.requestId,
  } as const;
  const common = {
    requestId: input.requestId,
    requestKind: input.kind,
    commentId: created.id,
    actorUserId: input.actor.userId,
    summary,
  };
  const approvalsLink = `/modules/hrm/approvals?request=${encodeURIComponent(input.requestId)}`;
  const requestsLink = `/modules/hrm/requests?request=${encodeURIComponent(input.requestId)}`;

  if (input.mentionUserIds.length) {
    await insertEvent(
      db,
      createIntegrationEvent({
        ...base,
        id: randomUUID(),
        type: 'hrm.request.comment.mentioned',
        version: 1,
        payload: { ...common, mentionedUserIds: input.mentionUserIds, deepLink: approvalsLink },
      }),
    );
  }
  // Chủ đơn: báo khi người khác viết (không báo khi chính họ viết).
  if (input.owner.userId && input.owner.userId !== input.actor.userId && !input.mentionUserIds.includes(input.owner.userId)) {
    await insertEvent(
      db,
      createIntegrationEvent({
        ...base,
        id: randomUUID(),
        type: 'hrm.request.comment.to-requester',
        version: 1,
        payload: { ...common, recipientUserIds: [input.owner.userId], deepLink: requestsLink },
      }),
    );
  }
  // Người duyệt: báo khi chủ đơn trả lời để người duyệt thấy phản hồi.
  if (input.owner.userId && input.owner.userId === input.actor.userId) {
    await insertEvent(
      db,
      createIntegrationEvent({
        ...base,
        id: randomUUID(),
        type: 'hrm.request.comment.to-approvers',
        version: 1,
        payload: {
          ...common,
          approvalPermissions: [HRM_APPROVAL_PERMISSIONS[input.kind], 'hrm.manage'],
          deepLink: approvalsLink,
        },
      }),
    );
  }
  return { id: created.id, createdAt: new Date(created.created_at).toISOString() };
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/**
 * Ứng viên để nhắc tên: nhân viên có tài khoản đăng nhập, tìm theo tên (không dấu) hoặc mã, tối đa 20 người.
 * Lọc ở ứng dụng vì tenant chỉ có vài trăm nhân viên và cơ sở dữ liệu không bật tiện ích bỏ dấu.
 */
export async function searchMentionCandidates(db: Queryable, tenantId: string, query: string, excludeUserId: string) {
  const res = await db.query(
    `SELECT e.user_id, e.full_name, p.employee_code, d.department_name
       FROM core_schema.employees e
       LEFT JOIN hrm_schema.employee_profiles p ON p.tenant_id = e.tenant_id AND p.employee_id = e.id AND p.deleted_at IS NULL
       LEFT JOIN hrm_schema.employee_directory d ON d.tenant_id = e.tenant_id AND d.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.user_id IS NOT NULL AND e.user_id <> $2
      ORDER BY e.full_name
      LIMIT 2000`,
    [tenantId, excludeUserId],
  );
  const needle = fold(query.trim());
  return (res.rows as { user_id: string; full_name: string; employee_code: string | null; department_name: string | null }[])
    .filter((r) => !needle || fold(`${r.full_name} ${r.employee_code ?? ''}`).includes(needle))
    .slice(0, 20)
    .map((r) => ({ userId: r.user_id, name: r.full_name, employeeCode: r.employee_code, department: r.department_name }));
}

export function assertCanWrite(access: ThreadAccess | null): asserts access is ThreadAccess {
  if (!access)
    throw new ForbiddenException({ code: 'HRM_COMMENT_FORBIDDEN', message: 'Bạn không có quyền xem hoặc trao đổi trên đơn này.' });
}
