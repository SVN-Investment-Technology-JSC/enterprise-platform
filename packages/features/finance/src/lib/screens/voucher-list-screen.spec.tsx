/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceCapabilities, FinanceVoucher, FinanceVoucherList, FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { installAntdEnv } from '../../test-support/antd-env';
import { financeDelete, financeFetch, financePost, financePut } from '../finance-api';
import { monthLabel, monthRange, shiftMonth, todayVn } from '../finance-format';
import VoucherListScreen, { bulkApproveBlockReason, initialMonth } from './voucher-list-screen';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery),
}));
let mockQuery = '';
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn(), financePost: jest.fn(), financePut: jest.fn(), financeDelete: jest.fn() };
});
let mockCapabilities: Partial<FinanceCapabilities> = {};
jest.mock('../finance-permissions', () => ({
  useFinancePermissions: () => ({ loading: false, error: null, capabilities: mockCapabilities, canOpenPage: () => true }),
}));
const mockDownload = jest.fn();
jest.mock('../finance-csv', () => {
  const actual = jest.requireActual('../finance-csv');
  return { ...actual, downloadCsv: (...args: unknown[]) => mockDownload(...args) };
});

installAntdEnv();

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;
const postMock = financePost as jest.MockedFunction<typeof financePost>;
const deleteMock = financeDelete as jest.MockedFunction<typeof financeDelete>;

const summary = (over: Partial<FinanceVoucherSummary>): FinanceVoucherSummary => ({
  id: 'v1',
  kind: 'RECEIPT',
  code: 'PT-2610-0001',
  voucherDate: '2026-10-14',
  postingDate: '2026-10-14',
  content: 'Thu tiền hàng',
  reasonId: 'r1',
  reasonName: 'Thu tiền hàng',
  accountId: 'a1',
  accountName: 'Vietcombank',
  destAccountId: null,
  destAccountName: null,
  counterpartyGroupName: 'Khách hàng',
  counterpartyName: null,
  totalAmount: 300_000,
  status: 'APPROVED',
  createdBy: 'u1',
  createdByName: 'Nguyễn Văn An',
  createdAt: '2026-10-14T02:00:00.000Z',
  updatedAt: '2026-10-14T02:00:00.000Z',
  submittedAt: null,
  decidedAt: null,
  approvalMode: 'DIRECT',
  allocation: null,
  draftCode: null,
  officialCode: 'PT-2610-0001',
  sourceCode: null,
  ...over,
});

function list(items: FinanceVoucherSummary[], counts: Partial<FinanceVoucherList['statusCounts']> = {}): FinanceVoucherList {
  const statusCounts = { DRAFT: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0, ...counts };
  const statusAmounts = { DRAFT: 0, PENDING: 50_000, APPROVED: 300_000, REJECTED: 0, CANCELLED: 0 };
  return { items, total: Object.values(statusCounts).reduce((a, b) => a + b, 0), page: 1, pageSize: 20, statusCounts, approvedTotal: 300_000, statusAmounts };
}

const paths = () => fetchMock.mock.calls.map(([path]) => String(path)).filter((p) => p.startsWith('/vouchers'));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = '';
  mockCapabilities = { receipt: { create: true, approve: false }, payment: { create: false, approve: true }, transfer: { create: false, approve: false } };
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/accounts')) return [{ id: 'a1', name: 'Vietcombank' }] as never;
    if (path.startsWith('/catalogs')) return { reasons: [{ id: 'r1', kind: 'RECEIPT', name: 'Thu tiền hàng' }], counterpartyGroups: [] } as never;
    if (path.startsWith('/workspace/projects')) return { items: [{ id: 'p1', code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' }], truncated: false } as never;
    if (path.startsWith('/vouchers')) return list([summary({}), summary({ id: 'v2', code: 'NHAP_PT_2610_0002', status: 'PENDING', totalAmount: 50_000 })], { APPROVED: 1, PENDING: 1 }) as never;
    throw new Error(`route lạ ${path}`);
  });
});

