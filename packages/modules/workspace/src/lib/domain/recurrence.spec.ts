import {
  expandOccurrences,
  localDateKey,
  overlaps,
  parseRecurrenceRule,
  wallClockIn,
  zonedWallClockToUtc,
} from './recurrence.js';
import { WorkspaceValidationError } from './workspace.error.js';

/** Giờ treo tường của một mốc UTC, rút gọn thành `HH:mm` cho dễ đọc. */
const localTime = (instant: Date, timeZone: string) => {
  const wall = wallClockIn(instant, timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
};

describe('parseRecurrenceRule', () => {
  it('chuỗi rỗng nghĩa là sự kiện đơn lẻ', () => {
    expect(parseRecurrenceRule(undefined)).toBeUndefined();
    expect(parseRecurrenceRule('   ')).toBeUndefined();
  });

  it('đọc FREQ, INTERVAL và COUNT', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;COUNT=10')).toMatchObject({
      freq: 'WEEKLY',
      interval: 2,
      count: 10,
    });
  });

  it('bỏ tiền tố RRULE: nếu có', () => {
    expect(parseRecurrenceRule('RRULE:FREQ=DAILY;COUNT=3')).toMatchObject({ freq: 'DAILY' });
  });

  it('INTERVAL mặc định là 1', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;COUNT=3')?.interval).toBe(1);
  });

  it('đọc UNTIL dạng rút gọn của RFC 5545', () => {
    const rule = parseRecurrenceRule('FREQ=DAILY;UNTIL=20261231T235959Z');
    expect(rule?.until?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('từ chối chuỗi không có điểm dừng', () => {
    expect(() => parseRecurrenceRule('FREQ=DAILY')).toThrow(WorkspaceValidationError);
  });

  it('từ chối tần suất chưa hỗ trợ', () => {
    expect(() => parseRecurrenceRule('FREQ=YEARLY;COUNT=3')).toThrow(WorkspaceValidationError);
  });

  it('từ chối INTERVAL không phải số nguyên dương', () => {
    expect(() => parseRecurrenceRule('FREQ=DAILY;INTERVAL=0;COUNT=3')).toThrow(
      WorkspaceValidationError,
    );
  });
});

describe('zonedWallClockToUtc', () => {
  it('giờ Việt Nam lệch UTC đúng 7 tiếng, không có giờ mùa', () => {
    const utc = zonedWallClockToUtc(
      { year: 2026, month: 9, day: 21, hour: 9, minute: 0, second: 0 },
      'Asia/Ho_Chi_Minh',
    );
    expect(utc.toISOString()).toBe('2026-09-21T02:00:00.000Z');
  });

  it('đổi ngược lại ra đúng giờ treo tường ban đầu', () => {
    const wall = { year: 2026, month: 3, day: 15, hour: 9, minute: 30, second: 0 };
    const utc = zonedWallClockToUtc(wall, 'Europe/Berlin');
    expect(localTime(utc, 'Europe/Berlin')).toBe('09:30');
  });
});

describe('expandOccurrences', () => {
  const range = (fromIso: string, toIso: string) =>
    [new Date(fromIso), new Date(toIso)] as const;

  it('sự kiện đơn lẻ nằm ngoài khoảng thì không trả về gì', () => {
    const [from, to] = range('2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z');
    expect(
      expandOccurrences(
        {
          startAt: new Date('2026-09-21T02:00:00Z'),
          endAt: new Date('2026-09-21T03:00:00Z'),
          timezone: 'Asia/Ho_Chi_Minh',
        },
        from,
        to,
      ),
    ).toEqual([]);
  });

  it('chuỗi hằng ngày sinh đúng số lần theo COUNT', () => {
    const [from, to] = range('2026-09-01T00:00:00Z', '2026-12-31T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-09-21T02:00:00Z'),
        endAt: new Date('2026-09-21T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        rule: parseRecurrenceRule('FREQ=DAILY;COUNT=5'),
      },
      from,
      to,
    );
    expect(result.map((entry) => entry.occurrenceDate)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
  });

  it('INTERVAL=2 với WEEKLY nhảy hai tuần một lần', () => {
    const [from, to] = range('2026-09-01T00:00:00Z', '2026-12-31T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-09-21T02:00:00Z'),
        endAt: new Date('2026-09-21T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        rule: parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;COUNT=3'),
      },
      from,
      to,
    );
    expect(result.map((entry) => entry.occurrenceDate)).toEqual([
      '2026-09-21',
      '2026-10-05',
      '2026-10-19',
    ]);
  });

  it('chuỗi hằng tuần giữ nguyên 9:00 giờ địa phương qua mốc đổi giờ mùa', () => {
    // Berlin lùi giờ Chủ nhật 25/10/2026. Nếu chỉ cộng 7×24 giờ thì buổi sau
    // mốc đó sẽ thành 8:00; cộng theo ngày lịch mới giữ đúng 9:00.
    const [from, to] = range('2026-10-01T00:00:00Z', '2026-11-30T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-10-19T07:00:00Z'), // 09:00 giờ Berlin, còn giờ mùa hè
        endAt: new Date('2026-10-19T08:00:00Z'),
        timezone: 'Europe/Berlin',
        rule: parseRecurrenceRule('FREQ=WEEKLY;COUNT=4'),
      },
      from,
      to,
    );

    expect(result.map((entry) => localTime(entry.startAt, 'Europe/Berlin'))).toEqual([
      '09:00',
      '09:00',
      '09:00',
      '09:00',
    ]);
    // Mốc UTC phải dịch đúng một tiếng sau khi vùng này lùi giờ.
    expect(result[0]?.startAt.toISOString()).toBe('2026-10-19T07:00:00.000Z');
    expect(result[1]?.startAt.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  it('MONTHLY bỏ qua tháng không có ngày tương ứng', () => {
    // Ngày 31 tháng 1; tháng 2 và tháng 4 không có ngày 31 nên bị bỏ qua.
    const [from, to] = range('2026-01-01T00:00:00Z', '2026-06-30T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-01-31T02:00:00Z'),
        endAt: new Date('2026-01-31T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        rule: parseRecurrenceRule('FREQ=MONTHLY;COUNT=5'),
      },
      from,
      to,
    );
    expect(result.map((entry) => entry.occurrenceDate)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('UNTIL cắt chuỗi trước khi đạt COUNT', () => {
    const [from, to] = range('2026-09-01T00:00:00Z', '2026-12-31T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-09-21T02:00:00Z'),
        endAt: new Date('2026-09-21T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        rule: parseRecurrenceRule('FREQ=DAILY;COUNT=10;UNTIL=20260923T235959Z'),
      },
      from,
      to,
    );
    expect(result).toHaveLength(3);
  });

  it('chỉ trả những lần rơi vào khoảng tra cứu', () => {
    const [from, to] = range('2026-09-23T00:00:00Z', '2026-09-24T23:59:59Z');
    const result = expandOccurrences(
      {
        startAt: new Date('2026-09-21T02:00:00Z'),
        endAt: new Date('2026-09-21T03:00:00Z'),
        timezone: 'Asia/Ho_Chi_Minh',
        rule: parseRecurrenceRule('FREQ=DAILY;COUNT=10'),
      },
      from,
      to,
    );
    expect(result.map((entry) => entry.occurrenceDate)).toEqual(['2026-09-23', '2026-09-24']);
  });
});

describe('localDateKey', () => {
  it('lấy ngày theo giờ địa phương, không theo UTC', () => {
    // 18:00Z ngày 20 là 01:00 sáng ngày 21 theo giờ Việt Nam: khoá ngoại lệ
    // phải là ngày 21, nếu lấy theo UTC sẽ lệch một ngày.
    expect(localDateKey(new Date('2026-09-20T18:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-09-21');
    expect(localDateKey(new Date('2026-09-20T18:00:00Z'), 'UTC')).toBe('2026-09-20');
  });
});

describe('overlaps', () => {
  it('chạm đầu mút vẫn tính là giao nhau', () => {
    const a = new Date('2026-09-21T10:00:00Z');
    const b = new Date('2026-09-21T11:00:00Z');
    expect(overlaps(a, b, b, new Date('2026-09-21T12:00:00Z'))).toBe(true);
  });

  it('tách rời thì không giao', () => {
    expect(
      overlaps(
        new Date('2026-09-21T10:00:00Z'),
        new Date('2026-09-21T11:00:00Z'),
        new Date('2026-09-21T11:00:01Z'),
        new Date('2026-09-21T12:00:00Z'),
      ),
    ).toBe(false);
  });
});
