import type { ChatMessage, ChatReader } from '@enterprise-platform/contracts-workspace';

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

const before = (a: ChatMessage, b: ChatMessage): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Gộp trang mới nhất vừa tải vào danh sách đang có, nhưng không để lại "lỗ hổng".
 *
 * Trang chỉ có vài tin: nếu có nhiều tin đến hơn một trang kể từ lần tải trước (tab ở nền,
 * mất mạng) thì trang mới nhất không chạm tới tin nào đang có, và gộp thẳng sẽ thiếu các tin
 * ở giữa mà người dùng không hề biết. Khi đó bỏ danh sách cũ, chỉ giữ trang mới; tin cũ hơn
 * vẫn tải được bằng cách cuộn lên (`reset = true` để nơi gọi đặt lại `hasMore`).
 */
export function mergeLatestPage(
  current: readonly ChatMessage[],
  page: readonly ChatMessage[],
  pageHasMore: boolean,
): { readonly messages: readonly ChatMessage[]; readonly reset: boolean } {
  const newest = current[current.length - 1];
  const oldestOfPage = page[0];
  if (pageHasMore && newest && oldestOfPage && before(oldestOfPage, newest) > 0) {
    const known = new Set(current.map((message) => message.id));
    if (!page.some((message) => known.has(message.id))) return { messages: page, reset: true };
  }
  return { messages: mergeMessages(current, page), reset: false };
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

/* ---------------------------------------------------------------------------
   "Đã xem bởi"
   --------------------------------------------------------------------------- */

/**
 * Những người đã đọc tới đúng tin mới nhất của luồng (trừ người gửi tin đó và
 * chính mình), để hiện dòng "Đã xem: …".
 *
 * So bằng id tin, không bằng thời điểm: thời điểm bị làm tròn mili giây ở phía
 * trình duyệt nên hai tin sát nhau có thể bị coi nhầm là đã xem.
 */
export function seenByNewest(
  messages: readonly ChatMessage[],
  readers: readonly ChatReader[],
  currentUserId: string,
): string[] {
  const newest = messages[messages.length - 1];
  if (!newest) return [];
  return readers
    .filter(
      (reader) =>
        reader.messageId === newest.id &&
        reader.userId !== newest.createdBy &&
        reader.userId !== currentUserId,
    )
    .map((reader) => reader.userId);
}

/** Ghi nhận một người vừa đọc tới `messageId` (tín hiệu `read` từ máy chủ). */
export function withReader(
  readers: readonly ChatReader[],
  userId: string,
  messageId: string,
): readonly ChatReader[] {
  return [...readers.filter((reader) => reader.userId !== userId), { userId, messageId }];
}

/** "Đã xem: A, B" — quá ba người thì rút gọn, tên đầy đủ để ở tooltip. */
export function seenLabel(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 3) return `Đã xem: ${names.join(', ')}`;
  return `Đã xem: ${names.slice(0, 2).join(', ')} và ${names.length - 2} người khác`;
}

/* ---------------------------------------------------------------------------
   "Đang nhập"
   --------------------------------------------------------------------------- */

/** Không có tín hiệu mới trong chừng này thì coi như người đó đã ngừng gõ. */
export const TYPING_TTL_MS = 5_000;
/** Người gõ liên tục chỉ báo lại sau chừng này, không báo mỗi phím. */
export const TYPING_SEND_INTERVAL_MS = 3_000;

/** Bảng "ai đang gõ" → thời điểm hết hiệu lực. */
export type TypingMap = Readonly<Record<string, number>>;

export function withTyping(
  current: TypingMap,
  userId: string,
  typing: boolean,
  now: number,
): TypingMap {
  if (!typing) {
    if (!(userId in current)) return current;
    const { [userId]: _removed, ...rest } = current;
    return rest;
  }
  return { ...current, [userId]: now + TYPING_TTL_MS };
}

/** Những người còn hiệu lực tại thời điểm `now`, theo thứ tự bắt đầu gõ. */
export function activeTypers(current: TypingMap, now: number): string[] {
  return Object.entries(current)
    .filter(([, expiresAt]) => expiresAt > now)
    .map(([userId]) => userId);
}

/** Bỏ các mục đã hết hạn; trả lại đúng đối tượng cũ nếu không có gì đổi (khỏi vẽ lại). */
export function pruneTyping(current: TypingMap, now: number): TypingMap {
  const alive = Object.entries(current).filter(([, expiresAt]) => expiresAt > now);
  return alive.length === Object.keys(current).length ? current : Object.fromEntries(alive);
}

/**
 * "A đang nhập", "A và B đang nhập", "A, B và 2 người khác đang nhập".
 *
 * Không kèm dấu chấm lửng: giao diện vẽ biểu tượng ba chấm chuyển động ngay sau nhãn.
 */
export function typingLabel(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} đang nhập`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đang nhập`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác đang nhập`;
}

/**
 * Có nên báo "tôi đang gõ" lên máy chủ lúc này không.
 *
 * Báo ngay khi bắt đầu gõ, rồi nhắc lại mỗi `TYPING_SEND_INTERVAL_MS` khi còn gõ;
 * báo "ngừng" đúng một lần khi xoá hết nội dung. Không báo gì khi ô trống từ đầu.
 */
export function nextTypingSignal(
  state: { readonly typing: boolean; readonly at: number },
  hasText: boolean,
  now: number,
): { readonly send?: boolean; readonly state: { readonly typing: boolean; readonly at: number } } {
  if (hasText) {
    if (!state.typing || now - state.at >= TYPING_SEND_INTERVAL_MS) {
      return { send: true, state: { typing: true, at: now } };
    }
    return { state };
  }
  return state.typing ? { send: false, state: { typing: false, at: now } } : { state };
}