describe('Danh sách phiếu thu', () => {
  it('hiện tiêu đề, các tab trạng thái kèm số lượng và các dòng phiếu', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    expect(screen.getByRole('heading', { name: 'Danh sách phiếu thu' })).toBeTruthy();
    expect(await screen.findByText('PT-2610-0001')).toBeTruthy();
    // Chỉ hai trạng thái hiển thị: phiếu chờ duyệt tính vào "Nháp"; không còn tab Chờ duyệt, Từ chối, Đã huỷ.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Tất cả (2)', 'Nháp (1)', 'Đã duyệt (1)']);
    expect(screen.getByText('Hiển thị 1-2 / 2 bản ghi')).toBeTruthy();
    expect(screen.getByText('Đã duyệt', { selector: 'span' })).toBeTruthy();
  });

  it('đổi tab gửi trạng thái lên máy chủ và về trang 1; từ khoá tìm kiếm được gửi sau khi dừng gõ', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('tab', { name: 'Nháp (1)' }));
    await waitFor(() => expect(paths().some((p) => p.includes('status=DRAFT') && p.includes('kind=RECEIPT') && p.includes('page=1'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Tìm phiếu'), { target: { value: 'ABC' } });
    await waitFor(() => expect(paths().some((p) => p.includes('search=ABC'))).toBe(true));
  });

  it('bộ lọc tài khoản lấy từ liên kết đến từ danh sách tài khoản (?accountId=...)', async () => {
    mockQuery = 'accountId=a1';
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    expect(paths().some((p) => p.includes('accountId=a1'))).toBe(true);
  });

  it('nút Tạo mới chỉ hiện khi có quyền lập loại phiếu này; "Chờ tôi duyệt" chỉ hiện với người duyệt', async () => {
    const { unmount } = render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('button', { name: /Tạo mới/ }));
    expect(mockPush).toHaveBeenCalledWith('/receipts/new');
    expect(screen.queryByRole('button', { name: 'Chờ tôi duyệt' })).toBeNull();
    unmount();

    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findAllByText('PT-2610-0001');
    expect(screen.queryByRole('button', { name: /Tạo mới/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chờ tôi duyệt' }));
    await waitFor(() => expect(paths().some((p) => p.includes('scope=to-approve') && p.includes('kind=PAYMENT'))).toBe(true));
  });

  it('xuất Excel đúng các dòng đang hiện', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    const csv = String(mockDownload.mock.calls[0][1]);
    expect(csv).toContain('PT-2610-0001');
    expect(csv).toContain('NHAP_PT_2610_0002');
    expect(csv).toContain('Mã phiếu');
  });

  it('danh sách lệnh chuyển tiền hiện cột từ tài khoản đến tài khoản và không có cột lý do', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers'))
        return list([summary({ id: 't1', kind: 'TRANSFER', code: 'CT-2610-0001', accountName: 'Vietcombank', destAccountName: 'Quỹ tiền mặt', reasonName: null })], { APPROVED: 1 }) as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="TRANSFER" />);
    expect(await screen.findByText('Vietcombank → Quỹ tiền mặt')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Danh sách lệnh chuyển tiền' })).toBeTruthy();
    expect(screen.queryByText('Lý do chi')).toBeNull();
  });

  it('cột Hạch toán hiện dự án; lọc theo dự án gửi projectId lên máy chủ', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/accounts')) return [] as never;
      if (path.startsWith('/catalogs')) return { reasons: [], counterpartyGroups: [] } as never;
      if (path.startsWith('/workspace/projects')) return { items: [{ id: 'p1', code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' }], truncated: false } as never;
      return list(
        [
          summary({ allocation: { type: 'PROJECT', projectId: 'p1', projectCode: 'DA001', projectName: 'Trạm biến áp Đà Nẵng', workItemId: null, workItemCode: null, workItemTitle: null } }),
          summary({ id: 'v3', code: 'PT-2610-0003', allocation: null }),
        ],
        { APPROVED: 3 },
      ) as never;
    });
    render(<VoucherListScreen kind="RECEIPT" />);
    // Hạch toán chỉ hiện mã dự án cho gọn; tên đầy đủ khi rê chuột.
    expect((await screen.findByText('DA001')).getAttribute('title')).toBe('DA001 - Trạm biến áp Đà Nẵng');
    expect(screen.queryByText('DA001 - Trạm biến áp Đà Nẵng')).toBeNull();
    fireEvent.click(await screen.findByPlaceholderText('Mọi dự án'));
    fireEvent.click(await screen.findByRole('option', { name: /DA001/ }));
    await waitFor(() => expect(paths().some((p) => p.includes('projectId=p1'))).toBe(true));
  });

  it('lệnh chuyển tiền không có cột hạch toán và không có ô lọc dự án', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers')) return list([summary({ id: 't1', kind: 'TRANSFER', code: 'CT-2610-0001', accountName: 'VCB', destAccountName: 'Quỹ' })], { APPROVED: 1 }) as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="TRANSFER" />);
    await screen.findByText('VCB → Quỹ');
    expect(screen.queryByText('Hạch toán')).toBeNull();
    expect(screen.queryByPlaceholderText('Mọi dự án')).toBeNull();
    expect(fetchMock.mock.calls.some(([p]) => String(p).startsWith('/workspace'))).toBe(false);
  });

  it('báo lỗi khi tải thất bại và cho làm mới', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers')) throw new Error('Mất kết nối');
      return [] as never;
    });
    render(<VoucherListScreen kind="RECEIPT" />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Mất kết nối')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeTruthy();
  });
});

