import {
  normalizeName,
  parseLeaveRange,
  parseOvertimeBlocks,
  parsePunchAt,
  parseTripRange,
  splitRangeByMonths,
} from './oneoffice-requests.js';

describe('parseOvertimeBlocks', () => {
  it('đọc dạng đầy đủ ngày giờ và dạng cùng ngày, mỗi dòng một ca', () => {
    const blocks = parseOvertimeBlocks(
      [
        'Từ 18:00 12/10/2026 - 05:00 13/10/2026',
        'Từ 13:00 - 23:00, 17/10/2026',
        'Từ 13:30 - 17:30, 18/10/2026',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { start: '2026-10-12T18:00', end: '2026-10-13T05:00' },
      { start: '2026-10-17T13:00', end: '2026-10-17T23:00' },
      { start: '2026-10-18T13:30', end: '2026-10-18T17:30' },
    ]);
  });

  it('dạng cùng ngày có giờ kết thúc không sau giờ bắt đầu là ca qua nửa đêm', () => {
    expect(parseOvertimeBlocks('Từ 20:00 - 02:00, 05/10/2026')).toEqual([{ start: '2026-10-05T20:00', end: '2026-10-06T02:00' }]);
    expect(parseOvertimeBlocks('Từ 18:00 - 00:00, 09/10/2026')).toEqual([{ start: '2026-10-09T18:00', end: '2026-10-10T00:00' }]);
  });

  it('bỏ qua dòng trống hoặc không đọc được, nhận cả giờ có giây', () => {
    expect(parseOvertimeBlocks('')).toEqual([]);
    expect(parseOvertimeBlocks(null)).toEqual([]);
    expect(parseOvertimeBlocks('không phải giờ\nTừ 07:00:00 - 11:30:00, 03/10/2026')).toEqual([{ start: '2026-10-03T07:00', end: '2026-10-03T11:30' }]);
  });
});

describe('parseTripRange, parseLeaveRange, parsePunchAt', () => {
  it('công tác nhiều ngày', () => {
    expect(parseTripRange('Từ 07:30 29/10/2026 đến 17:00 01/11/2026')).toEqual({ from: '2026-10-29T07:30', to: '2026-11-01T17:00' });
    expect(parseTripRange('abc')).toBeNull();
  });

  it('nghỉ một ngày và nhiều ngày', () => {
    expect(parseLeaveRange('07:30:00 - 11:30:00, 23/10/2026')).toEqual({ from: '2026-10-23T07:30', to: '2026-10-23T11:30' });
    expect(parseLeaveRange('07:30:00, 21/10/2026 - 17:00:00, 23/10/2026')).toEqual({ from: '2026-10-21T07:30', to: '2026-10-23T17:00' });
    expect(parseLeaveRange('13:00:00 - 17:00:00, 30/10/2026')).toEqual({ from: '2026-10-30T13:00', to: '2026-10-30T17:00' });
    expect(parseLeaveRange('x')).toBeNull();
  });

  it('chấm công bổ sung', () => {
    expect(parsePunchAt('17:00 29/10/2026')).toBe('2026-10-29T17:00');
    expect(parsePunchAt('07:30 30/10/2026')).toBe('2026-10-30T07:30');
    expect(parsePunchAt('')).toBeNull();
  });
});

describe('splitRangeByMonths', () => {
  it('cắt tại 00:00 ngày mùng 1 và chỉ giữ các tháng trong phạm vi nhập', () => {
    const parts = splitRangeByMonths({ from: '2026-10-29T07:30', to: '2026-11-01T17:00' }, ['2026-09', '2026-10']);
    expect(parts).toEqual([{ from: '2026-10-29T07:30', to: '2026-11-01T00:00', periodMonth: '2026-10' }]);
  });

  it('khoảng nằm trong một tháng giữ nguyên; tháng ngoài phạm vi bị bỏ', () => {
    expect(splitRangeByMonths({ from: '2026-09-30T18:00', to: '2026-10-01T04:00' }, ['2026-09', '2026-10'])).toEqual([
      { from: '2026-09-30T18:00', to: '2026-10-01T00:00', periodMonth: '2026-09' },
      { from: '2026-10-01T00:00', to: '2026-10-01T04:00', periodMonth: '2026-10' },
    ]);
    expect(splitRangeByMonths({ from: '2026-11-02T08:00', to: '2026-11-02T10:00' }, ['2026-09', '2026-10'])).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('ghép tên không phân biệt hoa thường, khoảng trắng thừa và dạng dấu Unicode', () => {
    expect(normalizeName('  Bùi  Công Quyền ')).toBe(normalizeName('bùi công quyền'));
    expect(normalizeName('Bùi Công Quyền')).toBe(normalizeName('Bùi Công Quyền'));
  });
});
