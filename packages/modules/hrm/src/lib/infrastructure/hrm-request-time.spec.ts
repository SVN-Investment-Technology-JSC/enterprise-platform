import { BadRequestException } from '@nestjs/common';
import {
  calendarDatesOf,
  computeOvertimeTime,
  computeRequestTime,
  computeTripTime,
  deriveOvertimeTime,
  localDateOf,
  localTimeOf,
  parseRequestInstant,
  parseRequestRange,
  shiftDayFromPreview,
  type RequestShiftDay,
} from './hrm-request-time';

const TZ = 'Asia/Ho_Chi_Minh';
/** Giờ địa phương -> ms UTC (UTC+7 không có giờ mùa hè). */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);

/** Ca hành chính 08:00-17:00, nghỉ trưa 12:00-13:00 (480 phút làm việc). */
const workDay = (date: string): RequestShiftDay => ({
  date,
  kind: 'WORK',
  startMs: at(date, '08:00'),
  endMs: at(date, '17:00'),
  breakStartMs: at(date, '12:00'),
  breakEndMs: at(date, '13:00'),
  shiftMinutes: 480,
});
const off = (date: string): RequestShiftDay => ({
  date,
  kind: 'OFF',
  startMs: null,
  endMs: null,
  breakStartMs: null,
  breakEndMs: null,
  shiftMinutes: 0,
});
const noShift = (date: string): RequestShiftDay => ({ ...off(date), kind: 'NO_SHIFT' });

const compute = (
  days: RequestShiftDay[],
  from: [string, string],
  to: [string, string],
  unit: 'DAYS' | 'HOURS' = 'DAYS',
) => computeRequestTime(days, at(...from), at(...to), TZ, unit);

describe('parseRequestInstant', () => {
  it('giờ địa phương không kèm múi giờ được hiểu theo múi giờ tenant', () => {
    expect(parseRequestInstant('2026-10-12T08:00', TZ, 'Từ')).toBe(Date.UTC(2026, 9, 12, 1, 0));
    expect(parseRequestInstant('2026-10-12T08:00:30', TZ, 'Từ')).toBe(Date.UTC(2026, 9, 12, 1, 0, 30));
  });

  it('nhận ISO có múi giờ nguyên văn', () => {
    expect(parseRequestInstant('2026-10-12T01:00:00Z', TZ, 'Từ')).toBe(Date.UTC(2026, 9, 12, 1, 0));
    expect(parseRequestInstant('2026-10-12T08:00:00+07:00', TZ, 'Từ')).toBe(Date.UTC(2026, 9, 12, 1, 0));
  });

  it('từ chối thiếu, sai định dạng, giờ hoặc ngày không tồn tại bằng 400', () => {
    for (const bad of [undefined, '', '2026-10-12', '2026-10-12 08:00', '12/10/2026 08:00', '2026-10-12T25:00', '2026-10-12T08:61', '2026-02-30T08:00', 5])
      expect(() => parseRequestInstant(bad, TZ, 'Từ')).toThrow(BadRequestException);
  });
});

describe('parseRequestRange', () => {
  it('đến phải sau từ; tối đa 366 ngày', () => {
    expect(() => parseRequestRange('2026-10-12T08:00', '2026-10-12T08:00', TZ)).toThrow(/sau từ/);
    expect(() => parseRequestRange('2026-10-12T09:00', '2026-10-12T08:00', TZ)).toThrow(BadRequestException);
    expect(() => parseRequestRange('2026-01-01T00:00', '2027-01-03T00:00', TZ)).toThrow(/366/);
    const ok = parseRequestRange('2026-10-12T08:00', '2026-10-12T17:00', TZ);
    expect(ok.toMs - ok.fromMs).toBe(9 * 3600000);
  });
});

