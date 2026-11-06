/**
 * Xuất bố cục in của báo giá ra Word (.docx) bằng thư viện `docx` (plan mục 10.2).
 *
 * Thư viện chỉ tải bằng `import('docx')` khi người dùng bấm xuất, để không nằm trong chunk đầu của trang. Mọi chữ đưa vào
 * Word qua `TextRun` dưới dạng chữ thuần; thư viện tự thoát ký tự XML.
 */
import {
  bindQuoteText,
  decodeBase64,
  type QuoteLayout,
  type QuoteLayoutAlign,
  type QuoteLayoutBlock,
  type QuoteLayoutCompanyHeaderBlock,
  type QuoteLayoutFieldGridBlock,
  type QuoteLayoutImageBlock,
  type QuoteLayoutLineTableBlock,
  type QuoteLayoutSignatureBlock,
  type QuoteLayoutSignatureParty,
  type QuoteLayoutTermsBlock,
  type QuoteLayoutTextBlock,
  type QuoteLayoutTitleBlock,
  type QuoteLayoutTotalsBlock,
} from '@enterprise-platform/contracts-crm';
import type * as Docx from 'docx';
import { QuoteExportError } from './export-error';
import { isEmbeddedImage, lineTableRows, visibleLineColumns } from './quote-layout-blocks';
import type { QuoteLayoutData } from './quote-layout.data';
import { quoteLayoutPageSize } from './quote-layout-view';

export type DocxModule = typeof Docx;

/** Câu báo khi không tải được thư viện (mất mạng, chunk lỗi). */
export const DOCX_LOAD_ERROR_MESSAGE = 'Không tải được bộ xuất Word. Kiểm tra mạng và thử lại.';


/** Tải `docx` theo nhu cầu; lỗi tải chunk đổi thành `QuoteExportError` với câu tiếng Việt. */
export async function loadDocx(): Promise<DocxModule> {
  try {
    return await import('docx');
  } catch (cause) {
    throw new QuoteExportError(DOCX_LOAD_ERROR_MESSAGE, { cause });
  }
}

/** 1 mm = 56,7 twip (plan mục 10.2). */
export const mmToTwip = (mm: number) => Math.round(mm * 56.7);
const MM_TO_PX = 96 / 25.4;
/** Ô bảng trong Word cần ít nhất một đoạn văn. */
const NO_TEXT = '';

/** Kích thước điểm ảnh của ảnh PNG hoặc JPEG đọc từ đầu file; không đọc được thì `null`. */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      }
      offset += 2 + length;
    }
  }
  return null;
}

interface DecodedImage {
  readonly type: 'png' | 'jpg';
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function decodeImage(src: string | undefined): DecodedImage | null {
  if (!isEmbeddedImage(src)) return null;
  const match = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(src);
  if (!match) return null;
  const bytes = decodeBase64(match[2]);
  if (!bytes) return null;
  const size = readImageSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { type: match[1] === 'png' ? 'png' : 'jpg', bytes, ...size };
}

/** Dựng `Document` của `docx` từ bố cục và dữ liệu (không tải file). Bảng hàng rỗng chỉ có hàng tiêu đề. */
export function createQuoteDocument(docx: DocxModule, layout: QuoteLayout, data: QuoteLayoutData): Docx.Document {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ImageRun,
    LineRuleType,
    PageOrientation,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlignTable,
    WidthType,
  } = docx;

  const page = quoteLayoutPageSize(layout);
  const portrait = layout.paper === 'A3' ? { width: 297, height: 420 } : { width: 210, height: 297 };
  const contentWidthMm = page.width - layout.marginsMm.left - layout.marginsMm.right;
  const contentTwips = mmToTwip(contentWidthMm);
  const halfPoints = (pt: number) => Math.round(pt * 2);

