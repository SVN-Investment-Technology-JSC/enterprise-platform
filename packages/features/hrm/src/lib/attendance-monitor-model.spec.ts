import type { HrmMonitorRow } from '@enterprise-platform/contracts-hrm';
import {
  EMPTY_FILTER,
  actualText,
  departmentStats,
  filterAttention,
  foldVi,
  longDateVn,
  monitorCsvRows,
  percentText,
  relatedRequests,
  shiftOptions,
  shiftTimeText,
  statusText,
  tabCounts,
} from './attendance-monitor-model';

const row = (over: Partial<HrmMonitorRow>): HrmMonitorRow => ({
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Bùi Công Quyền',
  departmentName: 'Phòng Thí nghiệm',
  positionName: 'Nhân viên',
  status: 'NOT_CHECKED_IN',
  shiftCode: 'HC',
  shiftName: 'Ca hành chính',
  shiftStart: '07:30',
  shiftEnd: '17:00',
  checkIn: null,
  checkOut: null,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  leaveName: null,
  leaveDays: 0,
  requests: [],
  ...over,
});

const rows: HrmMonitorRow[] = [
  row({ employeeId: 'a', employeeName: 'Bùi Công Quyền', status: 'NOT_CHECKED_IN' }),
  row({ employeeId: 'b', employeeName: 'Bùi Duy Khánh', departmentName: 'Văn phòng Miền Nam', status: 'LATE', checkIn: '07:48', lateMinutes: 18 }),
  row({ employeeId: 'c', employeeName: 'Cao Khánh Ngọc', status: 'EARLY_LEAVE', checkIn: '07:25', checkOut: '16:20', earlyLeaveMinutes: 40, shiftCode: 'SANG', shiftName: 'Ca sáng' }),
  row({ employeeId: 'd', employeeName: 'Nguyễn Hồng Sang', status: 'MISSING_PUNCH', checkIn: '07:30' }),
  row({ employeeId: 'e', employeeName: 'Đào Thị Lan', status: 'COMPLETED', checkIn: '07:25', checkOut: '17:05' }),
  row({ employeeId: 'f', employeeName: 'Phạm Văn Nghỉ', status: 'ON_LEAVE', leaveName: 'Nghỉ phép năm', leaveDays: 1, shiftCode: null, shiftName: null, shiftStart: null, shiftEnd: null }),
  row({ employeeId: 'g', employeeName: 'Lê Ngày Nghỉ', status: 'DAY_OFF', departmentName: null }),
];

