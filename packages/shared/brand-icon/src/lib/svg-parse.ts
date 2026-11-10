const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export const INVALID_SVG_MESSAGE = 'Mã SVG không hợp lệ. Hãy dán nguyên đoạn từ <svg> đến </svg>.';

/** Thực thể do tệp tự khai trong DOCTYPE (`<!ENTITY ns_svg "...">`, kiểu xuất của Illustrator): bóc ra và thay vào nội dung. */
function expandDeclaredEntities(text: string): string {
  const doctype = /<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/i.exec(text);
  if (!doctype) return text.replace(/<!DOCTYPE[^>]*>/i, '');
  const entities = new Map<string, string>();
  for (const match of doctype[1].matchAll(/<!ENTITY\s+([^\s]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) {
    entities.set(match[1], match[2] ?? match[3] ?? '');
  }
  let result = text.replace(doctype[0], '');
  for (const [name, value] of entities) result = result.split(`&${name};`).join(value);
  return result;
}

/** Thẻ `<svg ...>` đầu tiên thiếu khai báo `xmlns`/`xmlns:xlink` thì thêm vào, để bộ đọc XML nghiêm ngặt không từ chối oan. */
function ensureNamespaces(text: string): string {
  return text.replace(/<svg\b([^>]*?)(\/?)>/i, (whole, attrs: string, selfClose: string) => {
    let next = attrs;
    if (!/\sxmlns\s*=/.test(attrs)) next += ` xmlns="${SVG_NS}"`;
    if (/\bxlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(attrs)) next += ` xmlns:xlink="${XLINK_NS}"`;
    return next === attrs ? whole : `<svg${next}${selfClose}>`;
  });
}

/**
 * Đọc mã SVG thành cây phần tử, không chèn vào trang. Thử bộ đọc XML nghiêm ngặt trước (cách trình duyệt đọc tệp `.svg`);
 * lỗi cú pháp thì dùng bộ đọc HTML dễ tính (thực thể `&nbsp;`, thẻ không đóng, thuộc tính thiếu dấu nháy...), giống khi dán
 * mã vào trang web. Nội dung không có thẻ `<svg>` (vài phần tử rời) được bọc vào một thẻ `<svg>`.
 */
export function parseSvgMarkup(markup: string): Element {
  if (typeof DOMParser === 'undefined') throw new Error('Trình duyệt không hỗ trợ đọc SVG.');
  const text = markup.replace(/^\uFEFF/, '').trim();
  const wrapped = /<svg[\s>/]/i.test(text) ? text : `<svg xmlns="${SVG_NS}">${text}</svg>`;

  const attempt = (source: string): Element | null => {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) return null;
    const root = parsed.documentElement;
    return root && root.localName.toLowerCase() === 'svg' ? root : null;
  };

  const prepared = ensureNamespaces(expandDeclaredEntities(wrapped));
  const strict = attempt(prepared);
  if (strict) return strict;

  const html = new DOMParser().parseFromString(prepared, 'text/html');
  const lenient = html.querySelector('svg');
  if (lenient) return lenient;
  throw new Error(INVALID_SVG_MESSAGE);
}
