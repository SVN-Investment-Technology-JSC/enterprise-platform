/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceCapabilities, FinanceVoucher, FinanceVoucherList, FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { installAntdEnv } from '../../test-support/antd-env';
import { financeDelete, financeFetch, financePost, financePut } from '../finance-api';
import { monthLabel, monthRange, shiftMonth, todayVn } from '../finance-format';
import VoucherListScreen, { initialMonth } from './voucher-list-screen';

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
    expect(screen.getByRole('tab', { name: 'Tất cả (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chờ duyệt (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Đã duyệt (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Nháp (0)' })).toBeTruthy();
    expect(screen.getByText('Hiển thị 1-2 / 2 bản ghi')).toBeTruthy();
    expect(screen.getByText('Đã duyệt', { selector: 'span' })).toBeTruthy();
  });

  it('đổi tab gửi trạng thái lên máy chủ và về trang 1; từ khoá tìm kiếm được gửi sau khi dừng gõ', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT-2610-0001');
    fireEvent.click(screen.getByRole('tab', { name: 'Chờ duyệt (1)' }));
    await waitFor(() => expect(paths().some((p) => p.includes('status=PENDING') && p.includes('kind=RECEIPT') && p.includes('page=1'))).toBe(true));
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

  it('cột Hạch toán hiện dự án hoặc công việc; lọc theo dự án gửi projectId lên máy chủ', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/accounts')) return [] as never;
      if (path.startsWith('/catalogs')) return { reasons: [], counterpartyGroups: [] } as never;
      if (path.startsWith('/workspace/projects')) return { items: [{ id: 'p1', code: 'DA001', name: 'Trạm biến áp Đà Nẵng', status: 'active' }], truncated: false } as never;
      return list(
        [
          summary({ allocation: { type: 'PROJECT', projectId: 'p1', projectCode: 'DA001', projectName: 'Trạm biến áp Đà Nẵng', workItemId: null, workItemCode: null, workItemTitle: null } }),
          summary({
            id: 'v2',
            code: 'NHAP_PT_2610_0002',
            allocation: { type: 'WORK_ITEM', projectId: 'p1', projectCode: 'DA001', projectName: 'Trạm biến áp Đà Nẵng', workItemId: 'w1', workItemCode: 'CV-12', workItemTitle: 'Lắp đặt tủ điện' },
          }),
          summary({ id: 'v3', code: 'PT-2610-0003', allocation: null }),
        ],
        { APPROVED: 3 },
      ) as never;
    });
    render(<VoucherListScreen kind="RECEIPT" />);
    expect(await screen.findByText('DA001 - Trạm biến áp Đà Nẵng')).toBeTruthy();
    expect(screen.getByText('CV-12 - Lắp đặt tủ điện (DA001)')).toBeTruthy();
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

  it('thẻ tổng kết kỳ: tổng phiếu, đã duyệt, chờ duyệt kèm số tiền; nháp và bị từ chối gộp một thẻ', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers'))
        return {
          ...list([summary({})], { APPROVED: 3, PENDING: 2, DRAFT: 1, REJECTED: 1, CANCELLED: 4 }),
          statusAmounts: { DRAFT: 10_000, PENDING: 250_000, APPROVED: 1_200_000, REJECTED: 5_000, CANCELLED: 999_999 },
        } as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('PT-2610-0001');
    const card = (id: string) => screen.getByTestId(`summary-${id}`);
    expect(within(card('total')).getByText('11 phiếu')).toBeTruthy();
    expect(within(card('approved')).getByText('3 phiếu')).toBeTruthy();
    expect(within(card('approved')).getByText('1.200.000')).toBeTruthy();
    expect(within(card('pending')).getByText('2 phiếu')).toBeTruthy();
    expect(within(card('pending')).getByText('250.000')).toBeTruthy();
    expect(within(card('open')).getByText('2 phiếu')).toBeTruthy();
    expect(within(card('open')).getByText('15.000')).toBeTruthy();
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
    expect(await screen.findByRole('menuitem', { name: 'Xoá' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Duyệt' })).toBeNull();
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

  it('Xoá: xác nhận rồi gọi xoá phiếu và tải lại danh sách', async () => {
    withVoucherDetail(voucherDetail({ permissions: { ...NONE, canDelete: true } }));
    deleteMock.mockResolvedValue(undefined as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Xoá' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/vouchers/v1'));
  });

  it('Huỷ: bắt buộc nhập lý do mới xác nhận được', async () => {
    withVoucherDetail(voucherDetail({ permissions: { ...NONE, canCancel: true } }));
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Huỷ' }));
    const confirmBtn = (await screen.findByRole('button', { name: 'Huỷ phiếu' })) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Lý do huỷ/), { target: { value: 'Nhập nhầm' } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/cancel', { note: 'Nhập nhầm' }));
  });

  it('Duyệt: gọi approve khi trực tiếp, procedure-action khi qua quy trình', async () => {
    withVoucherDetail(voucherDetail({ permissions: { ...NONE, canApprove: true }, approvalMode: 'DIRECT' }));
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duyệt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/v1/approve', { note: undefined }));
  });

  it('Duyệt qua quy trình: gọi procedure-action thay vì approve', async () => {
    withVoucherDetail(voucherDetail({ permissions: { ...NONE, canApprove: true }, approvalMode: 'PROCEDURE' }));
    postMock.mockResolvedValue({} as never);
    render(<VoucherListScreen kind="RECEIPT" />);
    await openMenuFor();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duyệt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock.mock.calls.some(([path]) => path === '/vouchers/v1/procedure-action')).toBe(true));
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

  it('chỉ chọn được phiếu chờ duyệt trực tiếp; duyệt các phiếu đã chọn một lượt và báo phiếu lỗi', async () => {
    postMock.mockResolvedValue({ approved: [{ id: 'p1', code: 'PC-2610-0010' }], failed: [{ id: 'p2', code: 'NHAP_PC_2610_0002', message: 'Không được tự duyệt phiếu do mình lập.' }] } as never);
    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findByText('NHAP_PC_2610_0001');
    expect((screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0003') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Chọn phiếu PC-2610-0004') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0001'));
    fireEvent.click(screen.getByLabelText('Chọn phiếu NHAP_PC_2610_0002'));
    const bar = screen.getByRole('region', { name: 'Duyệt hàng loạt' });
    expect(within(bar).getByText('Đã chọn 2 phiếu chờ duyệt')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: /Duyệt 2 phiếu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/vouchers/bulk-approve', { ids: ['p1', 'p2'] }));
    expect((await screen.findByRole('alert')).textContent).toContain('NHAP_PC_2610_0002: Không được tự duyệt phiếu do mình lập.');
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

    fireEvent.click(screen.getByRole('button', { name: 'Chọn cột hiển thị' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Người nhận tiền' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/preferences/list-columns/PAYMENT', { columns: ['code', 'person', 'project', 'amount'] }));
    expect(screen.getByRole('columnheader', { name: 'Người nhận tiền' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Về mặc định' }));
    await waitFor(() => expect(putMock).toHaveBeenLastCalledWith('/preferences/list-columns/PAYMENT', { columns: null }));
    expect(screen.getByRole('columnheader', { name: 'Lý do chi' })).toBeTruthy();
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
