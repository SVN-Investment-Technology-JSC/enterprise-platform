/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import LeaveSettingsScreen from './leave-settings-screen';

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
const schedule = {
  id: 'sc1',
  tenantId: 't',
  leaveTypeId: 'lt1',
  accrualFrequency: 'MONTHLY',
  accrualAmount: 1,
  prorationRule: 'NONE',
  seniorityBonusYears: 0,
  seniorityBonusDays: 0,
  accrualBasis: 'JOIN_DATE',
  startOffsetMonths: 0,
  advanceAllowed: false,
  annualDays: null,
  seniorityTiers: [],
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mockActions.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/leave-types') return { data: [leaveType] };
    if (path.includes('/accrual-schedules')) return { data: [schedule] };
    throw new Error(`unexpected ${path}`);
  }) as never);
});

describe('LeaveSettingsScreen', () => {
  it('hiển thị loại nghỉ và lịch cộng phép, không có quỹ hay sổ giao dịch', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    expect(
      screen.getByRole('heading', { name: 'Phép năm và loại nghỉ' }),
    ).toBeTruthy();
    expect(
      await screen.findByText('Danh mục các loại nghỉ phép (1)'),
    ).toBeTruthy();
    expect(screen.getByText('Phép năm')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('tab', { name: 'Lịch cộng phép và thâm niên' }),
    );
    expect(await screen.findByText('Hàng tháng')).toBeTruthy();

    expect(screen.queryByText('Quỹ và sổ giao dịch phép')).toBeNull();
    expect(
      screen.queryByRole('tab', { name: 'Giao dịch (mọi năm)' }),
    ).toBeNull();
    expect(
      fetchMock.mock.calls.some(([p]) =>
        /leave-balances|leave-transactions|leave-settlements/.test(String(p)),
      ),
    ).toBe(false);
  });

  it('hiện các nút chạy cộng phép, chốt cuối năm, hết hạn phép chuyển khi có hrm.leave.manage', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Danh mục các loại nghỉ phép (1)');
    for (const name of [
      'Thêm loại nghỉ',
      'Lịch cộng phép',
      'Cộng phép tháng',
      'Chốt phép cuối năm',
      'Hết hạn phép chuyển',
      'Sửa',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('chỉ có hrm.leave.read thì báo thiếu quyền, không có nút và không gọi API', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveSettingsScreen />);
    expect(
      await screen.findByText(
        'Bạn không có quyền cấu hình phép năm và loại nghỉ.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Cộng phép tháng' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Chốt phép cuối năm' }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
