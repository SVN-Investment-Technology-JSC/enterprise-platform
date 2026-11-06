/**
 * Bố cục in của mẫu báo giá (phase 3, plan mục 5): JSON có kiểu, không lưu HTML.
 *
 * Dùng chung cho web (dựng trang, nhập file `.json`) và server (kiểm khi lưu, đọc bản chụp khi gửi). Mọi hàm ở đây
 * thuần, không phụ thuộc trình duyệt hay Node: thay biến luôn trả chữ thuần, không có đường nào nhận HTML.
 */

export const QUOTE_LAYOUT_VERSION = 1;
export const QUOTE_LAYOUT_PAPERS = ['A4', 'A3'] as const;
export const QUOTE_LAYOUT_ORIENTATIONS = ['portrait', 'landscape'] as const;
/** Font có cả trên Word và trình duyệt. */
export const QUOTE_LAYOUT_FONTS = ['Times New Roman', 'Arial', 'Roboto'] as const;
export const QUOTE_LAYOUT_ALIGNS = ['left', 'center', 'right'] as const;
export const QUOTE_LAYOUT_LOGO_POSITIONS = ['left', 'right'] as const;
export const QUOTE_LAYOUT_DIVIDER_STYLES = ['solid', 'dashed'] as const;
export const QUOTE_LAYOUT_BLOCK_TYPES = [
  'image',
  'companyHeader',
  'title',
  'text',
  'fieldGrid',
  'lineTable',
  'totals',
  'terms',
  'signature',
  'spacer',
  'divider',
] as const;
/** Cột cố định của bảng dòng hàng. Không có cột giá vốn, lợi nhuận: mẫu không lộ được các số này. */
export const QUOTE_LAYOUT_LINE_COLUMN_KEYS = [
  'index',
  'materialCode',
  'materialName',
  'unit',
  'quantity',
  'listPrice',
  'discountPercent',
  'unitPrice',
  'lineAmount',
  'vatRate',
  'vatAmount',
  'lineTotal',
  'category',
] as const;
export const QUOTE_LAYOUT_TOTAL_ROW_KEYS = [
  'subtotal',
  'lineDiscount',
  'orderDiscount',
  'fees',
  'shipping',
  'vat',
  'orderTax',
  'grandTotal',
] as const;

export type QuoteLayoutPaper = (typeof QUOTE_LAYOUT_PAPERS)[number];
export type QuoteLayoutOrientation = (typeof QUOTE_LAYOUT_ORIENTATIONS)[number];
export type QuoteLayoutFont = (typeof QUOTE_LAYOUT_FONTS)[number];
export type QuoteLayoutAlign = (typeof QUOTE_LAYOUT_ALIGNS)[number];
export type QuoteLayoutLogoPosition = (typeof QUOTE_LAYOUT_LOGO_POSITIONS)[number];
export type QuoteLayoutDividerStyle = (typeof QUOTE_LAYOUT_DIVIDER_STYLES)[number];
export type QuoteLayoutBlockType = (typeof QUOTE_LAYOUT_BLOCK_TYPES)[number];
export type QuoteLayoutLineColumnKey = (typeof QUOTE_LAYOUT_LINE_COLUMN_KEYS)[number];
export type QuoteLayoutTotalRowKey = (typeof QUOTE_LAYOUT_TOTAL_ROW_KEYS)[number];

export const QUOTE_LAYOUT_LINE_COLUMN_LABELS: Readonly<Record<QuoteLayoutLineColumnKey, string>> = {
  index: 'TT',
  materialCode: 'Mã hàng',
  materialName: 'Tên hàng hoá, dịch vụ',
  unit: 'ĐVT',
  quantity: 'Số lượng',
  listPrice: 'Đơn giá gốc',
  discountPercent: 'Chiết khấu (%)',
  unitPrice: 'Đơn giá',
  lineAmount: 'Thành tiền',
  vatRate: 'VAT (%)',
  vatAmount: 'Tiền VAT',
  lineTotal: 'Tổng cộng',
  category: 'Nhóm hàng',
};

export const QUOTE_LAYOUT_TOTAL_ROW_LABELS: Readonly<Record<QuoteLayoutTotalRowKey, string>> = {
  subtotal: 'Cộng tiền hàng',
  lineDiscount: 'Chiết khấu',
  orderDiscount: 'Chiết khấu tổng đơn',
  fees: 'Phí',
  shipping: 'Phí vận chuyển',
  vat: 'Thuế GTGT',
  orderTax: 'Thuế tổng đơn',
  grandTotal: 'Tổng cộng',
};

/** Giới hạn của bố cục (plan mục 5.4). Kích thước tính theo byte; độ dài chữ tính theo ký tự. */
export const QUOTE_LAYOUT_LIMITS = {
  minBlocks: 1,
  maxBlocks: 100,
  /** Kích thước tối đa của bố cục sau `JSON.stringify` (UTF-8). */
  maxBytes: 1024 * 1024,
  /** Kích thước tối đa của một ảnh sau giải mã base64. */
  maxImageBytes: 300 * 1024,
  maxTextLength: 4000,
  maxLabelLength: 200,
  maxIdLength: 40,
  maxCompanyLines: 6,
  marginMm: { min: 5, max: 40 },
  fontSizePt: { min: 9, max: 16 },
  blockMarginTopMm: { min: 0, max: 50 },
  imageHeightMm: { min: 5, max: 80 },
  titleFontSizePt: { min: 12, max: 32 },
  labelWidthPct: { min: 20, max: 60 },
  columnWidthPct: { min: 0, max: 100 },
  tableWidthTotalPct: { min: 99, max: 101 },
  signatureHeightMm: { min: 15, max: 60 },
  spacerHeightMm: { min: 1, max: 100 },
  dividerThicknessPt: { min: 0.5, max: 3 },
} as const;

// ---------------------------------------------------------------------------
// Kiểu
// ---------------------------------------------------------------------------

export interface QuoteLayoutBlockBase {
  /** Chuỗi ngắn `[a-z0-9-]`, duy nhất trong bố cục. */
  readonly id: string;
  /** 0..50 */
  readonly marginTopMm?: number;
}

export interface QuoteLayoutImageBlock extends QuoteLayoutBlockBase {
  readonly type: 'image';
  /** Data URL PNG hoặc JPEG, tối đa 300 KB sau giải mã. */
  readonly src: string;
  readonly heightMm: number;
  readonly align: QuoteLayoutAlign;
}

