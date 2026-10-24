import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { approvalRecipientFields, HRM_APPROVAL_PERMISSIONS } from './hrm-approval-notification.js';
import { assignedRequestIds, participatesInProcedureOfRequest, type Queryable } from './hrm-approval-policy.js';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { approvalAudienceOf } from './hrm-direct-approvers.js';

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
  /** Trạng thái hiện tại của đơn; thiếu thì coi như đơn còn mở. */
  readonly status?: string;
}

/** Đơn đã huỷ/rút: luồng trao đổi đóng hẳn. */
const THREAD_CLOSED = new Set(['CANCELLED']);
/** Đơn đã có kết quả cuối: chỉ còn ý kiến kèm quyết định (ghi ngay sau khi duyệt), không trao đổi thêm. */
const THREAD_FINALIZED = new Set(['APPROVED', 'REJECTED', 'DISBURSED', 'REPAID']);

/** Luồng trao đổi chỉ đọc khi đơn đã huỷ/rút hoặc đã hoàn tất xử lý. */
export function isThreadClosed(status: string | undefined): boolean {
  return status !== undefined && (THREAD_CLOSED.has(status) || THREAD_FINALIZED.has(status));
}

export function assertThreadOpen(status: string | undefined, commentKind: 'COMMENT' | 'DECISION'): void {
  if (status === undefined) return;
  if (THREAD_CLOSED.has(status) || (THREAD_FINALIZED.has(status) && commentKind !== 'DECISION'))
    throw new ConflictException({
      code: 'HRM_COMMENT_CLOSED',
      message: THREAD_CLOSED.has(status)
        ? 'Đơn đã huỷ hoặc rút nên không thể trao đổi thêm.'
        : 'Đơn đã hoàn tất xử lý nên không thể trao đổi thêm.',
    });
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
    `SELECT r.employee_id, r.status, e.user_id, e.full_name
       FROM hrm_schema.${table} r
       JOIN core_schema.employees e ON e.tenant_id = r.tenant_id AND e.id = r.employee_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, requestId],
  );
  const row = found.rows[0] as { employee_id: string; status?: string; user_id: string | null; full_name: string } | undefined;
  if (!row)
    throw new NotFoundException({ code: 'HRM_REQUEST_NOT_FOUND', message: 'Không tìm thấy đơn.' });
  return { employeeId: row.employee_id, employeeName: row.full_name, userId: row.user_id, ...(row.status ? { status: row.status } : {}) };
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
  try {
    const assigned = await assignedRequestIds(db, tenantId, kind, actor.userId);
    if (assigned.includes(requestId)) return 'APPROVER';
  } catch {
    // Bỏ qua lỗi kết nối Procedure Engine hoặc fallback để tiếp tục kiểm tra mention
  }
  // Người đã/sắp xử lý hoặc được uỷ quyền trong quy trình của đơn (chưa tới lượt) vẫn cùng trao đổi.
  if (await participatesInProcedureOfRequest(db, tenantId, kind, requestId, actor.userId)) return 'PARTICIPANT';
  const mentioned = await db.query(
    `SELECT 1 FROM hrm_schema.request_comments
      WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND deleted_at IS NULL AND $4::uuid = ANY(mention_user_ids) LIMIT 1`,
    [tenantId, kind, requestId, actor.userId],
  );
  return mentioned.rows.length ? 'PARTICIPANT' : null;
}

export interface CommentAttachment {
  readonly id: string;
  readonly name: string;
  readonly contentType?: string;
  readonly sizeBytes?: number;
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
  attachments?: CommentAttachment[];
  created_at: Date | string;
}

export async function listComments(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  viewerUserId: string,
) {
  let rows: CommentRow[];
  try {
    const res = await db.query(
      `SELECT id, request_kind, request_id, author_user_id, author_name, kind, decision, body, mention_user_ids, attachments, created_at
         FROM hrm_schema.request_comments
        WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [tenantId, kind, requestId],
    );
    rows = res.rows as CommentRow[];
  } catch (err) {
    if ((err as { code?: string })?.code === '42703') {
      const res = await db.query(
        `SELECT id, request_kind, request_id, author_user_id, author_name, kind, decision, body, mention_user_ids, created_at
           FROM hrm_schema.request_comments
          WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND deleted_at IS NULL
          ORDER BY created_at, id`,
        [tenantId, kind, requestId],
      );
      rows = res.rows as CommentRow[];
    } else {
      throw err;
    }
  }
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
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    createdAt: new Date(r.created_at).toISOString(),
    mine: r.author_user_id === viewerUserId,
  }));
}

/** Người dùng được nhắc phải là nhân viên có tài khoản trong tenant; id lạ bị bỏ qua. */
/**
 * Những người có thể được nhắc tên (@) trên một đơn: chủ đơn, người tạo hộ, người được giao duyệt theo cấu hình, và
 * người đã tham gia luồng trao đổi (đã viết hoặc đã được nhắc). Không phải mọi nhân viên của tenant.
 */
