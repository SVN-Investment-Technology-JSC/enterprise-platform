/**
 * "Đang nhập" trong trao đổi của hồ sơ quy trình.
 *
 * Các hàm thuần, cùng ý với bản của Workspace nhưng để riêng trong feature này: hai feature không phụ thuộc
 * lẫn nhau, và phần chung nếu cần dùng chung thì nên tách thành thư viện riêng chứ không import chéo feature.
 */

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
 * Không kèm dấu chấm lửng: giao diện vẽ biểu tượng ba chấm chuyển động ngay sau nhãn.
 */
export function typingLabel(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} đang nhập`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đang nhập`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác đang nhập`;
}

/**
 * Có nên báo "tôi đang gõ" lên máy chủ lúc này không: báo ngay khi bắt đầu gõ, nhắc lại mỗi
 * `TYPING_SEND_INTERVAL_MS` khi còn gõ, báo "ngừng" đúng một lần khi xoá hết nội dung.
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
