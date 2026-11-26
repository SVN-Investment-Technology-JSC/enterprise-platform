import { earliestStartDate, isProjectOverdue, nextEndDate } from './project-dates';

const CLOSED = ['completed', 'cancelled'];
const project = (over: Partial<{ startDate: string | null; endDate: string | null; status: string }> = {}) => ({
  status: 'active',
  ...over,
});

describe('isProjectOverdue', () => {
  it('quá hạn khi đã qua ngày kết thúc mà dự án còn mở', () => {
    expect(isProjectOverdue(project({ endDate: '2026-10-30' }), '2026-11-26', CLOSED)).toBe(true);
    expect(isProjectOverdue(project({ endDate: '2026-11-26' }), '2026-11-26', CLOSED)).toBe(false); // đúng hôm nay chưa trễ
    expect(isProjectOverdue(project({ endDate: '2027-01-01' }), '2026-11-26', CLOSED)).toBe(false);
  });

  it('dự án đã hoàn thành hoặc huỷ không bị coi là trễ hạn, và không có ngày kết thúc thì không trễ', () => {
    expect(isProjectOverdue(project({ endDate: '2026-10-30', status: 'completed' }), '2026-11-26', CLOSED)).toBe(false);
    expect(isProjectOverdue(project({ endDate: '2026-10-30', status: 'cancelled' }), '2026-11-26', CLOSED)).toBe(false);
    expect(isProjectOverdue(project(), '2026-11-26', CLOSED)).toBe(false);
    expect(isProjectOverdue(project({ endDate: null }), '2026-11-26', CLOSED)).toBe(false);
  });
});

describe('earliestStartDate (ô Bắt đầu của hàng nhóm)', () => {
  it('lấy ngày bắt đầu sớm nhất, kể cả dự án đã đóng, bỏ qua dự án chưa có ngày', () => {
    expect(
      earliestStartDate([
        project({ startDate: '2026-10-14' }),
        project({ startDate: '2026-10-01', status: 'completed' }),
        project({ startDate: null }),
        project(),
      ]),
    ).toBe('2026-10-01');
  });

  it('nhóm rỗng hoặc không dự án nào có ngày thì không có giá trị', () => {
    expect(earliestStartDate([])).toBeUndefined();
    expect(earliestStartDate([project(), project({ startDate: null })])).toBeUndefined();
  });
});

describe('nextEndDate (ô Kết thúc của hàng nhóm khi không có dự án trễ hạn)', () => {
  it('lấy hạn kết thúc gần nhất trong các dự án chưa đóng', () => {
    expect(
      nextEndDate(
        [
          project({ endDate: '2027-02-11' }),
          project({ endDate: '2026-12-31' }),
          project({ endDate: '2026-01-05', status: 'completed' }), // đã đóng: không tính
          project({ endDate: null }),
        ],
        CLOSED,
      ),
    ).toBe('2026-12-31');
  });

  it('chỉ có dự án đã đóng hoặc không có ngày thì không có giá trị', () => {
    expect(nextEndDate([project({ endDate: '2026-01-05', status: 'cancelled' }), project()], CLOSED)).toBeUndefined();
    expect(nextEndDate([], CLOSED)).toBeUndefined();
  });
});