describe('Theo dõi theo tháng', () => {
  const thisMonth = todayVn().slice(0, 7);
  const lastCall = () => paths().at(-1) ?? '';

  it('mặc định xem tháng hiện tại: gửi khoảng ngày của tháng, hiện nhãn tháng và ẩn ô Từ ngày/Đến ngày', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    const { from, to } = monthRange(thisMonth);
    expect(paths()[0]).toContain(`from=${from}&to=${to}`);
    expect(screen.getByText(monthLabel(thisMonth))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Theo tháng' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Từ ngày')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Về tháng này' })).toBeNull();
  });

  it('chuyển tháng trước/sau gửi đúng khoảng ngày, về trang 1; "Về tháng này" quay lại tháng hiện tại', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    const previous = shiftMonth(thisMonth, -1);
    await waitFor(() => expect(lastCall()).toContain(`from=${monthRange(previous).from}&to=${monthRange(previous).to}`));
    expect(screen.getByText(monthLabel(previous))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    await waitFor(() => expect(lastCall()).toContain(`from=${monthRange(thisMonth).from}`));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Về tháng này' }));
    await waitFor(() => expect(lastCall()).toContain(`from=${monthRange(thisMonth).from}`));
  });

  it('chọn "Tất cả": bỏ giới hạn tháng, hiện lại ô lọc theo ngày; chọn "Theo tháng" quay về tháng hiện tại', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    await waitFor(() => expect(lastCall()).not.toContain('from='));
    expect(lastCall()).not.toContain('to=');
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tháng trước' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Theo tháng' }));
    await waitFor(() => expect(lastCall()).toContain(`from=${monthRange(thisMonth).from}`));
  });

  it('liên kết ?month=all (từ danh sách tài khoản) xem toàn bộ thời gian; ?month=YYYY-MM mở đúng tháng đó', async () => {
    mockQuery = 'accountId=a1&month=all';
    const { unmount } = render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    expect(paths()[0]).toContain('accountId=a1');
    expect(paths()[0]).not.toContain('from=');
    unmount();
    fetchMock.mockClear();
    mockQuery = 'month=2026-02';
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    expect(paths()[0]).toContain('from=2026-02-01&to=2026-02-28');
    expect(screen.getByText('Tháng 2/2026')).toBeTruthy();
  });

  it('thẻ tổng kết kỳ: tổng phiếu, đã duyệt và nháp (gồm chờ duyệt, bị từ chối) kèm số tiền', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers'))
        return {
          ...list([summary({})], { APPROVED: 3, PENDING: 2, DRAFT: 1, REJECTED: 1 }),
          statusAmounts: { DRAFT: 10_000, PENDING: 250_000, APPROVED: 1_200_000, REJECTED: 5_000, CANCELLED: 999_999 },
        } as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('PT-2610-0001');
    const card = (id: string) => screen.getByTestId(`summary-${id}`);
    expect(within(card('total')).getByText('7 phiếu')).toBeTruthy();
    expect(within(card('approved')).getByText('3 phiếu')).toBeTruthy();
    expect(within(card('approved')).getByText('1.200.000')).toBeTruthy();
    expect(screen.queryByTestId('summary-pending')).toBeNull();
    expect(within(card('open')).getByText('4 phiếu')).toBeTruthy();
    expect(within(card('open')).getByText('265.000')).toBeTruthy();
  });
});

