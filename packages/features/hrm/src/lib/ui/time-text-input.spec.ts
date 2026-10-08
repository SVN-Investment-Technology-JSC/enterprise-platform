import { parseTimeText } from './time-text-input';

describe('parseTimeText', () => {
  it.each([
    ['730', '07:30'],
    ['0730', '07:30'],
    ['7:30', '07:30'],
    ['7h30', '07:30'],
    ['17', '17:00'],
    ['17.5', '17:05'],
    ['23:59', '23:59'],
  ])('%s -> %s', (input, expected) => {
    expect(parseTimeText(input)).toBe(expected);
  });
  it.each(['', '24:00', '12:60', 'abc', '99'])('%s không hợp lệ', (input) => {
    expect(parseTimeText(input)).toBeNull();
  });
});
