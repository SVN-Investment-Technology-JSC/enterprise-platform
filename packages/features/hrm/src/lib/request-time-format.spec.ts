import {
  formatDateTimeVn,
  formatDateVn,
  formatHours,
  formatRequestDuration,
  formatRequestPeriod,
} from './request-time-format';

describe('định dạng thời gian đơn từ', () => {
  it('ngày giờ theo múi giờ Việt Nam, qua nửa đêm UTC vẫn đúng ngày', () => {
    expect(formatDateTimeVn('2026-11-02T02:00:00.000Z')).toBe('02/11/2026 09:00');
    expect(formatDateTimeVn('2026-10-12T17:00:00.000Z')).toBe('13/10/2026 00:00');
    expect(formatDateTimeVn('2026-10-12T16:59:00.000Z')).toBe('12/10/2026 23:59');
    expect(formatDateTimeVn(null)).toBe('');
    expect(formatDateTimeVn('không phải ngày')).toBe('');
  });

  it('ngày dd/MM/yyyy từ YYYY-MM-DD, giữ nguyên chuỗi lạ', () => {
    expect(formatDateVn('2026-10-12')).toBe('12/10/2026');
    expect(formatDateVn('2026-10-12T00:00:00.000Z')).toBe('12/10/2026');
    expect(formatDateVn('abc')).toBe('abc');
    expect(formatDateVn(undefined)).toBe('');
  });

  it('số giờ gọn', () => {
    expect(formatHours(120)).toBe('2');
    expect(formatHours(150)).toBe('2,5');
    expect(formatHours(45)).toBe('0,75');
  });

  it('đơn có mốc giờ: từ ngày giờ đến ngày giờ', () => {
    expect(
      formatRequestPeriod({ fromAt: '2026-11-02T02:00:00.000Z', toAt: '2026-11-02T04:30:00.000Z' }),
    ).toBe('02/11/2026 09:00 -> 02/11/2026 11:30');
  });

  it('đơn làm thêm giờ cũ: ngày làm và giờ', () => {
    expect(formatRequestPeriod({ workDate: '2026-10-12', startTime: '18:00:00', endTime: '20:00:00' })).toBe(
      '12/10/2026 (18:00 - 20:00)',
    );
  });

  it('đơn cũ theo ngày: khoảng ngày hoặc một ngày; đơn không có thời gian: rỗng', () => {
    expect(formatRequestPeriod({ fromDate: '2026-10-12', toDate: '2026-10-14' })).toBe('12/10/2026 - 14/10/2026');
    expect(formatRequestPeriod({ fromDate: '2026-10-12', toDate: '2026-10-12' })).toBe('12/10/2026');
    expect(formatRequestPeriod({ requestDate: '2026-10-12' })).toBe('12/10/2026');
    expect(
      formatRequestPeriod({ requestDate: '2026-10-12', newCheckInAt: '08:30:00', newCheckOutAt: '17:30:00' }),
    ).toBe('12/10/2026 (08:30 - 17:30)');
    expect(
      formatRequestPeriod({ requestDate: '2026-10-12', newCheckInAt: '08:30:00' }),
    ).toBe('12/10/2026 (Vào: 08:30)');
    expect(formatRequestPeriod({})).toBe('');
  });

  it('thời lượng: ưu tiên durationMinutes, rồi plannedMinutes', () => {
    expect(formatRequestDuration({ durationMinutes: 150 })).toBe('2,5 giờ');
    expect(formatRequestDuration({ plannedMinutes: 60 })).toBe('1 giờ');
    expect(formatRequestDuration({ durationMinutes: null })).toBe('');
  });
});
