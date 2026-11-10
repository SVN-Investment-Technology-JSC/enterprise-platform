/**
 * Việc cần xử lý của người dùng trong CRM (phase 3, plan mục 17.4, D3-32): báo giá, PAKD chờ người xem duyệt và việc
 * của báo giá người xem phụ trách, việc đang chờ người khác duyệt để theo dõi. `GET /v1/my-tasks` cần `crm.read`; mỗi
 * nhóm đã lọc theo phạm vi dữ liệu.
 */
import type { ApprovalMode } from './quotes.js';

export const CRM_TASK_KINDS = [
  /** Báo giá Chờ duyệt, người xem duyệt được. */
  'QUOTE_APPROVAL',
  /** PAKD trình riêng đang chờ, người xem duyệt được. */
  'BUSINESS_PLAN_APPROVAL',
  /** Báo giá người xem phụ trách bị từ chối duyệt (phiên bản hiện tại). */
  'QUOTE_REJECTED',
  /** Báo giá người xem phụ trách đã duyệt, chờ gửi khách. */
  'QUOTE_READY_TO_SEND',
  /** PAKD trình riêng của báo giá người xem phụ trách bị từ chối. */
  'BUSINESS_PLAN_REJECTED',
  /** Báo giá đang Chờ duyệt mà người xem không duyệt được: người trình, người phụ trách, hoặc quản trị theo dõi. */
  'QUOTE_PENDING',
  /** PAKD trình riêng đang chờ, người xem không duyệt được (người trình, người phụ trách, quản trị). */
  'BUSINESS_PLAN_PENDING',
] as const;
export type CrmTaskKind = (typeof CRM_TASK_KINDS)[number];

export const CRM_TASK_KIND_LABELS: Readonly<Record<CrmTaskKind, string>> = {
  QUOTE_APPROVAL: 'Duyệt báo giá',
  BUSINESS_PLAN_APPROVAL: 'Duyệt phương án kinh doanh',
  QUOTE_REJECTED: 'Báo giá bị từ chối duyệt',
  QUOTE_READY_TO_SEND: 'Báo giá đã duyệt, chờ gửi khách',
  BUSINESS_PLAN_REJECTED: 'Phương án kinh doanh bị từ chối',
  QUOTE_PENDING: 'Báo giá đang chờ duyệt',
  BUSINESS_PLAN_PENDING: 'Phương án kinh doanh đang chờ duyệt',
};

/** Đích duyệt: cách duyệt và hồ sơ Quy trình (nếu duyệt qua Quy trình). */
export interface CrmTaskApprovalTarget {
  /** Báo giá hay PAKD trình riêng. */
  readonly subject: 'QUOTE' | 'BUSINESS_PLAN';
  readonly mode: ApprovalMode;
  /** Có khi `mode = 'PROCEDURE'` và hồ sơ đã tạo; mở bằng `/modules/procedure#workspace/<id>`. */
  readonly procedureInstanceId: string | null;
  readonly procedureInstanceCode: string | null;
}

export interface CrmTask {
  readonly kind: CrmTaskKind;
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly quoteName: string | null;
  readonly versionNo: number;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  /** Người trình (việc chờ duyệt) hoặc người ra kết quả (việc của tôi). */
  readonly actorUserId: string | null;
  readonly actorName: string | null;
  /** Lúc trình (việc chờ duyệt) hoặc lúc có kết quả (việc của tôi). */
  readonly at: string | null;
  readonly totalAmount: number;
  /** Biên lợi nhuận ước tính (%); rỗng khi người xem không được xem giá vốn hoặc chưa tính được. */
  readonly marginPercent: number | null;
  /** Lý do cần duyệt (việc chờ duyệt) hoặc lý do từ chối (việc của tôi). */
  readonly reasons: readonly string[];
  /** Có ở việc chờ duyệt (chờ tôi duyệt, đang chờ duyệt). */
  readonly approval: CrmTaskApprovalTarget | null;
  /**
   * Việc đang chờ duyệt: đang chờ ai, ví dụ "Duyệt · Trần Văn B" (bước và người xử lý bên Quy trình) hoặc "Người có
   * quyền duyệt báo giá" (duyệt trực tiếp); rỗng khi chưa biết (Quy trình chưa tạo hồ sơ hoặc không trả lời).
   */
  readonly waitingOn?: string | null;
}

export interface CrmTaskList {
  readonly awaitingMe: readonly CrmTask[];
  readonly mine: readonly CrmTask[];
  /**
   * Đang chờ duyệt, người xem không duyệt được: báo giá, PAKD người xem trình hoặc phụ trách; quản trị bán hàng và
   * quản trị tenant thấy mọi việc chờ duyệt trong phạm vi dữ liệu. Chỉ để theo dõi.
   */
  readonly waiting: readonly CrmTask[];
}

/** Đường dẫn mở hồ sơ Quy trình rồi quay về `returnTo` (đường dẫn nội bộ, cơ chế `returnTo` của shared-ui). */
export function procedureInstanceHref(instanceId: string, returnTo: string): string {
  return `/modules/procedure?returnTo=${encodeURIComponent(returnTo)}#workspace/${encodeURIComponent(instanceId)}`;
}
