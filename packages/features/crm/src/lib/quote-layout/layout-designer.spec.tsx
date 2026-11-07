/**
 * @jest-environment jsdom
 */
import { defaultQuoteLayout, type QuoteLayout, type QuoteTemplateLayout } from '@enterprise-platform/contracts-crm';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LayoutDesigner } from './layout-designer';

jest.mock('./layout-designer.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./quote-layout.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@enterprise-platform/shared-ui', () => ({
  toast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
  },
  SearchableSelect: ({ name, value, options, onChange }: { name?: string; value?: string; options: { value: string; label: string }[]; onChange?: (value: string) => void }) => (
    <div data-testid={`select-${name ?? 'none'}`} data-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange?.(option.value)}>
          {`${name ?? 'select'}:${option.label}`}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('../components/crm-ui', () => ({
  CrmDialog: ({
    open,
    title,
    children,
    notice,
    submitLabel = 'Lưu',
    cancelLabel = 'Huỷ',
    onClose,
    onSubmit,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    notice?: ReactNode;
    submitLabel?: string;
    cancelLabel?: string;
    onClose: () => void;
    onSubmit: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {notice}
        <button type="button" onClick={onClose}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    ) : null,
}));

jest.mock('./export-menu', () => ({
  ExportMenu: ({ fileName }: { fileName: string }) => <span data-testid="export-menu" data-file-name={fileName} />,
}));

const mockGet = jest.fn();
const mockSave = jest.fn();
const mockFields = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message || fallback,
  getQuoteTemplateLayout: (...args: unknown[]) => mockGet(...args),
  saveQuoteTemplateLayout: (...args: unknown[]) => mockSave(...args),
  listQuoteCustomFields: () => mockFields(),
}));

const mockClearLayoutCache = jest.fn();
jest.mock('./use-template-layout', () => ({
  clearTemplateLayoutCache: (...args: unknown[]) => mockClearLayoutCache(...args),
}));

// jsdom chưa có DragEvent: dùng MouseEvent để sự kiện kéo thả mang `clientY`.
if (typeof window.DragEvent === 'undefined') Object.defineProperty(window, 'DragEvent', { value: window.MouseEvent });

const TEMPLATE = { id: 't1', name: 'Báo giá thiết bị' };
const STORED_AT = '2026-11-06T09:00:00.000Z';

const stored = (layout: QuoteLayout | null, updatedAt: string | null = STORED_AT): QuoteTemplateLayout => ({ layout, updatedAt, updatedBy: layout ? 'u1' : null });

function smallLayout(): QuoteLayout {
  const layout = defaultQuoteLayout();
  return { ...layout, blocks: layout.blocks.filter((block) => ['title', 'lines', 'totals'].includes(block.id)) };
}

const blockIds = () => Array.from(document.querySelectorAll<HTMLElement>('[data-block-id]')).map((node) => node.dataset.blockId);
const blockNode = (id: string) => document.querySelector<HTMLElement>(`[data-block-id="${id}"]`) as HTMLElement;
const dataTransfer = () => ({ setData: jest.fn(), getData: jest.fn(), effectAllowed: 'all', dropEffect: 'none', types: [] as string[] });

async function open(layout: QuoteLayout | null = smallLayout(), props: { onClose?: () => void; onSaved?: () => void } = {}) {
  mockGet.mockResolvedValue(stored(layout, layout ? STORED_AT : null));
  const onClose = props.onClose ?? jest.fn();
  const onSaved = props.onSaved ?? jest.fn();
  render(<LayoutDesigner template={TEMPLATE} onClose={onClose} onSaved={onSaved} />);
  await screen.findByRole('navigation', { name: 'Thư viện khối' });
  return { onClose, onSaved };
}

const key = (init: KeyboardEventInit, target: Window | Element = window) => act(() => void fireEvent.keyDown(target, init));
const undoButton = () => screen.getByRole('button', { name: 'Hoàn tác' }) as HTMLButtonElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockFields.mockResolvedValue([]);
});

