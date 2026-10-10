/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import AttendanceScreen from './attendance-screen';

// Ô ngày giờ thật dùng lịch chọn ngày; thay bằng ô nhập đơn giản để điền thời gian trong test.
jest.mock('../ui/date-time-input', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    DateTimeInput: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (next: string) => void;
    }) =>
      createElement('input', {
        'aria-label': 'Giờ thực tế',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      }),
  };
});

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

let reasons: unknown[] = [];
let approvalRoute: unknown = null;
let posts: { path: string; body: Record<string, unknown> }[] = [];

function route(profile: Record<string, unknown> = { employeeCode: 'NV001', fullName: 'Nguyễn Văn An' }) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/my-attendance') return { data: [] };
    if (path === '/my-attendance-context') {
      return { data: { employeeId: OWN_ID, workDate: '2026-10-09', timezone: 'Asia/Ho_Chi_Minh', requireGps: false, shift: null } };
    }
    if (path === '/my-profile') return { data: profile };
    if (path.startsWith('/leave-requests')) return { data: [] };
    if (path.startsWith('/request-reasons')) return { data: reasons };
    if (path.startsWith('/approval-route')) return { data: approvalRoute };
    if (path === '/attendance-corrections' && init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return { data: { id: 'c1' } };
    }
    throw new Error(`Unexpected request ${path}`);
  }) as never);
}

beforeEach(() => {
  fetchMock.mockReset();
  reasons = [];
  approvalRoute = null;
  posts = [];
});

const correctionReason = (over: Record<string, unknown> = {}) => ({
  id: 'ac1',
  tenantId: 't1',
  kind: 'ATTENDANCE_CORRECTION',
  code: 'QUEN_CHAM_CONG',
  name: 'Quên chấm công',
  description: 'Quên quẹt thẻ khi đến hoặc khi về',
  paid: true,
  requiresDescription: false,
  active: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

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

describe('AttendanceScreen: giải trình công có Lý do (danh mục) và Mô tả (tự do)', () => {
  async function openCorrection() {
    route();
    render(<AttendanceScreen />);
    // Chờ nạp xong ngày công hiện tại để ô ngày của form được điền sẵn.
    await screen.findByText(/Ngày công: 2026-10-09/);
    fireEvent.click(await screen.findByRole('button', { name: 'Giải trình' }));
    await screen.findByText('Gửi giải trình công & Bổ sung giờ làm');
  }
  const chooseReason = async (name: RegExp) => {
    fireEvent.click(await screen.findByPlaceholderText('Chọn lý do...'));
    fireEvent.click(await screen.findByRole('option', { name, hidden: true }));
  };
  const submit = () =>
    screen.getByRole('button', { name: /Gửi giải trình$/, hidden: true }) as HTMLButtonElement;
  const fillSessions = () => {
    const [start, end] = screen.getAllByLabelText('Giờ thực tế');
    fireEvent.change(start, { target: { value: '2026-10-09T08:00' } });
    fireEvent.change(end, { target: { value: '2026-10-09T17:00' } });
  };

  it('chọn lý do từ danh mục ATTENDANCE_CORRECTION, hiện diễn giải, khóa gửi tới khi chọn', async () => {
    reasons = [correctionReason()];
    await openCorrection();
    await screen.findByPlaceholderText('Chọn lý do...');
    expect(fetchMock.mock.calls.map(([p]) => String(p))).toContain(
      '/request-reasons?kind=ATTENDANCE_CORRECTION&active=true',
    );
    expect(screen.getByLabelText(/Mô tả \(nhập thêm chi tiết nếu cần\)/).tagName).toBe('TEXTAREA');
    expect(submit().disabled).toBe(true);
    await chooseReason(/Quên chấm công/);
    expect(screen.getByTestId('reason-guide').textContent).toContain('Quên quẹt thẻ khi đến hoặc khi về');
    expect(submit().disabled).toBe(false);
  });

  it('hiện người duyệt dự kiến sau khi chọn lý do', async () => {
    reasons = [correctionReason()];
    approvalRoute = {
      mode: 'DIRECT',
      directManager: { employeeId: 'm1', fullName: 'Trần Văn B', positionName: 'Trưởng phòng' },
    };
    await openCorrection();
    await chooseReason(/Quên chấm công/);
    expect((await screen.findByTestId('approver-preview')).textContent).toBe(
      'Người duyệt: Quản lý trực tiếp (Trần Văn B, Trưởng phòng)',
    );
    expect(
      fetchMock.mock.calls.map(([p]) => String(p)),
    ).toContain(`/approval-route?kind=correction&employeeId=${OWN_ID}&reasonId=ac1`);
  });

  it('gửi reasonId + description, không gửi reason', async () => {
    reasons = [correctionReason()];
    await openCorrection();
    await chooseReason(/Quên chấm công/);
    fireEvent.change(screen.getByLabelText(/Mô tả \(nhập thêm chi tiết nếu cần\)/), {
      target: { value: 'Quên quẹt thẻ buổi sáng' },
    });
    fillSessions();
    fireEvent.click(submit());
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({
      employeeId: OWN_ID,
      requestDate: '2026-10-09',
      reasonId: 'ac1',
      description: 'Quên quẹt thẻ buổi sáng',
    });
    expect(posts[0].body).not.toHaveProperty('reason');
  });

  it('lý do cần mô tả thì bắt buộc nhập mô tả mới gửi được', async () => {
    reasons = [correctionReason({ id: 'ac2', name: 'Khác', description: null, requiresDescription: true })];
    await openCorrection();
    await chooseReason(/^Khác/);
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Mô tả \(nhập thêm chi tiết nếu cần\)/), {
      target: { value: 'Ra ngoài gặp đối tác đột xuất' },
    });
    expect(submit().disabled).toBe(false);
  });

  it('danh mục rỗng: báo quản trị viên cấu hình và khóa gửi', async () => {
    reasons = [];
    await openCorrection();
    expect(
      await screen.findByText(
        'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Lý do đơn từ.',
      ),
    ).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });
});
