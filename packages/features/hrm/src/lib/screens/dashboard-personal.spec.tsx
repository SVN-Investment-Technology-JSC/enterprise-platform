/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HrmBoardDay, HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { announceAssistantSaved } from '@enterprise-platform/feature-module-shell';
import { hrmFetch } from '../hrm-api';
import HrmDashboardPage from './dashboard-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => {
    const actions = ['hrm.self.read', 'hrm.self.attendance', 'hrm.self.payslip'];
    return {
      actions,
      loading: false,
      error: '',
      displayName: 'Hà Nguyên Hoàng',
      can: (p: string) => actions.includes(p),
      any: (list: readonly string[]) => list.some((p) => actions.includes(p)),
    };
  },
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

/** Bảng công có thêm đơn vừa gửi từ card Trợ lý. */
let secondPendingRequest = false;

/** jsdom chưa có BroadcastChannel: bản giả giao tin ngay cho mọi kênh cùng tên khác kênh gửi, như trình duyệt. */
class FakeBroadcastChannel {
  static readonly open = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    FakeBroadcastChannel.open.add(this);
  }
  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.open)
      if (channel !== this && channel.name === this.name) channel.onmessage?.(new MessageEvent('message', { data }));
  }
  close() {
    FakeBroadcastChannel.open.delete(this);
  }
}

const d = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
const day = (date: string, over: Partial<HrmBoardDay> = {}): HrmBoardDay => ({
  date,
  kind: 'WORK',
  status: 'PRESENT',
  shiftCode: 'HC',
  shiftName: 'Hành chính',
  shiftStart: '08:00',
  shiftEnd: '17:00',
  checkIn: '08:00',
  checkOut: '17:00',
  scheduledMinutes: 480,
  workedMinutes: 480,
  paidMinutes: 480,
  workdayUnits: 1,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  otMinutes: 0,
  anomalies: [],
  leave: null,
  tripId: null,
  holidayName: null,
  adjusted: false,
  ...over,
});

function board(): HrmTimesheetBoard {
  const days: Record<string, HrmBoardDay> = {};
  for (let i = 1; i <= 31; i++) {
    const date = d(i);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    days[date] =
      wd === 0 || wd === 6
        ? day(date, { kind: 'OFF', status: 'OFF', shiftCode: null, shiftName: null, shiftStart: null, shiftEnd: null, workdayUnits: 0, scheduledMinutes: 0, checkIn: null, checkOut: null })
        : i > 9
          ? day(date, { status: 'FUTURE', checkIn: null, checkOut: null, workdayUnits: 0 })
          : day(date);
  }
  days[d(2)] = day(d(2), { status: 'LATE', lateMinutes: 12, checkIn: '08:12' });
  days[d(3)] = day(d(3), { status: 'ABSENT', checkIn: null, checkOut: null, workdayUnits: 0 });
  days[d(6)] = day(d(6), {
    status: 'ANNUAL_LEAVE',
    leave: { requestId: 'l1', reasonName: 'Phép năm', paid: true, annual: true, days: 1 },
    requests: [
      { kind: 'LEAVE', id: 'l1', status: 'PENDING', label: 'Nghỉ phép năm', minutes: 480, fromAt: '2026-10-05T23:00:00.000Z', toAt: '2026-10-06T10:00:00.000Z', createdAt: '2026-10-11T00:00:00.000Z' },
    ],
  });
  if (secondPendingRequest)
    days[d(7)] = day(d(7), {
      requests: [
        { kind: 'LEAVE', id: 'l2', status: 'PENDING', label: 'Nghỉ ốm', minutes: 480, fromAt: '2026-10-06T23:00:00.000Z', toAt: '2026-10-07T10:00:00.000Z', createdAt: '2026-10-10T01:20:00.000Z' },
      ],
    });
  // Hôm nay (thứ Bảy 10/10 theo mốc giả): chưa vào ca nhưng có ca.
  days[d(10)] = day(d(10), { kind: 'WORK', status: 'FUTURE', checkIn: null, checkOut: null, workdayUnits: 0 });
  return {
    month: { month: '2026-10', from: d(1), to: d(31), state: 'OPEN', periodId: null, requestsClosedAt: null, lockedAt: null, calculatedAt: null },
    canViewAll: false,
    calendar: Array.from({ length: 31 }, (_, i) => ({
      date: d(i + 1),
      weekday: new Date(`${d(i + 1)}T00:00:00Z`).getUTCDay(),
      kind: 'WORK' as const,
      holidayName: null,
    })),
    employees: [
      {
        employeeId: 'e1',
        employeeCode: 'NV001',
        employeeName: 'Hà Nguyên Hoàng',
        departmentName: null,
        positionName: null,
        days,
        standard: { mode: 'DYNAMIC', workdays: 22 },
        totals: {
          workdayUnits: 18, workedMinutes: 0, paidMinutes: 0, lateMinutes: 12, earlyLeaveMinutes: 0, otMinutes: 0,
          lateDays: 1, earlyLeaveDays: 0, abnormalDays: 0, absentDays: 1, annualLeaveDays: 1, paidLeaveDays: 0,
          unpaidLeaveDays: 0, tripDays: 0, offDays: 9, holidayDays: 0,
        },
      },
    ],
    meta: { total: 1, page: 1, pageSize: 50 },
  };
}

