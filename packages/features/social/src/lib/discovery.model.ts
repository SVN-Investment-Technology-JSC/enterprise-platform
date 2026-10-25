/**
 * Logic thuần cho trang cá nhân, tìm kiếm và sinh nhật (không dùng React, dễ kiểm thử).
 */
import {
  SOCIAL_SEARCH_MAX_TERMS,
  SOCIAL_SEARCH_QUERY_MAX,
  SOCIAL_SEARCH_QUERY_MIN,
  type SocialBirthday,
  type SocialSearchPostsQuery,
} from '@enterprise-platform/contracts-social';
import { sliceSafe } from './safe-text';

/* ---------------------------------------------------------- từ khoá */

/** Bỏ khoảng trắng thừa và cắt theo độ dài tối đa của hợp đồng. */
export function normalizeQuery(raw: string): string {
  return sliceSafe(raw.trim().replace(/\s+/g, ' '), SOCIAL_SEARCH_QUERY_MAX);
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= SOCIAL_SEARCH_QUERY_MIN;
}

/** Gập một ký tự: bỏ dấu tiếng Việt, chữ thường. Luôn trả đúng một ký tự để giữ vị trí. */
function foldChar(char: string): string {
  const lower = char.toLowerCase();
  if (lower === 'đ') return 'd';
  const base = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return base.length === 1 ? base : lower.length === 1 ? lower : char;
}

export function foldText(text: string): string {
  let out = '';
  for (const char of text) out += foldChar(char);
  return out;
}

/** Các từ khoá đã gập, không trùng, tối đa `SOCIAL_SEARCH_MAX_TERMS`. */
export function queryTerms(query: string): string[] {
  const terms = foldText(normalizeQuery(query)).split(' ').filter(Boolean);
  return [...new Set(terms)].slice(0, SOCIAL_SEARCH_MAX_TERMS);
}

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Chia văn bản thành các đoạn để tô sáng từ khoá (không phân biệt dấu và hoa thường).
 * Chỉ trả chuỗi thuần; nơi hiển thị dựng phần tử React, không chèn HTML.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = queryTerms(query);
  if (!text || terms.length === 0) return text ? [{ text, match: false }] : [];
  const chars = [...text];
  const folded = chars.map(foldChar).join('');
  const marks = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at < 0) break;
      for (let i = at; i < at + term.length; i += 1) marks[i] = true;
      from = at + term.length;
    }
  }
  const segments: HighlightSegment[] = [];
  chars.forEach((char, index) => {
    const match = marks[index] === true;
    const last = segments[segments.length - 1];
    if (last && last.match === match) segments[segments.length - 1] = { text: last.text + char, match };
    else segments.push({ text: char, match });
  });
  return segments;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** HTML của bài (đã làm sạch ở server) thành chữ thuần để hiện đoạn trích. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Đoạn trích tối đa `max` ký tự, ưu tiên khoảng quanh từ khoá đầu tiên khớp. */
export function snippetAround(text: string, query: string, max = 180): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const folded = chars.map(foldChar).join('');
  let first = -1;
  for (const term of queryTerms(query)) {
    const at = folded.indexOf(term);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  if (first < 0 || first < max - 40) return `${chars.slice(0, max).join('').trimEnd()}…`;
  const start = Math.max(0, first - 40);
  const slice = chars.slice(start, start + max).join('').trim();
  return `…${slice}${start + max < chars.length ? '…' : ''}`;
}

/* ------------------------------------------------------ khoảng thời gian */

export const DATE_PRESETS = [
  { value: 'any', label: 'Mọi lúc', days: 0 },
  { value: '7', label: '7 ngày qua', days: 7 },
  { value: '30', label: '30 ngày qua', days: 30 },
  { value: '90', label: '3 tháng qua', days: 90 },
  { value: '365', label: '12 tháng qua', days: 365 },
] as const;

/** Khoảng `from`/`to` (ISO 8601) cho lựa chọn có sẵn; "Mọi lúc" không có giới hạn. */
export function presetRange(preset: string, now: number = Date.now()): { from?: string; to?: string } {
  const found = DATE_PRESETS.find((item) => item.value === preset);
  if (!found || found.days === 0) return {};
  return { from: new Date(now - found.days * 86_400_000).toISOString(), to: new Date(now).toISOString() };
}

export interface SearchFilters {
  readonly topicId?: string;
  readonly groupId?: string;
  readonly authorId?: string;
  readonly preset: string;
}

export const EMPTY_FILTERS: SearchFilters = { preset: 'any' };

export function hasActiveFilters(filters: SearchFilters): boolean {
  return Boolean(filters.topicId || filters.groupId || filters.authorId || filters.preset !== 'any');
}

/** Tham số `GET /search/posts`; bỏ giá trị rỗng. */
export function toSearchPostsQuery(
  query: string,
  filters: SearchFilters,
  cursor?: string,
  now: number = Date.now(),
): SocialSearchPostsQuery {
  return {
    q: normalizeQuery(query),
    ...(filters.topicId ? { topicId: filters.topicId } : {}),
    ...(filters.groupId ? { groupId: filters.groupId } : {}),
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
    ...presetRange(filters.preset, now),
    ...(cursor ? { cursor } : {}),
  };
}

export function toQueryString(params: Readonly<Record<string, string | number | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/* ------------------------------------------------------------- sinh nhật */

const pad = (value: number) => String(value).padStart(2, '0');

/** Ngày và tháng, không năm: `05/03`. */
export function formatBirthday(birthday: SocialBirthday): string {
  return `${pad(birthday.day)}/${pad(birthday.month)}`;
}

export function birthdayCountdown(daysUntil: number): string {
  if (daysUntil <= 0) return 'Hôm nay';
  if (daysUntil === 1) return 'Ngày mai';
  return `Còn ${daysUntil} ngày`;
}

/** Ngày (ISO) thành `dd/MM/yyyy`; sai định dạng thì rỗng. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
