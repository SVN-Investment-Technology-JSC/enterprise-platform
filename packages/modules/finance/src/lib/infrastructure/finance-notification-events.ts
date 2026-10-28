import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import {
  FINANCE_KIND_PERMISSIONS,
  FINANCE_VOUCHER_KIND_LABELS,
  formatFinanceMoney,
  type FinanceVoucherKind,
} from '@enterprise-platform/contracts-finance';
import { num, optStr, type Db } from './finance.database.js';

/**
 * Sự kiện thông báo của Tài chính, ghi vào outbox CÙNG giao dịch với thay đổi của phiếu: phiếu và thông báo cùng có hoặc cùng không.
 * Worker đẩy outbox lên RabbitMQ, notification-worker giải người nhận theo chính sách trong `notification-catalog` rồi realtime-api
 * đẩy qua socket tới đúng người dùng. Người nhận KHÔNG được liệt kê ở đây (trừ người lập): người đang giữ quyền duyệt có thể đổi
 * giữa lúc tạo phiếu và lúc gửi thông báo, nên quyền đi cùng sự kiện và được giải lúc gửi.
 */

export interface VoucherNotificationFacts {
  readonly tenantId: string;
  readonly voucherId: string;
  readonly kind: FinanceVoucherKind;
  readonly code: string;
  readonly content: string;
  readonly totalAmount: number;
  readonly requesterUserId: string;
  readonly requesterName: string | null;
}

/**
 * Dữ kiện của phiếu cần cho nội dung thông báo, lấy từ một dòng phiếu đã đọc (cột thô, đặt ở đây — không phải
 * `vouchers.store.ts`/`voucher-workflow.ts` — để cả hai module đó dùng lại được mà không tạo vòng import).
 */
export function notificationFacts(tenantId: string, row: Record<string, unknown>): VoucherNotificationFacts {
  return {
    tenantId,
    voucherId: String(row.id),
    kind: row.kind as FinanceVoucherKind,
    code: String(row.code),
    content: String(row.content),
    totalAmount: num(row.total_amount),
    requesterUserId: String(row.created_by),
    requesterName: optStr(row.created_by_name),
  };
}

/** Quyền duyệt đúng loại phiếu; `finance.manage` luôn được tính vì Tài chính coi nó thoả mọi quyền Tài chính. */
export function approverPermissionsFor(kind: FinanceVoucherKind): string[] {
  return [FINANCE_KIND_PERMISSIONS[kind].approve, 'finance.manage'];
}

const KIND_PATH = { RECEIPT: 'receipts', PAYMENT: 'payments', TRANSFER: 'transfers' } as const;

/** Đường mở thẳng phiếu trong Tài chính (khớp `notificationDeepLink`). */
export const voucherDeepLink = (kind: FinanceVoucherKind, voucherId: string): string => `/modules/finance/${KIND_PATH[kind]}/${voucherId}`;

const subjectOf = (facts: VoucherNotificationFacts) =>
  `${FINANCE_VOUCHER_KIND_LABELS[facts.kind]} ${facts.code} (${formatFinanceMoney(facts.totalAmount)} đ)`;

function emitter(db: Db, facts: VoucherNotificationFacts, type: string, payload: Record<string, unknown>) {
  const event = createIntegrationEvent({
    id: randomUUID(),
    type,
    version: 1,
    tenantId: facts.tenantId,
    source: 'finance',
    correlationId: facts.voucherId,
    payload: { voucherId: facts.voucherId, voucherKind: facts.kind, voucherCode: facts.code, deepLink: voucherDeepLink(facts.kind, facts.voucherId), ...payload },
  });
  return db.query(
    `INSERT INTO integration_schema.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'finance-voucher', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, event.correlationId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/** Phiếu duyệt trực tiếp vừa vào hàng chờ: báo người có quyền duyệt loại phiếu này. */
export async function notifyApprovalRequested(db: Db, facts: VoucherNotificationFacts): Promise<void> {
  await emitter(db, facts, 'finance.approval.requested', {
    approvalPermissions: approverPermissionsFor(facts.kind),
    summary: `${subjectOf(facts)}${facts.requesterName ? ` do ${facts.requesterName} lập` : ''} đang chờ bạn phê duyệt: ${facts.content}`.slice(0, 500),
    actorUserId: facts.requesterUserId,
  });
}

export type VoucherOutcome = 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVERSED';

const OUTCOME_TEXT: Readonly<Record<VoucherOutcome, { title: string; verb: string }>> = {
  APPROVED: { title: 'Phiếu đã được duyệt', verb: 'đã được duyệt và ghi sổ' },
  REJECTED: { title: 'Phiếu bị từ chối', verb: 'bị từ chối' },
  CANCELLED: { title: 'Phiếu đã bị huỷ', verb: 'đã bị huỷ' },
  REVERSED: { title: 'Phiếu đã ghi sổ bị huỷ', verb: 'đã được huỷ và đảo bút toán' },
};

/**
 * Kết quả xử lý phiếu báo cho người lập. `deciderUserId` là người thao tác: chính sách loại họ ra, nên người lập tự huỷ phiếu
 * của mình không tự nhận thông báo. Lý do/ghi chú xử lý được đưa vào nội dung để người lập biết cần sửa gì.
 */
export async function notifyOutcome(
  db: Db,
  facts: VoucherNotificationFacts,
  outcome: VoucherOutcome,
  deciderUserId: string,
  deciderName: string | null,
  note: string | null,
  /** Trường thêm vào payload (ví dụ `sourceModule`, `sourceRef` của phiếu nguồn Bán hàng để Bán hàng lọc sự kiện của mình). */
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const text = OUTCOME_TEXT[outcome];
  const by = deciderName ? ` bởi ${deciderName}` : '';
  const reason = note?.trim() ? ` Ghi chú: ${note.trim()}` : '';
  await emitter(db, facts, 'finance.voucher.status-changed', {
    status: outcome,
    requesterUserId: facts.requesterUserId,
    title: text.title,
    summary: `${subjectOf(facts)} ${text.verb}${by}.${reason}`.slice(0, 500),
    actorUserId: deciderUserId,
    ...extra,
  });
}

/** Quy trình đã duyệt mà chưa ghi sổ được: báo người lập (kèm lý do) và những người có quyền duyệt để xử lý rồi "Áp lại". */
export async function notifyNeedsAttention(db: Db, facts: VoucherNotificationFacts, reason: string): Promise<void> {
  const summary = `${subjectOf(facts)} đã được quy trình duyệt nhưng chưa ghi sổ được: ${reason}`.slice(0, 500);
  await emitter(db, facts, 'finance.voucher.needs-attention', { recipientUserIds: [facts.requesterUserId], summary });
  await emitter(db, facts, 'finance.voucher.needs-attention-approvers', { approvalPermissions: approverPermissionsFor(facts.kind), summary });
}