  const ALIGN: Readonly<Record<QuoteLayoutAlign, (typeof AlignmentType)[keyof typeof AlignmentType]>> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
  };
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const NO_BORDERS = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const GRID_BORDERS = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };

  const bind = (text: string) => bindQuoteText(text, data.values, 'view').normalize('NFC');

  /** Chữ thuần thành các `TextRun`; xuống dòng trong chữ thành ngắt dòng của Word. */
  const runs = (text: string, options: { bold?: boolean; italics?: boolean; underline?: boolean; size?: number; allCaps?: boolean } = {}) =>
    text.split(/\r?\n/).map(
      (part, index) =>
        new TextRun({
          text: part,
          ...(index > 0 ? { break: 1 } : {}),
          ...(options.bold ? { bold: true } : {}),
          ...(options.italics ? { italics: true } : {}),
          ...(options.underline ? { underline: {} } : {}),
          ...(options.size ? { size: options.size } : {}),
          ...(options.allCaps ? { allCaps: true } : {}),
        }),
    );

  const paragraph = (
    children: Docx.ParagraphChild[],
    options: { align?: QuoteLayoutAlign; before?: number; after?: number; keepNext?: boolean; indentLeft?: number; hanging?: number } = {},
  ) =>
    new Paragraph({
      children,
      ...(options.align ? { alignment: ALIGN[options.align] } : {}),
      spacing: { before: options.before ?? 0, after: options.after ?? 0 },
      ...(options.keepNext ? { keepNext: true } : {}),
      ...(options.indentLeft !== undefined ? { indent: { left: options.indentLeft, hanging: options.hanging ?? 0 } } : {}),
    });

  /** Đoạn rỗng cao đúng `heightMm` (khoảng cách trên của khối, khối khoảng trắng). */
  const gap = (heightMm: number) =>
    new Paragraph({
      children: [new TextRun({ text: NO_TEXT, size: 2 })],
      spacing: { before: 0, after: 0, line: Math.max(mmToTwip(heightMm), 20), lineRule: LineRuleType.EXACT },
    });

  const cell = (children: Array<Docx.Paragraph | Docx.Table>, widthTwips: number, extra: Partial<Docx.ITableCellOptions> = {}) =>
    new TableCell({
      children: children.length ? children : [paragraph([])],
      width: { size: widthTwips, type: WidthType.DXA },
      ...extra,
    });

  const plainTable = (rows: Docx.TableRow[], columnWidths: number[], align?: QuoteLayoutAlign) =>
    new Table({
      rows,
      columnWidths,
      width: { size: columnWidths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      ...(align ? { alignment: ALIGN[align] } : {}),
    });

  const imageRun = (image: DecodedImage, heightMm: number, maxWidthMm: number) => {
    let height = heightMm * MM_TO_PX;
    let width = (height * image.width) / image.height;
    const maxWidth = maxWidthMm * MM_TO_PX;
    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }
    return new ImageRun({
      type: image.type,
      data: image.bytes,
      transformation: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) },
    });
  };

  const imageBlock = (block: QuoteLayoutImageBlock) => {
    const image = decodeImage(block.src);
    return image ? [paragraph([imageRun(image, block.heightMm, contentWidthMm)], { align: block.align })] : [];
  };

  const companyHeader = (block: QuoteLayoutCompanyHeaderBlock) => {
    const text = [
      paragraph(runs(bind(block.name), { bold: true, size: halfPoints(layout.fontSizePt * 1.15) }), { align: block.align }),
      ...block.lines.map((item) => paragraph(runs(bind(item)), { align: block.align })),
    ];
    const logo = decodeImage(block.logo);
    if (!logo) return text;
    const logoWidthMm = Math.min(45, contentWidthMm / 3);
    const logoTwips = mmToTwip(logoWidthMm + 4);
    const textTwips = contentTwips - logoTwips;
    const logoCell = cell([paragraph([imageRun(logo, 22, logoWidthMm)], { align: block.logoPosition })], logoTwips, {
      verticalAlign: VerticalAlignTable.CENTER,
    });
    const textCell = cell(text, textTwips, { verticalAlign: VerticalAlignTable.CENTER });
    const cells = block.logoPosition === 'right' ? [textCell, logoCell] : [logoCell, textCell];
    const widths = block.logoPosition === 'right' ? [textTwips, logoTwips] : [logoTwips, textTwips];
    return [plainTable([new TableRow({ children: cells })], widths)];
  };

  const title = (block: QuoteLayoutTitleBlock) => [
    paragraph(runs(bind(block.text), { bold: true, size: halfPoints(block.fontSizePt), allCaps: block.uppercase }), { align: block.align }),
    ...(block.subtitle ? [paragraph(runs(bind(block.subtitle), { italics: true }), { align: block.align, before: mmToTwip(1) })] : []),
  ];

  const text = (block: QuoteLayoutTextBlock) => [
    paragraph(
      block.runs.flatMap((run) => runs(bind(run.text), { bold: run.bold, italics: run.italic, underline: run.underline })),
      { align: block.align },
    ),
  ];

  const fieldGrid = (block: QuoteLayoutFieldGridBlock) => {
    const pairTwips = Math.floor(contentTwips / block.columns);
    const labelTwips = Math.round((pairTwips * block.labelWidthPct) / 100);
    const valueTwips = pairTwips - labelTwips;
    const widths = Array.from({ length: block.columns }, () => [labelTwips, valueTwips]).flat();
    const rows: Docx.TableRow[] = [];
    for (let start = 0; start < block.items.length; start += block.columns) {
      const items = block.items.slice(start, start + block.columns);
      const cells = items.flatMap((item) => [
        cell([paragraph(runs(item.label ? `${bind(item.label)}:` : '', { bold: true }))], labelTwips),
        cell([paragraph(runs(bind(item.value)))], valueTwips),
      ]);
      while (cells.length < widths.length) cells.push(cell([], widths[cells.length]));
      rows.push(new TableRow({ children: cells }));
    }
    return rows.length ? [plainTable(rows, widths)] : [];
  };

  const lineTable = (block: QuoteLayoutLineTableBlock) => {
    const columns = visibleLineColumns(block);
    if (!columns.length) return [];
    const widths = columns.map((column) => Math.round((contentTwips * column.widthPct) / 100));
    const header = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: columns.map((column, index) =>
        cell([paragraph(runs(bind(column.label), { bold: true }), { align: 'center' })], widths[index], {
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
          verticalAlign: VerticalAlignTable.CENTER,
        }),
      ),
    });
    const body = lineTableRows(block, data.lines).map((row) => {
      if (row.kind === 'group') {
        return new TableRow({
          cantSplit: true,
          children: [
            cell([paragraph(runs(row.label, { bold: true }))], contentTwips, {
              columnSpan: columns.length,
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
            }),
          ],
        });
      }
      const shading = block.zebra && row.stripe ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F8FAFC' } } : {};
      return new TableRow({
        cantSplit: true,
        children: columns.map((column, index) =>
          cell([paragraph(runs(row.line.cells[column.key]), { align: column.align })], widths[index], shading),
        ),
      });
    });
    return [
      new Table({
        rows: [header, ...body],
        columnWidths: widths,
        width: { size: contentTwips, type: WidthType.DXA },
        layout: TableLayoutType.FIXED,
        borders: GRID_BORDERS,
      }),
    ];
  };

  const totals = (block: QuoteLayoutTotalsBlock) => {
    const visible = block.rows.filter((row) => row.visible);
    const tableTwips = Math.round(contentTwips * 0.55);
    const labelTwips = Math.round(tableTwips * 0.6);
    const valueTwips = tableTwips - labelTwips;
    const output: Array<Docx.Paragraph | Docx.Table> = [];
    if (visible.length) {
      output.push(
        plainTable(
          visible.map((row) => {
            const strong = row.key === 'grandTotal';
            return new TableRow({
              cantSplit: true,
              children: [
                cell([paragraph(runs(bind(row.label), { bold: strong }))], labelTwips),
                cell([paragraph(runs(data.totals[row.key], { bold: strong }), { align: 'right' })], valueTwips),
              ],
            });
          }),
          [labelTwips, valueTwips],
          block.align,
        ),
      );
    }
    if (block.showAmountInWords) {
      output.push(
        paragraph([new TextRun({ text: 'Số tiền bằng chữ: ', italics: true }), ...runs(data.amountInWords, { italics: true })], {
          align: block.align,
          before: mmToTwip(1.5),
        }),
      );
    }
    return output;
  };

  const terms = (block: QuoteLayoutTermsBlock) =>
    block.items.map((item, index) => {
      const prefix = block.numbered ? `${index + 1}. ` : '';
      const label = item.label ? `${bind(item.label)}: ` : '';
      return paragraph([...runs(prefix), ...runs(label, { bold: true }), ...runs(bind(item.value))], {
        before: mmToTwip(0.6),
        ...(block.numbered ? { indentLeft: mmToTwip(6), hanging: mmToTwip(6) } : {}),
      });
    });

  const signatureParty = (party: QuoteLayoutSignatureParty, heightMm: number, widthTwips: number) =>
    cell(
      [
        paragraph(runs(bind(party.title), { bold: true }), { align: 'center', keepNext: true }),
        ...(party.subtitle ? [paragraph(runs(bind(party.subtitle), { italics: true }), { align: 'center', keepNext: true })] : []),
        new Paragraph({
          children: [new TextRun({ text: NO_TEXT, size: 2 })],
          keepNext: true,
          spacing: { before: 0, after: 0, line: mmToTwip(heightMm), lineRule: LineRuleType.EXACT },
        }),
        ...(party.name ? [paragraph(runs(bind(party.name), { bold: true }), { align: 'center' })] : []),
      ],
      widthTwips,
    );

  const signature = (block: QuoteLayoutSignatureBlock) => {
    const half = Math.floor(contentTwips / 2);
    return [
      plainTable(
        [
          new TableRow({
            cantSplit: true,
            children: [signatureParty(block.left, block.heightMm, half), signatureParty(block.right, block.heightMm, contentTwips - half)],
          }),
        ],
        [half, contentTwips - half],
      ),
    ];
  };

  const divider = (thicknessPt: number, style: 'solid' | 'dashed') =>
    new Paragraph({
      children: [],
      spacing: { before: 0, after: mmToTwip(1) },
      border: {
        bottom: { style: style === 'dashed' ? BorderStyle.DASHED : BorderStyle.SINGLE, size: Math.max(2, Math.round(thicknessPt * 8)), color: '000000', space: 1 },
      },
    });

  const blockChildren = (block: QuoteLayoutBlock): Array<Docx.Paragraph | Docx.Table> => {
    switch (block.type) {
      case 'image':
        return imageBlock(block);
      case 'companyHeader':
        return companyHeader(block);
      case 'title':
        return title(block);
      case 'text':
        return text(block);
      case 'fieldGrid':
        return fieldGrid(block);
      case 'lineTable':
        return lineTable(block);
      case 'totals':
        return totals(block);
      case 'terms':
        return terms(block);
      case 'signature':
        return signature(block);
      case 'spacer':
        return [gap(block.heightMm)];
      case 'divider':
        return [divider(block.thicknessPt, block.style)];
      default:
        return [];
    }
  };

  const children: Array<Docx.Paragraph | Docx.Table> = [];
  for (const block of layout.blocks) {
    if (block.marginTopMm) children.push(gap(block.marginTopMm));
    children.push(...blockChildren(block));
  }
  // Word cần đoạn văn sau bảng cuối cùng của tài liệu.
  if (!children.length || children[children.length - 1] instanceof Table) children.push(paragraph([]));

  return new Document({
    creator: 'Enterprise Platform CRM',
    title: bind('{{quote.code}}') || 'Báo giá',
    styles: {
      default: {
        document: {
          run: { font: layout.fontFamily, size: halfPoints(layout.fontSizePt) },
          paragraph: { spacing: { before: 0, after: 0 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: mmToTwip(portrait.width),
              height: mmToTwip(portrait.height),
              orientation: layout.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: mmToTwip(layout.marginsMm.top),
              right: mmToTwip(layout.marginsMm.right),
              bottom: mmToTwip(layout.marginsMm.bottom),
              left: mmToTwip(layout.marginsMm.left),
            },
          },
        },
        children,
      },
    ],
  });
}

