import { WARRANTY_STATUS_LABELS, type WarrantyStatus } from '@enterprise-platform/contracts-crm';
import { WARRANTY_ACTION_LABELS } from './warranty/warranty.model';
import {
  ADJUSTMENT_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  type AdjustmentStatus,
  type ReceiptStatus,
} from '@enterprise-platform/contracts-crm';
import {
  ACTIVITY_TYPE_LABELS,
  CONTRACT_STATUS_LABELS,
  SALES_ORDER_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  QUOTE_STATUS_LABELS,
  type Activity,
  type CrmCapabilities,
  type CrmPerson,
  type CustomerTimelineEntry,
  type OpportunityBoard,
  type OpportunityStagePlanItem,
  type StagePlanStatus,
  type OpportunityStage,
  type OpportunitySummary,
  type Pipeline,
  type PipelineStage,
  type QuoteStatus,
  type StageRef,
} from '@enterprise-platform/contracts-crm';
import { FULFILLMENT_ACTION_LABELS } from './fulfillment.model';

/**
 * Logic thuần của các màn Bán hàng (không React), để kiểm thử riêng. Quyền và
 * luật thật nằm ở API; ở đây chỉ để giao diện phản hồi nhanh.
 */

/** Nhãn giai đoạn theo mã: mã phase 1 có nhãn sẵn, mã khác (luồng tuỳ biến) hiện chính mã. */
export function stageLabelByCode(code: string): string {
  return OPPORTUNITY_STAGE_LABELS[code as OpportunityStage] ?? code;
}

/** Tìm giai đoạn trong luồng theo mã. */
export function findStage(pipeline: Pipeline | undefined, code: string): PipelineStage | undefined {
  return pipeline?.stages.find((stage) => stage.code === code);
}

/**
 * Thả thẻ từ cột `from` sang `to` có hợp lệ không, theo bước chuyển cấu hình
 * của luồng (cùng nguồn với server). Giai đoạn đã tắt không nhận thẻ mới.
 */
export function canDropStage(pipeline: Pipeline | undefined, from: string, to: string): boolean {
  const source = findStage(pipeline, from);
  const target = findStage(pipeline, to);
  if (!source || !target || source.id === target.id || !target.active) return false;
  return source.nextStageIds.includes(target.id);
}

/** Chuyển sang giai đoạn này bắt buộc nhập lý do (nghĩa Thua, hoặc điều kiện REASON bắt buộc). */
export function stageNeedsReason(stage: Pick<PipelineStage, 'semantic' | 'requirements'> | undefined): boolean {
  if (!stage) return false;
  return stage.semantic === 'LOST' || stage.requirements.some((item) => item.kind === 'REASON' && item.required);
}

/** Dự án đã kết thúc (Thắng hoặc Thua) thì không kéo thả, không sửa. */
export function isClosedStage(info: Pick<StageRef, 'semantic'>): boolean {
  return info.semantic !== 'OPEN';
}

/** Lựa chọn cho ô chọn giai đoạn đích từ `nextStages` (đã bỏ giai đoạn tắt). */
export function stageOptions(stages: readonly StageRef[]): { value: string; label: string }[] {
  return stages.map((stage) => ({ value: stage.code, label: stage.name }));
}

