import { createDocument, createShape, DEFAULT_PALETTE, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextEncoder as NodeTextEncoder } from 'node:util';
import { copyText, downloadBlob } from './download';
import { ExportDialog } from './export-dialog';
import { svgToPng } from './rasterize';

jest.mock('./download', () => ({ downloadBlob: jest.fn(), copyText: jest.fn() }));
jest.mock('./rasterize', () => ({ svgToPng: jest.fn() }));

// jsdom không có TextEncoder (trình duyệt thật thì có); createZip cần nó khi chạy trong test.
if (typeof globalThis.TextEncoder === 'undefined') Object.assign(globalThis, { TextEncoder: NodeTextEncoder });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function makeDoc(id: string, name: string): IconDocument {
  return createDocument({
    id,
    name,
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
  });
}

const one = [makeDoc('a', 'Nhà kho')];
const two = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];

function setup(docs: readonly IconDocument[], open = true) {
  const onClose = jest.fn();
  render(<ExportDialog docs={docs} onClose={onClose} open={open} palette={DEFAULT_PALETTE} />);
  return { onClose };
}

const chip = (name: string) => screen.getByRole('checkbox', { name });
const downloadButton = () => screen.getByRole('button', { name: /Tải về|Đang xử lý/ }) as HTMLButtonElement;

beforeEach(() => {
  jest.mocked(downloadBlob).mockReset();
  jest.mocked(copyText).mockReset().mockResolvedValue(true);
  jest.mocked(svgToPng).mockReset().mockImplementation(async () => new Uint8Array([...PNG, 1]));
});

