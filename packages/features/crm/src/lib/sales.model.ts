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
  OPPORTUNITY_STAGE_TRANSITIONS,
  QUOTE_STATUS_LABELS,
  type Activity,
  type CrmPerson,
  type CustomerTimelineEntry,
  type OpportunityBoard,
  type OpportunityStage,
  type OpportunitySummary,
  type QuoteStatus,
} from '@enterprise-platform/contracts-crm';
import { FULFILLMENT_ACTION_LABELS } from './fulfillment.model';

/**
 * Logic thuần của các màn Bán hàng (không React), để kiểm thử riêng. Quyền và
 * luật thật nằm ở API; ở đây chỉ để giao diện phản hồi nhanh.
 */

/** Thả thẻ từ cột `from` sang `to` có hợp lệ không (cùng bảng chuyển với server). */
export function canDropStage(from: OpportunityStage, to: OpportunityStage): boolean {
  return OPPORTUNITY_STAGE_TRANSITIONS[from].includes(to);
}

/**
 * Chuyển thẻ sang cột mới ngay trên giao diện (lạc quan). Trả bảng mới, giữ
 * nguyên bảng cũ để hoàn tác khi API lỗi. Thẻ không có hoặc cùng cột: trả `undefined`.
 */
export function moveCard(
  board: OpportunityBoard,
  id: string,
  to: OpportunityStage,
): { board: OpportunityBoard; card: OpportunitySummary; from: OpportunityStage } | undefined {
  const fromColumn = board.columns.find((column) => column.items.some((item) => item.id === id));
  const card = fromColumn?.items.find((item) => item.id === id);
  if (!fromColumn || !card || fromColumn.stage === to) return undefined;
  const moved: OpportunitySummary = { ...card, stage: to };
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
      return { title: `Tạo cơ hội "${entry.opportunityName}"`, detail: OPPORTUNITY_STAGE_LABELS[entry.stage] };
    case 'opportunity-stage-changed':
      return {
        title: `Cơ hội "${entry.opportunityName}": ${OPPORTUNITY_STAGE_LABELS[entry.fromStage]} → ${OPPORTUNITY_STAGE_LABELS[entry.toStage]}`,
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
};

