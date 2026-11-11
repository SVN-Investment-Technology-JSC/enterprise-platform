import {
  BUSINESS_PLAN_AMOUNT_MAX,
  BUSINESS_PLAN_APPROVAL_REASON,
  BUSINESS_PLAN_DEVIATION_REASON,
  BUSINESS_PLAN_LINES_MAX,
  type BusinessPlanCostKind,
  type BusinessPlanCostLineInput,
  type BusinessPlanDetail,
  type BusinessPlanStatus,
  type CrmCapabilities,
  type QuoteApprovalReason,
} from '@enterprise-platform/contracts-crm';
import { parseNumber } from '../pricing/pricing.model';

/** Logic thuần của khối Phương án kinh doanh (PAKD) trong trình soạn báo giá. Server kiểm lại mọi thao tác. */

export const BUSINESS_PLAN_STATUS_TONE: Readonly<Record<BusinessPlanStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'>> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/** Một dòng chi phí đang nhập: số tiền giữ dạng chữ để người dùng gõ tự do. */
export interface PlanLineDraft {
  readonly key: string;
  readonly kind: BusinessPlanCostKind;
  readonly description: string;
  readonly amount: string;
}

export function draftsFromPlan(plan: Pick<BusinessPlanDetail, 'lines'>): PlanLineDraft[] {
  return plan.lines.map((line) => ({
    key: line.id,
    kind: line.kind,
    description: line.description ?? '',
    amount: String(line.amount),
  }));
}

export type PlanLinesResult =
  | { readonly ok: true; readonly lines: BusinessPlanCostLineInput[] }
  | { readonly ok: false; readonly message: string };

/** Kiểm các dòng đang nhập và đổi sang dữ liệu gửi API. */
export function buildPlanLines(drafts: readonly PlanLineDraft[]): PlanLinesResult {
  if (drafts.length > BUSINESS_PLAN_LINES_MAX) {
    return { ok: false, message: `Tối đa ${BUSINESS_PLAN_LINES_MAX} dòng chi phí.` };
  }
  const lines: BusinessPlanCostLineInput[] = [];
  for (const [index, draft] of drafts.entries()) {
    const amount = parseNumber(draft.amount);
    if (amount === undefined || !Number.isFinite(amount)) return { ok: false, message: `Dòng ${index + 1}: nhập số tiền hợp lệ.` };
    if (amount < 0) return { ok: false, message: `Dòng ${index + 1}: số tiền không được âm.` };
    if (amount > BUSINESS_PLAN_AMOUNT_MAX) return { ok: false, message: `Dòng ${index + 1}: số tiền quá lớn.` };
    const description = draft.description.trim();
    lines.push({ kind: draft.kind, description: description || null, amount });
  }
  return { ok: true, lines };
}

/** Tổng chi phí đang nhập (dòng không hợp lệ tính 0), để xem nhanh trước khi lưu. */
export function draftTotal(drafts: readonly PlanLineDraft[]): number {
  return drafts.reduce((sum, draft) => {
    const amount = parseNumber(draft.amount);
    return sum + (amount !== undefined && Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
}

export function planDirty(plan: Pick<BusinessPlanDetail, 'lines' | 'note'>, drafts: readonly PlanLineDraft[], note: string): boolean {
  if ((plan.note ?? '') !== note.trim()) return true;
  const base = draftsFromPlan(plan);
  if (base.length !== drafts.length) return true;
  return base.some((item, index) => {
    const draft = drafts[index];
    return item.kind !== draft.kind || item.description.trim() !== draft.description.trim() || parseNumber(draft.amount) !== Number(item.amount);
  });
}

export type PlanUiAction = 'save' | 'submit' | 'approve' | 'reject';

/**
 * Nút hiện được. Sửa, lưu, trình: người có quyền sửa báo giá khi `plan.editable`. Duyệt, từ chối: người có quyền
 * duyệt báo giá khi PAKD chờ duyệt, không phải người đã trình.
 */
export function planActions(
  plan: Pick<BusinessPlanDetail, 'status' | 'editable' | 'submittedBy'>,
  capabilities: Pick<CrmCapabilities, 'isTenantAdmin' | 'canWriteQuote' | 'canApproveQuote'>,
  currentUserId?: string,
): PlanUiAction[] {
  const write = capabilities.isTenantAdmin || capabilities.canWriteQuote;
  const approve = capabilities.isTenantAdmin || capabilities.canApproveQuote;
  const actions: PlanUiAction[] = [];
  if (write && plan.editable) actions.push('save', 'submit');
  const self = !!currentUserId && plan.submittedBy === currentUserId;
  if (approve && plan.status === 'PENDING' && !self) actions.push('approve', 'reject');
  return actions;
}

/** Lý do của báo giá liên quan PAKD (lệch ngưỡng, cần duyệt PAKD). */
export function planReasons(reasons: readonly QuoteApprovalReason[] | null | undefined): QuoteApprovalReason[] {
  return (reasons ?? []).filter((reason) => reason.code === BUSINESS_PLAN_APPROVAL_REASON || reason.code === BUSINESS_PLAN_DEVIATION_REASON);
}

/** Phiên bản gần nhất trước phiên bản đang xem để chép PAKD; không có thì rỗng. */
export function copySourceVersion(versionNos: readonly number[], current: number): number | undefined {
  const earlier = versionNos.filter((no) => no < current);
  return earlier.length ? Math.max(...earlier) : undefined;
}

/** Câu mặc định khi PAKD đang duyệt qua Quy trình mà bấm Duyệt, Từ chối trong CRM (409 `PLAN_IN_PROCEDURE`, D3-30). */
export const PLAN_IN_PROCEDURE_MESSAGE = 'Phương án kinh doanh đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.';

/** 409 `PLAN_IN_PROCEDURE`: PAKD trình riêng đang chờ trên Quy trình, không duyệt trực tiếp được. */
export function isPlanInProcedure(cause: unknown): boolean {
  const error = cause as { statusCode?: number; code?: string } | undefined;
  return error?.statusCode === 409 && error.code === 'PLAN_IN_PROCEDURE';
}

/** Lời nhắn khi lưu thất bại: 409 là có người sửa trước, cần tải lại; riêng `PLAN_IN_PROCEDURE` báo đang duyệt qua Quy trình. */
export function planConflictMessage(cause: unknown, fallback: string): string {
  const error = cause as { statusCode?: number; message?: string } | undefined;
  if (isPlanInProcedure(cause)) return typeof error?.message === 'string' && error.message ? error.message : PLAN_IN_PROCEDURE_MESSAGE;
  if (error?.statusCode === 409) {
    return 'Phương án kinh doanh vừa được người khác thay đổi. Đã tải lại bản mới nhất, vui lòng kiểm tra rồi thao tác lại.';
  }
  return typeof error?.message === 'string' && error.message ? error.message : fallback;
}

export function isPlanConflict(cause: unknown): boolean {
  return (cause as { statusCode?: number } | undefined)?.statusCode === 409 && !isPlanInProcedure(cause);
}
