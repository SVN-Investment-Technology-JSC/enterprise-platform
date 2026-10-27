import {
  ACTIVITY_TYPE_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_TRANSITIONS,
  type Activity,
  type CrmPerson,
  type CustomerTimelineEntry,
  type OpportunityBoard,
  type OpportunityStage,
  type OpportunitySummary,
} from '@enterprise-platform/contracts-crm';

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
    default:
      return { title: 'Sự kiện khác' };
  }
}
