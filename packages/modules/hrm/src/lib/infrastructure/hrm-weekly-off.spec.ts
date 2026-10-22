import { effectiveDayKind } from './hrm-time.js';

describe('loại ngày của lịch công ty', () => {
  it('lấy loại ngày từ work_calendar khi có dòng lịch', () => {
    expect(effectiveDayKind('WORK')).toBe('WORK');
    expect(effectiveDayKind('HOLIDAY')).toBe('HOLIDAY');
    expect(effectiveDayKind('OFF')).toBe('OFF');
  });

  it('không có dòng lịch thì không suy ra ngày nghỉ hằng tuần (do lịch phân ca quyết định)', () => {
    expect(effectiveDayKind(null)).toBeNull();
    expect(effectiveDayKind(undefined)).toBeNull();
  });
});
