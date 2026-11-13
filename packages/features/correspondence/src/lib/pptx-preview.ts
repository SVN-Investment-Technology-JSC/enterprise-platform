/**
 * Đọc tệp trình chiếu (.pptx) ngay trong trình duyệt để xem trước: mỗi trang gồm khung chữ,
 * ảnh và bảng ở đúng vị trí (toạ độ EMU của tệp). Không dựng lại hiệu ứng, nền hay hình vẽ:
 * đủ để đọc nội dung mà không phải tải về mở bằng PowerPoint. Tệp không rời trình duyệt.
 */
import JSZip from 'jszip';

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
} as const;

const MAX_SLIDES = 200;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SlideRun {
  readonly text: string;
  readonly sizePt?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: string;
}

export interface SlideParagraph {
  readonly runs: readonly SlideRun[];
  readonly align?: 'left' | 'center' | 'right' | 'justify';
  readonly bullet: boolean;
}

export type SlideItem =
  | (Box & { readonly kind: 'text'; readonly paragraphs: readonly SlideParagraph[]; readonly title: boolean })
  | (Box & { readonly kind: 'image'; readonly url?: string })
  | (Box & { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] });

export interface Deck {
  /** Khổ trang (EMU). */
  readonly width: number;
  readonly height: number;
  readonly slides: readonly (readonly SlideItem[])[];
  /** Số trang trong tệp (có thể nhiều hơn số trang đã đọc). */
  readonly total: number;
  /** Giải phóng URL ảnh đã tạo. */
  readonly dispose: () => void;
}

type Transform = (box: Box) => Box;
const identity: Transform = (box) => box;

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function child(parent: Element | undefined, ns: string, name: string): Element | undefined {
  if (!parent) return undefined;
  for (const node of Array.from(parent.children)) {
    if (node.namespaceURI === ns && node.localName === name) return node;
  }
  return undefined;
}

function descendants(parent: Element | Document, ns: string, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(ns, name));
}

/** "ppt/slides/slide1.xml" + "../media/a.png" → "ppt/media/a.png". */
export function resolvePart(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

function relsPath(part: string): string {
  const parts = part.split('/');
  const file = parts.pop() ?? '';
  return [...parts, '_rels', `${file}.rels`].join('/');
}

async function readXml(zip: JSZip, path: string): Promise<Document | undefined> {
  const file = zip.file(path);
  return file ? parse(await file.async('string')) : undefined;
}

async function relationships(zip: JSZip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const doc = await readXml(zip, relsPath(part));
  const map = new Map<string, { target: string; type: string }>();
  for (const rel of doc ? descendants(doc, NS.rel, 'Relationship') : []) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target && rel.getAttribute('TargetMode') !== 'External') {
      map.set(id, { target: resolvePart(part, target), type: rel.getAttribute('Type') ?? '' });
    }
  }
  return map;
}

function boxOf(xfrm: Element | undefined): Box | undefined {
  const off = child(xfrm, NS.a, 'off');
  const ext = child(xfrm, NS.a, 'ext');
  if (!off || !ext) return undefined;
  return {
    x: Number(off.getAttribute('x') ?? 0),
    y: Number(off.getAttribute('y') ?? 0),
    w: Number(ext.getAttribute('cx') ?? 0),
    h: Number(ext.getAttribute('cy') ?? 0),
  };
}

/** Khoá chỗ dành sẵn (placeholder) của khung: theo `idx`, không có thì theo `type`. */
function placeholderOf(shape: Element): { idx?: string; type: string } | undefined {
  const nv = child(shape, NS.p, 'nvSpPr') ?? child(shape, NS.p, 'nvPicPr') ?? child(shape, NS.p, 'nvGraphicFramePr');
  const ph = child(child(nv, NS.p, 'nvPr'), NS.p, 'ph');
  if (!ph) return undefined;
  return { idx: ph.getAttribute('idx') ?? undefined, type: ph.getAttribute('type') ?? 'body' };
}

