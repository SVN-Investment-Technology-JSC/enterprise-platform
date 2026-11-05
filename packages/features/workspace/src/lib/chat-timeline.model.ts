import type { ChatTimelineFilter, ProjectChatTimelineItem, WorkItem } from '@enterprise-platform/contracts-workspace';
import { ancestorsOf } from './chat-feed.model';

/** Vạch ngăn giữa hai ngày trên dòng thời gian. */
export interface TimelineDayRow {
  readonly kind: 'day';
  readonly key: string;
  /** Ngày theo giờ máy người xem, dạng `YYYY-MM-DD`. */
  readonly day: string;
}

/** Một tin trên dòng thời gian, kèm công việc chứa nó để dựng chip và liên kết. */
export interface TimelineMessageRow {
  readonly kind: 'message';
  readonly key: string;
  readonly entry: ProjectChatTimelineItem;
  /** Vắng khi tin ở chat chung của dự án, hoặc công việc đã bị xoá / chưa có trên màn hình. */
  readonly work?: WorkItem;
  readonly ancestors: readonly WorkItem[];
  /** Chỉ hiện chip khi tin này không liền sau một tin cùng công việc, để một mạch trao đổi không lặp chip. */
  readonly showChip: boolean;
}

export type TimelineRow = TimelineDayRow | TimelineMessageRow;

const pad = (value: number) => String(value).padStart(2, '0');

/** Ngày theo giờ máy người xem: tin lúc 23h50 hiện ở ngày hôm đó chứ không nhảy sang ngày UTC kế. */
export function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Dựng các dòng của dòng thời gian từ tin đã xếp cũ → mới: chèn vạch ngày khi sang ngày mới, và đánh dấu tin
 * nào cần chip công việc. Tin của cùng một công việc đứng liền nhau thì chỉ tin đầu mạch mang chip.
 */
export function buildTimelineRows(
  entries: readonly ProjectChatTimelineItem[],
  items: readonly WorkItem[],
): TimelineRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: TimelineRow[] = [];
  let currentDay: string | undefined;
  let previousNode: string | undefined;
  for (const entry of entries) {
    const day = dayKeyOf(entry.message.createdAt);
    if (day !== currentDay) {
      rows.push({ kind: 'day', key: `day-${day}`, day });
      currentDay = day;
      previousNode = undefined;
    }
    const node = `${entry.entityType}:${entry.entityId}`;
    const work = entry.entityType === 'work_item' ? byId.get(entry.entityId) : undefined;
    rows.push({
      kind: 'message',
      key: entry.message.id,
      entry,
      work,
      ancestors: work ? ancestorsOf(work, byId) : [],
      showChip: node !== previousNode,
    });
    previousNode = node;
  }
  return rows;
}

/** Sắc độ (hue, 0-360) cách xa nhau để chip của các công việc kề nhau dễ phân biệt; nền chip chỉ là màu pha nhạt. */
export const CHIP_HUES = [210, 145, 28, 285, 350, 175, 48, 235, 320, 100] as const;

/**
 * Mỗi công việc một sắc độ cố định theo vị trí trong danh sách công việc của dự án: các công việc đầu danh sách
 * không bao giờ trùng màu nhau (ngẫu nhiên theo id dễ trùng khi dự án chỉ có vài công việc).
 */
export function chipHueMap(items: readonly WorkItem[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, CHIP_HUES[index % CHIP_HUES.length]]));
}

/** Tách dòng thời gian thành tin của các công việc (cột trái) và tin chat chung của dự án (cột phải); giữ thứ tự. */
export function splitTimeline(entries: readonly ProjectChatTimelineItem[]): {
  work: ProjectChatTimelineItem[];
  project: ProjectChatTimelineItem[];
} {
  const work: ProjectChatTimelineItem[] = [];
  const project: ProjectChatTimelineItem[] = [];
  for (const entry of entries) (entry.entityType === 'project' ? project : work).push(entry);
  return { work, project };
}

