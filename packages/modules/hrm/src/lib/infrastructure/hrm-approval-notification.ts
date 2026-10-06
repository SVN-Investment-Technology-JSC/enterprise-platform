import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';

/**
 * Quyền duyệt từng loại đơn khi đơn đi theo chế độ DIRECT (không qua Procedure Engine).
 * Khớp với quyền mà các endpoint `/:id/approve` đòi hỏi.
 */
export const HRM_APPROVAL_PERMISSIONS: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'hrm.leave.approve',
  ot: 'hrm.ot.approve',
  business_trip: 'hrm.trip.approve',
  shift_change: 'hrm.shift.approve',
  correction: 'hrm.attendance.approve',
  advance: 'hrm.advance.approve',
  profile_correction: 'hrm.profile.approve',
};

const REQUEST_LABELS: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'nghỉ phép',
  ot: 'làm thêm giờ',
  business_trip: 'công tác',
  shift_change: 'đổi ca',
  correction: 'chỉnh sửa chấm công',
  advance: 'tạm ứng lương',
  profile_correction: 'chỉnh sửa hồ sơ',
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
}

/**
 * Người duyệt không được liệt kê ở đây mà để notification-worker giải theo quyền khi gửi:
 * danh sách ai đang giữ quyền duyệt có thể đổi giữa lúc tạo đơn và lúc gửi thông báo.
 * `hrm.manage` luôn được tính vì HRM coi nó thoả mọi quyền HRM.
 */
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
      approvalPermissions: [HRM_APPROVAL_PERMISSIONS[input.requestKind], 'hrm.manage'],
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
  input: Omit<ApprovalRequestedEventInput, 'employeeName'> & { readonly employeeId: string },
): Promise<void> {
  const employee = await db.query(
    'SELECT full_name FROM core_schema.employees WHERE tenant_id=$1 AND id=$2',
    [input.tenantId, input.employeeId],
  );
  const event = approvalRequestedEvent({
    ...input,
    employeeName: (employee.rows[0] as { full_name?: string } | undefined)?.full_name ?? 'một nhân viên',
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
