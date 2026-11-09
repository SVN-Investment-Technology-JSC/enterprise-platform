import {
  procedureInstanceHref,
  type CrmTask,
  type CrmTaskApprovalTarget,
  type CrmTaskKind,
} from '@enterprise-platform/contracts-crm';

/**
 * Logic thuần của trang Việc cần xử lý và các lối vào từ phần Báo giá (plan mục 17.4, D3-32, D3-33): mở việc ở đâu,
 * đường quay về, chữ của cột Cách duyệt. Server đã lọc việc theo quyền và phạm vi; ở đây chỉ dựng link.
 */

/** Đường dẫn trang Việc cần xử lý; Quy trình quay về đây sau khi thao tác (`returnTo`). */
export const CRM_TASKS_PATH = '/modules/crm#tasks';
/** Đường dẫn danh sách báo giá, đích quay về khi mở việc từ khối "Cần tôi duyệt". */
export const CRM_QUOTES_PATH = '/modules/crm#quotes';
/** Gốc đường dẫn của phân hệ, ghép với hash hiện tại để làm `returnTo`. */
export const CRM_BASE_PATH = '/modules/crm';

export const DIRECT_APPROVAL_TEXT = 'Trực tiếp';
export const PROCEDURE_ACTION_LABEL = 'Duyệt trên Quy trình';
export const BACK_TO_TASKS_LABEL = 'Quay lại Việc cần xử lý';

/** Khối mở sẵn khi vào màn báo giá. */
export type QuotePanel = 'business-plan';

export interface QuoteSub {
  readonly quoteId: string;
  readonly panel?: QuotePanel;
  /** Mở từ trang Việc cần xử lý: màn báo giá có nút quay về. */
  readonly fromTasks: boolean;
}

/** Đoạn sau `#quotes/` để mở báo giá, ví dụ `<id>?panel=business-plan&from=tasks`. */
export function quoteSub(quoteId: string, options: { panel?: QuotePanel; fromTasks?: boolean } = {}): string {
  const query = new URLSearchParams();
  if (options.panel) query.set('panel', options.panel);
  if (options.fromTasks) query.set('from', 'tasks');
  const text = query.toString();
  return text ? `${quoteId}?${text}` : quoteId;
}

/** Đọc lại `quoteSub`; tham số lạ bỏ qua, `sub` không có `?` thì cả chuỗi là id báo giá như trước. */
export function parseQuoteSub(sub: string): QuoteSub {
  const separator = sub.indexOf('?');
  if (separator < 0) return { quoteId: sub, fromTasks: false };
  const params = new URLSearchParams(sub.slice(separator + 1));
  return {
    quoteId: sub.slice(0, separator),
    panel: params.get('panel') === 'business-plan' ? 'business-plan' : undefined,
    fromTasks: params.get('from') === 'tasks',
  };
}

export function isBusinessPlanTask(kind: CrmTaskKind): boolean {
  return kind === 'BUSINESS_PLAN_APPROVAL' || kind === 'BUSINESS_PLAN_REJECTED';
}

/** Link sang hồ sơ Quy trình kèm `returnTo`; rỗng khi duyệt trực tiếp hoặc hồ sơ chưa tạo xong. */
export function procedureHrefOf(target: CrmTaskApprovalTarget | null | undefined, returnTo: string): string | undefined {
  if (!target || target.mode !== 'PROCEDURE' || !target.procedureInstanceId) return undefined;
  return procedureInstanceHref(target.procedureInstanceId, returnTo);
}

export type TaskTarget =
  | { readonly kind: 'procedure'; readonly href: string }
  | { readonly kind: 'quote'; readonly sub: string };

/**
 * Nơi mở một việc: duyệt qua Quy trình thì sang hồ sơ bên Quy trình (Quy trình tự quay về `returnTo`); còn lại mở báo
 * giá trong CRM, việc PAKD thì mở sẵn khối PAKD.
 */
export function taskTarget(task: CrmTask, options: { returnTo?: string; fromTasks?: boolean } = {}): TaskTarget {
  const { returnTo = CRM_TASKS_PATH, fromTasks = true } = options;
  const href = procedureHrefOf(task.approval, returnTo);
  if (href) return { kind: 'procedure', href };
  return {
    kind: 'quote',
    sub: quoteSub(task.quoteId, { panel: isBusinessPlanTask(task.kind) ? 'business-plan' : undefined, fromTasks }),
  };
}

/** Nhãn nút của một việc. */
export function taskActionLabel(task: CrmTask): string {
  if (procedureHrefOf(task.approval, CRM_TASKS_PATH)) return PROCEDURE_ACTION_LABEL;
  if (task.kind === 'QUOTE_APPROVAL' || task.kind === 'BUSINESS_PLAN_APPROVAL') return 'Mở để duyệt';
  return isBusinessPlanTask(task.kind) ? 'Mở phương án' : 'Mở báo giá';
}

/** Chữ cột Cách duyệt: "Qua Quy trình <mã hồ sơ>" hoặc "Trực tiếp". */
export function approvalModeText(target: CrmTaskApprovalTarget | null | undefined): string {
  if (!target) return '';
  if (target.mode !== 'PROCEDURE') return DIRECT_APPROVAL_TEXT;
  if (target.procedureInstanceCode) return `Qua Quy trình ${target.procedureInstanceCode}`;
  return target.procedureInstanceId ? 'Qua Quy trình' : 'Qua Quy trình (đang tạo hồ sơ)';
}

/** Có ít nhất một việc có biên lợi nhuận; không thì ẩn cột Biên. */
export function hasMargin(tasks: readonly CrmTask[]): boolean {
  return tasks.some((task) => task.marginPercent !== null);
}

/** Mã và tên báo giá kèm phiên bản: "BG2600001 - Báo giá bơm (v2)". */
export function taskQuoteLabel(task: Pick<CrmTask, 'quoteCode' | 'quoteName' | 'versionNo'>): string {
  return `${task.quoteCode}${task.quoteName ? ` - ${task.quoteName}` : ''} (v${task.versionNo})`;
}

/** Đường dẫn CRM hiện tại (gồm hash) làm `returnTo`; hash rỗng thì dùng `fallbackHash`. */
export function crmReturnPath(hash: string | undefined, fallbackHash: string): string {
  const current = hash && hash !== '#' ? hash : fallbackHash;
  return `${CRM_BASE_PATH}${current.startsWith('#') ? current : `#${current}`}`;
}

/** Câu thông báo trên màn báo giá đang chờ chính người xem duyệt. */
export function awaitingNoticeText(target: CrmTaskApprovalTarget): string {
  return target.subject === 'BUSINESS_PLAN'
    ? 'Phương án kinh doanh của báo giá này đang chờ bạn duyệt.'
    : 'Báo giá này đang chờ bạn duyệt.';
}

/** Mở một đường dẫn trong cùng tab (sang Quy trình). Tách ra để spec thay được. */
export function openPath(href: string): void {
  if (typeof window !== 'undefined') window.location.assign(href);
}
