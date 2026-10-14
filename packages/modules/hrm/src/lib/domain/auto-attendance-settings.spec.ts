import { appliesOnDate, parseAutoAttendanceInput, weekdayOfDate } from './auto-attendance-settings';

describe('parseAutoAttendanceInput', () => {
  it('chuẩn hóa thứ: bỏ trùng và sắp tăng dần', () => {
    expect(parseAutoAttendanceInput({ enabled: true, weekdays: [6, 1, 6, 0] })).toEqual({
      value: { enabled: true, weekdays: [0, 1, 6] },
    });
  });

  it('bật mà không chọn thứ nào thì báo lỗi; tắt thì được để trống', () => {
    expect(parseAutoAttendanceInput({ enabled: true, weekdays: [] })).toEqual({
      error: expect.stringContaining('ít nhất một thứ'),
    });
    expect(parseAutoAttendanceInput({ enabled: false, weekdays: [] })).toEqual({ value: { enabled: false, weekdays: [] } });
  });

  it('từ chối dữ liệu sai kiểu hoặc thứ ngoài 0-6', () => {
    for (const body of [null, {}, { enabled: 'true', weekdays: [1] }, { enabled: true, weekdays: 'x' }, { enabled: true, weekdays: [7] }, { enabled: true, weekdays: [1.5] }, { enabled: true, weekdays: ['1'] }])
      expect(parseAutoAttendanceInput(body)).toHaveProperty('error');
  });
});

describe('appliesOnDate', () => {
  const SAT = '2026-10-10';
  const on = { enabled: true, weekdays: [6], enabledFrom: '2026-10-01' };

  it('xác định thứ trong tuần (0 = Chủ nhật)', () => {
    expect(weekdayOfDate(SAT)).toBe(6);
    expect(weekdayOfDate('2026-10-11')).toBe(0);
    expect(weekdayOfDate('2026-10-12')).toBe(1);
  });

  it('áp dụng khi bật, đúng thứ và từ ngày bật trở đi', () => {
    expect(appliesOnDate(on, SAT)).toBe(true);
    expect(appliesOnDate(on, '2026-10-12')).toBe(false);
    expect(appliesOnDate({ ...on, enabledFrom: '2026-10-11' }, SAT)).toBe(false);
    expect(appliesOnDate({ ...on, enabledFrom: null }, SAT)).toBe(true);
  });

  it('tắt hoặc không có thứ nào thì không áp dụng', () => {
    expect(appliesOnDate({ ...on, enabled: false }, SAT)).toBe(false);
    expect(appliesOnDate({ ...on, weekdays: [] }, SAT)).toBe(false);
  });
});
