/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import { financeFetch, financePost } from '../finance-api';
import VoucherFormScreen, { allocationProblem, buildRequest } from './voucher-form-screen';

const mockPush = jest.fn();
let mockQuery = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery),
}));
const mockUpload = jest.fn();
jest.mock('../attachment-upload', () => {
  const actual = jest.requireActual('../attachment-upload');
  return { ...actual, uploadFinanceAttachment: (...args: unknown[]) => mockUpload(...args), removeFinanceAttachment: jest.fn() };
});
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn(), financePost: jest.fn(), financePut: jest.fn() };
});

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;
const postMock = financePost as jest.MockedFunction<typeof financePost>;

const CATALOGS = {
  reasons: [{ id: 'r1', kind: 'RECEIPT', code: 'THU', name: 'Thu tiền hàng', isActive: true, note: null }],
  counterpartyGroups: [{ id: 'g1', code: 'KH', name: 'Khách hàng', isActive: true }],
};

const PROJECTS = [
  { id: 'p1', code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' },
  { id: 'p2', code: 'DA002', name: 'Đường dây 110kV', status: 'planning' },
];
const WORK_ITEMS = [
  { id: 'w1', code: 'CV-1', title: 'Lắp đặt tủ điện', status: 'in_progress', depth: 0 },
  { id: 'w2', code: 'CV-2', title: 'Đấu nối', status: 'todo', depth: 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = '';
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/catalogs')) return CATALOGS as never;
    if (path.startsWith('/accounts')) return [{ id: 'a1', code: 'VCB', name: 'Vietcombank', accountType: 'BANK', accountNumber: '001', isActive: true, balance: 5_000_000 }] as never;
    if (path.startsWith('/vouchers/next-code')) return { code: 'NHAP_PT_2610_0005' } as never;
    if (path === '/workspace/projects') return { items: PROJECTS, truncated: false } as never;
    if (path === '/workspace/projects/p1/work-items') return { items: WORK_ITEMS } as never;
    throw new Error(`route lạ ${path}`);
  });
  postMock.mockResolvedValue({ id: 'v1', code: 'NHAP_PT_2610_0005', revision: 1, status: 'DRAFT' } as FinanceVoucher as never);
});

