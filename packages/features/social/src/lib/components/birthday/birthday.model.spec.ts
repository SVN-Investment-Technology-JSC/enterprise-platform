import type { SocialBirthdayEntry, SocialBirthdaysUpcoming } from '@enterprise-platform/contracts-social';
import { ageLabel, entryDayMonth, flattenEntries, monthGroupLabel, splitForWidget, whenLabel } from './birthday.model';

const entry = (id: string, date: string, daysUntil: number, extra: Partial<SocialBirthdayEntry> = {}): SocialBirthdayEntry => ({
  user: { id, name: `Người ${id}` },
  birthday: { day: Number(date.slice(8)), month: Number(date.slice(5, 7)) },
  date,
  daysUntil,
  isToday: daysUntil === 0,
  ...extra,
});

const data: SocialBirthdaysUpcoming = {
  today: '2026-10-22',
  total: 4,
  groups: [
    { year: 2026, month: 10, items: [entry('a', '2026-10-22', 0), entry('b', '2026-10-24', 2, { age: 30 })] },
    { year: 2027, month: 1, items: [entry('c', '2027-01-03', 73), entry('d', '2027-01-04', 74)] },
  ],
};

describe('birthday.model', () => {
  it('đặt nhãn tháng, thêm năm khi khác năm hiện tại', () => {
    expect(monthGroupLabel(data.groups[0], data.today)).toBe('Tháng 10');
    expect(monthGroupLabel(data.groups[1], data.today)).toBe('Tháng 1/2027');
  });

  it('định dạng ngày và tuổi', () => {
    expect(entryDayMonth(entry('x', '2026-03-05', 1))).toBe('05/03');
    expect(ageLabel({ age: 30 })).toBe('30 tuổi');
    expect(ageLabel({})).toBeUndefined();
  });

  it('nhãn thời gian', () => {
    expect(whenLabel({ daysUntil: 0, isToday: true })).toBe('Hôm nay');
    expect(whenLabel({ daysUntil: 1, isToday: false })).toBe('Ngày mai');
    expect(whenLabel({ daysUntil: 5, isToday: false })).toBe('Còn 5 ngày');
  });

  it('tách hôm nay và sắp tới cho widget', () => {
    expect(flattenEntries(data)).toHaveLength(4);
    const split = splitForWidget(data, 2);
    expect(split.today.map((e) => e.user.id)).toEqual(['a']);
    expect(split.next.map((e) => e.user.id)).toEqual(['b', 'c']);
    expect(split.more).toBe(1);
  });
});
