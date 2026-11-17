/**
 * @jest-environment jsdom
 */
import { fixtureCustomer, fixtureDetail, fixtureFullLayout } from './quote-layout.fixtures';
import { buildQuoteLayoutData } from './quote-layout.data';
import { QUOTE_PRINT_FRAME_ATTRIBUTE, exportQuotePdf } from './export-pdf';

jest.mock('./quote-layout.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[${QUOTE_PRINT_FRAME_ATTRIBUTE}]`));
const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer(), now: new Date(2026, 10, 6) });

describe('exportQuotePdf', () => {
  const print = jest.fn();
  const originalAppend = document.body.appendChild.bind(document.body);

  beforeEach(() => {
    print.mockReset();
    // jsdom không có hộp thoại in: thay `print`, `focus` của cửa sổ iframe ngay khi iframe được gắn vào trang.
    jest.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const appended = originalAppend(node);
      const frameWindow = node instanceof HTMLIFrameElement ? (node.contentWindow as (Window & typeof globalThis) | null) : null;
      if (frameWindow) {
        Object.assign(frameWindow, { print, focus: jest.fn() });
        // jsdom không tải ảnh: coi ảnh nhúng là đã tải xong.
        Object.defineProperty(frameWindow.HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
      }
      return appended;
    });
    const style = document.createElement('style');
    style.textContent = '.app { color: red; }';
    document.head.appendChild(style);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    frames().forEach((frame) => frame.remove());
    document.head.replaceChildren();
  });

  it('TC-EX-01, TC-EX-03: dựng bản in trong iframe ẩn, đặt tiêu đề, @page và gọi in; không mở cửa sổ mới', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    await exportQuotePdf({ layout: fixtureFullLayout(), data, fileName: 'BG2600001_v1' });
    expect(print).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    const [frame] = frames();
    expect(frame).toBeDefined();
    expect(frame.style.width).toBe('0px');
    const doc = frame.contentDocument as Document;
    expect(doc.title).toBe('BG2600001_v1');
    const css = Array.from(doc.head.querySelectorAll('style')).map((style) => style.textContent).join('\n');
    expect(css).toContain('.app { color: red; }');
    expect(css).toContain('@page { size: A4 portrait; margin: 15mm 15mm 15mm 20mm; }');
    expect(doc.body.querySelector('[data-mode="print"]')).not.toBeNull();
    expect(doc.body.textContent).toContain('BÁO GIÁ');
    expect(doc.body.textContent).toContain('1.980.000');
  });

  it('TC-EX-05: gỡ iframe sau afterprint (in hoặc huỷ), lần sau vẫn mở bình thường', async () => {
    await exportQuotePdf({ layout: fixtureFullLayout(), data, fileName: 'BG_v1' });
    const [frame] = frames();
    frame.contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(frames()).toHaveLength(0);
    await exportQuotePdf({ layout: fixtureFullLayout({ paper: 'A3', orientation: 'landscape' }), data, fileName: 'BG_v1' });
    expect(print).toHaveBeenCalledTimes(2);
    expect(frames()).toHaveLength(1);
    expect(Array.from(frames()[0].contentDocument?.querySelectorAll('style') ?? []).some((style) => style.textContent?.includes('size: A3 landscape'))).toBe(true);
  });

  it('TC-EX-05: iframe còn sót của lần trước bị gỡ khi in lần mới', async () => {
    await exportQuotePdf({ layout: fixtureFullLayout(), data, fileName: 'BG_v1' });
    await exportQuotePdf({ layout: fixtureFullLayout(), data, fileName: 'BG_v1' });
    expect(frames()).toHaveLength(1);
  });

  it('lỗi khi in: gỡ iframe và báo câu tiếng Việt', async () => {
    print.mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(exportQuotePdf({ layout: fixtureFullLayout(), data, fileName: 'BG_v1' })).rejects.toThrow('Không mở được bản in');
    expect(frames()).toHaveLength(0);
  });
});
