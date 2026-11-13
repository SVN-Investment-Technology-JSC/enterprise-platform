/**
 * Quy tắc CSS trong `<style>` của SVG và việc gộp chúng với thuộc tính trình bày (`fill="..."`) và `style="..."` theo đúng thứ
 * tự ưu tiên của CSS. Việc khớp bộ chọn giao cho `Element.matches` của trình duyệt nên mọi bộ chọn hợp lệ (lớp, id, thuộc
 * tính, con cháu, anh em, `:not`, `:nth-child`...) đều dùng được; ở đây chỉ tính độ đặc hiệu và thứ tự.
 */

/** Thuộc tính trình bày của SVG được coi như khai báo CSS có độ ưu tiên thấp nhất. */
const PRESENTATION = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'opacity',
  'color',
  'display',
  'visibility',
  'paint-order',
  'mask',
  'clip-path',
  'filter',
  'stop-color',
  'stop-opacity',
  'vector-effect',
  'mix-blend-mode',
  'font-size',
  'transform',
  'transform-origin',
  'transform-box',
  'mask-type',
  'overflow',
  'isolation',
  'marker-start',
  'marker-mid',
  'marker-end',
];

interface Declaration {
  readonly name: string;
  readonly value: string;
  readonly important: boolean;
}

interface Rule {
  readonly selector: string;
  readonly specificity: number;
  readonly order: number;
  readonly declarations: readonly Declaration[];
}

/** Cắt chuỗi theo `separator` ở mức ngoài cùng (bỏ qua dấu nằm trong ngoặc hoặc dấu nháy). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Danh sách khai báo `a: b; c: d !important`. */
export function parseDeclarations(text: string): Declaration[] {
  const result: Declaration[] = [];
  for (const piece of splitTopLevel(text.replace(/\/\*[\s\S]*?\*\//g, ''), ';')) {
    const colon = piece.indexOf(':');
    if (colon <= 0) continue;
    const name = piece.slice(0, colon).trim().toLowerCase();
    let value = piece.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    if (name && value) result.push({ name, value, important });
  }
  return result;
}

/** Độ đặc hiệu của một bộ chọn đơn, gộp thành một số để so sánh: id, lớp/thuộc tính/giả lớp, kiểu. */
export function specificityOf(selector: string): number {
  let rest = selector.replace(/\\./g, 'x');
  rest = rest.replace(/"[^"]*"|'[^']*'/g, '');
  rest = rest.replace(/:where\([^)]*\)/g, '');
  let ids = 0;
  let classes = 0;
  let types = 0;
  rest = rest.replace(/\[[^\]]*\]/g, () => {
    classes += 1;
    return ' ';
  });
  rest = rest.replace(/::?(?:not|is|has)\(/g, ' ');
  rest = rest.replace(/::[a-zA-Z-]+(?:\([^)]*\))?/g, () => {
    types += 1;
    return ' ';
  });
  rest = rest.replace(/:[a-zA-Z-]+(?:\([^)]*\))?/g, () => {
    classes += 1;
    return ' ';
  });
  rest = rest.replace(/#[\w-]+/g, () => {
    ids += 1;
    return ' ';
  });
  rest = rest.replace(/\.[\w-]+/g, () => {
    classes += 1;
    return ' ';
  });
  for (const token of rest.split(/[\s>+~,()]+/)) {
    if (token && token !== '*') types += 1;
  }
  return ids * 1_000_000 + classes * 1_000 + types;
}

interface ParsedSheet {
  readonly rules: Rule[];
  /** Tên các luật `@` (`media`, `keyframes`...) đã bỏ qua vì không áp dụng được. */
  readonly skipped: Set<string>;
}

