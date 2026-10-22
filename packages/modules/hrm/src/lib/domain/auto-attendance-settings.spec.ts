import {
  appliesOnDate,
  appliesToEmployeeOnDate,
  parseAutoAttendanceEmployeeInput,
  parseAutoAttendanceInput,
  weekdayOfDate,
} from './auto-attendance-settings';

describe('parseAutoAttendanceEmployeeInput', () => {
  const TODAY = '2026-10-19';
  const E = '00000000-0000-4000-8000-0000000000e1';

  it('chuẩn hóa: mặc định từ hôm nay, thứ rỗng là mọi ngày, bỏ trùng và sắp tăng dần', () => {
    expect(parseAutoAttendanceEmployeeInput({ employeeId: E, reason: '  Không chấm vân tay ', weekdays: [] }, TODAY)).toEqual({
      value: { employeeId: E, weekdays: null, fromDate: TODAY, toDate: null, reason: 'Không chấm vân tay' },
    });
    expect(
      parseAutoAttendanceEmployeeInput(
        { employeeId: E, reason: 'x', weekdays: [6, 1, 6], fromDate: '2026-10-20', toDate: '2026-10-30' },
        TODAY,
      ),
    ).toEqual({ value: { employeeId: E, weekdays: [1, 6], fromDate: '2026-10-20', toDate: '2026-10-30', reason: 'x' } });
  });

  it('báo lỗi khi thiếu nhân viên, thiếu lý do, ngày hoặc thứ không hợp lệ', () => {
    const bad = (body: object) => parseAutoAttendanceEmployeeInput(body, TODAY);
    expect(bad({ reason: 'x' })).toEqual({ error: expect.stringContaining('nhân viên') });
    expect(bad({ employeeId: E, reason: '  ' })).toEqual({ error: expect.stringContaining('lý do') });
    expect(bad({ employeeId: E, reason: 'x', fromDate: '10/10/2026' })).toEqual({ error: expect.stringContaining('bắt đầu') });
    expect(bad({ employeeId: E, reason: 'x', fromDate: '2026-10-20', toDate: '2026-10-19' })).toEqual({
      error: expect.stringContaining('kết thúc'),
    });
    expect(bad({ employeeId: E, reason: 'x', weekdays: [7] })).toEqual({ error: expect.stringContaining('Thứ') });
    expect(bad({ employeeId: E, reason: 'x'.repeat(501) })).toEqual({ error: expect.stringContaining('500') });
  });
});

describe('appliesToEmployeeOnDate', () => {
  const rule = {
    employeeId: 'e',
    weekdays: null as number[] | null,
    fromDate: '2026-10-05',
    toDate: '2026-10-12' as string | null,
  };

  it('chỉ áp dụng trong khoảng hiệu lực, kể cả hai đầu', () => {
    expect(appliesToEmployeeOnDate(rule, '2026-10-04')).toBe(false);
    expect(appliesToEmployeeOnDate(rule, '2026-10-05')).toBe(true);
    expect(appliesToEmployeeOnDate(rule, '2026-10-12')).toBe(true);
    expect(appliesToEmployeeOnDate(rule, '2026-10-13')).toBe(false);
    expect(appliesToEmployeeOnDate({ ...rule, toDate: null }, '2027-01-01')).toBe(true);
  });

  it('có chọn thứ thì chỉ đúng thứ đó; không chọn là mọi ngày', () => {
    expect(appliesToEmployeeOnDate({ ...rule, weekdays: [6] }, '2026-10-10')).toBe(true);
    expect(appliesToEmployeeOnDate({ ...rule, weekdays: [6] }, '2026-10-09')).toBe(false);
    expect(appliesToEmployeeOnDate({ ...rule, weekdays: [] }, '2026-10-09')).toBe(true);
  });
});

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
