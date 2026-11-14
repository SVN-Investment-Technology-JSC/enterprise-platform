import {
  classifyNightRest,
  type OvertimeBlock,
} from './overtime-classification.js';
import {
  compOffDays,
  roundDays,
  summarizeOvertimeMonth,
  validateCompOffUsageDays,
  type MonthlyCapConfig,
} from './overtime-monthly-cap.js';

const nightRest = { nightRestHoursPerDay: 8, allowHalfDay: true };
const cap: MonthlyCapConfig = {
  capApplies: true,
  monthlyCapHours: 40,
  yearlyCapHours: 200,
  nightCapped: false,
  compFactor: 1.5,
  dayBasisHours: 8,
  decimals: 1,
  rounding: 'HALF_UP',
};
const b = (start: string, end: string): OvertimeBlock => ({ start, end });

describe('roundDays', () => {
  it('làm tròn 4,3125 thành 4,3 với 1 chữ số thập phân', () => {
    expect(roundDays(4.3125, 1, 'HALF_UP')).toBe(4.3);
    expect(roundDays(2.53125, 1, 'HALF_UP')).toBe(2.5);
    expect(roundDays(0.5625, 1, 'HALF_UP')).toBe(0.6);
  });
  it('làm tròn xuống, lên và không bị sai số số thực', () => {
    expect(roundDays(4.39, 1, 'DOWN')).toBe(4.3);
    expect(roundDays(4.31, 1, 'UP')).toBe(4.4);
    expect(roundDays(4.35, 1, 'HALF_UP')).toBe(4.4);
    expect(roundDays(1.005, 2, 'HALF_UP')).toBe(1.01);
  });
});

describe('compOffDays', () => {
  it('giờ dư / 8 × 1,5, làm tròn theo chính sách', () => {
    expect(compOffDays(23, cap)).toBe(4.3);
    expect(compOffDays(10, cap)).toBe(1.9);
    expect(compOffDays(0, cap)).toBe(0);
    expect(compOffDays(23, { ...cap, compFactor: 2 })).toBe(5.8);
    expect(compOffDays(23, { ...cap, dayBasisHours: 7.5 })).toBe(4.6);
  });
});

describe('summarizeOvertimeMonth', () => {
  it('NV-A tháng 10/2026: làm thêm 63, ca đêm 60 thành tính lương 40, dư 23, nghỉ bù 4,3 ngày, cột tổng 100', () => {
    expect(summarizeOvertimeMonth({ otHours: 63, nightHours: 60 }, cap)).toEqual({
      actualOtHours: 63,
      countedOtHours: 40,
      nightHours: 60,
      excessOtHours: 23,
      compDays: 4.3,
      payrollHours: 100,
    });
  });

  it('ca đêm không bị cắt trần và không đổi thành nghỉ bù: 40 giờ làm thêm, 82 giờ ca đêm', () => {
    const r = summarizeOvertimeMonth({ otHours: 40, nightHours: 82 }, cap);
    expect(r).toMatchObject({ countedOtHours: 40, excessOtHours: 0, compDays: 0, payrollHours: 122 });
  });

  it('dưới trần thì không có giờ dư', () => {
    expect(summarizeOvertimeMonth({ otHours: 15, nightHours: 0 }, cap)).toMatchObject({ countedOtHours: 15, excessOtHours: 0, compDays: 0, payrollHours: 15 });
  });

  it('tắt quy tắc thì không cắt trần và không quy đổi', () => {
    const r = summarizeOvertimeMonth({ otHours: 63, nightHours: 60 }, { ...cap, capApplies: false });
    expect(r).toMatchObject({ countedOtHours: 63, excessOtHours: 0, compDays: 0, payrollHours: 123 });
  });

  it('trần năm còn lại thấp hơn trần tháng thì lấy trần năm còn lại', () => {
    const r = summarizeOvertimeMonth({ otHours: 30, nightHours: 0, yearToDateCountedOtHours: 190 }, cap);
    expect(r).toMatchObject({ countedOtHours: 10, excessOtHours: 20 });
    expect(summarizeOvertimeMonth({ otHours: 30, nightHours: 0, yearToDateCountedOtHours: 250 }, cap)).toMatchObject({ countedOtHours: 0, excessOtHours: 30 });
  });

  it('không có trần năm thì chỉ áp trần tháng', () => {
    expect(summarizeOvertimeMonth({ otHours: 63, nightHours: 0, yearToDateCountedOtHours: 500 }, { ...cap, yearlyCapHours: null })).toMatchObject({ countedOtHours: 40 });
  });
});

