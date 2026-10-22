import {
  SOCIAL_SEARCH_MAX_TERMS,
  SOCIAL_SEARCH_QUERY_MAX,
  SOCIAL_SEARCH_QUERY_MIN,
} from '@enterprise-platform/contracts-social';
import { SocialValidationError } from './social.error.js';

/**
 * Gập chữ để tìm kiếm: bỏ dấu tiếng Việt, hạ chữ thường. Cùng kết quả với `normalizeSearchText` của
 * contracts-realtime và hàm SQL `social_schema.fold_text()` (migration 0002) cho chữ tiếng Việt, nên từ
 * khoá gập ở đây khớp với cột sinh `posts.search_text` / `groups.search_text`.
 */
export function foldSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export interface SearchQuery {
  /** Từ khoá người dùng nhập, đã cắt khoảng trắng hai đầu. */
  readonly text: string;
  /** Các từ đã gập, chỉ gồm `[a-z0-9]`, không trùng, tối đa `SOCIAL_SEARCH_MAX_TERMS`. */
  readonly tokens: readonly string[];
}

/** Kiểm độ dài rồi tách từ; ném 400 khi từ khoá quá ngắn/dài hoặc không có chữ hay số nào. */
export function normalizeSearchQuery(raw: unknown): SearchQuery {
  if (typeof raw !== 'string') throw new SocialValidationError('Hãy nhập từ khoá tìm kiếm.');
  const text = raw.trim();
  if (text.length < SOCIAL_SEARCH_QUERY_MIN || text.length > SOCIAL_SEARCH_QUERY_MAX) {
    throw new SocialValidationError(
      `Từ khoá tìm kiếm cần từ ${SOCIAL_SEARCH_QUERY_MIN} đến ${SOCIAL_SEARCH_QUERY_MAX} ký tự.`,
    );
  }
  const tokens = [
    ...new Set(
      foldSearchText(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ].slice(0, SOCIAL_SEARCH_MAX_TERMS);
  if (tokens.length === 0) throw new SocialValidationError('Từ khoá tìm kiếm cần có chữ hoặc số.');
  return { text, tokens };
}

/**
 * Chuỗi cho `to_tsquery('simple', ...)`: mọi từ là tiền tố và đều phải có (`từ1:* & từ2:*`). Từ chỉ gồm
 * `[a-z0-9]` (xem `normalizeSearchQuery`) nên không thể chèn toán tử tsquery.
 */
export function buildPrefixTsQuery(tokens: readonly string[]): string {
  return tokens.map((token) => `${token}:*`).join(' & ');
}

/** Mẫu `LIKE` cho tìm nhóm: mỗi từ phải xuất hiện trong `groups.search_text`. */
export function buildLikePatterns(tokens: readonly string[]): string[] {
  return tokens.map((token) => `%${token}%`);
}
