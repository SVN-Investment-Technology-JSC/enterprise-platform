import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { approvalAudienceOf, type ApprovalAudience } from './hrm-direct-approvers.js';

/**
 * Quyền duyệt từng loại đơn khi đơn đi theo chế độ DIRECT (không qua Procedure Engine).
 * Khớp với quyền mà các endpoint `/:id/approve` đòi hỏi.
 */
export const HRM_APPROVAL_PERMISSIONS: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'hrm.request.approve',
  ot: 'hrm.request.approve',
  business_trip: 'hrm.request.approve',
  shift_change: 'hrm.request.approve',
  correction: 'hrm.request.approve',
  advance: 'hrm.request.approve',
  profile_correction: 'hrm.request.approve',
  custom: 'hrm.request.approve',
};

const REQUEST_LABELS: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'nghỉ phép',
  ot: 'làm thêm giờ',
  business_trip: 'công tác',
  shift_change: 'đổi ca',
  correction: 'chỉnh sửa chấm công',
  advance: 'tạm ứng lương',
  profile_correction: 'chỉnh sửa hồ sơ',
  custom: 'đề nghị',
};

/** Trạng thái đơn đang chờ người duyệt xử lý (cùng tập mà màn Phê duyệt lọc). */
const AWAITING_APPROVAL = new Set(['PENDING', 'PEER_CONFIRMED']);

export function isAwaitingApproval(status: unknown): boolean {
  return AWAITING_APPROVAL.has(String(status));
}

export interface ApprovalRequestedEventInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly requestKind: HrmRequestKind;
  readonly employeeName: string;
  readonly actorUserId: string;
  /** Người được giao duyệt theo tổ chức (quản lý trực tiếp, chức danh dự phòng); nhận thông báo dù không giữ quyền duyệt HRM. */
  readonly recipientUserIds?: readonly string[];
  /** Mọi cấp trên của chủ đơn; chỉ người trong số này giữ quyền duyệt mới được báo. */
  readonly scopeUserIds?: readonly string[];
}

/**
 * Trường người nhận dùng chung cho thông báo "đơn cần duyệt" và "chủ đơn trả lời" (chính sách `permissions-in-payload`
 * có `scopedUserField`). Ai duyệt được đơn:
 * - duyệt toàn tenant (`.all`, `hrm.manage`): giải theo quyền khi gửi, vì danh sách người giữ quyền có thể đổi giữa lúc
 *   tạo đơn và lúc gửi;
 * - người được giao theo tổ chức: ghi thẳng vào `recipientUserIds` vì họ duyệt không cần quyền;
 * - cấp trên gián tiếp: chỉ duyệt khi giữ `hrm.request.approve`, nên `scopeUserIds` là ứng viên và worker giữ lại người
 *   giữ quyền. Người giữ quyền mà đơn nằm ngoài phạm vi cấp dưới của họ không được báo.
 */
export function approvalRecipientFields(kind: HrmRequestKind, audience: { assigned: readonly string[]; superiors: readonly string[] }, exclude: string) {
  const approve = HRM_APPROVAL_PERMISSIONS[kind];
  return {
    approvalPermissions: [`${approve}.all`, 'hrm.manage'],
    scopePermissions: [approve],
    scopeUserIds: audience.superiors.filter((userId) => userId !== exclude),
    recipientUserIds: audience.assigned.filter((userId) => userId !== exclude),
  };
}

export function approvalRequestedEvent(input: ApprovalRequestedEventInput) {
  return createIntegrationEvent({
    id: randomUUID(),
    type: 'hrm.approval.requested',
    version: 1,
    tenantId: input.tenantId,
    source: 'hrm',
    correlationId: input.requestId,
    payload: {
      requestId: input.requestId,
      requestKind: input.requestKind,
      ...approvalRecipientFields(
        input.requestKind,
        { assigned: input.recipientUserIds ?? [], superiors: input.scopeUserIds ?? [] },
        input.actorUserId,
      ),
      summary: `Đơn ${REQUEST_LABELS[input.requestKind]} của ${input.employeeName} đang chờ bạn phê duyệt.`,
      actorUserId: input.actorUserId,
    },
  });
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Báo cho người có quyền duyệt khi một đơn DIRECT vừa vào hàng chờ. Gọi trong cùng transaction
 * với việc tạo đơn để sự kiện chỉ tồn tại khi đơn tồn tại. Đơn đi qua Procedure đã được báo bằng
 * `procedure.assignment.created`, không gọi hàm này cho chúng.
 */
export async function notifyApproversOfDirectRequest(
  db: Queryable,
  input: Omit<ApprovalRequestedEventInput, 'employeeName' | 'recipientUserIds' | 'scopeUserIds'> & {
    readonly employeeId: string;
  },
  resolveAudience: (
    db: Queryable,
    tenantId: string,
    kind: HrmRequestKind,
    requestId: string,
    employeeId: string,
  ) => Promise<ApprovalAudience> = (q, tenantId, kind, requestId, employeeId) =>
    approvalAudienceOf(q as Parameters<typeof approvalAudienceOf>[0], tenantId, kind, requestId, employeeId),
): Promise<void> {
  const employee = await db.query(
    'SELECT full_name FROM core_schema.employees WHERE tenant_id=$1 AND id=$2',
    [input.tenantId, input.employeeId],
  );
  const audience = await resolveAudience(db, input.tenantId, input.requestKind, input.requestId, input.employeeId);
  const event = approvalRequestedEvent({
    ...input,
    employeeName: (employee.rows[0] as { full_name?: string } | undefined)?.full_name ?? 'một nhân viên',
    recipientUserIds: audience.assigned,
    scopeUserIds: audience.superiors,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'hrm-request', $2, $3, $4, $5::jsonb, $6)`,
    [
      event.id,
      event.correlationId,
      event.type,
      event.version,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
}
