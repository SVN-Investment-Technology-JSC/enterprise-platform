import type { WorkItemChecklistItem } from '@enterprise-platform/contracts-workspace';

/** Phần chung của đầu việc dự án (`WorkItemChecklistItem`) và đầu việc Công việc khác (`StandaloneTaskChecklistItem`). */
export interface ChecklistEntry {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly doneAt?: string;
  readonly doneBy?: string;
  readonly sortOrder: number;
}

/**
 * Hàng đợi tuần tự: mỗi tác vụ chỉ bắt đầu khi tác vụ trước (thành công hay lỗi) đã xong. Dùng cho các yêu cầu ghi của
 * CÙNG một công việc, để server không tính lại tiến độ song song và kết quả về đúng thứ tự thao tác của người dùng.
 * Lỗi của một tác vụ chỉ trả cho người gọi tác vụ đó, không làm hỏng các tác vụ sau.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** Id tạm của đầu việc vừa thêm lạc quan, chưa có id thật từ server. */
const TEMP_PREFIX = 'tmp:';

export const isTempChecklistId = (id: string) => id.startsWith(TEMP_PREFIX);

export function makeTempChecklistItem(workItemId: string, title: string, seq: number): WorkItemChecklistItem {
  return { id: `${TEMP_PREFIX}${seq}`, workItemId, title, done: false, sortOrder: Number.MAX_SAFE_INTEGER };
}

/** Tích / bỏ tích một đầu việc ngay trên màn; người tích và giờ tích do server ghi nên xoá tạm khi bỏ tích. */
export function applyDone<T extends ChecklistEntry>(
  items: readonly T[],
  id: string,
  done: boolean,
  by?: string,
  at?: string,
): readonly T[] {
  return items.map((entry) => {
    if (entry.id !== id) return entry;
    const base: Record<string, unknown> = { ...(entry as ChecklistEntry) };
    delete base['doneBy'];
    delete base['doneAt'];
    return (done
      ? { ...base, done, ...(by ? { doneBy: by } : {}), ...(at ? { doneAt: at } : {}) }
      : { ...base, done }) as unknown as T;
  });
}

export function applyTitle<T extends ChecklistEntry>(items: readonly T[], id: string, title: string): readonly T[] {
  return items.map((entry) => (entry.id === id ? { ...entry, title } : entry));
}

export function applyRemove<T extends ChecklistEntry>(items: readonly T[], id: string): readonly T[] {
  return items.filter((entry) => entry.id !== id);
}

export function applyAppend<T extends ChecklistEntry>(items: readonly T[], added: readonly T[]): readonly T[] {
  return [...items, ...added];
}

/** Chèn lại đầu việc đã xoá lạc quan về đúng vị trí cũ (khôi phục khi xoá lỗi). */
export function applyRestore<T extends ChecklistEntry>(items: readonly T[], entry: T, index: number): readonly T[] {
  if (items.some((other) => other.id === entry.id)) return items;
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, entry);
  return next;
}

/** Đặt lại trạng thái cũ của một đầu việc (khôi phục khi tích / sửa tên lỗi), nếu nó còn trên màn. */
export function applyReplace<T extends ChecklistEntry>(items: readonly T[], entry: T): readonly T[] {
  return items.map((other) => (other.id === entry.id ? entry : other));
}

export function removeTempItems<T extends ChecklistEntry>(items: readonly T[], ids: readonly string[]): readonly T[] {
  const drop = new Set(ids);
  return items.filter((entry) => !drop.has(entry.id));
}

/**
 * Có nhận danh sách server vừa trả về không: chỉ khi đó là phản hồi của yêu cầu ghi CUỐI CÙNG đang chờ. Phản hồi của
 * yêu cầu giữa chừng không có các thao tác lạc quan xếp sau, nhận vào sẽ làm hàng vừa tích bật ngược lại.
 */
export const shouldAcceptServerList = (pendingWrites: number) => pendingWrites <= 1;

/**
 * Sau khi một yêu cầu ghi xong (đã trừ khỏi số đang chờ): chỉ nạp lại cả công việc khi không còn yêu cầu nào chờ, để
 * tích nhanh nhiều hàng chỉ nạp một lần.
 */
export const shouldReloadAfterWrite = (pendingAfter: number) => pendingAfter <= 0;

/** Đầu việc nhận focus sau khi xoá `id`: dòng liền sau, không có thì dòng liền trước; hết dòng thì `undefined`. */
export function focusIdAfterRemove(items: readonly ChecklistEntry[], id: string): string | undefined {
  const index = items.findIndex((entry) => entry.id === id);
  if (index < 0) return undefined;
  const rest = items.filter((entry) => entry.id !== id);
  return rest[Math.min(index, rest.length - 1)]?.id;
}