/** Vị trí các chỗ dành sẵn của bố cục hay trang cái, để khung không ghi vị trí lấy theo đó. */
function placeholderBoxes(doc: Document | undefined): { byIdx: Map<string, Box>; byType: Map<string, Box> } {
  const byIdx = new Map<string, Box>();
  const byType = new Map<string, Box>();
  for (const shape of doc ? descendants(doc, NS.p, 'sp') : []) {
    const ph = placeholderOf(shape);
    const box = boxOf(child(child(shape, NS.p, 'spPr'), NS.a, 'xfrm'));
    if (!ph || !box) continue;
    if (ph.idx && !byIdx.has(ph.idx)) byIdx.set(ph.idx, box);
    if (!byType.has(ph.type)) byType.set(ph.type, box);
  }
  return { byIdx, byType };
}

function paragraphs(body: Element | undefined): SlideParagraph[] {
  const result: SlideParagraph[] = [];
  for (const paragraph of body ? Array.from(body.children).filter((node) => node.localName === 'p') : []) {
    const pPr = child(paragraph, NS.a, 'pPr');
    const algn = pPr?.getAttribute('algn');
    const runs: SlideRun[] = [];
    for (const node of Array.from(paragraph.children)) {
      if (node.localName === 'br') {
        runs.push({ text: '\n' });
        continue;
      }
      if (node.localName !== 'r' && node.localName !== 'fld') continue;
      const text = child(node, NS.a, 't')?.textContent ?? '';
      const rPr = child(node, NS.a, 'rPr');
      const size = Number(rPr?.getAttribute('sz'));
      const color = child(child(rPr, NS.a, 'solidFill'), NS.a, 'srgbClr')?.getAttribute('val');
      runs.push({
        text,
        sizePt: Number.isFinite(size) && size > 0 ? size / 100 : undefined,
        bold: rPr?.getAttribute('b') === '1',
        italic: rPr?.getAttribute('i') === '1',
        color: color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : undefined,
      });
    }
    const bullet = Boolean(child(pPr, NS.a, 'buChar') ?? child(pPr, NS.a, 'buAutoNum'));
    result.push({
      runs,
      bullet,
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : algn === 'l' ? 'left' : undefined,
    });
  }
  return result;
}

interface SlideContext {
  readonly zip: JSZip;
  readonly rels: Map<string, { target: string; type: string }>;
  readonly layout: ReturnType<typeof placeholderBoxes>;
  readonly master: ReturnType<typeof placeholderBoxes>;
  readonly urls: string[];
}

async function imageUrl(context: SlideContext, embed: string | null): Promise<string | undefined> {
  const rel = embed ? context.rels.get(embed) : undefined;
  const extension = rel?.target.split('.').pop()?.toLowerCase() ?? '';
  const file = rel ? context.zip.file(rel.target) : null;
  if (!file || !IMAGE_TYPES[extension]) return undefined;
  const url = URL.createObjectURL(new Blob([await file.async('arraybuffer')], { type: IMAGE_TYPES[extension] }));
  context.urls.push(url);
  return url;
}

