import {
  currentMonthVn,
  formatDateVn,
  formatMinutes,
  formatTimeVn,
  inclusiveDays,
  isMonthKey,
  monthRange,
  shiftMonth,
  timesheetPeriodBadge,
  timesheetStatusLabel,
  timesheetStatusTone,
  weekdayVn,
} from './hrm-timesheet-format';

describe('hrm-timesheet-format', () => {
  it('builds month ranges including leap February and 31-day months', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(monthRange('2027-02').to).toBe('2027-02-28');
    expect(() => monthRange('2026-13')).toThrow();
    expect(isMonthKey('2026-00')).toBe(false);
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-05', 0)).toBe('2026-05');
    expect(shiftMonth('2026-03', -15)).toBe('2024-12');
  });

  it('reports the Vietnam current month near the UTC date boundary', () => {
    // 2026-09-30T20:00Z là 03:00 ngày 01/10 giờ Việt Nam
    expect(currentMonthVn(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10');
  });

  it('formats minutes as h:mm and tolerates missing values', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(450)).toBe('7:30');
    expect(formatMinutes(65)).toBe('1:05');
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(undefined)).toBe('—');
    expect(formatMinutes(Number.NaN)).toBe('—');
    expect(formatMinutes(-5)).toBe('0:00');
  });

  it('formats dates and weekdays in Vietnamese', () => {
    expect(formatDateVn('2026-10-09')).toBe('09/10/2026');
    expect(formatDateVn(null)).toBe('—');
    expect(weekdayVn('2026-10-05')).toBe('T2');
    expect(weekdayVn('2026-10-10')).toBe('T7');
    expect(weekdayVn('2026-10-11')).toBe('CN');
  });

  it('formats time in the Vietnam timezone and never invents one', () => {
    expect(formatTimeVn('2026-10-09T01:05:00Z')).toBe('08:05');
    expect(formatTimeVn('2026-10-09T17:00:00Z')).toBe('00:00');
    expect(formatTimeVn(null)).toBe('—');
    expect(formatTimeVn('khong-hop-le')).toBe('—');
  });

  it('counts inclusive days', () => {
    expect(inclusiveDays('2026-10-01', '2026-10-01')).toBe(1);
    expect(inclusiveDays('2026-01-01', '2026-04-03')).toBe(93);
    expect(inclusiveDays('2026-10-02', '2026-10-01')).toBe(0);
  });

  it('labels every known status and falls back safely', () => {
    expect(timesheetStatusLabel('NORMAL')).toBe('Đi làm');
    expect(timesheetStatusLabel('LEAVE')).toBe('Nghỉ phép');
    expect(timesheetStatusLabel('HOLIDAY')).toBe('Nghỉ lễ');
    expect(timesheetStatusLabel('ABSENT')).toBe('Vắng mặt');
    expect(timesheetStatusLabel('ADJUSTED')).toBe('Đã điều chỉnh');
    expect(timesheetStatusLabel('OFF')).toBe('Ngày nghỉ');
    expect(timesheetStatusLabel('BUSINESS_TRIP')).toBe('Công tác');
    expect(timesheetStatusLabel('ABNORMAL')).toBe('Bất thường');
    expect(timesheetStatusLabel('SOMETHING_NEW')).toBe('Khác');
    expect(timesheetStatusLabel(null)).toBe('Chưa xác định');
    expect(timesheetStatusTone('SOMETHING_NEW')).toBe('muted');
    expect(timesheetStatusTone('ABSENT')).toBe('bad');
  });

  it('marks only LOCKED periods as final', () => {
    expect(timesheetPeriodBadge('LOCKED', 'BC-2026-09')).toEqual({
      label: 'Đã chốt',
      locked: true,
      code: 'BC-2026-09',
    });
    expect(timesheetPeriodBadge('OPEN', null)).toEqual({
      label: 'Tạm tính',
      locked: false,
      code: '',
    });
    expect(timesheetPeriodBadge(null, null).label).toBe('Tạm tính');
  });
});
