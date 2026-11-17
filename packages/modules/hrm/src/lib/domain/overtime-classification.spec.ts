import {
  blockHours,
  classifyBlock,
  crossesMidnight,
  splitBlockByMonth,
  weekdayOf,
  type OvertimeBlock,
} from './overtime-classification.js';

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

describe('classifyBlock (quy tắc công ty: ca đêm theo sáng hôm sau)', () => {
  const worked = { nextMorningWorked: true };
  const off = { nextMorningWorked: false };

  it.each([
    // Ngày thường, qua đêm, sáng hôm sau KHÔNG đi làm: tối đa 8 giờ đầu là ca đêm, phần vượt là làm thêm.
    ['23/09 (T4) 17:00 đến 08:00 hôm sau, nghỉ sáng', '2026-09-23T17:00', '2026-09-24T08:00', off, 7, 8],
    ['18:00 đến 04:00, nghỉ sáng', '2026-10-06T18:00', '2026-10-07T04:00', off, 2, 8],
    ['18:00 đến 02:00 (đúng 8 giờ), nghỉ sáng', '2026-10-06T18:00', '2026-10-07T02:00', off, 0, 8],
    ['18:00 đến 00:00 (6 giờ), nghỉ sáng', '2026-10-08T18:00', '2026-10-09T00:00', off, 0, 6],
    // Sáng hôm sau có đi làm: toàn bộ là làm thêm.
    ['18:00 đến 04:00, có đi làm sáng', '2026-10-06T18:00', '2026-10-07T04:00', worked, 10, 0],
    // Không qua đêm: toàn bộ là làm thêm, kể cả khi sáng hôm sau nghỉ.
    ['17:00 đến 21:00 trong ngày', '2026-10-06T17:00', '2026-10-06T21:00', off, 4, 0],
    ['13:00 đến 17:00 trong ngày', '2026-10-06T13:00', '2026-10-06T17:00', off, 4, 0],
    // Thứ Bảy và Chủ nhật: toàn bộ là làm thêm, không xét sáng hôm sau.
    ['thứ Bảy 18:00 đến 04:00 (D+1 là Chủ nhật)', '2026-10-17T18:00', '2026-10-18T04:00', off, 10, 0],
    // Chủ nhật bắt đầu: D+1 là thứ Hai (ngày có ca) nên vẫn xét ca đêm.
    ['Chủ nhật 17:00 đến 01:00, nghỉ sáng thứ Hai', '2026-10-04T17:00', '2026-10-05T01:00', off, 0, 8],
    ['Chủ nhật 18:00 đến 06:00, nghỉ sáng thứ Hai', '2026-10-18T18:00', '2026-10-19T06:00', off, 4, 8],
    // Nghỉ nửa ngày hôm sau: ca đêm tối đa 4 giờ.
    ['18:00 đến 07:00 (13h), nghỉ nửa ngày', '2026-10-13T17:30', '2026-10-14T07:00', { nextMorningWorked: false, nextMorningHalf: true }, 9.5, 4],
    ['18:00 đến 02:00 (8h), nghỉ nửa ngày', '2026-10-18T18:00', '2026-10-19T02:00', { nextMorningWorked: false, nextMorningHalf: true }, 4, 4],
    ['17:00 đến 01:00 (8h), nghỉ nửa ngày', '2026-10-06T17:00', '2026-10-07T01:00', { nextMorningWorked: false, nextMorningHalf: true }, 4, 4],
  ])('%s', (_name, start, end, options, ot, night) => {
    const r = classifyBlock(b(start, end), options);
    expect(r).toMatchObject({ otHours: ot, nightHours: night });
    expect(r.otHours + r.nightHours).toBe(blockHours(b(start, end)));
  });

  it('số giờ ca đêm tối đa lấy theo tham số, mặc định 8', () => {
    expect(classifyBlock(b('2026-10-06T18:00', '2026-10-07T04:00'), { ...off, nightMaxHours: 6 })).toMatchObject({ otHours: 4, nightHours: 6 });
  });

  it('thứ trong tuần tính theo ngày bắt đầu khoảng', () => {
    expect(weekdayOf(b('2026-09-23T17:00', '2026-09-24T08:00'))).toBe(3);
    expect(weekdayOf(b('2026-09-26T13:00', '2026-09-26T19:00'))).toBe(6);
    expect(weekdayOf(b('2026-09-27T06:00', '2026-09-27T19:00'))).toBe(0);
  });

  it('từ chối khoảng có giờ kết thúc không sau giờ bắt đầu', () => {
    expect(() => classifyBlock(b('2026-10-06T18:00', '2026-10-06T17:00'), worked)).toThrow(RangeError);
  });

  it('mẫu Phan Trung Kiên dòng 69: tổng 58, làm thêm 50, ca đêm 8 (chỉ khoảng 23/09 qua đêm và sáng 24/09 nghỉ)', () => {
    const rows: Array<[string, string, { nextMorningWorked: boolean }]> = [
      ['2026-09-20T07:30', '2026-09-20T17:00', worked],
      ['2026-09-21T17:00', '2026-09-21T21:30', worked],
      ['2026-09-22T17:00', '2026-09-22T22:00', worked],
      ['2026-09-23T17:00', '2026-09-24T08:00', off],
      ['2026-09-25T17:00', '2026-09-25T22:00', worked],
      ['2026-09-26T13:00', '2026-09-26T19:00', worked],
      ['2026-09-27T06:00', '2026-09-27T19:00', worked],
    ];
    const total = rows.reduce(
      (n, [s, e, o]) => {
        const r = classifyBlock(b(s, e), o);
        return { ot: n.ot + r.otHours, night: n.night + r.nightHours };
      },
      { ot: 0, night: 0 },
    );
    expect(total).toEqual({ ot: 50, night: 8 });
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
