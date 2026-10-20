export interface SvgImportResult {
  /** Dữ liệu path gộp từ mọi hình nét trong SVG. */
  path: string;
  elementCount: number;
  warnings: string[];
}

const SHAPE_SELECTOR = 'path,circle,ellipse,rect,line,polyline,polygon';
const UNSUPPORTED_SELECTOR = 'text,image,use,foreignObject';
const NUMBER_PATTERN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;

/**
 * Nhận biết nội dung dán vào là mã SVG (nguyên thẻ `<svg>` hay chỉ vài phần tử) thay vì chuỗi `d`.
 */
export function looksLikeSvgMarkup(text: string): boolean {
  return /^\s*<(?:\?xml|!--|svg|g|path|circle|ellipse|rect|line|polyline|polygon)\b/i.test(text);
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function numbersIn(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? []).map(Number).filter(Number.isFinite);
}

function attr(element: Element, name: string, fallback = 0): number {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Lệnh `m` đầu tiên của một phần tử là toạ độ tuyệt đối, nhưng khi nối nhiều phần tử vào một path thì nó
 * thành tương đối so với điểm cuối của nét trước. Đổi sang `M` để các nét không bị dịch chỗ.
 */
function anchorPath(d: string): string {
  const tokens = d.trim().match(/[a-zA-Z][^a-zA-Z]*/g);
  if (!tokens || tokens[0][0] !== 'm') return d.trim();
  const nums = numbersIn(tokens[0].slice(1));
  if (nums.length < 2) return d.trim();
  const head = `M ${round(nums[0])} ${round(nums[1])}`;
  const implicitLines = nums.length > 2 ? ` l ${nums.slice(2).map(round).join(' ')}` : '';
  const rest = tokens.slice(1).map((token) => token.trim()).join(' ');
  return `${head}${implicitLines}${rest ? ` ${rest}` : ''}`;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return '';
  return `M ${round(cx - rx)} ${round(cy)} a ${round(rx)} ${round(ry)} 0 1 0 ${round(rx * 2)} 0 a ${round(rx)} ${round(ry)} 0 1 0 ${round(-rx * 2)} 0 z`;
}

function rectPath(element: Element): string {
  const x = attr(element, 'x');
  const y = attr(element, 'y');
  const w = attr(element, 'width');
  const h = attr(element, 'height');
  if (w <= 0 || h <= 0) return '';
  const hasRx = element.hasAttribute('rx');
  const hasRy = element.hasAttribute('ry');
  let rx = hasRx ? attr(element, 'rx') : hasRy ? attr(element, 'ry') : 0;
  let ry = hasRy ? attr(element, 'ry') : rx;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) return `M ${round(x)} ${round(y)} h ${round(w)} v ${round(h)} h ${round(-w)} z`;
  return [
    `M ${round(x + rx)} ${round(y)}`,
    `h ${round(w - 2 * rx)}`,
    `a ${round(rx)} ${round(ry)} 0 0 1 ${round(rx)} ${round(ry)}`,
    `v ${round(h - 2 * ry)}`,
    `a ${round(rx)} ${round(ry)} 0 0 1 ${round(-rx)} ${round(ry)}`,
    `h ${round(-(w - 2 * rx))}`,
    `a ${round(rx)} ${round(ry)} 0 0 1 ${round(-rx)} ${round(-ry)}`,
    `v ${round(-(h - 2 * ry))}`,
    `a ${round(rx)} ${round(ry)} 0 0 1 ${round(rx)} ${round(-ry)}`,
    'z',
  ].join(' ');
}

function pointsPath(element: Element, close: boolean): string {
  const nums = numbersIn(element.getAttribute('points') ?? '');
  if (nums.length < 4) return '';
  const pairs: string[] = [];
  for (let index = 0; index + 1 < nums.length; index += 2) pairs.push(`${round(nums[index])} ${round(nums[index + 1])}`);
  return `M ${pairs[0]} ${pairs.slice(1).map((pair) => `L ${pair}`).join(' ')}${close ? ' z' : ''}`;
}

function shapeToPath(element: Element): string {
  switch (element.localName) {
    case 'path':
      return anchorPath(element.getAttribute('d') ?? '');
    case 'circle': {
      const r = attr(element, 'r');
      return ellipsePath(attr(element, 'cx'), attr(element, 'cy'), r, r);
    }
    case 'ellipse':
      return ellipsePath(attr(element, 'cx'), attr(element, 'cy'), attr(element, 'rx'), attr(element, 'ry'));
    case 'rect':
      return rectPath(element);
    case 'line':
      return `M ${round(attr(element, 'x1'))} ${round(attr(element, 'y1'))} L ${round(attr(element, 'x2'))} ${round(attr(element, 'y2'))}`;
    case 'polyline':
      return pointsPath(element, false);
    case 'polygon':
      return pointsPath(element, true);
    default:
      return '';
  }
}

function inherited(element: Element, name: string): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = node.getAttribute(name);
    if (value !== null) return value.trim().toLowerCase();
  }
  return null;
}

/**
 * Chuyển mã SVG (vd. bấm "Copy SVG" trên Lucide) thành một chuỗi path để dán vào Studio.
 * Chỉ đọc cấu trúc, không chèn SVG vào trang nên không thực thi gì từ nội dung dán vào.
 */
export function svgMarkupToPathData(markup: string): SvgImportResult {
  if (typeof DOMParser === 'undefined') throw new Error('Trình duyệt không hỗ trợ đọc SVG.');

  const source = /<svg[\s>]/i.test(markup)
    ? markup
    : `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Mã SVG không hợp lệ. Hãy dán nguyên đoạn từ <svg> đến </svg>.');
  }

  const root = doc.documentElement;
  const warnings: string[] = [];
  const parts: string[] = [];
  let transformed = false;
  let filled = false;

  for (const element of Array.from(root.querySelectorAll(SHAPE_SELECTOR))) {
    if (element.closest('defs,clipPath,mask,symbol,pattern')) continue;
    const d = shapeToPath(element);
    if (!d) continue;
    parts.push(d);

    for (let node: Element | null = element; node && node !== root.parentElement; node = node.parentElement) {
      if (node.hasAttribute('transform')) transformed = true;
    }
    const fill = inherited(element, 'fill');
    const stroke = inherited(element, 'stroke');
    if (fill !== 'none' && (stroke === null || stroke === 'none')) filled = true;
  }

  if (parts.length === 0) throw new Error('Không tìm thấy hình nét (path, circle, rect, line...) trong SVG.');

  const viewBox = root.getAttribute('viewBox')?.trim().replace(/[\s,]+/g, ' ');
  if (viewBox && viewBox !== '0 0 24 24') {
    warnings.push(`viewBox là "${viewBox}", khác lưới 24x24 của Studio nên hình có thể lệch tỷ lệ hoặc vị trí.`);
  }
  if (transformed) warnings.push('SVG có thuộc tính transform, Studio bỏ qua nên vị trí hoặc kích thước có thể sai.');
  if (filled) warnings.push('Icon này dùng nét tô đặc (fill) thay vì nét viền; Studio hiện chỉ vẽ nét viền.');
  if (root.querySelector(UNSUPPORTED_SELECTOR)) warnings.push('SVG có chữ, ảnh hoặc phần tử <use>, các phần này không được chuyển.');

  return { path: parts.join(' '), elementCount: parts.length, warnings };
}
