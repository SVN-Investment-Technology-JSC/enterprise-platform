import {
  buildHolidayDraft,
  cloneHolidayYear,
  selectHolidaysToSave,
} from './holiday-calendar.js';

describe('holiday calendar', () => {
  it('builds a draft with fixed solar dates and manual placeholders', () => {
    const draft = buildHolidayDraft(2027, []);
    const dates = draft.map((d) => d.date);
    expect(dates).toEqual(
      expect.arrayContaining([
        '2027-01-01',
        '2027-04-30',
        '2027-05-01',
        '2027-09-02',
        '2027-09-01',
      ]),
    );
    expect(draft.filter((d) => d.date === null)).toHaveLength(2);
    expect(draft.every((d) => d.paid)).toBe(true);
  });
  it('marks dates that already exist', () => {
    const draft = buildHolidayDraft(2026, ['2026-05-01']);
    expect(draft.find((d) => d.date === '2026-05-01')?.exists).toBe(true);
  });
  it('clones fixed dates and leaves lunar dates for manual entry', () => {
    const items = cloneHolidayYear(
      [
        { date: '2026-09-02', name: 'Quoc khanh', paid: true },
        { date: '2026-02-17', name: 'Tet', paid: true },
      ],
      2027,
      [],
    );
    expect(items[0].date).toBe('2027-09-02');
    expect(items[1].date).toBeNull();
  });
  it('never overwrites existing dates and drops undated items on save', () => {
    const { toSave, skipped } = selectHolidaysToSave(
      [
        { date: '2027-01-01', name: 'A', paid: true },
        { date: '2027-05-01', name: 'B', paid: true },
        { date: null, name: 'Tet', paid: true },
        { date: '2028-01-01', name: 'Sai nam', paid: true },
      ],
      2027,
      ['2027-05-01'],
    );
    expect(toSave.map((i) => i.date)).toEqual(['2027-01-01']);
    expect(skipped).toHaveLength(3);
  });
});
