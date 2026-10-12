import {
  applyScheduleDayKind,
  compactRuns,
  expandPattern,
  isoWeekday,
  listDates,
  normalizePattern,
  planDay,
  planSchedule,
  type ExistingDay,
  type IncomingDay,
  type WeekdayRule,
} from './work-schedule';

const ADMIN = 'shift-admin';
const MORNING = 'shift-morning';
const SUNDAY_SHIFT = 'shift-sunday';

/** Lịch hành chính: T2-T6 ca hành chính, T7 buổi sáng, CN nghỉ. */
const OFFICE: WeekdayRule[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'SHIFT' as const, shiftId: ADMIN })),
  { weekday: 6, dayType: 'SHIFT', shiftId: MORNING },
  { weekday: 7, dayType: 'OFF' },
];

const incoming = (over: Partial<IncomingDay> = {}): IncomingDay => ({
  employeeId: 'e1',
  date: '2026-10-05',
  dayType: 'SHIFT',
  shiftId: ADMIN,
  source: 'TEMPLATE',
  ...over,
});
const existing = (over: Partial<ExistingDay> = {}): ExistingDay => ({
  id: 'row1',
  employeeId: 'e1',
  date: '2026-10-05',
  dayType: 'SHIFT',
  shiftId: MORNING,
  source: 'TEMPLATE',
  ...over,
});