describe('Form tạo phiếu thu', () => {
  it('hiện mã phiếu dự kiến, các nhãn theo loại phiếu và không dùng thẻ select tĩnh', async () => {
    const { container } = render(<VoucherFormScreen kind="RECEIPT" />);
    expect(await screen.findByDisplayValue('NHAP_PT_2610_0005')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tạo mới phiếu thu' })).toBeTruthy();
    for (const label of ['Nội dung thu', 'Lý do thu', 'Tài khoản thu', 'Đối tượng thu', 'Hạch toán nội bộ', 'Ngày thu', 'Ngày hạch toán']) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(container.querySelector('select')).toBeNull();
  });

  it('dán ảnh vào Ghi chú: ảnh tự chuyển sang mục Đính kèm (chờ tải lên khi lưu), ngay cả khi phiếu chưa lưu', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    const note = document.querySelector('.finance-note-prose') as HTMLElement;
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    fireEvent.paste(note, { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } });
    const list = await screen.findByRole('list', { name: 'Tệp đính kèm' });
    expect(within(list).getByText(/^anh-dan-\d+-1\.png$/)).toBeTruthy();
    expect(within(list).getByText('Sẽ tải lên khi lưu')).toBeTruthy();
    expect(note.querySelector('img')).toBeNull();
  });

  it('tổng tiền và thuế tính theo số lượng nhân số tiền của từng dòng, cập nhật khi sửa và khi xoá dòng', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByLabelText('Số lượng dòng 1'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Số tiền dòng 1'), { target: { value: '150.000' } });
    expect(screen.getByLabelText('Thành tiền dòng 1').textContent).toBe('300.000');
    expect(screen.getByTestId('voucher-total').textContent).toBe('300.000');

    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    fireEvent.change(screen.getByLabelText('Số tiền dòng 2'), { target: { value: '50000' } });
    expect(screen.getByTestId('voucher-total').textContent).toBe('350.000');

    fireEvent.click(screen.getByLabelText('Bao gồm thuế'));
    fireEvent.change(screen.getByLabelText('Thuế suất (%)'), { target: { value: '10' } });
    expect(screen.getByText(/Trong đó thuế: 31\.818,18/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Xoá dòng 2' }));
    expect(screen.getByTestId('voucher-total').textContent).toBe('300.000');
    expect((screen.getByRole('button', { name: 'Xoá dòng 1' }) as HTMLButtonElement).disabled).toBe(true); // luôn còn ít nhất một dòng
  });

  it('gửi duyệt: lưu phiếu rồi gọi thêm bước gửi duyệt, chuyển tới trang chi tiết', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu tiền hàng đợt 1' } });
    fireEvent.change(screen.getByLabelText('Diễn giải dòng 1'), { target: { value: 'Hàng A' } });
    fireEvent.change(screen.getByLabelText('Số tiền dòng 1'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const [path, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/vouchers');
    expect(body).toMatchObject({ kind: 'RECEIPT', content: 'Thu tiền hàng đợt 1', lines: [{ description: 'Hàng A', quantity: 1, unitAmount: 120000, total: 120000 }] });
    expect(postMock.mock.calls[1][0]).toBe('/vouchers/v1/submit');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/receipts/v1'));
  });

  it('lỗi từ máy chủ hiện trên form (kèm từng điều kiện gửi duyệt chưa đạt) và không chuyển trang', async () => {
    const { FinanceApiError } = jest.requireActual('../finance-api') as typeof import('../finance-api');
    postMock.mockRejectedValueOnce(new FinanceApiError('Chọn lý do thu. Chọn tài khoản thu.', 422, 'FINANCE_SUBMIT_INVALID', ['Chọn lý do thu.', 'Chọn tài khoản thu.']));
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Chọn lý do thu.');
    expect(alert.textContent).toContain('Chọn tài khoản thu.');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('nhân bản (?from=id): điền sẵn dữ liệu phiếu nguồn, lấy mã mới và đặt lại ngày hôm nay, không copy tệp đính kèm', async () => {
    mockQuery = 'from=src1';
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/vouchers/src1')
        return {
          id: 'src1',
          kind: 'RECEIPT',
          voucherDate: '2026-09-01',
          postingDate: '2026-09-01',
          content: 'Thu tiền hàng gốc',
          reasonId: 'r1',
          accountId: 'a1',
          destAccountId: null,
          counterpartyGroupId: 'g1',
          allocation: null,
          taxIncluded: false,
          taxRate: 0,
          note: '',
          totalAmount: 500_000,
          lines: [{ id: 'l1', lineNo: 1, description: 'Hàng gốc', quantity: 1, unitAmount: 500_000, total: 500_000 }],
          invoices: [],
          relatedProjects: [],
          attachments: [{ id: 'att1', fileName: 'cu.pdf', contentType: 'application/pdf', sizeBytes: 10, uploadedBy: null, uploadedByName: null, uploadedAt: '2026-09-01T00:00:00.000Z', purpose: 'ATTACHMENT' }],
        } as never;
      if (path.startsWith('/catalogs')) return CATALOGS as never;
      if (path.startsWith('/accounts')) return [{ id: 'a1', code: 'VCB', name: 'Vietcombank', accountType: 'BANK', accountNumber: '001', isActive: true, balance: 5_000_000 }] as never;
      if (path.startsWith('/vouchers/next-code')) return { code: 'PT_9_10_2026' } as never;
      if (path === '/workspace/projects') return { items: PROJECTS, truncated: false } as never;
      throw new Error(`route lạ ${path}`);
    });
    render(<VoucherFormScreen kind="RECEIPT" />);
    // Mã phiếu lấy mới, không phải mã (hay nội dung) hiển thị như đang sửa phiếu nguồn.
    expect(await screen.findByDisplayValue('PT_9_10_2026')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tạo mới phiếu thu' })).toBeTruthy();
    expect((screen.getByPlaceholderText('Nội dung thu') as HTMLInputElement).value).toBe('Thu tiền hàng gốc');
    expect((screen.getByLabelText('Diễn giải dòng 1') as HTMLInputElement).value).toBe('Hàng gốc');
    expect(screen.getByTestId('voucher-total').textContent).toBe('500.000');
    // Ngày đặt lại hôm nay (giả lập hiện tại là 2026-10-14 ở các test khác), không giữ ngày của phiếu nguồn.
    expect(screen.queryByDisplayValue('01/09/2026')).toBeNull();
    // Không copy tệp đính kèm của phiếu nguồn.
    expect(screen.queryByText('cu.pdf')).toBeNull();
  });
});

/** Mở danh sách của ô SearchableSelect rồi chọn một mục theo tên. */
async function pick(input: HTMLElement, name: RegExp) {
  fireEvent.click(input);
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('Hạch toán nội bộ và dự án liên quan', () => {
  const open = async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu tiền dự án' } });
  };

  it('mặc định không hạch toán: chưa có ô dự án và công việc, không gửi hạch toán', async () => {
    await open();
    expect(screen.queryByPlaceholderText('Chọn dự án')).toBeNull();
    expect(screen.queryByPlaceholderText('Chọn công việc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toBeNull();
  });

  it('hạch toán cho dự án: chọn hình thức rồi dự án, gửi đúng dự án và không kèm công việc', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    expect(screen.queryByPlaceholderText('Chọn công việc')).toBeNull();
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toEqual({ type: 'PROJECT', projectId: 'p1', workItemId: null });
  });

  it('hạch toán cho công việc: công việc nạp theo dự án đã chọn, đổi dự án thì bỏ công việc cũ', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho công việc/);
    expect((screen.getByPlaceholderText('Chọn dự án trước') as HTMLInputElement).disabled).toBe(true);
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    await pick(await screen.findByPlaceholderText('Chọn công việc'), /CV-2/);
    expect((screen.getByDisplayValue(/CV-2 - Đấu nối/) as HTMLInputElement).value).toContain('CV-2');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toEqual({ type: 'WORK_ITEM', projectId: 'p1', workItemId: 'w2' });
  });

  it('chọn hình thức mà thiếu dự án hoặc công việc thì chặn lưu và báo rõ, không gọi máy chủ', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn dự án để hạch toán.');
    expect(postMock).not.toHaveBeenCalled();

    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho công việc/);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Chọn công việc để hạch toán.'));
    expect(postMock).not.toHaveBeenCalled();
  });

  it('bỏ hạch toán thì bỏ luôn dự án đã chọn', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    const typeInput = screen.getByPlaceholderText('Không hạch toán');
    fireEvent.click(within(typeInput.parentElement as HTMLElement).getByRole('button', { name: 'Xoá tìm kiếm' }));
    expect(screen.queryByPlaceholderText('Chọn dự án')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toBeNull();
  });

  it('đối tượng liên quan là dự án: thêm nhiều dự án, không thêm trùng, bỏ từng dự án, gửi danh sách id', async () => {
    await open();
    fireEvent.click(screen.getByText('Đối tượng liên quan'));
    await pick(screen.getByPlaceholderText('Chọn dự án liên quan'), /DA002/);
    await pick(screen.getByPlaceholderText('Chọn dự án liên quan'), /DA001/);
    const chips = screen.getByRole('list', { name: 'Dự án liên quan' });
    expect(chips.textContent).toContain('DA001 - Trạm biến áp Đà Nẵng');
    expect(chips.textContent).toContain('DA002 - Đường dây 110kV');
    // Dự án đã chọn không còn trong danh sách để thêm lần nữa.
    fireEvent.click(screen.getByPlaceholderText('Chọn dự án liên quan'));
    expect(screen.queryByRole('option', { name: /DA001/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Bỏ dự án liên quan DA001/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).relatedProjectIds).toEqual(['p2']);
  });

  it('dự án đang hạch toán không xuất hiện trong danh sách dự án liên quan', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    fireEvent.click(screen.getByText('Đối tượng liên quan'));
    fireEvent.click(screen.getByPlaceholderText('Chọn dự án liên quan'));
    expect(screen.queryByRole('option', { name: /DA001/ })).toBeNull();
    expect(screen.getByRole('option', { name: /DA002/ })).toBeTruthy();
  });

  it('Workspace không khả dụng: báo ở ô dự án, chặn lưu khi đã chọn hạch toán, bỏ hạch toán thì phiếu vẫn lưu được', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/catalogs')) return CATALOGS as never;
      if (path.startsWith('/accounts')) return [] as never;
      if (path.startsWith('/vouchers/next-code')) return { code: 'NHAP_PT_2610_0005' } as never;
      throw new Error('Workspace đang không khả dụng.');
    });
    await open();
    const typeInput = screen.getByPlaceholderText('Không hạch toán');
    await pick(typeInput, /Hạch toán cho dự án/);
    // Cùng một gợi ý ở ô Dự án và ở mục Đối tượng liên quan (mục này đang thu gọn).
    expect((await screen.findAllByText(/Workspace đang không khả dụng\. Phiếu vẫn lưu được/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn dự án để hạch toán.');
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(within(typeInput.parentElement as HTMLElement).getByRole('button', { name: 'Xoá tìm kiếm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
  });

  it('kiểm tra hạch toán chưa đủ thông tin', () => {
    expect(allocationProblem({ allocType: '', allocProjectId: '', allocWorkItemId: '' })).toBeNull();
    expect(allocationProblem({ allocType: 'PROJECT', allocProjectId: '', allocWorkItemId: '' })).toBe('Chọn dự án để hạch toán.');
    expect(allocationProblem({ allocType: 'PROJECT', allocProjectId: 'p1', allocWorkItemId: '' })).toBeNull();
    expect(allocationProblem({ allocType: 'WORK_ITEM', allocProjectId: 'p1', allocWorkItemId: '' })).toBe('Chọn công việc để hạch toán.');
    expect(allocationProblem({ allocType: 'WORK_ITEM', allocProjectId: 'p1', allocWorkItemId: 'w1' })).toBeNull();
  });

});

describe('Đính kèm trong form', () => {
  const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });
  const choose = async (files: File[]) => {
    fireEvent.change(await screen.findByLabelText('Chọn tệp đính kèm'), { target: { files } });
  };

  it('tệp chọn trước được tải lên SAU khi lưu và TRƯỚC khi gửi duyệt', async () => {
    const order: string[] = [];
    postMock.mockImplementation(async (path: string) => {
      order.push(path);
      return { id: 'v1', code: 'NHAP_PT_2610_0005', revision: 1 } as never;
    });
    mockUpload.mockImplementation(async (_id: string, f: File) => {
      order.push(`upload:${f.name}`);
      return { id: `id-${f.name}`, fileName: f.name, contentType: 'application/pdf', sizeBytes: f.size, uploadedBy: 'u', uploadedByName: 'An', uploadedAt: '2026-10-14T00:00:00.000Z', purpose: 'ATTACHMENT' as const };
    });
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu có chứng từ' } });
    await choose([file('hoa-don.pdf'), file('bien-ban.pdf')]);
    expect(screen.getAllByText('Sẽ tải lên khi lưu')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/receipts/v1'));
    expect(order).toEqual(['/vouchers', 'upload:hoa-don.pdf', 'upload:bien-ban.pdf', '/vouchers/v1/submit']);
  });

  it('tải tệp lỗi: phiếu đã lưu nhưng không gửi duyệt, không chuyển trang, tệp lỗi còn trong danh sách để thử lại', async () => {
    postMock.mockResolvedValue({ id: 'v1', code: 'NHAP_PT_2610_0005', revision: 1 } as never);
    mockUpload.mockImplementation(async (_id: string, f: File) => {
      if (f.name === 'loi.pdf') throw new Error('loi.pdf: không tải được tệp lên kho lưu trữ.');
      return { id: `id-${f.name}`, fileName: f.name, contentType: 'application/pdf', sizeBytes: f.size, uploadedBy: 'u', uploadedByName: 'An', uploadedAt: '2026-10-14T00:00:00.000Z', purpose: 'ATTACHMENT' as const };
    });
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'x' } });
    await choose([file('tot.pdf'), file('loi.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('đã được lưu nhưng 1 tệp chưa tải lên được');
    expect(alert.textContent).toContain('loi.pdf');
    expect(postMock.mock.calls.map(([path]) => path)).toEqual(['/vouchers']); // chưa gọi /submit
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Gỡ tot.pdf' })).toBeTruthy(); // tệp tốt đã lưu
    expect(screen.getByText('Sẽ tải lên khi lưu')).toBeTruthy(); // tệp lỗi còn chờ
  });

  it('tệp sai định dạng hoặc quá lớn bị chặn ngay lúc chọn và không vào danh sách', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('NHAP_PT_2610_0005');
    await choose([new File([new Uint8Array(10)], 'virus.exe'), file('qua-lon.pdf', 10 * 1024 * 1024 + 1), file('hop-le.pdf')]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('virus.exe');
    expect(alert.textContent).toContain('qua-lon.pdf');
    expect(screen.getAllByText('Sẽ tải lên khi lưu')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ hop-le.pdf' }));
    expect(screen.queryByText('Sẽ tải lên khi lưu')).toBeNull();
  });
});

describe('Form phiếu tạo từ hồ sơ quy trình', () => {
  const sourced = {
    id: 'v9',
    kind: 'RECEIPT',
    code: 'NHAP_PT_2610_0009',
    voucherDate: '2026-10-14',
    postingDate: '2026-10-14',
    content: 'Thu tiền hợp đồng',
    reasonId: null,
    accountId: null,
    counterpartyGroupId: null,
    allocation: null,
    taxIncluded: false,
    taxRate: 0,
    note: null,
    revision: 3,
    approvalMode: 'INHERITED',
    lines: [{ id: 'l1', lineNo: 1, description: 'Thu tiền hợp đồng', quantity: 1, unitAmount: 2_000_000, total: 2_000_000 }],
    invoices: [],
    relatedProjects: [],
    attachments: [],
    source: { instanceId: 'i9', instanceCode: 'PR-0009', definitionName: 'Thu tiền hợp đồng', lockedFields: ['amount', 'content'] },
    permissions: { canEdit: false, sourced: { canEditSourced: true, canPost: true, canReturnSource: true, canTakeOver: false, canRetryReversal: false } },
  } as unknown as FinanceVoucher;

  it('trường lấy từ hồ sơ bị khoá, dòng chi tiết chỉ xem, không có Lưu và gửi duyệt; phần kế toán vẫn nhập được', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/catalogs')) return CATALOGS as never;
      if (path.startsWith('/accounts')) return [] as never;
      if (path === '/vouchers/v9') return sourced as never;
      if (path === '/workspace/projects') return { items: PROJECTS, truncated: false } as never;
      throw new Error(`route lạ ${path}`);
    });
    render(<VoucherFormScreen kind="RECEIPT" id="v9" />);
    expect((await screen.findByRole('note')).textContent).toContain('PR-0009');
    for (const input of screen.getAllByDisplayValue('Thu tiền hợp đồng')) expect((input as HTMLInputElement).disabled).toBe(true); // nội dung và diễn giải dòng
    expect((screen.getByLabelText('Số tiền dòng 1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Thêm dòng/ })).toBeNull();
    expect(screen.getByText('Dòng chi tiết và số tiền lấy từ hồ sơ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu và gửi duyệt' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeTruthy();
    expect(document.querySelector('.finance-note-prose')?.getAttribute('contenteditable')).toBe('true');
  });

  it('không được nhập (không được giao bước): báo chỉ kế toán đang được giao mới nhập được', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/catalogs')) return CATALOGS as never;
      if (path.startsWith('/accounts')) return [] as never;
      if (path === '/vouchers/v9') return { ...sourced, permissions: { canEdit: false, sourced: { canEditSourced: false } } } as never;
      if (path === '/workspace/projects') return { items: PROJECTS, truncated: false } as never;
      throw new Error(`route lạ ${path}`);
    });
    render(<VoucherFormScreen kind="RECEIPT" id="v9" />);
    expect((await screen.findByRole('alert')).textContent).toContain('chỉ kế toán đang được giao bước Tài chính');
  });
});

describe('Form lệnh chuyển tiền', () => {
  it('chỉ có hai tài khoản và số tiền, không có chi tiết dòng hay lý do thu chi', async () => {
    render(<VoucherFormScreen kind="TRANSFER" />);
    expect(await screen.findByRole('heading', { name: 'Tạo mới phiếu chuyển tiền' })).toBeTruthy();
    expect(screen.getAllByText('Tài khoản nguồn', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tài khoản đích', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Diễn giải dòng 1')).toBeNull();
    expect(screen.queryByText('Lý do chi')).toBeNull();
  });
});

describe('buildRequest', () => {
  const base = {
    voucherDate: '2026-10-14',
    postingDate: '2026-10-14',
    content: 'Nội dung',
    reasonId: 'r1',
    accountId: 'a1',
    destAccountId: 'a2',
    counterpartyGroupId: 'g1',
    allocType: '' as '' | 'PROJECT' | 'WORK_ITEM',
    allocProjectId: '',
    allocWorkItemId: '',
    taxIncluded: true,
    taxRate: 8,
    note: '',
    amount: 777,
    lines: [{ key: 1, description: 'A', quantity: 2, unitAmount: 100 }],
    invoices: [
      { key: 1, invoiceNo: 'HD1', invoiceDate: '', taxCode: '', amount: 5 },
      { key: 2, invoiceNo: '  ', invoiceDate: '', taxCode: '', amount: 0 },
    ],
    relatedProjectIds: ['p2', 'p3'],
  };

  it('phiếu thu/chi: gửi dòng chi tiết, bỏ hoá đơn trống, chuỗi rỗng thành null, không gửi tài khoản đích và số tiền', () => {
    const request = buildRequest('PAYMENT', base, 3);
    expect(request).toMatchObject({
      kind: 'PAYMENT',
      revision: 3,
      reasonId: 'r1',
      taxIncluded: true,
      taxRate: 8,
      allocation: null,
      lines: [{ description: 'A', quantity: 2, unitAmount: 100, total: 200 }],
      invoices: [{ invoiceNo: 'HD1', invoiceDate: null, taxCode: null, amount: 5 }],
      relatedProjectIds: ['p2', 'p3'],
    });
    expect(request).not.toHaveProperty('amount');
    expect(request).not.toHaveProperty('destAccountId');
  });

  it('lệnh chuyển tiền: gửi tài khoản đích và số tiền, không gửi dòng chi tiết hay lý do', () => {
    const request = buildRequest('TRANSFER', base);
    expect(request).toMatchObject({ kind: 'TRANSFER', accountId: 'a1', destAccountId: 'a2', amount: 777 });
    expect(request).not.toHaveProperty('lines');
    expect(request).not.toHaveProperty('reasonId');
  });

  it('hạch toán: dự án không kèm công việc; công việc kèm dự án; bỏ hình thức thì không gửi', () => {
    expect(buildRequest('PAYMENT', { ...base, allocType: 'PROJECT', allocProjectId: 'p1', allocWorkItemId: 'w-cu' })).toMatchObject({
      allocation: { type: 'PROJECT', projectId: 'p1', workItemId: null },
    });
    expect(buildRequest('PAYMENT', { ...base, allocType: 'WORK_ITEM', allocProjectId: 'p1', allocWorkItemId: 'w1' })).toMatchObject({
      allocation: { type: 'WORK_ITEM', projectId: 'p1', workItemId: 'w1' },
    });
    expect(buildRequest('PAYMENT', { ...base, allocType: '', allocProjectId: 'p1' })).toMatchObject({ allocation: null });
  });

  it('lệnh chuyển tiền không gửi hạch toán nhưng vẫn gửi dự án liên quan', () => {
    const request = buildRequest('TRANSFER', { ...base, allocType: 'PROJECT', allocProjectId: 'p1' });
    expect(request).not.toHaveProperty('allocation');
    expect(request).toMatchObject({ relatedProjectIds: ['p2', 'p3'] });
  });

  it('không gửi thuế suất khi không bật "Bao gồm thuế"', () => {
    expect(buildRequest('RECEIPT', { ...base, taxIncluded: false })).toMatchObject({ taxIncluded: false, taxRate: 0 });
  });
});
