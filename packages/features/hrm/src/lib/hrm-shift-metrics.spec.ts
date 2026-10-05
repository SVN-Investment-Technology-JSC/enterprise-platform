import { computeShiftCoverage, computeShiftStandardHours, shiftStatusLabel } from './hrm-shift-metrics';

describe('computeShiftStandardHours', () => {
  it('ca hành chính 08:00-17:30 nghỉ 90 phút = 8 giờ', () => {
    expect(computeShiftStandardHours({ startTime: '08:00:00', endTime: '17:30', breakMinutes: 90 })).toBe(8);
  });
  it('ca qua đêm cộng 24 giờ', () => {
    expect(computeShiftStandardHours({ startTime: '22:00', endTime: '06:00', breakMinutes: 0, crossMidnight: true })).toBe(8);
  });
  it('làm tròn 2 chữ số', () => {
    expect(computeShiftStandardHours({ startTime: '08:00', endTime: '12:20', breakMinutes: 0 })).toBe(4.33);
  });
  it('thiếu giờ trả về null', () => {
    expect(computeShiftStandardHours({ startTime: null, endTime: '12:00' })).toBeNull();
  });
});

describe('computeShiftCoverage', () => {
  const today = '2026-10-05';
  it('đếm distinct nhân viên và không vượt 100%', () => {
    const assignments = [
      ...Array.from({ length: 5 }, (_, i) => ({ employeeId: 'e1', status: 'ACTIVE', effectiveFrom: `2026-0${i + 1}-01` })),
      { employeeId: 'e2', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    expect(computeShiftCoverage(assignments, ['e1', 'e2', 'e3'], today)).toEqual({
      assignedEmployees: 2,
      totalEmployees: 3,
      coveragePercent: 67,
    });
  });
  it('bỏ qua phân ca hết hạn, chưa hiệu lực, không ACTIVE, nhân viên ngoài danh sách', () => {
    const r = computeShiftCoverage(
      [
        { employeeId: 'e1', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: '2026-09-30' },
        { employeeId: 'e2', status: 'ACTIVE', effectiveFrom: '2026-11-01' },
        { employeeId: 'e3', status: 'SUPERSEDED', effectiveFrom: '2026-01-01' },
        { employeeId: 'x', status: 'ACTIVE', effectiveFrom: '2026-01-01' },
      ],
      ['e1', 'e2', 'e3'],
      today,
    );
    expect(r.assignedEmployees).toBe(0);
    expect(r.coveragePercent).toBe(0);
  });
  it('không có nhân viên thì độ phủ 0', () => {
    expect(computeShiftCoverage([], [], today).coveragePercent).toBe(0);
  });
});

describe('shiftStatusLabel', () => {
  it('đổi nhãn tiếng Việt', () => {
    expect(shiftStatusLabel('ACTIVE')).toBe('Đang dùng');
    expect(shiftStatusLabel('INACTIVE')).toBe('Tạm dừng');
  });
});
