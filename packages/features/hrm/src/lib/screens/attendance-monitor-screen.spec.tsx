/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HrmAttendanceMonitor, HrmMonitorRow } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { downloadCsv } from '../hrm-csv';
import { todayVn } from '../attendance-monitor-model';
import AttendanceMonitorScreen from './attendance-monitor-screen';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
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

const row = (over: Partial<HrmMonitorRow>): HrmMonitorRow => ({
  employeeId: 'e',
  employeeCode: 'NV',
  employeeName: 'Tên',
  departmentName: 'Phòng Thí nghiệm',
  positionName: 'Nhân viên',
  status: 'COMPLETED',
  shiftCode: 'HC',
  shiftName: 'Ca hành chính',
  shiftStart: '07:30',
  shiftEnd: '17:00',
  checkIn: '07:25',
  checkOut: '17:05',
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  leaveName: null,
  leaveDays: 0,
  requests: [],
  ...over,
});

function payload(over: Partial<HrmAttendanceMonitor> = {}): { data: HrmAttendanceMonitor } {
  const rows = [
    row({ employeeId: 'a', employeeCode: 'NV001', employeeName: 'Bùi Công Quyền', status: 'NOT_CHECKED_IN', checkIn: null, checkOut: null }),
    row({ employeeId: 'b', employeeCode: 'NV002', employeeName: 'Bùi Duy Khánh', departmentName: 'Văn phòng Miền Nam', status: 'LATE', checkIn: '07:48', checkOut: null, lateMinutes: 18 }),
    row({ employeeId: 'c', employeeCode: 'NV003', employeeName: 'Cao Khánh Ngọc', status: 'EARLY_LEAVE', checkOut: '16:20', earlyLeaveMinutes: 40 }),
    row({ employeeId: 'd', employeeCode: 'NV004', employeeName: 'Nguyễn Hồng Sang', status: 'MISSING_PUNCH', checkOut: null }),
    row({ employeeId: 'e', employeeCode: 'NV005', employeeName: 'Hoàng Ngọc Linh', status: 'COMPLETED' }),
    row({
      employeeId: 'f',
      employeeCode: 'NV006',
      employeeName: 'Nguyễn Thị Lan',
      status: 'ON_LEAVE',
      checkIn: null,
      checkOut: null,
      leaveName: 'Nghỉ phép năm',
      leaveDays: 1,
      requests: [{ kind: 'LEAVE', id: 'r1', status: 'PENDING', label: 'Nghỉ phép năm', minutes: null }],
    }),
  ];
  return {
    data: {
      date: todayVn(),
      today: todayVn(),
      generatedAt: '2026-10-13T02:23:00.000Z',
      scope: 'ALL',
      summary: { totalPeople: 7, scheduled: 6, checkedIn: 4, notCheckedIn: 1, late: 1, earlyLeave: 1, onLeave: 1, onTrip: 0, missingPunch: 1 },
      rows,
      ...over,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockImplementation(async () => payload() as never);
});

describe('AttendanceMonitorScreen', () => {
  it('hiện thẻ tổng quan và danh sách cần theo dõi (không gồm người đã hoàn thành hoặc đang nghỉ)', async () => {
    render(<AttendanceMonitorScreen />);
    expect(await screen.findByText('Bùi Công Quyền')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/attendance-monitor?date=${todayVn()}`);
    expect(within(screen.getByTestId('kpi-scheduled')).getByText('6')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-scheduled')).queryByText('/ 7 nhân sự')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Danh sách cần theo dõi (4)' })).toBeTruthy();
    expect(screen.queryByText('Hoàng Ngọc Linh')).toBeNull();
    expect(screen.getByText('Đi trễ 18 phút')).toBeTruthy();
    expect(screen.getByText('Về sớm 40 phút')).toBeTruthy();
    expect(screen.getByText('Thiếu lượt chấm')).toBeTruthy();
    expect(screen.getByText(/Cập nhật lần cuối: \d{2}:\d{2}/)).toBeTruthy();
  });

  it('bấm thẻ tổng quan: ngăn kéo chỉ liệt kê nhân viên của thẻ, không có nút lọc danh sách', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Công Quyền');
    for (const [name, person] of [
      ['Đi trễ', 'Bùi Duy Khánh'],
      ['Về sớm', 'Cao Khánh Ngọc'],
      ['Chưa chấm công', 'Bùi Công Quyền'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Xem danh sách: ${name}`) }));
      const sheet = await screen.findByTestId('kpi-list-sheet');
      expect(within(sheet).getByText(`${name} (1)`)).toBeTruthy();
      expect(within(sheet).getByText(person)).toBeTruthy();
      expect(within(sheet).queryByRole('button', { name: /Lọc danh sách/ })).toBeNull();
      fireEvent.keyDown(sheet, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('kpi-list-sheet')).toBeNull());
    }
  });

  it('bấm một người trong ngăn kéo mở chi tiết (thẻ đang nghỉ phép)', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Công Quyền');
    fireEvent.click(screen.getByRole('button', { name: /Xem danh sách: Đang nghỉ phép/ }));
    const sheet = await screen.findByTestId('kpi-list-sheet');
    expect(within(sheet).queryByRole('button', { name: /Lọc danh sách cần theo dõi/ })).toBeNull();
    fireEvent.click(within(sheet).getByText('Nguyễn Thị Lan'));
    expect(await screen.findByText(/Đơn từ liên quan \(1\)/)).toBeTruthy();
  });

  it('đổi tab và tìm kiếm không dấu thu hẹp danh sách', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Công Quyền');
    fireEvent.click(screen.getByRole('tab', { name: /Đi trễ/ }));
    expect(screen.getByRole('heading', { name: 'Danh sách cần theo dõi (1)' })).toBeTruthy();
    expect(screen.queryByText('Bùi Công Quyền')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Tất cả/ }));
    fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'khanh' } });
    expect(screen.getByRole('heading', { name: 'Danh sách cần theo dõi (2)' })).toBeTruthy();
  });

  it('hiện đơn từ liên quan và tình hình theo phòng ban', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Công Quyền');
    const requests = screen.getByRole('region', { name: 'Đơn từ liên quan' });
    expect(within(requests).getByText('Nguyễn Thị Lan')).toBeTruthy();
    expect(within(requests).getByText('Chờ duyệt')).toBeTruthy();
    const departments = screen.getByRole('region', { name: 'Tình hình theo phòng ban' });
    expect(within(departments).getByText('Phòng Thí nghiệm')).toBeTruthy();
    expect(within(departments).getByText('Văn phòng Miền Nam')).toBeTruthy();
  });

  it('mở chi tiết nhân viên trong ngăn kéo', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Duy Khánh');
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết Bùi Duy Khánh' }));
    expect(await screen.findByText('18 phút')).toBeTruthy();
    expect(screen.getByText(/Đơn từ liên quan \(0\)/)).toBeTruthy();
  });

  it('xuất Excel đúng các dòng đang lọc', async () => {
    render(<AttendanceMonitorScreen />);
    await screen.findByText('Bùi Công Quyền');
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel/ }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [name, csv] = (downloadCsv as jest.Mock).mock.calls[0] as [string, string];
    expect(name).toBe(`giam-sat-cham-cong-${todayVn()}.csv`);
    expect(csv).toContain('Bùi Công Quyền');
    expect(csv).not.toContain('Hoàng Ngọc Linh');
  });

  it('báo lỗi khi không có quyền hoặc tải thất bại; không treo ở trạng thái đang tải', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Bạn không có quyền xem giám sát chấm công'));
    render(<AttendanceMonitorScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain('Bạn không có quyền xem giám sát chấm công');
    await waitFor(() => expect(screen.queryByText('Đang tải dữ liệu...')).toBeNull());
  });

  it('người quản lý (phạm vi cấp dưới): mô tả và trạng thái rỗng nói rõ phạm vi', async () => {
    fetchMock.mockImplementation(
      async () =>
        payload({
          scope: 'TEAM',
          rows: [],
          summary: { totalPeople: 0, scheduled: 0, checkedIn: 0, notCheckedIn: 0, late: 0, earlyLeave: 0, onLeave: 0, onTrip: 0, missingPunch: 0 },
        }) as never,
    );
    render(<AttendanceMonitorScreen />);
    expect(await screen.findByText('Không có nhân viên trong phạm vi giám sát của bạn.')).toBeTruthy();
    expect(screen.getByText(/nhân viên cấp dưới/)).toBeTruthy();
  });
});