export async function mentionableUserIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  owner: RequestOwner,
): Promise<Set<string>> {
  const people = new Set<string>();
  if (owner.userId) people.add(owner.userId);
  const submitted = await db.query(
    `SELECT to_jsonb(r)->>'submitted_by' AS submitted_by FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} r WHERE r.tenant_id = $1 AND r.id = $2`,
    [tenantId, requestId],
  );
  const by = submitted.rows[0]?.submitted_by;
  if (typeof by === 'string' && UUID.test(by)) people.add(by);
  for (const id of (await approvalAudienceOf(db, tenantId, kind, requestId, owner.employeeId)).assigned) people.add(id);
  const thread = await db.query(
    `SELECT author_user_id, mention_user_ids FROM hrm_schema.request_comments
      WHERE tenant_id = $1 AND request_kind = $2 AND request_id = $3 AND deleted_at IS NULL`,
    [tenantId, kind, requestId],
  );
  for (const row of thread.rows as { author_user_id: string; mention_user_ids: string[] | null }[]) {
    people.add(row.author_user_id);
    for (const id of row.mention_user_ids ?? []) people.add(id);
  }
  return people;
}

export async function validMentions(
  db: Queryable,
  tenantId: string,
  authorUserId: string,
  ids: readonly unknown[] | undefined,
  allowed?: ReadonlySet<string>,
): Promise<string[]> {
  const unique = [...new Set((ids ?? []).filter((v): v is string => typeof v === 'string' && UUID.test(v)))].filter(
    (id) => id !== authorUserId,
  );
  if (unique.length > MAX_MENTIONS)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: `Chỉ nhắc tối đa ${MAX_MENTIONS} người một lần.` });
  if (!unique.length) return [];
  if (allowed && unique.some((id) => !allowed.has(id)))
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: 'Chỉ nhắc được người liên quan tới đơn: chủ đơn, người duyệt và người đã tham gia trao đổi.',
    });
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
  readonly attachments?: readonly CommentAttachment[];
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
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const inserted = await db.query(
    `INSERT INTO hrm_schema.request_comments
       (tenant_id, request_kind, request_id, author_user_id, author_name, kind, decision, body, mention_user_ids, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10::jsonb) RETURNING id, created_at`,
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
      JSON.stringify(attachments),
    ],
  );
  const created = inserted.rows[0] as { id: string; created_at: Date | string };
  const label = KIND_LABELS[input.kind];
  const who = input.actor.name || 'Một người dùng';
  const decisionText = input.decision ? DECISION_LABELS[input.decision] : undefined;
  const fileNotice = attachments.length ? ` [Đính kèm ${attachments.length} tệp]` : '';
  const summary = decisionText
    ? `${who} ${decisionText} đơn ${label} của ${input.owner.employeeName}: ${excerpt(input.body)}${fileNotice}`
    : `${who} trao đổi về đơn ${label} của ${input.owner.employeeName}: ${excerpt(input.body)}${fileNotice}`;
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
  // `comment` cho giao diện cuộn tới và làm nổi đúng tin nhắn khi mở từ chuông thông báo.
  const linkQuery = `request=${encodeURIComponent(input.requestId)}&comment=${encodeURIComponent(created.id)}`;
  const approvalsLink = `/modules/hrm/approvals?${linkQuery}`;
  const requestsLink = `/modules/hrm/requests?${linkQuery}`;

  if (input.mentionUserIds.length) {
    const ownerMentioned = Boolean(input.owner.userId && input.mentionUserIds.includes(input.owner.userId));
    const otherMentions = input.mentionUserIds.filter((id) => id !== input.owner.userId);

    if (ownerMentioned && input.owner.userId) {
      await insertEvent(
        db,
        createIntegrationEvent({
          ...base,
          id: randomUUID(),
          type: 'hrm.request.comment.mentioned',
          version: 1,
          payload: { ...common, mentionedUserIds: [input.owner.userId], deepLink: requestsLink },
        }),
      );
    }
    if (otherMentions.length) {
      await insertEvent(
        db,
        createIntegrationEvent({
          ...base,
          id: randomUUID(),
          type: 'hrm.request.comment.mentioned',
          version: 1,
          payload: { ...common, mentionedUserIds: otherMentions, deepLink: approvalsLink },
        }),
      );
    }
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
    // Quản lý trực tiếp và người dự phòng có thể không giữ quyền duyệt HRM nên được báo thẳng, không chỉ theo quyền.
    const audience = await approvalAudienceOf(db, input.tenantId, input.kind, input.requestId, input.owner.employeeId);
    await insertEvent(
      db,
      createIntegrationEvent({
        ...base,
        id: randomUUID(),
        type: 'hrm.request.comment.to-approvers',
        version: 1,
        payload: {
          ...common,
          ...approvalRecipientFields(input.kind, audience, input.actor.userId),
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
export async function searchMentionCandidates(
  db: Queryable,
  tenantId: string,
  query: string,
  excludeUserId: string,
  allowed: ReadonlySet<string>,
) {
  if (!allowed.size) return [];
  const res = await db.query(
    `SELECT e.user_id, e.full_name, p.employee_code, d.department_name
       FROM core_schema.employees e
       LEFT JOIN hrm_schema.employee_profiles p ON p.tenant_id = e.tenant_id AND p.employee_id = e.id AND p.deleted_at IS NULL
       LEFT JOIN hrm_schema.employee_directory d ON d.tenant_id = e.tenant_id AND d.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.user_id IS NOT NULL AND e.user_id <> $2
        AND e.user_id = ANY($3::uuid[])
      ORDER BY e.full_name
      LIMIT 2000`,
    [tenantId, excludeUserId, [...allowed]],
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
