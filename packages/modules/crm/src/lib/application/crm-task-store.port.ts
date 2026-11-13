import type { CrmDataScope } from './data-scope.js';

/**
 * Port đọc "Việc cần xử lý" (plan mục 17.4, D3-32): báo giá và PAKD trình riêng đang chờ duyệt trong phạm vi dữ liệu,
 * và việc của báo giá người xem phụ trách. Chỉ đọc; quyết định ai duyệt được nằm ở `CrmTaskService`.
 */
export const CRM_TASK_STORE = Symbol('CRM_TASK_STORE');

/** Liên kết Quy trình của việc chờ duyệt (`procedure_links`). */
export interface TaskProcedureLink {
  readonly status: string;
  readonly instanceId: string | null;
  readonly instanceCode: string | null;
}

/** Báo giá (phiên bản hiện tại Chờ duyệt) hoặc PAKD trình riêng đang chờ duyệt. */
export interface PendingApprovalRecord {
  readonly subject: 'QUOTE' | 'BUSINESS_PLAN';
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly quoteName: string | null;
  readonly versionNo: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly totalAmount: number;
  /** Biên của phiên bản (báo giá) hoặc của PAKD (bản chụp lúc trình). */
  readonly marginPercent: number | null;
  readonly reasons: readonly string[];
  readonly link: TaskProcedureLink | null;
}

export type OwnerTaskKind = 'QUOTE_REJECTED' | 'QUOTE_READY_TO_SEND' | 'BUSINESS_PLAN_REJECTED';

/** Việc của báo giá người xem phụ trách. */
export interface OwnerTaskRecord {
  readonly kind: OwnerTaskKind;
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly quoteName: string | null;
  readonly versionNo: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  /** Người ra kết quả (duyệt, từ chối). */
  readonly actorUserId: string | null;
  readonly at: string | null;
  readonly totalAmount: number;
  readonly marginPercent: number | null;
  /** Lý do từ chối (rỗng với báo giá đã duyệt). */
  readonly reasons: readonly string[];
}

export interface CrmTaskStore {
  /**
   * Việc chờ duyệt trong phạm vi `scope`, mới trình trước, tối đa `limit`. `quoteIds` thì chỉ các báo giá đó (màn
   * chi tiết báo giá).
   */
  pendingApprovals(
    tenantId: string,
    scope: CrmDataScope,
    options: { readonly limit: number; readonly quoteIds?: readonly string[] },
  ): Promise<PendingApprovalRecord[]>;
  /** Việc của báo giá `ownerUserId` phụ trách, mới nhất trước, tối đa `limit`. */
  ownerTasks(tenantId: string, ownerUserId: string, limit: number): Promise<OwnerTaskRecord[]>;
}
