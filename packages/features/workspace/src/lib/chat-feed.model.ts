import type { ProjectChatFeedItem, WorkItem } from '@enterprise-platform/contracts-workspace';

/** Một dòng của danh sách công việc trên màn "Trao đổi công việc". */
export interface ChatFeedRow {
  readonly item: WorkItem;
  /** Chuỗi công việc cha, từ gốc xuống cha trực tiếp; để người đọc biết việc nằm ở nhánh nào. */
  readonly ancestors: readonly WorkItem[];
  /** Tin mới nhất; vắng nghĩa là công việc chưa có trao đổi nào. */
  readonly latestAt?: string;
  readonly latestBy?: string;
  readonly latestBody?: string;
  readonly messageCount: number;
}

function ancestorsOf(item: WorkItem, byId: ReadonlyMap<string, WorkItem>): WorkItem[] {
  const chain: WorkItem[] = [];
  const seen = new Set<string>([item.id]);
  let cursor = item.parentId ? byId.get(item.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}

/**
 * Ghép một trang danh sách của server với thông tin công việc đã có trên màn hình (mã, tiêu đề, cha).
 *
 * Giữ nguyên thứ tự server trả. Công việc không còn trong danh sách của dự án (vừa bị xoá, chưa kịp
 * tải lại) bị bỏ, vì không có gì để hiện hay mở.
 */
export function buildChatFeedRows(
  page: readonly ProjectChatFeedItem[],
  items: readonly WorkItem[],
): ChatFeedRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: ChatFeedRow[] = [];
  for (const entry of page) {
    const item = byId.get(entry.workItemId);
    if (!item) continue;
    rows.push({
      item,
      ancestors: ancestorsOf(item, byId),
      latestAt: entry.latestAt,
      latestBy: entry.latestBy,
      latestBody: entry.latestBody,
      messageCount: entry.messageCount,
    });
  }
  return rows;
}

/** Dòng xem trước trong danh sách: tên người nhắn tách riêng để tô sáng từ khoá chỉ ở phần nội dung. */
export interface RowPreview {
  readonly author?: string;
  readonly text: string;
}

/** Xem trước tin mới nhất gọn trên một dòng; việc chưa có tin thì vắng. */
export function previewOf(row: ChatFeedRow, nameOf: (userId: string) => string): RowPreview | undefined {
  if (!row.latestBody) return undefined;
  return {
    author: row.latestBy ? nameOf(row.latestBy) : undefined,
    text: row.latestBody.replace(/\s+/g, ' ').trim(),
  };
}

/** Một đoạn của chuỗi: `match` là đoạn khớp từ khoá, để tô sáng. */
export interface TermPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Tách chuỗi theo từ khoá (không phân biệt hoa thường) để tô sáng chỗ khớp.
 * Từ khoá rỗng hoặc không khớp thì trả nguyên chuỗi một đoạn.
 */
export function splitByTerm(text: string, term: string | undefined): TermPart[] {
  const needle = term?.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  // `toLowerCase` có thể đổi độ dài (một vài chữ đặc biệt): khi đó chỉ số lệch, nên không tô sáng thay vì tô sai chỗ.
  if (haystack.length !== text.length) return [{ text, match: false }];
  const parts: TermPart[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
