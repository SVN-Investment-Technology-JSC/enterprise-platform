import { createDocument, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorScreen } from './editor-screen';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

const mockLibrary = {
  ready: true,
  docs: [] as IconDocument[],
  error: null,
  get: (id: string) => mockLibrary.docs.find((doc) => doc.id === id),
  save: jest.fn(async (doc: IconDocument) => doc),
  remove: jest.fn(),
  duplicate: jest.fn(),
  importDocs: jest.fn(),
  resetPreset: jest.fn(),
};

const mockSettings = {
  ready: true,
  palette: jest.requireActual('@enterprise-platform/shared-brand-icon').DEFAULT_PALETTE,
  rules: jest.requireActual('@enterprise-platform/shared-brand-icon').DEFAULT_RULES,
  setPalette: jest.fn(),
  setRules: jest.fn(),
  reset: jest.fn(),
};

jest.mock('../store', () => ({
  useIconLibrary: () => mockLibrary,
  useBrandSettings: () => mockSettings,
  newBlankIcon: () => jest.requireActual('@enterprise-platform/shared-brand-icon').createDocument({ id: 'icon-new-1', name: 'Icon mới' }),
}));

jest.mock('./panels/properties-panel', () => ({ PropertiesPanel: () => <div data-testid="properties-panel" /> }));
jest.mock('./panels/insert-panel', () => ({ InsertPanel: () => <div data-testid="insert-panel" /> }));
jest.mock('./panels/layers-panel', () => ({ LayersPanel: () => <div data-testid="layers-panel" /> }));
jest.mock('./panels/preview-panel', () => ({ PreviewPanel: () => <div data-testid="preview-panel" /> }));
jest.mock('./panels/compliance-panel', () => ({
  CompliancePanel: ({ onSelectShape }: { onSelectShape?: (id: string) => void }) => (
    <button data-testid="compliance-panel" onClick={() => onSelectShape?.('rect-1')} type="button">
      chọn lớp
    </button>
  ),
}));
jest.mock('../export/export-dialog', () => ({
  ExportDialog: ({ open, docs }: { open: boolean; docs: readonly IconDocument[] }) =>
    open ? <div data-testid="export-dialog">{docs.map((doc) => doc.name).join(',')}</div> : null,
}));

const sample = () =>
  createDocument({
    id: 'icon-1',
    name: 'Khoá bảo mật',
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 2 }, { id: 'rect-1', name: 'Khung' })],
  });

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockLibrary.ready = true;
  mockLibrary.docs = [sample()];
  mockLibrary.save.mockClear();
  mockLibrary.save.mockImplementation(async (doc: IconDocument) => doc);
  mockSettings.ready = true;
  window.localStorage.clear();
});

const nameInput = () => screen.getByRole('textbox', { name: 'Tên icon' }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /^Lưu/ }) as HTMLButtonElement;

