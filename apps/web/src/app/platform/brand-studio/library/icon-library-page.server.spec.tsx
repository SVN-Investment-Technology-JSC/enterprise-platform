import { PRESET_IDS, createDocument, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { localStore } from '../store/local-store';
import { remoteStore } from '../store/remote-store';
import { createFakeBrandServer, httpError, type FakeBrandServer } from '../store/testing/fake-brand-server';
import { IconLibraryPage } from './icon-library-page';

jest.mock('../export/export-dialog', () => ({ ExportDialog: () => null }));

let mockServer: FakeBrandServer;

jest.mock('../store/brand-api', () => {
  const actual = jest.requireActual('../store/brand-api');
  const { BRAND_API_FUNCTIONS } = jest.requireActual('../store/testing/api-names') as { BRAND_API_FUNCTIONS: readonly string[] };
  const delegates = Object.fromEntries(
    BRAND_API_FUNCTIONS.map((name) => [name, (...args: unknown[]) => (mockServer.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)]),
  );
  return { ...actual, ...delegates };
});

const presetCount = PRESET_IDS.size;

const custom = (id: string, name: string, overrides: Partial<IconDocument> = {}): IconDocument =>
  createDocument({
    id,
    name,
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
    ...overrides,
  });

const tiles = () => screen.queryAllByTestId('icon-tile');
const tileOf = (name: string) => screen.getByRole('link', { name: `Mở ${name}` }).closest('li') as HTMLElement;

async function showLibrary() {
  render(<IconLibraryPage />);
  await waitFor(() => expect(screen.queryByLabelText('Đang tải thư viện')).toBeNull());
}

beforeEach(() => {
  mockServer = createFakeBrandServer();
  remoteStore.resetForTest();
  window.localStorage.clear();
  localStore.reloadForTest();
  Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('IconLibraryPage: chế độ máy chủ', () => {
  it('lúc kiểm tra kết nối chỉ có khung chờ, rồi hiện icon trên máy chủ cùng dải "Đã kết nối máy chủ"', async () => {
    mockServer.seed(custom('a', 'Đồng hồ'));
    render(<IconLibraryPage />);

    expect(screen.getByLabelText('Đang tải thư viện')).toBeTruthy();
    expect(tiles()).toHaveLength(0);

    await waitFor(() => expect(screen.getByText('Đã kết nối máy chủ')).toBeTruthy());
    await waitFor(() => expect(tiles()).toHaveLength(1 + presetCount));
    expect(screen.getByRole('link', { name: 'Mở Đồng hồ' })).toBeTruthy();
  });

  it('xoá một icon là lưu trữ: thông báo "Đã lưu trữ" và icon vẫn còn trên máy chủ', async () => {
    mockServer.seed(custom('a', 'Sắp lưu trữ'));
    await showLibrary();

    fireEvent.click(within(tileOf('Sắp lưu trữ')).getByRole('button', { name: 'Xoá' }));
    const popup = screen.getByText('Xoá "Sắp lưu trữ"?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã lưu trữ "Sắp lưu trữ".'));
    expect(screen.queryByRole('link', { name: 'Mở Sắp lưu trữ' })).toBeNull();
    expect(mockServer.rows.get('a')?.summary.status).toBe('archived');
  });

  it('xoá hàng loạt đổi nhãn thành Lưu trữ, giải thích dữ liệu vẫn được giữ và giữ lại icon mẫu', async () => {
    mockServer.seed(custom('a', 'Một'));
    mockServer.seed(custom('b', 'Hai'));
    await showLibrary();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Một' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Hai' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn SVNDTS Master Logo' }));

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: 'Lưu trữ' }));
    const popup = screen.getByText('Lưu trữ 3 icon đã chọn?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    expect(popup.textContent).toContain('dữ liệu vẫn được giữ trên máy chủ');
    expect(popup.textContent).toContain('1 icon mẫu sẽ được giữ lại');
    fireEvent.click(within(popup).getByRole('button', { name: 'Lưu trữ' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã lưu trữ 2 icon, giữ lại 1 icon mẫu.'));
    expect(tiles()).toHaveLength(presetCount);
  });

  it('lưu trữ lỗi thì hiện lỗi của máy chủ và icon vẫn còn', async () => {
    mockServer.seed(custom('a', 'Giữ lại'));
    await showLibrary();
    mockServer.failWith('DELETE icons/a', httpError(503, 'Kho lưu trữ icon tạm thời không khả dụng. Vui lòng thử lại sau.'));

    fireEvent.click(within(tileOf('Giữ lại')).getByRole('button', { name: 'Xoá' }));
    const popup = screen.getByText('Xoá "Giữ lại"?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Kho lưu trữ icon tạm thời không khả dụng.'));
    expect(screen.getByRole('link', { name: 'Mở Giữ lại' })).toBeTruthy();
  });

  it('nhân bản tạo icon nháp trên máy chủ', async () => {
    mockServer.seed(custom('a', 'Gốc'));
    await showLibrary();

    fireEvent.click(within(tileOf('Gốc')).getByRole('button', { name: 'Nhân bản' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã nhân bản thành "Gốc (bản sao)"'));
    expect([...mockServer.rows.values()].some((row) => row.summary.name === 'Gốc (bản sao)')).toBe(true);
  });

  it('đổi trạng thái hàng loạt đi qua phát hành và gỡ phát hành trên máy chủ', async () => {
    mockServer.seed(custom('a', 'Một'));
    mockServer.seed(custom('b', 'Hai'));
    await showLibrary();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Một' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Hai' }));

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: /Phát hành/ }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã chuyển 2 icon sang "Phát hành"'));
    expect(mockServer.rows.get('a')?.summary.status).toBe('published');
    expect(mockServer.rows.get('b')?.summary.status).toBe('published');
  });

  it('phát hành hàng loạt có icon chưa đủ điều kiện thì báo lỗi thay vì báo thành công', async () => {
    mockServer.seed(custom('a', 'Tốt'));
    mockServer.seed(custom('b', 'Trống', { shapes: [] }));
    await showLibrary();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Tốt' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Trống' }));

    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: /Phát hành/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^Đã lưu 1\/2 icon\. /));
    expect(mockServer.rows.get('a')?.summary.status).toBe('published');
    expect(mockServer.rows.get('b')?.summary.status).toBe('draft');
  });

  it('có icon chỉ ở trình duyệt thì dải trạng thái có nút đồng bộ; bấm xong icon hiện trong thư viện', async () => {
    localStore.setDocs([...localStore.getSnapshot().docs, custom('cuc-bo', 'Chỉ ở trình duyệt')]);
    await showLibrary();
    expect(screen.queryByRole('link', { name: 'Mở Chỉ ở trình duyệt' })).toBeNull();
    expect(screen.getByText('1 icon chỉ có trong trình duyệt')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Đồng bộ lên máy chủ (1)' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Mở Chỉ ở trình duyệt' })).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Đã đồng bộ 1 icon.');
    expect(screen.queryByRole('button', { name: /Đồng bộ lên máy chủ/ })).toBeNull();
    expect(mockServer.rows.has('cuc-bo')).toBe(true);
  });

  it('nhập tệp lỗi một phần trên máy chủ thì báo lỗi, không văng ra ngoài', async () => {
    await showLibrary();
    mockServer.failWith('POST icons', httpError(503, 'Máy chủ bận.'));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;

    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [new File([svg], 'dong-ho.svg', { type: 'image/svg+xml' })] } });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Máy chủ bận.'));
    expect(screen.getByRole('button', { name: /Nhập tệp/ })).toBeTruthy();
  });
});

