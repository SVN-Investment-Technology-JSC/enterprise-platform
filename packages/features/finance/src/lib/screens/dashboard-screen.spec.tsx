/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FinanceCapabilities, FinanceDashboard } from '@enterprise-platform/contracts-finance';
import { financeFetch } from '../finance-api';
import DashboardScreen from './dashboard-screen';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn() };
});
let mockCapabilities: Partial<FinanceCapabilities> = {};
jest.mock('../finance-permissions', () => ({
  useFinancePermissions: () => ({ loading: false, error: null, capabilities: mockCapabilities, canOpenPage: () => true }),
}));
const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

const full: FinanceDashboard = {
  today: '2026-10-14',
  monthFrom: '2026-10-01',
  monthTo: '2026-10-31',
  monthReceipts: 3_000_000,
  monthPayments: 1_000_000,
  monthNet: 2_000_000,
  totalBalance: 12_000_000,
  pendingApprovalCount: 2,
  pendingApprovalAmount: 750_000,
  myDraftCount: 1,
  cashflow: [{ period: '2026-10', receipts: 3_000_000, payments: 1_000_000, net: 2_000_000 }],
  accounts: [
    { id: 'a1', code: 'VCB', name: 'Vietcombank', accountType: 'BANK', balance: 11_000_000, pendingOut: 250_000 },
    { id: 'a2', code: 'TM', name: 'Quỹ tiền mặt', accountType: 'CASH', balance: 1_000_000, pendingOut: 0 },
  ],
  recent: [
    {
      id: 'v1',
      kind: 'PAYMENT',
      code: 'PC_1_10_2026',
      voucherDate: '2026-10-14',
      postingDate: '2026-10-14',
      content: 'Chi văn phòng phẩm',
      reasonId: null,
      reasonName: null,
      accountId: null,
      accountName: null,
      destAccountId: null,
      destAccountName: null,
      counterpartyGroupName: null,
      counterpartyName: null,
      totalAmount: 250_000,
      status: 'PENDING',
      createdBy: 'u',
      createdByName: 'An',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      submittedAt: null,
      decidedAt: null,
      approvalMode: 'DIRECT',
      allocation: null,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities = { receipt: { create: true, approve: false }, payment: { create: true, approve: true }, transfer: { create: false, approve: false } };
  fetchMock.mockResolvedValue(full as never);
});

describe('Dashboard Tài chính', () => {
  it('kế toán thấy thu chi trong tháng, số dư các tài khoản, phiếu chờ duyệt và phiếu gần đây', async () => {
    render(<DashboardScreen />);
    expect(await screen.findByText('Thu trong tháng')).toBeTruthy();
    expect(screen.getByText('Chi trong tháng')).toBeTruthy();
    expect(screen.getByText('Tổng số dư tài khoản')).toBeTruthy();
    expect(screen.getByText('12.000.000')).toBeTruthy();
    const accounts = screen.getByRole('region', { name: 'Số dư tài khoản' });
    expect(within(accounts).getByText('Vietcombank')).toBeTruthy();
    expect(within(accounts).getByText('Chờ chi 250.000')).toBeTruthy();
    expect(screen.getByText('Tổng 750.000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /PC_1_10_2026/ }));
    expect(mockPush).toHaveBeenCalledWith('/payments/v1');
  });

  it('nút tạo nhanh chỉ hiện cho loại phiếu người dùng được lập', async () => {
    render(<DashboardScreen />);
    await screen.findByText('Thu trong tháng');
    expect(screen.getByRole('button', { name: /Tạo phiếu thu/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tạo phiếu chi/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tạo phiếu chuyển tiền/ })).toBeNull();
  });

  it('người chỉ lập phiếu (không xem số dư) không thấy khối tiền của công ty', async () => {
    fetchMock.mockResolvedValue({ ...full, monthReceipts: 0, monthPayments: 0, monthNet: 0, totalBalance: 0, cashflow: [], accounts: [], pendingApprovalCount: 0, pendingApprovalAmount: 0 } as never);
    render(<DashboardScreen />);
    expect(await screen.findByText('Phiếu chờ bạn duyệt')).toBeTruthy();
    expect(screen.queryByText('Thu trong tháng')).toBeNull();
    expect(screen.queryByText('Tổng số dư tài khoản')).toBeNull();
    expect(screen.getByText('Không có phiếu nào đang chờ')).toBeTruthy();
  });

  it('báo lỗi khi không tải được', async () => {
    fetchMock.mockRejectedValue(new Error('Bạn không có quyền sử dụng Tài chính.'));
    render(<DashboardScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain('Bạn không có quyền sử dụng Tài chính.');
  });
});
