/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  HrmBoardDay,
  HrmBoardEmployee,
  HrmMonthCloseState,
  HrmTimesheetBoard,
  HrmTimesheetMonthState,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { currentMonthVn, monthRange, weekdayVn } from '../hrm-timesheet-format';
import { BOARD_FILTERS, matchesBoardFilter, type BoardFilter } from '../ui/my-timesheet-format';
import TimesheetsScreen from './timesheets-screen';

let mockAllowed: string[] = [];
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: mockAllowed,
    loading: false,
    error: '',
    displayName: '',
    can: (a: string) => mockAllowed.includes(a),
    any: () => true,
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});
jest.mock('../hrm-csv', () => {
  const actual = jest.requireActual('../hrm-csv');
  return { ...actual, downloadCsv: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const month = currentMonthVn();
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

const totals = {
  workdayUnits: 20,
  workedMinutes: 0,
  paidMinutes: 0,
  lateMinutes: 15,
  earlyLeaveMinutes: 0,
  otMinutes: 90,
  lateDays: 1,
  earlyLeaveDays: 0,
  abnormalDays: 1,
  absentDays: 0,
  annualLeaveDays: 1,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  tripDays: 0,
  offDays: 8,
  holidayDays: 0,
};

function employee(id: string, code: string, name: string): HrmBoardEmployee {
  const days: Record<string, HrmBoardDay> = {};
  for (let i = 1; i <= dayCount; i++) days[d(i)] = baseDay(d(i));
  days[d(1)] = baseDay(d(1), { kind: 'OFF', status: 'OFF', shiftCode: null, shiftName: null, workdayUnits: 0 });
  days[d(2)] = baseDay(d(2), { status: 'LATE', lateMinutes: 15, checkIn: '08:15' });
  days[d(3)] = baseDay(d(3), {
    status: 'ABNORMAL',
    checkOut: null,
    anomalies: ['MISSING_CHECK_OUT'],
    workdayUnits: 0,
    adjusted: true,
  });
  days[d(4)] = baseDay(d(4), {
    status: 'ANNUAL_LEAVE',
    checkIn: null,
    checkOut: null,
    leave: { requestId: 'r1', reasonName: 'Nghỉ phép năm', paid: true, annual: true, days: 1 },
  });
  days[d(5)] = baseDay(d(5), { kind: 'HOLIDAY', status: 'HOLIDAY', holidayName: 'Quốc khánh', workdayUnits: 0 });
  return { employeeId: id, employeeCode: code, employeeName: name, departmentName: 'Sản xuất', positionName: null, days, totals };
}

function makeBoard(
  state: HrmTimesheetMonthState,
  canViewAll: boolean,
  employees = [employee('e1', 'NV001', 'Nguyễn Văn An')],
): HrmTimesheetBoard {
  return {
    month: {
      month,
      from,
      to,
      state,
      periodId: null,
      requestsClosedAt: state === 'OPEN' ? null : '2026-10-01T03:30:00Z',
      lockedAt: state === 'LOCKED' ? '2026-10-02T03:30:00Z' : null,
      calculatedAt: null,
    },
    canViewAll,
    calendar: Array.from({ length: dayCount }, (_, i) => ({
      date: d(i + 1),
      weekday: new Date(`${d(i + 1)}T00:00:00Z`).getUTCDay(),
      kind: i === 0 ? ('OFF' as const) : i === 4 ? ('HOLIDAY' as const) : ('WORK' as const),
      holidayName: i === 4 ? 'Quốc khánh' : null,
    })),
    employees,
    meta: { total: employees.length, page: 1, pageSize: 50 },
  };
}

const closeState = (
  requests: HrmMonthCloseState['blockersForRequests'] = [],
  lock: HrmMonthCloseState['blockersForLock'] = [],
): { data: HrmMonthCloseState } => ({
  data: { month: makeBoard('OPEN', true).month, blockersForRequests: requests, blockersForLock: lock },
});

/** Nhân viên không có bất thường nào (mọi ngày bình thường), tuỳ chỉnh thêm ngày và tổng. */
const plain = (e: HrmBoardEmployee, extra: Record<string, HrmBoardDay> = {}, over: Partial<typeof totals> = {}) => ({
  ...e,
  days: { ...Object.fromEntries(Object.keys(e.days).map((k) => [k, baseDay(k)])), ...extra },
  totals: { ...totals, lateMinutes: 0, lateDays: 0, abnormalDays: 0, ...over },
});

/** Giả lập máy chủ: lọc nhanh và đếm trên TOÀN BỘ nhân viên, rồi mới phân trang theo page/page_size. */
function serveBoard(board: HrmTimesheetBoard, path: string): HrmTimesheetBoard {
  // Bảng dựng sẵn cho một trang (meta.total khác số dòng): trả nguyên để kiểm thử riêng phần phân trang.
  if (board.meta.total !== board.employees.length) return board;
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const flag = (query.get('flag') ?? 'ALL') as BoardFilter;
  const page = Number(query.get('page') ?? 1);
  const pageSize = Number(query.get('page_size') ?? 50);
  const all = board.employees;
  const matched = all.filter((e) => matchesBoardFilter(e, flag));
  const counts = Object.fromEntries(
    BOARD_FILTERS.map((f) => [f.id, all.filter((e) => matchesBoardFilter(e, f.id)).length]),
  ) as Record<BoardFilter, number>;
  return {
    ...board,
    employees: matched.slice((page - 1) * pageSize, page * pageSize),
    meta: { total: matched.length, page, pageSize, counts },
  };
}

function mockApi(board: HrmTimesheetBoard, close = closeState()) {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/timesheet-board')) return { data: serveBoard(board, path) };
    if (path.endsWith('/close-state')) return close;
    return { data: {} };
  }) as never);
}

