import { BadRequestException } from '@nestjs/common';
import {
  calendarDatesOf,
  computeRequestTime,
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