describe('Menu chuột phải trên danh sách', () => {
  const NONE = {
    canEdit: false,
    canSubmit: false,
    canApprove: false,
    canReject: false,
    canCancel: false,
    canReverse: false,
    canDelete: false,
    canRetryProcedure: false,
    sourced: { canEditSourced: false, canPost: false, canReturnSource: false, canTakeOver: false, canRetryReversal: false },
  };
  const voucherDetail = (over: Partial<FinanceVoucher> = {}): FinanceVoucher => ({
    ...summary({}),
    counterpartyGroupId: 'g1',
    counterpartyAccountNo: null,
    counterpartyBank: null,
    allocation: null,
    taxIncluded: false,
    taxRate: 0,
    taxAmount: 0,
    note: null,
    decisionNote: null,
    decidedBy: null,
    decidedByName: null,
    revision: 1,
    lines: [],
    invoices: [],
    relatedProjects: [],
    attachments: [],
    events: [],
    posted: false,
    procedure: null,
    source: null,
    permissions: { ...NONE },
    ...over,
  });

  const withVoucherDetail = (detail: FinanceVoucher) => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === `/vouchers/${detail.id}`) return detail as never;
      if (path.startsWith('/accounts')) return [{ id: 'a1', name: 'Vietcombank' }] as never;
      if (path.startsWith('/catalogs')) return { reasons: [], counterpartyGroups: [] } as never;
      if (path.startsWith('/workspace/projects')) return { items: [], truncated: false } as never;
      if (path.startsWith('/vouchers')) return list([summary({})], { APPROVED: 1 }) as never;
      throw new Error(`route lạ ${path}`);
    });
  };

  const openMenuFor = async (text = 'PT-2610-0001') => {
    const row = await screen.findByText(text);
    fireEvent.contextMenu(row.closest('tr') as HTMLElement);
  };

  it('chỉ hiện đúng mục theo permissions của phiếu; Sửa điều hướng tới trang sửa', async () => {
    withVoucherDetail(voucherDetail({ permissions: { ...NONE, canEdit: true, canDelete: true } }));
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    expect(await screen.findByRole('menuitem', { name: 'Sửa' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Xoá' })).toBeNull(); // Huỷ thay cho Xoá
    expect(screen.queryByRole('menuitem', { name: /Duyệt ghi sổ/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Huỷ' })).toBeNull();
    // Nhân bản luôn hiện khi có quyền lập loại phiếu này (mockCapabilities.receipt.create = true).
    expect(screen.getByRole('menuitem', { name: 'Nhân bản' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sửa' }));
    expect(mockPush).toHaveBeenCalledWith('/receipts/v1/edit');
  });

  it('Nhân bản điều hướng tới form tạo mới kèm ?from=id', async () => {
    withVoucherDetail(voucherDetail());
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Nhân bản' }));
    expect(mockPush).toHaveBeenCalledWith('/receipts/new?from=v1');
  });

  it('Huỷ: chạy ngay không hỏi xác nhận hay lý do (xoá phiếu), rồi tải lại danh sách', async () => {
    withVoucherDetail(voucherDetail({ status: 'DRAFT', permissions: { ...NONE, canCancel: true } }));
    postMock.mockResolvedValue({ id: 'v1', code: 'NHAP_PT_2610_0001', deleted: true } as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    const before = paths().filter((p) => p.startsWith('/vouchers?')).length;
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Huỷ' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/cancel', {}));
    expect(screen.queryByRole('button', { name: 'Huỷ phiếu' })).toBeNull();
    expect(screen.queryByLabelText(/Lý do huỷ/)).toBeNull();
    await waitFor(() => expect(paths().filter((p) => p.startsWith('/vouchers?')).length).toBeGreaterThan(before));
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('Duyệt ghi sổ: gọi approve khi trực tiếp (kể cả phiếu nháp)', async () => {
    withVoucherDetail(voucherDetail({ status: 'DRAFT', permissions: { ...NONE, canApprove: true }, approvalMode: 'DIRECT' }));
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duyệt ghi sổ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/approve', { note: undefined }));
  });

  it('Duyệt ghi sổ qua quy trình: gọi procedure-action thay vì approve', async () => {
    withVoucherDetail(voucherDetail({ status: 'PENDING', permissions: { ...NONE, canApprove: true }, approvalMode: 'PROCEDURE' }));
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duyệt ghi sổ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock.mock.calls.some(([path]) => path === '/vouchers/v1/procedure-action')).toBe(true));
  });

  it('Duyệt ghi sổ phiếu có nguồn (từ hồ sơ): ghi sổ kèm phiên bản đang xem', async () => {
    withVoucherDetail(
      voucherDetail({
        status: 'DRAFT',
        approvalMode: 'INHERITED',
        revision: 4,
        permissions: { ...NONE, sourced: { ...NONE.sourced, canPost: true } },
      }),
    );
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duyệt ghi sổ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/post-sourced', { revision: 4 }));
  });

  it('chưa đủ thông tin: "Duyệt ghi sổ" hiện mờ kèm lý do, bấm không làm gì', async () => {
    withVoucherDetail(voucherDetail({ status: 'DRAFT', permissions: { ...NONE, approveBlockedReason: 'Chưa đủ thông tin để duyệt ghi sổ: Chọn tài khoản thu.' } }));
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    const entry = await screen.findByRole('menuitem', { name: /Duyệt ghi sổ/ });
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(entry.getAttribute('title')).toContain('Chọn tài khoản thu.');
    fireEvent.click(entry);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('Duyệt hàng loạt và cột hiển thị', () => {
  const putMock = financePut as jest.MockedFunction<typeof financePut>;
  const pendingList = () =>
    list(
      [
        summary({ id: 'p1', code: 'NHAP_PC_2610_0001', kind: 'PAYMENT', status: 'PENDING', officialCode: null }),
        summary({ id: 'p2', code: 'NHAP_PC_2610_0002', kind: 'PAYMENT', status: 'PENDING', officialCode: null }),
        summary({ id: 'p3', code: 'NHAP_PC_2610_0003', kind: 'PAYMENT', status: 'PENDING', approvalMode: 'PROCEDURE', officialCode: null }),
        summary({ id: 'p4', code: 'PC-2610-0004', kind: 'PAYMENT', status: 'APPROVED' }),
      ],
      { PENDING: 3, APPROVED: 1 },
    );

  beforeEach(() => {
    putMock.mockResolvedValue({} as never);
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/preferences/list-columns/PAYMENT')) return { listKey: 'PAYMENT', columns: null } as never;
      if (path.startsWith('/vouchers')) return pendingList() as never;
      return [] as never;
    });
  });

  it('chỉ chọn được phiếu nháp duyệt trực tiếp (chưa ghi sổ); duyệt các phiếu đã chọn một lượt và báo phiếu lỗi', async () => {
    postMock.mockResolvedValue({ approved: [{ id: 'p1', code: 'PC-2610-0010' }], failed: [{ id: 'p2', code: 'NHAP_PC_2610_0002', message: 'Không được tự duyệt phiếu do mình lập.' }] } as never);
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('NHAP_PC_2610_0001');
    expect((screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0003') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Chọn phiếu PC-2610-0004') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0001'));
    fireEvent.click(screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0002'));
    const bar = screen.getByRole('region', { name: 'Duyệt hàng loạt' });
    expect(within(bar).getByText('Đã chọn 2 phiếu nháp')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: /Duyệt 2 phiếu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/bulk-approve', { ids: ['p1', 'p2'] }));
    expect((await screen.findByRole('alert')).textContent).toContain('NHAP_PC_2610_0002: Không được tự duyệt phiếu do mình lập.');
  });

  it('phiếu biết chắc không duyệt được thì không chọn được, rê chuột thấy lý do; phiếu bị bỏ qua hiện thành danh sách kèm lý do', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/preferences/list-columns/PAYMENT')) return { listKey: 'PAYMENT', columns: null } as never;
      if (path.startsWith('/vouchers'))
        return list(
          [
            summary({ id: 'm1', code: 'NHAP_PC_2610_0011', kind: 'PAYMENT', status: 'DRAFT', officialCode: null, missingFields: ['account', 'counterpartyName'] }),
            summary({ id: 's1', code: 'NHAP_PC_2610_0012', kind: 'PAYMENT', status: 'DRAFT', officialCode: null, approvalMode: 'INHERITED', sourceCode: 'HS-01' }),
            summary({ id: 'ok', code: 'NHAP_PC_2610_0013', kind: 'PAYMENT', status: 'DRAFT', officialCode: null, missingFields: [] }),
          ],
          { DRAFT: 3 },
        ) as never;
      return [] as never;
    });
    postMock.mockResolvedValue({
      approved: [],
      failed: [{ id: 'ok', code: 'NHAP_PC_2610_0013', reason: 'FORBIDDEN', message: 'Không được tự duyệt phiếu do mình lập.' }],
    } as never);
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('NHAP_PC_2610_0011');
    const missing = screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0011') as HTMLInputElement;
    expect(missing.disabled).toBe(true);
    expect(missing.closest('[title]')?.getAttribute('title') ?? missing.getAttribute('title')).toContain('Còn thiếu: Tài khoản chi, Người nhận tiền.');
    // Phiếu từ hồ sơ quy trình đủ thông tin: chọn được, máy chủ ghi sổ qua đường của phiếu có nguồn.
    expect((screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0012') as HTMLInputElement).disabled).toBe(false);
    // Cột trạng thái báo phiếu còn thiếu thông tin.
    expect(screen.getByRole('img', { name: 'Thiếu thông tin' }).getAttribute('title')).toBe('Còn thiếu: Tài khoản chi, Người nhận tiền.');
    // Phiếu từ hồ sơ: không còn dòng "Từ hồ sơ ..." dưới mã, chỉ biểu tượng nhỏ kèm chú thích.
    expect(screen.getByRole('img', { name: 'Từ hồ sơ HS-01' }).getAttribute('title')).toBe('Từ hồ sơ HS-01');
    expect(screen.queryByText('Từ hồ sơ HS-01')).toBeNull();
    fireEvent.click(screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0013'));
    fireEvent.click(within(screen.getByRole('region', { name: 'Duyệt hàng loạt' })).getByRole('button', { name: /Duyệt 1 phiếu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const report = await screen.findByRole('alert', { name: 'Kết quả duyệt hàng loạt' });
    expect(report.textContent).toContain('Bỏ qua 1 phiếu chưa đủ điều kiện');
    expect(report.textContent).toContain('NHAP_PC_2610_0013 (Không được duyệt): Không được tự duyệt phiếu do mình lập.');
    // Đã bỏ chọn sau khi duyệt: thanh duyệt hàng loạt đóng lại.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Duyệt hàng loạt' })).toBeNull());
  });

  it('lý do không chọn được để duyệt hàng loạt', () => {
    expect(bulkApproveBlockReason(summary({ status: 'APPROVED' }))).toMatch(/đã duyệt/);
    expect(bulkApproveBlockReason(summary({ status: 'DRAFT', approvalMode: 'INHERITED' }))).toBeNull();
    expect(bulkApproveBlockReason(summary({ status: 'PENDING', approvalMode: 'PROCEDURE' }))).toMatch(/quy trình/);
    expect(bulkApproveBlockReason(summary({ status: 'REJECTED', approvalMode: 'PROCEDURE' }))).toBeNull();
    expect(bulkApproveBlockReason(summary({ status: 'DRAFT', kind: 'RECEIPT', missingFields: ['counterpartyName'] }))).toBe(
      'Chưa đủ thông tin để duyệt. Còn thiếu: Người nộp tiền.',
    );
    expect(bulkApproveBlockReason(summary({ status: 'PENDING' }))).toBeNull();
  });

  it('không có quyền duyệt thì không có ô chọn', async () => {
    mockCapabilities = { receipt: { create: true, approve: false }, payment: { create: true, approve: false }, transfer: { create: false, approve: false } };
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('NHAP_PC_2610_0001');
    expect(screen.queryByLabelText('Chọn phiếu NHAP_PC_2610_0001')).toBeNull();
  });

  it('cột đã lưu của người dùng: chỉ dự án và số tiền (kèm mã phiếu); bật thêm cột thì lưu lại', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/preferences/list-columns/PAYMENT')) return { listKey: 'PAYMENT', columns: ['project', 'amount'] } as never;
      if (path.startsWith('/vouchers')) return pendingList() as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('NHAP_PC_2610_0001');
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Lý do chi' })).toBeNull());
    expect(screen.getByRole('columnheader', { name: 'Dự án' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Số tiền' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Mã phiếu chi' })).toBeTruthy();

    // Cột "Người tạo" thêm sau khi người dùng đã lưu bộ cột: vẫn hiện vì bộ đã lưu không nhắc tới nó.
    expect(screen.getByRole('columnheader', { name: 'Người tạo' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Chọn cột hiển thị' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Người nhận tiền' }));
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/preferences/list-columns/PAYMENT', { columns: ['code', 'amount', 'person', 'project', 'created-by'] }),
    );
    expect(screen.getByRole('columnheader', { name: 'Người nhận tiền' })).toBeTruthy();
    // Bỏ chọn cột thêm sau: lưu dấu ẩn để cột không tự hiện lại.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Người tạo' }));
    await waitFor(() =>
      expect(putMock).toHaveBeenLastCalledWith('/preferences/list-columns/PAYMENT', { columns: ['code', 'amount', 'person', 'project', 'no-created-by'] }),
    );
    expect(screen.queryByRole('columnheader', { name: 'Người tạo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về mặc định' }));
    await waitFor(() => expect(putMock).toHaveBeenLastCalledWith('/preferences/list-columns/PAYMENT', { columns: null }));
    expect(screen.getByRole('columnheader', { name: 'Lý do chi' })).toBeTruthy();
  });
});

describe('Sắp xếp, cột Người tạo và cách hiện chữ', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('finance.voucher-list.cell-mode');
    } catch {
      /* bỏ qua */
    }
  });

  it('cột Người tạo hiện avatar kèm họ tên', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    expect(screen.getByRole('columnheader', { name: 'Người tạo' })).toBeTruthy();
    expect(screen.getAllByText('Nguyễn Văn An').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Nguyễn Văn An').length).toBeGreaterThan(0); // avatar
  });

  it('bấm tiêu đề cột thì sắp xếp ở máy chủ: tăng dần, giảm dần, rồi về mặc định; đổi cách sắp xếp về trang 1', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    const header = () => screen.getByRole('columnheader', { name: /Số tiền/ });
    fireEvent.click(header());
    await waitFor(() => expect(paths().at(-1)).toContain('sort=amount&direction=asc'));
    expect(paths().at(-1)).toContain('page=1');
    fireEvent.click(header());
    await waitFor(() => expect(paths().at(-1)).toContain('sort=amount&direction=desc'));
    fireEvent.click(header());
    await waitFor(() => expect(paths().at(-1)).not.toContain('sort='));
    fireEvent.click(screen.getByRole('columnheader', { name: /Người tạo/ }));
    await waitFor(() => expect(paths().at(-1)).toContain('sort=created-by&direction=asc'));
  });

  it('kéo mép tiêu đề cột để đổi bề ngang (không nhỏ hơn mức tối thiểu), nhớ theo loại phiếu; "Về mặc định" bỏ bề ngang đã kéo', async () => {
    localStorage.removeItem('finance.voucher-list.widths.RECEIPT');
    const { container } = render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    const handle = container.querySelector('[data-column-resize="amount"]') as HTMLElement;
    expect(handle).toBeTruthy();
    const before = paths().length;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('finance.voucher-list.widths.RECEIPT') ?? '{}')).toEqual({ amount: 184 }));
    // Kéo không kích hoạt sắp xếp.
    expect(paths().slice(before).some((p) => p.includes('sort='))).toBe(false);
    fireEvent.mouseDown(container.querySelector('[data-column-resize="amount"]') as HTMLElement, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: -500 });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('finance.voucher-list.widths.RECEIPT') ?? '{}')).toEqual({ amount: 90 }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn cột hiển thị' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Độ rộng và vị trí cột về mặc định' }));
    expect(localStorage.getItem('finance.voucher-list.widths.RECEIPT')).toBeNull();
  });

  it('mặc định xuống dòng để không mất chữ; chọn "Gọn một dòng" thì cắt kèm chú thích đủ chữ và nhớ lựa chọn', async () => {
    const { unmount } = render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    const contentCell = () => screen.getAllByText('Thu tiền hàng', { selector: 'td, td *' })[0].closest('td') as HTMLElement;
    expect(contentCell().className).not.toContain('ant-table-cell-ellipsis');
    fireEvent.click(screen.getByRole('button', { name: 'Chọn cột hiển thị' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Gọn một dòng' }));
    await waitFor(() => expect(contentCell().className).toContain('ant-table-cell-ellipsis'));
    expect(localStorage.getItem('finance.voucher-list.cell-mode')).toBe('compact');
    unmount();
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    expect(contentCell().className).toContain('ant-table-cell-ellipsis');
  });
});

describe('initialMonth', () => {
  it('đọc tham số month: all, tháng hợp lệ, hoặc mặc định tháng hiện tại', () => {
    expect(initialMonth('all', '2026-10-14')).toBe('');
    expect(initialMonth('2026-03', '2026-10-14')).toBe('2026-03');
    expect(initialMonth(null, '2026-10-14')).toBe('2026-10');
    expect(initialMonth('2026-13', '2026-10-14')).toBe('2026-10');
    expect(initialMonth('abc', '2026-10-14')).toBe('2026-10');
  });
});
