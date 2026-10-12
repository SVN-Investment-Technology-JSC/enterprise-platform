/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { downloadCsv } from '../hrm-csv';
import { currentMonthVn, monthRange } from '../hrm-timesheet-format';
import AttendanceDataScreen from './attendance-data-screen';

jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: ['hrm.attendance.read'],
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
jest.mock('../hrm-csv', () => {
  const actual = jest.requireActual('../hrm-csv');
  return { ...actual, downloadCsv: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const downloadMock = downloadCsv as jest.MockedFunction<typeof downloadCsv>;
const range = monthRange(currentMonthVn());

const attendanceRow = {
  id: 'a1',
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn Văn An',
  departmentName: 'Sản xuất',
  workDate: range.from,
  checkInAt: `${range.from}T01:05:00Z`,
  checkOutAt: `${range.from}T10:00:00Z`,
  workedMinutes: 480,
  scheduledMinutes: 480,
  lateMinutes: 5,
  earlyMinutes: 0,
  status: 'LATE',
  source: 'WEB',
};
const events = [
  {
    id: 'ev2',
    work_date: range.from,
    occurred_at: `${range.from}T10:00:00Z`,
    event_kind: 'OUT',
    source: 'WEB',
    device_id: null,
    evidence: {},
    voided_by_correction_id: 'c1',
  },
  {
    id: 'ev1',
    work_date: range.from,
    occurred_at: `${range.from}T01:05:00Z`,
    event_kind: 'IN',
    source: 'WEB',
    device_id: 'dev-77',
    evidence: { ip: '10.1.1.9', siteSnapshot: { name: 'Trụ sở chính' }, latitude: 10.5, longitude: 106.7 },
    voided_by_correction_id: null,
  },
];

let total = 1;
function route() {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/attendance-data?')) {
      return { data: [attendanceRow], meta: { total, page: 1, pageSize: 50 } };
    }
    if (path.startsWith('/attendance-events?')) return { data: events, meta: { total: 2 } };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
}

const queryOf = (path: string) => new URLSearchParams(path.split('?')[1]);
const lastDataCall = () =>
  [...fetchMock.mock.calls].reverse().map((c) => c[0] as string).find((p) => p.startsWith('/attendance-data?')) as string;

beforeEach(() => {
  fetchMock.mockReset();
  downloadMock.mockReset();
  total = 1;
  route();
});

describe('AttendanceDataScreen', () => {
  it('loads the current month and renders rows with real values only', async () => {
    render(<AttendanceDataScreen />);
    const cell = await screen.findByText('Nguyễn Văn An', { exact: false });
    expect(cell).toBeTruthy();
    const first = queryOf(fetchMock.mock.calls[0][0] as string);
    expect(first.get('from')).toBe(range.from);
    expect(first.get('to')).toBe(range.to);
    expect(first.get('page')).toBe('1');
    expect(first.get('page_size')).toBe('50');
    expect(screen.getByText('Đi muộn')).toBeTruthy();
    expect(screen.getByText('08:05')).toBeTruthy();
    expect(screen.getByText('Hiển thị 1-1 / 1')).toBeTruthy();
  });

  it('forwards q and status filters and resets to page 1', async () => {
    total = 120;
    render(<AttendanceDataScreen />);
    await screen.findByText('Hiển thị 1-1 / 120');
    fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(queryOf(lastDataCall()).get('page')).toBe('2'));

    fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'an' } });
    fireEvent.click(screen.getByPlaceholderText('Tất cả trạng thái'));
    fireEvent.click(await screen.findByRole('option', { name: 'Thiếu quẹt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));

    await waitFor(() => {
      const q = queryOf(lastDataCall());
      expect(q.get('q')).toBe('an');
      expect(q.get('status')).toBe('MISSING_PUNCH');
      expect(q.get('page')).toBe('1');
    });
  });

  it('blocks ranges longer than 93 days and does not call the API', async () => {
    render(<AttendanceDataScreen />);
    await screen.findByText('Nguyễn Văn An', { exact: false });
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/01/2026' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '30/06/2026' } });
    expect((await screen.findByRole('alert')).textContent).toContain('tối đa 93 ngày');
    const filterButton = screen.getByRole('button', { name: 'Lọc' }) as HTMLButtonElement;
    expect(filterButton.disabled).toBe(true);
    fireEvent.click(filterButton);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('opens a drawer with raw events of that day when a row is clicked', async () => {
    render(<AttendanceDataScreen />);
    fireEvent.click(await screen.findByText('Nguyễn Văn An', { exact: false }));
    const dialog = await screen.findByRole('dialog');
    const items = await within(dialog).findAllByTestId('attendance-event');
    expect(items).toHaveLength(2);
    const eventsPath = fetchMock.mock.calls.map((c) => c[0] as string).find((p) => p.startsWith('/attendance-events?')) as string;
    const q = queryOf(eventsPath);
    expect(q.get('employee_id')).toBe('e1');
    expect(q.get('from')).toBe(range.from);
    expect(q.get('to')).toBe(range.from);
    // sắp xếp theo thời gian tăng dần: lượt vào trước
    expect(within(items[0]).getByText('Vào')).toBeTruthy();
    expect(within(items[0]).getByText('10.1.1.9')).toBeTruthy();
    expect(within(items[0]).getByText('Trụ sở chính')).toBeTruthy();
    expect(within(items[0]).getByText('10.5, 106.7')).toBeTruthy();
    expect(within(items[0]).getByText('dev-77')).toBeTruthy();
    expect(within(items[1]).getByText('đã hủy bởi giải trình')).toBeTruthy();
  });

  it('exports the whole filtered result set as CSV', async () => {
    render(<AttendanceDataScreen />);
    await screen.findByText('Nguyễn Văn An', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /Xuất CSV kết quả đã lọc/ }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const csv = downloadMock.mock.calls[0][1];
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('NV001');
    expect(csv).toContain('Đi muộn');
    const exportCall = fetchMock.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith('/attendance-data?')).pop() as string;
    expect(queryOf(exportCall).get('page_size')).toBe('200');
  });
});
