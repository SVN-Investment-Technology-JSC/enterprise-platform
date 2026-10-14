/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceCapabilities, FinanceVoucherList, FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { installAntdEnv } from '../../test-support/antd-env';
import { financeFetch } from '../finance-api';
import VoucherListScreen from './voucher-list-screen';

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
  return { items, total: Object.values(statusCounts).reduce((a, b) => a + b, 0), page: 1, pageSize: 20, statusCounts, approvedTotal: 300_000 };
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
