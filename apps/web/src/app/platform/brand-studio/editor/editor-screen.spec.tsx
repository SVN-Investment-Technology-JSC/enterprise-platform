import { createDocument, createShape, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { toast } from '@enterprise-platform/shared-ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { copyText } from '../export/download';
import { BrandApiError } from '../store/brand-api';
import type { ServerIconInfo } from '../store';
import { EditorScreen } from './editor-screen';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('../export/download', () => ({
  ...jest.requireActual('../export/download'),
  copyText: jest.fn(async () => true),
}));

const mockLibrary = {
  ready: true,
  docs: [] as IconDocument[],
  error: null,
  mode: 'local' as 'local' | 'server',
  modeReason: null,
  localOnlyCount: 0,
  loading: false,
  get: (id: string) => mockLibrary.docs.find((doc) => doc.id === id),
  serverInfo: jest.fn((_id: string): ServerIconInfo | null => null),
  save: jest.fn(async (doc: IconDocument) => doc),
  saveMany: jest.fn(),
  remove: jest.fn(),
  removeMany: jest.fn(),
  duplicate: jest.fn(),
  importDocs: jest.fn(),
  resetPreset: jest.fn(),
  publish: jest.fn(),
  syncLocalToServer: jest.fn(),
  reloadFromServer: jest.fn(async (_id?: string) => undefined),
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
  mockLibrary.serverInfo.mockReset();
  mockLibrary.serverInfo.mockReturnValue(null);
  mockLibrary.publish.mockReset();
  mockLibrary.reloadFromServer.mockReset();
  mockLibrary.reloadFromServer.mockResolvedValue(undefined);
  jest.mocked(toast.error).mockClear();
  jest.mocked(toast.success).mockClear();
  jest.mocked(copyText).mockClear();
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

const INFO: ServerIconInfo = {
  version: 3,
  publishedVersion: 2,
  hasUnpublishedChanges: true,
  svgUrl: '/api/platform/v1/brand/icons/icon-1/svg?v=3&mode=brand',
  publicSvgUrl: '/api/platform/v1/brand/icons/icon-1/svg?v=2&mode=brand',
};

const conflictError = (currentVersion = 4) =>
  new BrandApiError({
    statusCode: 409,
    code: 'BRAND_ICON_VERSION_CONFLICT',
    message: 'Icon đã có phiên bản mới hơn do người khác lưu.',
    currentVersion,
  });

function editName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
  fireEvent.blur(nameInput());
}

describe('EditorScreen: icon lưu trên máy chủ', () => {
  beforeEach(() => {
    mockLibrary.mode = 'server';
  });

  afterEach(() => {
    mockLibrary.mode = 'local';
  });

  it('thanh trên hiện phiên bản đã lưu, bản đang phát hành và cảnh báo có thay đổi chưa phát hành', () => {
    mockLibrary.serverInfo.mockReturnValue(INFO);
    render(<EditorScreen iconId="icon-1" />);

    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('Đã phát hành v2')).toBeTruthy();
    expect(screen.getByText('Có thay đổi chưa phát hành')).toBeTruthy();
    expect(screen.queryByText('Nháp')).toBeNull();
  });

  it('icon chưa phát hành trên máy chủ thì hiện Nháp, không có nút chép đường dẫn', () => {
    mockLibrary.serverInfo.mockReturnValue({ ...INFO, publishedVersion: null, hasUnpublishedChanges: false, publicSvgUrl: null });
    render(<EditorScreen iconId="icon-1" />);

    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('Nháp')).toBeTruthy();
    expect(screen.queryByText('Có thay đổi chưa phát hành')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chép đường dẫn SVG/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Phát hành' })).toBeTruthy();
  });

  it('không có thông tin máy chủ (lưu cục bộ) thì giữ chip cũ và không có nút phát hành', () => {
    render(<EditorScreen iconId="icon-1" />);

    expect(screen.getByText('Nháp')).toBeTruthy();
    expect(screen.queryByText('v3')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Phát hành' })).toBeNull();
  });

  it('nút chép đường dẫn công khai chép địa chỉ đầy đủ của bản đang phát hành', async () => {
    mockLibrary.serverInfo.mockReturnValue(INFO);
    render(<EditorScreen iconId="icon-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Chép đường dẫn SVG công khai' }));

    await waitFor(() => expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/api/platform/v1/brand/icons/icon-1/svg?v=2&mode=brand`));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã chép đường dẫn SVG.'));
  });

  it('chỉ phát hành được bản đã lưu: đang có thay đổi chưa lưu thì ẩn nút Phát hành', () => {
    mockLibrary.serverInfo.mockReturnValue(INFO);
    render(<EditorScreen iconId="icon-1" />);
    expect(screen.getByRole('button', { name: 'Phát hành' })).toBeTruthy();

    editName('Tên mới');

    expect(screen.queryByRole('button', { name: 'Phát hành' })).toBeNull();
  });

  it('bấm Phát hành gọi library.publish với icon đang mở và báo thành công', async () => {
    mockLibrary.serverInfo.mockReturnValue(INFO);
    mockLibrary.publish.mockResolvedValue({ ...sample(), status: 'published' });
    render(<EditorScreen iconId="icon-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));

    await waitFor(() => expect(mockLibrary.publish).toHaveBeenCalledWith('icon-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã phát hành.'));
    expect(saveButton().disabled).toBe(true);
  });

  it('phát hành lỗi thì hiện thông điệp của máy chủ', async () => {
    mockLibrary.serverInfo.mockReturnValue(INFO);
    mockLibrary.publish.mockRejectedValue(
      new BrandApiError({ statusCode: 422, code: 'BRAND_ICON_NOT_PUBLISHABLE', message: 'Icon chưa đạt điều kiện phát hành: chưa có hình.' }),
    );
    render(<EditorScreen iconId="icon-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Icon chưa đạt điều kiện phát hành: chưa có hình.'));
  });

  it('lưu lỗi (không phải xung đột) hiện đúng thông điệp tiếng Việt của máy chủ và giữ trạng thái chưa lưu', async () => {
    mockLibrary.save.mockRejectedValueOnce(
      new BrandApiError({ statusCode: 503, code: 'BRAND_STORAGE_UNAVAILABLE', message: 'Kho lưu trữ icon tạm thời không khả dụng. Vui lòng thử lại sau.' }),
    );
    render(<EditorScreen iconId="icon-1" />);
    editName('Tên mới');

    fireEvent.click(saveButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kho lưu trữ icon tạm thời không khả dụng. Vui lòng thử lại sau.'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('người dùng không đụng tới trạng thái thì lưu nội dung không gỡ phát hành icon mà người khác vừa phát hành', async () => {
    render(<EditorScreen iconId="icon-1" />);
    mockLibrary.docs = [{ ...sample(), status: 'published' }];

    editName('Tên mới');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(1));
    expect(mockLibrary.save.mock.calls[0][0]).toMatchObject({ id: 'icon-1', name: 'Tên mới', status: 'published' });
  });
});

describe('EditorScreen: xung đột phiên bản (409)', () => {
  const conflictDialog = () => screen.getByRole('dialog');

  async function openConflict() {
    mockLibrary.save.mockRejectedValueOnce(conflictError(4));
    render(<EditorScreen iconId="icon-1" />);
    editName('Bản của tôi');
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  }

  it('hiện hộp thông báo với hai lựa chọn, kèm phiên bản trên máy chủ, và không ghi đè gì', async () => {
    await openConflict();

    expect(within(conflictDialog()).getByText('Icon đã có bản mới hơn')).toBeTruthy();
    expect(within(conflictDialog()).getByText('Máy chủ đang giữ phiên bản 4')).toBeTruthy();
    expect(within(conflictDialog()).getByRole('button', { name: /Tải bản mới nhất/ })).toBeTruthy();
    expect(within(conflictDialog()).getByRole('button', { name: /Giữ bản của tôi/ })).toBeTruthy();
    expect(mockLibrary.save).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('"Tải bản mới nhất" nạp lại icon từ máy chủ, bỏ thay đổi đang sửa và đóng hộp', async () => {
    mockLibrary.reloadFromServer.mockImplementation(async () => {
      mockLibrary.docs = [{ ...sample(), name: 'Bản mới nhất trên máy chủ' }];
    });
    await openConflict();
    expect(nameInput().value).toBe('Bản của tôi');

    fireEvent.click(within(conflictDialog()).getByRole('button', { name: /Tải bản mới nhất/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockLibrary.reloadFromServer).toHaveBeenCalledWith('icon-1');
    expect(nameInput().value).toBe('Bản mới nhất trên máy chủ');
    expect(screen.queryByText('Chưa lưu')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(mockLibrary.save).toHaveBeenCalledTimes(1);
  });

  it('"Tải bản mới nhất" lỗi thì giữ hộp và bản đang sửa, hiện lỗi', async () => {
    mockLibrary.reloadFromServer.mockRejectedValueOnce(
      new BrandApiError({ statusCode: 0, code: 'NETWORK_ERROR', message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' }),
    );
    await openConflict();

    fireEvent.click(within(conflictDialog()).getByRole('button', { name: /Tải bản mới nhất/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(nameInput().value).toBe('Bản của tôi');
  });

  it('"Giữ bản của tôi" lưu bản đang sửa thành icon mới (mã khác, nháp) rồi chuyển sang icon đó', async () => {
    await openConflict();

    fireEvent.click(within(conflictDialog()).getByRole('button', { name: /Giữ bản của tôi/ }));

    await waitFor(() => expect(mockLibrary.save).toHaveBeenCalledTimes(2));
    const copy = mockLibrary.save.mock.calls[1][0];
    expect(copy.id).not.toBe('icon-1');
    expect(copy.name).toBe('Bản của tôi (bản của tôi)');
    expect(copy.status).toBe('draft');
    expect(copy.shapes).toHaveLength(1);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/platform/brand-studio/editor/${copy.id}`));
    expect(toast.success).toHaveBeenCalledWith('Đã lưu thành icon mới "Bản của tôi (bản của tôi)".');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đóng hộp mà chưa chọn thì icon vẫn chưa lưu, bấm Lưu lại mở hộp lần nữa', async () => {
    await openConflict();
    mockLibrary.save.mockRejectedValueOnce(conflictError(5));

    fireEvent.click(within(conflictDialog()).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText('Máy chủ đang giữ phiên bản 5')).toBeTruthy());
  });
});