export interface QuoteLayoutCompanyHeaderBlock extends QuoteLayoutBlockBase {
  readonly type: 'companyHeader';
  readonly name: string;
  /** Tối đa 6 dòng: địa chỉ, MST, điện thoại... */
  readonly lines: readonly string[];
  readonly logo?: string;
  readonly logoPosition: QuoteLayoutLogoPosition;
  readonly align: QuoteLayoutAlign;
}

export interface QuoteLayoutTitleBlock extends QuoteLayoutBlockBase {
  readonly type: 'title';
  readonly text: string;
  readonly subtitle?: string;
  readonly fontSizePt: number;
  readonly align: QuoteLayoutAlign;
  readonly uppercase: boolean;
}

export interface QuoteLayoutTextRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}

export interface QuoteLayoutTextBlock extends QuoteLayoutBlockBase {
  readonly type: 'text';
  readonly runs: readonly QuoteLayoutTextRun[];
  readonly align: QuoteLayoutAlign;
}

export interface QuoteLayoutLabelValue {
  readonly label: string;
  /** Có thể chứa biến `{{...}}`. */
  readonly value: string;
}

export interface QuoteLayoutFieldGridBlock extends QuoteLayoutBlockBase {
  readonly type: 'fieldGrid';
  readonly columns: 1 | 2;
  readonly items: readonly QuoteLayoutLabelValue[];
  readonly labelWidthPct: number;
}

export interface QuoteLayoutLineColumn {
  readonly key: QuoteLayoutLineColumnKey;
  readonly label: string;
  readonly widthPct: number;
  readonly align: QuoteLayoutAlign;
  readonly visible: boolean;
}

export interface QuoteLayoutLineTableBlock extends QuoteLayoutBlockBase {
  readonly type: 'lineTable';
  readonly columns: readonly QuoteLayoutLineColumn[];
  readonly showGroupByCategory?: boolean;
  readonly zebra?: boolean;
}

export interface QuoteLayoutTotalRow {
  readonly key: QuoteLayoutTotalRowKey;
  readonly label: string;
  readonly visible: boolean;
}

export interface QuoteLayoutTotalsBlock extends QuoteLayoutBlockBase {
  readonly type: 'totals';
  readonly rows: readonly QuoteLayoutTotalRow[];
  readonly showAmountInWords: boolean;
  readonly align: QuoteLayoutAlign;
}

export interface QuoteLayoutTermsBlock extends QuoteLayoutBlockBase {
  readonly type: 'terms';
  readonly items: readonly QuoteLayoutLabelValue[];
  readonly numbered: boolean;
}

export interface QuoteLayoutSignatureParty {
  readonly title: string;
  readonly subtitle?: string;
  readonly name?: string;
}

export interface QuoteLayoutSignatureBlock extends QuoteLayoutBlockBase {
  readonly type: 'signature';
  readonly left: QuoteLayoutSignatureParty;
  readonly right: QuoteLayoutSignatureParty;
  readonly heightMm: number;
}

export interface QuoteLayoutSpacerBlock extends QuoteLayoutBlockBase {
  readonly type: 'spacer';
  readonly heightMm: number;
}

export interface QuoteLayoutDividerBlock extends QuoteLayoutBlockBase {
  readonly type: 'divider';
  readonly thicknessPt: number;
  readonly style: QuoteLayoutDividerStyle;
}

export type QuoteLayoutBlock =
  | QuoteLayoutImageBlock
  | QuoteLayoutCompanyHeaderBlock
  | QuoteLayoutTitleBlock
  | QuoteLayoutTextBlock
  | QuoteLayoutFieldGridBlock
  | QuoteLayoutLineTableBlock
  | QuoteLayoutTotalsBlock
  | QuoteLayoutTermsBlock
  | QuoteLayoutSignatureBlock
  | QuoteLayoutSpacerBlock
  | QuoteLayoutDividerBlock;

export interface QuoteLayoutMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface QuoteLayout {
  readonly version: 1;
  readonly paper: QuoteLayoutPaper;
  readonly orientation: QuoteLayoutOrientation;
  /** Mỗi cạnh 5..40 mm. */
  readonly marginsMm: QuoteLayoutMargins;
  readonly fontFamily: QuoteLayoutFont;
  /** 9..16 */
  readonly fontSizePt: number;
  readonly blocks: readonly QuoteLayoutBlock[];
}

// ---------------------------------------------------------------------------
// Biến (plan mục 5.3)
// ---------------------------------------------------------------------------

export const QUOTE_LAYOUT_VARIABLE_GROUPS = ['quote', 'customer', 'opportunity', 'owner', 'totals', 'print'] as const;
export type QuoteLayoutVariableGroup = (typeof QUOTE_LAYOUT_VARIABLE_GROUPS)[number];

export const QUOTE_LAYOUT_VARIABLE_GROUP_LABELS: Readonly<Record<QuoteLayoutVariableGroup | 'custom', string>> = {
  quote: 'Báo giá',
  customer: 'Khách hàng',
  opportunity: 'Dự án',
  owner: 'Người phụ trách',
  totals: 'Tiền',
  print: 'Ngày in',
  custom: 'Trường tuỳ biến',
};

export interface QuoteLayoutVariable {
  readonly key: string;
  readonly label: string;
  readonly group: QuoteLayoutVariableGroup;
}

