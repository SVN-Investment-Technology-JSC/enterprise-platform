/** @jest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import HrmDashboardPage from './dashboard-screen';

let mockActions: string[] = [];
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
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const paths = () => fetchMock.mock.calls.map((call) => call[0] as string);

const noShiftContext = {
  employeeId: 'e1',
  workDate: '2026-03-02',
  timezone: 'Asia/Ho_Chi_Minh',
  requireGps: false,
  shift: null,
};
const shiftContext = {
  ...noShiftContext,
  shift: {
    window: {
      start: '2026-03-02T01:00:00.000Z',
      end: '2026-03-02T10:30:00.000Z',
      graceLateMinutes: 10,
      graceEarlyMinutes: 10,
    },
  },
};

function respond(map: Record<string, unknown>) {
  fetchMock.mockImplementation(async (path: string) => {
    const key = Object.keys(map).find((k) => path.startsWith(k));
    if (!key) throw new Error(`Unexpected request ${path}`);
    const value = map[key];
    if (value instanceof Error) throw value;
    return value as never;
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('HrmDashboardPage', () => {
  it('nhan vien chi goi endpoint tu phuc vu', async () => {
    mockActions = ['hrm.read', 'hrm.self.read', 'hrm.self.attendance'];
    respond({ '/my-attendance-context': { data: noShiftContext } });
    render(<HrmDashboardPage />);
    await screen.findByText('Chưa phân ca');
    expect(paths()).toEqual(['/my-attendance-context']);
    expect(paths().some((p) => p.includes('/dashboard/overview'))).toBe(false);
    expect(paths().some((p) => p.includes('timesheet-periods'))).toBe(false);
    expect(paths().some((p) => p.includes('payroll-periods'))).toBe(false);
    expect(screen.queryByText('Cần xử lý')).toBeNull();
    expect(screen.queryByText(/Ca hành chính chuẩn/)).toBeNull();
    const checkIn = screen.getByRole('button', { name: /Ghi nhận vào ca/ });
    expect(checkIn.hasAttribute('disabled') || checkIn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('khong co hrm.self.attendance thi an nut cham cong', async () => {
    mockActions = ['hrm.self.read'];
    respond({ '/my-attendance-context': { data: shiftContext } });
    render(<HrmDashboardPage />);
    await screen.findByText('08:00 - 17:30');
    expect(screen.queryByRole('button', { name: /Ghi nhận vào ca/ })).toBeNull();
  });

  it('co ca thi cho bam vao ca', async () => {
    mockActions = ['hrm.self.read', 'hrm.self.attendance'];
    respond({ '/my-attendance-context': { data: shiftContext } });
    render(<HrmDashboardPage />);
    await screen.findByText('08:00 - 17:30');
    const checkIn = screen.getByRole('button', { name: /Ghi nhận vào ca/ });
    expect(checkIn.hasAttribute('disabled')).toBe(false);
  });

  it('nguoi duyet dem don cho duyet, chi goi loai duoc duyet, kem forApproval=1', async () => {
    mockActions = ['hrm.self.read', 'hrm.leave.approve', 'hrm.ot.approve.all'];
    respond({
      '/my-attendance-context': { data: noShiftContext },
      '/leave-requests': {
        data: [{ status: 'PENDING' }, { status: 'APPROVED' }, { status: 'PENDING' }],
      },
      '/ot-requests': { data: [{ status: 'PEER_CONFIRMED' }] },
    });
    render(<HrmDashboardPage />);
    const leave = await screen.findByRole('link', { name: /Nghỉ phép/ });
    await waitFor(() => expect(within(leave).getByText('2')).toBeTruthy());
    expect(leave.getAttribute('href')).toContain('/approvals?type=leave');
    const ot = screen.getByRole('link', { name: /Tăng ca/ });
    await waitFor(() => expect(within(ot).getByText('1')).toBeTruthy());
    expect(ot.getAttribute('href')).toContain('/approvals?type=ot');
    expect(paths().sort()).toEqual(
      [
        '/my-attendance-context',
        '/leave-requests?forApproval=1',
        '/ot-requests?forApproval=1',
      ].sort(),
    );
    expect(screen.queryByRole('link', { name: /Tạm ứng/ })).toBeNull();
    const procedure = screen.getByRole('link', { name: /Theo dõi quy trình/ });
    expect(procedure.getAttribute('href')).toBe('/modules/procedure-engine/instances');
  });

  it('403 khong hien so 0 gia', async () => {
    mockActions = ['hrm.leave.approve'];
    respond({
      '/leave-requests': new HrmApiError('Forbidden', 403),
    });
    render(<HrmDashboardPage />);
    const leave = await screen.findByRole('link', { name: /Nghỉ phép/ });
    await waitFor(() =>
      expect(within(leave).getByText('Không có quyền xem')).toBeTruthy(),
    );
    expect(within(leave).queryByText('0')).toBeNull();
  });

  it('chi goi tong quan, ky cong, ky luong khi co quyen tuong ung', async () => {
    mockActions = ['hrm.dashboard.read', 'hrm.timesheet.read', 'hrm.payroll.read'];
    respond({
      '/dashboard/overview': {
        data: {
          periodCode: '2026-03',
          totalEmployees: 3,
          officialEmployees: 3,
          probationEmployees: 0,
          todayDayKind: 'WORKDAY',
          todayAttendance: { checkedInCount: 7, missingPunchCount: 0, lateCount: 0, onLeaveCount: 0 },
          pendingApprovals: { leaveRequests: 0, otRequests: 0, corrections: 0, advances: 0 },
        },
      },
      '/timesheet-periods': { data: [{ status: 'OPEN' }, { status: 'LOCKED' }] },
      '/payroll-periods': { data: [{ status: 'OPEN' }] },
    });
    render(<HrmDashboardPage />);
    await screen.findByText('7');
    expect(paths().sort()).toEqual(
      ['/dashboard/overview', '/payroll-periods', '/timesheet-periods'].sort(),
    );
    expect(screen.queryByText('Chấm công hôm nay')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('my-attendance'))).toBe(false);
  });

  it('khong co quyen nao thi khong goi API', async () => {
    mockActions = [];
    render(<HrmDashboardPage />);
    expect(await screen.findByText(/chưa được cấp quyền/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
