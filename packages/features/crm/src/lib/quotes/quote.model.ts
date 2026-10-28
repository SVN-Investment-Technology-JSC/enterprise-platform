import {
  QUOTE_REVISABLE_STATUSES,
  QUOTE_STATUS_TRANSITIONS,
  type CrmCapabilities,
  type QuoteDetail,
  type QuoteStatus,
} from '@enterprise-platform/contracts-crm';

/**
 * Logic thuần của màn báo giá: nút nào hiện theo trạng thái phiên bản và quyền.
 * Server kiểm lại mọi thao tác; ở đây chỉ để không hiện nút chắc chắn bị từ chối.
 */

export const QUOTE_STATUS_TONE: Readonly<Record<QuoteStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'>> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  REJECTED: 'danger',
  APPROVED: 'info',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'neutral',
  SUPERSEDED: 'neutral',
};

export type QuoteUiAction = 'edit' | 'revise' | 'submit' | 'approve' | 'reject' | 'send' | 'accept' | 'decline';

/** Thao tác hiện được cho phiên bản đang xem. */
export function quoteActions(
  detail: Pick<QuoteDetail, 'currentVersion' | 'procedure'> & { version: Pick<QuoteDetail['version'], 'versionNo' | 'status' | 'submittedBy'> },
  capabilities: CrmCapabilities,
  currentUserId?: string,
): QuoteUiAction[] {
  const { status, versionNo } = detail.version;
  if (versionNo !== detail.currentVersion) return [];
  const write = capabilities.isTenantAdmin || capabilities.canWriteQuote;
  const approve = capabilities.isTenantAdmin || capabilities.canApproveQuote;
  const next = QUOTE_STATUS_TRANSITIONS[status];
  const actions: QuoteUiAction[] = [];
  if (write && status === 'DRAFT') actions.push('edit', 'submit');
  if (write && QUOTE_REVISABLE_STATUSES.includes(status)) actions.push('revise');
  const link = detail.procedure;
  const viaProcedure = !!link && link.status !== 'CLOSED' && !(link.status === 'FAILED' && !link.instanceId);
  const self = !!currentUserId && detail.version.submittedBy === currentUserId;
  if (approve && status === 'PENDING' && !viaProcedure && !self) actions.push('approve', 'reject');
  if (write && next.includes('SENT')) actions.push('send');
  if (write && next.includes('ACCEPTED')) actions.push('accept', 'decline');
  return actions;
}

/** Số có dấu cho cột chênh lệch: `+1.000` hoặc `-500`. */
export function signed(value: number, format: (value: number) => string): string {
  if (value === 0) return format(0);
  return `${value > 0 ? '+' : '-'}${format(Math.abs(value))}`;
}
