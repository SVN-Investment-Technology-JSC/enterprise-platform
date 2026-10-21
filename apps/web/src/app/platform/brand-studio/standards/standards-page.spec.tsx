import { DEFAULT_PALETTE, DEFAULT_RULES } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { downloadTextFile } from '../library/file-download';
import { localStore } from '../store/local-store';
import { StandardsPage } from './standards-page';

jest.mock('../library/file-download', () => ({
  ...jest.requireActual('../library/file-download'),
  downloadTextFile: jest.fn(),
}));

const rows = () => screen.queryAllByTestId('palette-row');
const rowOf = (label: string) => rows().find((row) => within(row).queryByLabelText(`Tên màu ${label}`)) as HTMLElement;
const tokens = () => localStore.getSnapshot().palette.tokens;
const rules = () => localStore.getSnapshot().rules;

function commit(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function confirmIn(title: string, button: string) {
  const popup = screen.getByText(title).closest('[class*="popconfirmPopup"]') as HTMLElement;
  fireEvent.click(within(popup).getByRole('button', { name: button }));
  return popup;
}

beforeEach(() => {
  window.localStorage.clear();
  jest.mocked(downloadTextFile).mockReset();
  localStore.reloadForTest();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('StandardsPage: hiển thị', () => {
  it('hiện bảng màu và quy chuẩn mặc định', () => {
    render(<StandardsPage />);
    expect(screen.getByRole('heading', { name: 'Bảng màu & quy chuẩn' })).toBeTruthy();
    expect(rows()).toHaveLength(DEFAULT_PALETTE.tokens.length);
    expect(screen.getAllByTestId('stroke-chip').map((chip) => chip.textContent)).toEqual(['1,5', '1,75', '2']);
    expect((screen.getByLabelText('Bước bắt dính') as HTMLInputElement).value).toBe('0,5');
    expect((screen.getByLabelText('Số lớp tối đa') as HTMLInputElement).value).toBe('12');
    expect(screen.getByRole('switch', { name: 'Bắt buộc dùng màu trong bảng' }).getAttribute('aria-checked')).toBe('true');
  });

  it('không hiện ghi chú về bảng màu tạm', () => {
    render(<StandardsPage />);
    expect(screen.queryByText(/chờ ban lãnh đạo chốt/)).toBeNull();
  });

  it('cho biết màu nào đang được icon dùng và màu nào chưa', () => {
    render(<StandardsPage />);
    expect(rowOf('Xanh Sapphire').textContent).toContain('4 icon dùng');
    expect(rowOf('Xanh đen').textContent).toContain('chưa dùng');
  });

  it('khi chạy phía máy chủ chỉ có khung chờ', () => {
    expect(renderToString(<StandardsPage />)).toContain('Đang tải cài đặt');
  });

  it('xem trước icon mẫu theo bảng màu và đổi theo khi sửa màu', () => {
    render(<StandardsPage />);
    const preview = screen.getByTestId('palette-preview');
    expect(preview.querySelectorAll('svg').length).toBeGreaterThan(0);

    commit(within(rowOf('Xanh Sapphire')).getByLabelText('Mã hex Xanh Sapphire'), '#ff0000');
    expect(screen.getByTestId('palette-preview').innerHTML).toContain('#ff0000');
  });
});

describe('StandardsPage: bảng màu', () => {
  it('sửa mã hex lưu ngay vào bảng màu', () => {
    render(<StandardsPage />);
    const input = within(rowOf('Xanh Sapphire')).getByLabelText('Mã hex Xanh Sapphire') as HTMLInputElement;

    commit(input, '#FF0000');

    expect(tokens()[0]).toEqual({ key: 'sapphire', label: 'Xanh Sapphire', hex: '#ff0000' });
    expect(input.value).toBe('#ff0000');
    expect(window.localStorage.getItem('svndts-brand-palette-v1')).toContain('#ff0000');
  });

  it('nhận mã hex ngắn 3 ký tự và chuẩn hoá', () => {
    render(<StandardsPage />);
    commit(within(rowOf('Xanh Sapphire')).getByLabelText('Mã hex Xanh Sapphire'), '#0f0');
    expect(tokens()[0].hex).toBe('#00ff00');
  });

  it('mã hex sai bị từ chối, ô trở về giá trị cũ và hiện lỗi', () => {
    render(<StandardsPage />);
    const input = within(rowOf('Xanh Sapphire')).getByLabelText('Mã hex Xanh Sapphire') as HTMLInputElement;

    commit(input, 'xanh');

    expect(screen.getByRole('alert').textContent).toContain('Mã màu không hợp lệ');
    expect(input.value).toBe('#2563eb');
    expect(tokens()[0].hex).toBe('#2563eb');
  });

  it('đổi màu bằng ô chọn màu', () => {
    render(<StandardsPage />);
    fireEvent.change(within(rowOf('Xanh Sapphire')).getByLabelText('Màu Xanh Sapphire'), { target: { value: '#00ff00' } });
    expect(tokens()[0].hex).toBe('#00ff00');
  });

  it('thêm màu mới: khoá sinh từ tên, thêm vào cuối bảng', () => {
    render(<StandardsPage />);
    fireEvent.change(screen.getByLabelText('Tên màu mới'), { target: { value: 'Xanh Lá Non' } });
    fireEvent.change(screen.getByLabelText('Mã hex màu mới'), { target: { value: '#84cc16' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm màu/ }));

    expect(rows()).toHaveLength(DEFAULT_PALETTE.tokens.length + 1);
    expect(tokens().at(-1)).toEqual({ key: 'xanh-la-non', label: 'Xanh Lá Non', hex: '#84cc16' });
    expect((screen.getByLabelText('Tên màu mới') as HTMLInputElement).value).toBe('');
  });

  it('thêm màu với mã sai thì báo lỗi và không thêm', () => {
    render(<StandardsPage />);
    fireEvent.change(screen.getByLabelText('Mã hex màu mới'), { target: { value: 'khong' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm màu/ }));

    expect(screen.getByRole('alert').textContent).toContain('Mã màu không hợp lệ');
    expect(rows()).toHaveLength(DEFAULT_PALETTE.tokens.length);
  });

  it('đổi tên màu đang được icon dùng thì giữ nguyên khoá', () => {
    render(<StandardsPage />);
    commit(within(rowOf('Xanh Sapphire')).getByLabelText('Tên màu Xanh Sapphire'), 'Xanh chủ đạo');

    expect(tokens()[0]).toEqual({ key: 'sapphire', label: 'Xanh chủ đạo', hex: '#2563eb' });
    expect(rowOf('Xanh chủ đạo').textContent).toContain('sapphire');
  });

  it('đổi tên màu chưa ai dùng thì khoá đổi theo tên', () => {
    render(<StandardsPage />);
    commit(within(rowOf('Xanh đen')).getByLabelText('Tên màu Xanh đen'), 'Đen mực');

    const token = tokens().find((item) => item.label === 'Đen mực');
    expect(token?.key).toBe('den-muc');
    expect(rowOf('Đen mực').textContent).toContain('den-muc');
  });

  it('tên màu để trống bị từ chối', () => {
    render(<StandardsPage />);
    commit(within(rowOf('Xanh đen')).getByLabelText('Tên màu Xanh đen'), '   ');
    expect(screen.getByRole('alert').textContent).toContain('Tên màu không được để trống');
    expect(tokens().some((token) => token.label === 'Xanh đen')).toBe(true);
  });

  it('đưa màu lên, xuống; nút ở mép bị khoá', () => {
    render(<StandardsPage />);
    const first = rows()[0];
    expect((within(first).getByRole('button', { name: 'Đưa lên' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rows().at(-1) as HTMLElement).getByRole('button', { name: 'Đưa xuống' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(first).getByRole('button', { name: 'Đưa xuống' }));

    expect(tokens().slice(0, 2).map((token) => token.key)).toEqual(['navy', 'sapphire']);
    expect(within(rows()[1]).getByLabelText('Tên màu Xanh Sapphire')).toBeTruthy();
  });

  it('kéo thả đổi thứ tự màu', () => {
    render(<StandardsPage />);
    const dataTransfer = { effectAllowed: '', setData: jest.fn() };
    const [from, to] = [rows()[0], rows()[2]];

    fireEvent.mouseDown(within(from).getByTitle('Kéo để đổi thứ tự'));
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });

    expect(tokens().map((token) => token.key).slice(0, 3)).toEqual(['navy', 'emerald', 'sapphire']);
  });

  it('xoá màu đang dùng có cảnh báo số icon bị ảnh hưởng', async () => {
    render(<StandardsPage />);
    fireEvent.click(within(rowOf('Xanh Sapphire')).getByRole('button', { name: 'Xoá màu' }));

    const popup = screen.getByText('Xoá màu "Xanh Sapphire"?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    expect(popup.textContent).toContain('Đang dùng trong 4 icon');
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(tokens().some((token) => token.key === 'sapphire')).toBe(false));
    expect(rows()).toHaveLength(DEFAULT_PALETTE.tokens.length - 1);
  });

  it('xoá màu chưa dùng thì báo chưa có icon nào dùng', async () => {
    render(<StandardsPage />);
    fireEvent.click(within(rowOf('Xanh đen')).getByRole('button', { name: 'Xoá màu' }));

    const popup = screen.getByText('Xoá màu "Xanh đen"?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    expect(popup.textContent).toContain('Chưa có icon nào dùng màu này');
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(tokens().some((token) => token.key === 'navy')).toBe(false));
  });

  it('không cho xoá màu cuối cùng', async () => {
    localStore.setPalette({ tokens: [{ key: 'xanh', label: 'Xanh', hex: '#2563eb' }] });
    render(<StandardsPage />);
    expect((within(rows()[0]).getByRole('button', { name: 'Xoá màu' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('StandardsPage: quy chuẩn', () => {
  it('thêm độ dày nét mới, danh sách tự xếp tăng dần', () => {
    render(<StandardsPage />);
    fireEvent.change(screen.getByLabelText('Độ dày nét mới'), { target: { value: '1,25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm độ dày' }));

    expect(rules().allowedStrokeWidths).toEqual([1.25, 1.5, 1.75, 2]);
    expect(screen.getAllByTestId('stroke-chip').map((chip) => chip.textContent)).toEqual(['1,25', '1,5', '1,75', '2']);
  });

  it('độ dày sai, trùng hoặc ngoài khoảng bị từ chối kèm lý do', () => {
    render(<StandardsPage />);
    const input = screen.getByLabelText('Độ dày nét mới');
    const add = () => fireEvent.click(screen.getByRole('button', { name: 'Thêm độ dày' }));

    fireEvent.change(input, { target: { value: 'abc' } });
    add();
    expect(screen.getByRole('alert').textContent).toContain('Hãy nhập một số');

    fireEvent.change(input, { target: { value: '2' } });
    add();
    expect(screen.getByRole('alert').textContent).toContain('đã có');

    fireEvent.change(input, { target: { value: '9' } });
    add();
    expect(screen.getByRole('alert').textContent).toContain('từ 0,25 đến 6');
    expect(rules().allowedStrokeWidths).toEqual([1.5, 1.75, 2]);
  });

  it('bỏ độ dày nét; độ dày cuối cùng không bỏ được', () => {
    render(<StandardsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ độ dày 1,5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ độ dày 1,75' }));
    expect(rules().allowedStrokeWidths).toEqual([2]);
    expect((screen.getByRole('button', { name: 'Bỏ độ dày 2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sửa ngưỡng dạng số và lưu ngay; nhận dấu phẩy', () => {
    render(<StandardsPage />);
    const input = screen.getByLabelText('Khoảng chừa an toàn') as HTMLInputElement;

    commit(input, '0,5');

    expect(rules().safePadding).toBe(0.5);
    expect(input.value).toBe('0,5');
  });

  it('giá trị ngoài khoảng được kẹp lại, số lớp luôn là số nguyên', () => {
    render(<StandardsPage />);
    commit(screen.getByLabelText('Bước bắt dính'), '99');
    expect(rules().snapStep).toBe(4);
    expect((screen.getByLabelText('Bước bắt dính') as HTMLInputElement).value).toBe('4');

    commit(screen.getByLabelText('Số lớp tối đa'), '7,6');
    expect(rules().maxShapes).toBe(8);
  });

  it('giá trị không phải số bị từ chối, giữ giá trị cũ', () => {
    render(<StandardsPage />);
    const input = screen.getByLabelText('Chi tiết nhỏ nhất') as HTMLInputElement;
    commit(input, 'abc');

    expect(screen.getByRole('alert').textContent).toContain('Chi tiết nhỏ nhất: hãy nhập một số');
    expect(rules().minFeature).toBe(DEFAULT_RULES.minFeature);
    expect(input.value).toBe('0,75');
  });

  it('công tắc bắt buộc dùng màu trong bảng', () => {
    render(<StandardsPage />);
    const toggle = screen.getByRole('switch', { name: 'Bắt buộc dùng màu trong bảng' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(rules().requirePaletteColors).toBe(false);
    fireEvent.click(toggle);
    expect(rules().requirePaletteColors).toBe(true);
  });
});

describe('StandardsPage: nhập, xuất, đặt lại', () => {
  const pick = (text: string, name = 'cai-dat.json') =>
    fireEvent.change(screen.getByTestId('settings-input'), { target: { files: [new File([text], name, { type: 'application/json' })] } });

  it('xuất cài đặt ra tệp JSON gồm bảng màu và quy chuẩn hiện tại', () => {
    render(<StandardsPage />);
    commit(screen.getByLabelText('Bước bắt dính'), '1');

    fireEvent.click(screen.getByRole('button', { name: 'Xuất' }));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content] = jest.mocked(downloadTextFile).mock.calls[0];
    expect(fileName).toBe('svndts-brand-settings.json');
    const data = JSON.parse(content) as { palette: { tokens: unknown[] }; rules: { snapStep: number } };
    expect(data.palette.tokens).toHaveLength(DEFAULT_PALETTE.tokens.length);
    expect(data.rules.snapStep).toBe(1);
  });

  it('nhập cài đặt hợp lệ thay bảng màu và quy chuẩn', async () => {
    render(<StandardsPage />);
    pick(
      JSON.stringify({
        palette: { tokens: [{ key: 'chinh', label: 'Màu chính', hex: '#112233' }, { key: 'hong', label: 'Hỏng', hex: 'khong' }] },
        rules: { snapStep: 1 },
      }),
    );

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã nhập bảng màu (1 màu) và quy chuẩn.'));
    expect(screen.getByRole('status').textContent).toContain('Bỏ qua 1 màu');
    expect(tokens()).toEqual([{ key: 'chinh', label: 'Màu chính', hex: '#112233' }]);
    expect(rules().snapStep).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it('nhập tệp chỉ có quy chuẩn thì giữ nguyên bảng màu', async () => {
    render(<StandardsPage />);
    pick(JSON.stringify({ rules: { maxShapes: 20 } }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã nhập quy chuẩn.'));
    expect(tokens()).toHaveLength(DEFAULT_PALETTE.tokens.length);
    expect(rules().maxShapes).toBe(20);
  });

  it('tệp sai báo lỗi và không đổi gì', async () => {
    render(<StandardsPage />);
    pick('{ hỏng');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Tệp không phải JSON hợp lệ.'));
    expect(tokens()).toHaveLength(DEFAULT_PALETTE.tokens.length);
  });

  it('đặt lại mặc định qua hộp xác nhận', async () => {
    localStore.setPalette({ tokens: [{ key: 'xanh', label: 'Xanh', hex: '#2563eb' }] });
    localStore.setRules({ ...DEFAULT_RULES, snapStep: 2 });
    render(<StandardsPage />);
    expect(rows()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    confirmIn('Đặt lại mặc định?', 'Đặt lại');

    await waitFor(() => expect(rows()).toHaveLength(DEFAULT_PALETTE.tokens.length));
    expect(rules().snapStep).toBe(DEFAULT_RULES.snapStep);
    expect(screen.getByRole('status').textContent).toContain('Đã đặt lại');
  });

  it('báo lỗi khi trình duyệt không cho lưu', () => {
    render(<StandardsPage />);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    commit(within(rowOf('Xanh Sapphire')).getByLabelText('Mã hex Xanh Sapphire'), '#ff0000');

    expect(screen.getAllByRole('alert').some((node) => /Không lưu được/.test(node.textContent ?? ''))).toBe(true);
  });
});