describe('danh sách cần theo dõi', () => {
  it('chỉ giữ các trạng thái cần chú ý; hoàn thành, nghỉ phép, ngày nghỉ không có trong danh sách', () => {
    expect(filterAttention(rows, EMPTY_FILTER).map((r) => r.employeeId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lọc theo tab, phòng ban, ca, trạng thái và từ khoá không dấu', () => {
    expect(filterAttention(rows, { ...EMPTY_FILTER, tab: 'LATE' }).map((r) => r.employeeId)).toEqual(['b']);
    expect(filterAttention(rows, { ...EMPTY_FILTER, department: 'Văn phòng Miền Nam' }).map((r) => r.employeeId)).toEqual(['b']);
    expect(filterAttention(rows, { ...EMPTY_FILTER, shift: 'SANG' }).map((r) => r.employeeId)).toEqual(['c']);
    expect(filterAttention(rows, { ...EMPTY_FILTER, status: 'MISSING_PUNCH' }).map((r) => r.employeeId)).toEqual(['d']);
    expect(filterAttention(rows, { ...EMPTY_FILTER, search: 'khanh' }).map((r) => r.employeeId)).toEqual(['b', 'c']);
    expect(filterAttention(rows, { ...EMPTY_FILTER, search: 'nv001' })).toHaveLength(4);
  });

  it('số nhân viên từng tab theo bộ lọc chung; đi trễ và về sớm đếm cả người vừa trễ vừa sớm', () => {
    const both = [...rows, row({ employeeId: 'h', status: 'LATE_EARLY', checkIn: '07:50', checkOut: '16:00', lateMinutes: 20, earlyLeaveMinutes: 60 })];
    expect(tabCounts(both, EMPTY_FILTER)).toEqual({
      ALL: 5,
      NOT_CHECKED_IN: 1,
      LATE: 2,
      EARLY_LEAVE: 2,
      MISSING_PUNCH: 1,
    });
    expect(tabCounts(both, { ...EMPTY_FILTER, department: 'Văn phòng Miền Nam' }).ALL).toBe(1);
  });
});

describe('hiển thị', () => {
  it('chữ hiển thị trạng thái, giờ dự kiến và ghi nhận thực tế', () => {
    expect(statusText(rows[1])).toBe('Đi trễ 18 phút');
    expect(statusText(rows[2])).toBe('Về sớm 40 phút');
    expect(statusText(rows[0])).toBe('Chưa vào ca');
    expect(shiftTimeText(rows[0])).toBe('07:30 – 17:00');
    expect(shiftTimeText(rows[5])).toBe('----');
    expect(actualText(rows[0])).toBe('Chưa chấm');
    expect(actualText(rows[1])).toBe('07:48');
    expect(actualText(rows[2])).toBe('07:25 – 16:20');
    expect(actualText(rows[3])).toBe('07:30 (chưa có lượt ra)');
  });

  it('bỏ dấu tiếng Việt khi tìm kiếm', () => {
    expect(foldVi('Đào Thị Lan')).toBe('dao thi lan');
    expect(percentText(42, 56)).toBe('75,0%');
    expect(percentText(0, 0)).toBe('0,0%');
    expect(longDateVn('2026-10-13')).toBe('Thứ Ba, 13/10/2026');
  });

  it('ca làm việc và phòng ban lấy từ dữ liệu', () => {
    expect(shiftOptions(rows)).toEqual([
      { value: 'HC', label: 'Ca hành chính' },
      { value: 'SANG', label: 'Ca sáng' },
    ]);
  });
});

describe('thống kê phòng ban và đơn liên quan', () => {
  it('tính đã vào ca trên số người có ca; không tính ngày nghỉ/chưa có lịch', () => {
    const stats = departmentStats(rows);
    expect(stats.find((s) => s.name === 'Phòng Thí nghiệm')).toEqual({ name: 'Phòng Thí nghiệm', checkedIn: 3, total: 5, rate: 60 });
    expect(stats.find((s) => s.name === 'Văn phòng Miền Nam')).toMatchObject({ checkedIn: 1, total: 1, rate: 100 });
    expect(stats.some((s) => s.name === 'Chưa có phòng ban')).toBe(false);
  });

  it('đơn liên quan bỏ đơn từ chối, đơn chờ duyệt lên trước', () => {
    const withRequests = [
      row({ employeeId: 'x', employeeName: 'An', requests: [{ kind: 'LEAVE', id: '1', status: 'APPROVED', label: null, minutes: null }] }),
      row({ employeeId: 'y', employeeName: 'Bình', requests: [
        { kind: 'OT', id: '2', status: 'PENDING', label: null, minutes: 60 },
        { kind: 'TRIP', id: '3', status: 'REJECTED', label: null, minutes: null },
      ] }),
    ];
    expect(relatedRequests(withRequests).map((r) => [r.employeeName, r.label, r.status])).toEqual([
      ['Bình', 'Làm thêm giờ', 'PENDING'],
      ['An', 'Nghỉ phép', 'APPROVED'],
    ]);
  });

  it('xuất Excel có tiêu đề và đúng các dòng đang lọc, không lộ mã nội bộ', () => {
    const csv = monitorCsvRows([rows[1]]);
    expect(csv[0]).toContain('Trạng thái');
    expect(csv[1]).toEqual(['NV001', 'Bùi Duy Khánh', 'Văn phòng Miền Nam', 'Nhân viên', 'Ca hành chính', '07:30 – 17:00', '07:48', '', 'Đi trễ 18 phút']);
  });
});
