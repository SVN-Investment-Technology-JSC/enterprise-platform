import type { CalendarOccurrence, WorkItem } from '@enterprise-platform/contracts-workspace';
import {
  buildCalendarGrid,
  dateKey,
  gridLabel,
  gridLength,
  gridStart,
  shiftAnchor,
} from './calendar-grid.model';

function occurrence(overrides: Partial<CalendarOccurrence>): CalendarOccurrence {
  return {
    eventId: 'e1',
    occurrenceDate: '2026-09-21',
    startAt: '2026-09-21T02:00:00.000Z',
    endAt: '2026-09-21T03:00:00.000Z',
    title: 'Họp tuần',
    eventType: 'meeting',
    allDay: false,
    timezone: 'Asia/Ho_Chi_Minh',
    organizerUserId: 'u1',
    isException: false,
    isRecurring: false,
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: 'CV-001',
    title: 'Việc',
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('gridStart', () => {
  it('tuần bắt đầu từ thứ Hai', () => {
    // 2026-09-24 là thứ Năm; thứ Hai của tuần đó là 2026-09-21.
    expect(dateKey(gridStart(new Date(2026, 8, 24), 'week'))).toBe('2026-09-21');
  });

  it('Chủ nhật thuộc về tuần bắt đầu thứ Hai trước đó', () => {
    // 2026-09-27 là Chủ nhật; không được nhảy sang tuần sau.
    expect(dateKey(gridStart(new Date(2026, 8, 27), 'week'))).toBe('2026-09-21');
  });

  it('lưới tháng lùi tới thứ Hai của tuần chứa ngày mùng 1', () => {
    // 2026-09-01 là thứ Ba, nên lưới bắt đầu từ 2026-08-31.
    expect(dateKey(gridStart(new Date(2026, 8, 15), 'month'))).toBe('2026-08-31');
  });
});

describe('gridLength', () => {
  it('tuần 7 ô, tháng luôn 42 ô', () => {
    expect(gridLength('week')).toBe(7);
    expect(gridLength('month')).toBe(42);
  });
});

describe('buildCalendarGrid', () => {
  const anchor = new Date(2026, 8, 24);

  it('đặt sự kiện vào đúng ô ngày', () => {
    const cells = buildCalendarGrid(anchor, 'week', [occurrence({})], []);
    const cell = cells.find((entry) => entry.date === '2026-09-21');
    expect(cell?.entries).toHaveLength(1);
    expect(cell?.entries[0]).toMatchObject({ kind: 'event', title: 'Họp tuần' });
  });

  it('sự kiện nhiều ngày hiện trên từng ngày nó chạm tới', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [
        occurrence({
          title: 'Công tác',
          startAt: '2026-09-21T01:00:00.000Z',
          endAt: '2026-09-23T10:00:00.000Z',
        }),
      ],
      [],
    );
    const hit = cells.filter((cell) => cell.entries.length > 0).map((cell) => cell.date);
    expect(hit).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
  });

  it('chỉ ngày đầu của mục nhiều ngày mới hiện giờ', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [occurrence({ startAt: '2026-09-21T01:00:00.000Z', endAt: '2026-09-22T10:00:00.000Z' })],
      [],
    );
    expect(cells.find((cell) => cell.date === '2026-09-21')?.entries[0]?.time).toBeTruthy();
    expect(cells.find((cell) => cell.date === '2026-09-22')?.entries[0]?.time).toBeUndefined();
  });

  it('hạn công việc hiện như một mục trên lưới', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [],
      [workItem({ id: 'w1', title: 'Nộp hồ sơ', plannedEnd: '2026-09-25' })],
    );
    expect(cells.find((cell) => cell.date === '2026-09-25')?.entries[0]).toMatchObject({
      kind: 'deadline',
      title: 'Hạn: Nộp hồ sơ',
      workItemId: 'w1',
    });
  });

  it('việc đã đóng không còn hiện hạn', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [],
      [workItem({ id: 'w1', status: 'done', plannedEnd: '2026-09-25' })],
    );
    expect(cells.every((cell) => cell.entries.length === 0)).toBe(true);
  });

  it('ô ngoài tháng đang xem được đánh dấu', () => {
    const cells = buildCalendarGrid(new Date(2026, 8, 15), 'month', [], []);
    expect(cells[0]).toMatchObject({ date: '2026-08-31', inCurrentMonth: false });
    expect(cells.find((cell) => cell.date === '2026-09-01')?.inCurrentMonth).toBe(true);
  });

  it('mỗi buổi của chuỗi lặp có khoá riêng', () => {
    const cells = buildCalendarGrid(
      anchor,
      'week',
      [
        occurrence({ occurrenceDate: '2026-09-21' }),
        occurrence({
          occurrenceDate: '2026-09-22',
          startAt: '2026-09-22T02:00:00.000Z',
          endAt: '2026-09-22T03:00:00.000Z',
        }),
      ],
      [],
    );
    const keys = cells.flatMap((cell) => cell.entries.map((entry) => entry.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('shiftAnchor', () => {
  it('chế độ tuần nhảy đúng 7 ngày', () => {
    expect(dateKey(shiftAnchor(new Date(2026, 8, 24), 'week', 1))).toBe('2026-10-01');
  });

  it('chế độ tháng nhảy sang mùng 1 tháng trước', () => {
    expect(dateKey(shiftAnchor(new Date(2026, 8, 24), 'month', -1))).toBe('2026-08-01');
  });
});

describe('gridLabel', () => {
  it('nhãn tháng và nhãn tuần đọc được', () => {
    expect(gridLabel(new Date(2026, 8, 24), 'month')).toBe('Tháng 9/2026');
    expect(gridLabel(new Date(2026, 8, 24), 'week')).toBe('Tuần 21/09 – 27/09/2026');
  });
});