describe('LayoutDesigner: khung', () => {
  it('TC-DS-01: mẫu chưa có bố cục mở với bố cục mặc định, phủ toàn màn hình', async () => {
    await open(null);
    expect(mockGet).toHaveBeenCalledWith('t1');
    expect(blockIds()).toEqual(defaultQuoteLayout().blocks.map((block) => block.id));
    expect(screen.getByRole('dialog', { name: 'Thiết kế bố cục mẫu Báo giá thiết bị' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thiết lập trang' })).toBeTruthy();
    expect(screen.getByTestId('export-menu').dataset.fileName).toBe('Mau_Báo giá thiết bị');
  });

  it('lỗi tải hiện câu tiếng Việt và nút Thử lại', async () => {
    mockGet.mockRejectedValueOnce({ message: 'Không tìm thấy mẫu báo giá.' }).mockResolvedValueOnce(stored(smallLayout()));
    render(<LayoutDesigner template={TEMPLATE} onClose={jest.fn()} />);
    expect(await screen.findByText('Không tìm thấy mẫu báo giá.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('navigation', { name: 'Thư viện khối' });
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
  });

  it('TC-DS-02: đổi khổ, hướng, font, cỡ chữ, lề cập nhật trang ngay', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'paper:A3' }));
    fireEvent.click(screen.getByRole('button', { name: 'orientation:Ngang' }));
    fireEvent.click(screen.getByRole('button', { name: 'fontFamily:Arial' }));
    fireEvent.click(screen.getByRole('button', { name: 'fontSizePt:12 pt' }));
    const sheet = document.querySelector<HTMLElement>('[data-paper]') as HTMLElement;
    expect(sheet.dataset.paper).toBe('A3');
    expect(sheet.dataset.orientation).toBe('landscape');
    expect(sheet.style.fontFamily).toContain('Arial');
    fireEvent.click(screen.getByRole('button', { name: 'Lề' }));
    const popover = screen.getByRole('dialog', { name: 'Lề trang (mm)' });
    fireEvent.change(within(popover).getByLabelText('Lề trái'), { target: { value: '30' } });
    expect(sheet.style.padding).toContain('30mm');
    fireEvent.change(within(popover).getByLabelText('Lề trái'), { target: { value: '60' } });
    expect(within(popover).getByRole('alert').textContent).toBe('Nhập số từ 5 đến 40 mm.');
    expect(sheet.style.padding).toContain('30mm');
  });

  it('công tắc Dữ liệu mẫu: bật thì chip hiện giá trị mẫu, tắt thì hiện {{tên biến}}', async () => {
    await open(null);
    const toggle = screen.getByRole('switch', { name: 'Dữ liệu mẫu' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-variable="customer.name"]')?.textContent).toBe('Công ty TNHH Xây dựng Minh Phát');
    fireEvent.click(toggle);
    expect(document.querySelector('[data-variable="customer.name"]')?.textContent).toBe('{{customer.name}}');
  });
});

describe('LayoutDesigner: thêm, sửa khối', () => {
  it('TC-DS-03: bấm khi đang chọn khối 2 thì thêm ngay sau; không chọn thì thêm cuối; khối mới được chọn', async () => {
    await open();
    fireEvent.click(blockNode('lines'));
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Đường kẻ/ }));
    expect(blockIds()).toEqual(['title', 'lines', 'divider', 'totals']);
    expect(screen.getByRole('heading', { name: /Đường kẻ/ })).toBeTruthy();
    fireEvent.click(screen.getByTestId('layout-page').querySelector('[data-paper]') as HTMLElement);
    expect(screen.getByRole('heading', { name: 'Thiết lập trang' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Đoạn văn/ }));
    expect(blockIds().at(-1)).toBe('text');
    expect(screen.getByRole('heading', { name: /Đoạn văn/ })).toBeTruthy();
  });

  it('TC-DS-03, TC-DS-04: kéo từ thư viện thả đúng khe; kéo đổi thứ tự; thả ngoài trang không đổi', async () => {
    await open();
    document.querySelectorAll<HTMLElement>('[data-block-id]').forEach((node, index) => {
      node.getBoundingClientRect = () => ({ top: index * 100, bottom: index * 100 + 100, height: 100, left: 0, right: 500, width: 500, x: 0, y: index * 100, toJSON: () => ({}) });
    });
    const page = screen.getByTestId('layout-page');
    const palette = screen.getByRole('button', { name: /Thêm khối Đoạn văn/ });
    const transfer = dataTransfer();
    fireEvent.dragStart(palette, { dataTransfer: transfer });
    fireEvent.dragOver(blockNode('lines'), { dataTransfer: transfer, clientY: 120 });
    expect(blockNode('lines').className).toContain('dropBefore');
    fireEvent.drop(blockNode('lines'), { dataTransfer: transfer, clientY: 120 });
    fireEvent.dragEnd(palette, { dataTransfer: transfer });
    expect(blockIds()).toEqual(['title', 'text', 'lines', 'totals']);

    // Khung khối vừa dựng lại: gắn lại vị trí giả.
    document.querySelectorAll<HTMLElement>('[data-block-id]').forEach((node, index) => {
      node.getBoundingClientRect = () => ({ top: index * 100, bottom: index * 100 + 100, height: 100, left: 0, right: 500, width: 500, x: 0, y: index * 100, toJSON: () => ({}) });
    });
    const move = dataTransfer();
    fireEvent.dragStart(blockNode('totals'), { dataTransfer: move });
    fireEvent.dragOver(page, { dataTransfer: move, clientY: 10 });
    fireEvent.drop(page, { dataTransfer: move, clientY: 10 });
    fireEvent.dragEnd(blockNode('totals'), { dataTransfer: move });
    expect(blockIds()).toEqual(['totals', 'title', 'text', 'lines']);

    const outside = dataTransfer();
    fireEvent.dragStart(blockNode('lines'), { dataTransfer: outside });
    fireEvent.dragEnd(blockNode('lines'), { dataTransfer: outside });
    expect(blockIds()).toEqual(['totals', 'title', 'text', 'lines']);
  });

  it('thanh nhỏ của khối: lên, xuống, nhân đôi, xoá', async () => {
    await open();
    fireEvent.click(blockNode('lines'));
    const toolbar = screen.getByRole('toolbar', { name: 'Thao tác khối' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Đưa khối lên' }));
    expect(blockIds()).toEqual(['lines', 'title', 'totals']);
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Đưa khối xuống' }));
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Nhân đôi khối' }));
    expect(blockIds()).toEqual(['title', 'lines', 'lines-2', 'totals']);
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Xoá khối' }));
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
    expect(screen.getByRole('heading', { name: 'Thiết lập trang' })).toBeTruthy();
  });

  it('TC-DS-10: Delete, Ctrl+Z, Ctrl+Shift+Z, Alt+↑/↓; trong ô chữ thì không xoá khối', async () => {
    await open();
    fireEvent.click(blockNode('totals'));
    key({ key: 'ArrowUp', altKey: true });
    expect(blockIds()).toEqual(['title', 'totals', 'lines']);
    key({ key: 'ArrowDown', altKey: true });
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
    fireEvent.click(blockNode('title'));
    const input = screen.getByLabelText('Tiêu đề') as HTMLInputElement;
    key({ key: 'Delete' }, input);
    key({ key: 'z', ctrlKey: true }, input);
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
    key({ key: 'Delete' });
    expect(blockIds()).toEqual(['lines', 'totals']);
    expect(screen.getByRole('heading', { name: 'Thiết lập trang' })).toBeTruthy();
    key({ key: 'z', ctrlKey: true });
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
    key({ key: 'z', metaKey: true });
    expect(blockIds()).toEqual(['title', 'totals', 'lines']);
    key({ key: 'Z', ctrlKey: true, shiftKey: true });
    key({ key: 'Z', ctrlKey: true, shiftKey: true });
    expect(blockIds()).toEqual(['lines', 'totals']);
  });

  it('TC-DS-06: xoá hết khối thì có gợi ý "Kéo khối vào đây", Lưu báo lỗi bố cục rỗng', async () => {
    await open();
    for (const id of ['title', 'lines', 'totals']) {
      fireEvent.click(blockNode(id));
      key({ key: 'Delete' });
    }
    expect(blockIds()).toEqual([]);
    expect(screen.getByText(/Kéo khối vào đây/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Bố cục còn 1 lỗi/)).toBeTruthy();
  });

  it('TC-DS-09: gõ liên tiếp vào tên công ty, hoàn tác 1 lần về giá trị trước khi gõ', async () => {
    await open(null);
    fireEvent.click(blockNode('company'));
    const name = screen.getByLabelText('Tên công ty') as HTMLInputElement;
    for (const value of ['C', 'Cô', 'Công', 'Công ty', 'Công ty ABC']) fireEvent.change(name, { target: { value } });
    expect(blockNode('company').textContent).toContain('Công ty ABC');
    fireEvent.click(undoButton());
    expect((screen.getByLabelText('Tên công ty') as HTMLInputElement).value).toBe('TÊN CÔNG TY');
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-DS-12: cỡ chữ tiêu đề 50 bị chặn ở ô kèm thông báo; 24 thì áp dụng', async () => {
    await open();
    fireEvent.click(blockNode('title'));
    const size = screen.getByLabelText('Cỡ chữ (pt)');
    fireEvent.change(size, { target: { value: '50' } });
    expect(screen.getByText('Nhập số từ 12 đến 32 pt.')).toBeTruthy();
    expect(undoButton().disabled).toBe(true);
    fireEvent.change(size, { target: { value: '24' } });
    expect(undoButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Căn phải' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viết hoa toàn bộ' }));
    expect(blockNode('title').querySelector('[class*="alignRight"]')).toBeTruthy();
  });

  it('TC-DS-13: độ rộng tổng 90 báo lỗi tại ô; chia đều về 100; ẩn hết cột báo lỗi và chặn Lưu', async () => {
    await open();
    fireEvent.click(blockNode('lines'));
    fireEvent.change(screen.getByLabelText('Độ rộng cột Tên hàng hoá, dịch vụ (%)'), { target: { value: '20' } });
    expect(screen.getByText('Tổng độ rộng các cột đang hiện phải là 100% (đang là 90%).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chia đều độ rộng' }));
    expect(screen.getByText('Tổng độ rộng các cột đang hiện: 100%.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nhãn cột 3'), { target: { value: 'Tên hàng' } });
    expect(blockNode('lines').textContent).toContain('Tên hàng');
    for (const checkbox of screen.getAllByRole('checkbox', { name: /^Hiện cột/ }) as HTMLInputElement[]) {
      if (checkbox.checked) fireEvent.click(checkbox);
    }
    expect(screen.getByText('Bảng phải có ít nhất một cột hiện.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('khối tổng: bật cả Thuế GTGT và Thuế tổng đơn thì có ghi chú hiện hai lần (D3-16)', async () => {
    await open();
    fireEvent.click(blockNode('totals'));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hiện dòng Thuế tổng đơn' }));
    expect(screen.getByRole('note').textContent).toContain('hiện hai lần');
  });
});