async function readTree(context: SlideContext, tree: Element, transform: Transform, items: SlideItem[]): Promise<void> {
  for (const node of Array.from(tree.children)) {
    if (node.namespaceURI !== NS.p) continue;
    if (node.localName === 'sp') {
      const ph = placeholderOf(node);
      const own = boxOf(child(child(node, NS.p, 'spPr'), NS.a, 'xfrm'));
      const inherited = ph
        ? ((ph.idx ? (context.layout.byIdx.get(ph.idx) ?? context.master.byIdx.get(ph.idx)) : undefined) ??
          context.layout.byType.get(ph.type) ??
          context.master.byType.get(ph.type))
        : undefined;
      const box = own ?? inherited;
      const text = paragraphs(child(node, NS.p, 'txBody'));
      if (!box || !text.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))) continue;
      items.push({ kind: 'text', ...transform(box), paragraphs: text, title: ph?.type === 'title' || ph?.type === 'ctrTitle' });
    } else if (node.localName === 'pic') {
      const box = boxOf(child(child(node, NS.p, 'spPr'), NS.a, 'xfrm'));
      const blip = child(child(node, NS.p, 'blipFill'), NS.a, 'blip');
      if (box) items.push({ kind: 'image', ...transform(box), url: await imageUrl(context, blip?.getAttributeNS(NS.r, 'embed') ?? null) });
    } else if (node.localName === 'graphicFrame') {
      const box = boxOf(child(node, NS.p, 'xfrm'));
      const table = descendants(node, NS.a, 'tbl')[0];
      if (!box || !table) continue;
      const rows = descendants(table, NS.a, 'tr').map((row) =>
        descendants(row, NS.a, 'tc').map((cell) => descendants(cell, NS.a, 't').map((t) => t.textContent ?? '').join(' ')),
      );
      items.push({ kind: 'table', ...transform(box), rows });
    } else if (node.localName === 'grpSp') {
      // Nhóm hình: toạ độ con nằm trong hệ toạ độ riêng của nhóm (chOff, chExt).
      const xfrm = child(child(node, NS.p, 'grpSpPr'), NS.a, 'xfrm');
      const outer = boxOf(xfrm);
      const chOff = child(xfrm, NS.a, 'chOff');
      const chExt = child(xfrm, NS.a, 'chExt');
      let inner = transform;
      if (outer && chOff && chExt) {
        const cx = Number(chOff.getAttribute('x') ?? 0);
        const cy = Number(chOff.getAttribute('y') ?? 0);
        const sx = outer.w / (Number(chExt.getAttribute('cx')) || outer.w || 1);
        const sy = outer.h / (Number(chExt.getAttribute('cy')) || outer.h || 1);
        inner = (box) => transform({ x: outer.x + (box.x - cx) * sx, y: outer.y + (box.y - cy) * sy, w: box.w * sx, h: box.h * sy });
      }
      await readTree(context, node, inner, items);
    }
  }
}

export async function readDeck(data: ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(data);
  const presentation = await readXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new Error('Tệp không phải bản trình chiếu PowerPoint (.pptx).');
  const size = descendants(presentation, NS.p, 'sldSz')[0];
  const width = Number(size?.getAttribute('cx')) || 12192000;
  const height = Number(size?.getAttribute('cy')) || 6858000;
  const presentationRels = await relationships(zip, 'ppt/presentation.xml');
  const slideParts = descendants(presentation, NS.p, 'sldId')
    .map((node) => presentationRels.get(node.getAttributeNS(NS.r, 'id') ?? '')?.target)
    .filter((part): part is string => Boolean(part));
  const urls: string[] = [];
  const slides: SlideItem[][] = [];
  for (const part of slideParts.slice(0, MAX_SLIDES)) {
    const doc = await readXml(zip, part);
    const tree = doc ? descendants(doc, NS.p, 'spTree')[0] : undefined;
    const rels = await relationships(zip, part);
    const layoutPart = [...rels.values()].find((rel) => rel.type.endsWith('/slideLayout'))?.target;
    const layoutDoc = layoutPart ? await readXml(zip, layoutPart) : undefined;
    const masterPart = layoutPart
      ? [...(await relationships(zip, layoutPart)).values()].find((rel) => rel.type.endsWith('/slideMaster'))?.target
      : undefined;
    const masterDoc = masterPart ? await readXml(zip, masterPart) : undefined;
    const items: SlideItem[] = [];
    if (tree) {
      await readTree(
        { zip, rels, layout: placeholderBoxes(layoutDoc), master: placeholderBoxes(masterDoc), urls },
        tree,
        identity,
        items,
      );
    }
    slides.push(items);
  }
  return {
    width,
    height,
    slides,
    total: slideParts.length,
    dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}
