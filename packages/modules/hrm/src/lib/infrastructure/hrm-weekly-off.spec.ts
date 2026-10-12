import { effectiveDayKind, weeklyOffDaysOf } from './hrm-time.js';

describe('weekly day-off policy', () => {
  const cfg = { weeklyOffDays: [6, 0] };

  it('treats configured weekdays without calendar entry as OFF', () => {
    expect(effectiveDayKind('2026-09-05', null, cfg)).toBe('OFF'); // Saturday
    expect(effectiveDayKind('2026-09-06', undefined, cfg)).toBe('OFF'); // Sunday
    expect(effectiveDayKind('2026-09-07', null, cfg)).toBeNull(); // Monday
  });

  it('lets explicit calendar entries override the weekly day-off', () => {
    expect(effectiveDayKind('2026-09-05', 'WORK', cfg)).toBe('WORK');
    expect(effectiveDayKind('2026-09-02', 'HOLIDAY', cfg)).toBe('HOLIDAY');
  });

  it('keeps legacy behaviour when nothing is configured', () => {
    expect(effectiveDayKind('2026-09-05', null, {})).toBeNull();
    expect(weeklyOffDaysOf({ weeklyOffDays: [9, 'x', 3] })).toEqual([3]);
  });
});