/**
 * Gộp các trang của truy vấn nhiều trang thành một danh sách cũ → mới. Trang đầu là tin mới nhất, các trang sau
 * cũ dần; mỗi trang đã xếp cũ → mới. Tin trùng id (trang dịch chỗ khi có tin mới) chỉ giữ một.
 */
export function flattenTimelinePages(
  pages: readonly { readonly items: readonly ProjectChatTimelineItem[] }[],
): ProjectChatTimelineItem[] {
  const seen = new Set<string>();
  const merged: ProjectChatTimelineItem[] = [];
  for (const page of [...pages].reverse()) {
    for (const entry of page.items) {
      if (seen.has(entry.message.id)) continue;
      seen.add(entry.message.id);
      merged.push(entry);
    }
  }
  return merged;
}

/** Trạng thái các ô lọc trên giao diện; chuyển thành `ChatTimelineFilter` bằng `toTimelineFilter`. */
export interface TimelineFilterDraft {
  readonly q: string;
  /** Id người gửi đã chọn; rỗng là không lọc. */
  readonly authors: readonly string[];
  /** Id công việc đã chọn, hoặc `CHAT_TIMELINE_PROJECT_NODE`; rỗng là không lọc. */
  readonly nodes: readonly string[];
  readonly mentionsMe: boolean;
  readonly hasAttachment: boolean;
  /** Ngày dạng `YYYY-MM-DD` theo giờ máy người xem. */
  readonly fromDay: string;
  readonly toDay: string;
}

export const EMPTY_FILTER_DRAFT: TimelineFilterDraft = {
  q: '',
  authors: [],
  nodes: [],
  mentionsMe: false,
  hasAttachment: false,
  fromDay: '',
  toDay: '',
};

/** 0h của ngày `YYYY-MM-DD` theo giờ máy người xem, dạng ISO; ngày sai thì `undefined`. */
function localDayStart(day: string, offsetDays = 0): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Bộ lọc gửi lên server: bỏ giá trị rỗng để mỗi bộ lọc có đúng một dạng (khoá bộ nhớ đệm không lệch vì `''` hay
 * `false`). "Đến ngày" gồm cả ngày đó, nên mốc là 0h ngày kế tiếp.
 */
export function toTimelineFilter(draft: TimelineFilterDraft): ChatTimelineFilter {
  const q = draft.q.trim();
  return {
    ...(q ? { q } : {}),
    ...(draft.authors.length > 0 ? { authors: draft.authors } : {}),
    ...(draft.nodes.length > 0 ? { nodes: draft.nodes } : {}),
    ...(draft.mentionsMe ? { mentionsMe: true } : {}),
    ...(draft.hasAttachment ? { hasAttachment: true } : {}),
    ...(localDayStart(draft.fromDay) ? { from: localDayStart(draft.fromDay) } : {}),
    ...(localDayStart(draft.toDay, 1) ? { to: localDayStart(draft.toDay, 1) } : {}),
  };
}

/**
 * Số nhóm lọc nằm trong bảng "Bộ lọc" đang bật (người gửi, công việc, khoảng ngày, đính kèm), để đánh số lên nút.
 * Từ khoá và "Nhắc tôi" có ô riêng trên thanh nên không tính.
 */
export const panelFilterCount = (draft: TimelineFilterDraft): number =>
  [
    draft.authors.length > 0,
    draft.nodes.length > 0,
    Boolean(draft.fromDay || draft.toDay),
    draft.hasAttachment,
  ].filter(Boolean).length;

export const isTimelineFilterActive = (filter: ChatTimelineFilter) => Object.keys(filter).length > 0;

/** Cắt `text` theo từ khoá (không phân biệt hoa thường) để tô sáng chỗ khớp; từ khoá rỗng thì giữ nguyên một đoạn. */
export function splitByQuery(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
  const pattern = new RegExp(`(${escaped})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: part.toLowerCase() === needle.toLowerCase() }));
}
