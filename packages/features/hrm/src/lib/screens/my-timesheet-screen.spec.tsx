/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  HrmBoardDay,
  HrmDayRequest,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { monthRange, shiftMonth } from '../hrm-timesheet-format';
import MyTimesheetScreen from './my-timesheet-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.self.read'],
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
// Cố định "hôm nay" là 15/9/2026 (giờ Việt Nam) để ngày đã qua và ngày chưa tới ổn định.
const month = '2026-09';
const { from, to } = monthRange(month);
const dayCount = Number(to.slice(8, 10));
const d = (n: number) => `${month}-${String(n).padStart(2, '0')}`;

const baseDay = (date: string, over: Partial<HrmBoardDay> = {}): HrmBoardDay => ({
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

const futureDay = (date: string, over: Partial<HrmBoardDay> = {}) =>
  baseDay(date, {
    status: 'FUTURE',
    checkIn: null,
    checkOut: null,
    workedMinutes: 0,
    paidMinutes: 0,
    workdayUnits: 0,
    ...over,
  });

const otRequest: HrmDayRequest = {
  kind: 'OT',
  id: 'ot-1',
  status: 'APPROVED',
  label: 'Tăng ca dự án',
  minutes: 240,
  fromAt: '2026-09-04T15:00:00.000Z', // 22:00 ngày 4 theo giờ Việt Nam
  toAt: '2026-09-04T19:00:00.000Z', // 02:00 ngày 5
  reasonName: 'Tăng ca dự án',
  description: 'Chạy kịp tiến độ bàn giao',
  otRate: 2,
  createdAt: '2026-09-03T03:00:00.000Z',
};
const leaveRequest: HrmDayRequest = {
  kind: 'LEAVE',
  id: 'leave-1',
  status: 'PENDING',
  label: 'Nghỉ phép năm',
  minutes: 240,
  fromAt: '2026-09-20T01:00:00.000Z',
  toAt: '2026-09-20T05:00:00.000Z',
  reasonName: 'Việc gia đình',
};

function board(): HrmTimesheetBoard {
  const days: Record<string, HrmBoardDay> = {};
  for (let i = 1; i <= dayCount; i++) days[d(i)] = i <= 15 ? baseDay(d(i)) : futureDay(d(i));
  days[d(2)] = baseDay(d(2), { status: 'ABSENT', checkIn: null, checkOut: null, workdayUnits: 0 });
  days[d(3)] = baseDay(d(3), { status: 'LATE', checkIn: '08:20', lateMinutes: 20, workdayUnits: 1 });
  days[d(4)] = baseDay(d(4), { requests: [otRequest], otMinutes: 240 });
  days[d(20)] = futureDay(d(20), { requests: [leaveRequest] });
  days[d(6)] = baseDay(d(6), { kind: 'OFF', status: 'OFF', shiftCode: null, checkIn: null, checkOut: null, workdayUnits: 0, scheduledMinutes: 0 });
  return {
    month: { month, from, to, state: 'OPEN', periodId: null, requestsClosedAt: null, lockedAt: null, calculatedAt: null },
    canViewAll: false,
    calendar: Array.from({ length: dayCount }, (_, i) => ({
      date: d(i + 1),
      weekday: new Date(`${d(i + 1)}T00:00:00Z`).getUTCDay(),
      kind: 'WORK' as const,
      holidayName: null,
    })),
    employees: [
      {
        employeeId: 'me',
        employeeCode: 'NV009',
        employeeName: 'Tôi',
        departmentName: 'Kho',
        positionName: null,
        days,
        standard: { mode: 'FIXED', workdays: 26 },
        totals: {
          workdayUnits: 13, workedMinutes: 6240, paidMinutes: 0, lateMinutes: 20, earlyLeaveMinutes: 0, otMinutes: 240,
          lateDays: 1, earlyLeaveDays: 0, abnormalDays: 0, absentDays: 1, annualLeaveDays: 0, paidLeaveDays: 0,
          unpaidLeaveDays: 0, tripDays: 0, offDays: 1, holidayDays: 0,
        },
      },
    ],
    meta: { total: 1, page: 1, pageSize: 50 },
  };
}

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-09-15T05:00:00Z'),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
      'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
    ],
  });
});
afterAll(() => jest.useRealTimers());
beforeEach(() => fetchMock.mockReset());

