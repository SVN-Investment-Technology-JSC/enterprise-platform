import {
  addMinutesToTime,
  computeShiftStandardHours,
  normalizeShiftTime,
  shiftStatusLabel,
} from './hrm-shift-metrics';

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

describe('shiftStatusLabel', () => {
  it('đổi nhãn tiếng Việt', () => {
    expect(shiftStatusLabel('ACTIVE')).toBe('Đang dùng');
    expect(shiftStatusLabel('INACTIVE')).toBe('Tạm dừng');
  });
});

describe('addMinutesToTime', () => {
  it('tính giờ kết thúc nghỉ từ giờ bắt đầu nghỉ', () => {
    expect(addMinutesToTime('12:00', 60)).toBe('13:00');
    expect(addMinutesToTime('12:30', 90)).toBe('14:00');
    expect(addMinutesToTime('23:30', 60)).toBe('00:30');
    expect(addMinutesToTime('12:00:00', 45)).toBe('12:45');
  });
  it('giờ không hợp lệ được giữ nguyên', () => {
    expect(addMinutesToTime('', 30)).toBe('');
    expect(addMinutesToTime('abc', 30)).toBe('abc');
  });
});

describe('normalizeShiftTime', () => {
  it('cắt giây và xử lý giá trị rỗng', () => {
    expect(normalizeShiftTime('08:00:00')).toBe('08:00');
    expect(normalizeShiftTime(null)).toBe('');
    expect(normalizeShiftTime(undefined)).toBe('');
  });
});