const ALL = ['hrm.timesheet.read', 'hrm.timesheet.calculate', 'hrm.timesheet.reopen', 'hrm.timesheet.export', 'hrm.timesheet.adjust'];

beforeEach(() => {
  fetchMock.mockReset();
  mockAllowed = ALL;
});

describe('TimesheetsScreen', () => {
  it('mã ca chỉ hiện ở ngày chưa tới; ngày đã qua chỉ hiện công hoặc đơn từ', async () => {
    jest.useFakeTimers({
      now: new Date(`${month}-10T05:00:00Z`),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    try {
      const board = makeBoard('OPEN', true);
      (board.employees[0].days as Record<string, HrmBoardDay>)[d(20)] = baseDay(d(20), {
        status: 'FUTURE', checkIn: null, checkOut: null, workedMinutes: 0, paidMinutes: 0, workdayUnits: 0,
      });
      mockApi(board);
      render(<TimesheetsScreen />);
      await screen.findAllByTestId('board-day-header');
      const past = screen.getByTestId(`board-cell-e1-${d(2)}`);
      expect(past.querySelector('[data-testid="cell-shift-code"]')).toBeNull();
      expect(past.textContent).not.toContain('HC');
      expect(past.querySelector('[data-testid="cell-units"]')).not.toBeNull();
      const future = screen.getByTestId(`board-cell-e1-${d(20)}`);
      expect(future.querySelector('[data-testid="cell-shift-code"]')?.textContent).toBe('HC');
    } finally {
      jest.useRealTimers();
    }
  });

  it('hiển thị đủ cột ngày của tháng, ký hiệu từng trạng thái và không còn Tạo kỳ công', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    expect(await screen.findAllByTestId('board-day-header')).toHaveLength(dayCount);
    expect(within(screen.getAllByTestId('board-day-header')[0]).getByText(weekdayVn(d(1)))).toBeTruthy();

    // Ngày nghỉ hằng tuần để trống (tô xám), ngày đã qua hiện số công, đi trễ tô đỏ, bất thường hiện !, lễ hiện L.
    expect(screen.getByTestId(`board-cell-e1-${d(1)}`).getAttribute('data-status')).toBe('OFF');
    expect(screen.getByTestId(`board-cell-e1-${d(1)}`).textContent).toBe('OFF');
    expect(screen.getByTestId(`board-cell-e1-${d(2)}`).querySelector('[data-testid="cell-units"]')).not.toBeNull();
    expect(screen.getByTestId(`board-cell-e1-${d(2)}`).getAttribute('data-late')).toBe('true');
    // Không tô nền ô, chỉ màu chữ của số công.
    expect(screen.getByTestId(`board-cell-e1-${d(2)}`).className).not.toMatch(/(?:^|\s)bg-(red|orange|emerald)/);
    // Quên chấm công: hệ số 0 màu đỏ (thay cho ký hiệu !).
    expect(within(screen.getByTestId(`board-cell-e1-${d(3)}`)).getByTestId('cell-units').textContent).toBe('0');
    expect(within(screen.getByTestId(`board-cell-e1-${d(3)}`)).getByTestId('cell-units').getAttribute('data-tone')).toBe('bad');
    expect(within(screen.getByTestId(`board-cell-e1-${d(2)}`)).getByTestId('cell-units').getAttribute('data-tone')).toBe('bad');
    expect(screen.getByTestId(`board-cell-e1-${d(4)}`).getAttribute('data-status')).toBe('ANNUAL_LEAVE');
    expect(screen.getByTestId(`board-cell-e1-${d(5)}`).textContent).toContain('L');
    expect(screen.getByTestId(`board-cell-e1-${d(2)}`).getAttribute('title')).toContain('Đi trễ: 15 phút');

    expect(screen.getByLabelText('Chú thích bảng công')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tạo kỳ công/ })).toBeNull();
    expect(screen.getByTestId('month-state').textContent).toContain('Đang mở');

    const path = fetchMock.mock.calls[0][0] as string;
    const q = new URLSearchParams(path.split('?')[1]);
    expect(q.get('month')).toBe(month);
    expect(q.get('page_size')).toBe('10');
  });

  it('canViewAll=true có ô tìm; canViewAll=false thì ẩn ô tìm và các nút chốt', async () => {
    mockApi(makeBoard('OPEN', true));
    const view = render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getByLabelText('Tìm nhân viên trong bảng công')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chốt đơn từ/ })).toBeTruthy();
    view.unmount();

    mockApi(makeBoard('OPEN', false));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.queryByLabelText('Tìm nhân viên trong bảng công')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chốt/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mở lại$/ })).toBeNull();
    expect(screen.getByLabelText('Chú thích bảng công')).toBeTruthy();
  });

  it('nút chốt theo trạng thái tháng', async () => {
    mockApi(makeBoard('REQUESTS_CLOSED', true));
    const view = render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getByTestId('month-state').textContent).toContain('Đã chốt đơn từ');
    expect((screen.getByRole('button', { name: /Chốt đơn từ/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Chốt công/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /Mở lại/ }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();

    mockApi(makeBoard('LOCKED', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getByTestId('month-state').textContent).toContain('Đã chốt công');
    expect((screen.getByRole('button', { name: /Chốt công/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Mở lại/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ẩn nút theo quyền', async () => {
    mockAllowed = ['hrm.timesheet.read'];
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.queryByRole('button', { name: /Chốt đơn từ/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chốt công/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xuất CSV/ })).toBeNull();
  });

  it('Dialog chốt đơn từ hiển thị việc còn vướng và khóa xác nhận', async () => {
    mockApi(
      makeBoard('OPEN', true),
      closeState([{ code: 'PENDING_REQUESTS', message: 'Còn đơn chờ duyệt trong tháng', count: 3 }]),
    );
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Chốt đơn từ/ }));
    const blockers = await screen.findByTestId('close-blockers');
    expect(blockers.textContent).toContain('Còn đơn chờ duyệt trong tháng (3)');
    const confirm = screen.getByRole('button', { name: 'Xác nhận chốt đơn từ' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('chốt đơn từ thành công thì gọi API và tải lại', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Chốt đơn từ/ }));
    await screen.findByText('Đủ điều kiện thực hiện.');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt đơn từ' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/timesheet-months/${month}/close-requests`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/timesheet-board'))).toHaveLength(2),
    );
  });

  it('chốt công báo lỗi tiếng Việt nguyên văn', async () => {
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/timesheet-board')) return { data: makeBoard('REQUESTS_CLOSED', true) };
      if (path.endsWith('/close-state')) return closeState();
      if (init?.method === 'POST') throw new Error('Tháng chưa kết thúc');
      return {};
    }) as never);
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Chốt công/ }));
    await screen.findByText('Đủ điều kiện thực hiện.');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chốt công' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Tháng chưa kết thúc');
  });

  it('Mở lại bắt buộc nhập lý do', async () => {
    mockApi(makeBoard('LOCKED', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Mở lại/ }));
    const confirm = (await screen.findByRole('button', { name: 'Xác nhận mở lại' })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do mở lại'), { target: { value: 'Sai công' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/timesheet-months/${month}/reopen`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Sai công' }) }),
      ),
    );
  });

  it('bấm ô ngày mở Drawer chi tiết ngày công', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByTestId(`board-cell-e1-${d(3)}`));
    expect(await screen.findByText('Chi tiết ngày công')).toBeTruthy();
    expect(screen.getByText('Thiếu chấm ra')).toBeTruthy();
    expect(screen.getByText('Đã chỉnh tay')).toBeTruthy();
    expect(screen.getByText('Hành chính')).toBeTruthy();
    expect(screen.getByText('08:00 - 17:00')).toBeTruthy();
  });

  it('chi tiết ngày: số công, giờ làm, trễ và sớm là các ô số liệu; trễ tô đỏ, giờ vào hiện số phút trễ', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByTestId(`board-cell-e1-${d(2)}`));
    await screen.findByText('Chi tiết ngày công');
    expect(screen.getByTestId('kpi-units').textContent).toContain('1');
    expect(screen.getByTestId('kpi-late').textContent).toContain('15');
    expect(screen.getByTestId('kpi-late').className).toContain('bg-orange-50');
    expect(screen.getByTestId('kpi-early').className).not.toContain('bg-orange-50');
    expect(screen.getByTestId('day-status').textContent).toBe('Đi trễ');
    expect(within(screen.getByLabelText('Ca làm việc và giờ chấm công')).getByText('Trễ 15p')).toBeTruthy();
  });

  it('bộ lọc nhanh đếm và lọc nhân viên: đi trễ, bất thường, vắng không phép, đơn chờ duyệt', async () => {
    const quiet = plain(employee('e2', 'NV002', 'Trần Thị Bình'));
    const absent = plain(
      employee('e3', 'NV003', 'Lê Văn Cường'),
      { [d(6)]: baseDay(d(6), { status: 'ABSENT', checkIn: null, checkOut: null, workdayUnits: 0 }) },
      { absentDays: 1 },
    );
    const pending = plain(employee('e4', 'NV004', 'Phạm Thị Dung'), {
      [d(8)]: baseDay(d(8), { requests: [{ kind: 'LEAVE', id: 'p1', status: 'PENDING', label: 'Nghỉ', minutes: 480 }] }),
    });
    mockApi(makeBoard('OPEN', true, [employee('e1', 'NV001', 'Nguyễn Văn An'), quiet, absent, pending]));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getAllByTestId('board-row')).toHaveLength(4);
    expect(screen.getByTestId('board-filter-LATE_EARLY').textContent).toContain('1');
    expect(screen.getByTestId('board-filter-ABNORMAL').textContent).toContain('1');
    expect(screen.getByTestId('board-filter-ABSENT').textContent).toContain('1');
    expect(screen.getByTestId('board-filter-PENDING').textContent).toContain('1');
    fireEvent.click(screen.getByTestId('board-filter-ABSENT'));
    expect(await screen.findByText('Lê Văn Cường')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('board-row')).toHaveLength(1));
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('flag=ABSENT');
    // số đếm không đổi khi đang lọc: vẫn tính trên toàn bộ nhân viên
    expect(screen.getByTestId('board-filter-PENDING').textContent).toContain('1');
    fireEvent.click(screen.getByTestId('board-filter-PENDING'));
    expect(await screen.findByText('Phạm Thị Dung')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Lê Văn Cường')).toBeNull());
    fireEvent.click(screen.getByTestId('board-filter-ALL'));
    await waitFor(() => expect(screen.getAllByTestId('board-row')).toHaveLength(4));
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('flag=');
  });

  it('lọc nhanh áp trên toàn bộ tháng, không phụ thuộc cỡ trang: người khớp ở trang sau vẫn được đếm và hiện', async () => {
    const pending = (id: string) => [
      { kind: 'LEAVE' as const, id, status: 'PENDING' as const, label: 'Nghỉ', minutes: 480 },
    ];
    // 12 nhân viên, cỡ trang mặc định 10: người có đơn chờ duyệt (NV011, NV012) nằm ở trang 2.
    const people = Array.from({ length: 12 }, (_, i) => {
      const code = `NV${String(i + 1).padStart(3, '0')}`;
      const base = employee(`e${i + 1}`, code, `Nhân viên ${i + 1}`);
      return i >= 10 ? plain(base, { [d(8)]: baseDay(d(8), { requests: pending(`p${i}`) }) }) : plain(base, {});
    });
    mockApi(makeBoard('OPEN', true, people));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getAllByTestId('board-row')).toHaveLength(10);
    // trang 1 không có ai chờ duyệt nhưng nút vẫn đếm đủ 2 người của cả tháng
    expect(screen.getByTestId('board-filter-PENDING').textContent).toContain('2');
    expect(screen.getByTestId('board-filter-ALL').textContent).toContain('12');
    fireEvent.click(screen.getByTestId('board-filter-PENDING'));
    await waitFor(() => expect(screen.getAllByTestId('board-row')).toHaveLength(2));
    expect(screen.getByText('Nhân viên 11')).toBeTruthy();
    expect(screen.getByText('Nhân viên 12')).toBeTruthy();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('page=1');
  });

  it('cột tổng hợp gọn: công, ngày trễ sớm, nghỉ, vắng, bất thường, tăng ca', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    const headers = within(screen.getByRole('table', { name: 'Bảng công theo tháng' }))
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    for (const label of ['Công', 'T/S', 'P', 'KP', '!', 'TC']) expect(headers).toContain(label);
    const row = screen.getByTestId('board-row');
    expect(within(row).getAllByRole('cell').slice(-6).map((c) => c.textContent)).toEqual(['20', '1', '1', '0', '1', '1:30']);
  });

  it('bấm tên nhân viên mở bảng công cả tháng của người đó; bấm một ngày trong đó hiện chi tiết ngày ngay bên dưới, không mở thêm ngăn kéo', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: 'Xem bảng công cả tháng của Nguyễn Văn An' }));
    expect(await screen.findByText(/Bảng công tháng/)).toBeTruthy();
    expect(screen.getByTestId('my-stats')).toBeTruthy();
    expect(screen.getByTestId('my-stat-late').textContent).toContain('1 ngày');
    fireEvent.click(screen.getByTestId(`my-cell-${d(2)}`));
    const inline = await screen.findByTestId('board-day-inline');
    expect(within(inline).getByTestId('kpi-late').textContent).toContain('15');
    // Chỉ còn một ngăn kéo (bảng công tháng), chi tiết ngày nằm trong đó.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByTestId('board-day-inline')).toBeTruthy();
    fireEvent.click(within(inline).getByRole('button', { name: 'Đóng chi tiết' }));
    await waitFor(() => expect(screen.queryByTestId('board-day-inline')).toBeNull());
  });

  it('Drawer ngày nghỉ phép hiển thị lý do nghỉ', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByTestId(`board-cell-e1-${d(4)}`));
    expect(await screen.findByText('Nghỉ phép năm (Có lương, trừ phép năm)')).toBeTruthy();
  });

  it('Drawer ngày lễ hiển thị tên lễ', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByTestId(`board-cell-e1-${d(5)}`));
    expect(await screen.findByText(/Lễ: Quốc khánh/)).toBeTruthy();
  });

  it('phân trang khi nhiều nhân viên', async () => {
    mockApi({ ...makeBoard('OPEN', true), meta: { total: 120, page: 1, pageSize: 10 } });
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(document.body.textContent).toContain('Đang hiển thị 1 - 10 trong 120 nhân viên');
    expect(screen.getByRole('button', { name: 'Trang 12' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() =>
      expect(
        new URLSearchParams((fetchMock.mock.calls.at(-1)?.[0] as string).split('?')[1]).get('page'),
      ).toBe('2'),
    );
  });
});

