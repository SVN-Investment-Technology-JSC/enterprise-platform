import type { ProjectMember } from '@enterprise-platform/contracts-workspace';

/** Trạng thái của ô gợi ý `@`. */
export interface MentionQuery {
  /** Vị trí ký tự `@` trong ô nhập. */
  readonly start: number;
  /** Phần đã gõ sau dấu `@`. */
  readonly term: string;
}

/**
 * Tìm lượt `@` đang gõ dở ngay trước con trỏ.
 *
 * Trả `undefined` khi con trỏ không nằm trong một lượt nhắc — lúc đó ô gợi ý
 * phải đóng. Quy tắc: `@` phải đứng đầu dòng hoặc sau khoảng trắng, và phần
 * sau nó chưa có khoảng trắng nào.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return undefined;

  // `@` dính vào một từ khác, ví dụ trong địa chỉ thư, không phải lượt nhắc.
  const preceding = at === 0 ? ' ' : before[at - 1];
  if (preceding !== ' ' && preceding !== '\n') return undefined;

  const term = before.slice(at + 1);
  if (/\s/.test(term)) return undefined;

  return { start: at, term };
}

/**
 * Thành viên khớp từ khoá đang gõ — theo tên hiển thị (không phân biệt dấu)
 * hoặc theo id.
 *
 * Chỉ gợi ý người trong dự án. Server vẫn đối chiếu lại danh sách này và loại
 * id lạ, nên gợi ý ở client là tiện lợi chứ không phải hàng rào.
 */
export function suggestMembers(
  members: readonly ProjectMember[],
  term: string,
  nameOf: (userId: string) => string = (userId) => userId,
  limit = 6,
): ProjectMember[] {
  const needle = fold(term.trim());
  const matched = needle
    ? members.filter(
        (member) =>
          fold(nameOf(member.userId)).replace(/\s+/g, '').includes(needle) ||
          member.userId.toLowerCase().includes(needle),
      )
    : [...members];
  return matched.slice(0, limit);
}

/**
 * Tên gọn dùng sau dấu `@` trong nội dung tin: bỏ dấu, bỏ khoảng trắng, viết
 * hoa đầu mỗi từ — "Nguyễn Thị Mai" thành `NguyenThiMai`.
 *
 * Không có khoảng trắng vì `findMentionQuery` coi khoảng trắng là hết lượt
 * nhắc. Hai thành viên trùng tên gọn thì cả hai được thêm đuôi 4 ký tự đầu
 * của id, để người đọc vẫn phân biệt được và `extractMentions` không nhầm.
 */
export function mentionHandles(
  members: readonly ProjectMember[],
  nameOf: (userId: string) => string,
): Map<string, string> {
  const base = new Map(
    members.map((member) => {
      const words = fold(nameOf(member.userId))
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      const handle = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
      return [member.userId, handle || member.userId] as const;
    }),
  );
  const counts = new Map<string, number>();
  for (const handle of base.values()) counts.set(handle, (counts.get(handle) ?? 0) + 1);

  // Trùng tên thì thêm đuôi id, dài dần 4 → 8 → cả id cho tới khi hết trùng.
  const result = new Map<string, string>();
  const collided = [...base].filter(([, handle]) => (counts.get(handle) ?? 0) > 1);
  for (const [userId, handle] of base) {
    if ((counts.get(handle) ?? 0) <= 1) result.set(userId, handle);
  }
  for (const length of [4, 8, Infinity]) {
    const pending = collided.filter(([userId]) => !result.has(userId));
    if (pending.length === 0) break;
    const suffixed = pending.map(
      ([userId, handle]) => [userId, `${handle}-${userId.slice(0, length)}`] as const,
    );
    const tally = new Map<string, number>();
    for (const [, candidate] of suffixed) tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
    for (const [userId, candidate] of suffixed) {
      if ((tally.get(candidate) ?? 0) === 1 || length === Infinity) result.set(userId, candidate);
    }
  }
  return result;
}

/** Chèn lượt nhắc đã chọn vào ô nhập, trả về văn bản mới và vị trí con trỏ. */
export function applyMention(
  text: string,
  query: MentionQuery,
  caret: number,
  token: string,
): { text: string; caret: number } {
  const inserted = `@${token} `;
  const next = text.slice(0, query.start) + inserted + text.slice(caret);
  return { text: next, caret: query.start + inserted.length };
}

/**
 * Rút các id được nhắc ra khỏi nội dung.
 *
 * Nhận cả tên gọn (`@NguyenThiMai`, xem `mentionHandles`) lẫn id trần. Chỉ
 * nhận token trùng khớp với một thành viên thật: gõ `@abc` bừa sẽ không tạo
 * ra một lượt nhắc trỏ tới hư không.
 */
export function extractMentions(
  text: string,
  members: readonly ProjectMember[],
  handles: ReadonlyMap<string, string> = new Map(),
): string[] {
  const byToken = new Map<string, string>();
  for (const member of members) byToken.set(member.userId, member.userId);
  for (const [userId, handle] of handles) byToken.set(handle, userId);
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)@(\S+)/g)) {
    const userId = byToken.get(match[1] ?? '');
    if (userId) found.add(userId);
  }
  return [...found];
}

/** Bỏ dấu và viết thường để so khớp tên tiếng Việt. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