function respond() {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/my-attendance-context'))
      return {
        data: {
          employeeId: 'e1',
          workDate: d(10),
          timezone: 'Asia/Ho_Chi_Minh',
          requireGps: false,
          shift: { window: { start: '2026-10-10T01:00:00.000Z', end: '2026-10-10T10:00:00.000Z', graceLateMinutes: 10, graceEarlyMinutes: 10 } },
        },
      };
    if (path.startsWith('/timesheet-board')) return { data: board() };
    if (path === '/my-profile') return { data: { employeeId: 'e1' } };
    if (path.startsWith('/leave-types')) return { data: [{ id: 'lt', isAnnual: true }, { id: 'ot', isAnnual: false }] };
    if (path === '/employees/e1/leave-balances')
      return { data: [{ leaveTypeId: 'lt', openingBalance: 0, accrued: 15, used: 3, pending: 0, adjusted: 0, remaining: 12, projectedEntitlement: 15, available: 12 }] };
    if (path === '/my-payslips')
      return {
        data: [
          { id: 'p9', status: 'PUBLISHED', issuedAt: '2026-10-05T03:00:00.000Z', publishedAt: '2026-10-05T03:00:00.000Z', createdAt: '2026-10-05T03:00:00.000Z', snapshotJson: { periodCode: '2026-09' } },
          { id: 'p8', status: 'PUBLISHED', issuedAt: '2026-09-05T03:00:00.000Z', publishedAt: '2026-09-05T03:00:00.000Z', createdAt: '2026-09-05T03:00:00.000Z', snapshotJson: { periodCode: '2026-08' } },
        ],
      };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
}

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-10-10T01:24:00Z'), // 08:24 thứ Bảy 10/10/2026 giờ Việt Nam
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  secondPendingRequest = false;
  fetchMock.mockReset();
  respond();
});

describe('Card Trợ lý trong khung chat gửi đơn', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, writable: true, value: FakeBroadcastChannel });
  });
  afterAll(() => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  });

  it('Bàn làm việc tải lại phần cá nhân khi card gửi đơn HRM; thao tác của phân hệ khác thì không', async () => {
    render(<HrmDashboardPage />);
    await waitFor(() => expect(within(screen.getByTestId('kpi-requests')).getByText('1 đang xử lý')).toBeTruthy());
    const boardLoads = () => fetchMock.mock.calls.filter(([path]) => String(path).startsWith('/timesheet-board')).length;
    const before = boardLoads();

    act(() => announceAssistantSaved({ requestId: 'w1', key: 'workspace.event.create', outcome: 'saved' }));
    expect(boardLoads()).toBe(before);

    secondPendingRequest = true;
    act(() =>
      announceAssistantSaved({ requestId: 'r1', key: 'hrm.leave-request.create', outcome: 'saved', id: 'l2' }),
    );
    await waitFor(() => expect(within(screen.getByTestId('kpi-requests')).getByText('2 đang xử lý')).toBeTruthy());
    expect(boardLoads()).toBe(before + 1);
  });
});