describe('TimesheetsScreen: tiêu đề, chọn dòng, số dòng mỗi trang', () => {
  it('có tiêu đề Bảng công, nhãn trạng thái tháng và gợi ý Ctrl K ở ô tìm', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getByRole('heading', { name: 'Bảng công' })).toBeTruthy();
    expect(screen.getByTestId('month-state')).toBeTruthy();
    expect(screen.getByText('Ctrl K')).toBeTruthy();
  });

  it('toàn màn hình: phủ kín khung, ẩn tiêu đề lớn, Esc hoặc nút Thu nhỏ để thoát', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    const root = screen.getByTestId('timesheets-root');
    expect(root.className).not.toContain('fixed');
    expect(screen.getByTestId('board-grid-frame').className).toContain('max-h-');
    fireEvent.click(screen.getByRole('button', { name: 'Xem toàn màn hình' }));
    expect(screen.getByTestId('timesheets-root').className).toContain('fixed inset-0');
    expect(screen.getByTestId('board-grid-frame').className).toContain('flex-1');
    expect(screen.getAllByRole('heading', { name: 'Bảng công' })).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('timesheets-root').className).not.toContain('fixed');
    fireEvent.click(screen.getByRole('button', { name: 'Xem toàn màn hình' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thoát toàn màn hình' }));
    expect(screen.getByTestId('timesheets-root').className).not.toContain('fixed');
  });

  it('chú thích thu gọn ở màn nhỏ: nút Chú thích mở và ẩn', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    const toggle = screen.getByRole('button', { name: 'Chú thích' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ẩn chú thích' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('tick nhân viên thì nút Xuất CSV ghi số người đã chọn; tick tất cả chọn cả trang', async () => {
    mockApi(makeBoard('OPEN', true));
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    expect(screen.getByRole('button', { name: /Xuất CSV$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nguyễn Văn An' }));
    expect(screen.getByRole('button', { name: /Xuất CSV \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nguyễn Văn An' }));
    expect(screen.getByRole('button', { name: /Xuất CSV$/ })).toBeTruthy();
    const rows = screen.getAllByTestId('board-row').length;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả nhân viên trong trang' }));
    expect(screen.getByRole('button', { name: `Xuất CSV (${rows})` })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả nhân viên trong trang' }));
    expect(screen.getByRole('button', { name: /Xuất CSV$/ })).toBeTruthy();
  });

  it('đổi số nhân viên mỗi trang gọi lại với page_size mới và về trang 1', async () => {
    mockApi({ ...makeBoard('OPEN', true), meta: { total: 120, page: 1, pageSize: 10 } });
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }));
    await waitFor(() =>
      expect(new URLSearchParams((fetchMock.mock.calls.at(-1)?.[0] as string).split('?')[1]).get('page')).toBe('2'),
    );
    fireEvent.click(within(screen.getByTitle('Số nhân viên mỗi trang')).getByRole('textbox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Hiển thị 20' }));
    await waitFor(() => {
      const q = new URLSearchParams((fetchMock.mock.calls.at(-1)?.[0] as string).split('?')[1]);
      expect(q.get('page_size')).toBe('20');
      expect(q.get('page')).toBe('1');
    });
  });
});

describe('TimesheetsScreen: liên kết đơn từ, chốt công có chi tiết, điều chỉnh công', () => {
  it('Tính công gọi API, báo kết quả và tải lại bảng', async () => {
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/timesheet-board')) return { data: makeBoard('OPEN', true) };
      if (path.endsWith('/calculate'))
        return { data: { ...closeState().data, result: { count: 62, abnormal: 3 } } };
      return { data: {} };
    }) as never);
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Tính công/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/timesheet-months/${month}/calculate`, expect.objectContaining({ method: 'POST' })),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Đã tính công 62 dòng, còn 3 dòng bất thường');
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/timesheet-board'))).toHaveLength(2),
    );
  });

  it('chốt công liệt kê từng ngày vướng và Mở ô công mở chi tiết ngày đó', async () => {
    mockApi(
      makeBoard('OPEN', true),
      closeState(
        [],
        [
          {
            code: 'ABNORMAL_DAYS',
            message: 'Còn 1 ngày công bất thường (1 nhân viên) cần xử lý',
            count: 1,
            items: [{ employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn An', date: d(3), codes: ['MISSING_CHECK_OUT'] }],
          },
        ],
      ),
    );
    render(<TimesheetsScreen />);
    await screen.findAllByTestId('board-day-header');
    fireEvent.click(screen.getByRole('button', { name: /Chốt công/ }));
    const list = await screen.findByTestId('blocker-items-ABNORMAL_DAYS');
    expect(list.textContent).toContain('NV001 - Nguyễn Văn An');
    expect(list.textContent).toContain('Thiếu chấm ra');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Mở ô công NV001 ngày`) }));
    expect(await screen.findByText('Chi tiết ngày công')).toBeTruthy();
  });

  it('chi tiết ngày liệt kê các đơn tác động, có link mở đơn ở màn Duyệt đơn', async () => {
    const board = makeBoard('OPEN', true);
    (board.employees[0].days as Record<string, HrmBoardDay>)[d(2)] = baseDay(d(2), {
      status: 'ANNUAL_LEAVE',
      sources: [
        { kind: 'LEAVE', id: 'leave-9', minutes: 240, label: 'Nghỉ phép năm' },
        { kind: 'OT', id: 'ot-3', minutes: 60, label: null },
      ],
    });
    mockApi(board);
    render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByTestId(`board-cell-e1-${d(2)}`));
    const sources = await screen.findByTestId('day-sources');
    expect(sources.textContent).toContain('Đơn nghỉ: Nghỉ phép năm - 4 giờ hưởng lương');
    expect(sources.textContent).toContain('Đơn làm thêm giờ: 1 giờ đã duyệt');
    expect(sources.textContent).toContain('Đã duyệt');
    const links = within(sources).getAllByRole('link');
    expect(links[0].getAttribute('href')).toBe('/approvals?type=leave&request=leave-9');
    expect(links[1].getAttribute('href')).toBe('/approvals?type=ot&request=ot-3');
  });

  it('điều chỉnh công chỉ hiện khi tháng đã tính công, chưa chốt và có quyền; gửi đúng căn cứ', async () => {
    const board = makeBoard('OPEN', true);
    (board.month as { calculatedAt: string | null }).calculatedAt = '2026-10-05T01:00:00Z';
    mockApi(board);
    render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByTestId(`board-cell-e1-${d(3)}`));
    fireEvent.click(await screen.findByRole('button', { name: 'Điều chỉnh công ngày này' }));
    const dialog = await screen.findByRole('dialog', { name: /Điều chỉnh công ngày/ }).catch(() => null);
    expect(dialog ?? screen.getByText(/Điều chỉnh công ngày/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Phút công hưởng lương/), { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText(/Căn cứ điều chỉnh/), { target: { value: 'Có đơn giấy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/timesheet-months/${month}/adjust`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ employeeId: 'e1', date: d(3), paidMinutes: 240, reason: 'Có đơn giấy' }),
        }),
      ),
    );
  });

  it('chưa tính công, đã chốt hoặc thiếu quyền: không có nút điều chỉnh công', async () => {
    mockApi(makeBoard('OPEN', true));
    const view = render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByTestId(`board-cell-e1-${d(3)}`));
    await screen.findByText('Chi tiết ngày công');
    expect(screen.queryByRole('button', { name: 'Điều chỉnh công ngày này' })).toBeNull();
    view.unmount();

    const locked = makeBoard('LOCKED', true);
    (locked.month as { calculatedAt: string | null }).calculatedAt = '2026-10-05T01:00:00Z';
    mockApi(locked);
    const view2 = render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByTestId(`board-cell-e1-${d(3)}`));
    await screen.findByText('Chi tiết ngày công');
    expect(screen.queryByRole('button', { name: 'Điều chỉnh công ngày này' })).toBeNull();
    view2.unmount();

    mockAllowed = ['hrm.timesheet.read'];
    const open = makeBoard('OPEN', true);
    (open.month as { calculatedAt: string | null }).calculatedAt = '2026-10-05T01:00:00Z';
    mockApi(open);
    render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByTestId(`board-cell-e1-${d(3)}`));
    await screen.findByText('Chi tiết ngày công');
    expect(screen.queryByRole('button', { name: 'Điều chỉnh công ngày này' })).toBeNull();
  });
});

