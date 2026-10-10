/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import LeaveBalancesScreen from './leave-balances-screen';

const mockActions = new Set<string>();
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

// antd Table cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt), jsdom chưa hỗ trợ.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.getComputedStyle = ((elt: Element) =>
    nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<
  typeof hrmEmployeeOptions
>;

const leaveType = {
  id: 'lt1',
  tenantId: 't',
  code: 'AL',
  name: 'Phép năm',
  unit: 'DAYS',
  paid: true,
  deductBalance: true,
  negativeLimit: 0,
  requiresAttachment: false,
  carryoverAllowed: true,
  maxCarryoverDays: 5,
  carryoverExpiryMonth: 3,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const balance = {
  id: 'b1',
  tenantId: 't',
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn Văn An',
  leaveTypeId: 'lt1',
  leaveTypeName: 'Phép năm',
  year: new Date().getFullYear(),
  openingBalance: 0,
  accrued: 12,
  used: 2,
  pending: 0,
  adjusted: 0,
  remaining: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const transaction = {
  id: 'tx1',
  tenantId: 't',
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn Văn An',
  leaveTypeId: 'lt1',
  leaveTypeName: 'Phép năm',
  transactionType: 'ADJUSTMENT',
  daysChanged: 1,
  balanceAfter: 11,
  note: 'Bù phép',
  createdAt: '2026-02-01T00:00:00.000Z',
};

function route() {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/leave-types')) return { data: [leaveType] };
    if (path.startsWith('/leave-balances')) return { data: [balance] };
    if (path.startsWith('/leave-transactions')) return { data: [transaction] };
    if (path.startsWith('/leave-settlements')) return { data: [] };
    if (path.startsWith('/payroll-periods')) return { data: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
}

beforeEach(() => {
  mockActions.clear();
  fetchMock.mockReset();
  employeesMock.mockReset();
  employeesMock.mockResolvedValue([
    { value: 'e1', label: 'NV001 - Nguyễn Văn An' },
  ]);
  route();
});

describe('LeaveBalancesScreen', () => {
  it('hiển thị quỹ phép và sổ giao dịch, ẩn nút ghi khi không có hrm.leave.manage', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    expect(screen.getByRole('heading', { name: 'Quỹ phép' })).toBeTruthy();
    expect(await screen.findByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.getByText('NV001')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Điều chỉnh quỹ' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Giao dịch (mọi năm)' }));
    expect(await screen.findByText('Bù phép')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Đảo điều chỉnh' }),
    ).toBeNull();
    // Không có liên kết sang màn hình cấu hình.
    expect(screen.queryByText('Phép năm và loại nghỉ')).toBeNull();
  });

  it('hiện nút điều chỉnh và đảo điều chỉnh khi có hrm.leave.manage', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(
      screen.getByRole('button', { name: 'Điều chỉnh quỹ' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Giao dịch (mọi năm)' }));
    expect(
      await screen.findByRole('button', { name: 'Đảo điều chỉnh' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Phép năm và loại nghỉ' }),
    ).toBeTruthy();
  });

  it('tab quyết toán nghỉ việc gọi /leave-settlements', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getByRole('tab', { name: 'Quyết toán nghỉ việc' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([p]) =>
          String(p).startsWith('/leave-settlements'),
        ),
      ).toBe(true),
    );
  });

  it('không có hrm.leave.read thì báo thiếu quyền và không gọi API', async () => {
    render(<LeaveBalancesScreen />);
    expect(
      await screen.findByText('Bạn không có quyền xem quỹ phép.'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
