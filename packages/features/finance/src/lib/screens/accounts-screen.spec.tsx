/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FinanceAccount, FinanceCapabilities } from '@enterprise-platform/contracts-finance';
import { installAntdEnv } from '../../test-support/antd-env';
import { financeFetch } from '../finance-api';
import AccountsScreen from './accounts-screen';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock('../finance-api', () => {
  const actual = jest.requireActual('../finance-api');
  return { ...actual, financeFetch: jest.fn(), financePost: jest.fn(), financePut: jest.fn() };
});

let mockCapabilities: Partial<FinanceCapabilities> = {};
jest.mock('../finance-permissions', () => ({
  useFinancePermissions: () => ({ loading: false, error: null, capabilities: mockCapabilities, canOpenPage: () => true }),
}));
jest.mock('../finance-csv', () => {
  const actual = jest.requireActual('../finance-csv');
  return { ...actual, downloadCsv: jest.fn() };
});

installAntdEnv();

const fetchMock = financeFetch as jest.MockedFunction<typeof financeFetch>;

const account = (over: Partial<FinanceAccount>): FinanceAccount => ({
  id: 'a1',
  code: 'VCB',
  name: 'SAVINA - VCB',
  accountType: 'BANK',
  bankName: 'Vietcombank (VCB)',
  accountNumber: '0041000263908',
  accountHolder: null,
  branch: null,
  currency: 'VND',
  openingBalance: 14_182_377,
  openingDate: '2026-01-01',
  allowNegative: false,
  isActive: true,
  note: null,
  balance: 200_000,
  pendingOut: 0,
  receiptCount: 56,
  paymentCount: 81,
  transferCount: 27,
  totalReceipts: 8_786_996_385,
  totalPayments: 8_801_178_762,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities = { canManageAccounts: true };
  fetchMock.mockImplementation(async () => [account({}), account({ id: 'a2', name: 'TIÊN PHONG - Tiền Mặt', accountType: 'CASH', accountNumber: null, bankName: null, openingBalance: 0, receiptCount: 0, paymentCount: 10, transferCount: 1, totalReceipts: 20_000_000, totalPayments: 19_903_455, balance: 96_545 })] as never);
});

describe('Danh sách tài khoản', () => {
  it('hiện tên, số tài khoản, số phiếu theo loại, số dư đầu kỳ, tiền thu, tiền chi và tổng tiền', async () => {
    render(<AccountsScreen />);
    expect(await screen.findByText('SAVINA - VCB')).toBeTruthy();
    const row = screen.getByText('SAVINA - VCB').closest('tr') as HTMLElement;
    for (const text of ['0041000263908', 'Vietcombank (VCB)', '56', '81', '27', '14.182.377', '8.786.996.385', '8.801.178.762', '200.000']) expect(within(row).getByText(text)).toBeTruthy();
    const cashRow = screen.getByText('TIÊN PHONG - Tiền Mặt').closest('tr') as HTMLElement;
    expect(within(cashRow).getByText('Tiền mặt')).toBeTruthy();
    expect(within(cashRow).getByText('--')).toBeTruthy(); // số dư đầu kỳ bằng 0 hiện "--"
  });

  it('bấm số phiếu mở danh sách phiếu của đúng loại, đã lọc theo tài khoản đó', async () => {
    render(<AccountsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '56 phiếu thu của SAVINA - VCB' }));
    expect(mockPush).toHaveBeenCalledWith('/receipts?accountId=a1&month=all');
    fireEvent.click(screen.getByRole('button', { name: '81 phiếu chi của SAVINA - VCB' }));
    expect(mockPush).toHaveBeenCalledWith('/payments?accountId=a1&month=all');
    fireEvent.click(screen.getByRole('button', { name: '27 lệnh chuyển tiền của SAVINA - VCB' }));
    expect(mockPush).toHaveBeenCalledWith('/transfers?accountId=a1&month=all');
  });

  it('số 0 không phải liên kết', async () => {
    render(<AccountsScreen />);
    await screen.findByText('TIÊN PHONG - Tiền Mặt');
    expect(screen.queryByRole('button', { name: /0 phiếu thu/ })).toBeNull();
  });

  it('người không được xem số dư thấy dấu "-" thay vì số liệu; người không quản lý tài khoản không có nút thêm/sửa', async () => {
    mockCapabilities = { canManageAccounts: false };
    fetchMock.mockImplementation(async () => [account({ balance: null, pendingOut: null, receiptCount: null, paymentCount: null, transferCount: null, totalReceipts: null, totalPayments: null })] as never);
    render(<AccountsScreen />);
    const row = (await screen.findByText('SAVINA - VCB')).closest('tr') as HTMLElement;
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole('button', { name: /Thêm tài khoản/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sửa SAVINA - VCB/ })).toBeNull();
  });

  it('tài khoản âm hiện màu đỏ và tiền chờ chi được nêu riêng', async () => {
    fetchMock.mockImplementation(async () => [account({ balance: -5_000, pendingOut: 750_000 })] as never);
    render(<AccountsScreen />);
    const row = (await screen.findByText('SAVINA - VCB')).closest('tr') as HTMLElement;
    expect(within(row).getByText('-5.000').className).toContain('text-red-600');
    expect(screen.getByText('Chờ chi 750.000')).toBeTruthy();
  });

  it('thêm tài khoản ngân hàng: bắt buộc chọn ngân hàng và nhập số tài khoản, gửi đúng dữ liệu', async () => {
    const { financePost } = jest.requireMock('../finance-api') as { financePost: jest.Mock };
    financePost.mockResolvedValue({});
    render(<AccountsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Thêm tài khoản/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Mã tài khoản/), { target: { value: 'ACB-01' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên tài khoản/), { target: { value: 'ACB chính' } });
    fireEvent.change(within(dialog).getByLabelText(/Số tài khoản/), { target: { value: '123456' } });
    fireEvent.change(within(dialog).getByLabelText(/Số dư đầu kỳ/), { target: { value: '5000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm tài khoản' }));
    await waitFor(() => expect(financePost).toHaveBeenCalledTimes(1));
    const [path, body] = financePost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/accounts');
    expect(body).toMatchObject({ code: 'ACB-01', name: 'ACB chính', accountType: 'BANK', accountNumber: '123456', openingBalance: 5_000_000, allowNegative: true, isActive: true }); // mặc định cho phép âm
  });

  it('tài khoản đã có bút toán: khoá số dư đầu kỳ và ngày bắt đầu, không gửi hai trường đó', async () => {
    const { financePut } = jest.requireMock('../finance-api') as { financePut: jest.Mock };
    financePut.mockResolvedValue({});
    render(<AccountsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa SAVINA - VCB' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/Số dư đầu kỳ/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(financePut).toHaveBeenCalledTimes(1));
    const [path, body] = financePut.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/accounts/a1');
    expect(body).not.toHaveProperty('openingBalance');
    expect(body).not.toHaveProperty('openingDate');
  });
});
