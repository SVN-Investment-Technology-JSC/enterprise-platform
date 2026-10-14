/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceCapabilities, FinanceVoucherList, FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { installAntdEnv } from '../../test-support/antd-env';
import { financeFetch } from '../finance-api';
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
  return { ...actual, financeFetch: jest.fn() };
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

const summary = (over: Partial<FinanceVoucherSummary>): FinanceVoucherSummary => ({
  id: 'v1',
  kind: 'RECEIPT',
  code: 'PT_1_10_2026',
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
  counterpartyName: 'Công ty ABC',
  totalAmount: 300_000,
  status: 'APPROVED',
  createdBy: 'u1',
  createdByName: 'Nguyễn Văn An',
  createdAt: '2026-10-14T02:00:00.000Z',
  updatedAt: '2026-10-14T02:00:00.000Z',
  submittedAt: null,
  decidedAt: null,
  approvalMode: 'DIRECT',
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
    if (path.startsWith('/catalogs')) return { reasons: [{ id: 'r1', kind: 'RECEIPT', name: 'Thu tiền hàng' }], counterpartyGroups: [], costCenters: [] } as never;
    if (path.startsWith('/vouchers')) return list([summary({}), summary({ id: 'v2', code: 'PT_2_10_2026', status: 'PENDING', totalAmount: 50_000 })], { APPROVED: 1, PENDING: 1 }) as never;
    throw new Error(`route lạ ${path}`);
  });
});

describe('Danh sách phiếu thu', () => {
  it('hiện tiêu đề, các tab trạng thái kèm số lượng và các dòng phiếu', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    expect(screen.getByRole('heading', { name: 'Danh sách phiếu thu' })).toBeTruthy();
    expect(await screen.findByText('PT_1_10_2026')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tất cả (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chờ duyệt (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Đã duyệt (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Nháp (0)' })).toBeTruthy();
    expect(screen.getByText('Hiển thị 1-2 / 2 bản ghi')).toBeTruthy();
    expect(screen.getByText('Đã duyệt', { selector: 'span' })).toBeTruthy();
  });

  it('đổi tab gửi trạng thái lên máy chủ và về trang 1; từ khoá tìm kiếm được gửi sau khi dừng gõ', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
    fireEvent.click(screen.getByRole('tab', { name: 'Chờ duyệt (1)' }));
    await waitFor(() => expect(paths().some((p) => p.includes('status=PENDING') && p.includes('kind=RECEIPT') && p.includes('page=1'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Tìm phiếu'), { target: { value: 'ABC' } });
    await waitFor(() => expect(paths().some((p) => p.includes('search=ABC'))).toBe(true));
  });

  it('bộ lọc tài khoản lấy từ liên kết đến từ danh sách tài khoản (?accountId=...)', async () => {
    mockQuery = 'accountId=a1';
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
    expect(paths().some((p) => p.includes('accountId=a1'))).toBe(true);
  });

  it('nút Tạo mới chỉ hiện khi có quyền lập loại phiếu này; "Chờ tôi duyệt" chỉ hiện với người duyệt', async () => {
    const { unmount } = render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
    fireEvent.click(screen.getByRole('button', { name: /Tạo mới/ }));
    expect(mockPush).toHaveBeenCalledWith('/receipts/new');
    expect(screen.queryByRole('button', { name: 'Chờ tôi duyệt' })).toBeNull();
    unmount();

    render(<VoucherListScreen kind="PAYMENT" />);
    await screen.findAllByText('PT_1_10_2026');
    expect(screen.queryByRole('button', { name: /Tạo mới/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chờ tôi duyệt' }));
    await waitFor(() => expect(paths().some((p) => p.includes('scope=to-approve') && p.includes('kind=PAYMENT'))).toBe(true));
  });

  it('xuất Excel đúng các dòng đang hiện', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    const csv = String(mockDownload.mock.calls[0][1]);
    expect(csv).toContain('PT_1_10_2026');
    expect(csv).toContain('PT_2_10_2026');
    expect(csv).toContain('Mã phiếu');
  });

  it('danh sách lệnh chuyển tiền hiện cột từ tài khoản đến tài khoản và không có cột lý do', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/vouchers'))
        return list([summary({ id: 't1', kind: 'TRANSFER', code: 'PCT_1_10_2026', accountName: 'Vietcombank', destAccountName: 'Quỹ tiền mặt', reasonName: null })], { APPROVED: 1 }) as never;
      return [] as never;
    });
    render(<VoucherListScreen kind="TRANSFER" />);
    expect(await screen.findByText('Vietcombank → Quỹ tiền mặt')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Danh sách lệnh chuyển tiền' })).toBeTruthy();
    expect(screen.queryByText('Lý do chi')).toBeNull();
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
    await screen.findByText('PT_1_10_2026');
    const { from, to } = monthRange(thisMonth);
    expect(paths()[0]).toContain(`from=${from}&to=${to}`);
    expect(screen.getByText(monthLabel(thisMonth))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Theo tháng' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Từ ngày')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Về tháng này' })).toBeNull();
  });

  it('chuyển tháng trước/sau gửi đúng khoảng ngày, về trang 1; "Về tháng này" quay lại tháng hiện tại', async () => {
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
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
    await screen.findByText('PT_1_10_2026');
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
    await screen.findByText('PT_1_10_2026');
    expect(paths()[0]).toContain('accountId=a1');
    expect(paths()[0]).not.toContain('from=');
    unmount();
    fetchMock.mockClear();
    mockQuery = 'month=2026-02';
    render(<VoucherListScreen kind="RECEIPT" />);
    await screen.findByText('PT_1_10_2026');
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
    await screen.findByText('PT_1_10_2026');
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

describe('initialMonth', () => {
  it('đọc tham số month: all, tháng hợp lệ, hoặc mặc định tháng hiện tại', () => {
    expect(initialMonth('all', '2026-10-14')).toBe('');
    expect(initialMonth('2026-03', '2026-10-14')).toBe('2026-03');
    expect(initialMonth(null, '2026-10-14')).toBe('2026-10');
    expect(initialMonth('2026-13', '2026-10-14')).toBe('2026-10');
    expect(initialMonth('abc', '2026-10-14')).toBe('2026-10');
  });
});
