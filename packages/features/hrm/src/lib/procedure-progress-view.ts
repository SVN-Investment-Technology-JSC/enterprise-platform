/**
 * Logic thuần cho hiển thị tiến độ quy trình (Procedure Engine) trong HRM:
 * nhãn trạng thái, nhãn "đang chờ ai duyệt", điều kiện làm mới tự động,
 * thông báo lỗi thân thiện và thân yêu cầu thao tác duyệt.
 */

export interface ProcedureProgressStep {
  id: string;
  name: string;
  status: string;
  order: number;
  currentRoleStage?: string;
  slaHours?: number;
  slaDueAt?: string;
  completedAt?: string;
  roleTitle?: string;
}

export interface ProcedureProgressActivity {
  id: string;
  action: string;
  actorName: string;
  summary: string;
  comment?: string;
  createdAt: string;
}

/** Thuộc tính đã nhập của đơn (HRM dựng từ procedure_links.attributes). */
export interface ProcedureSubmittedAttribute {
  key: string;
  code: string;
  name: string;
  type: string;
  scope: 'process' | 'step';
  stepName?: string;
  display: string;
  files?: Array<{ id: string; name: string }>;
}

export interface ProcedureProgressData {
  instanceId: string;
  instanceCode?: string;
  status: string;
  currentStepId?: string;
  currentStepName?: string;
  /** Tuỳ chọn: backend có thể bổ sung người đang được giao bước hiện tại. */
  currentAssigneeName?: string;
  /** Tuỳ chọn: false khi người dùng hiện tại không được giao bước hiện tại. */
  canAct?: boolean;
  steps: ProcedureProgressStep[];
  activity: ProcedureProgressActivity[];
  submittedAttributes?: ProcedureSubmittedAttribute[];
  completedAt?: string;
  hrmSynced?: boolean;
  hrmStatus?: string;
  syncStatus?: string;
  lastError?: string;
}

export const PROCEDURE_POLL_INTERVAL_MS = 15000;
const TERMINAL_STATUSES = ['completed', 'rejected', 'cancelled'];

export function isTerminalProcedureStatus(status?: string | null): boolean {
  return Boolean(status) && TERMINAL_STATUSES.includes(String(status));
}

/** Chỉ làm mới khi drawer mở, đơn còn chạy và tab đang hiển thị. */
export function shouldPollProcedureProgress(input: {
  open: boolean;
  hasInstance: boolean;
  status?: string | null;
  hidden: boolean;
}): boolean {
  return (
    input.open &&
    input.hasInstance &&
    !input.hidden &&
    !isTerminalProcedureStatus(input.status)
  );
}

export interface ProcedureSyncNotice {
  tone: 'info' | 'warning';
  title: string;
  detail?: string;
}

export function truncateText(value: string, max = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Trạng thái đồng bộ liên kết quy trình cần báo cho người dùng (null = không cần). */
export function procedureSyncNotice(
  syncStatus?: string | null,
  lastError?: string | null,
): ProcedureSyncNotice | null {
  if (syncStatus === 'START_PENDING')
    return { tone: 'info', title: 'Đang khởi tạo quy trình' };
  if (syncStatus === 'FAILED')
    return {
      tone: 'warning',
      title: 'Đồng bộ lỗi - đang thử lại',
      detail: lastError ? truncateText(lastError) : undefined,
    };
  return null;
}

/** "Đang chờ [người] duyệt - [bước]"; chỉ trả nhãn khi có ít nhất người hoặc bước. */
export function waitingApproverLabel(input: {
  assigneeName?: string | null;
  stepName?: string | null;
}): string | null {
  const who = input.assigneeName?.trim();
  const step = input.stepName?.trim();
  if (!who && !step) return null;
  return `Đang chờ ${who ? `${who} ` : ''}duyệt${step ? ` - ${step}` : ''}`;
}

/** Đọc thông tin quy trình từ một dòng đơn (các trường có thể thiếu). */
function positiveInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function procedureFieldsOf(raw: Record<string, unknown> | undefined) {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    instanceId: str(raw?.procedureInstanceId) ?? str(raw?.procedure_instance_id),
    revision: positiveInt(raw?.procedureRevision),
    syncStatus: str(raw?.procedureSyncStatus),
    lastError: str(raw?.procedureError) ?? str(raw?.procedureLastError),
    currentStepName: str(raw?.currentStepName),
    currentAssigneeName: str(raw?.currentAssigneeName),
    workflowStatus: str(raw?.workflowStatus),
  };
}

