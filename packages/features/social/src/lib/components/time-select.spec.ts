import { TIME_SLOTS } from './time-select';

describe('TIME_SLOTS', () => {
  it('có 96 mốc cách nhau 15 phút, từ 00:00 đến 23:45', () => {
    expect(TIME_SLOTS).toHaveLength(96);
    expect(TIME_SLOTS[0]).toBe('00:00');
    expect(TIME_SLOTS[1]).toBe('00:15');
    expect(TIME_SLOTS[68]).toBe('17:00');
    expect(TIME_SLOTS[95]).toBe('23:45');
  });
});
