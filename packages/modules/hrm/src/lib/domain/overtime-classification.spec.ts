import {
  blockHours,
  classifyBlock,
  classifyClockWindow,
  classifyNightRest,
  crossesMidnight,
  splitBlockByMonth,
  type OvertimeBlock,
} from './overtime-classification.js';

const nightRest = { nightRestHoursPerDay: 8, allowHalfDay: true };
const clockWindow = { nightStartMinute: 1320, nightEndMinute: 360 };
const b = (start: string, end: string): OvertimeBlock => ({ start, end });

describe('blockHours và crossesMidnight', () => {
  it('tính số giờ của ca, kể cả ca qua nửa đêm', () => {
    expect(blockHours(b('2026-10-06T18:00', '2026-10-07T04:00'))).toBe(10);
    expect(blockHours(b('2026-10-17T13:00', '2026-10-17T18:30'))).toBe(5.5);
  });

  it('ca xuyên đêm là ca kết thúc từ 00:00 ngày kế tiếp trở đi, kể cả đúng 00:00', () => {
    expect(crossesMidnight(b('2026-10-08T18:00', '2026-10-09T00:00'))).toBe(true);
    expect(crossesMidnight(b('2026-10-06T18:00', '2026-10-07T04:00'))).toBe(true);
    expect(crossesMidnight(b('2026-10-17T13:00', '2026-10-17T23:00'))).toBe(false);
    expect(crossesMidnight(b('2026-10-17T07:00', '2026-10-17T23:59'))).toBe(false);
  });

  it('từ chối ca có giờ kết thúc không sau giờ bắt đầu hoặc sai định dạng', () => {
    expect(() => blockHours(b('2026-10-06T18:00', '2026-10-06T18:00'))).toThrow(RangeError);
    expect(() => blockHours(b('2026-10-06T18:00', '2026-10-06T17:00'))).toThrow(RangeError);
    expect(() => blockHours(b('06/10/2026 18:00', '2026-10-07T04:00'))).toThrow(RangeError);
  });
});

describe('classifyNightRest (chốt 8 giờ cho mỗi ngày nghỉ sau ca đêm)', () => {
  const cases: Array<[string, string, string, number, number, number]> = [
    ['10 giờ, hôm sau nghỉ cả ngày', '2026-10-06T18:00', '2026-10-07T04:00', 1, 2, 8],
    ['6 giờ đến 00:00, hôm sau nghỉ cả ngày', '2026-10-08T18:00', '2026-10-09T00:00', 1, 0, 6],
    ['14,5 giờ, hôm sau nghỉ cả ngày', '2026-10-28T17:00', '2026-10-29T07:30', 1, 6.5, 8],
    ['13,5 giờ, hôm sau nghỉ nửa ngày', '2026-10-13T17:30', '2026-10-14T07:00', 0.5, 9.5, 4],
    ['12 giờ, hôm sau đi làm bình thường', '2026-09-08T17:00', '2026-09-09T05:00', 0, 12, 0],
  ];
  it.each(cases)('%s', (_name, start, end, fraction, ot, night) => {
    const r = classifyNightRest(b(start, end), fraction, nightRest);
    expect(r).toMatchObject({ otHours: ot, nightHours: night });
    expect(r.otHours + r.nightHours).toBe(blockHours(b(start, end)));
  });

  it('ca không xuyên đêm luôn là làm thêm toàn bộ, kể cả ca dài hơn 4 giờ và dù khai nghỉ hôm sau', () => {
    expect(classifyNightRest(b('2026-10-17T13:00', '2026-10-17T18:00'), 0, nightRest)).toMatchObject({ otHours: 5, nightHours: 0 });
    expect(classifyNightRest(b('2026-10-04T07:00', '2026-10-04T18:00'), 1, nightRest)).toMatchObject({ otHours: 11, nightHours: 0 });
    expect(classifyNightRest(b('2026-10-17T15:30', '2026-10-17T21:30'), 1, nightRest)).toMatchObject({ otHours: 6, nightHours: 0 });
  });

  it('chính sách không cho nghỉ nửa ngày thì bỏ phần nghỉ nửa ngày và cảnh báo', () => {
    const r = classifyNightRest(b('2026-10-13T17:30', '2026-10-14T07:00'), 0.5, { ...nightRest, allowHalfDay: false });
    expect(r).toMatchObject({ otHours: 13.5, nightHours: 0 });
    expect(r.warnings).toHaveLength(1);
  });

  it('số giờ bù mỗi ngày nghỉ lấy từ cấu hình, không cứng 8', () => {
    const r = classifyNightRest(b('2026-10-06T18:00', '2026-10-07T04:00'), 1, { ...nightRest, nightRestHoursPerDay: 6 });
    expect(r).toMatchObject({ otHours: 4, nightHours: 6 });
  });

  it('chỉ nhận phần ngày nghỉ 0, 0,5 hoặc 1', () => {
    expect(() => classifyNightRest(b('2026-10-06T18:00', '2026-10-07T04:00'), 0.3, nightRest)).toThrow(RangeError);
  });
});

