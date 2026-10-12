import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';
import { extraRangesProblem, firstOverlap, nextRange, rangeLabel, type ExtraRange } from './request-ranges';

const preview = (over: Partial<HrmRequestTimePreview> = {}): HrmRequestTimePreview => ({
  fromAt: 'a',
  toAt: 'b',
  timezone: 'Asia/Ho_Chi_Minh',
  totalMinutes: 480,
  totalHours: 8,
  totalDays: 1,
  days: [],
  warnings: [],
  errors: [],
  ...over,
});
const extra = (fromAt: string, toAt: string, p: HrmRequestTimePreview | null = preview()): ExtraRange => ({
  id: fromAt,
  fromAt,
  toAt,
  preview: p,
});

describe('nextRange', () => {
  it('ngày liền sau, cùng giờ bắt đầu và kết thúc', () => {
    expect(nextRange({ fromAt: '2026-10-12T07:30', toAt: '2026-10-12T17:00' })).toEqual({
      fromAt: '2026-10-13T07:30',
      toAt: '2026-10-13T17:00',
    });
  });

  it('giữ số ngày trải rộng của khoảng cuối và qua tháng', () => {
    expect(nextRange({ fromAt: '2026-10-30T08:00', toAt: '2026-11-01T17:00' })).toEqual({
      fromAt: '2026-11-02T08:00',
      toAt: '2026-11-04T17:00',
    });
  });

  it('khoảng cuối chưa hợp lệ: trả khoảng rỗng', () => {
    expect(nextRange(null)).toEqual({ fromAt: '', toAt: '' });
    expect(nextRange({ fromAt: '2026-10-12T10:00', toAt: '2026-10-12T09:00' })).toEqual({ fromAt: '', toAt: '' });
  });
});

describe('firstOverlap', () => {
  it('tìm cặp khoảng chồng nhau, khoảng liền kề không chồng', () => {
    expect(
      firstOverlap([
        { fromAt: '2026-10-12T08:00', toAt: '2026-10-12T12:00' },
        { fromAt: '2026-10-12T12:00', toAt: '2026-10-12T17:00' },
        { fromAt: '2026-10-12T16:00', toAt: '2026-10-12T18:00' },
      ]),
    ).toEqual([1, 2]);
    expect(
      firstOverlap([
        { fromAt: '2026-10-12T08:00', toAt: '2026-10-12T12:00' },
        { fromAt: '2026-10-12T12:00', toAt: '2026-10-12T17:00' },
      ]),
    ).toBeNull();
  });

  it('khoảng chưa đủ dữ liệu bị bỏ qua', () => {
    expect(firstOverlap([{ fromAt: '', toAt: '' }, { fromAt: '2026-10-12T08:00', toAt: '2026-10-12T12:00' }])).toBeNull();
  });
});

describe('extraRangesProblem', () => {
  const main = { fromAt: '2026-10-12T08:00', toAt: '2026-10-12T17:00' };

  it('hợp lệ khi các khoảng bổ sung đã tính, không lỗi, không chồng nhau', () => {
    expect(extraRangesProblem('leave', main, [extra('2026-10-13T08:00', '2026-10-13T17:00')])).toBeNull();
  });

  it('báo lỗi theo từng khoảng, kèm tên khoảng', () => {
    expect(extraRangesProblem('ot', main, [extra('', '')])?.message).toContain('Khoảng làm thêm 2 chưa chọn đủ');
    expect(extraRangesProblem('ot', main, [extra('2026-10-13T10:00', '2026-10-13T09:00')])?.message).toContain(
      'kết thúc phải sau',
    );
    expect(extraRangesProblem('trip', main, [extra('2026-10-13T08:00', '2026-10-13T17:00', null)])?.message).toContain(
      'đang được tính',
    );
    expect(
      extraRangesProblem('ot', main, [
        extra('2026-10-13T16:00', '2026-10-13T19:00', preview({ errors: ['Giờ làm thêm 16:00 - 17:00 trùng ca làm việc'] })),
      ])?.message,
    ).toBe('Khoảng làm thêm 2: Giờ làm thêm 16:00 - 17:00 trùng ca làm việc');
    expect(
      extraRangesProblem('leave', main, [extra('2026-10-17T08:00', '2026-10-17T17:00', preview({ totalDays: 0 }))])?.message,
    ).toContain('không có ngày làm việc');
  });

  it('khoảng bổ sung chồng khoảng chính hoặc chồng nhau: báo trùng thời gian', () => {
    const problem = extraRangesProblem('leave', main, [extra('2026-10-12T16:00', '2026-10-13T12:00')]);
    expect(problem?.title).toBe('Khoảng nghỉ 1 trùng thời gian');
    expect(problem?.message).toContain('Khoảng nghỉ 1 và Khoảng nghỉ 2');
  });

  it('tên khoảng theo loại đơn', () => {
    expect(rangeLabel(0, 'leave')).toBe('Khoảng nghỉ 1');
    expect(rangeLabel(1, 'ot')).toBe('Khoảng làm thêm 2');
    expect(rangeLabel(2, 'trip')).toBe('Khoảng công tác 3');
  });
});