describe('LayoutDesigner: lưu, đóng, xung đột', () => {
  it('TC-DS-18: còn lỗi thì không gọi API, khối lỗi được đánh dấu, bấm lỗi thì chọn khối', async () => {
    await open();
    fireEvent.click(blockNode('lines'));
    fireEvent.change(screen.getByLabelText('Độ rộng cột Tên hàng hoá, dịch vụ (%)'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('layout-page').querySelector('[data-paper]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Ảnh/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalled();
    expect(screen.getByText(/Bố cục còn 2 lỗi/)).toBeTruthy();
    expect(blockNode('lines').className).toContain('blockInvalid');
    expect(blockNode('image').className).toContain('blockInvalid');
    const panel = screen.getByText(/Bố cục còn 2 lỗi/).closest('div') as HTMLElement;
    const links = within(panel).getAllByRole('button');
    fireEvent.click(links[0]);
    expect(screen.getByRole('heading', { name: /Bảng dòng hàng/ })).toBeTruthy();
  });

  it('TC-DS-17: lưu gửi expectedUpdatedAt, toast, báo màn gọi; lần lưu sau gửi mốc mới', async () => {
    const { onSaved } = await open();
    mockSave.mockResolvedValueOnce(stored(smallLayout(), '2026-11-06T10:00:00.001Z')).mockResolvedValueOnce(stored(smallLayout(), '2026-11-06T10:05:00.000Z'));
    fireEvent.click(blockNode('title'));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'BẢNG BÁO GIÁ' } });
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(mockSave).toHaveBeenCalledWith('t1', { layout: expect.objectContaining({ version: 1 }), expectedUpdatedAt: STORED_AT });
    expect((mockSave.mock.calls[0][1] as { layout: QuoteLayout }).layout.blocks[0]).toMatchObject({ text: 'BẢNG BÁO GIÁ' });
    expect(mockToast.success).toHaveBeenCalledWith('Đã lưu bố cục mẫu "Báo giá thiết bị".');
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Màn báo giá trong cùng phiên đọc lại bố cục mới thay vì bản đã cache.
    expect(mockClearLayoutCache).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('Chưa lưu')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(mockSave.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: '2026-11-06T10:00:00.001Z' });
  });

  it('TC-DS-19: 409 hỏi tải lại; có nút xuất JSON trước; Tải lại thì đọc bản mới', async () => {
    await open();
    mockSave.mockRejectedValueOnce({ statusCode: 409, code: 'LAYOUT_CONFLICT', message: 'Mẫu vừa được người khác sửa. Tải lại để xem bản mới.' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Mẫu vừa được người khác sửa' });
    expect(within(dialog).getByRole('button', { name: /Xuất JSON bản đang sửa/ })).toBeTruthy();
    const newer = defaultQuoteLayout();
    mockGet.mockResolvedValueOnce(stored(newer, '2026-11-06T11:00:00.000Z'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tải lại' }));
    });
    await waitFor(() => expect(blockIds()).toEqual(newer.blocks.map((block) => block.id)));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('413 (kể cả trang lỗi HTML của gateway) báo "Bố cục quá lớn."; 400 kèm lỗi thì đánh dấu khối', async () => {
    await open();
    mockSave.mockRejectedValueOnce({ statusCode: 413 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(mockToast.error).toHaveBeenCalledWith('Bố cục quá lớn.');
    mockSave.mockRejectedValueOnce({
      statusCode: 400,
      code: 'LAYOUT_TOO_LARGE',
      message: 'Bố cục vượt 1 MB.',
      errors: [{ path: 'blocks[1]', code: 'LAYOUT_TOO_LARGE', message: 'Khối 2 quá lớn.' }],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(mockToast.error).toHaveBeenLastCalledWith('Bố cục vượt 1 MB.');
    expect(screen.getByText('Khối 2 quá lớn.')).toBeTruthy();
    expect(blockNode('lines').className).toContain('blockInvalid');
  });

  it('TC-DS-20: không đổi thì đóng ngay; có thay đổi thì hỏi, Huỷ ở lại, Bỏ thay đổi thì đóng', async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Đường kẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Bỏ các thay đổi chưa lưu?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(blockIds()).toContain('divider');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('TC-DS-21: có thay đổi chưa lưu thì beforeunload hỏi; hoàn tác về như cũ thì thôi', async () => {
    await open();
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Đường kẻ/ }));
    expect(fire()).toBe(true);
    fireEvent.click(undoButton());
    expect(fire()).toBe(false);
  });

  it('TC-DS-22: khôi phục mặc định thay bố cục đang sửa, hoàn tác được; Xoá bố cục hỏi rồi gửi null', async () => {
    const { onSaved } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Khôi phục bố cục mặc định/ }));
    expect(blockIds()).toEqual(defaultQuoteLayout().blocks.map((block) => block.id));
    expect(mockSave).not.toHaveBeenCalled();
    fireEvent.click(undoButton());
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);

    mockSave.mockResolvedValueOnce(stored(null, '2026-11-06T12:00:00.000Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Xoá bố cục/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Xoá bố cục của mẫu?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Xoá bố cục' }));
    });
    expect(mockSave).toHaveBeenCalledWith('t1', { layout: null, expectedUpdatedAt: STORED_AT });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(blockIds()).toEqual(defaultQuoteLayout().blocks.map((block) => block.id));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    expect((screen.getByRole('menuitem', { name: /Xoá bố cục/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-P3PERM-03 (phía web): lưu bị 403 thì báo lỗi của server, không đổi trạng thái đã lưu', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Thêm khối Đường kẻ/ }));
    mockSave.mockRejectedValueOnce({ statusCode: 403, code: 'FORBIDDEN', message: 'Bạn không có quyền quản trị bán hàng.' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    });
    expect(mockToast.error).toHaveBeenCalledWith('Bạn không có quyền quản trị bán hàng.');
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });
});

describe('LayoutDesigner: nhập, xuất JSON', () => {
  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it('TC-DS-23: xuất JSON tải Mau_<tên mẫu>.layout.json chứa bố cục hợp lệ', async () => {
    await open();
    let blob: Blob | undefined;
    const create = jest.fn((value: Blob) => {
      blob = value;
      return 'blob:layout';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
    const downloads: string[] = [];
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Xuất JSON/ }));
    expect(downloads).toEqual(['Mau_Báo giá thiết bị.layout.json']);
    const parsed = JSON.parse(await readBlob(blob as Blob)) as QuoteLayout;
    expect(parsed.blocks.map((block) => block.id)).toEqual(['title', 'lines', 'totals']);
    click.mockRestore();
  });

  const importFile = async (content: string, size?: number, name = 'bo-cuc.json') => {
    const file = new File([content], name, { type: 'application/json' });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    await act(async () => {
      fireEvent.change(screen.getByTestId('layout-import-input'), { target: { files: [file] } });
    });
  };

  it('TC-DS-24: nhập JSON hợp lệ thay bố cục đang sửa, chưa lưu, hoàn tác được', async () => {
    await open();
    await importFile(JSON.stringify(defaultQuoteLayout()));
    await waitFor(() => expect(blockIds()).toEqual(defaultQuoteLayout().blocks.map((block) => block.id)));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
    fireEvent.click(undoButton());
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
  });

  it('TC-DS-25: file không phải JSON, rỗng, cắt dở báo "File không phải bố cục mẫu hợp lệ."', async () => {
    await open();
    for (const content of ['PK\u0003\u0004 docx', '', '{"version":1,"blocks":[']) {
      await importFile(content);
      expect(await screen.findByText('File không phải bố cục mẫu hợp lệ.')).toBeTruthy();
      expect(blockIds()).toEqual(['title', 'lines', 'totals']);
      fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    }
  });

  it('TC-DS-26: JSON sai cấu trúc liệt kê lỗi tiếng Việt, không thay bố cục', async () => {
    await open();
    await importFile(JSON.stringify({ ...defaultQuoteLayout(), version: 2 }));
    const panel = await screen.findByRole('alert', { name: 'Lỗi nhập bố cục' });
    expect(panel.textContent).toContain('Bố cục trong file có lỗi');
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(blockIds()).toEqual(['title', 'lines', 'totals']);
  });

  it('TC-DS-27: file 3 MB báo "File vượt 2 MB." trước khi đọc nội dung', async () => {
    await open();
    const read = jest.spyOn(FileReader.prototype, 'readAsText');
    await importFile('{}', 3 * 1024 * 1024);
    expect(screen.getByText('File vượt 2 MB.')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});