describe('ngày giờ địa phương', () => {
  it('đọc ngày và giờ theo múi giờ, qua nửa đêm UTC vẫn đúng', () => {
    const ms = Date.UTC(2026, 9, 12, 18, 30); // 01:30 ngày 13 giờ VN
    expect(localDateOf(ms, TZ)).toBe('2026-10-13');
    expect(localTimeOf(ms, TZ)).toBe('01:30');
    expect(localTimeOf(Date.UTC(2026, 9, 12, 17, 0), TZ)).toBe('00:00');
  });

  it('calendarDatesOf: kết thúc đúng 00:00 thì không tính ngày đó', () => {
    expect(calendarDatesOf(at('2026-10-12', '08:00'), at('2026-10-14', '00:00'), TZ)).toEqual([
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(calendarDatesOf(at('2026-10-12', '08:00'), at('2026-10-14', '00:01'), TZ)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(calendarDatesOf(at('2026-10-12', '08:00'), at('2026-10-12', '09:00'), TZ)).toEqual(['2026-10-12']);
  });
});

describe('deriveOvertimeTime', () => {
  it('suy ra ngày làm, giờ bắt đầu/kết thúc và số phút', () => {
    expect(deriveOvertimeTime(at('2026-10-12', '18:00'), at('2026-10-12', '20:30'), TZ)).toEqual({
      workDate: '2026-10-12',
      startTime: '18:00',
      endTime: '20:30',
      plannedMinutes: 150,
    });
  });

  it('làm thêm qua đêm: ngày làm là ngày bắt đầu, giờ kết thúc sang ngày kế', () => {
    expect(deriveOvertimeTime(at('2026-10-12', '22:00'), at('2026-10-13', '02:00'), TZ)).toEqual({
      workDate: '2026-10-12',
      startTime: '22:00',
      endTime: '02:00',
      plannedMinutes: 240,
    });
  });

  it('từ 24 giờ trở lên bị từ chối', () => {
    expect(() => deriveOvertimeTime(at('2026-10-12', '08:00'), at('2026-10-13', '08:00'), TZ)).toThrow(
      BadRequestException,
    );
  });
});

describe('computeRequestTime: đơn vị ngày', () => {
  it('cả ca (kể cả chọn rộng hơn ca) = 480 phút, 1 ngày', () => {
    const days = [workDay('2026-10-12')];
    for (const [from, to] of [
      ['08:00', '17:00'],
      ['07:00', '18:00'],
    ] as const) {
      const r = compute(days, ['2026-10-12', from], ['2026-10-12', to]);
      expect(r.errors).toEqual([]);
      expect(r.totalMinutes).toBe(480);
      expect(r.totalDays).toBe(1);
      expect(r.days).toEqual([{ date: '2026-10-12', kind: 'WORK', minutes: 480, quantity: 1 }]);
    }
  });

  it('nửa ngày sáng và nửa ngày chiều = 240 phút, 0.5 ngày', () => {
    const days = [workDay('2026-10-12')];
    for (const [from, to] of [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ] as const) {
      const r = compute(days, ['2026-10-12', from], ['2026-10-12', to]);
      expect(r.errors).toEqual([]);
      expect(r.days[0]).toMatchObject({ minutes: 240, quantity: 0.5 });
      expect(r.totalDays).toBe(0.5);
    }
  });

  it('khoảng vắt qua giờ nghỉ trưa trừ phần giờ nghỉ', () => {
    const r = compute([workDay('2026-10-12')], ['2026-10-12', '11:00'], ['2026-10-12', '14:00'], 'HOURS');
    expect(r.days[0]).toMatchObject({ minutes: 120, quantity: 2 });
  });

  it('nghỉ một phần ngày không phải nửa ca là lỗi với đơn vị ngày, nhưng hợp lệ với đơn vị giờ', () => {
    const days = [workDay('2026-10-12')];
    const byDay = compute(days, ['2026-10-12', '08:00'], ['2026-10-12', '10:00']);
    expect(byDay.errors.join(' ')).toMatch(/cả ngày hoặc đúng nửa ca/);
    const byHour = compute(days, ['2026-10-12', '08:00'], ['2026-10-12', '10:00'], 'HOURS');
    expect(byHour.errors).toEqual([]);
    expect(byHour.days[0]).toMatchObject({ minutes: 120, quantity: 2 });
    expect(byHour.totalMinutes).toBe(120);
  });

  it('nhiều ngày: bỏ ngày nghỉ và ghi chú, cộng các ngày làm việc', () => {
    const days = [workDay('2026-10-09'), off('2026-10-10'), off('2026-10-11'), workDay('2026-10-12')];
    const r = compute(days, ['2026-10-09', '08:00'], ['2026-10-12', '17:00']);
    expect(r.errors).toEqual([]);
    expect(r.totalMinutes).toBe(960);
    expect(r.totalDays).toBe(2);
    expect(r.days.map((d) => [d.date, d.kind, d.quantity])).toEqual([
      ['2026-10-09', 'WORK', 1],
      ['2026-10-10', 'OFF', 0],
      ['2026-10-11', 'OFF', 0],
      ['2026-10-12', 'WORK', 1],
    ]);
    expect(r.warnings).toHaveLength(2);
  });

  it('ngày làm việc chưa phân ca trong khoảng là lỗi chặn', () => {
    const r = compute(
      [workDay('2026-10-12'), noShift('2026-10-13')],
      ['2026-10-12', '08:00'],
      ['2026-10-13', '17:00'],
    );
    expect(r.errors.join(' ')).toMatch(/Chưa phân ca ngày 2026-10-13/);
  });

  it('khoảng hoàn toàn ngoài ca hoặc chỉ trùng giờ nghỉ: lỗi không có giờ làm việc', () => {
    const outside = compute([workDay('2026-10-12')], ['2026-10-12', '18:00'], ['2026-10-12', '20:00']);
    expect(outside.errors.join(' ')).toMatch(/không có giờ làm việc/);
    expect(outside.totalMinutes).toBe(0);
    const lunch = compute([workDay('2026-10-12')], ['2026-10-12', '12:00'], ['2026-10-12', '13:00']);
    expect(lunch.errors.join(' ')).toMatch(/không có giờ làm việc/);
  });

  it('ca ngắn (ví dụ thứ Bảy 4 giờ) quy 0.5 ngày khi nghỉ cả ca', () => {
    const half: RequestShiftDay = {
      date: '2026-10-10',
      kind: 'WORK',
      startMs: at('2026-10-10', '08:00'),
      endMs: at('2026-10-10', '12:00'),
      breakStartMs: null,
      breakEndMs: null,
      shiftMinutes: 240,
    };
    const r = compute([half], ['2026-10-10', '08:00'], ['2026-10-10', '12:00']);
    expect(r.errors).toEqual([]);
    expect(r.days[0]).toMatchObject({ minutes: 240, quantity: 0.5 });
    expect(r.totalDays).toBe(0.5);
  });
});

describe('computeRequestTime: ca qua đêm', () => {
  /** Ca đêm 22:00 -> 06:00 hôm sau, không giờ nghỉ (480 phút). */
  const night = (date: string): RequestShiftDay => ({
    date,
    kind: 'WORK',
    startMs: at(date, '22:00'),
    endMs: at(`${new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)}`, '06:00'),
    breakStartMs: null,
    breakEndMs: null,
    shiftMinutes: 480,
  });

  it('nghỉ cả ca đêm: tính cho ngày bắt đầu ca', () => {
    const r = compute([night('2026-10-12')], ['2026-10-12', '22:00'], ['2026-10-13', '06:00']);
    expect(r.errors).toEqual([]);
    expect(r.days).toEqual([{ date: '2026-10-12', kind: 'WORK', minutes: 480, quantity: 1 }]);
  });

  it('khoảng bắt đầu sau nửa đêm vẫn trúng ca của ngày hôm trước', () => {
    // 00:00 -> 06:00 ngày 13, ca bắt đầu 22:00 ngày 12 (ngày 12 không nằm trong dải ngày của khoảng).
    const r = compute(
      [night('2026-10-12'), { ...off('2026-10-13'), kind: 'OFF' }],
      ['2026-10-13', '00:00'],
      ['2026-10-13', '06:00'],
      'HOURS',
    );
    expect(r.errors).toEqual([]);
    expect(r.totalMinutes).toBe(360);
    expect(r.days.find((d) => d.date === '2026-10-12')).toMatchObject({ minutes: 360, quantity: 6 });
  });
});

describe('shiftDayFromPreview', () => {
  const preview = (over: object) => ({
    date: '2026-10-12',
    kind: 'WORK' as const,
    weight: 1,
    shiftMinutes: 480,
    startMinutes: 480,
    endMinutes: 1020,
    breakStartMinutes: 720,
    breakEndMinutes: 780,
    ...over,
  });

  it('ca ban ngày: mốc tuyệt đối và giờ nghỉ cùng ngày', () => {
    const d = shiftDayFromPreview(preview({}), TZ);
    expect(d.startMs).toBe(at('2026-10-12', '08:00'));
    expect(d.endMs).toBe(at('2026-10-12', '17:00'));
    expect(d.breakStartMs).toBe(at('2026-10-12', '12:00'));
    expect(d.breakEndMs).toBe(at('2026-10-12', '13:00'));
  });

  it('ca qua đêm: kết thúc và giờ nghỉ sau nửa đêm sang ngày kế', () => {
    const d = shiftDayFromPreview(
      preview({ startMinutes: 1320, endMinutes: 360, breakStartMinutes: 30, breakEndMinutes: 90, shiftMinutes: 420 }),
      TZ,
    );
    expect(d.startMs).toBe(at('2026-10-12', '22:00'));
    expect(d.endMs).toBe(at('2026-10-13', '06:00'));
    expect(d.breakStartMs).toBe(at('2026-10-13', '00:30'));
    expect(d.breakEndMs).toBe(at('2026-10-13', '01:30'));
  });

  it('ngày nghỉ, lễ hoặc chưa phân ca không có mốc ca', () => {
    for (const kind of ['OFF', 'HOLIDAY', 'NO_SHIFT'] as const) {
      const d = shiftDayFromPreview(preview({ kind, startMinutes: null, endMinutes: null }), TZ);
      expect(d).toMatchObject({ kind, startMs: null, endMs: null, shiftMinutes: 0 });
    }
  });
});

describe('computeRequestTime: nghỉ nhiều ngày có giờ (hệ số 0.5)', () => {
  it('ngày đầu và ngày cuối nghỉ một phần ca quy về bội số 0.5, tối thiểu 0.5, không báo lỗi', () => {
    const days = [workDay('2026-10-12'), workDay('2026-10-13')];
    // 12/10 14:00-17:00 (180 phút trên 480) và 13/10 08:00-09:00 (60 phút trên 480).
    const r = compute(days, ['2026-10-12', '14:00'], ['2026-10-13', '09:00']);
    expect(r.errors).toEqual([]);
    expect(r.days.map((d) => d.quantity)).toEqual([0.5, 0.5]);
    expect(r.totalDays).toBe(1);
  });

  it('ngày giữa nghỉ cả ngày; ngày đầu nghỉ buổi chiều 0.5; tổng số ngày khớp tổng số lượng từng ngày', () => {
    const days = [workDay('2026-10-12'), workDay('2026-10-13'), workDay('2026-10-14')];
    const r = compute(days, ['2026-10-12', '13:00'], ['2026-10-14', '17:00']);
    expect(r.errors).toEqual([]);
    expect(r.days.map((d) => d.quantity)).toEqual([0.5, 1, 1]);
    expect(r.totalDays).toBe(2.5);
  });

  it('nghỉ một ngày không đúng nửa ca vẫn bị báo lỗi như cũ', () => {
    const r = compute([workDay('2026-10-12')], ['2026-10-12', '14:00'], ['2026-10-12', '16:00']);
    expect(r.errors[0]).toContain('chỉ nhận cả ngày hoặc đúng nửa ca');
  });
});

describe('computeOvertimeTime (đơn làm thêm giờ)', () => {
  const ot = (days: RequestShiftDay[], from: [string, string], to: [string, string]) =>
    computeOvertimeTime(days, at(...from), at(...to), TZ);

  it('ngày nghỉ hằng tuần: hợp lệ, tính đúng khoảng đã chọn, chỉ ghi chú hệ số ngày nghỉ', () => {
    const r = ot([off('2026-10-17')], ['2026-10-17', '08:00'], ['2026-10-17', '11:00']);
    expect(r.errors).toEqual([]);
    expect(r.totalMinutes).toBe(180);
    expect(r.days).toEqual([{ date: '2026-10-17', kind: 'OFF', minutes: 180, quantity: 3 }]);
    expect(r.warnings.join(' ')).toContain('ngày nghỉ');
  });

  it('ngày lễ và ngày chưa phân ca đều hợp lệ', () => {
    const holiday = { ...off('2026-09-02'), kind: 'HOLIDAY' as const };
    expect(ot([holiday], ['2026-09-02', '09:00'], ['2026-09-02', '12:00']).errors).toEqual([]);
    expect(ot([noShift('2026-10-18')], ['2026-10-18', '09:00'], ['2026-10-18', '12:00']).errors).toEqual([]);
  });

  it('ngày làm việc: OT sau ca (17:30-20:30) hợp lệ, 3 giờ', () => {
    const r = ot([workDay('2026-10-12')], ['2026-10-12', '17:30'], ['2026-10-12', '20:30']);
    expect(r.errors).toEqual([]);
    expect(r.totalMinutes).toBe(180);
  });

  it('OT trùng giờ ca bị bắt lỗi và chỉ rõ đoạn trùng', () => {
    const r = ot([workDay('2026-10-12')], ['2026-10-12', '16:00'], ['2026-10-12', '19:00']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('16:00 - 17:00');
    expect(r.errors[0]).toContain('12/10');
    expect(r.errors[0]).toContain('(08:00 - 17:00)');
    // OT hoàn toàn trong giờ nghỉ trưa cũng nằm trong ca nên vẫn trùng.
    expect(ot([workDay('2026-10-12')], ['2026-10-12', '12:00'], ['2026-10-12', '13:00']).errors).toHaveLength(1);
  });

  it('OT qua nửa đêm tách theo ngày; trùng ca của ngày hôm sau cũng bị bắt', () => {
    const days = [workDay('2026-10-12'), workDay('2026-10-13')];
    const ok = ot(days, ['2026-10-12', '22:00'], ['2026-10-13', '02:00']);
    expect(ok.errors).toEqual([]);
    expect(ok.days.map((d) => [d.date, d.minutes])).toEqual([
      ['2026-10-12', 120],
      ['2026-10-13', 120],
    ]);
    expect(ok.totalMinutes).toBe(240);
    const bad = ot(days, ['2026-10-12', '22:00'], ['2026-10-13', '09:00']);
    expect(bad.errors[0]).toContain('08:00 - 09:00');
  });
});

describe('computeTripTime (đơn công tác)', () => {
  const trip = (days: RequestShiftDay[], from: [string, string], to: [string, string]) =>
    computeTripTime(days, at(...from), at(...to), TZ);

  it('cả ca hành chính là 1 ngày, nửa ca sáng hoặc chiều là 0.5 ngày', () => {
    const d = [workDay('2026-10-12')];
    const whole = trip(d, ['2026-10-12', '08:00'], ['2026-10-12', '17:00']);
    expect(whole.errors).toEqual([]);
    expect([whole.totalDays, whole.totalMinutes]).toEqual([1, 480]);
    const morning = trip(d, ['2026-10-12', '08:00'], ['2026-10-12', '12:00']);
    expect(morning.errors).toEqual([]);
    expect(morning.totalDays).toBe(0.5);
    const afternoon = trip(d, ['2026-10-12', '13:00'], ['2026-10-12', '17:00']);
    expect(afternoon.errors).toEqual([]);
    expect(afternoon.totalDays).toBe(0.5);
  });

  it('khoảng nhiều ngày: cộng từng ngày; ngày nghỉ và ngày lễ không tính', () => {
    const r = trip(
      [workDay('2026-10-09'), off('2026-10-10'), off('2026-10-11'), workDay('2026-10-12')],
      ['2026-10-09', '08:00'],
      ['2026-10-12', '12:00'],
    );
    expect(r.errors).toEqual([]);
    // 09/10 cả ngày + 12/10 buổi sáng; thứ Bảy, Chủ nhật bỏ qua.
    expect(r.totalDays).toBe(1.5);
    expect(r.totalMinutes).toBe(720);
    expect(r.warnings).toHaveLength(2);
  });

  it('chặn khoảng sai khung ca: 3 giờ, 5 giờ, thiếu 1 giờ so với cả ca, hoặc nằm ngoài ca', () => {
    const d = [workDay('2026-10-12')];
    for (const [f, t] of [['08:00', '11:00'], ['08:00', '14:00'], ['09:00', '17:00']] as const) {
      const r = trip(d, ['2026-10-12', f], ['2026-10-12', t]);
      expect(r.errors.join(' ')).toContain('công tác theo ngày chỉ nhận cả ngày hoặc đúng nửa ca (240 phút)');
    }
    const outside = trip(d, ['2026-10-12', '18:00'], ['2026-10-12', '23:00']);
    expect(outside.errors.join(' ')).toContain('Khoảng thời gian không có giờ làm việc nào');
  });

  it('khoảng nhiều ngày cũng bị chặn ở ngày đầu hoặc ngày cuối nếu không phải cả ca hoặc nửa ca (khác đơn nghỉ)', () => {
    const d = [workDay('2026-10-12'), workDay('2026-10-13')];
    const r = trip(d, ['2026-10-12', '14:00'], ['2026-10-13', '17:00']);
    expect(r.errors.join(' ')).toContain('2026-10-12: công tác theo ngày chỉ nhận');
    // Cùng khoảng ở đơn nghỉ được làm tròn về 0.5 và không bị chặn.
    expect(computeRequestTime(d, at('2026-10-12', '14:00'), at('2026-10-13', '17:00'), TZ).errors).toEqual([]);
  });

  it('ngày chưa phân ca bị chặn như đơn nghỉ', () => {
    const r = trip([noShift('2026-10-18')], ['2026-10-18', '08:00'], ['2026-10-18', '17:00']);
    expect(r.errors.join(' ')).toContain('Chưa phân ca ngày 2026-10-18');
  });
});

describe('computeRequestTime: đơn vắt qua 2 tháng', () => {
  // 29/10/2026 (thứ Năm) đến 03/11/2026 (thứ Ba): T7 31/10 và CN 01/11 nghỉ.
  const crossMonth = [
    workDay('2026-10-29'),
    workDay('2026-10-30'),
    off('2026-10-31'),
    off('2026-11-01'),
    workDay('2026-11-02'),
    workDay('2026-11-03'),
  ];
  const byMonth = (r: ReturnType<typeof compute>, prefix: string) =>
    r.days.filter((d) => d.date.startsWith(prefix)).reduce((n, d) => n + d.quantity, 0);

  it('một đơn duy nhất: tính đủ ngày hai tháng, bỏ ngày nghỉ hằng tuần, có cảnh báo từng ngày nghỉ', () => {
    const r = compute(crossMonth, ['2026-10-29', '08:00'], ['2026-11-03', '17:00']);
    expect(r.errors).toEqual([]);
    expect(r.totalDays).toBe(4);
    expect(r.totalMinutes).toBe(4 * 480);
    expect(r.days.map((d) => d.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(byMonth(r, '2026-10')).toBe(2);
    expect(byMonth(r, '2026-11')).toBe(2);
    expect(r.warnings).toHaveLength(2);
  });

  it('ngày cuối tháng nghỉ chiều và ngày đầu tháng sau nghỉ sáng: 0.5 + 0.5 chia đúng theo tháng', () => {
    const days = [workDay('2026-10-30'), off('2026-10-31'), off('2026-11-01'), workDay('2026-11-02')];
    const r = compute(days, ['2026-10-30', '13:00'], ['2026-11-02', '12:00']);
    expect(r.errors).toEqual([]);
    expect(byMonth(r, '2026-10')).toBe(0.5);
    expect(byMonth(r, '2026-11')).toBe(0.5);
    expect(r.totalDays).toBe(1);
  });

  it('kết thúc đúng 00:00 ngày đầu tháng sau thì không tính ngày của tháng sau', () => {
    const r = compute(crossMonth, ['2026-10-30', '08:00'], ['2026-11-01', '00:00']);
    expect(r.errors).toEqual([]);
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31']);
    expect(byMonth(r, '2026-11')).toBe(0);
    expect(r.totalDays).toBe(1);
  });

  it('ngày của tháng sau chưa phân ca: lỗi chặn, chỉ rõ ngày thiếu ca', () => {
    const days = [workDay('2026-10-30'), off('2026-10-31'), off('2026-11-01'), noShift('2026-11-02')];
    const r = compute(days, ['2026-10-30', '08:00'], ['2026-11-02', '17:00']);
    expect(r.errors).toEqual(['Chưa phân ca ngày 2026-11-02; không thể xác định số giờ.']);
  });

  it('vắt qua năm (31/12 sang 02/01): ngày của mỗi năm giữ nguyên ngày để quỹ phép trừ đúng năm', () => {
    const days = [workDay('2026-12-31'), workDay('2027-01-01'), workDay('2027-01-02')];
    const r = compute(days, ['2026-12-31', '08:00'], ['2027-01-02', '17:00']);
    expect(r.errors).toEqual([]);
    expect(byMonth(r, '2026-12')).toBe(1);
    expect(byMonth(r, '2027-01')).toBe(2);
    expect(r.totalDays).toBe(3);
  });

  it('đơn công tác vắt 2 tháng: ngày đầu tháng sau chỉ nhận cả ca hoặc nửa ca', () => {
    const days = [workDay('2026-10-30'), off('2026-10-31'), off('2026-11-01'), workDay('2026-11-02')];
    const bad = computeTripTime(days, at('2026-10-30', '08:00'), at('2026-11-02', '10:00'), TZ);
    expect(bad.errors[0]).toContain('công tác theo ngày chỉ nhận cả ngày hoặc đúng nửa ca');
    const ok = computeTripTime(days, at('2026-10-30', '08:00'), at('2026-11-02', '12:00'), TZ);
    expect(ok.errors).toEqual([]);
    expect(ok.totalDays).toBe(1.5);
  });

  it('đơn làm thêm giờ qua nửa đêm cuối tháng được tách theo ngày lịch của hai tháng', () => {
    const r = computeOvertimeTime(
      [off('2026-10-31'), off('2026-11-01')],
      at('2026-10-31', '22:00'),
      at('2026-11-01', '02:00'),
      TZ,
    );
    expect(r.errors).toEqual([]);
    expect(r.days.map((d) => [d.date, d.minutes])).toEqual([
      ['2026-10-31', 120],
      ['2026-11-01', 120],
    ]);
  });
});

describe('computeTripTime: thứ Bảy ca ngắn', () => {
  // Thứ Bảy 17/10/2026 làm 08:00-12:00 (240 phút, không nghỉ trưa).
  const saturday: RequestShiftDay = {
    date: '2026-10-17',
    kind: 'WORK',
    startMs: at('2026-10-17', '08:00'),
    endMs: at('2026-10-17', '12:00'),
    breakStartMs: null,
    breakEndMs: null,
    shiftMinutes: 240,
  };

  it('đi cả ca thứ Bảy là 1 ngày công tác (đơn nghỉ vẫn quy 0.5)', () => {
    const trip = computeTripTime([saturday], at('2026-10-17', '08:00'), at('2026-10-17', '12:00'), TZ);
    expect(trip.errors).toEqual([]);
    expect(trip.days[0]).toMatchObject({ minutes: 240, quantity: 1 });
    expect(trip.totalDays).toBe(1);
    const leave = computeRequestTime([saturday], at('2026-10-17', '08:00'), at('2026-10-17', '12:00'), TZ);
    expect(leave.totalDays).toBe(0.5);
  });

  it('thứ Sáu đến thứ Bảy: 1 + 1 = 2 ngày công tác', () => {
    const r = computeTripTime(
      [workDay('2026-10-16'), saturday],
      at('2026-10-16', '08:00'),
      at('2026-10-17', '12:00'),
      TZ,
    );
    expect(r.errors).toEqual([]);
    expect(r.totalDays).toBe(2);
  });
});