describe('MyTimesheetScreen (Công của tôi)', () => {
  it('chỉ một bảng công của chính mình: thống kê tháng, lịch từng ngày, không còn lưới nhiều nhân viên', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);

    expect(await screen.findByLabelText('Bảng công theo tháng')).toBeTruthy();
    expect(screen.getByText(/NV009 · Tôi/)).toBeTruthy();
    expect(screen.getByTestId('month-state').textContent).toContain('Đang mở');
    expect(screen.queryByLabelText('Tìm nhân viên trong bảng công')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chốt/ })).toBeNull();

    const stats = screen.getByTestId('my-stats');
    expect(within(stats).getByTestId('my-stat-units').textContent).toContain('13');
    expect(within(stats).getByTestId('my-stat-late').textContent).toContain('1');
    expect(within(stats).getByTestId('my-stat-late').textContent).toContain('lần');
    expect(within(stats).getByTestId('my-stat-late').textContent).toContain('20 phút');
    expect(within(stats).getByTestId('my-stat-absent').textContent).toContain('KP');
    expect(within(stats).getByTestId('my-stat-ot').textContent).toContain('4.0');
    expect(within(stats).getByTestId('my-stat-pending').textContent).toContain('1');
    // công thực tế đi kèm công chuẩn và thanh tiến độ
    expect(within(stats).getByTestId('my-stat-units').textContent).toContain('13.0');
    expect(within(stats).getByTestId('my-stat-units').textContent).toContain('/ 26.0');
    expect(within(stats).getByTestId('my-stat-units').textContent).toContain('Cố định');
    expect(within(stats).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');

    const path = fetchMock.mock.calls[0][0] as string;
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/timesheet-board?')).toBe(true);
    expect(query.get('self')).toBe('1');
  });

  it('ngày đã qua hiện số công (không hiện mã ca), ngày chưa tới hiện mã ca, ngày nghỉ hiện OFF', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    await screen.findByLabelText('Bảng công theo tháng');

    const past = screen.getByTestId(`my-cell-${d(1)}`);
    // hệ số công của ngày (1), không phải số giờ làm (8.0)
    expect(within(past).getByTestId('my-cell-units').textContent).toBe('1');
    expect(past.textContent).not.toContain('8.0');
    expect(past.textContent).not.toContain('HC');
    expect(past.getAttribute('data-future')).toBeNull();

    const future = screen.getByTestId(`my-cell-${d(25)}`);
    expect(future.textContent).toContain('HC');
    expect(future.getAttribute('data-future')).toBe('true');

    expect(screen.getByTestId(`my-cell-${d(6)}`).textContent).toContain('OFF');
    // ngày vắng đã qua: không có giờ làm, hiện dấu gạch dài và ký hiệu KP
    expect(screen.getByTestId(`my-cell-${d(2)}`).textContent).toContain('—');
  });

  it('ngày chưa tới mà chưa phân ca ghi rõ Chưa có ca thay vì để trống', async () => {
    const b = board();
    (b.employees[0].days as Record<string, HrmBoardDay>)[d(28)] = futureDay(d(28), { kind: 'NO_SCHEDULE', shiftCode: null, shiftName: null });
    fetchMock.mockResolvedValue({ data: b } as never);
    render(<MyTimesheetScreen />);
    await screen.findByLabelText('Bảng công theo tháng');
    expect(screen.getByTestId(`my-cell-${d(28)}`).textContent).toContain('Chưa có ca');
  });

  it('đi trễ về sớm tô đỏ, ngày bình thường không đỏ', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    await screen.findByLabelText('Bảng công theo tháng');

    const late = screen.getByTestId(`my-cell-${d(3)}`);
    expect(late.getAttribute('data-late')).toBe('true');
    expect(late.className).toContain('bg-red-100');
    expect(late.textContent).toContain('Trễ 20p');
    expect(screen.getByTestId(`my-cell-${d(1)}`).getAttribute('data-late')).toBeNull();
  });

  it('ký hiệu theo quy ước: TC tăng ca đã duyệt, P phép chờ duyệt, KP vắng không phép', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    await screen.findByLabelText('Bảng công theo tháng');

    const ot = within(screen.getByTestId(`my-cell-${d(4)}`)).getByTestId('request-letter-OT');
    expect(ot.textContent).toBe('TC');
    expect(ot.getAttribute('title')).toContain('đã duyệt');
    const leave = within(screen.getByTestId(`my-cell-${d(20)}`)).getByTestId('request-letter-LEAVE');
    expect(leave.textContent).toBe('P');
    expect(leave.getAttribute('title')).toContain('chờ duyệt');
    expect(within(screen.getByTestId(`my-cell-${d(1)}`)).queryByTestId(/request-letter/)).toBeNull();
    // ngày vắng không có đơn nghỉ: KP
    expect(within(screen.getByTestId(`my-cell-${d(2)}`)).getByTestId('request-letter-ABSENT').textContent).toBe('KP');
  });

  it('bấm ngày có đơn: thấy loại đơn, ngày giờ, lý do, hệ số và trạng thái', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    fireEvent.click(await screen.findByTestId(`my-cell-${d(4)}`));

    const list = await screen.findByTestId('day-sources');
    expect(list.textContent).toContain('Đơn làm thêm giờ');
    expect(list.textContent).toContain('Đã duyệt');
    expect(list.textContent).toContain('04/09/2026 22:00 - 05/09/2026 02:00');
    expect(list.textContent).toContain('Tăng ca dự án');
    expect(list.textContent).toContain('Chạy kịp tiến độ bàn giao');
    expect(list.textContent).toContain('x2');
    expect(list.textContent).toContain('03/09/2026 10:00');
    // nhân viên tự xem: mở đơn ở Đơn từ của tôi
    expect(within(list).getByRole('link').getAttribute('href')).toBe('/requests?request=ot-1');
  });

  it('danh sách đơn từ trong tháng; bấm một đơn mở chi tiết ngày của đơn', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    await screen.findByLabelText('Bảng công theo tháng');
    const tab = screen.getByRole('tab', { name: /Đơn từ trong tháng/ });
    expect(tab.textContent).toContain('(2)');
    fireEvent.click(tab);
    const panel = await screen.findByTestId('my-month-requests');
    expect(panel.textContent).toContain('Chờ duyệt');
    fireEvent.click(within(panel).getByText(/Đơn nghỉ: Nghỉ phép năm/));
    const list = await screen.findByTestId('day-sources');
    expect(list.textContent).toContain('20/09/2026 08:00 - 12:00');
    expect(list.textContent).toContain('Việc gia đình');
  });

  it('mặc định mở chi tiết hôm nay với dòng thời gian chấm công; bấm ngày khác đổi chi tiết', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    const panel = await screen.findByTestId('my-day-panel');
    expect(panel.textContent).toContain('15/09/2026');
    expect(panel.textContent).toContain('Hôm nay');
    const timeline = within(panel).getByTestId('day-timeline');
    expect(timeline.textContent).toContain('Chấm công vào');
    expect(timeline.textContent).toContain('08:00');

    fireEvent.click(screen.getByTestId(`my-cell-${d(3)}`));
    const late = screen.getByTestId('my-day-panel');
    expect(late.textContent).toContain('03/09/2026');
    expect(within(late).getByTestId('day-status').textContent).toBe('Đi trễ');
    expect(within(late).getByTestId('kpi-in').textContent).toContain('08:20');
    expect(within(late).getByTestId('kpi-worked').textContent).toContain('8.0');
    expect(within(late).getByTestId('day-timeline').textContent).toContain('Trễ 20 phút');
  });

  it('thông tin ca làm mở sẵn, có giờ nghỉ giữa ca khi ca có nghỉ; bấm để thu gọn', async () => {
    const b = board();
    (b.employees[0].days as Record<string, HrmBoardDay>)[d(15)] = baseDay(d(15), {
      shiftBreakStart: '12:00',
      shiftBreakEnd: '13:00',
      shiftBreakMinutes: 60,
    });
    fetchMock.mockResolvedValue({ data: b } as never);
    render(<MyTimesheetScreen />);
    const info = await screen.findByTestId('day-shift-info');
    expect(info.textContent).toContain('Hành chính (08:00 - 17:00)');
    expect(info.textContent).toContain('8 giờ');
    expect(info.textContent).toContain('12:00 - 13:00 (1 giờ)');
    const timeline = screen.getByTestId('day-timeline');
    expect(timeline.textContent).toContain('Bắt đầu nghỉ giữa ca');
    expect(timeline.textContent).toContain('Kết thúc nghỉ giữa ca');
    fireEvent.click(within(info).getByRole('button', { name: /Thông tin ca làm/ }));
    expect(within(info).queryByText(/Hành chính/)).toBeNull();
  });

  it('Xem chi tiết chấm công mở ngăn kéo đầy đủ của ngày đang chọn', async () => {
    fetchMock.mockResolvedValue({ data: board() } as never);
    render(<MyTimesheetScreen />);
    await screen.findByTestId('my-day-panel');
    fireEvent.click(screen.getByRole('button', { name: /Xem chi tiết chấm công/ }));
    expect(await screen.findByText('Chi tiết ngày công')).toBeTruthy();
  });

  it('tải tháng trước khi bấm nút tháng trước; tháng không có dữ liệu', async () => {
    fetchMock.mockResolvedValue({ data: { ...board(), employees: [] } } as never);
    render(<MyTimesheetScreen />);
    expect(await screen.findByText(/Chưa có dữ liệu bảng công/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const query = new URLSearchParams((fetchMock.mock.calls[1][0] as string).split('?')[1]);
    expect(query.get('month')).toBe(shiftMonth(month, -1));
  });

  it('hiển thị lỗi kèm nút tải lại', async () => {
    fetchMock.mockRejectedValueOnce(new HrmApiError('Không có quyền xem bảng công', 403, 'FORBIDDEN', {}));
    render(<MyTimesheetScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không có quyền xem bảng công');
    fetchMock.mockResolvedValueOnce({ data: board() } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(await screen.findByLabelText('Bảng công theo tháng')).toBeTruthy();
  });
});
