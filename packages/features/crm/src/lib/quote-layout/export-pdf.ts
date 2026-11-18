/**
 * Xuất PDF bằng lệnh in của trình duyệt qua iframe ẩn (plan mục 10.1).
 *
 * Dựng `QuoteLayoutView mode="print"` vào iframe, chép stylesheet của trang, thêm `@page` theo khổ và lề, chờ ảnh và font,
 * đặt `<title>` bằng tên file (để "Lưu thành PDF" gợi ý đúng tên) rồi gọi `print()`. Không mở cửa sổ mới nên trình chặn
 * popup không ảnh hưởng. Iframe được gỡ sau `afterprint`, hoặc sau 60 giây nếu trình duyệt không báo.
 */
import type { QuoteLayout } from '@enterprise-platform/contracts-crm';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QuoteExportError } from './export-error';
import { QuoteLayoutView, quoteLayoutPageCss } from './quote-layout-view';
import type { QuoteLayoutData } from './quote-layout.data';

/** Đánh dấu iframe in để gỡ iframe còn sót của lần in trước. */
export const QUOTE_PRINT_FRAME_ATTRIBUTE = 'data-quote-print-frame';
export const QUOTE_PRINT_CLEANUP_MS = 60_000;
const STYLESHEET_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 10_000;

export const PDF_EXPORT_ERROR_MESSAGE = 'Không mở được bản in. Tải lại trang và thử lại.';

export interface ExportQuotePdfOptions {
  readonly layout: QuoteLayout;
  readonly data: QuoteLayoutData;
  /** Tên file không có đuôi, ví dụ `BG2600001_v2`. */
  readonly fileName: string;
}

const withTimeout = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]).then(() => undefined);

function waitForEvent(target: HTMLElement, done: () => boolean): Promise<void> {
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      target.removeEventListener('load', finish);
      target.removeEventListener('error', finish);
      resolve();
    };
    target.addEventListener('load', finish);
    target.addEventListener('error', finish);
  });
}

/** Chép `<style>` và `<link rel="stylesheet">` của trang sang iframe; chờ stylesheet ngoài tải xong. */
async function copyStylesheets(source: Document, target: Document): Promise<void> {
  const pending: Array<Promise<void>> = [];
  source.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const copy = target.importNode(node, true) as HTMLElement;
    target.head.appendChild(copy);
    if (copy.tagName === 'LINK') {
      pending.push(waitForEvent(copy, () => !!(copy as HTMLLinkElement).sheet));
    }
  });
  await withTimeout(Promise.all(pending), STYLESHEET_TIMEOUT_MS);
}

async function waitForAssets(target: Document): Promise<void> {
  const images = Array.from(target.images).map((image) => waitForEvent(image, () => image.complete));
  await withTimeout(Promise.all(images), IMAGE_TIMEOUT_MS);
  const fonts = (target as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) await withTimeout(fonts.ready, IMAGE_TIMEOUT_MS);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Gỡ iframe in còn sót (ví dụ trình duyệt không báo `afterprint`). */
export function removeQuotePrintFrames(doc: Document = document): void {
  doc.querySelectorAll(`iframe[${QUOTE_PRINT_FRAME_ATTRIBUTE}]`).forEach((frame) => frame.remove());
}

/**
 * Mở hộp thoại in của trình duyệt cho bố cục. Trả về khi đã gọi `print()`; iframe tự gỡ sau khi in hoặc huỷ.
 * Lỗi dựng trang: `QuoteExportError` với câu tiếng Việt.
 */
export async function exportQuotePdf({ layout, data, fileName }: ExportQuotePdfOptions): Promise<void> {
  removeQuotePrintFrames();
  const iframe = document.createElement('iframe');
  iframe.setAttribute(QUOTE_PRINT_FRAME_ATTRIBUTE, '');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.title = fileName;
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new QuoteExportError(PDF_EXPORT_ERROR_MESSAGE);
  }

  let root: ReturnType<typeof createRoot> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer) clearTimeout(timer);
    frameWindow.removeEventListener('afterprint', cleanup);
    root?.unmount();
    iframe.remove();
  };

  try {
    frameDocument.documentElement.lang = 'vi';
    const charset = frameDocument.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    frameDocument.head.appendChild(charset);
    frameDocument.title = fileName;
    await copyStylesheets(document, frameDocument);
    const pageStyle = frameDocument.createElement('style');
    pageStyle.textContent = `${quoteLayoutPageCss(layout)}\nhtml, body { margin: 0; padding: 0; background: #ffffff; }`;
    frameDocument.head.appendChild(pageStyle);

    const container = frameDocument.createElement('div');
    frameDocument.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    flushSync(() => mounted.render(createElement(QuoteLayoutView, { layout, data, mode: 'print' })));
    await waitForAssets(frameDocument);

    frameWindow.addEventListener('afterprint', cleanup);
    timer = setTimeout(cleanup, QUOTE_PRINT_CLEANUP_MS);
    frameWindow.focus();
    frameWindow.print();
  } catch (cause) {
    cleanup();
    throw cause instanceof QuoteExportError ? cause : new QuoteExportError(PDF_EXPORT_ERROR_MESSAGE, { cause });
  }
}
