/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { currentMonthVn, monthRange, shiftMonth } from '../hrm-timesheet-format';
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
const month = currentMonthVn();
const { from } = monthRange(month);

const day = (over: Record<string, unknown>) => ({
  workDate: from,
  status: 'NORMAL',
  shiftCode: 'HC',
  shiftName: 'Hành chính',
  scheduledMinutes: 480,
  workedMinutes: 450,
  paidMinutes: 480,
  otMinutes: 0,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  workdayUnits: 1,
  adjusted: false,
  periodCode: 'BC-01',
  periodStatus: 'LOCKED',
  ...over,
});

const payload = {
  data: [
    day({}),
    day({ workDate: `${month}-02`, status: 'LEAVE', workedMinutes: 0, periodStatus: 'OPEN', periodCode: 'BC-02' }),
    day({ workDate: `${month}-03`, status: 'MOI_LA', shiftCode: null, shiftName: null, workdayUnits: 0, periodStatus: 'OPEN', periodCode: null }),
  ],
  meta: {
    total: 3,
    summary: { workdayUnits: 2, paidMinutes: 960, otMinutes: 90, lateMinutes: 15, earlyLeaveMinutes: 5 },
  },
};

beforeEach(() => fetchMock.mockReset());

describe('MyTimesheetScreen', () => {
  it('renders summary cards and day rows with period badges', async () => {
    fetchMock.mockResolvedValue(payload as never);
    render(<MyTimesheetScreen />);

    const rows = await screen.findAllByTestId('my-timesheet-row');
    expect(rows).toHaveLength(3);
    const [y, m] = month.split('-');
    expect(within(rows[0]).getByText(`01/${m}/${y}`)).toBeTruthy();
    expect(within(rows[0]).getByText('Đi làm')).toBeTruthy();
    expect(within(rows[0]).getByText('HC')).toBeTruthy();
    expect(within(rows[0]).getByText('Đã chốt')).toBeTruthy();
    expect(within(rows[0]).getByText('BC-01')).toBeTruthy();
    expect(within(rows[1]).getByText('Nghỉ phép')).toBeTruthy();
    expect(within(rows[1]).getByText('Tạm tính')).toBeTruthy();
    // trạng thái lạ có nhãn dự phòng, không hiển thị mã thô
    expect(within(rows[2]).getByText('Khác')).toBeTruthy();
    expect(within(rows[2]).queryByText('MOI_LA')).toBeNull();

    // tổng hợp lấy từ meta.summary: 960 phút = 16:00, OT 1:30
    expect(screen.getByText('16:00')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(screen.getByText('0:15')).toBeTruthy();
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText(/số liệu đang là tạm tính/)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const path = fetchMock.mock.calls[0][0] as string;
    expect(path.startsWith('/my-timesheet?')).toBe(true);
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('from')).toBe(from);
    expect(query.get('to')).toBe(monthRange(month).to);
  });

  it('loads the previous month when pressing the previous button', async () => {
    fetchMock.mockResolvedValue({ data: [], meta: { total: 0 } } as never);
    render(<MyTimesheetScreen />);
    expect(await screen.findByText(/Chưa có dữ liệu bảng công/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng trước' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const query = new URLSearchParams((fetchMock.mock.calls[1][0] as string).split('?')[1]);
    expect(query.get('from')).toBe(monthRange(shiftMonth(month, -1)).from);
  });

  it('shows an error state with a retry button', async () => {
    fetchMock.mockRejectedValueOnce(new HrmApiError('Không có quyền xem bảng công', 403, 'FORBIDDEN', {}));
    render(<MyTimesheetScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không có quyền xem bảng công');
    fetchMock.mockResolvedValueOnce(payload as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(await screen.findAllByTestId('my-timesheet-row')).toHaveLength(3);
  });
});