describe('classifyClockWindow (khung đêm 22:00 đến 06:00)', () => {
  it.each([
    ['20:00 đến 02:00', '2026-10-06T20:00', '2026-10-07T02:00', 2, 4],
    ['17:00 đến 23:00', '2026-10-06T17:00', '2026-10-06T23:00', 5, 1],
    ['ca ban ngày 08:00 đến 17:00', '2026-10-06T08:00', '2026-10-06T17:00', 9, 0],
    ['22:00 đến 06:00 là toàn bộ ca đêm', '2026-10-06T22:00', '2026-10-07T06:00', 0, 8],
    ['05:00 đến 08:00 chạm cuối khung đêm', '2026-10-07T05:00', '2026-10-07T08:00', 2, 1],
  ])('%s', (_name, start, end, ot, night) => {
    expect(classifyClockWindow(b(start, end), clockWindow)).toMatchObject({ otHours: ot, nightHours: night });
  });

  it('khung đêm lấy từ cấu hình', () => {
    const r = classifyClockWindow(b('2026-10-06T21:00', '2026-10-06T23:00'), { nightStartMinute: 1260, nightEndMinute: 300 });
    expect(r).toMatchObject({ otHours: 0, nightHours: 2 });
  });

  it('từ chối khung đêm sai thứ tự', () => {
    expect(() => classifyClockWindow(b('2026-10-06T20:00', '2026-10-06T23:00'), { nightStartMinute: 300, nightEndMinute: 1320 })).toThrow(RangeError);
  });
});

describe('classifyBlock chọn bộ quy tắc theo chính sách', () => {
  const block = b('2026-10-06T18:00', '2026-10-07T04:00');
  it('hai bộ quy tắc cho hai kết quả khác nhau trên cùng một ca, cùng một kiểu kết quả', () => {
    const base = { block, restFraction: 1, nightRest, clockWindow };
    const a = classifyBlock({ ...base, ruleSet: 'NIGHT_REST' });
    const c = classifyBlock({ ...base, ruleSet: 'CLOCK_WINDOW' });
    expect(a).toMatchObject({ otHours: 2, nightHours: 8 });
    expect(c).toMatchObject({ otHours: 4, nightHours: 6 });
  });

  it('bộ quy tắc lạ bị từ chối', () => {
    expect(() => classifyBlock({ block, nightRest, clockWindow, ruleSet: 'KHAC' as never })).toThrow(RangeError);
  });
});

describe('splitBlockByMonth', () => {
  it('ca xuyên tháng tách tại 00:00 ngày mùng 1', () => {
    const parts = splitBlockByMonth(b('2026-08-31T17:00', '2026-09-01T04:00'));
    expect(parts.map((p) => [p.periodMonth, p.block.start, p.block.end])).toEqual([
      ['2026-08', '2026-08-31T17:00', '2026-09-01T00:00'],
      ['2026-09', '2026-09-01T00:00', '2026-09-01T04:00'],
    ]);
    expect(parts.map((p) => blockHours(p.block))).toEqual([7, 4]);
  });

  it('ca trong một tháng giữ nguyên; ca kết thúc đúng 00:00 ngày mùng 1 thuộc trọn tháng trước', () => {
    expect(splitBlockByMonth(b('2026-10-06T18:00', '2026-10-07T04:00'))).toHaveLength(1);
    const edge = splitBlockByMonth(b('2026-09-30T18:00', '2026-10-01T00:00'));
    expect(edge).toHaveLength(1);
    expect(edge[0]?.periodMonth).toBe('2026-09');
  });

  it('qua tháng 12 sang tháng 1 năm sau', () => {
    const parts = splitBlockByMonth(b('2026-12-31T20:00', '2027-01-01T02:00'));
    expect(parts.map((p) => p.periodMonth)).toEqual(['2026-12', '2027-01']);
  });
});