export const QUOTE_LAYOUT_VARIABLES: readonly QuoteLayoutVariable[] = [
  { key: 'quote.code', label: 'Mã báo giá', group: 'quote' },
  { key: 'quote.name', label: 'Tên báo giá', group: 'quote' },
  { key: 'quote.date', label: 'Ngày báo giá', group: 'quote' },
  { key: 'quote.validUntil', label: 'Hiệu lực đến', group: 'quote' },
  { key: 'quote.priceDate', label: 'Ngày tính giá', group: 'quote' },
  { key: 'quote.versionNo', label: 'Phiên bản', group: 'quote' },
  { key: 'quote.typeName', label: 'Loại báo giá', group: 'quote' },
  { key: 'quote.templateName', label: 'Mẫu báo giá', group: 'quote' },
  { key: 'quote.note', label: 'Ghi chú', group: 'quote' },
  { key: 'quote.status', label: 'Trạng thái', group: 'quote' },
  { key: 'customer.code', label: 'Mã khách hàng', group: 'customer' },
  { key: 'customer.name', label: 'Tên khách hàng', group: 'customer' },
  { key: 'customer.taxCode', label: 'Mã số thuế khách hàng', group: 'customer' },
  { key: 'customer.address', label: 'Địa chỉ khách hàng', group: 'customer' },
  { key: 'customer.phone', label: 'Điện thoại khách hàng', group: 'customer' },
  { key: 'customer.email', label: 'Email khách hàng', group: 'customer' },
  { key: 'opportunity.code', label: 'Mã dự án', group: 'opportunity' },
  { key: 'opportunity.name', label: 'Tên dự án', group: 'opportunity' },
  { key: 'owner.name', label: 'Tên người phụ trách', group: 'owner' },
  { key: 'owner.email', label: 'Email người phụ trách', group: 'owner' },
  { key: 'owner.phone', label: 'Điện thoại người phụ trách', group: 'owner' },
  { key: 'totals.subtotal', label: 'Cộng tiền hàng', group: 'totals' },
  { key: 'totals.discount', label: 'Chiết khấu', group: 'totals' },
  { key: 'totals.fees', label: 'Phí', group: 'totals' },
  { key: 'totals.vat', label: 'Thuế GTGT', group: 'totals' },
  { key: 'totals.grandTotal', label: 'Tổng cộng', group: 'totals' },
  { key: 'totals.amountInWords', label: 'Số tiền bằng chữ', group: 'totals' },
  { key: 'today', label: 'Ngày in', group: 'print' },
];

/** Tiền tố biến trường tuỳ biến: `custom.<uuid>`. */
export const QUOTE_LAYOUT_CUSTOM_VARIABLE_PREFIX = 'custom.';

const VARIABLE_KEYS: ReadonlySet<string> = new Set(QUOTE_LAYOUT_VARIABLES.map((variable) => variable.key));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Biến được phép: có trong danh sách cố định, hoặc `custom.<uuid>` (không kiểm trường còn tồn tại). */
export function isQuoteLayoutVariable(name: string): boolean {
  if (VARIABLE_KEYS.has(name)) return true;
  return (
    name.startsWith(QUOTE_LAYOUT_CUSTOM_VARIABLE_PREFIX) && UUID_PATTERN.test(name.slice(QUOTE_LAYOUT_CUSTOM_VARIABLE_PREFIX.length))
  );
}

/** Một đoạn của chuỗi có biến: chữ thường, hoặc biến hợp lệ. */
export type QuoteTextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'variable'; readonly name: string; readonly raw: string };

/**
 * `{{tên}}` không khoảng trắng, không lồng. Ngoặc nhọn thừa sát bên (`{{{x}}}`) thì cả cụm giữ nguyên văn.
 * Nhóm 1, 3: ngoặc thừa; nhóm 2: tên biến.
 */
const TOKEN_PATTERN = /(\{*)\{\{([A-Za-z0-9_.-]+)\}\}(\}*)/g;

function scanTokens(text: string, visit: (name: string, raw: string, literal: boolean) => void, onText: (text: string) => void): void {
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) onText(text.slice(last, start));
    const literal = match[1].length > 0 || match[3].length > 0;
    visit(match[2], match[0], literal);
    last = start + match[0].length;
  }
  if (last < text.length) onText(text.slice(last));
}

/**
 * Tách chuỗi thành chữ và biến hợp lệ (dùng để dựng chip ở chế độ thiết kế). Biến lạ, có khoảng trắng, thiếu đóng,
 * ngoặc thừa: giữ nguyên văn như chữ thường.
 */
export function splitQuoteText(text: string): QuoteTextSegment[] {
  const segments: QuoteTextSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === 'text') segments[segments.length - 1] = { kind: 'text', text: previous.text + value };
    else segments.push({ kind: 'text', text: value });
  };
  scanTokens(
    text,
    (name, raw, literal) => {
      if (literal || !isQuoteLayoutVariable(name)) pushText(raw);
      else segments.push({ kind: 'variable', name, raw });
    },
    pushText,
  );
  return segments;
}

export type QuoteTextBindMode = 'design' | 'view';

/**
 * Thay biến bằng giá trị, trả chữ thuần.
 * - Biến hợp lệ có giá trị: thay.
 * - Biến hợp lệ không có giá trị: chế độ `view` (xem trước, xuất file) thành chuỗi rỗng; chế độ `design` giữ `{{tên}}`.
 * - Biến lạ, có khoảng trắng, thiếu đóng, ngoặc thừa: giữ nguyên văn ở cả hai chế độ.
 */