describe('ExportDialog', () => {
  it('đóng thì không vẽ gì', () => {
    setup(one, false);
    expect(screen.queryByText('Xuất icon')).toBeNull();
  });

  it('mở: có tiêu đề, tên icon, mặc định chọn SVG và liệt kê tệp', async () => {
    setup(one);
    expect(screen.getByText('Xuất icon')).toBeTruthy();
    expect(screen.getByText('Nhà kho', { selector: 'p' })).toBeTruthy();
    expect(chip('SVG').getAttribute('aria-checked')).toBe('true');
    expect(chip('React TSX').getAttribute('aria-checked')).toBe('false');
    expect(await screen.findByText('1 tệp')).toBeTruthy();
    expect(screen.getAllByText('svg/nha-kho.svg').length).toBeGreaterThan(0);
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
  });

  it('bật thêm định dạng thì danh sách và số tệp đổi theo', async () => {
    setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(chip('React TSX'));
    expect(await screen.findByText('3 tệp')).toBeTruthy();
    expect(screen.getByText('react/nha-kho.tsx')).toBeTruthy();
    expect(screen.getByText('react/index.ts')).toBeTruthy();
    expect(screen.getByText('svndts-nha-kho.zip')).toBeTruthy();
  });

  it('xuất một icon có xem trước và nút Sao chép cho SVG rồi TSX', async () => {
    setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(screen.getByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect(jest.mocked(copyText).mock.calls[0][0]).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(await screen.findByText('Đã chép')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'TSX' }));
    fireEvent.click(screen.getByRole('button', { name: /Sao chép/ }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(2));
    expect(jest.mocked(copyText).mock.calls[1][0]).toContain('export function NhaKhoIcon(');
  });

  it('sao chép thất bại thì báo lỗi', async () => {
    jest.mocked(copyText).mockResolvedValue(false);
    setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(screen.getByRole('button', { name: /Sao chép/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không sao chép được');
  });

  it('nhiều icon: không có xem trước, tải về dạng zip', async () => {
    setup(two);
    expect(await screen.findByText('2 tệp')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'SVG' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sao chép/ })).toBeNull();
    expect(screen.getByText('svndts-icons.zip')).toBeTruthy();
  });

  it('chọn icon cho favicon chỉ hiện khi xuất nhiều icon và có chọn Favicon', async () => {
    setup(two);
    await screen.findByText('2 tệp');
    expect(screen.queryByText('Icon favicon')).toBeNull();
    fireEvent.click(chip('Favicon'));
    expect(await screen.findByText('Icon favicon')).toBeTruthy();
    expect(await screen.findByText('favicon/favicon.ico')).toBeTruthy();
  });

  it('một icon thì không cần chọn icon favicon', async () => {
    setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(chip('Favicon'));
    expect(await screen.findByText('favicon/favicon.ico')).toBeTruthy();
    expect(screen.queryByText('Icon favicon')).toBeNull();
  });

  it('chỉ chọn JSON hoặc Favicon thì khoá chế độ màu', async () => {
    setup(one);
    await screen.findByText('1 tệp');
    const radio = () => screen.getByRole('radio', { name: 'Màu thương hiệu' }) as HTMLButtonElement;
    expect(radio().disabled).toBe(false);
    fireEvent.click(chip('JSON'));
    fireEvent.click(chip('SVG'));
    await waitFor(() => expect(radio().disabled).toBe(true));
  });

  it('chưa chọn định dạng nào thì không tải được và có cảnh báo', async () => {
    setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(chip('SVG'));
    expect(await screen.findByText('0 tệp')).toBeTruthy();
    expect(screen.getByText('Chưa chọn định dạng nào.')).toBeTruthy();
    expect(downloadButton().disabled).toBe(true);
  });

  it('hiện cảnh báo tên trùng', async () => {
    setup([makeDoc('a', 'Home'), makeDoc('b', 'Home')]);
    expect(await screen.findByText(/trùng với icon khác/)).toBeTruthy();
    expect(screen.getByText('svg/home-2.svg')).toBeTruthy();
  });

  it('một tệp: tải thẳng, rồi đóng hộp thoại', async () => {
    const { onClose } = setup(one);
    await screen.findByText('1 tệp');
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
    fireEvent.click(downloadButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith('nha-kho.svg', expect.stringContaining('<svg'), 'image/svg+xml');
  });

  it('nhiều tệp: tải gói zip', async () => {
    const { onClose } = setup(two);
    await screen.findByText('2 tệp');
    fireEvent.click(downloadButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith('svndts-icons.zip', expect.any(Uint8Array), 'application/zip');
  });

  it('đang xử lý thì khoá nút và hiện trạng thái, vẽ ảnh bằng bộ vẽ thật', async () => {
    let release: (bytes: Uint8Array) => void = () => undefined;
    jest.mocked(svgToPng).mockImplementation(
      (_svg, size) => (size === 16 ? new Promise<Uint8Array>((resolve) => (release = resolve)) : Promise.resolve(new Uint8Array([...PNG, 1]))),
    );
    const { onClose } = setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(chip('SVG'));
    fireEvent.click(chip('Favicon'));
    await screen.findByText('favicon/favicon.ico');
    fireEvent.click(downloadButton());

    await waitFor(() => expect(screen.getByRole('button', { name: /Đang xử lý/ })).toBeTruthy());
    expect(downloadButton().disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    release(new Uint8Array([...PNG, 2]));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith('svndts-favicon.zip', expect.any(Uint8Array), 'application/zip');
    expect(jest.mocked(svgToPng).mock.calls.map((call) => call[1])).toEqual([16, 32, 48, 180, 192, 512]);
  });

  it('một ảnh vẽ lỗi: vẫn tải phần còn lại, giữ hộp thoại mở và hiện cảnh báo', async () => {
    jest.mocked(svgToPng).mockImplementation(async (_svg, size) => {
      if (size === 512) throw new Error('hết bộ nhớ');
      return new Uint8Array([...PNG, 1]);
    });
    const { onClose } = setup(one);
    await screen.findByText('1 tệp');
    fireEvent.click(chip('SVG'));
    fireEvent.click(chip('Favicon'));
    await screen.findByText('favicon/favicon.ico');
    fireEvent.click(downloadButton());

    expect(await screen.findByText('Đã tải về')).toBeTruthy();
    expect(screen.getByText('Không tạo được ảnh 512px: hết bộ nhớ')).toBeTruthy();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Nút đóng ở tiêu đề và nút "Đóng" ở chân (thay cho "Hủy" sau khi đã tải).
    expect(screen.getAllByRole('button', { name: 'Đóng' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Hủy' })).toBeNull();
  });

  it('xuất lỗi hẳn thì báo lỗi, không tải', async () => {
    jest.mocked(downloadBlob).mockImplementation(() => {
      throw new Error('bị chặn tải');
    });
    const { onClose } = setup(one);
    await screen.findByText('1 tệp');
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
    fireEvent.click(downloadButton());
    expect((await screen.findByRole('alert')).textContent).toBe('bị chặn tải');
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
  });
});
