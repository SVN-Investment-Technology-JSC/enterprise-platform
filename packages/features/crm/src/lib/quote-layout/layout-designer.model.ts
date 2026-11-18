/**
 * Thao tác khối và lịch sử hoàn tác của trình thiết kế bố cục (phase 3, plan mục 9.3). Mọi hàm ở đây thuần: nhận bố cục cũ,
 * trả bố cục mới, không sửa đối tượng truyền vào. Bố cục không đổi thì trả đúng đối tượng cũ để so sánh bằng tham chiếu.
 */
import {
  QUOTE_LAYOUT_LIMITS,
  defaultQuoteLayout,
  validateQuoteLayout,
  type QuoteLayout,
  type QuoteLayoutBlock,
  type QuoteLayoutBlockType,
  type QuoteLayoutError,
  type QuoteLayoutLineColumn,
} from '@enterprise-platform/contracts-crm';

// ---------------------------------------------------------------------------
// Lịch sử hoàn tác
// ---------------------------------------------------------------------------

/** Số bước hoàn tác tối đa. */
export const LAYOUT_HISTORY_LIMIT = 100;

export interface LayoutHistory {
  readonly past: readonly QuoteLayout[];
  readonly present: QuoteLayout;
  readonly future: readonly QuoteLayout[];
  /** Khoá ô đang gõ (ví dụ `company.name`); lần sửa kế tiếp cùng khoá gộp vào bước hiện tại. */
  readonly typingKey: string | null;
}

export function createLayoutHistory(layout: QuoteLayout): LayoutHistory {
  return { past: [], present: layout, future: [], typingKey: null };
}

/**
 * Ghi một bước. `typingKey` có giá trị và trùng bước trước (gõ liên tiếp trong cùng một ô) thì thay bố cục hiện tại, không
 * thêm bước. Bước mới xoá nhánh làm lại. Giữ tối đa `LAYOUT_HISTORY_LIMIT` bước cũ.
 */
export function commitLayout(history: LayoutHistory, next: QuoteLayout, typingKey: string | null = null): LayoutHistory {
  if (next === history.present) return typingKey === history.typingKey ? history : { ...history, typingKey };
  if (typingKey !== null && typingKey === history.typingKey) return { ...history, present: next, future: [] };
  const past = [...history.past, history.present];
  if (past.length > LAYOUT_HISTORY_LIMIT) past.splice(0, past.length - LAYOUT_HISTORY_LIMIT);
  return { past, present: next, future: [], typingKey };
}

/** Kết thúc lượt gõ (rời ô): lần gõ sau trong cùng ô là bước mới. */
export function endTyping(history: LayoutHistory): LayoutHistory {
  return history.typingKey === null ? history : { ...history, typingKey: null };
}

export const canUndo = (history: LayoutHistory) => history.past.length > 0;
export const canRedo = (history: LayoutHistory) => history.future.length > 0;

export function undoLayout(history: LayoutHistory): LayoutHistory {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], typingKey: null };
}

export function redoLayout(history: LayoutHistory): LayoutHistory {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next, future, typingKey: null };
}

// ---------------------------------------------------------------------------
// Id khối
// ---------------------------------------------------------------------------

const ID_CHARS = /[^a-z0-9-]+/g;