describe('IconLibraryPage: chế độ cục bộ khi chưa có API', () => {
  it('hiện dải "Đang lưu tạm trong trình duyệt" kèm lý do, thư viện vẫn dùng được và "xoá" vẫn là xoá', async () => {
    mockServer.failWith('GET icons', httpError(404, 'x'));
    localStore.setDocs([...localStore.getSnapshot().docs, custom('cuc-bo', 'Cục bộ')]);
    await showLibrary();

    expect(screen.getByText('Đang lưu tạm trong trình duyệt')).toBeTruthy();
    expect(screen.getByText('Máy chủ chưa có API lưu icon.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Đồng bộ lên máy chủ/ })).toBeNull();
    expect(tiles()).toHaveLength(presetCount + 1);

    fireEvent.click(within(tileOf('Cục bộ')).getByRole('button', { name: 'Xoá' }));
    const popup = screen.getByText('Xoá "Cục bộ"?').closest('[class*="popconfirmPopup"]') as HTMLElement;
    fireEvent.click(within(popup).getByRole('button', { name: 'Xoá' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Đã xoá "Cục bộ".'));
    expect(mockServer.calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('nút Thử lại nối được máy chủ thì chuyển sang chế độ máy chủ', async () => {
    mockServer.failWith('GET icons', httpError(404, 'x'), 1);
    mockServer.seed(custom('a', 'Trên máy chủ'));
    await showLibrary();
    expect(screen.getByText('Đang lưu tạm trong trình duyệt')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(screen.getByText('Đã kết nối máy chủ')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('link', { name: 'Mở Trên máy chủ' })).toBeTruthy());
  });
});