/** Lựa chọn giai đoạn để lọc: của một luồng, hoặc gộp theo mã khi chưa chọn luồng. */
export function stageFilterOptions(pipelines: readonly Pipeline[], pipelineId: string): { value: string; label: string }[] {
  const source = pipelineId ? pipelines.filter((pipeline) => pipeline.id === pipelineId) : pipelines;
  const seen = new Map<string, string>();
  for (const pipeline of source) {
    for (const stage of pipeline.stages) if (!seen.has(stage.code)) seen.set(stage.code, stage.name);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

/** Luồng mặc định (không có thì luồng đầu tiên). */
export function defaultPipeline(pipelines: readonly Pipeline[]): Pipeline | undefined {
  return pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];
}

/** Màu nhãn giai đoạn theo nghĩa. */
export function stageTone(semantic: StageRef['semantic']): 'success' | 'danger' | 'info' {
  return semantic === 'WON' ? 'success' : semantic === 'LOST' ? 'danger' : 'info';
}

const STAGE_ERROR_FALLBACKS: Readonly<Record<string, string>> = {
  INVALID_STAGE_TRANSITION: 'Không thể chuyển sang giai đoạn này từ giai đoạn hiện tại.',
  LOST_REASON_REQUIRED: 'Phải ghi lý do khi chuyển sang giai đoạn này.',
  ACCEPTED_QUOTE_REQUIRED: 'Cần một báo giá được khách chấp nhận trước khi chuyển giai đoạn này.',
  STAGE_REQUIREMENTS_NOT_MET: 'Chưa đủ điều kiện để chuyển giai đoạn.',
};

/**
 * Lỗi chuyển giai đoạn thành câu tiếng Việt. Thiếu điều kiện thì liệt kê từng
 * điều kiện còn thiếu (`missing` do server trả); mã lỗi khác dùng lời nhắn của
 * server, không có thì dùng câu mặc định theo mã.
 */
export function describeStageError(cause: unknown, fallback: string): string {
  const error = (cause ?? {}) as { code?: string; message?: string; missing?: readonly { message?: string }[] };
  const missing = (error.missing ?? []).map((item) => item.message?.trim()).filter((text): text is string => !!text);
  if (missing.length) return `${STAGE_ERROR_FALLBACKS.STAGE_REQUIREMENTS_NOT_MET} Còn thiếu: ${missing.join('; ')}`;
  if (typeof error.message === 'string' && error.message) return error.message;
  return (error.code && STAGE_ERROR_FALLBACKS[error.code]) || fallback;
}

/**
 * Chuyển thẻ sang cột mới ngay trên giao diện (lạc quan). Trả bảng mới, giữ
 * nguyên bảng cũ để hoàn tác khi API lỗi. Thẻ không có hoặc cùng cột: trả `undefined`.
 */
export function moveCard(
  board: OpportunityBoard,
  id: string,
  to: string,
): { board: OpportunityBoard; card: OpportunitySummary; from: string } | undefined {
  const fromColumn = board.columns.find((column) => column.items.some((item) => item.id === id));
  const toColumn = board.columns.find((column) => column.stage === to);
  const card = fromColumn?.items.find((item) => item.id === id);
  if (!fromColumn || !toColumn || !card || fromColumn.stage === to) return undefined;
  const moved: OpportunitySummary = { ...card, stage: to, stageInfo: toColumn.stageInfo };
  const value = card.expectedValue ?? 0;
  return {
    from: fromColumn.stage,
    card,
    board: {
      ...board,
      columns: board.columns.map((column) => {
        if (column.stage === fromColumn.stage) {
          return {
            ...column,
            total: Math.max(0, column.total - 1),
            totalValue: column.totalValue - value,
            items: column.items.filter((item) => item.id !== id),
          };
        }
        if (column.stage === to) {
          return { ...column, total: column.total + 1, totalValue: column.totalValue + value, items: [moved, ...column.items] };
        }
        return column;
      }),
    },
  };
}

/** Thay một thẻ bằng bản server trả về (phiên bản mới) sau khi chuyển thành công. */
export function replaceCard(board: OpportunityBoard, card: OpportunitySummary): OpportunityBoard {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      items: column.items.map((item) => (item.id === card.id ? card : item)),
    })),
  };
}

/** Hoạt động đang mở đã quá hạn. */
export function isOverdue(activity: Pick<Activity, 'status' | 'dueAt'>, now = Date.now()): boolean {
  return activity.status === 'OPEN' && !!activity.dueAt && Date.parse(activity.dueAt) < now;
}

/** Tên người theo id; không có trong danh bạ thì hiện "Người dùng khác". */
export function personName(people: readonly CrmPerson[], userId: string | null | undefined): string {
  if (!userId) return '';
  return people.find((person) => person.userId === userId)?.displayName ?? 'Người dùng khác';
}