/** Id khối hợp lệ (`[a-z0-9-]`, tối đa 40 ký tự), không trùng id đã có. */
export function uniqueBlockId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const max = QUOTE_LAYOUT_LIMITS.maxIdLength;
  const clean =
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(ID_CHARS, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'khoi';
  const head = clean.slice(0, max);
  if (!taken.has(head)) return head;
  for (let count = 2; ; count += 1) {
    const suffix = `-${count}`;
    const candidate = `${clean.slice(0, max - suffix.length).replace(/-$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const BLOCK_ID_BASE: Readonly<Record<QuoteLayoutBlockType, string>> = {
  image: 'image',
  companyHeader: 'company',
  title: 'title',
  text: 'text',
  fieldGrid: 'fields',
  lineTable: 'lines',
  totals: 'totals',
  terms: 'terms',
  signature: 'signature',
  spacer: 'spacer',
  divider: 'divider',
};

// ---------------------------------------------------------------------------
// Khối mới
// ---------------------------------------------------------------------------

function templateBlock<T extends QuoteLayoutBlockType>(type: T): Extract<QuoteLayoutBlock, { type: T }> | undefined {
  return defaultQuoteLayout().blocks.find((block): block is Extract<QuoteLayoutBlock, { type: T }> => block.type === type);
}

/** Khối mới với thuộc tính mặc định hợp lệ (riêng `image` cần tải ảnh mới lưu được). */
export function createBlock(type: QuoteLayoutBlockType, existingIds: Iterable<string>): QuoteLayoutBlock {
  const id = uniqueBlockId(BLOCK_ID_BASE[type], existingIds);
  switch (type) {
    case 'image':
      return { id, type, src: '', heightMm: 20, align: 'left' };
    case 'companyHeader':
      return { id, type, name: 'TÊN CÔNG TY', lines: ['Địa chỉ: ', 'Điện thoại: '], logoPosition: 'left', align: 'left' };
    case 'title':
      return { id, type, text: 'BÁO GIÁ', fontSizePt: 18, align: 'center', uppercase: true };
    case 'text':
      return { id, type, align: 'left', runs: [{ text: 'Nội dung đoạn văn' }] };
    case 'fieldGrid':
      return { id, type, columns: 2, labelWidthPct: 35, items: [{ label: 'Báo giá đến', value: '{{customer.name}}' }] };
    case 'lineTable': {
      const base = templateBlock('lineTable');
      return { id, type, zebra: false, showGroupByCategory: false, columns: base ? base.columns.map((column) => ({ ...column })) : [] };
    }
    case 'totals': {
      const base = templateBlock('totals');
      return { id, type, align: 'right', showAmountInWords: true, rows: base ? base.rows.map((row) => ({ ...row })) : [] };
    }
    case 'terms':
      return { id, type, numbered: true, items: [{ label: 'Điều khoản thanh toán', value: '' }] };
    case 'signature':
      return {
        id,
        type,
        heightMm: 30,
        left: { title: 'ĐẠI DIỆN BÊN MUA', subtitle: '(Ký, ghi rõ họ tên)' },
        right: { title: 'ĐẠI DIỆN BÊN BÁN', subtitle: '(Ký, đóng dấu)' },
      };
    case 'spacer':
      return { id, type, heightMm: 10 };
    case 'divider':
      return { id, type, thicknessPt: 1, style: 'solid' };
  }
}

// ---------------------------------------------------------------------------
// Thao tác khối
// ---------------------------------------------------------------------------

const withBlocks = (layout: QuoteLayout, blocks: readonly QuoteLayoutBlock[]): QuoteLayout => ({ ...layout, blocks });

export const blockIndex = (layout: QuoteLayout, id: string | null | undefined) => (id ? layout.blocks.findIndex((block) => block.id === id) : -1);

/** Chèn khối vào vị trí `index` (0..số khối); ngoài khoảng thì chèn cuối. */
export function insertBlockAt(layout: QuoteLayout, block: QuoteLayoutBlock, index: number): QuoteLayout {
  const blocks = [...layout.blocks];
  const at = index >= 0 && index <= blocks.length ? index : blocks.length;
  blocks.splice(at, 0, block);
  return withBlocks(layout, blocks);
}

/** Thêm khối ngay sau khối `afterId`; không có khối đó (chưa chọn) thì thêm cuối. */
export function addBlock(layout: QuoteLayout, block: QuoteLayoutBlock, afterId?: string | null): QuoteLayout {
  const index = blockIndex(layout, afterId);
  return insertBlockAt(layout, block, index < 0 ? layout.blocks.length : index + 1);
}

export function removeBlock(layout: QuoteLayout, id: string): QuoteLayout {
  const index = blockIndex(layout, id);
  if (index < 0) return layout;
  return withBlocks(layout, layout.blocks.filter((_, position) => position !== index));
}

/** Chuyển phần tử từ `from` sang `to` (vị trí cuối cùng). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from < 0 || from >= copy.length) return copy;
  const target = Math.max(0, Math.min(copy.length - 1, to));
  const [item] = copy.splice(from, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** Đưa khối tới vị trí `to` (vị trí cuối cùng sau khi chuyển). */
export function moveBlock(layout: QuoteLayout, id: string, to: number): QuoteLayout {
  const from = blockIndex(layout, id);
  if (from < 0) return layout;
  const target = Math.max(0, Math.min(layout.blocks.length - 1, to));
  if (target === from) return layout;
  return withBlocks(layout, moveItem(layout.blocks, from, target));
}

/** Lên (`-1`) hoặc xuống (`+1`) một bậc. */
export const moveBlockBy = (layout: QuoteLayout, id: string, delta: number) => moveBlock(layout, id, blockIndex(layout, id) + delta);

/**
 * Thả khối vào khe `gap` (0 là trước khối đầu, số khối là sau khối cuối), như vạch chỉ chỗ thả. Thả vào khe ngay trước
 * hoặc ngay sau chính nó thì không đổi.
 */
export function moveBlockToGap(layout: QuoteLayout, id: string, gap: number): QuoteLayout {
  const from = blockIndex(layout, id);
  if (from < 0) return layout;
  return moveBlock(layout, id, gap > from ? gap - 1 : gap);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Nhân đôi khối: bản sao nằm ngay sau, id mới, nội dung tách rời bản gốc. */
export function duplicateBlock(layout: QuoteLayout, id: string): { layout: QuoteLayout; id: string | null } {
  const index = blockIndex(layout, id);
  if (index < 0) return { layout, id: null };
  const source = layout.blocks[index];
  const copyId = uniqueBlockId(source.id, layout.blocks.map((block) => block.id));
  const copy = { ...clone(source), id: copyId } as QuoteLayoutBlock;
  return { layout: insertBlockAt(layout, copy, index + 1), id: copyId };
}

/** Thuộc tính sửa được của một loại khối (không gồm `id`, `type`). */
export type BlockPatch<B extends QuoteLayoutBlock = QuoteLayoutBlock> = Partial<Omit<B, 'id' | 'type'>>;

/** Bỏ khoá có giá trị `undefined` (trường tuỳ chọn bị xoá), để JSON không mang khoá rỗng. */
function dropUndefined<T extends object>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) output[key] = item;
  return output as T;
}

/** Sửa thuộc tính khối; truyền `undefined` để bỏ trường tuỳ chọn. Không đổi `id`, `type`. */
export function updateBlock<B extends QuoteLayoutBlock>(layout: QuoteLayout, id: string, patch: BlockPatch<B>): QuoteLayout {
  const index = blockIndex(layout, id);
  if (index < 0) return layout;
  const current = layout.blocks[index];
  const next = dropUndefined({ ...current, ...patch, id: current.id, type: current.type }) as QuoteLayoutBlock;
  const blocks = [...layout.blocks];
  blocks[index] = next;
  return withBlocks(layout, blocks);
}

export type PagePatch = Partial<Omit<QuoteLayout, 'version' | 'blocks'>>;

/** Sửa thiết lập trang (khổ, hướng, lề, font, cỡ chữ). */
export function updatePage(layout: QuoteLayout, patch: PagePatch): QuoteLayout {
  return { ...layout, ...patch, version: layout.version, blocks: layout.blocks };
}

// ---------------------------------------------------------------------------
// Bảng dòng hàng
// ---------------------------------------------------------------------------

/** Tổng độ rộng các cột đang hiện (cột ẩn không tính). */
export function visibleWidthTotal(columns: readonly QuoteLayoutLineColumn[]): number {
  return Math.round(columns.reduce((sum, column) => sum + (column.visible ? column.widthPct : 0), 0) * 100) / 100;
}

/** Lỗi bảng dòng hàng để báo ngay tại ô (trùng điều kiện của `validateQuoteLayout`); hợp lệ thì `null`. */
export function lineTableError(columns: readonly QuoteLayoutLineColumn[]): string | null {
  if (!columns.some((column) => column.visible)) return 'Bảng phải có ít nhất một cột hiện.';
  const total = visibleWidthTotal(columns);
  const { min, max } = QUOTE_LAYOUT_LIMITS.tableWidthTotalPct;
  if (total < min || total > max) return `Tổng độ rộng các cột đang hiện phải là 100% (đang là ${String(total).replace('.', ',')}%).`;
  return null;
}

/** Chia đều 100% cho các cột đang hiện (số nguyên, phần dư dồn cho các cột đầu); cột ẩn giữ nguyên. */
export function equalizeColumnWidths(columns: readonly QuoteLayoutLineColumn[]): QuoteLayoutLineColumn[] {
  const count = columns.filter((column) => column.visible).length;
  if (!count) return [...columns];
  const base = Math.floor(100 / count);
  let remainder = 100 - base * count;
  return columns.map((column) => {
    if (!column.visible) return column;
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...column, widthPct: base + extra };
  });
}

// ---------------------------------------------------------------------------
// Lỗi kiểm hợp lệ
// ---------------------------------------------------------------------------

/** Vị trí khối trong đường dẫn lỗi (`blocks[3].heightMm` là 3); lỗi của cả trang thì `null`. */
export function blockIndexFromPath(path: string): number | null {
  const match = /^blocks\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : null;
}

/** Gom lỗi theo id khối của bố cục đã kiểm. */
export function errorsByBlock(layout: QuoteLayout, errors: readonly QuoteLayoutError[]): Map<string, QuoteLayoutError[]> {
  const output = new Map<string, QuoteLayoutError[]>();
  for (const error of errors) {
    const index = blockIndexFromPath(error.path);
    const block = index === null ? undefined : layout.blocks[index];
    if (!block) continue;
    const list = output.get(block.id) ?? [];
    list.push(error);
    output.set(block.id, list);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Nhập, xuất file `.json`
// ---------------------------------------------------------------------------

/** Kích thước file `.json` tối đa khi nhập. */
export const LAYOUT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const LAYOUT_IMPORT_TOO_LARGE_MESSAGE = 'File vượt 2 MB.';
export const LAYOUT_IMPORT_NOT_JSON_MESSAGE = 'File không phải bố cục mẫu hợp lệ.';

const INVALID_FILE_CHARS = /[\\/:*?"<>|]+/g;

/** Tên file an toàn: thay ký tự không hợp lệ trong tên file bằng `_`, giữ chữ có dấu và khoảng trắng. */
export function safeFileName(name: string, fallback = 'Mau'): string {
  const printable = Array.from(name.normalize('NFC'), (char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  const safe = printable.replace(INVALID_FILE_CHARS, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return safe || fallback;
}

/** Tên file xuất bố cục: `Mau_<tên mẫu>.layout.json`. */
export function layoutJsonFileName(templateName: string): string {
  return `Mau_${safeFileName(templateName, 'bo-cuc')}.layout.json`;
}

/** Tên file (không đuôi) khi xuất PDF, Word thử ở trình thiết kế. */
export function layoutExportFileName(templateName: string): string {
  return `Mau_${safeFileName(templateName, 'bo-cuc')}`;
}

export type LayoutImportResult =
  | { readonly ok: true; readonly layout: QuoteLayout }
  | { readonly ok: false; readonly message: string; readonly errors: readonly QuoteLayoutError[] };

/** Đọc nội dung file `.json` đã nhập: không phải JSON thì báo lỗi chung; sai cấu trúc thì trả danh sách lỗi. */
export function parseLayoutJson(text: string): LayoutImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: LAYOUT_IMPORT_NOT_JSON_MESSAGE, errors: [] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: LAYOUT_IMPORT_NOT_JSON_MESSAGE, errors: [] };
  }
  const result = validateQuoteLayout(parsed);
  if (result.ok) return { ok: true, layout: result.layout };
  return { ok: false, message: 'Bố cục trong file có lỗi, chưa nhập:', errors: result.errors };
}
