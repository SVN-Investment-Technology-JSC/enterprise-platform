/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { downloadXlsx } from '../hrm-xlsx';
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
jest.mock('../hrm-xlsx', () => {
  const actual = jest.requireActual('../hrm-xlsx');
  return { ...actual, downloadXlsx: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const downloadMock = downloadXlsx as jest.MockedFunction<typeof downloadXlsx>;
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
const person = {
  employeeId: 'e1',
  employeeName: 'Nguyễn Văn An',
  departmentName: 'Sản xuất',
  days: 1,
  workedMinutes: 480,
  scheduledMinutes: 480,
  lateDays: 1,
  lateMinutes: 5,
  earlyMinutes: 0,
  abnormalDays: 0,
};
const events = [
  {
    id: 'ev2',
    work_date: range.from,
    occurred_at: `${range.from}T10:00:00Z`,
    event_kind: 'OUT',
    source: 'WEB',
    evidence: {},
    voided_by_correction_id: 'c1',
  },
  {
    id: 'ev1',
    work_date: range.from,
    occurred_at: `${range.from}T01:05:00Z`,
    event_kind: 'IN',
    source: 'WEB',
    evidence: { ip: '10.1.1.9', siteSnapshot: { name: 'Trụ sở chính' }, latitude: 10.5, longitude: 106.7 },
    voided_by_correction_id: null,
  },
];

let total = 1;
function route() {
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/attendance-data?')) {
      // Chế độ gom theo nhân viên cho bảng; các ngày công của một người tải riêng khi mở drawer.
      if (queryOf(path).get('group') === 'employee') return { data: [person], meta: { total, page: 1, pageSize: 50 } };
      return { data: [attendanceRow], meta: { total: 1, page: 1, pageSize: 200 } };
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
    expect(first.get('group')).toBe('employee');
    expect(screen.queryByText('NV001')).toBeNull();
    expect(screen.getByText('Hiển thị 1-1 / 1 nhân viên')).toBeTruthy();
  });

  it('forwards q and status filters to the API', async () => {
    render(<AttendanceDataScreen />);
    await screen.findByText('Hiển thị 1-1 / 1 nhân viên');
    expect(fetchMock.mock.calls.some((c) => queryOf(c[0] as string).get('employee_id'))).toBe(false);
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

  it('opens a drawer per person and shows raw events of a day only when that day is clicked', async () => {
    render(<AttendanceDataScreen />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await screen.findByText('Nguyễn Văn An', { exact: false }));
    const dialog = await screen.findByRole('dialog');
    // Chỉ khi mở drawer mới tải các ngày công của người đó (mới nhất trước), chưa tải lượt quẹt.
    const daysPath = fetchMock.mock.calls
      .map((c) => c[0] as string)
      .find((path) => path.startsWith('/attendance-data?') && queryOf(path).get('employee_id')) as string;
    expect(queryOf(daysPath).get('employee_id')).toBe('e1');
    expect(queryOf(daysPath).get('page_size')).toBe('200');
    expect(queryOf(daysPath).get('group')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/attendance-events?'))).toBe(false);
    fireEvent.click(await within(dialog).findByLabelText(/Xem lượt quẹt ngày/));
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
    expect(within(items[1]).getByText('đã hủy bởi giải trình')).toBeTruthy();
  });

  it('exports the whole filtered result set as Excel', async () => {
    render(<AttendanceDataScreen />);
    await screen.findByText('Nguyễn Văn An', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel kết quả đã lọc/ }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const rows = downloadMock.mock.calls[0][1];
    // Mỗi giá trị một ô: dòng đầu là tiêu đề, các dòng sau là từng bản ghi.
    expect(rows[0]).toContain('Mã nhân viên');
    expect(rows[0]).toContain('Phút đi muộn');
    expect(rows.slice(1).map((r: readonly unknown[]) => r[0])).toContain('NV001');
    const exportCall = fetchMock.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith('/attendance-data?')).pop() as string;
    expect(queryOf(exportCall).get('page_size')).toBe('200');
  });
});