describe('ngày và thứ trong tuần', () => {
  it('tính thứ ISO: 1 là thứ Hai, 7 là Chủ nhật', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Thứ Hai
    expect(isoWeekday('2026-10-10')).toBe(6); // Thứ Bảy
    expect(isoWeekday('2026-10-11')).toBe(7); // Chủ nhật
  });

  it('liệt kê ngày bao gồm hai đầu và từ chối khoảng quá dài hoặc ngược', () => {
    expect(listDates('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(() => listDates('2026-10-05', '2026-10-01')).toThrow('Ngày kết thúc');
    expect(() => listDates('2025-01-01', '2026-12-31')).toThrow('tối đa');
    expect(() => listDates('2026-02-30', '2026-03-01')).toThrow('không hợp lệ');
  });
});

describe('mẫu lịch tuần', () => {
  it('1. gán lịch hành chính cho một nhân viên trong một tháng', () => {
    const days = expandPattern(OFFICE, 'e1', '2026-10-01', '2026-10-31', 'TEMPLATE');
    expect(days).toHaveLength(31);
    expect(days.filter((d) => d.shiftId === ADMIN)).toHaveLength(22); // T2-T6
    expect(days.filter((d) => d.shiftId === MORNING)).toHaveLength(5); // 5 thứ Bảy
    expect(days.filter((d) => d.dayType === 'OFF')).toHaveLength(4); // 4 Chủ nhật
    expect(days.find((d) => d.date === '2026-10-04')?.dayType).toBe('OFF');
  });

  it('4. thứ Bảy làm buổi sáng rồi chuyển sang nghỉ cả ngày chỉ bằng cách đổi quy tắc, không cố định cứng', () => {
    const saturdayOff = OFFICE.map((r) => (r.weekday === 6 ? { weekday: 6, dayType: 'OFF' as const } : r));
    const before = expandPattern(OFFICE, 'e1', '2026-10-10', '2026-10-10', 'TEMPLATE');
    const after = expandPattern(saturdayOff, 'e1', '2026-10-10', '2026-10-10', 'TEMPLATE');
    expect(before[0]).toMatchObject({ dayType: 'SHIFT', shiftId: MORNING });
    expect(after[0]).toMatchObject({ dayType: 'OFF', shiftId: null });
  });

  it('5. Chủ nhật làm theo ca đã chọn', () => {
    const sundayWork = OFFICE.map((r) => (r.weekday === 7 ? { weekday: 7, dayType: 'SHIFT' as const, shiftId: SUNDAY_SHIFT } : r));
    const [day] = expandPattern(sundayWork, 'e1', '2026-10-11', '2026-10-11', 'TEMPLATE');
    expect(day).toMatchObject({ dayType: 'SHIFT', shiftId: SUNDAY_SHIFT });
  });

  it('thứ khai báo SKIP hoặc thiếu thì không sinh dòng', () => {
    const only: WeekdayRule[] = [
      { weekday: 1, dayType: 'SHIFT', shiftId: ADMIN },
      { weekday: 2, dayType: 'SKIP' },
    ];
    const days = expandPattern(only, 'e1', '2026-10-05', '2026-10-11', 'TEMPLATE');
    expect(days.map((d) => d.date)).toEqual(['2026-10-05']);
  });

  it('không sinh ngày trước ngày vào làm hoặc từ ngày nghỉ việc', () => {
    const days = expandPattern(OFFICE, 'e1', '2026-10-05', '2026-10-09', 'TEMPLATE', {
      joinDate: '2026-10-07',
      inactiveFrom: '2026-10-09',
    });
    expect(days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08']);
  });

  it('từ chối mẫu sai: trùng thứ, thiếu ca, OFF kèm ca, rỗng', () => {
    expect(() => normalizePattern([{ weekday: 8, dayType: 'OFF' }])).toThrow('từ 1');
    expect(() =>
      normalizePattern([
        { weekday: 1, dayType: 'OFF' },
        { weekday: 1, dayType: 'OFF' },
      ]),
    ).toThrow('hai lần');
    expect(() => normalizePattern([{ weekday: 1, dayType: 'SHIFT' }])).toThrow('chưa chọn ca');
    expect(() => normalizePattern([{ weekday: 1, dayType: 'OFF', shiftId: ADMIN }])).toThrow('không được chọn ca');
    expect(() => normalizePattern([{ weekday: 1, dayType: 'SKIP' }])).toThrow('ít nhất một');
  });
});

describe('xử lý xung đột khi ghi lịch', () => {
  it('chưa có lịch thì tạo mới; trùng hệt thì không đổi', () => {
    expect(planDay(incoming(), undefined, 'REPORT').action).toBe('INSERT');
    expect(planDay(incoming({ shiftId: MORNING }), existing(), 'REPORT').action).toBe('SAME');
  });

  it('10. lịch khác: REPORT báo xung đột chứ không ghi đè âm thầm', () => {
    expect(planDay(incoming(), existing(), 'REPORT').action).toBe('CONFLICT');
  });

  it('SKIP_EXISTING chỉ gán ngày chưa có lịch', () => {
    expect(planDay(incoming(), existing(), 'SKIP_EXISTING').action).toBe('SKIP_EXISTING');
  });

  it('OVERWRITE_KEEP_EXCEPTIONS đè lịch thường nhưng giữ ngoại lệ và ngày lễ', () => {
    expect(planDay(incoming(), existing({ source: 'MANUAL' }), 'OVERWRITE_KEEP_EXCEPTIONS').action).toBe('REPLACE');
    expect(planDay(incoming(), existing({ source: 'EXCEPTION' }), 'OVERWRITE_KEEP_EXCEPTIONS').action).toBe('SKIP_PROTECTED');
    expect(planDay(incoming(), existing({ source: 'HOLIDAY', dayType: 'HOLIDAY', shiftId: null }), 'OVERWRITE_KEEP_EXCEPTIONS').action).toBe(
      'SKIP_PROTECTED',
    );
  });

  it('OVERWRITE_ALL đè cả ngoại lệ', () => {
    expect(planDay(incoming(), existing({ source: 'EXCEPTION' }), 'OVERWRITE_ALL').action).toBe('REPLACE');
  });

  it('7. ngoại lệ một ngày thay lịch thường mà không cần chọn chế độ, nhưng xung đột với ngoại lệ khác', () => {
    const exception = incoming({ source: 'EXCEPTION', dayType: 'OFF', shiftId: null });
    expect(planDay(exception, existing({ source: 'TEMPLATE' }), 'REPORT').action).toBe('REPLACE');
    expect(planDay(exception, existing({ source: 'EXCEPTION' }), 'REPORT').action).toBe('CONFLICT');
    expect(planDay(exception, existing({ source: 'EXCEPTION' }), 'OVERWRITE_ALL').action).toBe('REPLACE');
  });

  it('8. ngày lễ thay lịch thường, không đè ngoại lệ, không đè ngày lễ khác', () => {
    const holiday = incoming({ source: 'HOLIDAY', dayType: 'HOLIDAY', shiftId: null });
    expect(planDay(holiday, existing({ source: 'TEMPLATE' }), 'REPORT').action).toBe('REPLACE');
    expect(planDay(holiday, existing({ source: 'EXCEPTION' }), 'REPORT').action).toBe('SKIP_PROTECTED');
    expect(planDay(holiday, existing({ source: 'HOLIDAY', dayType: 'OFF', shiftId: null }), 'REPORT').action).toBe('SKIP_PROTECTED');
  });

  it('9. tổng hợp kế hoạch: thay một ngày riêng lẻ không đụng các ngày còn lại', () => {
    const week = expandPattern(OFFICE, 'e1', '2026-10-05', '2026-10-11', 'TEMPLATE');
    const current = week.map((d, i) => ({ ...d, id: `r${i}` }));
    const exception = incoming({ date: '2026-10-07', source: 'EXCEPTION', dayType: 'OFF', shiftId: null });
    const { days, summary } = planSchedule([exception], current, 'REPORT');
    expect(summary).toMatchObject({ replace: 1, insert: 0, conflicts: 0, employees: 1 });
    expect(days[0].existing?.date).toBe('2026-10-07');
  });

  it('2/3. gán hàng loạt nhiều nhân viên và loại trừ bằng cách không đưa vào danh sách', () => {
    const employees = ['a', 'b', 'c', 'd'];
    const excluded = new Set(['c']);
    const all = employees
      .filter((e) => !excluded.has(e))
      .flatMap((e) => expandPattern(OFFICE, e, '2026-10-05', '2026-10-09', 'TEMPLATE'));
    const { summary } = planSchedule(all, [], 'REPORT');
    expect(summary).toMatchObject({ insert: 15, employees: 3, conflicts: 0 });
  });

  it('báo cáo đúng số xung đột theo nhân viên khi một số đã có lịch', () => {
    const all = ['a', 'b'].flatMap((e) => expandPattern(OFFICE, e, '2026-10-05', '2026-10-06', 'TEMPLATE'));
    const current: ExistingDay[] = [
      existing({ id: 'x', employeeId: 'b', date: '2026-10-06', shiftId: SUNDAY_SHIFT }),
    ];
    const { days, summary } = planSchedule(all, current, 'REPORT');
    expect(summary).toMatchObject({ insert: 3, conflicts: 1 });
    expect(days.filter((d) => d.action === 'CONFLICT').map((d) => `${d.incoming.employeeId}@${d.incoming.date}`)).toEqual(['b@2026-10-06']);
  });
});

describe('nhật ký gọn', () => {
  it('gộp các ngày liên tiếp giống nhau thành đoạn', () => {
    const runs = compactRuns([
      { date: '2026-10-05', dayType: 'SHIFT', shiftId: ADMIN, source: 'TEMPLATE' },
      { date: '2026-10-06', dayType: 'SHIFT', shiftId: ADMIN, source: 'TEMPLATE' },
      { date: '2026-10-07', dayType: 'OFF', shiftId: null, source: 'EXCEPTION' },
      { date: '2026-10-09', dayType: 'SHIFT', shiftId: ADMIN, source: 'TEMPLATE' },
    ]);
    expect(runs).toEqual([
      { from: '2026-10-05', to: '2026-10-06', dayType: 'SHIFT', shiftId: ADMIN, source: 'TEMPLATE' },
      { from: '2026-10-07', to: '2026-10-07', dayType: 'OFF', shiftId: null, source: 'EXCEPTION' },
      { from: '2026-10-09', to: '2026-10-09', dayType: 'SHIFT', shiftId: ADMIN, source: 'TEMPLATE' },
    ]);
  });
});

describe('11. loại ngày dùng cho bảng công (giữ nguyên công thức hiện có)', () => {
  it('không có lịch thì giữ nguyên loại ngày cũ', () => {
    expect(applyScheduleDayKind('OFF', null)).toBe('OFF');
    expect(applyScheduleDayKind(null, undefined)).toBeNull();
  });
  it('OFF / HOLIDAY tường minh thắng ngày nghỉ hằng tuần', () => {
    expect(applyScheduleDayKind(null, 'OFF')).toBe('OFF');
    expect(applyScheduleDayKind(null, 'HOLIDAY')).toBe('HOLIDAY');
  });
  it('lịch OFF không hạ ngày lễ công ty xuống nghỉ không lương', () => {
    expect(applyScheduleDayKind('HOLIDAY', 'OFF')).toBe('HOLIDAY');
  });
  it('có ca thì Chủ nhật làm việc không còn bị coi là ngày nghỉ, nhưng ngày lễ công ty vẫn là ngày lễ', () => {
    expect(applyScheduleDayKind('OFF', 'SHIFT')).toBeNull();
    expect(applyScheduleDayKind('HOLIDAY', 'SHIFT')).toBe('HOLIDAY');
    expect(applyScheduleDayKind(null, 'SHIFT')).toBeNull();
  });
});
