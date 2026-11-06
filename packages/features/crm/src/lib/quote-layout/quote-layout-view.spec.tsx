/**
 * @jest-environment jsdom
 */
import { QUOTE_LAYOUT_BLOCK_TYPES, validateQuoteLayout, type QuoteLayout } from '@enterprise-platform/contracts-crm';
import { fireEvent, render, screen } from '@testing-library/react';
import { fixtureCustomer, fixtureDetail, fixtureFullLayout, fixtureLine, fixtureVersion, FIXTURE_XSS } from './quote-layout.fixtures';
import { buildQuoteLayoutData, emptyQuoteLayoutData, sampleQuoteLayoutData } from './quote-layout.data';
import { QuoteLayoutView, estimatePageBreaks, quoteLayoutPageCss, quoteLayoutPageSize } from './quote-layout-view';

jest.mock('./quote-layout.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const now = new Date(2026, 10, 6);
const data = () => buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer(), people: [{ userId: 'u1', displayName: 'Nguyễn Văn An' }], now });
const blocksOf = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-block-type]'));

describe('QuoteLayoutView', () => {
  it('bố cục thử hợp lệ và có đủ 11 loại khối', () => {
    const layout = fixtureFullLayout();
    expect(validateQuoteLayout(layout).ok).toBe(true);
    expect(new Set(layout.blocks.map((block) => block.type))).toEqual(new Set(QUOTE_LAYOUT_BLOCK_TYPES));
  });

  it.each(['design', 'preview', 'print'] as const)('TC-RD-04: dựng đủ 11 loại khối ở chế độ %s', (mode) => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const layout = fixtureFullLayout();
    const { container } = render(<QuoteLayoutView layout={layout} data={data()} mode={mode} />);
    expect(blocksOf(container).map((element) => element.dataset.blockType)).toEqual(layout.blocks.map((block) => block.type));
    expect(screen.getByText('TÊN CÔNG TY')).toBeTruthy();
    expect(screen.getByText('BÁO GIÁ')).toBeTruthy();
    expect(screen.getAllByText('Máy bơm').length).toBe(1);
    expect(screen.getByText('ĐẠI DIỆN BÊN BÁN')).toBeTruthy();
    expect(container.textContent).toContain('1.980.000');
    expect(container.textContent).toContain('Một triệu chín trăm tám mươi nghìn đồng');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('căn lề theo khối', () => {
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={data()} mode="preview" />);
    expect(container.querySelector('[data-block-id="logo"] > div')?.className).toContain('alignCenter');
    expect(container.querySelector('[data-block-id="title"] > div')?.className).toContain('alignCenter');
    expect(container.querySelector('[data-block-id="totals"] > div')?.className).toContain('alignRight');
  });

  it('TC-RD-05: khổ và hướng giấy', () => {
    expect(quoteLayoutPageSize({ paper: 'A4', orientation: 'portrait' })).toEqual({ width: 210, height: 297 });
    expect(quoteLayoutPageSize({ paper: 'A4', orientation: 'landscape' })).toEqual({ width: 297, height: 210 });
    expect(quoteLayoutPageSize({ paper: 'A3', orientation: 'portrait' })).toEqual({ width: 297, height: 420 });
    expect(quoteLayoutPageSize({ paper: 'A3', orientation: 'landscape' })).toEqual({ width: 420, height: 297 });
    const { container } = render(
      <QuoteLayoutView layout={fixtureFullLayout({ paper: 'A3', orientation: 'landscape' })} data={data()} mode="preview" />,
    );
    const sheet = container.querySelector<HTMLElement>('[data-paper]');
    expect(sheet?.style.width).toBe('420mm');
    expect(sheet?.style.minHeight).toBe('297mm');
    expect(sheet?.style.padding).toBe('15mm 15mm 15mm 20mm');
    expect(sheet?.style.fontFamily).toContain('Times New Roman');
    expect(sheet?.style.fontSize).toBe('12pt');
  });

  it('TC-RD-05: thu phóng vừa bề ngang khung', () => {
    const width = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(397);
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={data()} mode="preview" />);
    width.mockRestore();
    const viewport = container.firstElementChild as HTMLElement;
    // 210 mm = 793,7 px; khung 397 px → khoảng 0,5.
    expect(Number(viewport.dataset.scale)).toBeCloseTo(0.5, 2);
    expect((container.querySelector('[data-paper]') as HTMLElement).style.transform).toMatch(/^scale\(0\.5/);
  });

  it('TC-RD-06: thiết kế hiện chip biến rỗng, xem trước không lộ cú pháp biến', () => {
    const layout = fixtureFullLayout();
    const design = render(<QuoteLayoutView layout={layout} data={emptyQuoteLayoutData()} mode="design" />);
    const chip = design.container.querySelector('[data-variable="customer.name"]');
    expect(chip?.textContent).toBe('{{customer.name}}');
    design.unmount();
    const preview = render(<QuoteLayoutView layout={layout} data={emptyQuoteLayoutData()} mode="preview" />);
    expect(preview.container.textContent).not.toMatch(/\{\{[a-z]/);
    expect(preview.container.querySelector('[data-variable]')).toBeNull();
  });

  it('thiết kế có dữ liệu mẫu: chip hiện giá trị', () => {
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={sampleQuoteLayoutData([], now)} mode="design" />);
    expect(container.querySelector('[data-variable="customer.name"]')?.textContent).toBe('Công ty TNHH Xây dựng Minh Phát');
  });

  it('D3-13: biến lạ giữ nguyên văn ở xem trước', () => {
    const layout: QuoteLayout = { ...fixtureFullLayout(), blocks: [{ id: 't', type: 'text', align: 'left', runs: [{ text: 'A {{ quote.code }} {{{quote.code}}}' }] }] };
    const { container } = render(<QuoteLayoutView layout={layout} data={data()} mode="preview" />);
    expect(container.textContent).toContain('A {{ quote.code }} {{{quote.code}}}');
  });

  it('TC-RD-07: chuỗi HTML hiện nguyên văn, không sinh thẻ script hay img từ dữ liệu', () => {
    const detail = fixtureDetail(fixtureVersion({ lines: [fixtureLine({ materialName: '<img src=x onerror=alert(1)>' })] }));
    const xssData = buildQuoteLayoutData({ detail, customer: fixtureCustomer({ name: FIXTURE_XSS }), now });
    const layout = fixtureFullLayout();
    const withExternal: QuoteLayout = { ...layout, blocks: [...layout.blocks, { id: 'ext', type: 'image', src: 'https://example.com/a.png', heightMm: 10, align: 'left' }] };
    for (const mode of ['design', 'preview', 'print'] as const) {
      const { container, unmount } = render(<QuoteLayoutView layout={withExternal} data={xssData} mode={mode} />);
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('b')).toBeNull();
      // Chỉ có ảnh nhúng của khối logo; ảnh đường dẫn ngoài và chuỗi trong dữ liệu không thành thẻ img.
      const images = Array.from(container.querySelectorAll('img'));
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      expect(container.textContent).toContain(FIXTURE_XSS);
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
      unmount();
    }
  });

  it('TC-RD-09: bảng rỗng có dòng "Chưa có dòng hàng" khi xem, chỉ có tiêu đề khi in', () => {
    const empty = buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines: [] })), now });
    const preview = render(<QuoteLayoutView layout={fixtureFullLayout()} data={empty} mode="preview" />);
    expect(preview.getByText('Chưa có dòng hàng')).toBeTruthy();
    preview.unmount();
    const print = render(<QuoteLayoutView layout={fixtureFullLayout()} data={empty} mode="print" />);
    expect(print.queryByText('Chưa có dòng hàng')).toBeNull();
    const table = print.container.querySelector('[data-block-type="lineTable"] table') as HTMLTableElement;
    expect(table.tHead?.rows).toHaveLength(1);
    expect(table.tBodies[0].rows).toHaveLength(0);
  });

  it('TC-RD-09: 200 dòng đủ và đúng thứ tự', () => {
    const lines = Array.from({ length: 200 }, (_, index) => fixtureLine({ id: `l${index}`, materialName: `Hàng ${index + 1}` }));
    const long = buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines })), now });
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={long} mode="preview" />);
    const rows = Array.from(container.querySelectorAll('[data-block-type="lineTable"] tbody tr'));
    expect(rows).toHaveLength(200);
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(lines.map((_, index) => String(index + 1)));
    expect(rows[199].textContent).toContain('Hàng 200');
  });

  it('bảng: cột ẩn không hiện, nhóm theo nhóm hàng, độ rộng chuẩn hoá', () => {
    const layout = fixtureFullLayout();
    const grouped: QuoteLayout = {
      ...layout,
      blocks: layout.blocks.map((block) => (block.type === 'lineTable' ? { ...block, showGroupByCategory: true } : block)),
    };
    const lines = [fixtureLine({ id: 'a', category: 'Thiết bị' }), fixtureLine({ id: 'b', category: 'Vật tư' })];
    const { container } = render(
      <QuoteLayoutView layout={grouped} data={buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines })), now })} mode="preview" />,
    );
    const headers = Array.from(container.querySelectorAll('[data-block-type="lineTable"] th')).map((th) => th.textContent);
    expect(headers).toEqual(['TT', 'Tên hàng hoá, dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'VAT (%)', 'Thành tiền', 'Tổng cộng']);
    expect(Array.from(container.querySelectorAll('tr.groupRow')).map((row) => row.textContent)).toEqual(['Thiết bị', 'Vật tư']);
    const widths = Array.from(container.querySelectorAll('col')).map((col) => parseFloat((col as HTMLElement).style.width));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5);
  });

  it('TC-RD-10: ký tự đặc biệt và tiếng Việt tổ hợp hiện đúng', () => {
    const name = 'Hoà & <Bình> 😀'.normalize('NFD');
    const special = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer({ name }), now });
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={special} mode="preview" />);
    expect(container.textContent).toContain('Hoà & <Bình> 😀'.normalize('NFC'));
  });

  it('chế độ thiết kế: chọn khối, bỏ chọn, phần thêm của trình thiết kế', () => {
    const onSelect = jest.fn();
    const chrome = jest.fn(() => <span>thanh công cụ</span>);
    const { container } = render(
      <QuoteLayoutView
        layout={fixtureFullLayout()}
        data={data()}
        mode="design"
        selectedId="title"
        onSelect={onSelect}
        renderBlockChrome={chrome}
        blockProps={() => ({ draggable: true })}
      />,
    );
    const title = container.querySelector('[data-block-id="title"]') as HTMLElement;
    expect(title.className).toContain('blockSelected');
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(title.getAttribute('draggable')).toBe('true');
    fireEvent.click(container.querySelector('[data-block-id="terms"]') as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith('terms');
    fireEvent.keyDown(container.querySelector('[data-block-id="signature"]') as HTMLElement, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('signature');
    fireEvent.click(container.querySelector('[data-paper]') as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(chrome).toHaveBeenCalledWith(expect.objectContaining({ id: 'title' }), { index: 3, selected: true });
    expect(screen.getAllByText('thanh công cụ')).toHaveLength(fixtureFullLayout().blocks.length);
  });

  it('xem trước và in: khối không bấm chọn được', () => {
    const { container } = render(<QuoteLayoutView layout={fixtureFullLayout()} data={data()} mode="preview" selectedId="title" />);
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.querySelector('.blockSelected')).toBeNull();
  });
});

describe('ngắt trang và @page', () => {
  const layout = fixtureFullLayout();

  it('TC-RD-11: vạch ngắt trang ước lượng theo chiều cao trang trừ lề', () => {
    // A4 đứng, lề trên 15, dưới 15: mỗi trang chứa 267 mm.
    expect(estimatePageBreaks(297, layout)).toEqual([]);
    expect(estimatePageBreaks(600, layout)).toEqual([282, 549]);
  });

  it('TC-EX-04: luật @page theo khổ, hướng, lề', () => {
    expect(quoteLayoutPageCss(layout)).toBe('@page { size: A4 portrait; margin: 15mm 15mm 15mm 20mm; }');
    expect(quoteLayoutPageCss({ ...layout, paper: 'A3', orientation: 'landscape' })).toContain('size: A3 landscape');
  });
});
