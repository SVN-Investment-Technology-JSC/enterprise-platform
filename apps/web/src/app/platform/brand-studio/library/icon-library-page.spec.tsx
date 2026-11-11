import {
  DEFAULT_PALETTE,
  createDocument,
  createPresetDocuments,
  createShape,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { STORAGE_KEYS, localStore } from '../store/local-store';
import { downloadTextFile } from './file-download';
import { IconLibraryPage } from './icon-library-page';
import { chooseTileAction, confirmDialog, openTileMenu } from './tile-actions.testing';

jest.mock('../export/export-dialog', () => {
  const { createElement } = jest.requireActual('react');
  return {
    ExportDialog: ({ open, docs }: { open: boolean; docs: ReadonlyArray<{ name: string }> }) =>
      open ? createElement('div', { 'data-testid': 'export-dialog' }, docs.map((doc) => doc.name).join('|')) : null,
  };
});

jest.mock('./file-download', () => ({
  ...jest.requireActual('./file-download'),
  downloadTextFile: jest.fn(),
}));

const presets = createPresetDocuments();
const presetCount = presets.length;
const moduleCount = presets.filter((doc) => doc.category === 'module').length;

const custom = (id: string, name: string, overrides: Partial<IconDocument> = {}): IconDocument =>
  createDocument({
    id,
    name,
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
    ...overrides,
  });

function seed(docs: readonly IconDocument[]) {
  window.localStorage.setItem(STORAGE_KEYS.docs, JSON.stringify(docs));
  localStore.reloadForTest();
}

const tiles = () => screen.queryAllByTestId('icon-tile');
const tileNames = () => tiles().map((tile) => within(tile).getAllByRole('link')[0].getAttribute('aria-label')?.replace(/^Mở /, ''));
const search = () => screen.getByRole('searchbox', { name: 'Tìm icon' });
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
/** Chọn một mục trong menu Bộ lọc (danh mục hoặc trạng thái) theo tên hiện trên mục. */
const chooseFilter = (name: RegExp) => {
  openFilters();
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};
/** Số icon ghi bên cạnh một mục của menu Bộ lọc. */
const filterCount = (name: RegExp) => {
  openFilters();
  const text = screen.getByRole('menuitemradio', { name }).textContent ?? '';
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  return Number(text.replace(/\D+/g, ' ').trim().split(' ').pop());
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.mocked(downloadTextFile).mockReset();
  localStore.reloadForTest();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('IconLibraryPage: hiển thị', () => {
  it('hiện đủ icon mẫu dạng lưới, kèm số lượng', () => {
    render(<IconLibraryPage />);
    expect(screen.getByRole('heading', { name: 'Thư viện icon' })).toBeTruthy();
    expect(tiles()).toHaveLength(presetCount);
    expect(screen.getAllByText(`${presetCount} icon`).length).toBeGreaterThanOrEqual(1);
  });

  it('mỗi ô là liên kết tới trình thiết kế của icon đó', () => {
    seed([custom('moi-1', 'Đồng hồ')]);
    render(<IconLibraryPage />);
    const link = screen.getByRole('link', { name: 'Mở Đồng hồ' });
    expect(link.getAttribute('href')).toBe('/platform/brand-studio/editor/moi-1');
    expect(screen.getByRole('link', { name: /Tạo icon mới/ }).getAttribute('href')).toBe('/platform/brand-studio/editor/new');
  });

  it('khi chạy phía máy chủ chỉ có khung chờ, không có tên icon (tránh lệch hydrate)', () => {
    const html = renderToString(<IconLibraryPage />);
    expect(html).toContain('Đang tải thư viện');
    expect(html).not.toContain('SVNDTS Master Logo');
  });
});

describe('IconLibraryPage: tìm, lọc, sắp xếp', () => {
  it('tìm tức thời không cần gõ dấu', () => {
    render(<IconLibraryPage />);
    fireEvent.change(search(), { target: { value: 'bao tri' } });
    expect(tileNames()).toEqual(['Bảo trì Thiết bị (CMMS)']);

    fireEvent.change(search(), { target: { value: 'khong co gi ca' } });
    expect(screen.getByTestId('empty-state').textContent).toContain('Không có icon phù hợp.');
  });

  it('lọc bằng menu Bộ lọc theo danh mục và trạng thái, con số trên mục khớp kết quả', () => {
    seed([...presets, custom('n-1', 'Nháp một', { status: 'draft', category: 'custom' })]);
    render(<IconLibraryPage />);

    expect(filterCount(/^Phân hệ/)).toBe(moduleCount);
    chooseFilter(/^Phân hệ/);
    expect(tiles()).toHaveLength(moduleCount);

    chooseFilter(/^Nháp/);
    expect(screen.getByTestId('empty-state')).toBeTruthy();

    chooseFilter(/^Tất cả danh mục/);
    chooseFilter(/^Tùy biến/);
    expect(tileNames()).toEqual(['Nháp một']);
  });

  it('nút Bộ lọc báo số bộ lọc đang bật; chip bỏ riêng từng bộ lọc', () => {
    seed([...presets, custom('n-1', 'Nháp một', { status: 'draft', category: 'custom' })]);
    render(<IconLibraryPage />);
    expect(screen.getByRole('button', { name: 'Bộ lọc' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Bỏ lọc/ })).toBeNull();

    chooseFilter(/^Phân hệ/);
    chooseFilter(/^Phát hành/);
    expect(screen.getByRole('button', { name: 'Bộ lọc, đang bật 2' })).toBeTruthy();
    expect(tiles()).toHaveLength(presets.filter((doc) => doc.category === 'module' && doc.status === 'published').length);

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Phân hệ' }));
    expect(screen.getByRole('button', { name: 'Bộ lọc, đang bật 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Phân hệ' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Phát hành' }));
    expect(screen.getByRole('button', { name: 'Bộ lọc' })).toBeTruthy();
    expect(tiles()).toHaveLength(presetCount + 1);
  });

  it('"Xoá bộ lọc" đưa danh sách về đầy đủ', () => {
    render(<IconLibraryPage />);
    fireEvent.change(search(), { target: { value: 'zzz-khong-co' } });
    fireEvent.click(within(screen.getByTestId('empty-state')).getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(tiles()).toHaveLength(presetCount);
    expect((search() as HTMLInputElement).value).toBe('');
  });

  it('chuyển sang dạng danh sách và nhớ lựa chọn cho lần sau', () => {
    const { unmount } = render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Dạng danh sách' }));
    expect(screen.queryAllByTestId('icon-row')).toHaveLength(presetCount);
    expect(tiles()).toHaveLength(0);
    unmount();

    render(<IconLibraryPage />);
    expect(screen.queryAllByTestId('icon-row')).toHaveLength(presetCount);
  });
});

describe('IconLibraryPage: thao tác trên một icon', () => {
  it('mỗi ô chỉ có một nút nhỏ mở menu, không có thanh nút che ô tick; bấm mới hiện các thao tác', async () => {
    seed([custom('m-1', 'Một ô')]);
    render(<IconLibraryPage />);
    const tile = screen.getByRole('link', { name: 'Mở Một ô' }).closest('li') as HTMLElement;

    expect(within(tile).queryByRole('button', { name: 'Nhân bản' })).toBeNull();
    expect(within(tile).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('menu')).toBeNull();

    openTileMenu(tile);
    expect(await screen.findByRole('menu')).toBeTruthy();
    for (const name of ['Mở trong trình thiết kế', 'Nhân bản', 'Xuất', 'Xoá']) expect(screen.getByRole('menuitem', { name })).toBeTruthy();
  });

  it('Hủy ở hộp xác nhận xoá thì icon vẫn còn', async () => {
    seed([custom('m-2', 'Giữ nguyên')]);
    render(<IconLibraryPage />);
    await chooseTileAction(screen.getByRole('link', { name: 'Mở Giữ nguyên' }).closest('li') as HTMLElement, 'Xoá');
    await confirmDialog('Hủy');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('link', { name: 'Mở Giữ nguyên' })).toBeTruthy();
  });

  it('nhân bản tạo thêm một icon nháp và báo kết quả', async () => {
    seed([custom('goc-1', 'Gốc')]);
    render(<IconLibraryPage />);
    const before = tiles().length;

    await chooseTileAction(screen.getByRole('link', { name: 'Mở Gốc' }).closest('li') as HTMLElement, 'Nhân bản');

    await waitFor(() => expect(tiles()).toHaveLength(before + 1));
    expect(screen.getByRole('status').textContent).toContain('Đã nhân bản thành "Gốc (bản sao)"');
    expect(tileNames()).toContain('Gốc (bản sao)');
  });

  it('xoá icon tự tạo qua hộp xác nhận', async () => {
    seed([custom('xoa-1', 'Sắp xoá')]);
    render(<IconLibraryPage />);
    const tile = screen.getByRole('link', { name: 'Mở Sắp xoá' }).closest('li') as HTMLElement;

    await chooseTileAction(tile, 'Xoá');
    await confirmDialog('Xoá');

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Mở Sắp xoá' })).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Đã xoá "Sắp xoá"');
  });

  it('icon mẫu không có mục xoá mà có mục đặt lại về bản gốc', async () => {
    render(<IconLibraryPage />);
    const first = tiles()[0];
    openTileMenu(first);
    expect(await screen.findByRole('menuitem', { name: 'Đặt lại về bản gốc' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Xoá' })).toBeNull();

    const name = within(first).getAllByRole('link')[0].getAttribute('aria-label')?.replace(/^Mở /, '') ?? '';
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đặt lại về bản gốc' }));
    await confirmDialog('Đặt lại');

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(`Đã đặt lại "${name}" về bản gốc`));
  });

  it('Xuất trên một icon mở hộp xuất với đúng icon đó', async () => {
    seed([custom('x-1', 'Một mình')]);
    render(<IconLibraryPage />);
    const tile = screen.getByRole('link', { name: 'Mở Một mình' }).closest('li') as HTMLElement;

    await chooseTileAction(tile, 'Xuất');
    expect(screen.getByTestId('export-dialog').textContent).toBe('Một mình');
  });
});

describe('IconLibraryPage: chọn nhiều', () => {
  it('thanh thao tác hàng loạt nằm trong thanh tiêu đề của khối icon, nên chọn icon không đẩy nội dung xuống', () => {
    render(<IconLibraryPage />);
    const panel = screen.getByRole('heading', { name: 'Icon' }).closest('section') as HTMLElement;
    const heightBefore = panel.children.length;

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));
    const bar = screen.getByTestId('bulk-bar');
    expect(bar.closest('header')).toBe(panel.querySelector('header'));
    expect(panel.children.length).toBe(heightBefore);
    expect(within(bar).getByRole('button', { name: 'Xuất' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Phát hành' })).toBeTruthy();
  });

  it('thanh thao tác hàng loạt chỉ hiện khi có icon được chọn', () => {
    render(<IconLibraryPage />);
    expect(screen.queryByTestId('bulk-bar')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 1');

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });

  it('chọn tất cả icon đang hiện, chỉ tính phần đã lọc', () => {
    render(<IconLibraryPage />);
    fireEvent.change(search(), { target: { value: 'svndts' } });
    expect(tiles()).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả icon đang hiện' }));
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 2');
  });

  it('lọc lại làm icon bị ẩn rơi khỏi lựa chọn, không thao tác nhầm icon không thấy', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Favicon Tab' }));
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 2');

    fireEvent.change(search(), { target: { value: 'favicon' } });
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 1');
  });

  it('đổi trạng thái hàng loạt giữa nháp và phát hành', async () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Favicon Tab' }));

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: /Chuyển nháp/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã chuyển 2 icon sang "Nháp"'));
    expect(filterCount(/^Nháp/)).toBe(2);

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: /Phát hành/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã chuyển 2 icon sang "Phát hành"'));
    expect(filterCount(/^Nháp/)).toBe(0);
  });

  it('xoá hàng loạt giữ lại icon mẫu', async () => {
    seed([...presets, custom('c-1', 'Của tôi 1'), custom('c-2', 'Của tôi 2')]);
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Của tôi 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Của tôi 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: 'Xoá' }));
    const popup = screen.getByText('Xoá 3 icon đã chọn?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    expect(popup.textContent).toContain('1 icon mẫu sẽ được giữ lại');
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã xoá 2 icon, giữ lại 1 icon mẫu.'));
    expect(tiles()).toHaveLength(presetCount);
    expect(screen.queryByTestId('bulk-bar')).toBeNull();
  });
});

describe('IconLibraryPage: xuất, sao lưu', () => {
  it('Xuất trên thanh công cụ: không chọn thì xuất tất cả, có chọn thì chỉ xuất phần đã chọn', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: `Xuất tất cả ${presetCount} icon` }));
    expect(screen.getByTestId('export-dialog').textContent?.split('|')).toHaveLength(presetCount);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất 1 icon đã chọn' }));
    expect(screen.getByTestId('export-dialog').textContent).toBe('SVNDTS Master Logo');
  });

  it('Sao lưu tải tệp JSON chứa toàn bộ thư viện', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sao lưu/ }));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content] = jest.mocked(downloadTextFile).mock.calls[0];
    expect(fileName).toMatch(/^svndts-brand-icons-\d{8}\.json$/);
    expect((JSON.parse(content) as unknown[]).length).toBe(presetCount);
    expect(screen.getByRole('status').textContent).toContain(`Đã sao lưu ${presetCount} icon.`);
  });
});

