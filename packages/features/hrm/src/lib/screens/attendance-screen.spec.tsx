/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import AttendanceScreen from './attendance-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.self.attendance', 'hrm.self.request'],
    loading: false,
    error: '',
    displayName: '',
    can: () => true,
    any: () => true,
  }),
}));

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const OWN_ID = '11111111-1111-1111-1111-111111111111';

function route(profile: Record<string, unknown> = { employeeCode: 'NV001', fullName: 'Nguyễn Văn An' }) {
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/my-attendance') return { data: [] };
    if (path === '/my-attendance-context') {
      return { data: { employeeId: OWN_ID, workDate: '2026-10-09', timezone: 'Asia/Ho_Chi_Minh', requireGps: false, shift: null } };
    }
    if (path === '/my-profile') return { data: profile };
    if (path.startsWith('/leave-requests')) return { data: [] };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
}

beforeEach(() => fetchMock.mockReset());

describe('AttendanceScreen (Chấm công của tôi)', () => {
  it('requests leave-requests with the current user own employee_id only', async () => {
    route();
    render(<AttendanceScreen />);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([p]) => String(p).startsWith('/leave-requests'))).toBe(true),
    );
    const leaveCalls = fetchMock.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/leave-requests'));
    expect(leaveCalls).toHaveLength(1);
    expect(leaveCalls[0].startsWith('/leave-requests?')).toBe(true);
    expect(new URLSearchParams(leaveCalls[0].split('?')[1]).get('employee_id')).toBe(OWN_ID);
  });

  it('shows the new title, keeps "Chưa phân ca" and drops hard-coded org values', async () => {
    route();
    render(<AttendanceScreen />);
    expect(await screen.findByRole('heading', { name: 'Chấm công của tôi' })).toBeTruthy();
    expect((await screen.findAllByText('Chưa phân ca')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Ban Điều hành')).toBeNull();
    expect(screen.queryByText('Quản trị viên')).toBeNull();
  });
});
