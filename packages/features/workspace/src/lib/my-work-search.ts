import {
  MY_WORK_SEARCH_FIELDS,
  MY_WORK_SEARCH_MAX_LENGTH,
  type MyWorkSearch,
  type MyWorkSearchField,
} from '@enterprise-platform/contracts-workspace';

/** Bỏ dấu một ký tự, đổi chữ thường, đ thành d. Kết quả có thể rỗng hoặc dài hơn 1 ký tự. */
const foldChar = (char: string): string =>
  char
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

/** Chuẩn hoá để so khớp: chữ thường, bỏ dấu, đ thành d, gộp khoảng trắng, cắt hai đầu (giống phía server). */
export const normaliseSearchText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Chữ tìm đã cắt độ dài tối đa rồi chuẩn hoá. */
export const normaliseQuery = (q: string): string => normaliseSearchText(q.slice(0, MY_WORK_SEARCH_MAX_LENGTH));

/** Các từ của chữ tìm (đã chuẩn hoá); rỗng nghĩa là không tìm. */
export const searchWords = (q: string): string[] => normaliseQuery(q).split(' ').filter(Boolean);

/** Id người trong danh bạ có tên chứa trọn chữ tìm (so khớp đã chuẩn hoá). */
export function resolvePersonIds(people: readonly { userId: string; displayName: string }[], q: string): string[] {
  const needle = normaliseQuery(q);
  if (!needle) return [];
  return people.filter((person) => normaliseSearchText(person.displayName).includes(needle)).map((p) => p.userId);
}

/** Điều kiện tìm gửi lên server; `undefined` khi chưa tìm gì. `personIds` chỉ có khi tìm theo người. */
export function buildMyWorkSearch(
  q: string,
  fields: readonly MyWorkSearchField[],
  people: readonly { userId: string; displayName: string }[],
): MyWorkSearch | undefined {
  const text = normaliseQuery(q);
  if (!text) return undefined;
  const personIds = fields.includes('people') ? resolvePersonIds(people, q) : undefined;
  return {
    q: q.slice(0, MY_WORK_SEARCH_MAX_LENGTH).trim(),
    fields: fields.length === 0 ? [...MY_WORK_SEARCH_FIELDS] : fields,
    personIds: personIds && personIds.length > 0 ? personIds : undefined,
  };
}

/**
 * Khoảng [bắt đầu, kết thúc) trong chuỗi GỐC khớp với các từ tìm. Chuẩn hoá từng ký tự một và ghi lại vị trí gốc của
 * mỗi ký tự đã chuẩn hoá, nên chỉ số luôn khớp dù chuỗi gốc có dấu tổ hợp.
 */
export function highlightRanges(text: string, words: readonly string[]): Array<[number, number]> {
  if (!text || words.length === 0) return [];
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const char of text) {
    const piece = foldChar(char);
    // Dấu tổ hợp rời (NFD) không sinh ký tự chuẩn hoá: gộp vào ký tự đứng trước để phần tô không tách dấu khỏi chữ.
    if (piece.length === 0 && ends.length > 0) ends[ends.length - 1] = at + char.length;
    for (let i = 0; i < piece.length; i += 1) {
      starts.push(at);
      ends.push(at + char.length);
    }
    folded += piece;
    at += char.length;
  }
  const raw: Array<[number, number]> = [];
  for (const word of words) {
    if (!word) continue;
    let from = folded.indexOf(word);
    while (from >= 0) {
      raw.push([starts[from], ends[from + word.length - 1]]);
      from = folded.indexOf(word, from + word.length);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export interface HighlightSegment {
  readonly text: string;
  readonly hit: boolean;
}

/** Cắt chuỗi gốc thành các đoạn, đoạn `hit` là phần khớp chữ tìm. */
export function splitHighlight(text: string, words: readonly string[]): HighlightSegment[] {
  const ranges = highlightRanges(text, words);
  if (ranges.length === 0) return [{ text, hit: false }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
