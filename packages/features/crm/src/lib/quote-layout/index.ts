/**
 * Dựng trang và xuất file của bố cục in báo giá (phase 3, chương C2). Trình thiết kế (C3) và màn báo giá (C4) chỉ dùng
 * qua các export ở đây.
 */
export {
  buildQuoteLayoutData,
  customFieldVariable,
  emptyQuoteLayoutData,
  formatLocalDate,
  quoteExportFileName,
  sampleQuoteLayoutData,
  type BuildQuoteLayoutDataInput,
  type QuoteLayoutData,
  type QuoteLayoutLineRow,
  type QuoteLayoutPerson,
} from './quote-layout.data';
export {
  QuoteLayoutView,
  estimatePageBreaks,
  quoteLayoutFontStack,
  quoteLayoutPageCss,
  quoteLayoutPageSize,
  type QuoteLayoutBlockChromeInfo,
  type QuoteLayoutViewMode,
  type QuoteLayoutViewProps,
} from './quote-layout-view';
export { BoundText, QUOTE_LAYOUT_BLOCK_LABELS, QUOTE_LAYOUT_EMPTY_LINES_TEXT, isEmbeddedImage } from './quote-layout-blocks';
export { ExportMenu, type ExportMenuProps, type QuoteExportFormat } from './export-menu';
export { exportQuotePdf, removeQuotePrintFrames, type ExportQuotePdfOptions } from './export-pdf';
export { DOCX_LOAD_ERROR_MESSAGE, exportQuoteDocx, type ExportQuoteDocxOptions } from './export-docx';
export { QuoteExportError } from './export-error';
