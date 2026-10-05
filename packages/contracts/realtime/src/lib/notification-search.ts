/**
 * Tìm kiếm thông báo không phân biệt hoa thường và dấu tiếng Việt.
 *
 * Máy chủ (SQL) và trình duyệt (lọc thông báo vừa đến qua socket) phải cho cùng kết quả, nên bảng
 * chuyển ký tự nằm ở đây và được dùng cho cả hai phía.
 */

const VIETNAMESE_LOWER: Readonly<Record<string, string>> = {
  a: 'àáảãạăằắẳẵặâầấẩẫậ',
  e: 'èéẻẽẹêềếểễệ',
  i: 'ìíỉĩị',
  o: 'òóỏõọôồốổỗộơờớởỡợ',
  u: 'ùúủũụưừứửữự',
  y: 'ỳýỷỹỵ',
  d: 'đ',
};

function buildTranslation(): { from: string; to: string } {
  let from = '';
  let to = '';
  for (const [base, accented] of Object.entries(VIETNAMESE_LOWER)) {
    for (const char of accented) {
      from += char + char.toUpperCase();
      to += base + base;
    }
  }
  return { from, to };
}

const TRANSLATION = buildTranslation();

/** Hai chuỗi cùng độ dài để truyền cho `translate(cột, from, to)` trong PostgreSQL. */
export const SEARCH_TRANSLATE_FROM = TRANSLATION.from;
export const SEARCH_TRANSLATE_TO = TRANSLATION.to;

export const MAX_SEARCH_LENGTH = 100;
const MAX_SEARCH_TERMS = 5;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Tách ô tìm kiếm thành các từ; một thông báo phải chứa đủ mọi từ (theo thứ tự bất kỳ). */
export function searchTerms(query: string | undefined): readonly string[] {
  if (!query) return [];
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);
}

export function matchesSearch(
  record: { readonly title: string; readonly body: string },
  query: string | undefined,
): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(`${record.title} ${record.body}`);
  return terms.every((term) => haystack.includes(term));
}