/** Bỏ qua khối `{ ... }` bắt đầu tại `open` (có lồng nhau), trả về vị trí ngay sau dấu đóng. */
function skipBlock(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function parseSheet(css: string, startOrder: number): ParsedSheet {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
  const rules: Rule[] = [];
  const skipped = new Set<string>();
  let order = startOrder;
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    if (text[index] === '@') {
      const name = /^@([\w-]+)/.exec(text.slice(index))?.[1]?.toLowerCase() ?? '';
      const semicolon = text.indexOf(';', index);
      const brace = text.indexOf('{', index);
      if (brace < 0 || (semicolon >= 0 && semicolon < brace)) {
        index = semicolon < 0 ? text.length : semicolon + 1;
      } else {
        if (name !== 'font-face' && name !== 'page' && name !== 'namespace') skipped.add(name);
        index = skipBlock(text, brace);
      }
      continue;
    }
    const brace = text.indexOf('{', index);
    if (brace < 0) break;
    const end = skipBlock(text, brace);
    const prelude = text.slice(index, brace).trim();
    const declarations = parseDeclarations(text.slice(brace + 1, end - 1));
    for (const selector of splitTopLevel(prelude, ',')) {
      const trimmed = selector.trim();
      if (trimmed && declarations.length > 0) {
        order += 1;
        rules.push({ selector: trimmed, specificity: specificityOf(trimmed), order, declarations });
      }
    }
    index = end;
  }
  return { rules, skipped };
}

interface Candidate {
  readonly value: string;
  /** Cấp ưu tiên: 0 thuộc tính, 1 CSS thường, 2 style nội tuyến, 3 CSS !important, 4 nội tuyến !important. */
  readonly level: number;
  readonly specificity: number;
  readonly order: number;
}

const beats = (next: Candidate, current: Candidate | undefined): boolean => {
  if (!current) return true;
  if (next.level !== current.level) return next.level > current.level;
  if (next.specificity !== current.specificity) return next.specificity > current.specificity;
  return next.order >= current.order;
};

/** Bảng kiểu của một tài liệu SVG: hỏi giá trị đã khai báo (sau khi gộp mọi nguồn) của từng phần tử. */
export class Stylesheet {
  private readonly rules: Rule[] = [];
  private readonly cache = new Map<Element, Map<string, string>>();
  /** Luật `@` không áp dụng được (ví dụ `media`, `keyframes`), để báo người dùng. */
  readonly skipped = new Set<string>();

  constructor(root: Element) {
    let order = 0;
    for (const style of Array.from(root.querySelectorAll('style'))) {
      const type = (style.getAttribute('type') ?? 'text/css').trim().toLowerCase();
      if (type !== '' && type !== 'text/css') continue;
      const sheet = parseSheet(style.textContent ?? '', order);
      order += sheet.rules.length + 1;
      this.rules.push(...sheet.rules);
      for (const name of sheet.skipped) this.skipped.add(name);
    }
  }

  /** Giá trị đã khai báo cho phần tử (chưa thừa kế): tên thuộc tính → giá trị; gồm cả biến `--tên`. */
  declared(element: Element): Map<string, string> {
    const cached = this.cache.get(element);
    if (cached) return cached;
    const best = new Map<string, Candidate>();
    const offer = (name: string, candidate: Candidate) => {
      if (beats(candidate, best.get(name))) best.set(name, candidate);
    };

    for (const name of PRESENTATION) {
      const attribute = element.getAttribute(name);
      if (attribute !== null && attribute.trim() !== '') offer(name, { value: attribute.trim(), level: 0, specificity: 0, order: 0 });
    }
    for (const rule of this.rules) {
      let matched = false;
      try {
        matched = element.matches(rule.selector);
      } catch {
        matched = false;
      }
      if (!matched) continue;
      for (const declaration of rule.declarations) {
        offer(declaration.name, {
          value: declaration.value,
          level: declaration.important ? 3 : 1,
          specificity: rule.specificity,
          order: rule.order,
        });
      }
    }
    const inline = element.getAttribute('style');
    if (inline) {
      for (const declaration of parseDeclarations(inline)) {
        offer(declaration.name, { value: declaration.value, level: declaration.important ? 4 : 2, specificity: 0, order: 0 });
      }
    }

    const result = new Map<string, string>();
    for (const [name, candidate] of best) result.set(name, candidate.value);
    this.cache.set(element, result);
    return result;
  }
}