export function bindQuoteText(
  text: string,
  values: Readonly<Record<string, string | null | undefined>>,
  mode: QuoteTextBindMode = 'view',
): string {
  let output = '';
  for (const segment of splitQuoteText(text)) {
    if (segment.kind === 'text') {
      output += segment.text;
      continue;
    }
    const value = Object.prototype.hasOwnProperty.call(values, segment.name) ? values[segment.name] : undefined;
    if (value !== undefined && value !== null && value !== '') output += value;
    else if (mode === 'design') output += segment.raw;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Số theo kiểu Việt Nam: `1.234,5`; tối đa `maxFractionDigits` chữ số lẻ, bỏ số 0 thừa. */
export function formatQuoteNumber(value: number | null | undefined, maxFractionDigits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const fixed = Math.abs(value).toFixed(maxFractionDigits);
  const [whole, fraction = ''] = fixed.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const body = groupThousands(whole) + (trimmed ? `,${trimmed}` : '');
  return value < 0 && body !== '0' ? `-${body}` : body;
}

/** Tiền: số nguyên đồng, `1.234.567`, không ký hiệu. */
export function formatQuoteMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return formatQuoteNumber(roundDong(value), 0);
}

/** Phần trăm: `10%`, `7,5%`. */
export function formatQuotePercent(value: number | null | undefined): string {
  const body = formatQuoteNumber(value, 2);
  return body ? `${body}%` : '';
}

/** Ngày `dd/mm/yyyy` từ `yyyy-mm-dd` hoặc chuỗi ISO; không đọc được thì chuỗi rỗng. */
export function formatQuoteDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Làm tròn tới đồng, nửa đồng làm tròn ra xa số 0. */
function roundDong(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

const DIGIT_WORDS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số. `full`: nhóm đứng sau nhóm khác nên đọc cả "không trăm", "linh". */
function readHundreds(value: number, full: boolean): string {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  const words: string[] = [];
  if (full || hundreds > 0) words.push(DIGIT_WORDS[hundreds], 'trăm');
  if (tens === 0) {
    if (units > 0 && words.length > 0) words.push('linh');
  } else if (tens === 1) {
    words.push('mười');
  } else {
    words.push(DIGIT_WORDS[tens], 'mươi');
  }
  if (units > 0) {
    if (units === 1 && tens > 1) words.push('mốt');
    else if (units === 4 && tens > 1) words.push('tư');
    else if (units === 5 && tens > 0) words.push('lăm');
    else words.push(DIGIT_WORDS[units]);
  }
  return words.join(' ');
}

/** Đọc số dưới một tỷ; `full` khi phía trước đã có hàng tỷ. */
function readBelowBillion(value: number, full: boolean): string {
  const groups = [Math.floor(value / 1_000_000), Math.floor((value % 1_000_000) / 1000), value % 1000];
  const scales = ['triệu', 'nghìn', ''];
  const words: string[] = [];
  let started = full;
  groups.forEach((group, index) => {
    if (group === 0) return;
    words.push(readHundreds(group, started));
    if (scales[index]) words.push(scales[index]);
    started = true;
  });
  return words.join(' ');
}

function readNumber(value: number): string {
  if (value === 0) return DIGIT_WORDS[0];
  if (value < 1_000_000_000) return readBelowBillion(value, false);
  const billions = Math.floor(value / 1_000_000_000);
  const rest = value % 1_000_000_000;
  const head = `${readNumber(billions)} tỷ`;
  return rest > 0 ? `${head} ${readBelowBillion(rest, true)}` : head;
}

/**
 * Số tiền bằng chữ: làm tròn tới đồng, viết hoa chữ đầu, kết thúc bằng "đồng"; 0 là "Không đồng"; số âm có tiền tố
 * "Âm". Ví dụ 1.005.000 → "Một triệu không trăm linh năm nghìn đồng".
 */
export function amountInWordsVi(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '';
  const rounded = roundDong(amount);
  if (Math.abs(rounded) > Number.MAX_SAFE_INTEGER) return '';
  const body = `${readNumber(Math.abs(rounded))} đồng`;
  const text = rounded < 0 ? `âm ${body}` : body;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Bố cục mặc định (theo BG.pdf)
// ---------------------------------------------------------------------------

/** Bố cục dùng khi mẫu chưa thiết kế: đầu trang công ty, "BÁO GIÁ", thông tin khách, bảng hàng, tổng, điều khoản, chữ ký. */
export function defaultQuoteLayout(): QuoteLayout {
  const column = (key: QuoteLayoutLineColumnKey, widthPct: number, align: QuoteLayoutAlign, visible: boolean): QuoteLayoutLineColumn => ({
    key,
    label: QUOTE_LAYOUT_LINE_COLUMN_LABELS[key],
    widthPct,
    align,
    visible,
  });
  const total = (key: QuoteLayoutTotalRowKey, visible: boolean): QuoteLayoutTotalRow => ({
    key,
    label: QUOTE_LAYOUT_TOTAL_ROW_LABELS[key],
    visible,
  });
  return {
    version: 1,
    paper: 'A4',
    orientation: 'portrait',
    marginsMm: { top: 15, right: 15, bottom: 15, left: 20 },
    fontFamily: 'Times New Roman',
    fontSizePt: 12,
    blocks: [
      {
        id: 'company',
        type: 'companyHeader',
        name: 'TÊN CÔNG TY',
        lines: ['Địa chỉ: ', 'Mã số thuế: ', 'Điện thoại: ', 'Email: '],
        logoPosition: 'left',
        align: 'left',
      },
      { id: 'company-divider', type: 'divider', thicknessPt: 1, style: 'solid' },
      {
        id: 'title',
        type: 'title',
        text: 'BÁO GIÁ',
        subtitle: 'Số: {{quote.code}} - Ngày: {{quote.date}}',
        fontSizePt: 20,
        align: 'center',
        uppercase: true,
        marginTopMm: 4,
      },
      {
        id: 'customer',
        type: 'fieldGrid',
        columns: 2,
        labelWidthPct: 35,
        marginTopMm: 4,
        items: [
          { label: 'Báo giá đến', value: '{{customer.name}}' },
          { label: 'Mã số thuế', value: '{{customer.taxCode}}' },
          { label: 'Địa chỉ', value: '{{customer.address}}' },
          { label: 'Điện thoại', value: '{{customer.phone}}' },
          { label: 'Email', value: '{{customer.email}}' },
          { label: 'Hiệu lực đến', value: '{{quote.validUntil}}' },
          { label: 'Người báo giá', value: '{{owner.name}}' },
          { label: 'Điện thoại', value: '{{owner.phone}}' },
        ],
      },
      {
        id: 'intro',
        type: 'text',
        align: 'left',
        marginTopMm: 4,
        runs: [{ text: 'Công ty chúng tôi trân trọng gửi tới Quý khách báo giá như sau:', italic: true }],
      },
      {
        id: 'lines',
        type: 'lineTable',
        marginTopMm: 2,
        zebra: false,
        showGroupByCategory: false,
        columns: [
          column('index', 5, 'center', true),
          column('materialCode', 10, 'left', false),
          column('materialName', 30, 'left', true),
          column('unit', 8, 'center', true),
          column('quantity', 8, 'right', true),
          column('listPrice', 12, 'right', false),
          column('discountPercent', 8, 'right', false),
          column('unitPrice', 14, 'right', true),
          column('vatRate', 7, 'right', true),
          column('lineAmount', 14, 'right', true),
          column('vatAmount', 12, 'right', false),
          column('lineTotal', 14, 'right', true),
          column('category', 12, 'left', false),
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        align: 'right',
        showAmountInWords: true,
        marginTopMm: 2,
        rows: [
          total('subtotal', true),
          total('lineDiscount', false),
          total('orderDiscount', false),
          total('fees', false),
          total('shipping', false),
          total('vat', true),
          total('orderTax', false),
          total('grandTotal', true),
        ],
      },
      {
        id: 'terms',
        type: 'terms',
        numbered: true,
        marginTopMm: 4,
        items: [
          { label: 'Hiệu lực báo giá', value: 'Đến hết ngày {{quote.validUntil}}' },
          { label: 'Ghi chú', value: '{{quote.note}}' },
        ],
      },
      {
        id: 'signature',
        type: 'signature',
        heightMm: 30,
        marginTopMm: 8,
        left: { title: 'ĐẠI DIỆN BÊN MUA', subtitle: '(Ký, ghi rõ họ tên)' },
        right: { title: 'ĐẠI DIỆN BÊN BÁN', subtitle: '(Ký, đóng dấu)', name: '{{owner.name}}' },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Kiểm hợp lệ (plan mục 5.4)
// ---------------------------------------------------------------------------

export const QUOTE_LAYOUT_ERROR_CODES = [
  'LAYOUT_VERSION_UNSUPPORTED',
  'LAYOUT_TOO_MANY_BLOCKS',
  'LAYOUT_EMPTY',
  'LAYOUT_TOO_LARGE',
  'LAYOUT_IMAGE_INVALID',
  'LAYOUT_TEXT_TOO_LONG',
  'LAYOUT_INVALID',
  'LAYOUT_DUPLICATE_ID',
  'LAYOUT_TABLE_INVALID',
  'LAYOUT_VARIABLE_UNKNOWN',
] as const;
export type QuoteLayoutErrorCode = (typeof QUOTE_LAYOUT_ERROR_CODES)[number];

export interface QuoteLayoutError {
  /** Đường dẫn trường, ví dụ `blocks[3].heightMm`; rỗng là cả bố cục. */
  readonly path: string;
  readonly code: QuoteLayoutErrorCode;
  /** Câu tiếng Việt cho người dùng. */
  readonly message: string;
}

export type QuoteLayoutValidation =
  | { readonly ok: true; readonly layout: QuoteLayout }
  | { readonly ok: false; readonly errors: readonly QuoteLayoutError[] };

type Unknown = Record<string, unknown>;

const isObject = (value: unknown): value is Unknown => typeof value === 'object' && value !== null && !Array.isArray(value);
const BLOCK_ID_PATTERN = /^[a-z0-9-]+$/;

/** Số ký tự (code point sau NFC), không phải số byte: chữ Việt dựng sẵn hay tổ hợp đều đếm như nhau. */
export function quoteLayoutTextLength(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

/** Số byte UTF-8 của chuỗi. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: ReadonlyMap<string, number> = new Map([...BASE64_ALPHABET].map((char, index) => [char, index]));

/** Giải mã base64 chuẩn (có đệm `=`); sai ký tự, sai độ dài, đệm sai chỗ thì trả `null`. */
export function decodeBase64(input: string): Uint8Array | null {
  if (input.length === 0 || input.length % 4 !== 0) return null;
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((input.length / 4) * 3 - padding);
  let written = 0;
  for (let offset = 0; offset < input.length; offset += 4) {
    const last = offset + 4 === input.length;
    const values: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const char = input[offset + index];
      if (char === '=') {
        if (!last || index < 4 - padding) return null;
        values.push(0);
        continue;
      }
      const value = BASE64_LOOKUP.get(char);
      if (value === undefined) return null;
      values.push(value);
    }
    const triple = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    const bytes = [(triple >> 16) & 0xff, (triple >> 8) & 0xff, triple & 0xff];
    const take = last ? 3 - padding : 3;
    for (let index = 0; index < take; index += 1) output[written++] = bytes[index];
  }
  return output;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWithBytes = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

type ImageCheck = 'ok' | 'invalid' | 'too-large';

/** Ảnh: data URL PNG hoặc JPEG, giải mã thật và khớp chữ ký đầu file với loại đã khai; tối đa 300 KB. */
function checkImage(src: string): ImageCheck {
  const match = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(src);
  if (!match) return 'invalid';
  const payload = match[2];
  // Chặn sớm chuỗi quá dài trước khi giải mã (4 ký tự base64 = 3 byte).
  if (payload.length > Math.ceil(QUOTE_LAYOUT_LIMITS.maxImageBytes / 3) * 4) return 'too-large';
  const bytes = decodeBase64(payload);
  if (!bytes) return 'invalid';
  if (bytes.length > QUOTE_LAYOUT_LIMITS.maxImageBytes) return 'too-large';
  const signature = match[1] === 'png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  return startsWithBytes(bytes, signature) ? 'ok' : 'invalid';
}

class LayoutChecker {
  readonly errors: QuoteLayoutError[] = [];

  fail(path: string, code: QuoteLayoutErrorCode, message: string): void {
    this.errors.push({ path, code, message });
  }

  /** Vị trí cho câu báo lỗi: "Khối 3" hoặc "Thiết lập trang". */
  where(blockIndex: number | null): string {
    return blockIndex === null ? 'Thiết lập trang' : `Khối ${blockIndex + 1}`;
  }

  number(source: Unknown, key: string, path: string, range: { min: number; max: number }, blockIndex: number | null): number {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
      this.fail(
        `${path}.${key}`,
        'LAYOUT_INVALID',
        `${this.where(blockIndex)}: "${key}" phải là số từ ${formatQuoteNumber(range.min)} đến ${formatQuoteNumber(range.max)}.`,
      );
      return range.min;
    }
    return value;
  }

  optionalNumber(
    source: Unknown,
    key: string,
    path: string,
    range: { min: number; max: number },
    blockIndex: number | null,
  ): number | undefined {
    if (source[key] === undefined || source[key] === null) return undefined;
    return this.number(source, key, path, range, blockIndex);
  }

  choice<T extends string | number>(source: Unknown, key: string, path: string, options: readonly T[], blockIndex: number | null): T {
    const value = source[key];
    const found = options.find((option) => option === value);
    if (found === undefined) {
      this.fail(
        `${path}.${key}`,
        'LAYOUT_INVALID',
        `${this.where(blockIndex)}: "${key}" phải là một trong các giá trị ${options.map((option) => String(option)).join(', ')}.`,
      );
      return options[0];
    }
    return found;
  }

  boolean(source: Unknown, key: string, path: string, blockIndex: number | null): boolean {
    const value = source[key];
    if (typeof value !== 'boolean') {
      this.fail(`${path}.${key}`, 'LAYOUT_INVALID', `${this.where(blockIndex)}: "${key}" phải là đúng hoặc sai.`);
      return false;
    }
    return value;
  }

  optionalBoolean(source: Unknown, key: string, path: string, blockIndex: number | null): boolean | undefined {
    if (source[key] === undefined || source[key] === null) return undefined;
    return this.boolean(source, key, path, blockIndex);
  }

  /** Chữ có thể chứa biến; `label` giới hạn 200 ký tự, chữ khác 4.000. */
  text(
    source: Unknown,
    key: string,
    path: string,
    blockIndex: number | null,
    kind: 'text' | 'label' = 'text',
  ): string {
    const value = source[key];
    const fieldPath = `${path}.${key}`;
    if (typeof value !== 'string') {
      this.fail(fieldPath, 'LAYOUT_INVALID', `${this.where(blockIndex)}: "${key}" phải là chữ.`);
      return '';
    }
    this.checkText(value, fieldPath, blockIndex, kind);
    return value;
  }

  optionalText(source: Unknown, key: string, path: string, blockIndex: number | null): string | undefined {
    if (source[key] === undefined || source[key] === null) return undefined;
    return this.text(source, key, path, blockIndex);
  }

  checkText(value: string, path: string, blockIndex: number | null, kind: 'text' | 'label'): void {
    const max = kind === 'label' ? QUOTE_LAYOUT_LIMITS.maxLabelLength : QUOTE_LAYOUT_LIMITS.maxTextLength;
    if (quoteLayoutTextLength(value) > max) {
      this.fail(
        path,
        'LAYOUT_TEXT_TOO_LONG',
        `${this.where(blockIndex)}: ${kind === 'label' ? 'nhãn' : 'nội dung'} vượt ${formatQuoteNumber(max)} ký tự.`,
      );
    }
    const unknown = new Set<string>();
    scanTokens(
      value,
      (name, _raw, literal) => {
        if (!literal && !isQuoteLayoutVariable(name)) unknown.add(name);
      },
      () => undefined,
    );
    for (const name of unknown) {
      this.fail(path, 'LAYOUT_VARIABLE_UNKNOWN', `${this.where(blockIndex)}: biến {{${name}}} không có trong danh sách biến cho phép.`);
    }
  }

  image(source: Unknown, key: string, path: string, blockIndex: number): string {
    const value = source[key];
    const fieldPath = `${path}.${key}`;
    const result = typeof value === 'string' ? checkImage(value) : 'invalid';
    if (result === 'too-large') {
      this.fail(fieldPath, 'LAYOUT_IMAGE_INVALID', `Ảnh ở khối ${blockIndex + 1} vượt 300 KB.`);
    } else if (result === 'invalid') {
      this.fail(
        fieldPath,
        'LAYOUT_IMAGE_INVALID',
        `Ảnh ở khối ${blockIndex + 1} không hợp lệ: chỉ nhận ảnh PNG hoặc JPEG tải lên (không nhận đường dẫn ngoài, SVG hay GIF).`,
      );
    }
    return typeof value === 'string' ? value : '';
  }

  object(source: Unknown, key: string, path: string, blockIndex: number | null): Unknown {
    const value = source[key];
    if (!isObject(value)) {
      this.fail(`${path}.${key}`, 'LAYOUT_INVALID', `${this.where(blockIndex)}: thiếu "${key}".`);
      return {};
    }
    return value;
  }

  array(source: Unknown, key: string, path: string, blockIndex: number | null): unknown[] {
    const value = source[key];
    if (!Array.isArray(value)) {
      this.fail(`${path}.${key}`, 'LAYOUT_INVALID', `${this.where(blockIndex)}: "${key}" phải là danh sách.`);
      return [];
    }
    return value;
  }

  /** Phần tử của danh sách phải là object; phần tử sai được báo và bỏ qua. */
  items(source: Unknown, key: string, path: string, blockIndex: number | null): Array<{ item: Unknown; path: string }> {
    const result: Array<{ item: Unknown; path: string }> = [];
    this.array(source, key, path, blockIndex).forEach((item, index) => {
      const itemPath = `${path}.${key}[${index}]`;
      if (!isObject(item)) {
        this.fail(itemPath, 'LAYOUT_INVALID', `${this.where(blockIndex)}: phần tử ${index + 1} của "${key}" không hợp lệ.`);
        return;
      }
      result.push({ item, path: itemPath });
    });
    return result;
  }

  labelValues(source: Unknown, key: string, path: string, blockIndex: number): QuoteLayoutLabelValue[] {
    return this.items(source, key, path, blockIndex).map(({ item, path: itemPath }) => ({
      label: this.text(item, 'label', itemPath, blockIndex, 'label'),
      value: this.text(item, 'value', itemPath, blockIndex),
    }));
  }

  signatureParty(source: Unknown, key: string, path: string, blockIndex: number): QuoteLayoutSignatureParty {
    const party = this.object(source, key, path, blockIndex);
    const partyPath = `${path}.${key}`;
    const subtitle = this.optionalText(party, 'subtitle', partyPath, blockIndex);
    const name = this.optionalText(party, 'name', partyPath, blockIndex);
    return {
      title: this.text(party, 'title', partyPath, blockIndex, 'label'),
      ...(subtitle !== undefined ? { subtitle } : {}),
      ...(name !== undefined ? { name } : {}),
    };
  }

  block(raw: unknown, index: number): QuoteLayoutBlock | null {
    const path = `blocks[${index}]`;
    if (!isObject(raw)) {
      this.fail(path, 'LAYOUT_INVALID', `Khối ${index + 1} không hợp lệ.`);
      return null;
    }
    const type = QUOTE_LAYOUT_BLOCK_TYPES.find((candidate) => candidate === raw['type']);
    if (!type) {
      this.fail(`${path}.type`, 'LAYOUT_INVALID', `Khối ${index + 1}: loại khối không được hỗ trợ.`);
      return null;
    }
    const id = raw['id'];
    if (typeof id !== 'string' || id.length === 0 || id.length > QUOTE_LAYOUT_LIMITS.maxIdLength || !BLOCK_ID_PATTERN.test(id)) {
      this.fail(
        `${path}.id`,
        'LAYOUT_INVALID',
        `Khối ${index + 1}: mã khối phải gồm chữ thường không dấu, số, dấu gạch ngang, tối đa ${QUOTE_LAYOUT_LIMITS.maxIdLength} ký tự.`,
      );
    }
    const marginTopMm = this.optionalNumber(raw, 'marginTopMm', path, QUOTE_LAYOUT_LIMITS.blockMarginTopMm, index);
    const base = { id: typeof id === 'string' ? id : '', ...(marginTopMm !== undefined ? { marginTopMm } : {}) };
    switch (type) {
      case 'image':
        return {
          ...base,
          type,
          src: this.image(raw, 'src', path, index),
          heightMm: this.number(raw, 'heightMm', path, QUOTE_LAYOUT_LIMITS.imageHeightMm, index),
          align: this.choice(raw, 'align', path, QUOTE_LAYOUT_ALIGNS, index),
        };
      case 'companyHeader': {
        const lines = this.array(raw, 'lines', path, index);
        if (lines.length > QUOTE_LAYOUT_LIMITS.maxCompanyLines) {
          this.fail(`${path}.lines`, 'LAYOUT_INVALID', `Khối ${index + 1}: đầu trang công ty tối đa ${QUOTE_LAYOUT_LIMITS.maxCompanyLines} dòng.`);
        }
        const logo = raw['logo'] === undefined || raw['logo'] === null ? undefined : this.image(raw, 'logo', path, index);
        return {
          ...base,
          type,
          name: this.text(raw, 'name', path, index),
          lines: lines.map((line, lineIndex) => {
            const linePath = `${path}.lines[${lineIndex}]`;
            if (typeof line !== 'string') {
              this.fail(linePath, 'LAYOUT_INVALID', `Khối ${index + 1}: dòng ${lineIndex + 1} phải là chữ.`);
              return '';
            }
            this.checkText(line, linePath, index, 'text');
            return line;
          }),
          ...(logo !== undefined ? { logo } : {}),
          logoPosition: this.choice(raw, 'logoPosition', path, QUOTE_LAYOUT_LOGO_POSITIONS, index),
          align: this.choice(raw, 'align', path, QUOTE_LAYOUT_ALIGNS, index),
        };
      }
      case 'title': {
        const subtitle = this.optionalText(raw, 'subtitle', path, index);
        return {
          ...base,
          type,
          text: this.text(raw, 'text', path, index),
          ...(subtitle !== undefined ? { subtitle } : {}),
          fontSizePt: this.number(raw, 'fontSizePt', path, QUOTE_LAYOUT_LIMITS.titleFontSizePt, index),
          align: this.choice(raw, 'align', path, QUOTE_LAYOUT_ALIGNS, index),
          uppercase: this.boolean(raw, 'uppercase', path, index),
        };
      }
      case 'text':
        return {
          ...base,
          type,
          runs: this.items(raw, 'runs', path, index).map(({ item, path: runPath }) => {
            const bold = this.optionalBoolean(item, 'bold', runPath, index);
            const italic = this.optionalBoolean(item, 'italic', runPath, index);
            const underline = this.optionalBoolean(item, 'underline', runPath, index);
            return {
              text: this.text(item, 'text', runPath, index),
              ...(bold !== undefined ? { bold } : {}),
              ...(italic !== undefined ? { italic } : {}),
              ...(underline !== undefined ? { underline } : {}),
            };
          }),
          align: this.choice(raw, 'align', path, QUOTE_LAYOUT_ALIGNS, index),
        };
      case 'fieldGrid':
        return {
          ...base,
          type,
          columns: this.choice(raw, 'columns', path, [1, 2] as const, index),
          items: this.labelValues(raw, 'items', path, index),
          labelWidthPct: this.number(raw, 'labelWidthPct', path, QUOTE_LAYOUT_LIMITS.labelWidthPct, index),
        };
      case 'lineTable':
        return this.lineTable(raw, base, path, index);
      case 'totals': {
        const seen = new Set<string>();
        const rows = this.items(raw, 'rows', path, index).map(({ item, path: rowPath }) => {
          const key = this.choice(item, 'key', rowPath, QUOTE_LAYOUT_TOTAL_ROW_KEYS, index);
          if (seen.has(key)) this.fail(`${rowPath}.key`, 'LAYOUT_INVALID', `Khối ${index + 1}: dòng tổng "${key}" bị lặp.`);
          seen.add(key);
          return {
            key,
            label: this.text(item, 'label', rowPath, index, 'label'),
            visible: this.boolean(item, 'visible', rowPath, index),
          };
        });
        return {
          ...base,
          type,
          rows,
          showAmountInWords: this.boolean(raw, 'showAmountInWords', path, index),
          align: this.choice(raw, 'align', path, QUOTE_LAYOUT_ALIGNS, index),
        };
      }
      case 'terms':
        return {
          ...base,
          type,
          items: this.labelValues(raw, 'items', path, index),
          numbered: this.boolean(raw, 'numbered', path, index),
        };
      case 'signature':
        return {
          ...base,
          type,
          left: this.signatureParty(raw, 'left', path, index),
          right: this.signatureParty(raw, 'right', path, index),
          heightMm: this.number(raw, 'heightMm', path, QUOTE_LAYOUT_LIMITS.signatureHeightMm, index),
        };
      case 'spacer':
        return { ...base, type, heightMm: this.number(raw, 'heightMm', path, QUOTE_LAYOUT_LIMITS.spacerHeightMm, index) };
      case 'divider':
        return {
          ...base,
          type,
          thicknessPt: this.number(raw, 'thicknessPt', path, QUOTE_LAYOUT_LIMITS.dividerThicknessPt, index),
          style: this.choice(raw, 'style', path, QUOTE_LAYOUT_DIVIDER_STYLES, index),
        };
    }
  }

  /** Bảng dòng hàng: cột theo danh sách cố định, không trùng, ít nhất một cột hiện, tổng độ rộng cột hiện 99..101. */
  lineTable(raw: Unknown, base: QuoteLayoutBlockBase, path: string, index: number): QuoteLayoutLineTableBlock {
    const columns: QuoteLayoutLineColumn[] = [];
    const seen = new Set<string>();
    for (const { item, path: columnPath } of this.items(raw, 'columns', path, index)) {
      const key = QUOTE_LAYOUT_LINE_COLUMN_KEYS.find((candidate) => candidate === item['key']);
      if (!key) {
        this.fail(
          `${columnPath}.key`,
          'LAYOUT_TABLE_INVALID',
          `Khối ${index + 1}: cột "${String(item['key'])}" không có trong danh sách cột của bảng dòng hàng.`,
        );
        continue;
      }
      if (seen.has(key)) {
        this.fail(`${columnPath}.key`, 'LAYOUT_TABLE_INVALID', `Khối ${index + 1}: cột "${key}" bị lặp.`);
        continue;
      }
      seen.add(key);
      columns.push({
        key,
        label: this.text(item, 'label', columnPath, index, 'label'),
        widthPct: this.number(item, 'widthPct', columnPath, QUOTE_LAYOUT_LIMITS.columnWidthPct, index),
        align: this.choice(item, 'align', columnPath, QUOTE_LAYOUT_ALIGNS, index),
        visible: this.boolean(item, 'visible', columnPath, index),
      });
    }
    const visible = columns.filter((column) => column.visible);
    if (!visible.length) {
      this.fail(`${path}.columns`, 'LAYOUT_TABLE_INVALID', `Khối ${index + 1}: bảng dòng hàng cần ít nhất một cột hiện.`);
    } else {
      const total = visible.reduce((sum, column) => sum + column.widthPct, 0);
      const range = QUOTE_LAYOUT_LIMITS.tableWidthTotalPct;
      // Làm tròn để tránh sai số dấu phẩy động khi cộng các số lẻ.
      const rounded = Math.round(total * 1000) / 1000;
      if (rounded < range.min || rounded > range.max) {
        this.fail(
          `${path}.columns`,
          'LAYOUT_TABLE_INVALID',
          `Khối ${index + 1}: tổng độ rộng các cột hiện là ${formatQuoteNumber(rounded)}%, phải từ ${range.min}% đến ${range.max}%.`,
        );
      }
    }
    const showGroupByCategory = this.optionalBoolean(raw, 'showGroupByCategory', path, index);
    const zebra = this.optionalBoolean(raw, 'zebra', path, index);
    return {
      ...base,
      type: 'lineTable',
      columns,
      ...(showGroupByCategory !== undefined ? { showGroupByCategory } : {}),
      ...(zebra !== undefined ? { zebra } : {}),
    };
  }
}

/**
 * Kiểm và chuẩn hoá bố cục (dùng chung web và server). Trường lạ bị bỏ, không báo lỗi. Trả `{ ok: true, layout }`
 * (bản đã chuẩn hoá) hoặc `{ ok: false, errors }` với đường dẫn, mã lỗi và câu tiếng Việt.
 */
export function validateQuoteLayout(input: unknown): QuoteLayoutValidation {
  const check = new LayoutChecker();
  if (!isObject(input)) {
    return { ok: false, errors: [{ path: '', code: 'LAYOUT_INVALID', message: 'Bố cục không hợp lệ.' }] };
  }
  if (input['version'] !== QUOTE_LAYOUT_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'version',
          code: 'LAYOUT_VERSION_UNSUPPORTED',
          message: 'Phiên bản bố cục không được hỗ trợ. Hãy dùng bố cục xuất từ phiên bản hiện tại của hệ thống.',
        },
      ],
    };
  }
  const margins = check.object(input, 'marginsMm', '', null);
  const marginPath = 'marginsMm';
  const marginsMm: QuoteLayoutMargins = {
    top: check.number(margins, 'top', marginPath, QUOTE_LAYOUT_LIMITS.marginMm, null),
    right: check.number(margins, 'right', marginPath, QUOTE_LAYOUT_LIMITS.marginMm, null),
    bottom: check.number(margins, 'bottom', marginPath, QUOTE_LAYOUT_LIMITS.marginMm, null),
    left: check.number(margins, 'left', marginPath, QUOTE_LAYOUT_LIMITS.marginMm, null),
  };
  const page = {
    paper: check.choice(input, 'paper', '', QUOTE_LAYOUT_PAPERS, null),
    orientation: check.choice(input, 'orientation', '', QUOTE_LAYOUT_ORIENTATIONS, null),
    fontFamily: check.choice(input, 'fontFamily', '', QUOTE_LAYOUT_FONTS, null),
    fontSizePt: check.number(input, 'fontSizePt', '', QUOTE_LAYOUT_LIMITS.fontSizePt, null),
  };
  const rawBlocks = input['blocks'];
  const blocks: QuoteLayoutBlock[] = [];
  if (!Array.isArray(rawBlocks)) {
    check.fail('blocks', 'LAYOUT_INVALID', 'Bố cục thiếu danh sách khối.');
  } else if (rawBlocks.length < QUOTE_LAYOUT_LIMITS.minBlocks) {
    check.fail('blocks', 'LAYOUT_EMPTY', 'Bố cục cần ít nhất một khối.');
  } else if (rawBlocks.length > QUOTE_LAYOUT_LIMITS.maxBlocks) {
    check.fail('blocks', 'LAYOUT_TOO_MANY_BLOCKS', `Bố cục tối đa ${QUOTE_LAYOUT_LIMITS.maxBlocks} khối.`);
  } else {
    const ids = new Set<string>();
    rawBlocks.forEach((raw, index) => {
      const block = check.block(raw, index);
      if (!block) return;
      if (block.id && ids.has(block.id)) {
        check.fail(`blocks[${index}].id`, 'LAYOUT_DUPLICATE_ID', `Khối ${index + 1}: mã khối "${block.id}" bị trùng với khối khác.`);
      }
      ids.add(block.id);
      blocks.push(block);
    });
  }
  if (check.errors.length) return { ok: false, errors: trimRootPaths(check.errors) };
  const layout: QuoteLayout = { version: 1, ...page, marginsMm, blocks };
  if (utf8ByteLength(JSON.stringify(layout)) > QUOTE_LAYOUT_LIMITS.maxBytes) {
    return { ok: false, errors: [{ path: '', code: 'LAYOUT_TOO_LARGE', message: 'Bố cục quá lớn (tối đa 1 MB). Hãy giảm kích thước hoặc số ảnh.' }] };
  }
  return { ok: true, layout };
}

/** Đường dẫn ở cấp trang được dựng với tiền tố rỗng (`.paper`); bỏ dấu chấm đầu cho gọn. */
function trimRootPaths(errors: readonly QuoteLayoutError[]): QuoteLayoutError[] {
  return errors.map((error) => (error.path.startsWith('.') ? { ...error, path: error.path.slice(1) } : error));
}