describe('khớp bảng 1Office của NV-A tháng 10/2026 (mã ẩn danh)', () => {
  // Mỗi ca: [bắt đầu, kết thúc, phần ngày nghỉ hôm sau]. Ngày nghỉ lấy từ ghi chú nghỉ của tháng.
  const rows: Array<{ name: string; blocks: Array<[string, string, number]>; ot: number; night: number }> = [
    {
      name: '03 đến 04/10',
      blocks: [['2026-10-03T12:00', '2026-10-03T18:00', 0], ['2026-10-04T07:00', '2026-10-04T18:00', 0]],
      ot: 17,
      night: 0,
    },
    {
      name: '06 đến 12/10',
      blocks: [
        ['2026-10-06T18:00', '2026-10-07T04:00', 1],
        ['2026-10-07T18:00', '2026-10-08T04:00', 1],
        ['2026-10-08T18:00', '2026-10-09T00:00', 1],
        ['2026-10-09T18:00', '2026-10-10T00:00', 1],
        ['2026-10-10T18:00', '2026-10-11T00:00', 0],
        ['2026-10-11T18:00', '2026-10-12T00:00', 0],
      ],
      ot: 16,
      night: 28,
    },
    {
      name: '12 đến 18/10',
      blocks: [
        ['2026-10-12T18:00', '2026-10-13T05:00', 1],
        ['2026-10-13T18:00', '2026-10-14T03:00', 1],
        ['2026-10-14T18:00', '2026-10-15T02:00', 1],
        ['2026-10-15T18:00', '2026-10-16T02:00', 1],
        ['2026-10-16T18:00', '2026-10-17T00:00', 0],
        ['2026-10-17T13:00', '2026-10-17T23:00', 0],
        ['2026-10-18T13:30', '2026-10-18T17:30', 0],
      ],
      ot: 24,
      night: 32,
    },
    { name: '31/10', blocks: [['2026-10-31T15:30', '2026-10-31T21:30', 0]], ot: 6, night: 0 },
  ];

  const classify = (blocks: Array<[string, string, number]>) =>
    blocks
      .map(([s, e, f]) => classifyNightRest(b(s, e), f, nightRest))
      .reduce((a, r) => ({ ot: a.ot + r.otHours, night: a.night + r.nightHours }), { ot: 0, night: 0 });

  it.each(rows)('dòng $name', ({ blocks, ot, night }) => {
    expect(classify(blocks)).toEqual({ ot, night });
  });

  it('cả tháng: 63 giờ làm thêm, 60 giờ ca đêm, tính lương 40, dư 23, nghỉ bù 4,3 ngày, cột tổng 100', () => {
    const total = rows.map((r) => classify(r.blocks)).reduce((a, r) => ({ ot: a.ot + r.ot, night: a.night + r.night }), { ot: 0, night: 0 });
    expect(total).toEqual({ ot: 63, night: 60 });
    expect(summarizeOvertimeMonth({ otHours: total.ot, nightHours: total.night }, cap)).toMatchObject({
      countedOtHours: 40,
      excessOtHours: 23,
      compDays: 4.3,
      payrollHours: 100,
    });
  });
});

describe('validateCompOffUsageDays', () => {
  it('chỉ nhận bội số của bước 0,5 ngày và lớn hơn 0', () => {
    expect(validateCompOffUsageDays(0.5, 0.5)).toBeNull();
    expect(validateCompOffUsageDays(2, 0.5)).toBeNull();
    expect(validateCompOffUsageDays(1.5, 0.5)).toBeNull();
    expect(validateCompOffUsageDays(0.3, 0.5)).toMatch(/bội số/);
    expect(validateCompOffUsageDays(4.3, 0.5)).toMatch(/bội số/);
    expect(validateCompOffUsageDays(0, 0.5)).toMatch(/lớn hơn 0/);
    expect(validateCompOffUsageDays(-1, 0.5)).toMatch(/lớn hơn 0/);
  });
});