/** Query lọc danh sách đơn theo người đang chờ duyệt và bước hiện tại (rỗng thì bỏ qua). */
export function workflowFilterQuery(filter: {
  assignee?: string;
  currentStep?: string;
}): string {
  const query = new URLSearchParams();
  const assignee = filter.assignee?.trim();
  const currentStep = filter.currentStep?.trim();
  if (assignee) query.set('assignee', assignee);
  if (currentStep) query.set('currentStep', currentStep);
  return query.toString();
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

/** Lọc phía client theo người đang chờ duyệt (khớp một phần, không dấu) và bước hiện tại (khớp chính xác). */
export function matchesWorkflowFilter(
  raw: Record<string, unknown> | undefined,
  filter: { assignee?: string; currentStep?: string },
): boolean {
  const fields = procedureFieldsOf(raw);
  const assignee = filter.assignee?.trim();
  if (assignee && !fold(fields.currentAssigneeName ?? '').includes(fold(assignee)))
    return false;
  const step = filter.currentStep?.trim();
  if (step && fold(fields.currentStepName ?? '') !== fold(step)) return false;
  return true;
}

/** Các bước hiện tại đang xuất hiện trong danh sách (để làm tùy chọn lọc). */
export function distinctCurrentSteps(
  list: readonly (Record<string, unknown> | undefined)[],
): string[] {
  return [
    ...new Set(
      list
        .map((raw) => procedureFieldsOf(raw).currentStepName)
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'vi'));
}

export type ProcedureActionKind = 'APPROVE' | 'REJECT' | 'RETURN' | 'CANCEL';

export function procedureActionBody(
  action: ProcedureActionKind,
  input: { comment?: string; idempotencyKey: string; revision?: number },
) {
  const comment = input.comment?.trim();
  return {
    action,
    ...(comment ? { comment } : {}),
    ...(input.revision ? { revision: input.revision } : {}),
    idempotencyKey: input.idempotencyKey,
  };
}

/** Từ chối / Trả lại / Hủy bắt buộc có lý do. */
export function procedureActionNeedsReason(action: ProcedureActionKind) {
  return action !== 'APPROVE';
}

const CODE_MESSAGES: Record<string, string> = {
  SELF_APPROVAL_FORBIDDEN: 'Bạn không thể tự duyệt đơn của chính mình.',
  APPROVAL_OUT_OF_SCOPE:
    'Đơn này nằm ngoài phạm vi đơn vị bạn được phép duyệt.',
  PROCEDURE_IN_PROGRESS:
    'Đơn đang được xử lý theo quy trình; hãy thao tác tại bước của quy trình.',
  ORG_CONTEXT_UNAVAILABLE:
    'Chưa xác định được vị trí tổ chức của bạn hoặc của người nộp đơn nên chưa thể kiểm tra phạm vi duyệt. Vui lòng liên hệ quản trị nhân sự.',
};

/** Thông báo lỗi tiếng Việt thân thiện cho thao tác duyệt/xử lý đơn. */
export function approvalErrorMessage(
  error: unknown,
  mode: 'direct' | 'procedure' = 'direct',
): string {
  const e = error as { status?: number; code?: string; message?: string };
  if (e?.code && CODE_MESSAGES[e.code]) return CODE_MESSAGES[e.code];
  if (mode === 'procedure') {
    if (e?.status === 403)
      return 'Bạn không phải người được giao xử lý bước hiện tại của quy trình này.';
    if (e?.status === 409)
      return 'Đơn đã được xử lý hoặc quy trình đã chuyển bước. Tiến độ vừa được làm mới, vui lòng kiểm tra lại.';
  }
  return e?.message || 'Không xử lý được đơn';
}
