/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { HrmApiError, hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import ApprovalsScreen from './approvals-screen';

let mockActions: string[] = [];
let mockType: string | null = null;
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'type' ? mockType : null),
  }),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: mockActions,
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.includes(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.includes(p)),
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<
  typeof hrmEmployeeOptions
>;
const paths = () => fetchMock.mock.calls.map((call) => call[0] as string);

const leave = {
  id: 'l1',
  employeeId: 'e1',
  status: 'PENDING',
  reason: 'Nghỉ việc riêng',
  fromDate: '2026-03-02',
  toDate: '2026-03-03',
  createdAt: '2026-03-01T01:00:00.000Z',
};
const ot = {
  id: 'o1',
  employeeId: 'e1',
  status: 'PENDING',
  reason: 'Tăng ca cuối tháng',
  workDate: '2026-03-05',
  plannedMinutes: 120,
  createdAt: '2026-03-02T01:00:00.000Z',
};

function setup(lists: Record<string, unknown[] | Error>) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/approval-scope')
      return { data: { noReportingLine: false, message: null } } as never;
    if (path === '/request-workflows') return { data: [] } as never;
    const key = Object.keys(lists).find((k) => path.startsWith(`/${k}?`));
    if (!key) throw new Error(`Unexpected request ${path}`);
    const value = lists[key];
    if (value instanceof Error) throw value;
    return { data: value } as never;
  });
  employeesMock.mockResolvedValue([
    { value: 'e1', label: 'NV001 · Nguyễn Văn An' },
  ]);
}

beforeAll(() => {
  // antd Table cần ResizeObserver, jsdom không có.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  mockType = null;
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList);
});

describe('ApprovalsScreen', () => {
  it('moi danh sach deu kem forApproval=1 va chi goi loai duoc duyet', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve.all', 'hrm.advance.approve'];
    setup({
      'leave-requests': [leave],
      'ot-requests': [ot],
      'salary-advance-requests': [],
    });
    render(<ApprovalsScreen />);
    await waitFor(() => {
      const lists = paths().filter(
        (p) => !['/approval-scope', '/request-workflows'].includes(p),
      );
      expect(lists.length).toBe(3);
    });
    const lists = paths().filter(
      (p) => !['/approval-scope', '/request-workflows'].includes(p),
    );
    for (const p of lists) expect(p).toContain('forApproval=1');
    expect(lists.some((p) => p.startsWith('/business-trip-requests'))).toBe(false);
  });

  it('hien ma nhan vien', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ 'leave-requests': [leave] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
  });

  it('?type= chon san bo loc loai don', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    mockType = 'ot';
    setup({ 'leave-requests': [leave], 'ot-requests': [ot] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.queryByText('Nghỉ việc riêng')).toBeNull();
  });

  it('khong co ?type= thi hien tat ca loai', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ 'leave-requests': [leave], 'ot-requests': [ot] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.getByText('Nghỉ việc riêng')).toBeTruthy();
  });

  it('loai don bi 403 duoc bo qua, khong bao loi', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({
      'leave-requests': [leave],
      'ot-requests': new HrmApiError('Forbidden', 403),
    });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Nghỉ việc riêng')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lien ket Procedure dung duong dan', async () => {
    mockActions = ['hrm.leave.approve'];
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/approval-scope')
        return { data: { noReportingLine: false, message: null } } as never;
      if (path === '/request-workflows')
        return {
          data: [
            {
              id: 'w1',
              request_kind: 'LEAVE',
              request_id: 'l1',
              instance_code: 'PE-001',
              status: 'RUNNING',
              last_error: '',
            },
          ],
        } as never;
      return { data: [leave] } as never;
    });
    employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An' }]);
    render(<ApprovalsScreen />);
    const link = await screen.findByRole('link', { name: /PE-001/ });
    expect(link.getAttribute('href')).toBe('/modules/procedure-engine/instances');
  });
});