describe('TimesheetsScreen: mọi đơn từ dính tới ngày hiển thị ở ô công', () => {
  it('ô công thuần số; drawer liệt kê cả đơn chờ duyệt và bị từ chối kèm trạng thái, link mở đơn', async () => {
    const board = makeBoard('OPEN', true);
    (board.employees[0].days as Record<string, HrmBoardDay>)[d(2)] = baseDay(d(2), {
      requests: [
        { kind: 'OT', id: 'ot-1', status: 'APPROVED', label: 'Theo công việc', minutes: 120 },
        { kind: 'LEAVE', id: 'l-1', status: 'PENDING', label: 'Nghỉ việc riêng', minutes: 240 },
        { kind: 'CORRECTION', id: 'c-1', status: 'REJECTED', label: null, minutes: null },
        { kind: 'CUSTOM', id: 'x-1', status: 'APPROVED', label: 'Xin đi muộn', minutes: null },
      ],
    });
    mockApi(board);
    render(<TimesheetsScreen />);
    const cell = await screen.findByTestId(`board-cell-e1-${d(2)}`);
    // Ô công thuần số: không còn ký hiệu chữ của đơn từ; đơn từ xem trong drawer ngày.
    expect(within(cell).queryByTestId('cell-has-requests')).toBeNull();
    fireEvent.click(cell);
    const list = await screen.findByTestId('day-sources');
    expect(list.textContent).toContain('Đơn làm thêm giờ: Theo công việc - 2 giờ đã duyệt');
    expect(list.textContent).toContain('Chờ duyệt');
    expect(list.textContent).toContain('Từ chối');
    expect(list.textContent).toContain('Xin đi muộn');
    const hrefs = within(list).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/approvals?type=ot&request=ot-1',
      '/approvals?type=leave&request=l-1',
      '/approvals?type=correction&request=c-1',
      '/approvals?type=custom&request=x-1',
    ]);
  });
});