describe('Bàn làm việc cá nhân', () => {
  it('chào theo tên và giờ, hiện đồng hồ và ngày hôm nay', async () => {
    render(<HrmDashboardPage />);
    expect(await screen.findByRole('heading', { level: 1, name: /Bàn làm việc/ })).toBeTruthy();
    expect(screen.getByText('Chào buổi sáng, Hoàng!')).toBeTruthy();
    expect(screen.getByTestId('hero-clock').textContent).toBe('08:24');
    expect(screen.getByText(/Thứ Bảy, 10\/10\/2026/)).toBeTruthy();
  });

  it('bốn chỉ số đầu trang lấy từ dữ liệu thật: trạng thái, phép, đơn chờ, công tháng', async () => {
    render(<HrmDashboardPage />);
    await waitFor(() => expect(within(screen.getByTestId('kpi-timesheet')).getByText('18 / 22 ngày')).toBeTruthy());
    expect(within(screen.getByTestId('kpi-today')).getByText('Chưa vào ca')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-leave')).getByText('12 / 15 ngày')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-requests')).getByText('1 đang xử lý')).toBeTruthy();
  });

  it('chấm công hôm nay: ca, trạng thái và hai nút; nút vào ca dùng được khi có ca', async () => {
    render(<HrmDashboardPage />);
    const card = await screen.findByLabelText('Chấm công hôm nay');
    await waitFor(() => expect(within(card).getByText(/08:00 - 17:00/)).toBeTruthy());
    expect(within(card).getByText('Hành chính', { exact: false })).toBeTruthy();
    expect(within(card).getByTestId('punch-state').textContent).toBe('Chưa vào ca');
    expect((within(card).getByRole('button', { name: /Ghi nhận vào ca/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('phép năm của tôi: còn lại, đã dùng, đã đăng ký và nút đăng ký mở form nghỉ phép', async () => {
    render(<HrmDashboardPage />);
    const card = await screen.findByLabelText('Phép năm của tôi');
    await waitFor(() => expect(within(card).getAllByText('12 / 15').length).toBeGreaterThan(0));
    expect(within(card).getByText('3 ngày')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Đăng ký nghỉ phép' }).getAttribute('href')).toBe('/requests?create=leave');
  });

  it('thẻ Đơn của tôi có danh sách đơn đang xử lý sổ xuống khi bấm; các thẻ trạng thái hôm nay, phép năm, bảng công không bấm được', async () => {
    render(<HrmDashboardPage />);
    const requests = await screen.findByTestId('kpi-requests');
    await waitFor(() => expect(within(requests).getByText('1 đang xử lý')).toBeTruthy());
    // Mặc định chỉ hiển thị thông tin; bấm thẻ mới sổ xuống danh sách đơn đang xử lý, mỗi đơn là một liên kết.
    expect(screen.queryByTestId('kpi-requests-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xem danh sách: Đơn của tôi/ }));
    const list = await screen.findByTestId('kpi-requests-list');
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toMatch(/^\/requests\?request=/);
    for (const id of ['kpi-today', 'kpi-leave', 'kpi-timesheet']) {
      const card = screen.getByTestId(id);
      expect(card.closest('a')).toBeNull();
      expect(card.closest('button')).toBeNull();
    }
  });

  it('thao tác nhanh có bốn lối tắt tạo đơn đúng loại', async () => {
    render(<HrmDashboardPage />);
    const quick = await screen.findByLabelText('Thao tác nhanh');
    const hrefs = within(quick).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/requests?create=leave', '/requests?create=ot', '/requests?create=correction', '/requests?create=business_trip']);
  });

  it('bảng công tháng dạng lịch: mỗi ngày một ô có chấm theo trạng thái; tổng công tháng đủ bốn ô', async () => {
    render(<HrmDashboardPage />);
    await waitFor(() => expect(screen.getAllByTestId(/^strip-dot-/)).toHaveLength(31));
    expect(screen.getByTestId(`strip-dot-${d(1)}`).getAttribute('data-tone')).toBe('present');
    expect(screen.getByTestId(`strip-dot-${d(2)}`).getAttribute('data-tone')).toBe('late');
    expect(screen.getByTestId(`strip-dot-${d(3)}`).getAttribute('data-tone')).toBe('absent');
    expect(screen.getByTestId(`strip-dot-${d(6)}`).getAttribute('data-tone')).toBe('leave');
    expect(screen.getByTestId(`strip-dot-${d(20)}`).getAttribute('data-tone')).toBe('future');
    expect(screen.getByTestId(`strip-dot-${d(4)}`).getAttribute('data-tone')).toBe('off');
    const totals = screen.getByLabelText('Tổng công tháng');
    expect(within(totals.querySelector('[data-testid="total-Ngày công"]') as HTMLElement).getByText('18')).toBeTruthy();
    expect(within(totals.querySelector('[data-testid="total-Đi trễ"]') as HTMLElement).getByText('1')).toBeTruthy();
    expect(within(totals.querySelector('[data-testid="total-Thiếu công"]') as HTMLElement).getByText('1')).toBeTruthy();
    expect(within(totals.querySelector('[data-testid="total-Nghỉ phép"]') as HTMLElement).getByText('1')).toBeTruthy();
  });

  it('bảng công tháng là lịch tuần bắt đầu thứ Hai, không cuộn ngang; bấm một ngày bất thường mở chi tiết ngày đó', async () => {
    render(<HrmDashboardPage />);
    const strip = await screen.findByTestId('month-strip');
    await waitFor(() => expect(within(strip).getAllByRole('button')).toHaveLength(31));
    // Tiêu đề thứ T2 đến CN, Chủ nhật tô đỏ; 1/10/2026 là thứ Năm nên đứng ở cột thứ tư
    expect(within(strip).getByText('T2')).toBeTruthy();
    expect(within(strip).getByText('CN').className).toContain('text-rose-500');
    const buttons = within(strip).getAllByRole('button');
    const firstRow = buttons[0].parentElement as HTMLElement;
    expect(firstRow.children).toHaveLength(7);
    expect(firstRow.children[3]).toBe(buttons[0]);
    expect(firstRow.children[0].getAttribute('aria-hidden')).toBe('true');
    // Lịch vừa khít thẻ: không có vùng cuộn ngang và không đặt bề rộng tối thiểu
    expect(strip.closest('section')?.querySelector('.overflow-x-auto')).toBeNull();
    expect(strip.innerHTML).not.toContain('min-w-[640px]');
    expect(screen.getByText(/ngày cần xem/)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`strip-dot-${d(2)}`));
    expect(await screen.findByText('Chi tiết ngày công')).toBeTruthy();
    expect(screen.getByTestId('kpi-late').textContent).toContain('12');
    expect(screen.getByTestId('day-status').textContent).toBe('Đi trễ');
  });

  it('bấm ngày vắng không có chấm công: chi tiết báo thiếu giờ vào và ra', async () => {
    render(<HrmDashboardPage />);
    fireEvent.click(await screen.findByTestId(`strip-dot-${d(3)}`));
    expect(await screen.findByText('Chi tiết ngày công')).toBeTruthy();
    expect(screen.getByTestId('day-status').textContent).toBe('Nghỉ không phép');
    expect(within(screen.getByLabelText('Ca làm việc và giờ chấm công')).getAllByText('Chưa có').length).toBe(2);
  });

  it('không còn thẻ lịch làm việc tuần này và không tải thêm bảng công tháng khác', async () => {
    render(<HrmDashboardPage />);
    await screen.findByTestId('month-strip');
    expect(screen.queryByLabelText('Lịch làm việc tuần này')).toBeNull();
    expect(screen.queryByText('Lịch làm việc tuần này')).toBeNull();
    const boardCalls = fetchMock.mock.calls.filter(([p]) => String(p).startsWith('/timesheet-board?'));
    expect(boardCalls).toHaveLength(1);
  });

  it('đơn từ của tôi hiện đơn mới nhất kèm trạng thái; phiếu lương hiện kỳ mới nhất và kỳ khác', async () => {
    render(<HrmDashboardPage />);
    const requests = await screen.findByLabelText('Đơn từ của tôi');
    await waitFor(() => expect(within(requests).getByText(/Đơn nghỉ: Nghỉ phép năm/)).toBeTruthy());
    expect(within(requests).getByText('Chờ duyệt')).toBeTruthy();
    expect(within(requests).getByRole('link', { name: /Đơn nghỉ/ }).getAttribute('href')).toBe('/requests?request=l1');
    const pay = await screen.findByLabelText('Phiếu lương gần nhất');
    await waitFor(() => expect(within(pay).getByText('Tháng 09/2026')).toBeTruthy());
    expect(within(pay).getByText('Tháng 08/2026')).toBeTruthy();
    expect(within(pay).getByRole('link', { name: 'Xem chi tiết' }).getAttribute('href')).toBe('/profile?view=payslips&selected=p9');
  });

  it('không có nhà cung cấp thông báo thì thẻ Thông báo báo trống, không lỗi', async () => {
    render(<HrmDashboardPage />);
    const card = await screen.findByLabelText('Thông báo');
    expect(within(card).getByText(/Chưa có thông báo mới/)).toBeTruthy();
  });
});
