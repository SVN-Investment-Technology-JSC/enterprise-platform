/**
 * Làm sạch HTML của bài viết bằng danh sách trắng.
 *
 * Bộ làm sạch tự duyệt từng thẻ (không dựng DOM) và **sinh lại** HTML từ những
 * gì được phép, thay vì lọc bỏ phần xấu khỏi chuỗi gốc:
 *
 * - Thẻ cho phép: p, br, strong, em, u, s, ul, ol, li, a, blockquote, h2, h3.
 *   Thẻ khác bị bỏ nhưng giữ chữ bên trong; riêng script, style, iframe, object,
 *   embed, svg, math, template, noscript thì bỏ luôn cả nội dung.
 * - Thuộc tính: chỉ `href` của thẻ `a`, và chỉ nhận http, https, mailto. Mọi
 *   thuộc tính khác (kể cả on*, style, class) bị bỏ. Thẻ `a` luôn được gắn
 *   `rel="noopener noreferrer nofollow" target="_blank"`.
 * - P1 không cho `img`: ảnh đi qua tệp đính kèm.
 * - Thẻ không cân được cân lại; thẻ đóng thừa bị bỏ; chữ được escape lại.
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'h2',
  'h3',
]);

const VOID_TAGS: ReadonlySet<string> = new Set(['br']);

/** Thẻ bị bỏ cùng toàn bộ nội dung bên trong. */
const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'textarea',
  'title',
  'head',
  'frameset',
  'applet',
]);

const ALLOWED_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const MAX_OPEN_DEPTH = 30;
const MAX_HREF_LENGTH = 2000;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
};

/** Giải mã thực thể HTML đủ dùng để kiểm `href` và đếm chữ (không dùng để xuất ra). */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Chữ giữa các thẻ: thực thể hợp lệ giữ nguyên, `&` lẻ thành `&amp;`,
 * `<` và `>` lẻ bị escape.
 */
function sanitizeText(value: string): string {
  return value
    .replace(/&(?!(?:#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Ký tự điều khiển, khoảng trắng và ký tự vô hình mà trình duyệt bỏ qua khi đọc scheme. */
function isIgnoredInUrl(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

/**
 * Địa chỉ an toàn cho `href`, hoặc `undefined`.
 *
 * Giải mã thực thể và bỏ ký tự điều khiển/khoảng trắng trước khi đọc scheme, để
 * `jav&#x09;ascript:` hay `java\nscript:` không lọt qua. Chỉ nhận URL tuyệt đối.
 */
export function safeHref(raw: string): string | undefined {
  const decoded = Array.from(decodeEntities(raw))
    .filter((char) => !isIgnoredInUrl(char.codePointAt(0) ?? 0))
    .join('');
  if (!decoded || decoded.length > MAX_HREF_LENGTH) return undefined;
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(decoded);
  if (!match || !ALLOWED_URL_PROTOCOLS.has(match[1].toLowerCase())) return undefined;
  try {
    const url = new URL(decoded);
    if (url.protocol === 'mailto:') return decoded;
    return url.hostname ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

interface ParsedTag {
  readonly name: string;
  readonly closing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
  /** Vị trí ngay sau dấu `>` của thẻ. */
  readonly end: number;
}

/** Đọc thẻ bắt đầu tại `start` (ký tự `<`); `undefined` nếu đó không phải thẻ. */
function parseTag(html: string, start: number): ParsedTag | undefined {
  let index = start + 1;
  let closing = false;
  if (html[index] === '/') {
    closing = true;
    index += 1;
  }
  const nameStart = index;
  while (index < html.length && /[a-zA-Z0-9:-]/.test(html[index])) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();
  if (!name || !/^[a-z]/.test(name)) return undefined;

  const attributes = new Map<string, string>();
  while (index < html.length) {
    while (index < html.length && /[\s/]/.test(html[index])) index += 1;
    if (html[index] === '>') return { name, closing, attributes, end: index + 1 };
    if (index >= html.length) return undefined;

    const attrStart = index;
    while (index < html.length && !/[\s=>/]/.test(html[index])) index += 1;
    const attrName = html.slice(attrStart, index).toLowerCase();
    while (index < html.length && /\s/.test(html[index])) index += 1;
    let value = '';
    if (html[index] === '=') {
      index += 1;
      while (index < html.length && /\s/.test(html[index])) index += 1;
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        if (close === -1) return undefined;
        value = html.slice(index + 1, close);
        index = close + 1;
      } else {
        const valueStart = index;
        while (index < html.length && !/[\s>]/.test(html[index])) index += 1;
        value = html.slice(valueStart, index);
      }
    }
    if (attrName && !attributes.has(attrName)) attributes.set(attrName, value);
  }
  return undefined;
}

export function sanitizeHtml(input: string): string {
  const html = input.split('\u0000').join('');
  const output: string[] = [];
  const open: string[] = [];
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      output.push(sanitizeText(html.slice(index)));
      break;
    }
    if (lt > index) output.push(sanitizeText(html.slice(index, lt)));

    // Chú thích, CDATA, doctype, chỉ thị xử lý: bỏ hẳn.
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const close = html.indexOf('>', lt + 2);
      index = close === -1 ? html.length : close + 1;
      continue;
    }

    const tag = parseTag(html, lt);
    if (!tag) {
      // Không phải thẻ hợp lệ: coi `<` là chữ.
      output.push('&lt;');
      index = lt + 1;
      continue;
    }
    index = tag.end;

    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.closing) {
        const closer = new RegExp(`</${tag.name}\\s*>`, 'i');
        const found = closer.exec(html.slice(index));
        index = found ? index + found.index + found[0].length : html.length;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag.name)) continue;

    if (tag.closing) {
      const position = open.lastIndexOf(tag.name);
      if (position === -1) continue;
      while (open.length > position) output.push(`</${open.pop()}>`);
      continue;
    }

    if (VOID_TAGS.has(tag.name)) {
      output.push(`<${tag.name}>`);
      continue;
    }
    if (open.length >= MAX_OPEN_DEPTH) continue;

    if (tag.name === 'a') {
      const href = safeHref(tag.attributes.get('href') ?? '');
      if (!href) continue; // thẻ a không có địa chỉ an toàn: bỏ thẻ, giữ chữ
      open.push('a');
      output.push(`<a href="${escapeAttribute(href)}" rel="noopener noreferrer nofollow" target="_blank">`);
      continue;
    }
    open.push(tag.name);
    output.push(`<${tag.name}>`);
  }

  while (open.length) output.push(`</${open.pop()}>`);
  return output.join('');
}

/** Chữ thuần của HTML đã làm sạch, để kiểm rỗng. */
export function htmlToPlainText(html: string): string {
  return decodeEntities(html.replace(/<br>/g, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
