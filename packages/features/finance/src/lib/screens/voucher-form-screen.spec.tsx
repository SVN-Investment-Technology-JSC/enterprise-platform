/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import { financeFetch, financePost } from '../finance-api';
import VoucherFormScreen, { allocationFromQuery, allocationProblem, buildRequest } from './voucher-form-screen';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
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
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/catalogs')) return CATALOGS as never;
    if (path.startsWith('/accounts')) return [{ id: 'a1', code: 'VCB', name: 'Vietcombank', accountType: 'BANK', accountNumber: '001', isActive: true, balance: 5_000_000 }] as never;
    if (path.startsWith('/vouchers/next-code')) return { code: 'PT_5_10_2026' } as never;
    if (path === '/workspace/projects') return { items: PROJECTS, truncated: false } as never;
    if (path === '/workspace/projects/p1/work-items') return { items: WORK_ITEMS } as never;
    throw new Error(`route lạ ${path}`);
  });
  postMock.mockResolvedValue({ id: 'v1', code: 'PT_5_10_2026', revision: 1 } as FinanceVoucher as never);
});

describe('Form tạo phiếu thu', () => {
  it('hiện mã phiếu dự kiến, các nhãn theo loại phiếu và không dùng thẻ select tĩnh', async () => {
    const { container } = render(<VoucherFormScreen kind="RECEIPT" />);
    expect(await screen.findByDisplayValue('PT_5_10_2026')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tạo mới phiếu thu' })).toBeTruthy();
    for (const label of ['Nội dung thu', 'Lý do thu', 'Tài khoản thu', 'Đối tượng thu', 'Người nộp tiền', 'Hạch toán nội bộ', 'Ngày thu', 'Ngày hạch toán']) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(container.querySelector('select')).toBeNull();
  });

  it('tổng tiền và thuế tính theo số lượng nhân số tiền của từng dòng, cập nhật khi sửa và khi xoá dòng', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
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

  it('lưu nháp gửi đúng dữ liệu rồi chuyển tới trang chi tiết; lưu và gửi duyệt gọi thêm bước gửi duyệt', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu tiền hàng đợt 1' } });
    fireEvent.change(screen.getByLabelText('Diễn giải dòng 1'), { target: { value: 'Hàng A' } });
    fireEvent.change(screen.getByLabelText('Số tiền dòng 1'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/receipts/v1'));
    const [path, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/vouchers');
    expect(body).toMatchObject({ kind: 'RECEIPT', content: 'Thu tiền hàng đợt 1', lines: [{ description: 'Hàng A', quantity: 1, unitAmount: 120000, total: 120000 }] });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('lưu và gửi duyệt: lưu phiếu rồi gọi thêm bước gửi duyệt', async () => {
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu tiền hàng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock.mock.calls[0][0]).toBe('/vouchers');
    expect(postMock.mock.calls[1][0]).toBe('/vouchers/v1/submit');
    expect(mockPush).toHaveBeenCalledWith('/receipts/v1');
  });

  it('lỗi từ máy chủ hiện trên form (kèm từng điều kiện gửi duyệt chưa đạt) và không chuyển trang', async () => {
    const { FinanceApiError } = jest.requireActual('../finance-api') as typeof import('../finance-api');
    postMock.mockRejectedValueOnce(new FinanceApiError('Chọn lý do thu. Chọn tài khoản thu.', 422, 'FINANCE_SUBMIT_INVALID', ['Chọn lý do thu.', 'Chọn tài khoản thu.']));
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Chọn lý do thu.');
    expect(alert.textContent).toContain('Chọn tài khoản thu.');
    expect(mockPush).not.toHaveBeenCalled();
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
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu tiền dự án' } });
  };

  it('mặc định không hạch toán: chưa có ô dự án và công việc, không gửi hạch toán', async () => {
    await open();
    expect(screen.queryByPlaceholderText('Chọn dự án')).toBeNull();
    expect(screen.queryByPlaceholderText('Chọn công việc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toBeNull();
  });

  it('hạch toán cho dự án: chọn hình thức rồi dự án, gửi đúng dự án và không kèm công việc', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    expect(screen.queryByPlaceholderText('Chọn công việc')).toBeNull();
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toEqual({ type: 'PROJECT', projectId: 'p1', workItemId: null });
  });

  it('hạch toán cho công việc: công việc nạp theo dự án đã chọn, đổi dự án thì bỏ công việc cũ', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho công việc/);
    expect((screen.getByPlaceholderText('Chọn dự án trước') as HTMLInputElement).disabled).toBe(true);
    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    await pick(await screen.findByPlaceholderText('Chọn công việc'), /CV-2/);
    expect((screen.getByDisplayValue(/CV-2 - Đấu nối/) as HTMLInputElement).value).toContain('CV-2');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect((postMock.mock.calls[0][1] as Record<string, unknown>).allocation).toEqual({ type: 'WORK_ITEM', projectId: 'p1', workItemId: 'w2' });
  });

  it('chọn hình thức mà thiếu dự án hoặc công việc thì chặn lưu và báo rõ, không gọi máy chủ', async () => {
    await open();
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho dự án/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn dự án để hạch toán.');
    expect(postMock).not.toHaveBeenCalled();

    await pick(screen.getByPlaceholderText('Chọn dự án'), /DA001/);
    await pick(screen.getByPlaceholderText('Không hạch toán'), /Hạch toán cho công việc/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
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
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
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
      if (path.startsWith('/vouchers/next-code')) return { code: 'PT_5_10_2026' } as never;
      throw new Error('Workspace đang không khả dụng.');
    });
    await open();
    const typeInput = screen.getByPlaceholderText('Không hạch toán');
    await pick(typeInput, /Hạch toán cho dự án/);
    // Cùng một gợi ý ở ô Dự án và ở mục Đối tượng liên quan (mục này đang thu gọn).
    expect((await screen.findAllByText(/Workspace đang không khả dụng\. Phiếu vẫn lưu được/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn dự án để hạch toán.');
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(within(typeInput.parentElement as HTMLElement).getByRole('button', { name: 'Xoá tìm kiếm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
  });

  it('kiểm tra hạch toán chưa đủ thông tin', () => {
    expect(allocationProblem({ allocType: '', allocProjectId: '', allocWorkItemId: '' })).toBeNull();
    expect(allocationProblem({ allocType: 'PROJECT', allocProjectId: '', allocWorkItemId: '' })).toBe('Chọn dự án để hạch toán.');
    expect(allocationProblem({ allocType: 'PROJECT', allocProjectId: 'p1', allocWorkItemId: '' })).toBeNull();
    expect(allocationProblem({ allocType: 'WORK_ITEM', allocProjectId: 'p1', allocWorkItemId: '' })).toBe('Chọn công việc để hạch toán.');
    expect(allocationProblem({ allocType: 'WORK_ITEM', allocProjectId: 'p1', allocWorkItemId: 'w1' })).toBeNull();
  });

  it('điền sẵn hạch toán từ đường dẫn mở từ trang dự án; mã không hợp lệ thì bỏ qua', () => {
    const project = '8f14e45f-ceea-4e67-a3c9-5e1c1c3b0a11';
    const workItem = '0b8a6f1e-3c1d-4d6a-9d2e-7a1b2c3d4e5f';
    expect(allocationFromQuery(`?projectId=${project}`)).toEqual({ allocType: 'PROJECT', allocProjectId: project, allocWorkItemId: '' });
    expect(allocationFromQuery(`?projectId=${project}&workItemId=${workItem}`)).toEqual({ allocType: 'WORK_ITEM', allocProjectId: project, allocWorkItemId: workItem });
    expect(allocationFromQuery(`?projectId=${project}&workItemId=abc`)).toEqual({ allocType: 'PROJECT', allocProjectId: project, allocWorkItemId: '' });
    expect(allocationFromQuery('')).toBeNull();
    expect(allocationFromQuery('?projectId=<script>')).toBeNull();
    expect(allocationFromQuery(`?workItemId=${workItem}`)).toBeNull();
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
      return { id: 'v1', code: 'PT_5_10_2026', revision: 1 } as never;
    });
    mockUpload.mockImplementation(async (_id: string, f: File) => {
      order.push(`upload:${f.name}`);
      return { id: `id-${f.name}`, fileName: f.name, contentType: 'application/pdf', sizeBytes: f.size, uploadedBy: 'u', uploadedByName: 'An', uploadedAt: '2026-10-14T00:00:00.000Z' };
    });
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'Thu có chứng từ' } });
    await choose([file('hoa-don.pdf'), file('bien-ban.pdf')]);
    expect(screen.getAllByText('Sẽ tải lên khi lưu')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/receipts/v1'));
    expect(order).toEqual(['/vouchers', 'upload:hoa-don.pdf', 'upload:bien-ban.pdf', '/vouchers/v1/submit']);
  });

  it('tải tệp lỗi: phiếu đã lưu nhưng không gửi duyệt, không chuyển trang, tệp lỗi còn trong danh sách để thử lại', async () => {
    postMock.mockResolvedValue({ id: 'v1', code: 'PT_5_10_2026', revision: 1 } as never);
    mockUpload.mockImplementation(async (_id: string, f: File) => {
      if (f.name === 'loi.pdf') throw new Error('loi.pdf: không tải được tệp lên kho lưu trữ.');
      return { id: `id-${f.name}`, fileName: f.name, contentType: 'application/pdf', sizeBytes: f.size, uploadedBy: 'u', uploadedByName: 'An', uploadedAt: '2026-10-14T00:00:00.000Z' };
    });
    render(<VoucherFormScreen kind="RECEIPT" />);
    await screen.findByDisplayValue('PT_5_10_2026');
    fireEvent.change(screen.getByPlaceholderText('Nội dung thu'), { target: { value: 'x' } });
    await choose([file('tot.pdf'), file('loi.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và gửi duyệt' }));
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
    await screen.findByDisplayValue('PT_5_10_2026');
    await choose([new File([new Uint8Array(10)], 'virus.exe'), file('qua-lon.pdf', 10 * 1024 * 1024 + 1), file('hop-le.pdf')]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('virus.exe');
    expect(alert.textContent).toContain('qua-lon.pdf');
    expect(screen.getAllByText('Sẽ tải lên khi lưu')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ hop-le.pdf' }));
    expect(screen.queryByText('Sẽ tải lên khi lưu')).toBeNull();
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
    counterpartyName: 'ABC',
    counterpartyAccountNo: '',
    counterpartyBank: '',
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
      counterpartyAccountNo: null,
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
