import type { ChatMessage } from '@enterprise-platform/contracts-workspace';

/**
 * Gộp tin mới tải về vào danh sách đang có, theo id.
 *
 * Tải lại trang mới nhất khi có tín hiệu không được làm mất những trang cũ mà
 * người dùng đã cuộn lên xem; tin trùng id lấy bản mới (đã sửa hoặc thu hồi).
 * Sắp cũ → mới; cùng thời điểm thì theo id để thứ tự ổn định giữa các lần tải.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): readonly ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Tách tin thành "gốc" và nhóm trả lời.
 *
 * Trả lời mà tin gốc còn nằm ở trang cũ chưa tải vẫn được xếp vào gốc: nếu ẩn
 * đi, tin mới của người khác sẽ biến mất cho tới khi người dùng cuộn lên tải
 * gốc. Khi gốc được tải, trả lời tự về đúng chỗ dưới gốc.
 */
export function groupThread(messages: readonly ChatMessage[]): {
  readonly roots: readonly ChatMessage[];
  readonly repliesOf: (parentId: string) => readonly ChatMessage[];
} {
  const loaded = new Set(messages.map((message) => message.id));
  return {
    roots: messages.filter((message) => !message.parentId || !loaded.has(message.parentId)),
    repliesOf: (parentId) => messages.filter((message) => message.parentId === parentId),
  };
}