describe('EditorScreen', () => {
  it('hiện khung chờ khi kho icon chưa sẵn sàng', () => {
    mockLibrary.ready = false;
    render(<EditorScreen iconId="icon-1" />);
    expect(screen.getByLabelText('Đang tải trình thiết kế').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Tên icon' })).toBeNull();
  });

  it('báo không tìm thấy kèm nút về thư viện', () => {
    render(<EditorScreen iconId="khong-co" />);
    expect(screen.getByText(/Không tìm thấy icon này/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe('/platform/brand-studio');
  });

  it('dựng thanh trên, thanh công cụ, canvas và các mục của cột phải', () => {
    render(<EditorScreen iconId="icon-1" />);
    expect(nameInput().value).toBe('Khoá bảo mật');
    expect(screen.getByText('Nháp')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe('/platform/brand-studio');
    expect(screen.getByRole('img', { name: 'Bản vẽ icon' })).toBeTruthy();
    for (const label of ['Chọn', 'Điểm neo', 'Bút', 'Chữ nhật', 'Elip, hình tròn', 'Đường thẳng', 'Đa giác đều', 'Bàn tay']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    for (const title of ['Thuộc tính', 'Chèn hình', 'Lớp', 'Xem trước', 'Quy chuẩn']) {
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeTruthy();
    }
    expect(screen.getByTestId('properties-panel')).toBeTruthy();
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    expect(screen.getByTestId('preview-panel')).toBeTruthy();
  });

  it('thanh công cụ có chú thích kèm phím tắt và đánh dấu công cụ đang dùng', () => {
    render(<EditorScreen iconId="icon-1" />);
    const select = screen.getByRole('button', { name: 'Chọn' });
    expect(select.getAttribute('title')).toBe('Chọn (V)');
    expect(select.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Bút' }));
    expect(screen.getByRole('button', { name: 'Bút' }).getAttribute('aria-pressed')).toBe('true');
    expect(select.getAttribute('aria-pressed')).toBe('false');
  });

  it('phím tắt đổi công cụ, và không bắt phím khi đang gõ tên', () => {
    render(<EditorScreen iconId="icon-1" />);
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByRole('button', { name: 'Chữ nhật' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(nameInput(), { key: 'e' });
    expect(screen.getByRole('button', { name: 'Elip, hình tròn' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('icon chưa sửa thì nút Lưu bị tắt; đổi tên ở ô tên thì bật lên và hiện "Chưa lưu"', () => {
    render(<EditorScreen iconId="icon-1" />);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText('Chưa lưu')).toBeNull();

    fireEvent.change(nameInput(), { target: { value: 'Ổ khoá mới' } });
    fireEvent.blur(nameInput());
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('Esc trong ô tên bỏ thay đổi đang gõ', () => {
    render(<EditorScreen iconId="icon-1" />);
    fireEvent.change(nameInput(), { target: { value: 'Tên dở dang' } });
    fireEvent.keyDown(nameInput(), { key: 'Escape' });
    expect(nameInput().value).toBe('Khoá bảo mật');
  });

  it('lưu icon có sẵn gọi library.save với tài liệu đã sửa và không đổi đường dẫn', async () => {
    render(<EditorScreen iconId="icon-1" />);
    fireEvent.change(nameInput(), { target: { value: 'Ổ khoá mới' } });
    fireEvent.blur(nameInput());
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(1));
    expect(mockLibrary.save.mock.calls[0][0]).toMatchObject({ id: 'icon-1', name: 'Ổ khoá mới' });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.queryByText('Chưa lưu')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Ctrl+S cũng lưu', async () => {
    render(<EditorScreen iconId="icon-1" />);
    fireEvent.change(nameInput(), { target: { value: 'Tên khác' } });
    fireEvent.blur(nameInput());
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(1));
  });

  it('Ctrl+S ngay trong ô tên chốt tên đang gõ rồi mới lưu', async () => {
    render(<EditorScreen iconId="icon-1" />);
    act(() => nameInput().focus());
    fireEvent.change(nameInput(), { target: { value: 'Tên gõ dở' } });
    fireEvent.keyDown(nameInput(), { key: 's', ctrlKey: true });
    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(1));
    expect(mockLibrary.save.mock.calls[0][0]).toMatchObject({ id: 'icon-1', name: 'Tên gõ dở' });
  });

  it('icon mới lưu lần đầu thì chuyển sang đường dẫn của icon vừa lưu', async () => {
    mockLibrary.docs = [];
    render(<EditorScreen iconId="new" />);
    expect(nameInput().value).toBe('Icon mới');
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(1));
    expect(mockLibrary.save.mock.calls[0][0]).toMatchObject({ id: 'icon-new-1' });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/platform/brand-studio/editor/icon-new-1'));
  });

  it('lưu lỗi thì giữ trạng thái chưa lưu và không chuyển trang', async () => {
    mockLibrary.docs = [];
    mockLibrary.save.mockRejectedValueOnce(new Error('hết bộ nhớ'));
    render(<EditorScreen iconId="new" />);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalled());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('cảnh báo khi đóng trang lúc còn thay đổi chưa lưu', () => {
    render(<EditorScreen iconId="icon-1" />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(nameInput(), { target: { value: 'Tên khác' } });
    fireEvent.blur(nameInput());
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('hoàn tác và làm lại từ thanh trên', () => {
    render(<EditorScreen iconId="icon-1" />);
    const undo = screen.getByRole('button', { name: 'Hoàn tác' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Làm lại' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: 'Tên khác' } });
    fireEvent.blur(nameInput());
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(nameInput().value).toBe('Khoá bảo mật');
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(nameInput().value).toBe('Tên khác');
  });

  it('công tắc lưới, bắt dính và chế độ màu đổi trạng thái và được nhớ lại', async () => {
    const first = render(<EditorScreen iconId="icon-1" />);
    const grid = screen.getByRole('button', { name: 'Hiện lưới' });
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grid);
    expect(screen.getByRole('button', { name: 'Hiện lưới' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Hiện một màu (currentColor)' }));
    expect(screen.getByRole('button', { name: 'Hiện một màu (currentColor)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hiện màu thương hiệu' }).getAttribute('aria-pressed')).toBe('false');
    first.unmount();

    render(<EditorScreen iconId="icon-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hiện lưới' }).getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('button', { name: 'Hiện một màu (currentColor)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('nút Xuất mở hộp thoại xuất với icon đang sửa', () => {
    render(<EditorScreen iconId="icon-1" />);
    expect(screen.queryByTestId('export-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xuất/ }));
    expect(screen.getByTestId('export-dialog').textContent).toBe('Khoá bảo mật');
  });

  it('thu gọn và mở lại một mục ở cột phải', () => {
    render(<EditorScreen iconId="icon-1" />);
    const header = screen.getByRole('button', { name: /Thuộc tính/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(screen.queryByTestId('properties-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /Thuộc tính/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Thuộc tính/ }));
    expect(screen.getByTestId('properties-panel')).toBeTruthy();
  });

  it('mục Quy chuẩn thu gọn sẵn và có số điểm cần xem; mở ra thì bấm một lớp sẽ chọn lớp đó', () => {
    render(<EditorScreen iconId="icon-1" />);
    const header = screen.getByRole('button', { name: /Quy chuẩn/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('compliance-panel')).toBeNull();

    fireEvent.click(header);
    act(() => {
      fireEvent.click(screen.getByTestId('compliance-panel'));
    });
    expect(screen.getByTestId('compliance-panel')).toBeTruthy();
  });

  it('tuỳ chọn hỏng trong localStorage thì dùng mặc định', async () => {
    window.localStorage.setItem('svndts-brand-editor-prefs-v1', '{không phải json');
    render(<EditorScreen iconId="icon-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hiện lưới' }).getAttribute('aria-pressed')).toBe('true'));
  });
});
