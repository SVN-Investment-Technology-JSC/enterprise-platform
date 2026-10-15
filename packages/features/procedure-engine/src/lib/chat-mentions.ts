import type { ChatPerson } from './chat-people';

/**
 * Mô hình `@` cho trao đổi của hồ sơ quy trình.
 *
 * Khác Workspace: ở đây nội dung dùng TÊN HIỂN THỊ ĐẦY ĐỦ có dấu cách (`@Nguyễn Tấn Thịnh`) vì đó là cách các
 * trao đổi cũ đã được lưu và hiển thị; nên phần gõ sau `@` được phép có khoảng trắng và việc nhận ra lượt nhắc
 * phải so theo tên dài nhất, không cắt ở chữ đầu.
 */
export interface MentionQuery {
  /** Vị trí ký tự `@` trong ô nhập. */
  readonly start: number;
  /** Phần đã gõ sau dấu `@` (có thể có dấu cách). */
  readonly term: string;
}

/** Quá dài thì chắc chắn không còn là đang gõ tên người. */
const MAX_TERM = 60;

/**
 * Lượt `@` đang gõ dở ngay trước con trỏ. `@` phải đứng đầu dòng hoặc sau khoảng trắng (không bắt nhầm địa
 * chỉ thư), và phần sau nó không xuống dòng.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return undefined;
  const term = before.slice(at + 1);
  if (term.includes('\n') || term.length > MAX_TERM) return undefined;
  return { start: at, term };
}

/** Bỏ dấu và viết thường để so khớp tên tiếng Việt. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Người khớp phần đang gõ (không phân biệt dấu/hoa thường), tên bắt đầu bằng từ khoá lên trước.
 *
 * Gõ xong đúng một tên đầy đủ rồi thêm dấu cách thì lượt nhắc đã hoàn tất: không gợi ý lại, kẻo danh sách bật
 * lên ngay sau khi vừa chọn xong.
 */
export function suggestPeople(
  people: readonly ChatPerson[],
  term: string,
  limit = 6,
): ChatPerson[] {
  const needle = fold(term.trim());
  if (/\s$/.test(term) && people.some((person) => fold(person.name) === needle)) return [];
  const matched = needle
    ? people.filter((person) => fold(person.name).includes(needle))
    : [...people];
  matched.sort((a, b) => {
    const aStarts = fold(a.name).startsWith(needle) ? 0 : 1;
    const bStarts = fold(b.name).startsWith(needle) ? 0 : 1;
    return aStarts - bStarts;
  });
  return matched.slice(0, limit);
}

/** Chèn lượt nhắc đã chọn vào ô nhập, trả về văn bản mới và vị trí con trỏ. */
export function applyMention(
  text: string,
  query: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, query.start) + inserted + text.slice(caret),
    caret: query.start + inserted.length,
  };
}

/** Một lượt nhắc hợp lệ trong văn bản: `[start, end)` gồm cả dấu `@`. */
export interface MentionSpan {
  readonly start: number;
  readonly end: number;
  readonly userId: string;
}

/**
 * Mọi lượt nhắc hợp lệ trong văn bản, theo thứ tự xuất hiện.
 *
 * Dùng chung cho tô màu và rút id người nhận để hai nơi không bao giờ lệch nhau: chữ hiện xanh thì đúng là
 * người đó sẽ được báo. `@` phải đứng đầu dòng hoặc sau khoảng trắng; khớp tên dài nhất trước (để "Nguyễn Văn A"
 * không bị khớp nhầm thành "Nguyễn Văn"); ký tự liền sau tên không được là chữ/số (để `@An` không ăn vào
 * `@Anh`), còn dấu câu thì được.
 */
export function scanMentions(text: string, people: readonly ChatPerson[]): MentionSpan[] {
  if (people.length === 0 || !text.includes('@')) return [];
  const ordered = [...people].sort((a, b) => b.name.length - a.name.length);
  const spans: MentionSpan[] = [];
  for (const match of text.matchAll(/(^|\s)@(?=\S)/g)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    const rest = text.slice(start + 1);
    const person = ordered.find(
      (candidate) =>
        rest.startsWith(candidate.name) &&
        !/^[\p{L}\p{N}]/u.test(rest.slice(candidate.name.length, candidate.name.length + 1)),
    );
    if (person) spans.push({ start, end: start + 1 + person.name.length, userId: person.id });
  }
  return spans;
}

/** Id người dùng được nhắc trong văn bản, không trùng, theo thứ tự xuất hiện. */
export function extractMentionIds(text: string, people: readonly ChatPerson[]): string[] {
  return [...new Set(scanMentions(text, people).map((span) => span.userId))];
}

/** Cắt văn bản thành đoạn thường và đoạn nhắc, để tô màu đoạn nhắc. */
export function splitByMentions(
  text: string,
  spans: readonly MentionSpan[],
): { readonly text: string; readonly mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), mention: false });
    parts.push({ text: text.slice(span.start, span.end), mention: true });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mention: false });
  return parts;
}

/** Mũi tên lên/xuống chọn người trong danh sách, đi vòng ở hai đầu. */
export function nextActiveIndex(
  current: number,
  key: 'ArrowUp' | 'ArrowDown',
  count: number,
): number {
  if (count <= 0) return 0;
  return key === 'ArrowDown' ? (current + 1) % count : (current - 1 + count) % count;
}
