/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import { financeFetch, financePost } from '../finance-api';
import VoucherFormScreen, { buildRequest } from './voucher-form-screen';

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
  costCenters: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/catalogs')) return CATALOGS as never;
    if (path.startsWith('/accounts')) return [{ id: 'a1', code: 'VCB', name: 'Vietcombank', accountType: 'BANK', accountNumber: '001', isActive: true, balance: 5_000_000 }] as never;
    if (path.startsWith('/vouchers/next-code')) return { code: 'PT_5_10_2026' } as never;
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
    costCenterId: '',
    taxIncluded: true,
    taxRate: 8,
    note: '',
    amount: 777,
    lines: [{ key: 1, description: 'A', quantity: 2, unitAmount: 100 }],
    invoices: [
      { key: 1, invoiceNo: 'HD1', invoiceDate: '', taxCode: '', amount: 5 },
      { key: 2, invoiceNo: '  ', invoiceDate: '', taxCode: '', amount: 0 },
    ],
    related: [{ key: 1, label: ' Hợp đồng 12 ' }, { key: 2, label: '' }],
  };

  it('phiếu thu/chi: gửi dòng chi tiết, bỏ hoá đơn trống, chuỗi rỗng thành null, không gửi tài khoản đích và số tiền', () => {
    const request = buildRequest('PAYMENT', base, 3);
    expect(request).toMatchObject({
      kind: 'PAYMENT',
      revision: 3,
      reasonId: 'r1',
      taxIncluded: true,
      taxRate: 8,
      costCenterId: null,
      counterpartyAccountNo: null,
      lines: [{ description: 'A', quantity: 2, unitAmount: 100, total: 200 }],
      invoices: [{ invoiceNo: 'HD1', invoiceDate: null, taxCode: null, amount: 5 }],
      related: [{ kind: 'REFERENCE', label: 'Hợp đồng 12' }],
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

  it('không gửi thuế suất khi không bật "Bao gồm thuế"', () => {
    expect(buildRequest('RECEIPT', { ...base, taxIncluded: false })).toMatchObject({ taxIncluded: false, taxRate: 0 });
  });
});