describe('IconLibraryPage: nhập tệp', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
  const pick = (files: File[]) => fireEvent.change(screen.getByTestId('import-input'), { target: { files } });

  it('nhập nhiều tệp SVG: mỗi tệp thành một icon nháp, tên theo tên tệp', async () => {
    render(<IconLibraryPage />);
    pick([new File([SVG], 'dong-ho.svg', { type: 'image/svg+xml' }), new File([SVG], 'kinh_lup.svg', { type: 'image/svg+xml' })]);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã nhập 2 icon.'));
    expect(tileNames()).toEqual(expect.arrayContaining(['dong ho', 'kinh lup']));
    expect(tiles()).toHaveLength(presetCount + 2);
  });

  it('nhập tệp sao lưu của chính thư viện thì không sinh bản trùng', async () => {
    seed([...presets, custom('c-1', 'Của tôi')]);
    render(<IconLibraryPage />);
    const backup = JSON.stringify(localStore.getSnapshot().docs);

    pick([new File([backup], 'sao-luu.json', { type: 'application/json' })]);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(`${presetCount + 1} icon đã có sẵn`));
    expect(tiles()).toHaveLength(presetCount + 1);
  });

  it('tệp lỗi được báo ngắn gọn, tệp tốt vẫn được nhập', async () => {
    render(<IconLibraryPage />);
    pick([new File([SVG], 'tot.svg'), new File(['không phải gì cả'], 'hong.txt')]);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã nhập 1 icon, 1 tệp lỗi.'));
    expect(screen.getByRole('status').textContent).toContain('hong.txt');
    expect(tiles()).toHaveLength(presetCount + 1);
  });

  it('không nhập được gì thì báo bằng thông báo lỗi', async () => {
    render(<IconLibraryPage />);
    pick([new File(['{ hỏng'], 'hong.json')]);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 tệp lỗi.'));
    expect(tiles()).toHaveLength(presetCount);
  });
});

describe('IconLibraryPage: lỗi lưu', () => {
  it('hiện thông báo khi trình duyệt không cho lưu', async () => {
    seed([custom('g-1', 'Gốc')]);
    render(<IconLibraryPage />);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await chooseTileAction(screen.getByRole('link', { name: 'Mở Gốc' }).closest('li') as HTMLElement, 'Nhân bản');

    await waitFor(() => expect(screen.getAllByRole('alert').some((node) => /Không lưu được/.test(node.textContent ?? ''))).toBe(true));
  });
});

describe('IconLibraryPage: dùng bảng màu thật', () => {
  it('vẽ icon theo màu của bảng màu đang lưu', () => {
    const palette = { tokens: [{ key: 'sapphire', label: 'Xanh', hex: '#123456' }] };
    localStore.setPalette(palette);
    seed([custom('m-1', 'Có màu')]);
    const { container } = render(<IconLibraryPage />);

    expect(container.innerHTML).toContain('#123456');
    expect(container.innerHTML).not.toContain(DEFAULT_PALETTE.tokens[0].hex);
  });
});