/** Dựng file `.docx` (Blob). `load` để thay bộ tải thư viện khi kiểm thử. */
export async function buildQuoteDocx(
  layout: QuoteLayout,
  data: QuoteLayoutData,
  load: () => Promise<DocxModule> = loadDocx,
): Promise<Blob> {
  let docx: DocxModule;
  try {
    docx = await load();
  } catch (cause) {
    throw cause instanceof QuoteExportError ? cause : new QuoteExportError(DOCX_LOAD_ERROR_MESSAGE, { cause });
  }
  return docx.Packer.toBlob(createQuoteDocument(docx, layout, data));
}

/** Tải Blob xuống bằng thẻ `<a download>`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportQuoteDocxOptions {
  readonly layout: QuoteLayout;
  readonly data: QuoteLayoutData;
  /** Tên file không có đuôi, ví dụ `BG2600001_v2`. */
  readonly fileName: string;
  readonly load?: () => Promise<DocxModule>;
}

/** Sinh và tải `<fileName>.docx`. Lỗi tải thư viện: `QuoteExportError` với `DOCX_LOAD_ERROR_MESSAGE`. */
export async function exportQuoteDocx({ layout, data, fileName, load }: ExportQuoteDocxOptions): Promise<void> {
  const blob = await buildQuoteDocx(layout, data, load);
  downloadBlob(blob, `${fileName}.docx`);
}