const MONEY = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** `1234567` → `1.234.567 ₫`; rỗng thì chuỗi rỗng. */
export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${MONEY.format(value)} ₫`;
}

/** Gợi ý ngay khi nhập; server vẫn kiểm lại. */
export function taxCodeLooksValid(value: string): boolean {
  const text = value.trim();
  return !text || /^\d{10}(-\d{3})?$/.test(text);
}

/**
 * Câu mô tả một mục dòng thời gian. Loại chưa biết (giai đoạn sau thêm) hiện
 * nhãn chung chứ không làm vỡ màn hình.
 */
export function describeTimelineEntry(entry: CustomerTimelineEntry): { title: string; detail?: string } {
  switch (entry.kind) {
    case 'opportunity-created':
      return { title: `Tạo dự án bán hàng "${entry.opportunityName}"`, detail: stageLabelByCode(entry.stage) };
    case 'opportunity-stage-changed':
      return {
        title: `Dự án bán hàng "${entry.opportunityName}": ${stageLabelByCode(entry.fromStage)} → ${stageLabelByCode(entry.toStage)}`,
        detail: entry.reason ? `Lý do: ${entry.reason}` : undefined,
      };
    case 'activity':
      return { title: `${ACTIVITY_TYPE_LABELS[entry.activityType] ?? 'Hoạt động'}: ${entry.subject}` };
    case 'quote': {
      const version = entry.versionNo ? ` v${entry.versionNo}` : '';
      const action = QUOTE_ACTION_LABELS[entry.action] ?? 'Cập nhật';
      const status = entry.toStatus && entry.toStatus in QUOTE_STATUS_LABELS ? QUOTE_STATUS_LABELS[entry.toStatus as QuoteStatus] : '';
      return {
        title: `Báo giá ${entry.quoteCode}${version}: ${action}${status && entry.action !== 'revise' ? ` (${status})` : ''}`,
        detail: entry.reason ?? undefined,
      };
    }
    case 'contract':
    case 'order': {
      const labels: Readonly<Record<string, string>> = entry.kind === 'contract' ? CONTRACT_STATUS_LABELS : SALES_ORDER_STATUS_LABELS;
      const subject = entry.kind === 'contract' ? `Hợp đồng ${entry.contractCode}` : `Đơn bán ${entry.orderCode}`;
      const action = FULFILLMENT_ACTION_LABELS[entry.action] ?? 'Cập nhật';
      const status = entry.toStatus && entry.toStatus !== entry.fromStatus ? labels[entry.toStatus] : undefined;
      return { title: `${subject}: ${action}${status ? ` (${status})` : ''}`, detail: entry.reason ?? undefined };
    }
    case 'receivable':
      return describeReceivableEntry(entry);
    case 'warranty': {
      const action = WARRANTY_ACTION_LABELS[entry.action] ?? 'Cập nhật';
      const status =
        entry.toStatus && entry.toStatus !== entry.fromStatus && entry.toStatus in WARRANTY_STATUS_LABELS
          ? ` (${WARRANTY_STATUS_LABELS[entry.toStatus as WarrantyStatus]})`
          : '';
      return { title: `Bảo hành ${entry.caseCode}: ${action}${status}`, detail: entry.reason ?? undefined };
    }
    default:
      return { title: 'Sự kiện khác' };
  }
}

/** Mục công nợ trên dòng thời gian (T5-13): phát sinh nợ, lần thu, điều chỉnh. */
function describeReceivableEntry(entry: Extract<CustomerTimelineEntry, { kind: 'receivable' }>): { title: string; detail?: string } {
  const amount = entry.amount === null ? '' : ` ${formatMoney(Math.abs(entry.amount))}`;
  if (entry.subject === 'entry') {
    const title = entry.action === 'DEBIT' ? `Phát sinh nợ${amount}` : `Đảo nợ${amount}`;
    return { title: entry.code ? `${title} (đơn ${entry.code})` : title, detail: entry.reason ?? undefined };
  }
  const action = RECEIVABLE_ACTION_LABELS[entry.action] ?? 'Cập nhật';
  const subject = entry.subject === 'receipt' ? `Lần thu ${entry.code ?? ''}` : `Điều chỉnh ${entry.code ?? ''}`;
  const status =
    entry.toStatus && entry.subject === 'receipt' && entry.toStatus in RECEIPT_STATUS_LABELS
      ? ` (${RECEIPT_STATUS_LABELS[entry.toStatus as ReceiptStatus]})`
      : entry.toStatus && entry.subject === 'adjustment' && entry.toStatus in ADJUSTMENT_STATUS_LABELS
        ? ` (${ADJUSTMENT_STATUS_LABELS[entry.toStatus as AdjustmentStatus]})`
        : '';
  return { title: `${subject.trim()}${amount}: ${action}${status}`, detail: entry.reason ?? undefined };
}

/** Nhãn thao tác trên lần thu, điều chỉnh công nợ (nhật ký, dòng thời gian). */
export const RECEIVABLE_ACTION_LABELS: Readonly<Record<string, string>> = {
  create: 'Ghi nhận',
  resend: 'Sửa và gửi lại Tài chính',
  post: 'Tài chính ghi sổ',
  return: 'Tài chính trả lại',
  reverse: 'Phiếu thu bị đảo',
  cancel: 'Huỷ',
  approve: 'Duyệt',
  'apply-credit': 'Phân bổ tiền trả trước',
};

/** Nhãn thao tác trên báo giá (nhật ký, dòng thời gian). */
export const QUOTE_ACTION_LABELS: Readonly<Record<string, string>> = {
  create: 'Lập báo giá',
  revise: 'Sinh phiên bản mới',
  submit: 'Gửi duyệt',
  approve: 'Duyệt',
  reject: 'Từ chối duyệt',
  send: 'Gửi khách',
  accept: 'Khách chấp nhận',
  decline: 'Khách từ chối',
  expire: 'Hết hạn',
  convert: 'Chuyển thành hợp đồng, đơn',
  'procedure-reversed': 'Quy trình thu hồi kết quả duyệt',
};


const stripTones = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

/** Chuẩn hoá tên nhóm để so trùng: bỏ dấu, bỏ khác biệt hoa thường và khoảng trắng thừa. */
export function normalizeGroupName(name: string): string {
  return stripTones(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Mã nhóm sinh từ tên khi tạo nhanh trong form khách (server yêu cầu mã `A-Z 0-9 . _ -`, tối đa 50 ký tự):
 * "Đại lý cấp 1" thành "DAI-LY-CAP-1". Tên không còn ký tự hợp lệ nào thì trả chuỗi rỗng.
 */
export function groupCodeFromName(name: string): string {
  return stripTones(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Nhãn trạng thái giai đoạn trong kế hoạch của dự án. */
export const STAGE_PLAN_STATUS_LABELS: Readonly<Record<StagePlanStatus, string>> = {
  PENDING: 'Chưa tới',
  ACTIVE: 'Đang làm',
  DONE: 'Đã xong',
  SKIPPED: 'Đã bỏ qua',
};

/** Màu nhãn trạng thái giai đoạn trong kế hoạch. */
export function stagePlanTone(status: StagePlanStatus): 'success' | 'info' | 'warning' | 'neutral' {
  return status === 'DONE' ? 'success' : status === 'ACTIVE' ? 'info' : status === 'SKIPPED' ? 'warning' : 'neutral';
}

/** Chủ dự án hoặc người có `crm.manage` (kèm quyền ghi cơ hội) mới đổi người đảm nhận. Server vẫn kiểm lại. */
export function canEditStageAssignee(
  capabilities: CrmCapabilities,
  userId: string | undefined,
  opportunity: { ownerUserId: string },
): boolean {
  const writer = capabilities.isTenantAdmin || capabilities.canWriteOpportunity;
  if (!writer) return false;
  return capabilities.isTenantAdmin || capabilities.canManage || (!!userId && opportunity.ownerUserId === userId);
}

/**
 * Được chuyển giai đoạn hoặc bỏ qua giai đoạn: chủ dự án, người đảm nhận giai đoạn đang làm,
 * hoặc `crm.manage`. Chỉ để ẩn nút; server trả 403 nếu không đủ điều kiện.
 */
export function canLeaveCurrentStage(
  capabilities: CrmCapabilities,
  userId: string | undefined,
  opportunity: { ownerUserId: string },
  plan: readonly Pick<OpportunityStagePlanItem, 'status' | 'assigneeUserId'>[] | undefined,
): boolean {
  const writer = capabilities.isTenantAdmin || capabilities.canWriteOpportunity;
  if (!writer) return false;
  if (capabilities.isTenantAdmin || capabilities.canManage) return true;
  if (!userId) return false;
  if (opportunity.ownerUserId === userId) return true;
  return !!plan?.some((item) => item.status === 'ACTIVE' && item.assigneeUserId === userId);
}

/** Giai đoạn bỏ qua được: cho phép bỏ qua, chưa tới, dự án còn mở. */
export function canSkipPlanItem(item: Pick<OpportunityStagePlanItem, 'skippable' | 'status'>, opportunityOpen: boolean): boolean {
  return opportunityOpen && item.skippable && item.status === 'PENDING';
}

/** Giai đoạn chưa có người đảm nhận và chưa xong hoặc bỏ qua: cần cảnh báo. */
export function stageNeedsAssignee(item: Pick<OpportunityStagePlanItem, 'status' | 'assigneeUserId'>): boolean {
  return !item.assigneeUserId && (item.status === 'PENDING' || item.status === 'ACTIVE');
}

/** Câu cảnh báo cho một giai đoạn; rỗng khi không có gì cần báo. */
export function stageAssigneeWarning(item: Pick<OpportunityStagePlanItem, 'status' | 'assigneeUserId' | 'assigneeWarning'>): string {
  if (item.assigneeWarning) return item.assigneeWarning;
  return stageNeedsAssignee(item) ? 'Chưa có người đảm nhận giai đoạn này.' : '';
}

export interface CustomerOpportunityGroup {
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly count: number;
  readonly totalValue: number;
  readonly items: readonly OpportunitySummary[];
}

/** Nhóm dự án theo khách hàng, giữ thứ tự xuất hiện đầu tiên của khách; tổng giá trị bỏ qua dự án chưa nhập giá. */
export function groupByCustomer(items: readonly OpportunitySummary[]): CustomerOpportunityGroup[] {
  const groups = new Map<string, { head: OpportunitySummary; items: OpportunitySummary[]; total: number }>();
  for (const item of items) {
    const group = groups.get(item.customerId) ?? { head: item, items: [], total: 0 };
    group.items.push(item);
    group.total += item.expectedValue ?? 0;
    groups.set(item.customerId, group);
  }
  return [...groups.values()].map((group) => ({
    customerId: group.head.customerId,
    customerCode: group.head.customerCode,
    customerName: group.head.customerName,
    count: group.items.length,
    totalValue: group.total,
    items: group.items,
  }));
}

/** Hạn của việc đã quá hạn (so theo ngày, `YYYY-MM-DD`). */
export function isDueOverdue(dueDate: string | null | undefined, now = new Date()): boolean {
  if (!dueDate) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dueDate.slice(0, 10) < today;
}

/** Giai đoạn có thể chọn bỏ qua lúc tạo dự án: đang bật, nghĩa Đang chạy, cho phép bỏ qua, không phải giai đoạn đầu. */
export function skippableStartStages(pipeline: Pipeline | undefined): PipelineStage[] {
  if (!pipeline) return [];
  const open = pipeline.stages.filter((stage) => stage.active && stage.semantic === 'OPEN');
  const first = open[0];
  return open.filter((stage) => stage.skippable && stage.id !== first?.id);
}

/**
 * Chuyển lựa chọn bỏ qua (mã giai đoạn → lý do) thành `skipStages` của yêu cầu tạo dự án.
 * Trả `error` khi thiếu lý do; bỏ qua mã không còn trong luồng.
 */
export function buildSkipStages(
  pipeline: Pipeline | undefined,
  chosen: Readonly<Record<string, string>>,
): { skipStages: { stage: string; reason: string }[]; error?: string } {
  const skipStages: { stage: string; reason: string }[] = [];
  for (const stage of skippableStartStages(pipeline)) {
    if (!(stage.code in chosen)) continue;
    const reason = chosen[stage.code].trim();
    if (!reason) return { skipStages: [], error: `Vui lòng ghi lý do bỏ qua giai đoạn "${stage.name}".` };
    skipStages.push({ stage: stage.code, reason });
  }
  return { skipStages };
}
